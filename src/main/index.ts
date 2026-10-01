// Lebenszyklus der Hülle: Single-Instance-Lock, Dock-Klick zeigt das Fenster,
// Schließen des Hauptfensters = Ausblenden, Menüleiste, Hotkeys, Helfer,
// Benachrichtigungs-Stream, Auto-Update. Alles Zustandsbehaftete bleibt auf
// dem Server; hier wird nur verdrahtet.

import { existsSync } from "node:fs";

import { BrowserWindow, Notification, app, session as electronSession, shell } from "electron";

import { type AppInfo, BRIDGE_VERSION, type Capability, type InstanceInfo, type NativeEvent } from "../shared/bridge";
import { capabilitiesFrom } from "../shared/capabilities";
import { type HelperSttStatus, type PermissionKind, type PermissionsStatus } from "../shared/helper-types";
import { type ConnectionState, type DictationConfig, type GeneralConfig, type HotkeyConfig, type LocalEvent, type LocalState, type ProbeResult, type QuickState } from "../shared/local-api";
import { registerBridgeIpc } from "./bridge";
import { type AppConfig, configStore } from "./config";
import { GlobalDictation } from "./dictation";
import { installDownloadHandler } from "./downloads";
import { HelperClient } from "./helper";
import { registerHotkeys, unregisterHotkeys } from "./hotkeys";
import { describeResolveFailure, instanceCandidates, instanceOrigins, isInstanceUrl, normalizeInstanceUrl, probeHealth, resolveInstance, serverHasBridge } from "./instance";
import { uiInfo } from "./glass";
import { applyLinkPolicy, openExternalSafely } from "./links";
import { registerLocalIpc } from "./local-ipc";
import { initLog, logFilePath, scoped } from "./log";
import { buildAppMenu } from "./menu";
import { NotificationClient } from "./notifications";
import { helperBinaryPath } from "./paths";
import { session } from "./session";
import { TrayController } from "./tray";
import { updater } from "./updater";
import { HudWindowController } from "./windows/hud";
import { MainWindowController } from "./windows/main";
import { onboardingWindow } from "./windows/onboarding";
import { QuickWindowController } from "./windows/quick";
import { settingsWindow } from "./windows/settings";
import { instanceWebPreferences } from "./windows/common";

const ONLINE_POLL_MS = 60_000;
const OFFLINE_POLL_MS = 15_000;

class KiraApp {
  private config!: AppConfig;
  private readonly log = scoped("app");
  private quitting = false;
  private helper!: HelperClient;
  private dictation!: GlobalDictation;
  private notifications: NotificationClient | null = null;
  private mainWin!: MainWindowController;
  private quickWin!: QuickWindowController;
  private readonly hud = new HudWindowController();
  private tray!: TrayController;
  private hotkeyConflicts: string[] = [];
  private connection: ConnectionState = { online: false, origin: null, kind: null, serverVersion: null, serverHasBridge: false, lastError: null };
  private pollTimer: NodeJS.Timeout | null = null;
  private connecting: Promise<void> | null = null;
  private statusCache: { at: number; stt: HelperSttStatus | null; permissions: PermissionsStatus | null } | null = null;

  async boot(): Promise<void> {
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }
    initLog();
    this.config = configStore.load();
    this.applyUserAgent();
    app.setAboutPanelOptions({ applicationName: "KIRA für Mac", applicationVersion: app.getVersion(), copyright: "© 2026 Lucas Reiser" });

    app.on("second-instance", () => this.mainWin.show());
    app.on("activate", () => {
      if (this.config.onboarded) this.mainWin.show();
      else onboardingWindow.show();
    });
    app.on("window-all-closed", () => {
      /* Menüleisten-App: weiterlaufen */
    });
    app.on("before-quit", () => {
      this.quitting = true;
    });
    app.on("will-quit", () => {
      unregisterHotkeys();
      updater.stop();
      void this.notifications?.stop();
      void this.helper.stop();
    });

    await app.whenReady();
    this.log.info("app_ready", { version: app.getVersion(), packaged: app.isPackaged });

    this.setupHelper();
    this.setupDictation();
    this.setupWindows();
    this.setupPermissions();
    installDownloadHandler(electronSession.defaultSession, () => this.mainWin.window);
    this.registerIpc();
    this.tray = new TrayController({
      onOpen: () => this.mainWin.show(),
      onQuick: () => this.quickWin.toggle(),
      onDictation: () => void this.dictation.toggle(),
      onSettings: () => settingsWindow.show(),
      onUpdates: () => void updater.check(true),
      onQuit: () => app.quit(),
      isDictating: () => this.dictation.currentState !== "idle",
      hotkeys: () => this.config.hotkeys,
    });
    this.tray.create();
    this.rebuildMenu();
    this.applyHotkeys();
    this.applyLoginItem();
    updater.on("state", (state) => this.broadcast({ type: "update", update: state }));
    updater.start();

    session.onSessionRequest(() => {
      this.mainWin.sendNative({ type: "session-request" });
    });

    if (!this.config.onboarded || instanceCandidates(this.config.instance).length === 0) {
      onboardingWindow.show();
    } else {
      this.mainWin.create();
      await this.connect();
    }
  }

  // ── Aufbau ────────────────────────────────────────────────────────────

  private applyUserAgent(): void {
    // Der Vertrag verlangt das Suffix `KIRA-Mac/<Version> (bridge/<N>)` am Ende.
    const base = app.userAgentFallback
      .replace(/\s?kira-mac\/\S+/i, "")
      .replace(/\s?Electron\/\S+/, "")
      .trim();
    const ua = `${base} KIRA-Mac/${app.getVersion()} (bridge/${BRIDGE_VERSION})`;
    app.userAgentFallback = ua;
    session.setUserAgent(ua);
  }

  private setupHelper(): void {
    const binary = helperBinaryPath();
    this.helper = new HelperClient({ binaryPath: binary, log: scoped("helper") });
    this.helper.on("info", (info) => {
      this.log.info("helper_info", { version: info.version, macos: info.macos, features: info.features });
      this.statusCache = null;
      this.broadcastState();
    });
    this.helper.on("exited", () => {
      this.statusCache = null;
      this.broadcastState();
    });
    if (existsSync(binary)) {
      this.helper.start();
    } else {
      this.log.warn("helper_binary_missing", { binary });
    }
  }

  private helperMissingReason(): string | null {
    if (this.helper.running) return null;
    if (!existsSync(this.helper.binaryPath)) return "Der Helfer ist nicht gebaut (scripts/build-helper.sh) – Apple-Schnittstellen fehlen.";
    return this.helper.lastError ?? "Der Helfer läuft nicht.";
  }

  private setupDictation(): void {
    this.dictation = new GlobalDictation({
      helper: this.helper,
      server: {
        fetchVocabulary: async () => {
          if (!session.getOrigin()) return null;
          const r = await session.fetchJson<{ vocabulary?: unknown }>("/api/users/me/speech");
          return typeof r.vocabulary === "string" ? r.vocabulary : "";
        },
        fetchDisplayName: async () => {
          if (!session.getOrigin()) return null;
          const r = await session.fetchJson<Record<string, unknown>>("/api/auth/me");
          const name = [r.display_name, r.name].find((v) => typeof v === "string" && v.trim());
          if (typeof name === "string") return name.trim();
          const email = typeof r.email === "string" ? r.email : "";
          return email.includes("@") ? (email.split("@")[0] ?? null) : null;
        },
      },
      hud: {
        show: () => this.hud.show(),
        hide: () => this.hud.hide(),
        update: (state) => this.hud.update(state),
      },
      getLocale: () => this.config.dictation.locale,
      getCommandsEnabled: () => this.config.dictation.commands,
      log: scoped("dictation"),
    });
    this.dictation.on("state", () => {
      this.tray.refresh();
      this.rebuildMenu();
    });
  }

  private setupWindows(): void {
    this.mainWin = new MainWindowController({
      origins: () => this.origins(),
      isQuitting: () => this.quitting,
      getBounds: () => this.config.mainWindow,
      saveBounds: (bounds) => {
        this.config = configStore.update({ mainWindow: bounds });
      },
      onChildWindow: () => undefined,
      onLoadFailed: (reason) => this.onMainLoadFailed(reason),
      onDashboardLoaded: () => {
        this.mainWin.sendNative({ type: "connectivity", online: this.connection.online });
      },
    });
    this.quickWin = new QuickWindowController({
      origin: () => session.getOrigin(),
      origins: () => this.origins(),
      onChildWindow: () => undefined,
      onNeedsInstance: () => (this.config.onboarded ? this.mainWin.show() : onboardingWindow.show()),
    });
  }

  private setupPermissions(): void {
    const allowed = new Set(["media", "notifications", "clipboard-sanitized-write", "fullscreen", "clipboard-read"]);
    const ses = electronSession.defaultSession;
    ses.setPermissionRequestHandler((contents, permission, callback, details) => {
      const url = ("requestingUrl" in details && typeof details.requestingUrl === "string" ? details.requestingUrl : "") || contents.getURL();
      const instance = isInstanceUrl(url, this.origins());
      if (!instance || !allowed.has(permission)) {
        callback(false);
        return;
      }
      if (permission === "media") {
        const types = ("mediaTypes" in details && Array.isArray(details.mediaTypes) ? details.mediaTypes : []) as string[];
        callback(types.every((t) => t === "audio"));
        return;
      }
      callback(true);
    });
    ses.setPermissionCheckHandler((_contents, permission, origin) => isInstanceUrl(origin, this.origins()) && allowed.has(permission));
  }

  private registerIpc(): void {
    const appInfo: AppInfo = { name: "KIRA für Mac", version: app.getVersion(), platform: "darwin", arch: process.arch };
    registerBridgeIpc({
      origins: () => this.origins(),
      appInfo,
      capabilities: () => this.capabilities(),
      instance: () => this.instanceInfo(),
      session,
      helper: this.helper,
      dictation: this.dictation,
      locale: () => this.config.dictation.locale,
      onNotificationClick: (url) => this.mainWin.navigate(session.getOrigin(), url ?? "/"),
      onSessionChanged: (hasTokens) => {
        this.dictation.invalidateVocabulary();
        if (hasTokens) this.notifications?.reconnectNow();
      },
    });
    registerLocalIpc({
      getState: () => this.localState(),
      probe: (url) => this.probe(url),
      saveInstance: async (instance) => {
        this.config = configStore.update({ instance: { ...this.config.instance, ...instance, label: this.labelFor(instance.internalUrl ?? instance.externalUrl) } });
        this.quickWin.invalidate();
        if (this.config.onboarded) await this.connect(true);
      },
      finishOnboarding: async () => {
        this.config = configStore.update({ onboarded: true });
        onboardingWindow.close();
        this.mainWin.create();
        await this.connect(true);
      },
      setHotkeys: async (hotkeys: HotkeyConfig) => {
        this.config = configStore.update({ hotkeys });
        this.applyHotkeys();
        this.tray.refresh();
        this.rebuildMenu();
        return this.hotkeyConflicts;
      },
      setDictation: async (dictation: DictationConfig) => {
        this.config = configStore.update({ dictation });
        this.statusCache = null;
      },
      setGeneral: async (general: GeneralConfig) => {
        const before = this.config.general;
        this.config = configStore.update({ general });
        if (before.launchAtLogin !== general.launchAtLogin) this.applyLoginItem();
        if (before.notifications !== general.notifications) {
          if (general.notifications) this.startNotifications();
          else await this.stopNotifications(true);
        }
      },
      requestPermission: (kind) => this.requestPermission(kind),
      checkForUpdates: () => updater.check(false),
      logPath: () => logFilePath(),
      hudStop: () => this.dictation.stop(),
      retry: () => this.connect(true),
      openSettings: () => settingsWindow.show(),
      openMain: () => this.mainWin.show(),
      openLink: (url) => this.openLink(url),
      quick: {
        getState: () => this.quickStateStub(),
        send: async () => {
          throw new Error("Das Schnellfenster wird gerade umgebaut.");
        },
        stop: async () => undefined,
        reset: () => undefined,
        openInMain: () => this.mainWin.show(),
        hide: () => this.quickWin.hide(),
        resize: () => undefined,
        toggleDictation: async () => undefined,
      },
    });
  }

  /** Link aus einer lokalen Seite: Instanz → Hauptfenster (Pfad), sonst System-Browser. */
  private openLink(url: string): void {
    if (isInstanceUrl(url, this.origins())) {
      try {
        const u = new URL(url);
        this.mainWin.navigate(session.getOrigin(), `${u.pathname}${u.search}${u.hash}`);
      } catch {
        this.mainWin.show();
      }
      return;
    }
    openExternalSafely(url);
  }

  private quickStateStub(): QuickState {
    return {
      sessionId: null,
      messages: [],
      busy: false,
      mode: this.connection.online ? "server" : "offline",
      connection: { online: this.connection.online, label: this.labelFor(session.getOrigin()) },
      dictation: { available: false, active: false, level: 0, partial: "", reason: null },
      hotkeys: this.config.hotkeys,
    };
  }

  private rebuildMenu(): void {
    buildAppMenu({
      onOpenMain: () => this.mainWin.show(),
      onQuick: () => this.quickWin.toggle(),
      onDictation: () => void this.dictation.toggle(),
      onSettings: () => settingsWindow.show(),
      onUpdates: () => void updater.check(true),
      onOpenInBrowser: () => {
        const origin = session.getOrigin();
        if (origin) void shell.openExternal(origin);
      },
      onShowLogs: () => shell.showItemInFolder(logFilePath()),
      onNewWindow: () => this.openInstanceWindow("/"),
      hotkeys: () => this.config.hotkeys,
      isDictating: () => this.dictation.currentState !== "idle",
    });
  }

  /** „Beim Anmelden starten“ kennt macOS nur für gebündelte, signierte Apps – in dev schlägt es fehl. */
  private applyLoginItem(): void {
    if (!app.isPackaged) return;
    try {
      app.setLoginItemSettings({ openAtLogin: this.config.general.launchAtLogin });
    } catch (err) {
      this.log.warn("login_item_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private applyHotkeys(): void {
    this.hotkeyConflicts = registerHotkeys(this.config.hotkeys, {
      quickWindow: () => this.quickWin.toggle(),
      dictation: () => void this.dictation.toggle(),
    });
    if (this.hotkeyConflicts.length && Notification.isSupported()) {
      new Notification({ title: "Tastenkürzel belegt", body: this.hotkeyConflicts.join("\n") }).show();
    }
  }

  // ── Instanz & Verbindung ──────────────────────────────────────────────

  private origins(): string[] {
    return instanceOrigins(this.config.instance);
  }

  private labelFor(url: string | null | undefined): string {
    const origin = normalizeInstanceUrl(url);
    if (!origin) return "KIRA";
    try {
      return new URL(origin).host;
    } catch {
      return "KIRA";
    }
  }

  private instanceInfo(): InstanceInfo {
    const origin = session.getOrigin() ?? this.origins()[0] ?? "";
    return { origin, label: this.labelFor(origin) || this.config.instance.label };
  }

  private capabilities(): Capability[] {
    return capabilitiesFrom(this.helper.running ? this.helper.info?.features : null);
  }

  private async probe(url: string): Promise<ProbeResult> {
    const origin = normalizeInstanceUrl(url);
    if (!origin) return { url, ok: false, version: null, bridge: false, error: "Keine gültige http(s)-Adresse.", latencyMs: null };
    const p = await probeHealth(origin, session.rawFetch);
    return { url: origin, ok: p.ok, version: p.version, bridge: serverHasBridge(p.version), error: p.error, latencyMs: p.latencyMs };
  }

  /** Wählt die Instanz (intern vor extern) und lädt das Dashboard oder die Offline-Seite. */
  private connect(force = false): Promise<void> {
    if (this.connecting) return this.connecting;
    this.connecting = this.connectInner(force).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connectInner(force: boolean): Promise<void> {
    const candidates = instanceCandidates(this.config.instance);
    if (candidates.length === 0) {
      onboardingWindow.show();
      return;
    }
    const result = await resolveInstance(candidates, session.rawFetch);
    const previousOrigin = session.getOrigin();
    if (result.resolved) {
      const { origin, kind, version } = result.resolved;
      const hasBridge = result.resolved.serverHasBridge;
      const wasOnline = this.connection.online;
      session.setOrigin(origin);
      this.connection = { online: true, origin, kind, serverVersion: version, serverHasBridge: hasBridge, lastError: null };
      const originChanged = previousOrigin !== origin;
      if (originChanged || force || !this.mainWin.isDashboardLoaded()) {
        this.mainWin.loadInstance(origin);
        this.quickWin.invalidate();
      }
      this.mainWin.show();
      this.tray.setStatus(true, this.labelFor(origin));
      if (!wasOnline) this.mainWin.sendNative({ type: "connectivity", online: true });
      if (originChanged) await this.stopNotifications(false);
      if (hasBridge && this.config.general.notifications) this.startNotifications();
      else if (!hasBridge) this.log.info("server_without_bridge", { version });
      this.schedulePoll(ONLINE_POLL_MS);
    } else {
      const reason = describeResolveFailure(result);
      const wasOnline = this.connection.online;
      this.connection = { ...this.connection, online: false, lastError: reason };
      this.log.warn("instance_unreachable", { reason });
      this.tray.setStatus(false, this.config.instance.label, reason);
      if (wasOnline && this.mainWin.isDashboardLoaded()) {
        // Dashboard bleibt stehen (es hat seinen eigenen Offline-Hinweis) – nur das Ereignis.
        this.mainWin.sendNative({ type: "connectivity", online: false });
      } else {
        this.mainWin.showOffline(reason);
      }
      this.schedulePoll(OFFLINE_POLL_MS);
    }
    this.broadcast({ type: "connection", connection: this.connection });
  }

  private schedulePoll(ms: number): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.connect();
    }, ms);
    this.pollTimer.unref?.();
  }

  private onMainLoadFailed(reason: string): void {
    this.connection = { ...this.connection, online: false, lastError: `Instanz nicht erreichbar: ${reason}` };
    this.tray.setStatus(false, this.config.instance.label, reason);
    this.mainWin.showOffline(`Instanz nicht erreichbar: ${reason}`);
    this.schedulePoll(OFFLINE_POLL_MS);
    this.broadcast({ type: "connection", connection: this.connection });
  }

  private startNotifications(): void {
    if (this.notifications) {
      this.notifications.reconnectNow();
      return;
    }
    this.notifications = new NotificationClient({
      session,
      deviceId: this.config.deviceId,
      isMainFocused: () => this.mainWin.isFocused(),
      showMain: () => this.mainWin.show(),
      sendToDashboard: (event: NativeEvent) => this.mainWin.sendNative(event),
      navigateFallback: (path) => this.mainWin.navigate(session.getOrigin(), path),
    });
    this.notifications.on("disconnected", (reason) => {
      if (this.connection.online) this.tray.setStatus(true, this.labelFor(session.getOrigin()), reason);
    });
    this.notifications.on("connected", () => this.tray.setStatus(true, this.labelFor(session.getOrigin())));
    this.notifications.start();
  }

  private async stopNotifications(unsubscribe: boolean): Promise<void> {
    const client = this.notifications;
    if (!client) return;
    this.notifications = null;
    await client.stop();
    if (unsubscribe) await client.unsubscribe();
  }

  private openInstanceWindow(path: string): void {
    const origin = session.getOrigin();
    if (!origin) {
      this.mainWin.show();
      return;
    }
    const win = new BrowserWindow({ width: 1100, height: 800, title: "KIRA", backgroundColor: "#0b0c0f", webPreferences: instanceWebPreferences() });
    applyLinkPolicy(win.webContents, { isInstanceUrl: (url) => isInstanceUrl(url, this.origins()) });
    void win.loadURL(`${origin}${path}`);
  }

  // ── Zustand für lokale Seiten ─────────────────────────────────────────

  private async helperStatus(): Promise<{ stt: HelperSttStatus | null; permissions: PermissionsStatus | null }> {
    const cached = this.statusCache;
    if (cached && Date.now() - cached.at < 5_000) return cached;
    let stt: HelperSttStatus | null = null;
    let permissions: PermissionsStatus | null = null;
    if (this.helper.running) {
      const [s, p] = await Promise.all([
        this.helper.request<HelperSttStatus>("stt.status", { locale: this.config.dictation.locale }, 5_000).catch(() => null),
        this.helper.request<PermissionsStatus>("permissions.status", undefined, 5_000).catch(() => null),
      ]);
      stt = s;
      permissions = p;
    }
    this.statusCache = { at: Date.now(), stt, permissions };
    return this.statusCache;
  }

  private async localState(): Promise<LocalState> {
    const status = await this.helperStatus();
    const missing = this.helperMissingReason();
    return {
      appVersion: app.getVersion(),
      ui: uiInfo(),
      instance: this.config.instance,
      hotkeys: this.config.hotkeys,
      dictation: this.config.dictation,
      general: this.config.general,
      connection: this.connection,
      update: updater.state,
      helper: { running: this.helper.running, info: this.helper.info, lastError: missing },
      dictationStatus: { stt: status.stt, permissions: status.permissions, hotkeyConflicts: this.hotkeyConflicts },
      onboarded: this.config.onboarded,
      logPath: logFilePath(),
    };
  }

  private async requestPermission(kind: PermissionKind): Promise<PermissionsStatus | null> {
    if (!this.helper.running) return null;
    await this.helper.request("permissions.request", { kind }, 120_000).catch((err: unknown) => {
      this.log.warn("permission_request_failed", { kind, error: err instanceof Error ? err.message : String(err) });
    });
    this.statusCache = null;
    return (await this.helperStatus()).permissions;
  }

  private broadcast(event: LocalEvent): void {
    settingsWindow.send(event);
    onboardingWindow.send(event);
  }

  private broadcastState(): void {
    void this.localState().then((state) => this.broadcast({ type: "state", state }));
  }
}

const kira = new KiraApp();
void kira.boot().catch((err: unknown) => {
  scoped("app").error("boot_failed", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
  app.quit();
});

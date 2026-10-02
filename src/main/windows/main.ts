// Hauptfenster: lädt das Dashboard vom Server. Schließen = Ausblenden (die
// Hülle hält das Fenster am Leben, damit `session-request` beantwortet werden
// kann). Scheitert das Laden, zeigt es die lokale Offline-Seite mit Grund.
// Leitet Cloudflare Access auf seine Anmeldung um, fragt es den Hauptprozess,
// ob die im Fenster laufen darf – sonst zeigt es „Im Browser anmelden“.

import { BrowserWindow, type WebContents, screen } from "electron";

import { type NativeEvent } from "../../shared/bridge";
import { IPC } from "../../shared/ipc";
import { LOCAL_IPC } from "../../shared/ipc-local";
import { type LocalEvent } from "../../shared/local-api";
import { isAccessLoginUrl } from "../access-login";
import { type WindowBounds } from "../config";
import { isInstanceUrl } from "../instance";
import { applyLinkPolicy } from "../links";
import { scoped } from "../log";
import { localPageUrl } from "../paths";
import { instanceWebPreferences } from "./common";

const log = scoped("main-window");

export interface MainWindowDeps {
  origins: () => string[];
  isQuitting: () => boolean;
  getBounds: () => WindowBounds | null;
  saveBounds: (bounds: WindowBounds) => void;
  onChildWindow: (win: BrowserWindow) => void;
  onLoadFailed: (reason: string) => void;
  onDashboardLoaded: () => void;
  /** Eingelassene Titelleiste (Ampel im Dashboard-Kopf)? Nur, wenn der Server sie kennt. */
  insetTitleBar: () => boolean;
  /**
   * Das Fenster soll zur Cloudflare-Access-Anmeldung. true = nicht im Fenster
   * (der Hauptprozess zeigt stattdessen „Im Browser anmelden“).
   */
  onAccessRedirect: (url: string) => boolean;
}

export class MainWindowController {
  private win: BrowserWindow | null = null;
  private dashboardLoaded = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private inset = false;
  private readonly deps: MainWindowDeps;

  constructor(deps: MainWindowDeps) {
    this.deps = deps;
  }

  get window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  create(): BrowserWindow {
    const existing = this.window;
    if (existing) return existing;
    const bounds = this.fittedBounds(this.deps.getBounds());
    this.inset = this.deps.insetTitleBar();
    const win = new BrowserWindow({
      ...bounds,
      // Ab 800 px zeigt das Dashboard immer sein Desktop-Layout (md = 768 px);
      // darunter läge der Burger der Mobilansicht unter der Ampel.
      minWidth: 800,
      minHeight: 520,
      show: false,
      title: "KIRA",
      titleBarStyle: this.inset ? "hiddenInset" : "default",
      // Mittig in der 56 px hohen Kopfzeile des Dashboards.
      ...(this.inset ? { trafficLightPosition: { x: 18, y: 21 } } : {}),
      backgroundColor: "#0b0c0f",
      webPreferences: instanceWebPreferences(),
    });
    this.win = win;
    this.dashboardLoaded = false;

    applyLinkPolicy(win.webContents, {
      isInstanceUrl: (url) => isInstanceUrl(url, this.deps.origins()),
      onChildWindow: (child) => this.deps.onChildWindow(child),
    });

    win.on("close", (event) => {
      if (this.deps.isQuitting()) return;
      event.preventDefault();
      win.hide();
    });
    win.on("closed", () => {
      if (this.win === win) this.win = null;
    });
    const remember = (): void => {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        if (!win.isDestroyed() && !win.isFullScreen() && !win.isMinimized()) this.deps.saveBounds(win.getBounds());
      }, 500);
    };
    win.on("resize", remember);
    win.on("move", remember);

    // Serverseitige Umleitung (Instanz → Access) ist `will-redirect`, ein Klick
    // oder eine Skript-Navigation `will-navigate`. Nur das Hauptdokument zählt.
    const interceptAccess = (event: { preventDefault: () => void; url: string; isMainFrame: boolean }): void => {
      if (!event.isMainFrame || !isAccessLoginUrl(event.url)) return;
      if (this.deps.onAccessRedirect(event.url)) event.preventDefault();
    };
    win.webContents.on("will-redirect", interceptAccess);
    win.webContents.on("will-navigate", interceptAccess);

    win.webContents.on("did-finish-load", () => {
      const url = win.webContents.getURL();
      this.dashboardLoaded = isInstanceUrl(url, this.deps.origins());
      if (this.dashboardLoaded) this.deps.onDashboardLoaded();
    });
    win.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 /* ERR_ABORTED: Navigation ersetzt */) return;
      log.warn("main_load_failed", { code, description, instance: isInstanceUrl(url, this.deps.origins()) });
      this.dashboardLoaded = false;
      this.deps.onLoadFailed(`${description || `Fehler ${code}`}`);
    });
    win.webContents.on("render-process-gone", (_event, details) => {
      log.error("renderer_gone", { reason: details.reason });
      this.dashboardLoaded = false;
    });
    return win;
  }

  show(): void {
    const win = this.create();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  isFocused(): boolean {
    const win = this.window;
    return Boolean(win && win.isFocused() && win.isVisible());
  }

  /** Gehört `sender` zum Hauptfenster mit eingelassener Titelleiste? */
  usesInsetTitleBar(sender: WebContents): boolean {
    const win = this.window;
    return Boolean(this.inset && win && win.webContents === sender);
  }

  isDashboardLoaded(): boolean {
    return this.dashboardLoaded && this.window !== null;
  }

  currentUrl(): string {
    return this.window?.webContents.getURL() ?? "";
  }

  loadInstance(origin: string, path = "/"): void {
    const win = this.create();
    this.dashboardLoaded = false;
    void win.loadURL(`${origin}${path.startsWith("/") ? path : `/${path}`}`).catch((err: unknown) => {
      log.warn("main_loadurl_rejected", { error: err instanceof Error ? err.message : String(err) });
    });
  }

  showOffline(reason: string, lastOnlineAt: number | null = null): void {
    const win = this.create();
    this.dashboardLoaded = false;
    const query: Record<string, string> = { reason };
    if (lastOnlineAt) query.lastSeen = String(lastOnlineAt);
    void win.loadURL(localPageUrl("offline", query)).catch(() => undefined);
    if (!win.isVisible()) win.once("ready-to-show", () => win.show());
  }

  /** „Im Browser anmelden“ (Cloudflare Access) statt der Access-Seite im Fenster. */
  showAccessLogin(origin: string, error: string | null = null): void {
    const win = this.create();
    this.dashboardLoaded = false;
    const query: Record<string, string> = { mode: "access", origin };
    if (error) query.error = error;
    // Nicht mitten in will-redirect neu laden – erst nach dem Abbruch.
    setTimeout(() => {
      if (win.isDestroyed()) return;
      void win.loadURL(localPageUrl("offline", query)).catch(() => undefined);
    }, 0);
  }

  /** Ereignis an eine lokale Seite im Hauptfenster (Offline-Seite). */
  sendLocal(event: LocalEvent): void {
    const win = this.window;
    if (!win || this.dashboardLoaded) return;
    const url = win.webContents.getURL();
    if (url.startsWith("file:") || (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL))) {
      win.webContents.send(LOCAL_IPC.event, event);
    }
  }

  /** Ereignis an das Dashboard; false, wenn gerade keine Instanz-Seite geladen ist. */
  sendNative(event: NativeEvent): boolean {
    const win = this.window;
    if (!win || !this.dashboardLoaded) return false;
    win.webContents.send(IPC.nativeEvent, event);
    return true;
  }

  /** Navigation: ins Dashboard, sonst Instanz mit Pfad laden. */
  navigate(origin: string | null, path: string): void {
    this.show();
    if (this.sendNative({ type: "navigate", url: path })) return;
    if (origin) this.loadInstance(origin, path);
  }

  private fittedBounds(saved: WindowBounds | null): WindowBounds {
    const fallback: WindowBounds = { width: 1280, height: 840 };
    if (!saved) return fallback;
    const display = screen.getDisplayMatching({ x: saved.x ?? 0, y: saved.y ?? 0, width: saved.width, height: saved.height });
    const area = display.workArea;
    const width = Math.min(saved.width, area.width);
    const height = Math.min(saved.height, area.height);
    if (saved.x === undefined || saved.y === undefined) return { width, height };
    const x = Math.max(area.x, Math.min(saved.x, area.x + area.width - width));
    const y = Math.max(area.y, Math.min(saved.y, area.y + area.height - height));
    return { x, y, width, height };
  }
}

// Auto-Update über GitHub Releases (electron-updater, Provider aus
// electron-builder.yml → app-update.yml). Prüfung 30 s nach dem Start und
// alle 6 h, Menüpunkt für die Prüfung von Hand, Hinweis bei fertigem Download,
// Installation beim Beenden.
//
// Owner-Fund 02.10.2026: Nach dem Download sah man nur kurz eine Mitteilung,
// dann nichts mehr; jeder Klick auf „Nach Updates suchen“ stieß den laufenden
// Download neu an. Jetzt: von Hand geprüft → Rückfrage „Jetzt neu starten“,
// sobald das Update bereit ist; währenddessen zeigt die Prüfung nur den
// Fortschritt. Dauerhaft sichtbar machen es Menüleiste (Punkt + Menüeintrag)
// und Schnellfenster (Hinweis) – siehe index.ts.

import { EventEmitter } from "node:events";

import { Notification, app, dialog } from "electron";
import { autoUpdater } from "electron-updater";

import { type UpdateState } from "../shared/local-api";
import { scoped } from "./log";

const log = scoped("updater");

export const FIRST_CHECK_DELAY_MS = 30_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface UpdaterEvents {
  state: [UpdateState];
}

export class Updater extends EventEmitter<UpdaterEvents> {
  private current: UpdateState = { status: "idle", version: null, message: null, progress: null };
  private timer: NodeJS.Timeout | null = null;
  private interval: NodeJS.Timeout | null = null;
  private wired = false;
  /** Von Hand geprüft: beim fertigen Download direkt fragen, ob neu gestartet werden soll. */
  private manualRequested = false;
  /** Referenz halten – sonst räumt der GC die Mitteilung samt Klick-Handler ab. */
  private readyNotice: Notification | null = null;
  /** Vor dem Installieren: die App auf „wird beendet“ stellen (index.ts). */
  private beforeInstall: (() => void) | null = null;

  /**
   * Live-Befund 02.10.2026: „Jetzt neu starten“ startete nicht neu – KIRA
   * verschwand nur, das Menüleisten-Symbol blieb. `quitAndInstall` schließt
   * zuerst alle Fenster und beendet die App erst danach; das Hauptfenster
   * fängt „Schließen“ aber ab (Ausblenden, Menüleisten-App), solange die App
   * nicht weiß, dass sie beendet wird – `before-quit` kommt hier zu spät.
   */
  setBeforeInstall(fn: () => void): void {
    this.beforeInstall = fn;
  }

  get state(): UpdateState {
    return this.current;
  }

  start(): void {
    if (!app.isPackaged) {
      this.set({ status: "unsupported", message: "Updates gibt es nur in der gepackten App (DMG).", version: null, progress: null });
      return;
    }
    this.wire();
    this.timer = setTimeout(() => void this.check(false), FIRST_CHECK_DELAY_MS);
    this.timer.unref?.();
    this.interval = setInterval(() => void this.check(false), CHECK_INTERVAL_MS);
    this.interval.unref?.();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.interval) clearInterval(this.interval);
    this.timer = null;
    this.interval = null;
  }

  /** Prüfung; `manual` zeigt dem Menschen ein Ergebnis auch bei „nichts Neues“. */
  async check(manual: boolean): Promise<UpdateState> {
    if (!app.isPackaged) {
      if (manual) {
        await dialog.showMessageBox({ type: "info", message: "Updates gibt es nur in der gepackten App.", buttons: ["OK"] });
      }
      return this.current;
    }
    this.wire();
    // Läuft schon ein Download oder ist er fertig: nicht neu anstoßen.
    if (this.current.status === "downloading") {
      if (manual) {
        this.manualRequested = true;
        const pct = this.current.progress !== null ? ` (${this.current.progress} %)` : "";
        await dialog.showMessageBox({
          type: "info",
          message: `Version ${this.current.version ?? ""} wird gerade geladen${pct}.`,
          detail: "Sobald sie bereit ist, fragt KIRA, ob neu gestartet werden soll. Den Stand siehst du auch in der Menüleiste.",
          buttons: ["OK"],
        });
      }
      return this.current;
    }
    if (this.current.status === "downloaded") {
      if (manual) await this.promptRestart();
      return this.current;
    }
    this.set({ status: "checking", message: "Suche nach Updates…", progress: null });
    try {
      const result = await autoUpdater.checkForUpdates();
      const info = result?.updateInfo;
      if (!result || !info || !result.isUpdateAvailable) {
        this.set({ status: "none", message: `Keine neue Version – ${app.getVersion()} ist aktuell.`, version: null, progress: null });
        if (manual) {
          await dialog.showMessageBox({ type: "info", message: "KIRA ist auf dem neuesten Stand.", detail: `Version ${app.getVersion()}`, buttons: ["OK"] });
        }
      } else if (manual) {
        this.manualRequested = true;
        await dialog.showMessageBox({
          type: "info",
          message: `Version ${info.version} wird geladen.`,
          detail: "Sobald sie bereit ist, fragt KIRA, ob neu gestartet werden soll. Den Stand siehst du auch in der Menüleiste.",
          buttons: ["OK"],
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.set({ status: "error", message: `Update-Prüfung fehlgeschlagen: ${message}`, progress: null });
      if (manual) await dialog.showMessageBox({ type: "warning", message: "Update-Prüfung fehlgeschlagen", detail: message, buttons: ["OK"] });
    }
    return this.current;
  }

  /** Sofort installieren (Menüpunkt, sobald ein Download fertig ist). */
  installNow(): void {
    if (this.current.status !== "downloaded") return;
    log.info("update_install_now", { version: this.current.version });
    this.beforeInstall?.();
    autoUpdater.quitAndInstall();
  }

  /** „KIRA x.y.z ist bereit – Jetzt neu starten / Später“. */
  private async promptRestart(): Promise<void> {
    const version = this.current.version ?? "";
    const r = await dialog.showMessageBox({
      type: "info",
      message: `KIRA ${version} ist bereit.`,
      detail: "Jetzt neu starten, um das Update zu installieren? Sonst wird es beim nächsten Beenden installiert.",
      buttons: ["Jetzt neu starten", "Später"],
      defaultId: 0,
      cancelId: 1,
    });
    if (r.response === 0) this.installNow();
  }

  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    autoUpdater.logger = null;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.on("checking-for-update", () => this.set({ status: "checking", message: "Suche nach Updates…", progress: null }));
    autoUpdater.on("update-available", (info) =>
      this.set({ status: "downloading", version: info.version, message: `Version ${info.version} wird geladen…`, progress: 0 }),
    );
    autoUpdater.on("update-not-available", () =>
      this.set({ status: "none", version: null, message: `Keine neue Version – ${app.getVersion()} ist aktuell.`, progress: null }),
    );
    autoUpdater.on("download-progress", (p) => this.set({ status: "downloading", progress: Math.round(p.percent) }));
    autoUpdater.on("update-downloaded", (info) => {
      this.set({ status: "downloaded", version: info.version, message: `Version ${info.version} ist bereit und wird beim Beenden installiert.`, progress: 100 });
      if (Notification.isSupported()) {
        const n = new Notification({
          title: `KIRA ${info.version} ist bereit`,
          body: "Neu starten, um das Update zu installieren – oder es kommt beim nächsten Beenden.",
          actions: [{ type: "button", text: "Neu starten" }],
          closeButtonText: "Später",
        });
        n.on("click", () => this.installNow());
        n.on("action", () => this.installNow());
        this.readyNotice = n;
        n.show();
      }
      if (this.manualRequested) {
        this.manualRequested = false;
        void this.promptRestart();
      }
    });
    autoUpdater.on("error", (err) => {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("update_error", { error: message });
      this.set({ status: "error", message: `Update fehlgeschlagen: ${message}`, progress: null });
    });
  }

  private set(patch: Partial<UpdateState>): void {
    const before = this.current;
    this.current = { ...this.current, ...patch };
    // Nur Statuswechsel protokollieren – der Fortschritt kommt beim Laden jede Sekunde.
    if (before.status !== this.current.status || before.version !== this.current.version) {
      log.info("update_state", { status: this.current.status, version: this.current.version });
    }
    this.emit("state", this.current);
  }
}

export const updater = new Updater();

// Auto-Update über GitHub Releases (electron-updater, Provider aus
// electron-builder.yml → app-update.yml). Prüfung 30 s nach dem Start und
// alle 6 h, Menüpunkt für die Prüfung von Hand, Hinweis bei fertigem Download,
// Installation beim Beenden.

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
        await dialog.showMessageBox({
          type: "info",
          message: `Version ${info.version} wird geladen.`,
          detail: "Die Installation erfolgt beim nächsten Beenden von KIRA.",
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
    autoUpdater.quitAndInstall();
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
          title: "KIRA-Update bereit",
          body: `Version ${info.version} wird beim nächsten Beenden installiert. Klicken, um jetzt neu zu starten.`,
        });
        n.on("click", () => autoUpdater.quitAndInstall());
        n.show();
      }
    });
    autoUpdater.on("error", (err) => {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("update_error", { error: message });
      this.set({ status: "error", message: `Update fehlgeschlagen: ${message}`, progress: null });
    });
  }

  private set(patch: Partial<UpdateState>): void {
    this.current = { ...this.current, ...patch };
    log.info("update_state", { status: this.current.status, version: this.current.version });
    this.emit("state", this.current);
  }
}

export const updater = new Updater();

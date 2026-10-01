// Downloads (Export-Links, `a.download`) → ~/Downloads, Fortschritt in der
// Dock-Leiste, Fertig-Hinweis mit „Im Finder zeigen“.

import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { type BrowserWindow, Notification, type Session as ElectronSession, app, shell } from "electron";

import { scoped } from "./log";

const log = scoped("downloads");

/** Eindeutiger Dateiname: `Bericht.pdf`, `Bericht (2).pdf`, … */
export function uniquePath(dir: string, filename: string): string {
  const ext = extname(filename);
  const stem = basename(filename, ext) || "Download";
  let candidate = join(dir, `${stem}${ext}`);
  let n = 2;
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}

export function installDownloadHandler(session: ElectronSession, progressWindow: () => BrowserWindow | null): void {
  const active = new Map<string, { received: number; total: number }>();
  const updateProgress = (): void => {
    const win = progressWindow();
    if (!win || win.isDestroyed()) return;
    if (active.size === 0) {
      win.setProgressBar(-1);
      return;
    }
    let received = 0;
    let total = 0;
    for (const v of active.values()) {
      received += v.received;
      total += v.total;
    }
    win.setProgressBar(total > 0 ? Math.min(1, received / total) : 2);
  };

  session.on("will-download", (_event, item) => {
    const dir = app.getPath("downloads");
    const target = uniquePath(dir, item.getFilename() || "Download");
    item.setSavePath(target);
    const key = `${Date.now()}-${Math.random()}`;
    active.set(key, { received: 0, total: item.getTotalBytes() });
    log.info("download_started", { bytes: item.getTotalBytes() });
    item.on("updated", (_e, state) => {
      if (state === "progressing") {
        active.set(key, { received: item.getReceivedBytes(), total: item.getTotalBytes() });
        updateProgress();
      }
    });
    item.once("done", (_e, state) => {
      active.delete(key);
      updateProgress();
      if (state === "completed") {
        log.info("download_done");
        app.dock?.downloadFinished(target);
        if (Notification.isSupported()) {
          const n = new Notification({
            title: "Download abgeschlossen",
            body: basename(target),
            actions: [{ type: "button", text: "Im Finder zeigen" }],
          });
          n.on("click", () => shell.showItemInFolder(target));
          n.on("action", () => shell.showItemInFolder(target));
          n.show();
        }
      } else if (state !== "cancelled") {
        log.warn("download_failed", { state });
        if (Notification.isSupported()) new Notification({ title: "Download fehlgeschlagen", body: basename(target) }).show();
      }
    });
  });
}

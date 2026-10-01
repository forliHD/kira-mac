// Gemeinsame Fensterfabrik: WebPreferences für Instanz-Seiten (Preload mit
// `window.KiraNative`) und für lokale Seiten (Preload mit `window.KiraLocal`).
// Der Instanz-Preload wird NUR an Fenster gehängt, die die Instanz laden;
// zusätzlich prüft er selbst die Origin (src/preload/index.ts).

import { BrowserWindow, type BrowserWindowConstructorOptions, type WebPreferences } from "electron";

import { type LocalEvent } from "../../shared/local-api";
import { LOCAL_IPC } from "../../shared/ipc-local";
import { localPageUrl, preloadPath } from "../paths";

export function instanceWebPreferences(): WebPreferences {
  return {
    preload: preloadPath("index"),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
    spellcheck: true,
  };
}

export function localWebPreferences(): WebPreferences {
  return {
    preload: preloadPath("local"),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
    spellcheck: false,
  };
}

export type LocalPage = "onboarding" | "settings" | "hud" | "offline";

/** Ein Einzelfenster für eine lokale Seite (Einstellungen, Onboarding). */
export class LocalWindowController {
  private win: BrowserWindow | null = null;
  private readonly page: LocalPage;
  private readonly options: BrowserWindowConstructorOptions;

  constructor(page: LocalPage, options: BrowserWindowConstructorOptions) {
    this.page = page;
    this.options = options;
  }

  get window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  show(query: Record<string, string> = {}): BrowserWindow {
    const existing = this.window;
    if (existing) {
      existing.show();
      existing.focus();
      return existing;
    }
    const win = new BrowserWindow({
      show: false,
      ...this.options,
      webPreferences: { ...localWebPreferences(), ...(this.options.webPreferences ?? {}) },
    });
    win.setMenuBarVisibility(false);
    win.once("ready-to-show", () => win.show());
    win.on("closed", () => {
      if (this.win === win) this.win = null;
    });
    void win.loadURL(localPageUrl(this.page, query));
    this.win = win;
    return win;
  }

  close(): void {
    this.window?.close();
  }

  send(event: LocalEvent): void {
    const win = this.window;
    if (!win) return;
    win.webContents.send(LOCAL_IPC.event, event);
  }
}

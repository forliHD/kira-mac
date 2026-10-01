// Schnellfenster: rahmenlos, Vibrancy, lädt `/chat` der Instanz in einem
// zweiten BrowserWindow mit dem Instanz-Preload (kein lokaler Rahmen nötig).
// Hotkey schaltet um; Fokusverlust blendet es aus.

import { BrowserWindow, screen } from "electron";

import { isInstanceUrl } from "../instance";
import { applyLinkPolicy } from "../links";
import { scoped } from "../log";
import { instanceWebPreferences } from "./common";

const log = scoped("quick-window");

export interface QuickWindowDeps {
  origin: () => string | null;
  origins: () => string[];
  onChildWindow: (win: BrowserWindow) => void;
  onNeedsInstance: () => void;
}

const WIDTH = 560;
const HEIGHT = 680;

export class QuickWindowController {
  private win: BrowserWindow | null = null;
  private loadedOrigin: string | null = null;
  private readonly deps: QuickWindowDeps;

  constructor(deps: QuickWindowDeps) {
    this.deps = deps;
  }

  get window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  toggle(): void {
    const win = this.window;
    if (win && win.isVisible() && win.isFocused()) {
      win.hide();
      return;
    }
    this.show();
  }

  show(): void {
    const origin = this.deps.origin();
    if (!origin) {
      this.deps.onNeedsInstance();
      return;
    }
    const win = this.create();
    if (this.loadedOrigin !== origin) {
      this.loadedOrigin = origin;
      void win.loadURL(`${origin}/chat`).catch((err: unknown) => log.warn("quick_load_failed", { error: err instanceof Error ? err.message : String(err) }));
    }
    this.position(win);
    win.show();
    win.focus();
  }

  hide(): void {
    this.window?.hide();
  }

  /** Nach einem Instanzwechsel wird beim nächsten Öffnen neu geladen. */
  invalidate(): void {
    this.loadedOrigin = null;
  }

  private create(): BrowserWindow {
    const existing = this.window;
    if (existing) return existing;
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      vibrancy: "under-window",
      visualEffectState: "active",
      roundedCorners: true,
      hasShadow: true,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: "KIRA – Schnellfenster",
      backgroundColor: "#00000000",
      webPreferences: instanceWebPreferences(),
    });
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    applyLinkPolicy(win.webContents, {
      isInstanceUrl: (url) => isInstanceUrl(url, this.deps.origins()),
      onChildWindow: (child) => this.deps.onChildWindow(child),
    });
    win.on("blur", () => {
      if (!win.isDestroyed() && !win.webContents.isDevToolsOpened()) win.hide();
    });
    win.on("closed", () => {
      if (this.win === win) this.win = null;
      this.loadedOrigin = null;
    });
    this.win = win;
    return win;
  }

  private position(win: BrowserWindow): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    const [w, h] = win.getSize();
    const x = Math.round(area.x + (area.width - (w ?? WIDTH)) / 2);
    const y = Math.round(area.y + Math.max(40, (area.height - (h ?? HEIGHT)) / 3));
    win.setPosition(x, y, false);
  }
}

// HUD des globalen Diktats: kleines, immer sichtbares Fenster ohne Fokus
// (Panel), unten mittig auf dem Bildschirm mit dem Mauszeiger. Zeigt Pegel,
// flüchtigen Text, Zielprogramm und einen Stopp-Knopf.

import { BrowserWindow, screen } from "electron";

import { LOCAL_IPC } from "../../shared/ipc-local";
import { type HudState } from "../../shared/local-api";
import { localPageUrl } from "../paths";
import { localWebPreferences } from "./common";

const WIDTH = 420;
const HEIGHT = 120;

export class HudWindowController {
  private win: BrowserWindow | null = null;
  private lastState: HudState | null = null;
  private ready = false;

  get window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  show(): void {
    const win = this.create();
    this.position(win);
    win.showInactive();
  }

  hide(): void {
    this.window?.hide();
  }

  update(state: HudState): void {
    this.lastState = state;
    const win = this.window;
    if (!win || !this.ready) return;
    win.webContents.send(LOCAL_IPC.event, { type: "hud", hud: state });
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
      vibrancy: "hud",
      visualEffectState: "active",
      roundedCorners: true,
      hasShadow: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      type: "panel",
      title: "KIRA – Diktat",
      backgroundColor: "#00000000",
      webPreferences: localWebPreferences(),
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.webContents.on("did-finish-load", () => {
      this.ready = true;
      if (this.lastState) this.update(this.lastState);
    });
    win.on("closed", () => {
      if (this.win === win) this.win = null;
      this.ready = false;
    });
    void win.loadURL(localPageUrl("hud"));
    this.win = win;
    return win;
  }

  private position(win: BrowserWindow): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    const x = Math.round(area.x + (area.width - WIDTH) / 2);
    const y = Math.round(area.y + area.height - HEIGHT - 24);
    win.setPosition(x, y, false);
  }
}

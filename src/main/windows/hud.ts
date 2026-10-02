// HUD des globalen Diktats: Glas-Pille ohne Fokus (Panel), unten mittig auf
// dem Bildschirm mit dem Mauszeiger – wie das macOS-Diktat. Zeigt Pegel,
// flüchtigen Text, Zielprogramm und einen Stopp-Knopf. Echtes Liquid Glass
// (macOS 26+) bzw. Vibrancy „hud“ als Rückfall (src/main/glass.ts).

import { BrowserWindow, nativeTheme, screen } from "electron";

import { LOCAL_IPC } from "../../shared/ipc-local";
import { type HudState } from "../../shared/local-api";
import { applyGlass } from "../glass";
import { localPageUrl } from "../paths";
import { localWebPreferences, openLocalLink } from "./common";
import { guardLocalPage } from "./local-guard";

const WIDTH = 560;
const HEIGHT = 76;
const RADIUS = 24;

export class HudWindowController {
  private win: BrowserWindow | null = null;
  private lastState: HudState | null = null;
  private ready = false;

  constructor() {
    // Glas-Tönung hängt am Erscheinungsbild; bei einem Wechsel neu aufbauen.
    nativeTheme.on("updated", () => {
      const win = this.window;
      this.win = null;
      this.ready = false;
      win?.destroy();
    });
  }

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
    applyGlass(win, { cornerRadius: RADIUS, fallback: "hud" });
    guardLocalPage(win.webContents, (url) => openLocalLink(url));
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
    const y = Math.round(area.y + area.height - HEIGHT - 28);
    win.setPosition(x, y, false);
  }
}

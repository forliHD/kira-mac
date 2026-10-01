// Schnellfenster: schwebendes, rahmenloses Panel mit echtem Liquid Glass
// (bzw. Vibrancy) wie Spotlight – lädt die lokale Seite `quick`, die über
// `window.KiraLocal` mit src/main/quick-chat.ts spricht. Das Panel aktiviert
// die App nicht (NSWindowStyleMaskNonactivatingPanel), das vorderste Programm
// bleibt vorne. Fokusverlust und Esc blenden es aus. Die Höhe wächst mit dem
// Inhalt (`quickResize`), die Oberkante bleibt stehen.

import { BrowserWindow, nativeTheme, screen } from "electron";

import { LOCAL_IPC } from "../../shared/ipc-local";
import { type LocalEvent } from "../../shared/local-api";
import { applyGlass } from "../glass";
import { scoped } from "../log";
import { localPageUrl } from "../paths";
import { localWebPreferences } from "./common";

const log = scoped("quick-window");

export const QUICK_WIDTH = 680;
const MIN_HEIGHT = 132;
const INITIAL_HEIGHT = 168;
const MAX_SCREEN_SHARE = 0.75;
export const QUICK_RADIUS = 26;

export interface QuickWindowDeps {
  /** Darf das Fenster aufgehen? (sonst z. B. Einrichtung zeigen) */
  canShow: () => boolean;
  onShown?: () => void;
}

export class QuickWindowController {
  private win: BrowserWindow | null = null;
  private ready = false;
  private queued: LocalEvent[] = [];
  private readonly deps: QuickWindowDeps;
  private anchorTop: number | null = null;

  constructor(deps: QuickWindowDeps) {
    this.deps = deps;
    // Glas-Tönung hängt am Erscheinungsbild; bei einem Wechsel neu aufbauen.
    nativeTheme.on("updated", () => this.destroy());
  }

  get window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  isVisible(): boolean {
    return Boolean(this.window?.isVisible());
  }

  isFocused(): boolean {
    const win = this.window;
    return Boolean(win && win.isVisible() && win.isFocused());
  }

  toggle(): void {
    if (this.isFocused()) {
      this.hide();
      return;
    }
    this.show();
  }

  show(): void {
    if (!this.deps.canShow()) return;
    const win = this.create();
    this.position(win);
    win.show();
    win.focus();
    this.send({ type: "quick-shown" });
    this.deps.onShown?.();
  }

  hide(): void {
    this.window?.hide();
  }

  /** Gewünschte Inhaltshöhe der Seite; begrenzt auf den Bildschirm, Oberkante fest. */
  resize(contentHeight: number): void {
    const win = this.window;
    if (!win) return;
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const max = Math.round(area.height * MAX_SCREEN_SHARE);
    const height = Math.max(MIN_HEIGHT, Math.min(max, Math.ceil(contentHeight)));
    const bounds = win.getBounds();
    if (Math.abs(bounds.height - height) < 2) return;
    const top = this.anchorTop ?? bounds.y;
    win.setBounds({ x: bounds.x, y: top, width: QUICK_WIDTH, height }, process.platform === "darwin");
  }

  send(event: LocalEvent): void {
    const win = this.window;
    if (!win || !this.ready) {
      // Nur das Neueste je Art behalten (Zustand ersetzt Zustand); Einfügungen alle.
      this.queued = [...this.queued.filter((e) => e.type !== event.type || event.type === "quick-insert"), event];
      return;
    }
    win.webContents.send(LOCAL_IPC.event, event);
  }

  destroy(): void {
    const win = this.window;
    this.win = null;
    this.ready = false;
    if (win) win.destroy();
  }

  private create(): BrowserWindow {
    const existing = this.window;
    if (existing) return existing;
    const win = new BrowserWindow({
      width: QUICK_WIDTH,
      height: INITIAL_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      // Panel: schwebt auch über Vollbild-Apps, erscheint auf allen Spaces und
      // nimmt Tastatureingaben an, ohne die App nach vorne zu holen.
      type: "panel",
      title: "KIRA – Schnellfenster",
      webPreferences: localWebPreferences(),
    });
    win.setAlwaysOnTop(true, "floating");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    applyGlass(win, { cornerRadius: QUICK_RADIUS, fallback: "hud" });
    win.on("blur", () => {
      if (!win.isDestroyed() && !win.webContents.isDevToolsOpened()) win.hide();
    });
    win.on("closed", () => {
      if (this.win === win) {
        this.win = null;
        this.ready = false;
      }
    });
    win.webContents.on("did-finish-load", () => {
      this.ready = true;
      const queued = this.queued;
      this.queued = [];
      for (const e of queued) win.webContents.send(LOCAL_IPC.event, e);
    });
    win.webContents.on("render-process-gone", (_event, details) => {
      log.error("quick_renderer_gone", { reason: details.reason });
      this.destroy();
    });
    void win.loadURL(localPageUrl("quick")).catch((err: unknown) => log.warn("quick_load_failed", { error: err instanceof Error ? err.message : String(err) }));
    this.win = win;
    return win;
  }

  private position(win: BrowserWindow): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    const [, h] = win.getSize();
    const x = Math.round(area.x + (area.width - QUICK_WIDTH) / 2);
    // Wie Spotlight: oberes Fünftel, damit Platz zum Wachsen nach unten bleibt.
    const y = Math.round(area.y + Math.max(48, area.height * 0.18));
    this.anchorTop = y;
    win.setBounds({ x, y, width: QUICK_WIDTH, height: h ?? INITIAL_HEIGHT }, false);
  }
}

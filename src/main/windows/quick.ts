// Schnellfenster: schwebendes, rahmenloses Panel mit echtem Liquid Glass
// (bzw. Vibrancy) wie Spotlight – lädt die lokale Seite `quick`, die über
// `window.KiraLocal` mit src/main/quick-chat.ts spricht. Das Panel aktiviert
// die App nicht (NSWindowStyleMaskNonactivatingPanel), das vorderste Programm
// bleibt vorne. Fokusverlust und Esc blenden es aus. Die Höhe wächst mit dem
// Inhalt (`quickResize`), die Oberkante bleibt stehen. Lage und größte Höhe:
// src/main/windows/quick-geometry.ts.

import { BrowserWindow, nativeTheme, screen } from "electron";

import { LOCAL_IPC } from "../../shared/ipc-local";
import { type LocalEvent } from "../../shared/local-api";
import { applyGlass } from "../glass";
import { scoped } from "../log";
import { localPageUrl } from "../paths";
import { localWebPreferences, openLocalLink } from "./common";
import { guardLocalPage } from "./local-guard";
import { QUICK_WIDTH, quickHeight, quickLeft, quickTop } from "./quick-geometry";

const log = scoped("quick-window");

const INITIAL_HEIGHT = 168;
export const QUICK_RADIUS = 26;

export interface QuickWindowDeps {
  /** Darf das Fenster aufgehen? (sonst z. B. Einrichtung zeigen) */
  canShow: () => boolean;
  onShown?: () => void;
  /** Nur Ende-zu-Ende-Tests: bei Fokusverlust stehen bleiben (sonst kein Bild). */
  keepOnBlur?: boolean;
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

  /** Gewünschte Inhaltshöhe der Seite; begrenzt auf den Platz bis unten, Oberkante fest. */
  resize(contentHeight: number): void {
    const win = this.window;
    if (!win) return;
    const bounds = win.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const top = this.anchorTop ?? bounds.y;
    const height = quickHeight(area, top, contentHeight);
    if (Math.abs(bounds.height - height) < 2) return;
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
    // Live-Befund 02.10.2026: Ohne skipTransformProcessType machte der erste
    // Aufruf nach dem Start aus KIRA ein Hintergrundprogramm (kein Dock, kein
    // ⌘-Tab) – das Hauptfenster verschwand hinter den anderen Programmen. Das
    // Panel schwebt auch so über Vollbild-Apps (tests/panel-windows.test.ts).
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    applyGlass(win, { cornerRadius: QUICK_RADIUS, fallback: "hud" });
    guardLocalPage(win.webContents, (url) => {
      this.hide();
      openLocalLink(url);
    });
    win.on("blur", () => {
      if (this.deps.keepOnBlur) return;
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
    // Oberkante bei 10 % (Owner-Wunsch 02.10.2026, vorher 18 % wie Spotlight);
    // die bisherige Höhe nur, soweit sie auf DIESEN Bildschirm passt.
    const y = quickTop(area);
    this.anchorTop = y;
    win.setBounds({ x: quickLeft(area), y, width: QUICK_WIDTH, height: quickHeight(area, y, h ?? INITIAL_HEIGHT) }, false);
  }
}

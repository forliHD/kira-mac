// Schnellfenster: schwebendes, rahmenloses Panel mit echtem Liquid Glass
// (bzw. Vibrancy) wie Spotlight – lädt die lokale Seite `quick`, die über
// `window.KiraLocal` mit src/main/quick-chat.ts spricht. Das Panel aktiviert
// die App nicht (NSWindowStyleMaskNonactivatingPanel), das vorderste Programm
// bleibt vorne. Fokusverlust und Esc blenden es aus.
//
// Zwei Stufen (Phase 3, 0.5.0): Die Leiste (Stufe A) wächst mit dem Inhalt
// (`resize`), die Oberkante bleibt stehen. Das Gespräch und die Diktate
// (Stufe B, `setTall(true)`) nehmen EINMAL die Gesprächshöhe an
// (quick-geometry.ts: Anteil der Arbeitsfläche oder die zuletzt gezogene
// Höhe dieses Bildschirms); danach ändert sich die Höhe nur noch durch
// Ziehen am unteren Rand – andere Kanten lehnt `will-resize` ab.

import { BrowserWindow, nativeTheme, screen } from "electron";

import { LOCAL_IPC } from "../../shared/ipc-local";
import { type LocalEvent, type QuickConfig } from "../../shared/local-api";
import { applyGlass } from "../glass";
import { scoped } from "../log";
import { localPageUrl } from "../paths";
import { localWebPreferences, openLocalLink } from "./common";
import { guardLocalPage } from "./local-guard";
import { QUICK_MIN_HEIGHT, QUICK_TALL_MIN, QUICK_WIDTH, displayKey, quickHeight, quickLeft, quickMaxHeight, quickTallHeight, quickTop } from "./quick-geometry";

const log = scoped("quick-window");

const INITIAL_HEIGHT = 168;
export const QUICK_RADIUS = 26;

export interface QuickWindowDeps {
  /** Darf das Fenster aufgehen? (sonst z. B. Einrichtung zeigen) */
  canShow: () => boolean;
  onShown?: () => void;
  /** Nur Ende-zu-Ende-Tests: bei Fokusverlust stehen bleiben (sonst kein Bild). */
  keepOnBlur?: boolean;
  /** Einstellungen des Schnellfensters (Lage, Gesprächshöhe, gemerkte Höhen). */
  quick?: () => QuickConfig;
  /** Der Mensch hat die Gesprächshöhe gezogen (nur in Stufe B). */
  onHeightDragged?: (display: string, height: number) => void;
}

const DEFAULT_QUICK: QuickConfig = {
  position: "top",
  chatHeightShare: 0.6,
  rememberHeight: true,
  heights: {},
  textSize: "m",
  sendKey: "enter",
  afterSend: "stay",
  resetAfterMin: 30,
  suggestions: true,
  dictationButton: true,
};

export class QuickWindowController {
  private win: BrowserWindow | null = null;
  private ready = false;
  private queued: LocalEvent[] = [];
  private readonly deps: QuickWindowDeps;
  private anchorTop: number | null = null;
  /** Stufe B (Gespräch/Diktate): feste Gesprächshöhe, unten ziehbar. */
  private tall = false;
  /** Zuletzt vom Inhalt gewünschte Höhe (Stufe A), für den Rückweg aus Stufe B. */
  private barHeight = INITIAL_HEIGHT;
  /** Eigene setBounds-Aufrufe lösen `resized` aus – die zählen nicht als Ziehen. */
  private settingBounds = false;

  constructor(deps: QuickWindowDeps) {
    this.deps = deps;
    // Glas-Tönung hängt am Erscheinungsbild; bei einem Wechsel neu aufbauen.
    nativeTheme.on("updated", () => this.destroy());
  }

  get window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  get isTall(): boolean {
    return this.tall;
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

  private quick(): QuickConfig {
    return this.deps.quick?.() ?? DEFAULT_QUICK;
  }

  /** Gewünschte Inhaltshöhe der Seite (Stufe A); in Stufe B ohne Wirkung. */
  resize(contentHeight: number): void {
    this.barHeight = contentHeight;
    if (this.tall) return;
    const win = this.window;
    if (!win) return;
    const bounds = win.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const top = this.anchorTop ?? bounds.y;
    const height = quickHeight(area, top, contentHeight);
    if (Math.abs(bounds.height - height) < 2) return;
    this.setBounds(win, { x: bounds.x, y: this.topFor(area, height), width: QUICK_WIDTH, height }, true);
  }

  /** Stufe wechseln: B = Gesprächshöhe und unten ziehbar, A = Leiste folgt dem Inhalt. */
  setTall(tall: boolean): void {
    if (this.tall === tall) return;
    this.tall = tall;
    const win = this.window;
    if (!win) return;
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const area = display.workArea;
    const top = this.anchorTop ?? bounds.y;
    if (tall) {
      const height = this.tallHeight(display, top);
      this.applyResizable(win, area, top);
      this.setBounds(win, { x: bounds.x, y: this.topFor(area, height), width: QUICK_WIDTH, height }, true);
    } else {
      this.applyFixed(win, area, top);
      const height = quickHeight(area, top, this.barHeight);
      this.setBounds(win, { x: bounds.x, y: this.topFor(area, height), width: QUICK_WIDTH, height }, true);
    }
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

  private tallHeight(display: Electron.Display, top: number): number {
    const q = this.quick();
    const key = displayKey(display.id, display.workArea);
    const remembered = q.rememberHeight ? (q.heights[key] ?? null) : null;
    return quickTallHeight(display.workArea, top, q.chatHeightShare, remembered);
  }

  /** Oberkante je Lage; bei „oben“ bleibt der Anker stehen. */
  private topFor(area: Electron.Rectangle, height: number): number {
    const q = this.quick();
    if (q.position === "center") return quickTop(area, "center", height);
    return this.anchorTop ?? quickTop(area);
  }

  /** Nur der untere Rand darf gezogen werden; Breite bleibt, Höhe zwischen Mindest- und Platz bis unten. */
  private applyResizable(win: BrowserWindow, area: Electron.Rectangle, top: number): void {
    const max = quickMaxHeight(area, top);
    win.setMinimumSize(QUICK_WIDTH, Math.min(QUICK_TALL_MIN, max));
    win.setMaximumSize(QUICK_WIDTH, Math.max(max, Math.min(QUICK_TALL_MIN, max)));
    win.setResizable(true);
  }

  /**
   * Leiste: nicht ziehbar, Grenzen wieder die der Leiste. Owner-Befund
   * 22.10.2026: `setResizable(false)` allein ließ die Mindesthöhe der Stufe B
   * (QUICK_TALL_MIN) stehen, und `setBounds` hält sich an Mindest- und
   * Höchstgröße – von „Diktate“ zurück zum leeren Chat blieb das Fenster groß.
   */
  private applyFixed(win: BrowserWindow, area: Electron.Rectangle, top: number): void {
    win.setResizable(false);
    win.setMinimumSize(QUICK_WIDTH, QUICK_MIN_HEIGHT);
    win.setMaximumSize(QUICK_WIDTH, quickMaxHeight(area, top));
  }

  private setBounds(win: BrowserWindow, bounds: Electron.Rectangle, animate: boolean): void {
    this.settingBounds = true;
    try {
      win.setBounds(bounds, animate && process.platform === "darwin");
    } finally {
      // `resized` kommt nach der Animation: den Schutz erst danach aufheben.
      setTimeout(() => {
        this.settingBounds = false;
      }, 400).unref?.();
    }
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
    // Nur die Unterkante: alles andere würde die Oberkante oder die Breite ändern.
    win.on("will-resize", (event, _bounds, details) => {
      const edge = (details as { edge?: string } | undefined)?.edge;
      if (!this.tall || (edge && edge !== "bottom")) event.preventDefault();
    });
    win.on("resized", () => {
      if (!this.tall || this.settingBounds || win.isDestroyed()) return;
      const bounds = win.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      this.deps.onHeightDragged?.(displayKey(screen.getDisplayMatching(bounds).id, area), bounds.height);
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
    // Oberkante bei 10 % (Owner-Wunsch 02.10.2026, vorher 18 % wie Spotlight);
    // die bisherige Höhe nur, soweit sie auf DIESEN Bildschirm passt.
    const anchor = quickTop(area);
    this.anchorTop = anchor;
    const height = this.tall ? this.tallHeight(display, anchor) : quickHeight(area, anchor, this.barHeight);
    if (this.tall) this.applyResizable(win, area, anchor);
    else this.applyFixed(win, area, anchor);
    this.setBounds(win, { x: quickLeft(area), y: this.topFor(area, height), width: QUICK_WIDTH, height }, false);
  }
}

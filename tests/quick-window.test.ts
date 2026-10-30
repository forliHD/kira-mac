import { beforeEach, describe, expect, it, vi } from "vitest";

// Zwei Stufen des Schnellfensters (Phase 3, 0.5.0): die Leiste folgt dem
// Inhalt, das Gespräch nimmt einmal die Gesprächshöhe an und lässt nur den
// unteren Rand ziehen; die gezogene Höhe wird je Bildschirm gemeldet.

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

class FakeWebContents {
  on(): this {
    return this;
  }
  send(): void {}
  isDevToolsOpened(): boolean {
    return false;
  }
}

class FakeWindow {
  static instances: FakeWindow[] = [];
  webContents = new FakeWebContents();
  bounds: Bounds = { x: 0, y: 0, width: 680, height: 168 };
  boundsCalls: Array<{ bounds: Bounds; animate: boolean | undefined }> = [];
  resizable = false;
  min: number[] | null = null;
  max: number[] | null = null;
  handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  constructor() {
    FakeWindow.instances.push(this);
  }
  setVisibleOnAllWorkspaces(): void {}
  setAlwaysOnTop(): void {}
  on(event: string, fn: (...args: unknown[]) => void): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
    return this;
  }
  fire(event: string, ...args: unknown[]): void {
    for (const fn of this.handlers.get(event) ?? []) fn(...args);
  }
  loadURL(): Promise<void> {
    return Promise.resolve();
  }
  isDestroyed(): boolean {
    return false;
  }
  getSize(): number[] {
    return [this.bounds.width, this.bounds.height];
  }
  getBounds(): Bounds {
    return { ...this.bounds };
  }
  /** Wie Electron (NativeWindowMac::SetBounds): die Größe hält Mindest- und Höchstgröße ein (0 = ohne Grenze). */
  setBounds(bounds: Bounds, animate?: boolean): void {
    let { width, height } = bounds;
    if (this.min) {
      width = Math.max(width, this.min[0]!);
      height = Math.max(height, this.min[1]!);
    }
    if (this.max) {
      if (this.max[0]) width = Math.min(width, this.max[0]);
      if (this.max[1]) height = Math.min(height, this.max[1]);
    }
    bounds = { ...bounds, width, height };
    this.bounds = { ...bounds };
    this.boundsCalls.push({ bounds: { ...bounds }, animate });
  }
  setResizable(v: boolean): void {
    this.resizable = v;
  }
  setMinimumSize(w: number, h: number): void {
    this.min = [w, h];
  }
  setMaximumSize(w: number, h: number): void {
    this.max = [w, h];
  }
  show(): void {}
  focus(): void {}
  hide(): void {}
  isVisible(): boolean {
    return true;
  }
  isFocused(): boolean {
    return false;
  }
  destroy(): void {}
}

// MacBook Pro 16: Arbeitsfläche 1728 × 1080 unter der Menüleiste.
const display = { id: 7, workArea: { x: 0, y: 37, width: 1728, height: 1080 } };
vi.mock("electron", () => ({
  BrowserWindow: FakeWindow,
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
  screen: {
    getCursorScreenPoint: () => ({ x: 10, y: 10 }),
    getDisplayNearestPoint: () => display,
    getDisplayMatching: () => display,
  },
}));
vi.mock("../src/main/log", () => ({ scoped: () => ({ debug() {}, info() {}, warn() {}, error() {} }) }));
vi.mock("../src/main/glass", () => ({ applyGlass: vi.fn() }));
vi.mock("../src/main/paths", () => ({ localPageUrl: (page: string) => `kira-local://${page}`, preloadPath: (name: string) => `/preload/${name}.js` }));
vi.mock("../src/main/windows/local-guard", () => ({ guardLocalPage: vi.fn() }));

const { QuickWindowController } = await import("../src/main/windows/quick");
const { quickTop, quickMaxHeight } = await import("../src/main/windows/quick-geometry");
type QuickConfig = import("../src/shared/local-api").QuickConfig;
type Deps = ConstructorParameters<typeof QuickWindowController>[0];

const TOP = quickTop(display.workArea); // 37 + 108 = 145
const MAX = quickMaxHeight(display.workArea, TOP);

function build(overrides: Partial<Deps> = {}) {
  const dragged: Array<{ display: string; height: number }> = [];
  let quick: QuickConfig = { position: "top", chatHeightShare: 0.6, rememberHeight: true, heights: {}, textSize: "m", sendKey: "enter", afterSend: "stay", resetAfterMin: 30, suggestions: true, dictationButton: true };
  const controller = new QuickWindowController({
    canShow: () => true,
    quick: () => quick,
    onHeightDragged: (d, h) => dragged.push({ display: d, height: h }),
    ...overrides,
  });
  return { controller, dragged, setQuick: (patch: Partial<QuickConfig>) => void (quick = { ...quick, ...patch }), win: () => FakeWindow.instances[FakeWindow.instances.length - 1]! };
}

describe("Schnellfenster: zwei Stufen", () => {
  beforeEach(() => {
    FakeWindow.instances.length = 0;
  });

  it("Leiste: Oberkante bei 10 %, Höhe folgt dem Inhalt, nicht ziehbar", () => {
    const { controller, win } = build();
    controller.show();
    const w = win();
    expect(w.bounds).toEqual({ x: (1728 - 680) / 2, y: TOP, width: 680, height: 168 });
    expect(w.resizable).toBe(false);
    controller.resize(240.4);
    expect(w.bounds.height).toBe(241);
    expect(w.bounds.y).toBe(TOP);
    controller.resize(241.2); // unter 2 px: keine neue Größe
    expect(w.boundsCalls).toHaveLength(2);
  });

  it("Gespräch: einmal auf 60 % der Arbeitsfläche, unten ziehbar, Inhalt ändert die Höhe nicht mehr", () => {
    const { controller, win } = build();
    controller.show();
    const w = win();
    controller.setTall(true);
    expect(controller.isTall).toBe(true);
    expect(w.bounds).toMatchObject({ y: TOP, height: 648 });
    expect(w.boundsCalls.at(-1)?.animate).toBe(process.platform === "darwin");
    expect(w.resizable).toBe(true);
    expect(w.min).toEqual([680, 420]);
    expect(w.max).toEqual([680, MAX]);
    const calls = w.boundsCalls.length;
    controller.resize(900);
    expect(w.boundsCalls).toHaveLength(calls);
    controller.setTall(true); // schon hoch: nichts
    expect(w.boundsCalls).toHaveLength(calls);
    controller.setTall(false);
    expect(w.resizable).toBe(false);
    expect(w.bounds.height).toBe(900); // zuletzt gemeldete Inhaltshöhe der Leiste
  });

  it("zurück in die Leiste (Diktate → leerer Chat): Mindesthöhe der Gesprächsstufe fällt, das Fenster schrumpft", () => {
    // Owner-Befund 22.10.2026: setResizable(false) allein ließ die Mindesthöhe
    // 420 stehen, setBounds blieb daran hängen – das Fenster blieb groß.
    const { controller, win } = build();
    controller.show();
    const w = win();
    controller.resize(176); // leerer Chat: Leiste mit Vorschlägen
    controller.setTall(true); // ⌘2 Diktate
    expect(w.bounds.height).toBe(648);
    controller.setTall(false); // ⌘1 Chat, noch keine Nachricht
    expect(w.bounds.height).toBe(176);
    expect(w.min).toEqual([680, 132]);
    expect(w.max).toEqual([680, MAX]);
    // Die frische Messung der Leiste darf auch kleiner werden.
    controller.resize(150);
    expect(w.bounds.height).toBe(150);
    // Auch beim nächsten Öffnen gelten die Grenzen der Leiste.
    controller.show();
    expect(w.min).toEqual([680, 132]);
    expect(w.bounds.height).toBe(150);
  });

  it("gemerkte Höhe des Bildschirms gewinnt, Ziehen am unteren Rand meldet sie, andere Kanten sind gesperrt", () => {
    const { controller, win, dragged, setQuick } = build();
    setQuick({ heights: { d7: 700 } });
    controller.show();
    const w = win();
    controller.setTall(true);
    expect(w.bounds.height).toBe(700);
    const top = { preventDefault: vi.fn() };
    w.fire("will-resize", top, w.bounds, { edge: "top" });
    expect(top.preventDefault).toHaveBeenCalled();
    const bottom = { preventDefault: vi.fn() };
    w.fire("will-resize", bottom, w.bounds, { edge: "bottom" });
    expect(bottom.preventDefault).not.toHaveBeenCalled();
    // Das eigene setBounds zählt nicht als Ziehen (Schutzfrist läuft) …
    w.fire("resized");
    expect(dragged).toEqual([]);
    // … aber ein echtes Ziehen nach der Frist schon.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        w.bounds = { ...w.bounds, height: 760 };
        w.fire("resized");
        expect(dragged).toEqual([{ display: "d7", height: 760 }]);
        controller.setTall(false);
        const blocked = { preventDefault: vi.fn() };
        w.fire("will-resize", blocked, w.bounds, { edge: "bottom" });
        expect(blocked.preventDefault).toHaveBeenCalled(); // in der Leiste nie ziehen
        resolve();
      }, 450);
    });
  }, 5_000);

  it("Lage „mittig“: das Fenster sitzt seiner Höhe nach mittig, in der Leiste wie im Gespräch", () => {
    const { controller, win, setQuick } = build();
    setQuick({ position: "center" });
    controller.show();
    const w = win();
    expect(w.bounds.y).toBe(Math.round(37 + (1080 - 168) / 2));
    controller.setTall(true);
    expect(w.bounds.y).toBe(Math.round(37 + (1080 - 648) / 2));
    expect(w.bounds.height).toBe(648);
  });
});

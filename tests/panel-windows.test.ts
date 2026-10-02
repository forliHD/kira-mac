import { beforeEach, describe, expect, it, vi } from "vitest";

// Live-Befund 02.10.2026: KIRA frisch gestartet, Hauptfenster vorn, ⌥ Leertaste →
// das Hauptfenster verschwand. Das erste Schnellfenster (und das erste Diktat-HUD)
// rief setVisibleOnAllWorkspaces(…, { visibleOnFullScreen: true }) – ohne
// skipTransformProcessType verwandelt Electron dabei die ganze App in ein
// Hintergrundprogramm (TransformProcessType → UIElement): kein Dock-Symbol, kein
// ⌘-Tab, keine Menüleiste, die App verliert den Fokus und ihr Fenster rutscht
// hinter die anderen. Fenster vom Typ „panel“ schweben auch ohne das über
// Vollbild-Apps (Electron-Doku zu BaseWindowOptions.type).

const workspaceCalls: Array<{ visible: boolean; options: unknown }> = [];
const created: Array<Record<string, unknown>> = [];

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
  webContents = new FakeWebContents();
  constructor(options: Record<string, unknown>) {
    created.push(options);
  }
  setVisibleOnAllWorkspaces(visible: boolean, options?: unknown): void {
    workspaceCalls.push({ visible, options });
  }
  setAlwaysOnTop(): void {}
  on(): this {
    return this;
  }
  loadURL(): Promise<void> {
    return Promise.resolve();
  }
  isDestroyed(): boolean {
    return false;
  }
  getSize(): number[] {
    return [680, 168];
  }
  getBounds(): { x: number; y: number; width: number; height: number } {
    return { x: 0, y: 0, width: 680, height: 168 };
  }
  setBounds(): void {}
  setPosition(): void {}
  show(): void {}
  showInactive(): void {}
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

const display = { workArea: { x: 0, y: 0, width: 1512, height: 945 } };
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
const { HudWindowController } = await import("../src/main/windows/hud");

const EXPECTED = [{ visible: true, options: { visibleOnFullScreen: true, skipTransformProcessType: true } }];

describe("Schwebende Fenster lassen KIRA ein normales Dock-Programm", () => {
  beforeEach(() => {
    workspaceCalls.length = 0;
    created.length = 0;
  });

  it("Schnellfenster: alle Spaces und Vollbild, ohne die App umzuwandeln", () => {
    new QuickWindowController({ canShow: () => true }).show();
    expect(created).toHaveLength(1);
    expect(created[0]?.type).toBe("panel");
    expect(workspaceCalls).toEqual(EXPECTED);
  });

  it("Diktat-HUD: ebenso", () => {
    new HudWindowController().show();
    expect(created).toHaveLength(1);
    expect(created[0]?.type).toBe("panel");
    expect(workspaceCalls).toEqual(EXPECTED);
  });

  it("ein zweites Öffnen baut das Fenster nicht neu", () => {
    const quick = new QuickWindowController({ canShow: () => true });
    quick.show();
    quick.hide();
    quick.show();
    expect(created).toHaveLength(1);
    expect(workspaceCalls).toEqual(EXPECTED);
  });
});

import { describe, expect, it, vi } from "vitest";

// config.ts importiert electron (app.getPath) nur im ConfigStore; die reinen
// Funktionen brauchen es nicht – für den Import reicht eine Attrappe.
vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));
vi.mock("../src/main/log", () => ({ scoped: () => ({ info() {}, warn() {}, error() {} }) }));

const { DEFAULT_HOTKEYS, migrateDictationHotkey, normalizeConfig } = await import("../src/main/config");

describe("Konfiguration: Kürzel des globalen Diktats", () => {
  it("Standard ist ⌃⌥D", () => {
    expect(DEFAULT_HOTKEYS.dictation).toBe("Control+Alt+D");
  });

  it("zieht ⌥⌘D aus 0.1.0 um (kollidiert mit „Dock ein-/ausblenden“), eigene Kürzel bleiben", () => {
    expect(migrateDictationHotkey("Alt+Command+D")).toBe("Control+Alt+D");
    expect(migrateDictationHotkey("Control+Shift+K")).toBe("Control+Shift+K");
    const cfg = normalizeConfig({ hotkeys: { quickWindow: "Alt+Space", dictation: "Alt+Command+D" } });
    expect(cfg.hotkeys).toEqual({ quickWindow: "Alt+Space", dictation: "Control+Alt+D" });
  });

  it("die 🌐 fn-Taste bleibt erhalten (einheitlich „Fn“), ist aber kein Standard", () => {
    expect(migrateDictationHotkey("fn")).toBe("Fn");
    expect(migrateDictationHotkey("Fn")).toBe("Fn");
    expect(normalizeConfig({ hotkeys: { quickWindow: "Alt+Space", dictation: "FN" } }).hotkeys.dictation).toBe("Fn");
    expect(normalizeConfig({}).hotkeys.dictation).toBe("Control+Alt+D");
  });

  it("kennt die neuen Felder mit sicheren Standards", () => {
    const cfg = normalizeConfig({});
    expect(cfg.dictation.dashboardStt).toBe(true);
    expect(cfg.lastServerVersion).toBeNull();
    expect(normalizeConfig({ lastServerVersion: "3.298.0" }).lastServerVersion).toBe("3.298.0");
  });
});

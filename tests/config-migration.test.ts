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
    expect(cfg.dictation.correctVocabulary).toBe(true);
    expect(cfg.dictationTests).toEqual([]);
    expect(cfg.lastServerVersion).toBeNull();
    expect(normalizeConfig({ lastServerVersion: "3.298.0" }).lastServerVersion).toBe("3.298.0");
    expect(normalizeConfig({ dictation: { correctVocabulary: false } }).dictation.correctVocabulary).toBe(false);
    // Phase 2 (0.6.0): Sprachfilter an, Mikrofon = Systemstandard.
    expect(cfg.dictation.voiceProcessing).toBe(true);
    expect(cfg.dictation.inputDevice).toBeNull();
    expect(normalizeConfig({ dictation: { voiceProcessing: false, inputDevice: " AirPods-UID " } }).dictation).toMatchObject({ voiceProcessing: false, inputDevice: "AirPods-UID" });
    expect(normalizeConfig({ dictation: { inputDevice: "" } }).dictation.inputDevice).toBeNull();
  });

  it("hält nur gültige Diktat-Test-Ergebnisse, höchstens fünf, neueste zuerst", () => {
    const result = {
      id: "r1",
      at: 1,
      kind: "terms",
      wer: 0.1,
      words: 40,
      substitutions: 2,
      insertions: 1,
      deletions: 1,
      termsTotal: 10,
      termsHit: 9,
      durationMs: 42_000,
      settings: { locale: "de-DE", engine: "analyzer", commands: true, correction: true, appVersion: "0.4.0" },
    };
    const many = Array.from({ length: 7 }, (_, i) => ({ ...result, id: `r${i}` }));
    const cfg = normalizeConfig({ dictationTests: [...many, { id: "kaputt" }, "x"] });
    expect(cfg.dictationTests).toHaveLength(5);
    expect(cfg.dictationTests[0]?.id).toBe("r0");
    expect(normalizeConfig({ dictationTests: "nein" }).dictationTests).toEqual([]);
  });
});

describe("Konfiguration: Schnellfenster (Phase 3)", () => {
  it("Standards: oben, 60 %, Höhe merken, ↩ sendet, offen lassen, neu nach 30 min", () => {
    const q = normalizeConfig({}).quick;
    expect(q).toEqual({
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
    });
  });

  it("begrenzt den Anteil, kennt nur bekannte Werte und hält nur plausible Höhen", () => {
    const q = normalizeConfig({
      quick: { position: "center", chatHeightShare: 1.5, textSize: "xl", sendKey: "cmd-enter", afterSend: "hide", resetAfterMin: 45, suggestions: false, heights: { d1: 700.4, d2: 12, "bad key!": 500, d3: "x" } },
    }).quick;
    expect(q.position).toBe("center");
    expect(q.chatHeightShare).toBe(0.9);
    expect(q.textSize).toBe("m");
    expect(q.sendKey).toBe("cmd-enter");
    expect(q.afterSend).toBe("hide");
    expect(q.resetAfterMin).toBe(30);
    expect(q.suggestions).toBe(false);
    expect(q.heights).toEqual({ d1: 700 });
    expect(normalizeConfig({ quick: { chatHeightShare: 0.1 } }).quick.chatHeightShare).toBe(0.4);
    expect(normalizeConfig({ quick: { resetAfterMin: 0 } }).quick.resetAfterMin).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import {
  DICTATION_TEST_KINDS,
  TEST_RESULTS_MAX,
  dictationTestReference,
  evaluateDictationTest,
  formatWer,
  isDictationTestResult,
  termsForTest,
} from "../src/shared/dictation-test";
import { DictationTestRunner } from "../src/main/dictation-test";

const SETTINGS = { locale: "de-DE", engine: "analyzer", commands: true, correction: true, appVersion: "0.4.0" };

describe("Vorlagen", () => {
  it("baut den Begriffe-Text aus KIRA, Name und eigenen Begriffen", () => {
    const text = dictationTestReference("terms", ["KIRA", "Lucas", "Musterfirma", "Proxmox"]);
    expect(text).toContain("Hallo Lucas, bitte frag KIRA nach dem Termin mit Musterfirma.");
    expect(text).toContain("Proxmox");
    expect(text.split(" ").length).toBeGreaterThan(40);
  });

  it("kommt ohne eigene Begriffe aus", () => {
    expect(dictationTestReference("terms", ["KIRA"])).toContain("KIRA");
    expect(dictationTestReference("terms", [])).toContain("KIRA");
  });

  it("feste Texte für Zahlen und freien Text, drei Arten", () => {
    expect(dictationTestReference("numbers", [])).toContain("9:30 Uhr");
    expect(dictationTestReference("free", []).split(" ").length).toBeGreaterThan(100);
    expect(DICTATION_TEST_KINDS.map((k) => k.kind)).toEqual(["terms", "numbers", "free"]);
    expect(termsForTest(["KIRA", "kira", " Lucas ", ""])).toEqual(["KIRA", "Lucas"]);
  });
});

describe("evaluateDictationTest", () => {
  it("rechnet WER und Begriffe", () => {
    const r = evaluateDictationTest({
      id: "t1",
      at: 1,
      kind: "terms",
      reference: "Hallo KIRA, frag Lucas.",
      hypothesis: "Hallo Tira, frag Lucas.",
      terms: ["KIRA", "Lucas"],
      durationMs: 1234.6,
      settings: SETTINGS,
    });
    expect(r).toMatchObject({ kind: "terms", words: 4, substitutions: 1, wer: 0.25, termsTotal: 2, termsHit: 1, durationMs: 1235 });
    expect(isDictationTestResult(r)).toBe(true);
    expect(isDictationTestResult({ ...r, kind: "x" })).toBe(false);
    expect(formatWer(0.075)).toBe("7,5 %");
  });
});

describe("DictationTestRunner", () => {
  function build() {
    let stored: ReturnType<DictationTestRunner["results"]> = [];
    let now = 1_000;
    const runner = new DictationTestRunner({
      now: () => now,
      store: { load: () => stored, save: (list) => void (stored = list) },
      settings: () => SETTINGS,
    });
    return { runner, advance: (ms: number) => void (now += ms), stored: () => stored };
  }

  it("läuft von begin über die Senke bis zur Auswertung und merkt sich fünf Ergebnisse", () => {
    const { runner, advance, stored } = build();
    const states: Array<{ active: boolean; listening: boolean }> = [];
    runner.on("change", (s) => states.push({ active: s.active, listening: s.listening }));
    const state = runner.begin("terms", ["KIRA", "Lucas"]);
    expect(state.active).toBe(true);
    expect(state.reference).toContain("KIRA");
    runner.sink.update({ active: true, level: 0.3, partial: "Hal", reason: null });
    expect(runner.state().listening).toBe(true);
    expect(runner.state().startedAt).toBe(1_000);
    runner.sink.insert("Hallo Tira");
    runner.sink.insert("bitte frag Lucas");
    advance(5_000);
    runner.sink.update({ active: false, level: 0, partial: "", reason: null });
    const result = runner.finish();
    expect(result).not.toBeNull();
    expect(result?.durationMs).toBe(5_000);
    expect(result?.termsTotal).toBeGreaterThan(0);
    expect(runner.state().active).toBe(false);
    expect(stored()).toHaveLength(1);
    expect(states.at(-1)).toEqual({ active: false, listening: false });
    for (let i = 0; i < TEST_RESULTS_MAX + 2; i++) {
      runner.begin("free", []);
      runner.sink.insert("x");
      runner.finish();
    }
    expect(stored()).toHaveLength(TEST_RESULTS_MAX);
    expect(runner.results()[0]?.kind).toBe("free");
  });

  it("ein Lauf ohne Text wird verworfen, cancel räumt auf, ein Grund bleibt sichtbar", () => {
    const { runner, stored } = build();
    runner.begin("numbers", []);
    expect(runner.finish()).toBeNull();
    expect(stored()).toHaveLength(0);
    runner.begin("free", []);
    runner.sink.update({ active: false, level: 0, partial: "", reason: "Mikrofon-Freigabe fehlt" });
    expect(runner.state().reason).toBe("Mikrofon-Freigabe fehlt");
    expect(runner.state().active).toBe(false);
    runner.begin("free", []);
    runner.cancel();
    expect(runner.state()).toMatchObject({ active: false, text: "", reason: null });
  });
});

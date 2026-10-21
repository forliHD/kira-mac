// Läufer des Diktat-Tests (Plan 21.10.2026, M6): hält Vorlage, erkannten Text
// und Zeiten eines Laufs, bekommt die Erkennung über dieselbe Senke wie das
// Schnellfenster (`GlobalDictation`, Ziel „test“) und wertet am Ende aus.
// Ergebnisse (nur Zahlen und Einstellungen, nie Text) landen im injizierten
// Speicher – höchstens TEST_RESULTS_MAX. Kein Electron (tests/dictation-test.test.ts).

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import {
  type DictationTestKind,
  type DictationTestResult,
  type DictationTestSettings,
  type DictationTestState,
  IDLE_TEST_STATE,
  TEST_RESULTS_MAX,
  dictationTestReference,
  evaluateDictationTest,
  termsForTest,
} from "../shared/dictation-test";
import { joinDictation } from "../shared/dictationText.js";
import { type DictationSink } from "./dictation";

export interface DictationTestStore {
  load(): DictationTestResult[];
  save(results: DictationTestResult[]): void;
}

export interface DictationTestRunnerOptions {
  store: DictationTestStore;
  /** Einstellungen, die zum Ergebnis gehören (Sprache, Engine, Schalter, Version). */
  settings: () => DictationTestSettings;
  now?: () => number;
}

interface Events {
  change: [DictationTestState];
  result: [DictationTestResult];
}

export class DictationTestRunner extends EventEmitter<Events> {
  private readonly opts: DictationTestRunnerOptions;
  private current: DictationTestState = { ...IDLE_TEST_STATE };
  private terms: string[] = [];
  private cached: DictationTestResult[] | null = null;

  /** Senke für `GlobalDictation` (Ziel „test“). */
  readonly sink: DictationSink = {
    update: (s) => this.onUpdate(s),
    insert: (text) => this.onInsert(text),
  };

  constructor(opts: DictationTestRunnerOptions) {
    super();
    this.opts = opts;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  get active(): boolean {
    return this.current.active;
  }

  state(): DictationTestState {
    return { ...this.current };
  }

  results(): DictationTestResult[] {
    this.cached ??= this.opts.store.load();
    return [...this.cached];
  }

  /** Neuer Lauf: Vorlage bauen; das Diktat selbst startet der Aufrufer (Ziel „test“). */
  begin(kind: DictationTestKind, terms: readonly string[]): DictationTestState {
    this.terms = termsForTest(terms);
    this.current = {
      ...IDLE_TEST_STATE,
      active: true,
      kind,
      reference: dictationTestReference(kind, this.terms),
    };
    this.emit("change", this.state());
    return this.state();
  }

  /** Lauf ohne Auswertung beenden (Abbrechen, Fehler). */
  cancel(): void {
    if (!this.current.active && !this.current.reason) return;
    this.current = { ...IDLE_TEST_STATE };
    this.emit("change", this.state());
  }

  /** Auswertung; null, wenn nichts erkannt wurde. Setzt den Lauf zurück. */
  finish(): DictationTestResult | null {
    const s = this.current;
    if (!s.active || !s.kind) return null;
    const hypothesis = s.text.trim();
    const at = this.now();
    this.current = { ...IDLE_TEST_STATE };
    if (!hypothesis) {
      this.emit("change", this.state());
      return null;
    }
    const result = evaluateDictationTest({
      id: randomUUID(),
      at,
      kind: s.kind,
      reference: s.reference,
      hypothesis,
      terms: this.terms,
      durationMs: s.startedAt === null ? 0 : at - s.startedAt,
      settings: this.opts.settings(),
    });
    const list = [result, ...this.results()].slice(0, TEST_RESULTS_MAX);
    this.cached = list;
    this.opts.store.save(list);
    this.emit("result", result);
    this.emit("change", this.state());
    return result;
  }

  private onUpdate(s: { active: boolean; level: number; partial: string; reason: string | null }): void {
    if (!this.current.active) return;
    const startedAt = this.current.startedAt ?? (s.active ? this.now() : null);
    if (s.reason) {
      // Start gescheitert (Freigabe, Modell): Grund zeigen, Lauf beenden.
      this.current = { ...IDLE_TEST_STATE, kind: this.current.kind, reference: this.current.reference, reason: s.reason };
      this.emit("change", this.state());
      return;
    }
    this.current = { ...this.current, listening: s.active, level: s.level, partial: s.partial, startedAt };
    this.emit("change", this.state());
  }

  private onInsert(text: string): void {
    if (!this.current.active) return;
    this.current = { ...this.current, text: joinDictation(this.current.text, text), partial: "" };
    this.emit("change", this.state());
  }
}

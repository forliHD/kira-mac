// Diktat-Test (Plan 21.10.2026, M6): drei feste Texte, die der Mensch
// vorliest; die App misst die Wortfehlerrate und wie viele eigene Begriffe
// ankamen. Texte, Typen und die Auswertung sind rein (tests/dictation-test.test.ts);
// den Lauf steuert src/main/dictation-test.ts.

import { termHits, wordErrorRate } from "./wer";

export type DictationTestKind = "terms" | "numbers" | "free";

export interface DictationTestKindInfo {
  kind: DictationTestKind;
  label: string;
  hint: string;
}

export const DICTATION_TEST_KINDS: readonly DictationTestKindInfo[] = [
  { kind: "terms", label: "Begriffe", hint: "Sätze mit KIRA, deinem Namen und deinen eigenen Begriffen – zeigt, ob die Nachkorrektur greift." },
  { kind: "numbers", label: "Zahlen und Daten", hint: "Termine, Beträge, Uhrzeiten. Zahlen bitte als Zahlen sprechen („vierzehn Uhr dreißig“)." },
  { kind: "free", label: "Freier Text", hint: "Etwa eine Minute zusammenhängender Text in normalem Tempo." },
];

/** Höchstens so viele Ergebnisse bleiben in der Konfiguration. */
export const TEST_RESULTS_MAX = 5;

const TERM_TEMPLATES = [
  "Hallo {0}, bitte frag {1} nach dem Termin mit {2}.",
  "Die Unterlagen zu {2} liegen im Ordner {3}.",
  "Schick {2} eine kurze Nachricht, dass {1} den Entwurf fertig hat.",
  "Hat {3} schon auf die Mail von {0} geantwortet?",
  "Im Projekt {3} fehlt noch die Freigabe von {2}.",
  "Erinnere mich morgen um neun an {2} und an {3}.",
  "{1}, lies mir die letzte Nachricht von {2} vor.",
  "Vielen Dank, {1}. Das war alles zu {3} für heute.",
];

const NUMBERS_TEXT = [
  "Der Termin ist am Donnerstag, dem 14. November, um 9:30 Uhr.",
  "Die Rechnung über 1.250 Euro ist bis zum 31. Oktober fällig.",
  "Wir brauchen drei Angebote, am besten bis Freitag um 16 Uhr.",
  "Die Lieferung wiegt 42 Kilogramm und kommt in 2 Paketen.",
  "Bitte reserviere einen Tisch für 6 Personen um 19:15 Uhr.",
  "Der Zug fährt um 7:48 Uhr von Gleis 12 und braucht etwa 2 Stunden.",
  "Im zweiten Quartal lagen die Kosten bei 18 Prozent unter Plan.",
  "Ruf mich bitte zwischen 10 und 12 Uhr zurück.",
].join(" ");

const FREE_TEXT = [
  "Guten Morgen, ich fasse kurz zusammen, was heute ansteht.",
  "Am Vormittag gehe ich die offenen Anfragen durch und beantworte die drei wichtigsten Mails.",
  "Danach habe ich eine Besprechung mit dem Team, in der wir den Plan für die nächste Woche festlegen.",
  "Bitte denk daran, die Präsentation vorher noch einmal zu prüfen und die letzten Zahlen einzutragen.",
  "Nach dem Mittagessen fahre ich zum Kunden und stelle das neue Angebot vor.",
  "Es wäre gut, wenn die Unterlagen bis dahin ausgedruckt sind und der Vertrag unterschrieben zurückkommt.",
  "Am Abend schreibe ich noch das Protokoll und lege die Aufgaben für morgen fest.",
  "Wenn etwas Dringendes dazwischenkommt, ruf mich einfach an, ich bin den ganzen Tag erreichbar.",
  "Vielen Dank und bis später.",
].join(" ");

/** Begriffe für den Text: KIRA zuerst, dann der Mensch, dann die eigenen – ohne Doppelte, höchstens 12. */
export function termsForTest(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = raw.trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= 12) break;
  }
  return out;
}

/** Die Vorlage je Testart; „Begriffe“ wird aus den Begriffen gebaut, der Rest ist fest. */
export function dictationTestReference(kind: DictationTestKind, terms: readonly string[]): string {
  if (kind === "numbers") return NUMBERS_TEXT;
  if (kind === "free") return FREE_TEXT;
  const list = termsForTest(terms);
  if (list.length === 0) return "Hallo KIRA, bitte sag mir, was heute ansteht.";
  const assistant = list[0] ?? "KIRA";
  const person = list[1] ?? assistant;
  // Platzhalter: {0} = Mensch, {1} = Assistent, {2}/{3} = eigene Begriffe reihum (Rückfall: Mensch/Assistent).
  const custom = list.slice(2);
  let turn = 0;
  const pick = (): string => {
    if (custom.length === 0) return turn++ % 2 === 0 ? person : assistant;
    return custom[turn++ % custom.length] ?? assistant;
  };
  return TERM_TEMPLATES.map((template) =>
    template.replace(/\{(\d)\}/g, (_m, digit: string) => {
      if (digit === "0") return person;
      if (digit === "1") return assistant;
      return pick();
    }),
  ).join(" ");
}

export interface DictationTestSettings {
  locale: string;
  /** Engine laut Helfer (`analyzer`, `legacy`) oder null. */
  engine: string | null;
  commands: boolean;
  correction: boolean;
  appVersion: string;
}

export interface DictationTestResult {
  id: string;
  at: number;
  kind: DictationTestKind;
  /** Wortfehlerrate 0 … 1 (kann über 1 liegen). */
  wer: number;
  words: number;
  substitutions: number;
  insertions: number;
  deletions: number;
  termsTotal: number;
  termsHit: number;
  durationMs: number;
  settings: DictationTestSettings;
}

export interface DictationTestState {
  active: boolean;
  kind: DictationTestKind | null;
  reference: string;
  /** Bisher erkannter Text (Diktierbefehle und Nachkorrektur schon angewandt). */
  text: string;
  partial: string;
  level: number;
  /** Erkennung läuft (Mikrofon offen). */
  listening: boolean;
  startedAt: number | null;
  /** Grund, warum der Test nicht starten konnte, sonst null. */
  reason: string | null;
}

export const IDLE_TEST_STATE: DictationTestState = {
  active: false,
  kind: null,
  reference: "",
  text: "",
  partial: "",
  level: 0,
  listening: false,
  startedAt: null,
  reason: null,
};

export function isDictationTestKind(v: unknown): v is DictationTestKind {
  return v === "terms" || v === "numbers" || v === "free";
}

export function isDictationTestResult(v: unknown): v is DictationTestResult {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  const s = r.settings as Record<string, unknown> | undefined;
  const num = (x: unknown): boolean => typeof x === "number" && Number.isFinite(x);
  return (
    typeof r.id === "string" &&
    num(r.at) &&
    isDictationTestKind(r.kind) &&
    num(r.wer) &&
    num(r.words) &&
    num(r.substitutions) &&
    num(r.insertions) &&
    num(r.deletions) &&
    num(r.termsTotal) &&
    num(r.termsHit) &&
    num(r.durationMs) &&
    Boolean(s) &&
    typeof s?.locale === "string" &&
    (s?.engine === null || typeof s?.engine === "string") &&
    typeof s?.commands === "boolean" &&
    typeof s?.correction === "boolean" &&
    typeof s?.appVersion === "string"
  );
}

/** Auswertung eines Laufs: WER über den ganzen Text, Begriffe nur beim Begriffe-Test. */
export function evaluateDictationTest(input: {
  id: string;
  at: number;
  kind: DictationTestKind;
  reference: string;
  hypothesis: string;
  terms: readonly string[];
  durationMs: number;
  settings: DictationTestSettings;
}): DictationTestResult {
  const wer = wordErrorRate(input.reference, input.hypothesis);
  const hits = input.kind === "terms" ? termHits(input.reference, input.hypothesis, input.terms) : { total: 0, hit: 0 };
  return {
    id: input.id,
    at: input.at,
    kind: input.kind,
    wer: Math.round(wer.wer * 10_000) / 10_000,
    words: wer.words,
    substitutions: wer.substitutions,
    insertions: wer.insertions,
    deletions: wer.deletions,
    termsTotal: hits.total,
    termsHit: hits.hit,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    settings: input.settings,
  };
}

/** „WER 7,5 %“ bzw. „–“ ohne Wörter. */
export function formatWer(wer: number): string {
  if (!Number.isFinite(wer)) return "–";
  return `${(wer * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
}

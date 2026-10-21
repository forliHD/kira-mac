// Globales Diktat: Hotkey schaltet um, der Helfer erkennt auf dem Apple-Chip
// (`stt.start`), jedes `stt.final` läuft durch die Nachkorrektur gegen den
// Wortschatz (dictation-correct.ts) und die Diktierbefehle und wird mit
// `text.insert` in das vorderste Programm gesetzt. Das HUD zeigt Pegel,
// flüchtigen Text und das Zielprogramm. Ohne Apple-Spracherkennung gibt es
// einen klaren Hinweis mit Grund – keinen Rückfall auf den Server (Owner-
// Entscheid: Audio verlässt beim globalen Diktat den Mac nie).
// Zwei weitere Ziele teilen sich den Stream: das Schnellfenster und der
// Diktat-Test (Senken ohne HUD, ohne Bedienungshilfen).
// Kein Electron-Import: Helfer, Server-Zugriff und HUD werden injiziert
// (tests/dictation.test.ts).

import { EventEmitter } from "node:events";

import { needsAssetDownload } from "../shared/dictation-model";
import { applyDictationCommands, joinDictation } from "../shared/dictationText.js";
import {
  type FrontmostApp,
  type HelperEvent,
  type HelperInfo,
  type HelperSttStatus,
  type PermissionsStatus,
  type SttEnded,
  type SttStartResult,
} from "../shared/helper-types";
import { type HudState } from "../shared/local-api";
import { type Logger, silentLogger } from "../shared/logger";
import { type CorrectionResult, type TermIndex, buildTermIndex, candidateWords, correctWithVocabulary } from "./dictation-correct";

export const DICTATION_STREAM_ID = "dictation";
/** Wörterbuch-Antworten des Helfers (`text.knownWords`) bleiben so lange im Speicher. */
export const KNOWN_WORDS_CACHE_MAX = 2_000;
const KNOWN_WORDS_TIMEOUT_MS = 1_500;
/** Wie lange „Eingefügt · n Zeichen“ in der Pille steht. */
export const INSERTED_LINGER_MS = 900;
export const VOCABULARY_TTL_MS = 60 * 60 * 1000; // stündlich erneuern
export const ASSISTANT_NAME = "KIRA";

/** Was das Diktat vom Helfer braucht (Teilmenge von HelperClient). */
export interface DictationHelper {
  readonly running: boolean;
  readonly info: HelperInfo | null;
  request<T = unknown>(cmd: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  on(event: "event", listener: (ev: HelperEvent) => void): unknown;
  off(event: "event", listener: (ev: HelperEvent) => void): unknown;
}

/** Was das Diktat vom Server braucht: Begriffe und Anzeigename (über session.ts). */
export interface DictationServer {
  /** `GET /api/users/me/speech` → Feld `vocabulary`; null, wenn kein Server/keine Sitzung. */
  fetchVocabulary(): Promise<string | null>;
  /** Anzeigename aus `GET /api/auth/me` (oder null). */
  fetchDisplayName(): Promise<string | null>;
}

export interface DictationHud {
  show(): void;
  hide(): void;
  update(state: HudState): void;
}

/** Wohin erkannter Text geht: ins vorderste Programm, ins Schnellfenster oder in den Diktat-Test. */
export type DictationTarget = "insert" | "quick" | "test";

/** Senke ohne HUD und ohne Bedienungshilfen-Freigabe: Schnellfenster und Diktat-Test. */
export interface DictationSink {
  update(state: { active: boolean; level: number; partial: string; reason: string | null }): void;
  insert(text: string): void;
}

/** @deprecated Name aus 0.3.x – heute `DictationSink`. */
export type DictationQuickSink = DictationSink;

/** Zuletzt geholter Wortschatz – bleibt verschlüsselt auf der Platte, damit er offline da ist (M4). */
export interface StoredVocabulary {
  terms: string[];
  fetchedAt: number;
}

export interface VocabularyStore {
  load(): StoredVocabulary | null;
  save(vocabulary: StoredVocabulary): void;
}

export interface DictationOptions {
  helper: DictationHelper;
  server: DictationServer;
  hud: DictationHud;
  /** Ziel beim Start, wenn `toggle()` ohne Ziel gerufen wird (Standard: insert). */
  getTarget?: () => DictationTarget;
  quick?: DictationSink;
  test?: DictationSink;
  getLocale: () => string;
  getCommandsEnabled: () => boolean;
  /** Nachkorrektur gegen den Wortschatz (Standard an). */
  getCorrectionEnabled?: () => boolean;
  /** Mikrofon (UID oder null = Systemstandard) und Apples Sprachfilter für `stt.start` (Helfer ≥ 0.6.0). */
  getInput?: () => { device: string | null; voiceProcessing: boolean };
  vocabularyStore?: VocabularyStore;
  /**
   * Lädt ein fehlendes Diktat-Modell (geteilt mit Einstellungen und Dashboard).
   * Fortschritt 0…1. Fehlt der Haken, ruft das Diktat selbst `stt.prepare`.
   */
  ensureAssets?: (locale: string, onProgress: (fraction: number) => void) => Promise<void>;
  log?: Logger;
  now?: () => number;
  /** Wie lange ein Fehlerhinweis im HUD stehen bleibt. */
  errorLingerMs?: number;
}

export type DictationState = "idle" | "starting" | "listening" | "stopping";

/** Ein fertiges Diktat (Start bis Ende) für den Verlauf (dictation-history.ts). */
export interface DictationSession {
  startedAt: number;
  app: string | null;
  target: DictationTarget;
  text: string;
  /** Mindestens ein Satz ließ sich nicht einsetzen. */
  failed: boolean;
  /** Fertige Stücke des Helfers (`stt.final`). */
  finals: number;
  /** Ersetzungen der Nachkorrektur. */
  replacements: number;
}

export interface DictationEvents {
  state: [DictationState];
  inserted: [{ text: string; method: string }];
  unavailable: [string];
  session: [DictationSession];
}

/**
 * Kein Wort, keine Zahl – nur Satzzeichen („.“, „..“, „?“). Live-Befund
 * 02.10.2026: im fremden Programm kamen nach langem Diktat nur Punkte an. Ein
 * gesprochenes „Punkt“ hat Buchstaben und bleibt ein Diktierbefehl.
 */
export function isPunctuationOnly(raw: string): boolean {
  const t = raw.trim();
  return t !== "" && !/[\p{L}\p{N}]/u.test(t);
}

/** Teilt den Wortschatz wie `core/brain/speech_vocabulary.split_terms`: Komma oder Zeile. */
export function splitVocabulary(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n,]/)) {
    const term = part.trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

/** Reihenfolge = Gewicht: Assistent, Nutzer, eigene Begriffe (wie im Server). */
export function buildContextualStrings(displayName: string | null, vocabulary: string | null): string[] {
  const parts: string[] = [ASSISTANT_NAME];
  if (displayName && displayName.trim()) parts.push(displayName.trim());
  for (const term of splitVocabulary(vocabulary)) {
    if (!parts.some((p) => p.toLowerCase() === term.toLowerCase())) parts.push(term);
  }
  return parts.slice(0, 200);
}

/**
 * Was tatsächlich eingesetzt wird: ein Leerzeichen, wo eins hingehört,
 * bezogen auf das Ende der letzten Einfügung (nicht auf den fremden Text –
 * den kennt die Hülle nicht).
 */
export function pieceToInsert(previousTail: string, text: string): string {
  const joined = joinDictation(previousTail, text);
  return joined.slice(previousTail.length);
}

function isStoredVocabulary(v: unknown): v is StoredVocabulary {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return Array.isArray(s.terms) && s.terms.every((t) => typeof t === "string") && typeof s.fetchedAt === "number";
}

export class GlobalDictation extends EventEmitter<DictationEvents> {
  private readonly helper: DictationHelper;
  private readonly server: DictationServer;
  private readonly hud: DictationHud;
  private readonly getLocale: () => string;
  private readonly getCommandsEnabled: () => boolean;
  private readonly getCorrectionEnabled: (() => boolean) | undefined;
  private readonly getInput: (() => { device: string | null; voiceProcessing: boolean }) | undefined;
  /** Was die Aufnahme laut Helfer nutzt (Sprachfilter, Gerät) – fürs Protokoll. */
  private microphone: { voiceProcessing: boolean; device: string | null } | null = null;
  private readonly vocabularyStore: VocabularyStore | undefined;
  private readonly log: Logger;
  private readonly now: () => number;
  private readonly errorLingerMs: number;
  private readonly getTarget: (() => DictationTarget) | undefined;
  private readonly quick: DictationSink | undefined;
  private readonly test: DictationSink | undefined;
  private readonly ensureAssets: ((locale: string, onProgress: (fraction: number) => void) => Promise<void>) | undefined;
  private target: DictationTarget = "insert";

  private state: DictationState = "idle";
  /** Zählt Starts; ein `start()`, dessen Zahl nicht mehr stimmt, wurde abgebrochen. */
  private generation = 0;
  /** `stt.start` ist unterwegs – ein Stopp muss die Antwort abwarten, sonst läuft der Stream weiter. */
  private sttStarting = false;
  /** Abgebrochen (`cancel`): ausstehende `stt.final` nicht mehr einsetzen. */
  private discard = false;
  private vocabulary: StoredVocabulary | null = null;
  private storeChecked = false;
  /** Begriffe des laufenden Diktats (für die Nachkorrektur) und ihr Index. */
  private terms: string[] = [ASSISTANT_NAME];
  private index: TermIndex | null = null;
  /** Engine laut Antwort auf `stt.start` („analyzer“, „legacy“) – fürs Protokoll und den Diktat-Test. */
  private engine: string | null = null;
  /** Wort (klein) → kennt es das Systemwörterbuch? (`text.knownWords`, nie protokolliert) */
  private readonly knownWords = new Map<string, boolean>();
  private previousTail = "";
  /** Das laufende Diktat für den Verlauf (wird in finish() gemeldet). */
  private session: DictationSession | null = null;
  /** Zeitpunkt des `stt.stop` – bis `stt.ended` spült der Helfer noch (Messwert). */
  private stopAt: number | null = null;
  private hudState: HudState = { phase: "starting", level: 0, partial: "", app: null, appIcon: null, message: null, progress: null };
  private readonly onHelperEvent = (ev: HelperEvent): void => this.handleHelperEvent(ev);
  private hideTimer: NodeJS.Timeout | null = null;
  /**
   * Laufende `insertFinal`-Aufrufe: Die Wörterbuch-Frage (`text.knownWords`)
   * wartet, `stt.ended` kann vorher kommen – das Ende wartet auf sie, sonst
   * fehlt der letzte Satz im Verlauf und im Diktat-Test.
   */
  private readonly inflight = new Set<Promise<void>>();

  constructor(options: DictationOptions) {
    super();
    this.helper = options.helper;
    this.server = options.server;
    this.hud = options.hud;
    this.getLocale = options.getLocale;
    this.getCommandsEnabled = options.getCommandsEnabled;
    this.getCorrectionEnabled = options.getCorrectionEnabled;
    this.getInput = options.getInput;
    this.vocabularyStore = options.vocabularyStore;
    this.log = options.log ?? silentLogger;
    this.now = options.now ?? (() => Date.now());
    this.errorLingerMs = options.errorLingerMs ?? 4_000;
    this.getTarget = options.getTarget;
    this.quick = options.quick;
    this.test = options.test;
    this.ensureAssets = options.ensureAssets;
    this.helper.on("event", this.onHelperEvent);
  }

  get currentState(): DictationState {
    return this.state;
  }

  get currentTarget(): DictationTarget {
    return this.target;
  }

  /** Engine des letzten Starts (null, solange keiner lief oder der Helfer keine nannte). */
  get lastEngine(): string | null {
    return this.engine;
  }

  dispose(): void {
    this.helper.off("event", this.onHelperEvent);
  }

  /** Hotkey/Knopf/fn-Tippen: läuft es, wird gestoppt, sonst gestartet (optional mit festem Ziel). */
  async toggle(target?: DictationTarget): Promise<void> {
    if (this.state === "listening" || this.state === "starting") await this.stop();
    else if (this.state === "idle") await this.start(target);
  }

  /** Prüft Helfer und Berechtigungen; Grund als deutscher Satz oder null. */
  async availability(): Promise<{ ok: true } | { ok: false; reason: string; status: HelperSttStatus | null }> {
    if (!this.helper.running) {
      return { ok: false, reason: "Der Helfer läuft nicht – Apple-Spracherkennung nicht verfügbar.", status: null };
    }
    const info = this.helper.info;
    if (info && !info.features.sttStream) {
      return { ok: false, reason: "Dieser Mac bietet keine laufende Spracherkennung (Helfer meldet sttStream=false).", status: null };
    }
    let status: HelperSttStatus;
    try {
      status = await this.helper.request<HelperSttStatus>("stt.status", { locale: this.getLocale() });
    } catch (err) {
      return { ok: false, reason: `Status der Spracherkennung unbekannt: ${err instanceof Error ? err.message : String(err)}`, status: null };
    }
    if (!status.available) {
      const why = status.reason ? status.reason : status.assets === "missing" ? "Sprachmodell nicht installiert." : "Apple-Spracherkennung nicht verfügbar.";
      return { ok: false, reason: why, status };
    }
    return { ok: true };
  }

  async start(target?: DictationTarget): Promise<void> {
    if (this.state !== "idle") return;
    const generation = ++this.generation;
    const wanted = target ?? this.getTarget?.() ?? "insert";
    this.target = wanted === "quick" && this.quick ? "quick" : wanted === "test" && this.test ? "test" : "insert";
    this.discard = false;
    this.setState("starting");
    this.clearHideTimer();
    this.previousTail = "";
    this.stopAt = null;
    this.session = { startedAt: this.now(), app: null, target: this.target, text: "", failed: false, finals: 0, replacements: 0 };
    this.setHud({ phase: "starting", level: 0, partial: "", app: null, appIcon: null, message: null, progress: null });
    if (this.target === "insert") this.hud.show();

    // Nach jedem Warten: wurde inzwischen gestoppt/abgebrochen (z. B. fn
    // nur kurz gehalten), hat stop()/cancel() schon aufgeräumt.
    let avail = await this.availability();
    if (generation !== this.generation) return;
    if (!avail.ok && avail.status && needsAssetDownload(avail.status)) {
      // Ohne dieses Laden bleibt der Stand für immer „fehlt“: die Hülle hat
      // `stt.prepare` früher nie aufgerufen, der Knopf in den Einstellungen
      // hat nur neu gelesen.
      const locale = this.getLocale();
      this.setHud({ phase: "starting", message: "Diktat-Modell wird geladen…", progress: 0 });
      try {
        const ensure =
          this.ensureAssets ??
          (async (code: string, onProgress: (fraction: number) => void): Promise<void> => {
            const onEvent = (ev: HelperEvent): void => {
              if (ev.event !== "stt.progress") return;
              const data = (ev.data && typeof ev.data === "object" ? ev.data : {}) as Record<string, unknown>;
              if (typeof data.fraction === "number" && (data.locale === undefined || data.locale === code)) onProgress(data.fraction);
            };
            this.helper.on("event", onEvent);
            try {
              await this.helper.request("stt.prepare", { locale: code });
            } finally {
              this.helper.off("event", onEvent);
            }
          });
        await ensure(locale, (fraction) => {
          if (generation !== this.generation) return;
          const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
          this.setHud({ message: `Diktat-Modell wird geladen… ${pct} %`, progress: Math.max(0, Math.min(1, fraction)) });
        });
      } catch (err) {
        if (generation !== this.generation) return;
        this.setHud({ progress: null });
        this.failStart(err instanceof Error ? err.message : String(err));
        return;
      }
      if (generation !== this.generation) return;
      this.setHud({ message: null, progress: null });
      avail = await this.availability();
      if (generation !== this.generation) return;
    }
    if (!avail.ok) {
      this.failStart(avail.reason);
      return;
    }
    const perm = await this.ensurePermissions();
    if (generation !== this.generation) return;
    if (perm) {
      this.failStart(perm);
      return;
    }

    const [front, contextualStrings] = await Promise.all([
      this.target === "insert" ? this.frontmost() : Promise.resolve(null),
      this.contextualStrings(),
    ]);
    if (generation !== this.generation) return;
    this.terms = contextualStrings;
    this.index = null;
    const app = this.target === "quick" ? "KIRA" : this.target === "test" ? "Diktat-Test" : (front?.name ?? null);
    this.setHud({ app, appIcon: this.target === "insert" && typeof front?.icon === "string" ? front.icon : null });
    if (this.session) this.session.app = app;

    this.sttStarting = true;
    try {
      const params: Record<string, unknown> = {
        stream: DICTATION_STREAM_ID,
        locale: this.getLocale(),
        contextualStrings,
        source: "microphone",
      };
      const input = this.getInput?.();
      if (input) {
        params.voiceProcessing = input.voiceProcessing;
        if (input.device) params.device = input.device;
      }
      const res = await this.helper.request<SttStartResult>("stt.start", params);
      this.engine = typeof res?.engine === "string" ? res.engine : null;
      this.microphone =
        res?.microphone && typeof res.microphone === "object"
          ? { voiceProcessing: res.microphone.voiceProcessing === true, device: typeof res.microphone.device === "string" ? res.microphone.device : null }
          : null;
    } catch (err) {
      this.sttStarting = false;
      // Wer schon gestoppt hat, will keine Fehlermeldung mehr sehen.
      if (this.stopRequested()) this.finish();
      else this.failStart(`Spracherkennung konnte nicht starten: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    this.sttStarting = false;
    if (this.stopRequested()) {
      // stop()/cancel() kam, während stt.start lief: Stream gleich wieder beenden.
      await this.requestStop();
      return;
    }
    this.setState("listening");
    this.setHud({ phase: "listening" });
  }

  /** Beenden: noch ausstehender Text wird eingesetzt. */
  async stop(): Promise<void> {
    await this.end(false);
  }

  /**
   * Abbrechen ohne Einsetzen (fn-Taste: es war doch eine Tastenkombination).
   * Ausstehende Äußerungen werden verworfen, die Pille verschwindet sofort.
   */
  async cancel(): Promise<void> {
    await this.end(true);
  }

  private async end(discard: boolean): Promise<void> {
    if (discard) this.discard = true;
    if (this.state === "idle") {
      // Eine stehende Fehlermeldung (z. B. fehlende Freigabe) gleich mit wegnehmen.
      if (discard) this.dismiss();
      return;
    }
    if (this.state === "stopping") {
      if (discard) this.dismiss();
      return;
    }
    if (this.state === "starting" && !this.sttStarting) {
      // Beim Helfer läuft noch nichts: sofort fertig; der laufende start()
      // erkennt an der Zahl, dass er nicht mehr gemeint ist.
      this.generation++;
      this.finish();
      return;
    }
    this.setState("stopping");
    if (discard) this.dismiss();
    else this.setHud({ phase: "stopping" });
    if (this.sttStarting) return; // start() stoppt nach der Antwort auf stt.start
    await this.requestStop();
  }

  /** Kam während des Starts ein stop()/cancel()? (Eigene Methode: TypeScript hält
   *  `this.state` nach dem `idle`-Test am Anfang von start() sonst für unveränderlich.) */
  private stopRequested(): boolean {
    return this.state === "stopping";
  }

  private async requestStop(): Promise<void> {
    const generation = this.generation;
    this.stopAt = this.now();
    try {
      await this.helper.request("stt.stop", { stream: DICTATION_STREAM_ID });
    } catch (err) {
      this.log.warn("dictation_stop_failed", { error: err instanceof Error ? err.message : String(err) });
      this.finish();
    }
    // `stt.ended` beendet den Zustand; falls es ausbleibt, räumt ein Timer auf.
    setTimeout(() => {
      if (this.state === "stopping" && generation === this.generation) this.finish();
    }, 3_000).unref?.();
  }

  /** Die Senke des laufenden Ziels (Schnellfenster, Diktat-Test) – null beim Einsetzen ins Programm. */
  private sink(): DictationSink | null {
    if (this.target === "quick") return this.quick ?? null;
    if (this.target === "test") return this.test ?? null;
    return null;
  }

  /** Abbruch: Pille sofort weg, Schnellfenster wieder ruhig – ohne Meldung. */
  private dismiss(): void {
    this.clearHideTimer();
    this.hudState = { ...this.hudState, phase: "stopping", level: 0, partial: "", message: null };
    const sink = this.sink();
    if (sink) sink.update({ active: false, level: 0, partial: "", reason: null });
    else this.hud.hide();
  }

  /**
   * Die Begriffe: Cache für eine Stunde, danach frisch vom Server. Scheitert
   * das (offline, keine Sitzung), gilt der zuletzt gespeicherte Wortschatz
   * weiter – erst ohne jeden Stand bleibt die Mindestliste („KIRA“).
   */
  async contextualStrings(): Promise<string[]> {
    if (!this.vocabulary && this.vocabularyStore && !this.storeChecked) {
      this.storeChecked = true;
      try {
        const stored = this.vocabularyStore.load();
        if (isStoredVocabulary(stored) && stored.terms.length > 0) this.vocabulary = stored;
      } catch (err) {
        this.log.warn("dictation_vocabulary_store_failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }
    const cached = this.vocabulary;
    if (cached && this.now() - cached.fetchedAt < VOCABULARY_TTL_MS) return cached.terms;
    let vocabulary: string | null = null;
    let displayName: string | null = null;
    try {
      [vocabulary, displayName] = await Promise.all([this.server.fetchVocabulary(), this.server.fetchDisplayName()]);
    } catch (err) {
      this.log.warn("dictation_vocabulary_failed", { error: err instanceof Error ? err.message : String(err) });
    }
    if (vocabulary === null && displayName === null) {
      if (cached) {
        this.log.info("dictation_vocabulary_stale", { terms: cached.terms.length, ageMin: Math.round((this.now() - cached.fetchedAt) / 60_000) });
        return cached.terms;
      }
      return buildContextualStrings(null, null);
    }
    const terms = buildContextualStrings(displayName, vocabulary);
    this.vocabulary = { terms, fetchedAt: this.now() };
    try {
      this.vocabularyStore?.save(this.vocabulary);
    } catch (err) {
      this.log.warn("dictation_vocabulary_store_failed", { error: err instanceof Error ? err.message : String(err) });
    }
    return terms;
  }

  /** Erzwingt eine Erneuerung beim nächsten Start (z. B. nach Sitzungswechsel); der gespeicherte Stand bleibt als Rückfall. */
  invalidateVocabulary(): void {
    this.vocabulary = null;
    this.storeChecked = false;
  }

  /** Für die Einstellungen: wie viele Begriffe, von wann (null = noch nie geholt). */
  vocabularyInfo(): { count: number; fetchedAt: number } | null {
    const v = this.vocabulary ?? (this.vocabularyStore ? this.vocabularyStore.load() : null);
    if (!isStoredVocabulary(v)) return null;
    return { count: v.terms.length, fetchedAt: v.fetchedAt };
  }

  /**
   * Nachkorrektur gegen den Wortschatz (auch für `transcribe` des Dashboards):
   * ohne `terms` die Begriffe des laufenden bzw. letzten Diktats.
   */
  correctText(raw: string, terms?: readonly string[]): CorrectionResult {
    if (this.getCorrectionEnabled?.() === false) return { text: raw, replacements: 0 };
    return correctWithVocabulary(raw, this.termIndex(terms), { knownWords: this.knownSet() });
  }

  /**
   * Wie `correctText`, fragt aber vorher das Systemwörterbuch des Helfers
   * nach den Wörtern, die nur über einen Tippfehler-Treffer ersetzt würden –
   * bekannte Wörter („Kita“) bleiben dann stehen. Antwortet der Helfer nicht
   * rechtzeitig, gilt die eingebaute Sperrliste allein.
   */
  async correctTextAsync(raw: string, terms?: readonly string[]): Promise<CorrectionResult> {
    if (this.getCorrectionEnabled?.() === false) return { text: raw, replacements: 0 };
    const index = this.termIndex(terms);
    const candidates = candidateWords(raw, index).filter((w) => !this.knownWords.has(w.toLowerCase()));
    if (candidates.length > 0 && this.helper.running) {
      try {
        const res = await this.helper.request<{ known?: unknown }>("text.knownWords", { locale: this.getLocale(), words: candidates }, KNOWN_WORDS_TIMEOUT_MS);
        const known = new Set(Array.isArray(res?.known) ? res.known.filter((w): w is string => typeof w === "string").map((w) => w.toLowerCase()) : []);
        for (const w of candidates) this.remember(w.toLowerCase(), known.has(w.toLowerCase()));
      } catch (err) {
        this.log.warn("dictation_known_words_failed", { error: err instanceof Error ? err.message : String(err), words: candidates.length });
      }
    }
    return correctWithVocabulary(raw, index, { knownWords: this.knownSet() });
  }

  private termIndex(terms?: readonly string[]): TermIndex {
    if (terms) return buildTermIndex(terms);
    this.index ??= buildTermIndex(this.terms);
    return this.index;
  }

  private knownSet(): ReadonlySet<string> {
    const out = new Set<string>();
    for (const [word, known] of this.knownWords) if (known) out.add(word);
    return out;
  }

  private remember(word: string, known: boolean): void {
    if (this.knownWords.size >= KNOWN_WORDS_CACHE_MAX) {
      const first = this.knownWords.keys().next().value;
      if (first !== undefined) this.knownWords.delete(first);
    }
    this.knownWords.set(word, known);
  }

  private async ensurePermissions(): Promise<string | null> {
    let status: PermissionsStatus;
    try {
      status = await this.helper.request<PermissionsStatus>("permissions.status");
    } catch (err) {
      return `Berechtigungen konnten nicht geprüft werden: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (status.microphone === "notDetermined") {
      const r = await this.helper.request<{ status: string }>("permissions.request", { kind: "microphone" }).catch(() => null);
      status.microphone = (r?.status as PermissionsStatus["microphone"]) ?? "denied";
    }
    if (status.microphone !== "granted") {
      return "Mikrofon-Freigabe fehlt (Systemeinstellungen → Datenschutz & Sicherheit → Mikrofon).";
    }
    if (status.speech === "notDetermined") {
      const r = await this.helper.request<{ status: string }>("permissions.request", { kind: "speech" }).catch(() => null);
      status.speech = (r?.status as PermissionsStatus["speech"]) ?? "denied";
    }
    if (status.speech !== "granted" && status.speech !== "notRequired") {
      return "Spracherkennungs-Freigabe fehlt (Systemeinstellungen → Datenschutz & Sicherheit → Spracherkennung).";
    }
    // Ins Schnellfenster und in den Diktat-Test setzt KIRA selbst ein – dafür braucht es keine Bedienungshilfen.
    if (this.target !== "insert") return null;
    if (!status.accessibility) {
      // Einsetzen per Accessibility UND per ⌘V-CGEvent braucht die Bedienungshilfen-Freigabe.
      void this.helper.request("permissions.request", { kind: "accessibility" }).catch(() => null);
      return "Bedienungshilfen-Freigabe fehlt – ohne sie kann KIRA keinen Text in andere Programme einsetzen.";
    }
    return null;
  }

  private async frontmost(): Promise<FrontmostApp | null> {
    try {
      return await this.helper.request<FrontmostApp>("text.frontmost");
    } catch {
      return null;
    }
  }

  private handleHelperEvent(ev: HelperEvent): void {
    if (ev.stream !== DICTATION_STREAM_ID) return;
    const data = (ev.data && typeof ev.data === "object" ? ev.data : {}) as Record<string, unknown>;
    switch (ev.event) {
      case "stt.level": {
        const rms = typeof data.rms === "number" ? Math.max(0, Math.min(1, data.rms)) : 0;
        this.setHud({ level: rms });
        break;
      }
      case "stt.partial":
        this.setHud({ partial: typeof data.text === "string" ? data.text : "" });
        break;
      case "stt.final": {
        if (this.discard) break; // abgebrochen: nichts mehr einsetzen
        const job: Promise<void> = this.insertFinal(typeof data.text === "string" ? data.text : "").finally(() => this.inflight.delete(job));
        this.inflight.add(job);
        break;
      }
      case "stt.ended": {
        const ended = data as unknown as SttEnded;
        if (this.discard) {
          this.finish();
        } else if (ended.reason === "error") {
          this.setHud({ phase: "error", message: ended.message ?? "Spracherkennung abgebrochen." });
          this.finish(true);
        } else {
          this.finish();
        }
        break;
      }
      default:
        break;
    }
  }

  private async insertFinal(raw: string): Promise<void> {
    if (isPunctuationOnly(raw)) {
      this.log.info("dictation_final_skipped", { reason: "punctuation", chars: raw.trim().length });
      return;
    }
    // Erst der Wortschatz („Tira“ → KIRA), dann die Diktierbefehle („Punkt“).
    const corrected = await this.correctTextAsync(raw);
    if (this.discard) return; // während der Wörterbuch-Frage abgebrochen
    if (this.session) {
      this.session.finals++;
      this.session.replacements += corrected.replacements;
    }
    const { text, op } = applyDictationCommands(corrected.text, { enabled: this.getCommandsEnabled() });
    if (op === "undo") {
      // In fremden Programmen gibt es kein verlässliches Rückgängig der
      // letzten Äußerung – wir weisen nur hin, statt etwas Falsches zu löschen.
      this.setHud({ partial: "", message: "„Rückgängig“ gilt nur im KIRA-Diktat." });
      return;
    }
    if (!text) return;
    // Zuerst in den Verlauf – vor jedem Warten, damit der Text auch dann
    // gesichert ist, wenn das Einsetzen scheitert oder das Diktat gleich endet.
    if (this.session) this.session.text = joinDictation(this.session.text, text);
    const sink = this.sink();
    if (sink) {
      // Die Seite fügt an der Cursorposition ein und kümmert sich um Leerzeichen.
      sink.insert(text);
      this.setHud({ partial: "", message: null });
      this.emit("inserted", { text, method: this.target });
      return;
    }
    const piece = pieceToInsert(this.previousTail, text);
    if (!piece) return;
    try {
      const res = await this.helper.request<{ method: string }>("text.insert", { text: piece, mode: "auto" });
      this.previousTail = piece.slice(-2);
      this.setHud({ partial: "", message: null });
      // Nur Methode und Länge – nie der Text (Protokoll-Regel).
      this.log.info("dictation_inserted", { method: res?.method ?? "?", chars: piece.length, replacements: corrected.replacements });
      this.emit("inserted", { text: piece, method: res?.method ?? "?" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn("dictation_insert_failed", { error: message });
      if (this.session) this.session.failed = true;
      this.setHud({ message: `Einfügen fehlgeschlagen – der Text steht im Diktat-Verlauf. (${message})` });
    }
  }

  private failStart(reason: string): void {
    this.log.info("dictation_unavailable", { reason, target: this.target });
    this.setHud({ phase: "unavailable", message: reason, level: 0, partial: "" });
    this.emit("unavailable", reason);
    this.session = null;
    this.setState("idle");
    this.scheduleHide(this.errorLingerMs);
  }

  private finish(linger = false): void {
    if (this.inflight.size > 0) {
      void Promise.allSettled([...this.inflight]).then(() => this.finish(linger));
      return;
    }
    this.sttStarting = false;
    const session = this.session;
    this.session = null;
    const now = this.now();
    if (session) {
      // Messwerte (Plan 21.10.2026, M5): Zähler und Zeiten, nie Text.
      this.log.info("dictation_session", {
        target: session.target,
        app: session.target === "insert" ? session.app : null,
        locale: this.getLocale(),
        engine: this.engine,
        durationMs: Math.max(0, now - session.startedAt),
        flushMs: this.stopAt === null ? null : Math.max(0, now - this.stopAt),
        finals: session.finals,
        chars: session.text.length,
        replacements: session.replacements,
        failed: session.failed,
        voiceProcessing: this.microphone?.voiceProcessing ?? null,
        device: this.microphone?.device ?? null,
      });
    }
    if (session && session.text.trim()) this.emit("session", session);
    this.setState("idle");
    const sink = this.sink();
    if (sink) {
      sink.update({ active: false, level: 0, partial: "", reason: linger ? this.hudState.message : null });
      return;
    }
    if (linger) {
      this.scheduleHide(this.errorLingerMs);
      return;
    }
    // Rückmeldung in der Pille (Phase 2): „Eingefügt · n Zeichen“ kurz, ein
    // gescheitertes Einsetzen bleibt lesbar stehen – vorher verschwand die Pille
    // sofort, und man wusste nicht, ob der Satz angekommen war.
    const text = session?.text.trim() ?? "";
    if (session && text && session.failed) {
      this.setHud({ phase: "error", level: 0, partial: "", message: "Nicht eingefügt – der Text steht im Diktat-Verlauf (⌥␣, dann ⌘2)." });
      this.scheduleHide(this.errorLingerMs);
      return;
    }
    if (session && text) {
      this.setHud({ phase: "inserted", level: 0, partial: "", message: `Eingefügt · ${text.length} ${text.length === 1 ? "Zeichen" : "Zeichen"}` });
      this.scheduleHide(INSERTED_LINGER_MS);
      return;
    }
    this.clearHideTimer();
    this.hud.hide();
  }

  private scheduleHide(ms: number): void {
    this.clearHideTimer();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (this.state === "idle") this.hud.hide();
    }, ms);
    this.hideTimer.unref?.();
  }

  private clearHideTimer(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private setState(next: DictationState): void {
    if (this.state === next) return;
    this.state = next;
    this.emit("state", next);
  }

  private setHud(patch: Partial<HudState>): void {
    this.hudState = { ...this.hudState, ...patch };
    const sink = this.sink();
    if (sink) {
      const s = this.hudState;
      const active = s.phase === "starting" || s.phase === "listening";
      const problem = s.phase === "unavailable" || s.phase === "error";
      sink.update({ active, level: s.level, partial: s.partial, reason: problem ? s.message : null });
      return;
    }
    this.hud.update(this.hudState);
  }
}

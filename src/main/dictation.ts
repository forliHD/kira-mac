// Globales Diktat: Hotkey schaltet um, der Helfer erkennt auf dem Apple-Chip
// (`stt.start`), jedes `stt.final` läuft durch die Diktierbefehle und wird mit
// `text.insert` in das vorderste Programm gesetzt. Das HUD zeigt Pegel,
// flüchtigen Text und das Zielprogramm. Ohne Apple-Spracherkennung gibt es
// einen klaren Hinweis mit Grund – keinen Rückfall auf den Server (Owner-
// Entscheid: Audio verlässt beim globalen Diktat den Mac nie).
// Kein Electron-Import: Helfer, Server-Zugriff und HUD werden injiziert
// (tests/dictation.test.ts).

import { EventEmitter } from "node:events";

import { applyDictationCommands, joinDictation } from "../shared/dictationText.js";
import {
  type FrontmostApp,
  type HelperEvent,
  type HelperInfo,
  type HelperSttStatus,
  type PermissionsStatus,
  type SttEnded,
} from "../shared/helper-types";
import { type HudState } from "../shared/local-api";
import { type Logger, silentLogger } from "../shared/logger";

export const DICTATION_STREAM_ID = "dictation";
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

/** Wohin erkannter Text geht: ins vorderste Programm oder ins Schnellfenster. */
export type DictationTarget = "insert" | "quick";

/** Diktat ins Schnellfenster: kein HUD, keine Bedienungshilfen-Freigabe nötig. */
export interface DictationQuickSink {
  update(state: { active: boolean; level: number; partial: string; reason: string | null }): void;
  insert(text: string): void;
}

export interface DictationOptions {
  helper: DictationHelper;
  server: DictationServer;
  hud: DictationHud;
  /** Ziel beim Start, wenn `toggle()` ohne Ziel gerufen wird (Standard: insert). */
  getTarget?: () => DictationTarget;
  quick?: DictationQuickSink;
  getLocale: () => string;
  getCommandsEnabled: () => boolean;
  log?: Logger;
  now?: () => number;
  /** Wie lange ein Fehlerhinweis im HUD stehen bleibt. */
  errorLingerMs?: number;
}

export type DictationState = "idle" | "starting" | "listening" | "stopping";

export interface DictationEvents {
  state: [DictationState];
  inserted: [{ text: string; method: string }];
  unavailable: [string];
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

export class GlobalDictation extends EventEmitter<DictationEvents> {
  private readonly helper: DictationHelper;
  private readonly server: DictationServer;
  private readonly hud: DictationHud;
  private readonly getLocale: () => string;
  private readonly getCommandsEnabled: () => boolean;
  private readonly log: Logger;
  private readonly now: () => number;
  private readonly errorLingerMs: number;
  private readonly getTarget: (() => DictationTarget) | undefined;
  private readonly quick: DictationQuickSink | undefined;
  private target: DictationTarget = "insert";

  private state: DictationState = "idle";
  /** Zählt Starts; ein `start()`, dessen Zahl nicht mehr stimmt, wurde abgebrochen. */
  private generation = 0;
  /** `stt.start` ist unterwegs – ein Stopp muss die Antwort abwarten, sonst läuft der Stream weiter. */
  private sttStarting = false;
  /** Abgebrochen (`cancel`): ausstehende `stt.final` nicht mehr einsetzen. */
  private discard = false;
  private vocabulary: { terms: string[]; fetchedAt: number } | null = null;
  private previousTail = "";
  private hudState: HudState = { phase: "starting", level: 0, partial: "", app: null, message: null };
  private readonly onHelperEvent = (ev: HelperEvent): void => this.handleHelperEvent(ev);
  private hideTimer: NodeJS.Timeout | null = null;

  constructor(options: DictationOptions) {
    super();
    this.helper = options.helper;
    this.server = options.server;
    this.hud = options.hud;
    this.getLocale = options.getLocale;
    this.getCommandsEnabled = options.getCommandsEnabled;
    this.log = options.log ?? silentLogger;
    this.now = options.now ?? (() => Date.now());
    this.errorLingerMs = options.errorLingerMs ?? 4_000;
    this.getTarget = options.getTarget;
    this.quick = options.quick;
    this.helper.on("event", this.onHelperEvent);
  }

  get currentState(): DictationState {
    return this.state;
  }

  get currentTarget(): DictationTarget {
    return this.target;
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
    this.target = wanted === "quick" && this.quick ? "quick" : "insert";
    this.discard = false;
    this.setState("starting");
    this.clearHideTimer();
    this.previousTail = "";
    this.setHud({ phase: "starting", level: 0, partial: "", app: null, message: null });
    if (this.target === "insert") this.hud.show();

    // Nach jedem Warten: wurde inzwischen gestoppt/abgebrochen (z. B. fn
    // nur kurz gehalten), hat stop()/cancel() schon aufgeräumt.
    const avail = await this.availability();
    if (generation !== this.generation) return;
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
    this.setHud({ app: this.target === "quick" ? "KIRA" : (front?.name ?? null) });

    this.sttStarting = true;
    try {
      await this.helper.request("stt.start", {
        stream: DICTATION_STREAM_ID,
        locale: this.getLocale(),
        contextualStrings,
        source: "microphone",
      });
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

  /** Abbruch: Pille sofort weg, Schnellfenster wieder ruhig – ohne Meldung. */
  private dismiss(): void {
    this.clearHideTimer();
    this.hudState = { ...this.hudState, phase: "stopping", level: 0, partial: "", message: null };
    if (this.target === "quick") this.quick?.update({ active: false, level: 0, partial: "", reason: null });
    else this.hud.hide();
  }

  /** Die Begriffe: Cache für eine Stunde, Server-Fehler ergeben die Mindestliste. */
  async contextualStrings(): Promise<string[]> {
    const cached = this.vocabulary;
    if (cached && this.now() - cached.fetchedAt < VOCABULARY_TTL_MS) return cached.terms;
    let vocabulary: string | null = null;
    let displayName: string | null = null;
    try {
      [vocabulary, displayName] = await Promise.all([this.server.fetchVocabulary(), this.server.fetchDisplayName()]);
    } catch (err) {
      this.log.warn("dictation_vocabulary_failed", { error: err instanceof Error ? err.message : String(err) });
    }
    const terms = buildContextualStrings(displayName, vocabulary);
    if (vocabulary !== null || displayName !== null) this.vocabulary = { terms, fetchedAt: this.now() };
    return terms;
  }

  /** Erzwingt eine Erneuerung beim nächsten Start (z. B. nach Sitzungswechsel). */
  invalidateVocabulary(): void {
    this.vocabulary = null;
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
    // Ins Schnellfenster setzt KIRA selbst ein – dafür braucht es keine Bedienungshilfen.
    if (this.target === "quick") return null;
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
      case "stt.final":
        if (this.discard) break; // abgebrochen: nichts mehr einsetzen
        void this.insertFinal(typeof data.text === "string" ? data.text : "");
        break;
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
    const { text, op } = applyDictationCommands(raw, { enabled: this.getCommandsEnabled() });
    if (op === "undo") {
      // In fremden Programmen gibt es kein verlässliches Rückgängig der
      // letzten Äußerung – wir weisen nur hin, statt etwas Falsches zu löschen.
      this.setHud({ partial: "", message: "„Rückgängig“ gilt nur im KIRA-Diktat." });
      return;
    }
    if (!text) return;
    if (this.target === "quick" && this.quick) {
      // Die Seite fügt an der Cursorposition ein und kümmert sich um Leerzeichen.
      this.quick.insert(text);
      this.setHud({ partial: "", message: null });
      this.emit("inserted", { text, method: "quick" });
      return;
    }
    const piece = pieceToInsert(this.previousTail, text);
    if (!piece) return;
    try {
      const res = await this.helper.request<{ method: string }>("text.insert", { text: piece, mode: "auto" });
      this.previousTail = piece.slice(-2);
      this.setHud({ partial: "", message: null });
      this.emit("inserted", { text: piece, method: res?.method ?? "?" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn("dictation_insert_failed", { error: message });
      this.setHud({ message: `Einfügen fehlgeschlagen: ${message}` });
    }
  }

  private failStart(reason: string): void {
    this.log.info("dictation_unavailable", { reason });
    this.setHud({ phase: "unavailable", message: reason, level: 0, partial: "" });
    this.emit("unavailable", reason);
    this.setState("idle");
    this.scheduleHide(this.errorLingerMs);
  }

  private finish(linger = false): void {
    this.sttStarting = false;
    this.setState("idle");
    if (this.target === "quick") {
      this.quick?.update({ active: false, level: 0, partial: "", reason: linger ? this.hudState.message : null });
      return;
    }
    if (linger) this.scheduleHide(this.errorLingerMs);
    else {
      this.clearHideTimer();
      this.hud.hide();
    }
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
    if (this.target === "quick" && this.quick) {
      const s = this.hudState;
      const active = s.phase === "starting" || s.phase === "listening";
      const problem = s.phase === "unavailable" || s.phase === "error";
      this.quick.update({ active, level: s.level, partial: s.partial, reason: problem ? s.message : null });
      return;
    }
    this.hud.update(this.hudState);
  }
}

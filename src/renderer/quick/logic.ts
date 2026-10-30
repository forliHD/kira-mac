// Reine Hilfen des Schnellfensters (ohne React/DOM), damit vitest sie in Node
// prüfen kann: Texte der Pillen, Tastenbelegung, Kürzel-Darstellung,
// Einfügen von Diktat-Text, Höhenmeldung.

import { insertAtCaret } from "../../shared/dictationText.js";
import { FN_LABEL, isFnHotkey } from "../../shared/hotkey";
import { type DictationEntry, type QuickMessage, type QuickSendKey, type QuickState, type QuickTool } from "../../shared/local-api";

export type Tone = "ok" | "warn" | "err" | "idle";
export type QuickMode = QuickState["mode"];

/** Verbindungspille in der Kopfzeile. */
export function connectionPill(state: Pick<QuickState, "mode" | "connection"> | null): { tone: Tone; text: string } {
  if (!state) return { tone: "idle", text: "Verbinde…" };
  switch (state.mode) {
    case "server": {
      const label = state.connection.label.trim();
      return { tone: "ok", text: label ? `Verbunden · ${label}` : "Verbunden" };
    }
    case "local":
      return { tone: "warn", text: "Offline · Apple-Modell auf diesem Mac" };
    default:
      return { tone: "err", text: "Offline" };
  }
}

/**
 * Kurzer Name der Instanz für die Fußleiste: „kira-dev.it-reiser.cloud“ →
 * „kira-dev“; zweiteilige Namen und Adressen bleiben ganz.
 */
export function shortHost(label: string): string {
  const t = label.trim();
  const parts = t.split(".");
  if (parts.length >= 3 && parts[0] && !/^\d+$/.test(parts[0])) return parts[0];
  return t;
}

/** Status in der Fußleiste (Phase 3): Punkt + kurzer Text, die Erklärung als Tooltip. */
export function statusChip(state: Pick<QuickState, "mode" | "connection"> | null): { tone: Tone; text: string; title: string } {
  if (!state) return { tone: "idle", text: "Verbinde…", title: "Verbindung zum KIRA-Server wird aufgebaut." };
  switch (state.mode) {
    case "server": {
      const label = state.connection.label.trim();
      return { tone: "ok", text: label ? shortHost(label) : "Verbunden", title: `Verbunden${label ? ` · ${label}` : ""} · Antworten landen im Chat-Verlauf.` };
    }
    case "local":
      return { tone: "warn", text: "Apple-Modell", title: "Offline · das Apple-Sprachmodell auf diesem Mac antwortet, nichts wird gespeichert." };
    default:
      return { tone: "err", text: "Offline", title: "Keine Verbindung zu KIRA." };
  }
}

/** Welche Stufe das Fenster hat: die Leiste (leer) oder die Gesprächshöhe (Chat mit Nachrichten, Diktate). */
export function quickStage(view: "chat" | "dictations", hasMessages: boolean, busy: boolean): "bar" | "tall" {
  if (view === "dictations") return "tall";
  return hasMessages || busy ? "tall" : "bar";
}

/** Pille rechts in der Fußzeile: wohin die Antworten gehen. */
export function footerNote(mode: QuickMode | null): { icon: "history" | "chip" | "off"; text: string } {
  switch (mode) {
    case "local":
      return { icon: "chip", text: "Ohne Verbindung: Apple-Modell" };
    case "offline":
      return { icon: "off", text: "Keine Verbindung" };
    default:
      return { icon: "history", text: "Antworten landen im Chat-Verlauf" };
  }
}

export interface Suggestion {
  label: string;
  /** Text, der ins Eingabefeld kommt (nicht gesendet). */
  fill: string;
}

/** Vorschläge im leeren Zustand – lokal nur, was ohne Server geht. Offline: keine. */
export function suggestionsFor(mode: QuickMode | null): Suggestion[] {
  if (mode === "offline") return [];
  if (mode === "local") {
    return [
      { label: "Formuliere eine kurze Antwort …", fill: "Formuliere eine kurze Antwort auf: " },
      { label: "Übersetze ins Englische …", fill: "Übersetze ins Englische: " },
      { label: "Kürze diesen Text …", fill: "Kürze diesen Text: " },
    ];
  }
  return [
    { label: "Was steht heute an?", fill: "Was steht heute an?" },
    { label: "Fasse meine neuen Mails zusammen", fill: "Fasse meine neuen Mails zusammen" },
    { label: "Formuliere eine kurze Antwort …", fill: "Formuliere eine kurze Antwort auf " },
  ];
}

export const OFFLINE_HINT = "Keine Verbindung zu KIRA und kein Apple-Modell auf diesem Mac bereit. Antworten gibt es wieder, sobald die Verbindung steht.";

export function stoppedNote(local: boolean): string {
  return local ? "Gestoppt." : "Gestoppt – KIRA arbeitet im Hintergrund weiter, die Antwort steht im Chat.";
}

export const LOCAL_NOTE = "Lokal auf diesem Mac · ohne KIRA-Server · nicht gespeichert";

// ── Tasten ──────────────────────────────────────────────────────────────

export interface KeyInfo {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** IME-Komposition (z. B. Akzente, Japanisch): dann nichts abfangen. */
  isComposing: boolean;
}

export type QuickKeyAction = "hide" | "open-main" | "reset" | "view-chat" | "view-dictations" | null;

/**
 * Tasten am Wurzelelement. Bewusst eng: nur Esc, „Im Hauptfenster“ und ⌘N;
 * alles andere (auch ⌘⇧D fürs globale Diktat, ⌘C/⌘V/⌘A) läuft unverändert
 * weiter. Sendet ⌘↩ (Einstellung), öffnet ⌘⇧↩ das Hauptfenster.
 */
export function keyAction(k: KeyInfo, ctx: { hasSession: boolean; sendKey?: QuickSendKey }): QuickKeyAction {
  if (k.isComposing) return null;
  const plain = !k.metaKey && !k.ctrlKey && !k.altKey && !k.shiftKey;
  const cmdOnly = k.metaKey && !k.ctrlKey && !k.altKey && !k.shiftKey;
  const cmdShift = k.metaKey && !k.ctrlKey && !k.altKey && k.shiftKey;
  if (k.key === "Escape" && plain) return "hide";
  const openMain = ctx.sendKey === "cmd-enter" ? cmdShift : cmdOnly;
  if (k.key === "Enter" && openMain) return ctx.hasSession ? "open-main" : null;
  if ((k.key === "n" || k.key === "N") && cmdOnly) return "reset";
  // Ansicht wechseln: ⌘1 Chat, ⌘2 Diktate (Owner-Wunsch 02.10.2026).
  if (k.key === "1" && cmdOnly) return "view-chat";
  if (k.key === "2" && cmdOnly) return "view-dictations";
  return null;
}

// ── Diktate-Ansicht ─────────────────────────────────────────────────────

/** Suche über Text und Programm: jedes Wort muss vorkommen (Groß/klein egal). */
export function filterDictations(entries: readonly DictationEntry[], query: string): DictationEntry[] {
  const words = query.toLocaleLowerCase("de-DE").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((e) => {
    const hay = `${e.text} ${e.app ?? ""}`.toLocaleLowerCase("de-DE");
    return words.every((w) => hay.includes(w));
  });
}

/** „gerade eben“, „vor 4 Min.“, „heute 13:52“, „gestern 11:56“, „28.09. 09:10“. */
export function dictationTime(at: number, now: number = Date.now()): string {
  const diff = now - at;
  if (diff < 60_000) return "gerade eben";
  if (diff < 60 * 60_000) return `vor ${Math.floor(diff / 60_000)} Min.`;
  const date = new Date(at);
  const time = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const day = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(date)) / 86_400_000);
  if (days === 0) return `heute ${time}`;
  if (days === 1) return `gestern ${time}`;
  return `${date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${time}`;
}

/** Uhrzeit innerhalb einer Tagesgruppe: „gerade eben“, „vor 4 Min.“, sonst „13:52“. */
export function dictationClock(at: number, now: number = Date.now()): string {
  const diff = now - at;
  if (diff < 60_000) return "gerade eben";
  if (diff < 60 * 60_000) return `vor ${Math.floor(diff / 60_000)} Min.`;
  return new Date(at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

export interface DictationGroup {
  key: string;
  /** „Heute“, „Gestern“, sonst „Mo., 28.09.“ */
  label: string;
  entries: DictationEntry[];
}

/** Diktate nach Tagen gruppiert (Reihenfolge der Einträge bleibt: neueste zuerst). */
export function groupDictations(entries: readonly DictationEntry[], now: number = Date.now()): DictationGroup[] {
  const day = (ms: number): number => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const today = day(now);
  const groups: DictationGroup[] = [];
  for (const entry of entries) {
    const key = String(day(entry.at));
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      const days = Math.round((today - day(entry.at)) / 86_400_000);
      const label = days === 0 ? "Heute" : days === 1 ? "Gestern" : new Date(entry.at).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
      group = { key, label, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

/** Auswahl mit ↑/↓: bleibt im Bereich, ohne Einträge -1. */
export function moveSelection(index: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  if (index < 0) return delta > 0 ? 0 : length - 1;
  return Math.max(0, Math.min(length - 1, index + delta));
}

/**
 * Ausgewählte Karte im Verlauf sichtbar machen: neue `scrollTop` oder null,
 * wenn sie schon ganz sichtbar ist. `top`/`bottom` relativ zum Inhalt des
 * Verlaufs. Ist die Karte höher als der Bereich, zählt ihr Anfang. Ersetzt
 * `scrollIntoView`, das auch die Wurzel (overflow: hidden) und die Seite
 * verschob.
 */
export function revealScrollTop(scrollTop: number, viewHeight: number, top: number, bottom: number): number | null {
  if (top < scrollTop || bottom - top > viewHeight) return top === scrollTop ? null : Math.max(0, Math.floor(top));
  if (bottom > scrollTop + viewHeight) return Math.ceil(bottom - viewHeight);
  return null;
}

/**
 * Sendetaste je Einstellung: ↩ ohne Modifikator (⇧↩ = Zeile) oder ⌘↩
 * (↩ = Zeile). Eine IME-Bestätigung sendet nie.
 */
export function isSubmitKey(k: KeyInfo, sendKey: QuickSendKey = "enter"): boolean {
  if (k.key !== "Enter" || k.isComposing || k.ctrlKey || k.altKey) return false;
  if (sendKey === "cmd-enter") return k.metaKey && !k.shiftKey;
  return !k.shiftKey && !k.metaKey;
}

/** Tastenhinweise der Fußleiste: Taste(n) + Wort. */
export interface KeyHint {
  keys: string;
  label: string;
}

export function footerHints(view: "chat" | "dictations", hasSession: boolean, sendKey: QuickSendKey = "enter"): KeyHint[] {
  if (view === "dictations") {
    return [
      { keys: "↩", label: "kopieren" },
      { keys: "⌘↩", label: "in den Chat" },
      { keys: "esc", label: "schließen" },
    ];
  }
  const hints: KeyHint[] = [{ keys: sendKey === "cmd-enter" ? "⌘↩" : "↩", label: "senden" }];
  if (hasSession) hints.push({ keys: sendKey === "cmd-enter" ? "⌘⇧↩" : "⌘↩", label: "Hauptfenster" });
  hints.push({ keys: "esc", label: "schließen" });
  return hints;
}

export interface HintFit {
  /** Wie viele Hinweise (von vorn) sichtbar sind. */
  count: number;
  /** false = nur die Tastenkappen, die Wörter stehen in title/Vorlesetext. */
  labels: boolean;
}

/**
 * Was von den Hinweisen in die Fußleiste passt – nie ein halbes Wort
 * (Owner-Befund 22.10.2026: „esc schließ…“ unter dem Mülleimer). Erst fallen
 * die Wörter weg, dann ganze Hinweise von hinten. `full`/`caps` sind die
 * gemessenen Breiten je Hinweis mit bzw. ohne Wort, `gap` der Abstand
 * dazwischen, `available` die freie Breite.
 */
export function fitHints(full: readonly number[], caps: readonly number[], gap: number, available: number): HintFit {
  // Halbe Pixel aus dem Runden der Messung sollen keinen Hinweis kosten.
  const room = available + 0.5;
  const width = (widths: readonly number[], n: number): number => widths.slice(0, n).reduce((sum, w) => sum + w, 0) + gap * Math.max(0, n - 1);
  if (width(full, full.length) <= room) return { count: full.length, labels: true };
  for (let n = caps.length; n > 0; n--) {
    if (width(caps, n) <= room) return { count: n, labels: false };
  }
  return { count: 0, labels: false };
}

const MODIFIER_GLYPHS: Record<string, string> = {
  control: "⌃",
  ctrl: "⌃",
  alt: "⌥",
  option: "⌥",
  altgr: "⌥",
  shift: "⇧",
  command: "⌘",
  cmd: "⌘",
  commandorcontrol: "⌘",
  cmdorctrl: "⌘",
  super: "⌘",
  meta: "⌘",
};
const MODIFIER_ORDER = ["⌃", "⌥", "⇧", "⌘"];
const KEY_GLYPHS: Record<string, string> = {
  space: "␣",
  enter: "↩",
  return: "↩",
  escape: "esc",
  esc: "esc",
  tab: "⇥",
  backspace: "⌫",
  delete: "⌦",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  plus: "+",
};

/** Electron-Kürzel („Alt+Space“, „CommandOrControl+Shift+D“) → Mac-Zeichen in Apple-Reihenfolge; „Fn“ → „🌐 fn“. */
export function formatAccelerator(accelerator: string): string[] {
  if (isFnHotkey(accelerator)) return [FN_LABEL];
  const parts = accelerator
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  const mods = new Set<string>();
  let key = "";
  for (const part of parts) {
    const glyph = MODIFIER_GLYPHS[part.toLowerCase()];
    if (glyph) mods.add(glyph);
    else key = KEY_GLYPHS[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part);
  }
  const out = MODIFIER_ORDER.filter((m) => mods.has(m));
  if (key) out.push(key);
  return out;
}

/** Kappe nur aus Mac-Symbolen (⌘↩, ⌥␣)? Die werden größer gesetzt als „esc“. */
export function isSymbolCap(text: string): boolean {
  return /^[⌃⌥⇧⌘↩␣⇥⌫⌦↑↓←→]+$/u.test(text);
}

// ── Eingabe ─────────────────────────────────────────────────────────────

/**
 * Diktat-Text an der Cursorposition einfügen – mit der Leerzeichen-Logik des
 * Dashboards (kein doppeltes Leerzeichen, keins vor Satzzeichen).
 */
export function insertText(value: string, selStart: number | null, selEnd: number | null, text: string): { value: string; caret: number } {
  const result = insertAtCaret(value, selStart, selEnd, text);
  return { value: result.value, caret: result.caret };
}

// ── Nachrichten ─────────────────────────────────────────────────────────

/** Aktivitätszeile eines laufenden Zugs – leer, wenn ein laufender Werkzeug-Chip dasselbe sagt. */
export function activityLine(message: Pick<QuickMessage, "status" | "text" | "activity" | "tools">): string | null {
  if (message.status !== "streaming" || message.text) return null;
  const activity = message.activity?.trim() || "Denkt nach…";
  const running = message.tools.find((t: QuickTool) => t.status === "running");
  if (running && activity.replace(/…$/, "").trim() === running.label.trim()) return null;
  return activity;
}

// ── Höhe ────────────────────────────────────────────────────────────────

/**
 * Gewünschte Fensterhöhe: was die Seite zeigt, plus was im Nachrichtenbereich
 * gerade weggescrollt ist (der Hauptprozess begrenzt auf den Bildschirm).
 */
export function desiredHeight(rootScrollHeight: number, threadScrollHeight: number, threadClientHeight: number): number {
  return Math.ceil(rootScrollHeight + Math.max(0, threadScrollHeight - threadClientHeight));
}

/** Nur melden, wenn sich etwas um mehr als 1 px geändert hat. */
export function shouldReport(last: number | null, next: number): boolean {
  return next > 0 && (last === null || Math.abs(next - last) > 1);
}

/** Pegel des Mikrofons (0…1, leise Stimmen sichtbar machen – wie das HUD). */
export function micLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(1, level * 2.2));
}

/** Ende des flüchtigen Diktat-Texts (das Neueste zählt), an einer Wortgrenze gekürzt. */
export function partialPreview(text: string, max = 96): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const tail = t.slice(-max);
  const cut = tail.indexOf(" ");
  return `… ${cut > 0 && cut < 24 ? tail.slice(cut + 1) : tail}`;
}

export interface ToolGroup {
  label: string;
  status: QuickTool["status"];
  count: number;
}

/** Gleiche Werkzeuge zu einem Chip bündeln („Liest eine Mail ×3“); läuft eins davon, läuft der Chip. */
export function groupTools(tools: QuickTool[]): ToolGroup[] {
  const groups: ToolGroup[] = [];
  for (const tool of tools) {
    const label = (tool.label || tool.name).trim();
    const existing = groups.find((g) => g.label === label);
    if (!existing) {
      groups.push({ label, status: tool.status, count: 1 });
      continue;
    }
    existing.count++;
    if (tool.status === "running" || (tool.status === "error" && existing.status === "done")) existing.status = tool.status;
  }
  return groups;
}

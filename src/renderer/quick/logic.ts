// Reine Hilfen des Schnellfensters (ohne React/DOM), damit vitest sie in Node
// prüfen kann: Texte der Pillen, Tastenbelegung, Kürzel-Darstellung,
// Einfügen von Diktat-Text, Höhenmeldung.

import { insertAtCaret } from "../../shared/dictationText.js";
import { type QuickMessage, type QuickState, type QuickTool } from "../../shared/local-api";

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

export type QuickKeyAction = "hide" | "open-main" | "reset" | null;

/**
 * Tasten am Wurzelelement. Bewusst eng: nur Esc, ⌘↩ und ⌘N; alles andere
 * (auch ⌘⇧D fürs globale Diktat, ⌘C/⌘V/⌘A) läuft unverändert weiter.
 */
export function keyAction(k: KeyInfo, ctx: { hasSession: boolean }): QuickKeyAction {
  if (k.isComposing) return null;
  const plain = !k.metaKey && !k.ctrlKey && !k.altKey && !k.shiftKey;
  const cmdOnly = k.metaKey && !k.ctrlKey && !k.altKey && !k.shiftKey;
  if (k.key === "Escape" && plain) return "hide";
  if (k.key === "Enter" && cmdOnly) return ctx.hasSession ? "open-main" : null;
  if ((k.key === "n" || k.key === "N") && cmdOnly) return "reset";
  return null;
}

/** ↩ ohne Umschalt/Modifikator sendet; ⇧↩ (und IME-Bestätigung) nicht. */
export function isSubmitKey(k: KeyInfo): boolean {
  return k.key === "Enter" && !k.isComposing && !k.shiftKey && !k.metaKey && !k.ctrlKey && !k.altKey;
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

/** Electron-Kürzel („Alt+Space“, „CommandOrControl+Shift+D“) → Mac-Zeichen in Apple-Reihenfolge. */
export function formatAccelerator(accelerator: string): string[] {
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

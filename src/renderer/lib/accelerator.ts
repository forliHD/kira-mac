// Tastenkürzel der Einstellungen: Tastendruck → Electron-Accelerator und
// Accelerator → Tastenkappen (⌥ ⌘ D). Reine Funktionen ohne DOM und ohne
// React – tests/ui-accelerator.test.ts prüft sie in Node.
//
// Die Taste kommt aus `KeyboardEvent.code` (physische Position), nicht aus
// `key`: Mit gedrückter ⌥-Taste liefert macOS in `key` Sonderzeichen („∂“ für
// ⌥D, „‚“ für ⌥S), und Electrons globale Kürzel registriert macOS ohnehin über
// virtuelle Tastencodes, also über die Position auf der US-Belegung. So passt
// das Aufgenommene genau zu dem, was der Hauptprozess registriert. Folge auf
// deutscher Tastatur: die mit „Z“ beschriftete Taste wird als „Y“ gespeichert –
// und genau diese Taste löst das Kürzel später auch aus.
//
// „Fn“ (nur fürs Diktat) ist kein aufgenommenes Kürzel, sondern die 🌐 fn-Taste;
// sie wird in den Einstellungen per Auswahl gesetzt und hier nur angezeigt.

import { FN_LABEL, isFnHotkey } from "../../shared/hotkey";

export type Modifier = "Control" | "Alt" | "Shift" | "Command";

/** Reihenfolge wie in macOS-Menüs (⌃⌥⇧⌘). „Alt+Command+D“ entspricht damit dem Standard aus config.ts. */
export const MODIFIER_ORDER: readonly Modifier[] = ["Control", "Alt", "Shift", "Command"];

/** Die Felder eines KeyboardEvent, die die Umwandlung braucht. */
export interface KeyLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type RecordResult =
  /** Esc: Aufnahme abbrechen, altes Kürzel bleibt. */
  | { type: "cancel" }
  /** ⌫ ohne Zusatztaste: Kürzel entfernen (der Hauptprozess registriert leere Kürzel nicht). */
  | { type: "clear" }
  /** Bisher nur Zusatztasten gedrückt – weiter warten, die gehaltenen zeigen. */
  | { type: "partial"; modifiers: Modifier[] }
  /** Kombination taugt nicht als globales Kürzel; `message` sagt warum. */
  | { type: "invalid"; modifiers: Modifier[]; message: string }
  | { type: "done"; accelerator: string };

const MODIFIER_CODES = new Set([
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "CapsLock",
  "Fn",
  "FnLock",
]);
const MODIFIER_KEYS = new Set(["Meta", "OS", "Control", "Alt", "AltGraph", "Shift", "CapsLock", "Fn", "FnLock"]);

const ALIASES: Record<string, Modifier> = {
  command: "Command",
  cmd: "Command",
  commandorcontrol: "Command",
  cmdorctrl: "Command",
  super: "Command",
  meta: "Command",
  control: "Control",
  ctrl: "Control",
  alt: "Alt",
  option: "Alt",
  altgr: "Alt",
  shift: "Shift",
};

const SYMBOL: Record<Modifier, string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Command: "⌘" };
const SPOKEN: Record<Modifier, string> = { Control: "Control", Alt: "Wahltaste", Shift: "Umschalttaste", Command: "Befehlstaste" };

export const KEY_HINT = "Nimm einen Buchstaben, eine Ziffer, die Leertaste oder eine F-Taste.";

function sortModifiers(mods: Iterable<Modifier>): Modifier[] {
  const set = new Set(mods);
  return MODIFIER_ORDER.filter((m) => set.has(m));
}

export function modifiersOf(e: KeyLike): Modifier[] {
  const mods: Modifier[] = [];
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Command");
  return mods;
}

/** Taste aus der physischen Position: Buchstaben, Ziffern, F1–F24, Leertaste. */
export function keyFromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1] ?? null;
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1] ?? null;
  const fn = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code);
  if (fn) return `F${fn[1] ?? ""}`;
  if (code === "Space") return "Space";
  return null;
}

/** Rückfall, falls `code` fehlt (synthetische Ereignisse): nur eindeutige Fälle. */
function keyFromKey(key: string): string | null {
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key;
  if (key === " " || key === "Spacebar") return "Space";
  return null;
}

/** Kombinationen, die macOS oder praktisch jedes Programm selbst braucht. */
function reservedReason(modifiers: Modifier[], key: string): string | null {
  const combo = [...modifiers, key].join("+");
  switch (combo) {
    case "Command+Space":
      return "⌘ Leertaste öffnet Spotlight.";
    case "Control+Space":
      return "⌃ Leertaste wechselt die Eingabequelle.";
    case "Control+Command+Space":
      return "⌃⌘ Leertaste öffnet die Zeichenübersicht.";
    case "Shift+Command+3":
    case "Shift+Command+4":
    case "Shift+Command+5":
      return "⇧⌘3, ⇧⌘4 und ⇧⌘5 sind die Bildschirmfotos von macOS.";
    case "Shift+Command+Q":
      return "⇧⌘Q meldet dich von macOS ab.";
    case "Control+Command+Q":
      return "⌃⌘Q sperrt den Bildschirm.";
    case "Alt+Command+D":
      return "⌥⌘D blendet das Dock ein und aus.";
    case "Control+Command+D":
      return "⌃⌘D schlägt das Wort unter dem Zeiger nach.";
    case "Control+Command+F":
      return "⌃⌘F schaltet den Vollbildmodus.";
    default:
      break;
  }
  if (modifiers.length === 1 && modifiers[0] === "Command" && !/^F\d+$/.test(key)) {
    return "⌘ mit einer einzelnen Taste brauchen die Programme selbst (⌘C, ⌘V …). Nimm ⌥ oder ⌃ dazu.";
  }
  return null;
}

/** Ein Tastendruck während der Aufnahme → was die Aufnahme damit macht. */
export function acceleratorFromEvent(e: KeyLike): RecordResult {
  const modifiers = modifiersOf(e);
  if (e.code === "Escape" || e.key === "Escape") return { type: "cancel" };
  const isDelete = e.code === "Backspace" || e.code === "Delete" || e.key === "Backspace" || e.key === "Delete";
  if (isDelete && modifiers.length === 0) return { type: "clear" };
  if (MODIFIER_CODES.has(e.code) || MODIFIER_KEYS.has(e.key)) return { type: "partial", modifiers };

  const key = keyFromCode(e.code) ?? (!e.code || e.code === "Unidentified" ? keyFromKey(e.key) : null);
  if (!key) return { type: "invalid", modifiers, message: `Diese Taste geht nicht. ${KEY_HINT}` };

  const isFunctionKey = /^F\d+$/.test(key);
  const strong = modifiers.filter((m) => m !== "Shift");
  if (!isFunctionKey && strong.length === 0) {
    return {
      type: "invalid",
      modifiers,
      message: modifiers.length ? "Mit ⇧ allein geht das nicht – nimm ⌘, ⌥ oder ⌃ dazu." : "Nimm mindestens eine der Tasten ⌘, ⌥ oder ⌃ dazu.",
    };
  }
  const reserved = reservedReason(modifiers, key);
  if (reserved) return { type: "invalid", modifiers, message: reserved };
  return { type: "done", accelerator: [...modifiers, key].join("+") };
}

/** Zerlegt einen Accelerator (beliebige Schreibweise, Aliase wie CmdOrCtrl). */
export function parseAccelerator(value: string): { modifiers: Modifier[]; key: string | null } {
  const parts = value
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  const mods: Modifier[] = [];
  let key: string | null = null;
  for (const part of parts) {
    const alias = ALIASES[part.toLowerCase()];
    if (alias) mods.push(alias);
    else key = part.length === 1 ? part.toUpperCase() : part;
  }
  return { modifiers: sortModifiers(mods), key };
}

/** Einheitliche Schreibweise (Zusatztasten in macOS-Reihenfolge) – zum Vergleichen. */
export function normalizeAccelerator(value: string): string {
  const { modifiers, key } = parseAccelerator(value);
  const k = key === null ? null : /^space$/i.test(key) ? "Space" : key;
  return [...modifiers, ...(k ? [k] : [])].join("+");
}

export function sameAccelerator(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false;
  return normalizeAccelerator(a).toLowerCase() === normalizeAccelerator(b).toLowerCase();
}

/** Beschriftung einer Taste auf der Kappe. */
export function keySymbol(key: string): string {
  switch (key.toLowerCase()) {
    case "fn":
      return FN_LABEL;
    case "space":
      return "␣";
    case "return":
    case "enter":
      return "↩";
    case "tab":
      return "⇥";
    case "backspace":
      return "⌫";
    case "delete":
      return "⌦";
    case "escape":
    case "esc":
      return "esc";
    case "up":
      return "↑";
    case "down":
      return "↓";
    case "left":
      return "←";
    case "right":
      return "→";
    case "plus":
      return "+";
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

/** Tastenkappen in Anzeige-Reihenfolge: „Alt+Command+D“ → ["⌥", "⌘", "D"]. */
export function acceleratorKeys(value: string): string[] {
  const { modifiers, key } = parseAccelerator(value);
  return [...modifiers.map((m) => SYMBOL[m]), ...(key ? [keySymbol(key)] : [])];
}

/** Kurzform für Fließtext und Menüs: „⌥⌘D“. */
export function describeAccelerator(value: string): string {
  return acceleratorKeys(value).join("");
}

/** Gehaltene Zusatztasten während der Aufnahme: ["⌥", "⌘"]. */
export function modifierSymbols(modifiers: readonly Modifier[]): string[] {
  return sortModifiers(modifiers).map((m) => SYMBOL[m]);
}

/** Für Bildschirmleser: „Wahltaste Befehlstaste D“. */
export function spokenAccelerator(value: string): string {
  if (isFnHotkey(value)) return "fn-Taste (Globus)";
  const { modifiers, key } = parseAccelerator(value);
  if (!modifiers.length && !key) return "kein Kürzel";
  const keyText = key === null ? "" : /^space$/i.test(key) ? "Leertaste" : key;
  return [...modifiers.map((m) => SPOKEN[m]), keyText].filter(Boolean).join(" ");
}

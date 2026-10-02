// Gemeinsames zu den Tastenkürzeln für Hauptprozess und lokale Seiten:
// die 🌐 fn-Taste als Auslöser des globalen Diktats und die Systemeinstellung,
// die macOS beim Drücken von 🌐 selbst ausführt. Kein Electron-Import.
//
// Bewusst NICHT aus den Preloads importieren: ein von beiden Preloads
// genutztes Modul landet als gemeinsamer Chunk und bricht den Sandbox-Preload
// (AGENTS.md, „Fallen“). Typen stehen deshalb in local-api.ts.

import { type FnSystemAction } from "./local-api";

/** Wert von `hotkeys.dictation` für die 🌐 fn-Taste (statt eines Electron-Kürzels). */
export const FN_HOTKEY = "Fn";

/** Anzeige wie auf der Apple-Tastatur (Menüs, Hinweise, Tastenkappen). */
export const FN_LABEL = "🌐 fn";

/** Ist das Kürzel die fn-Taste? (Groß/klein egal.) */
export function isFnHotkey(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "fn";
}

/** Systemeinstellungen → Tastatur (dort steht „🌐 drücken für …“). */
export const KEYBOARD_SETTINGS_URL = "x-apple.systempreferences:com.apple.Keyboard-Settings.extension";

/** Systemeinstellungen, die eine lokale Seite über `openLink` öffnen darf – sonst nichts außer http(s). */
export function isAllowedSettingsUrl(url: string): boolean {
  return url === KEYBOARD_SETTINGS_URL;
}

/**
 * `AppleFnUsageType` (Domäne `com.apple.HIToolbox`) → was macOS selbst beim
 * Drücken von 🌐 tut. Fehlt der Wert, gilt der macOS-Standard.
 */
export function fnSystemActionFrom(value: unknown): FnSystemAction {
  switch (value) {
    case 0:
      return "none";
    case 1:
      return "inputSource";
    case 2:
      return "emoji";
    case 3:
      return "dictation";
    default:
      return "default";
  }
}

/** Name der Option, wie macOS sie in den Tastatur-Einstellungen nennt. */
export function fnSystemActionLabel(action: FnSystemAction): string {
  switch (action) {
    case "none":
      return "Keine Aktion";
    case "inputSource":
      return "Eingabequelle wechseln";
    case "emoji":
      return "Emoji & Symbole";
    case "dictation":
      return "Diktat starten";
    default:
      return "macOS-Standard";
  }
}

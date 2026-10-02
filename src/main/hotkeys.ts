// Globale Tastenkürzel (konfigurierbar). Standard: Schnellfenster Alt+Space,
// globales Diktat Control+Alt+D (⌃⌥D). Konflikte (anderes Programm hält das Kürzel)
// werden gemeldet statt still zu scheitern.

import { globalShortcut } from "electron";

import { type HotkeyConfig } from "../shared/local-api";
import { scoped } from "./log";

const log = scoped("hotkeys");

const MODIFIERS = new Set(["command", "cmd", "control", "ctrl", "commandorcontrol", "cmdorctrl", "alt", "option", "shift", "super", "meta"]);

/** Grobe Prüfung der Electron-Accelerator-Syntax: mindestens eine Taste, Modifier nur vorn. */
export function isValidAccelerator(value: string): boolean {
  const parts = value
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  const keys = parts.filter((p) => !MODIFIERS.has(p.toLowerCase()));
  return keys.length === 1;
}

/** Menschlich lesbar (⌥⌘D) für Menüs und Hinweise. */
export function describeAccelerator(value: string): string {
  return value
    .split("+")
    .map((p) => p.trim())
    .map((p) => {
      switch (p.toLowerCase()) {
        case "command":
        case "cmd":
        case "commandorcontrol":
        case "cmdorctrl":
          return "⌘";
        case "alt":
        case "option":
          return "⌥";
        case "control":
        case "ctrl":
          return "⌃";
        case "shift":
          return "⇧";
        case "space":
          return "Leertaste";
        default:
          return p.length === 1 ? p.toUpperCase() : p;
      }
    })
    .join("");
}

export interface HotkeyHandlers {
  quickWindow: () => void;
  dictation: () => void;
}

/** Registriert beide Kürzel; Rückgabe: Konfliktmeldungen (leer = alles gut). */
export function registerHotkeys(hotkeys: HotkeyConfig, handlers: HotkeyHandlers): string[] {
  globalShortcut.unregisterAll();
  const conflicts: string[] = [];
  const entries: Array<[string, string, () => void]> = [
    ["Schnellfenster", hotkeys.quickWindow, handlers.quickWindow],
    ["Globales Diktat", hotkeys.dictation, handlers.dictation],
  ];
  for (const [label, accelerator, handler] of entries) {
    if (!accelerator) continue;
    if (!isValidAccelerator(accelerator)) {
      conflicts.push(`${label}: „${accelerator}“ ist kein gültiges Tastenkürzel.`);
      continue;
    }
    let ok = false;
    try {
      ok = globalShortcut.register(accelerator, handler);
    } catch (err) {
      conflicts.push(`${label}: „${accelerator}“ konnte nicht registriert werden (${err instanceof Error ? err.message : String(err)}).`);
      continue;
    }
    if (!ok) {
      conflicts.push(`${label}: „${describeAccelerator(accelerator)}“ wird bereits von einem anderen Programm oder macOS belegt.`);
    }
  }
  if (conflicts.length) log.warn("hotkey_conflicts", { conflicts });
  else log.info("hotkeys_registered");
  return conflicts;
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll();
}

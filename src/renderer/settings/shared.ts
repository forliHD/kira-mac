// Gemeinsame Typen der Einstellungsbereiche.

import { type LocalState } from "../../shared/local-api";

export type SectionId = "instanz" | "kuerzel" | "diktat" | "berechtigungen" | "allgemein" | "ueber";

/** Welches Kürzel nach „Ändern“ sofort aufnehmen soll. */
export type HotkeyName = "quickWindow" | "dictation";

export interface SectionProps {
  state: LocalState;
  setState: (state: LocalState) => void;
  refresh: () => Promise<void>;
  go: (section: SectionId, focus?: HotkeyName) => void;
}

const ALIASES: Record<string, SectionId> = {
  instanz: "instanz",
  instance: "instanz",
  kuerzel: "kuerzel",
  tastenkuerzel: "kuerzel",
  hotkeys: "kuerzel",
  diktat: "diktat",
  dictation: "diktat",
  berechtigungen: "berechtigungen",
  permissions: "berechtigungen",
  allgemein: "allgemein",
  general: "allgemein",
  ueber: "ueber",
  about: "ueber",
  updates: "ueber",
};

/** Bereich aus einem Namen („hotkeys“, „kuerzel“ …); unbekannt → null. */
export function sectionFromName(name: string | null | undefined): SectionId | null {
  const key = (name ?? "").toLowerCase();
  // Nur eigene Einträge – „constructor“ & Co. vom Objekt-Prototyp sind kein Bereich.
  return Object.hasOwn(ALIASES, key) ? (ALIASES[key] ?? null) : null;
}

/** Startbereich aus `?section=` (der Hauptprozess kann so gezielt öffnen). */
export function sectionFromQuery(search: string): SectionId {
  return sectionFromName(new URLSearchParams(search).get("section")) ?? "instanz";
}

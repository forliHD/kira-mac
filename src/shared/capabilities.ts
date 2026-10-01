import { type Capability } from "./bridge";
import { type HelperFeatures } from "./helper-types";

/**
 * Leitet die Fähigkeiten der Brücke aus dem `info.features` des Helfers ab.
 * Ohne Helfer (abgestürzt, nicht gebaut) bleiben die reinen Electron-
 * Fähigkeiten; alles, was Apple-Schnittstellen braucht, fehlt dann ehrlich.
 * Die Reihenfolge entspricht der Tabelle im Vertrag.
 */
export function capabilitiesFrom(features: HelperFeatures | null | undefined): Capability[] {
  const caps: Capability[] = ["session", "notifications", "open-external", "quick-window"];
  if (!features) return caps;
  if (features.stt) caps.push("stt");
  if (features.systemAudio) caps.push("system-audio");
  if (features.llm) caps.push("apple-intelligence");
  if (features.insertText) caps.push("insert-text");
  return caps;
}

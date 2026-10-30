// Lage und Höhe des Schnellfensters auf der Arbeitsfläche – ohne Electron,
// damit testbar (tests/quick-geometry.test.ts).
//
// Owner-Wunsch 02.10.2026: höher ansetzen und mehr vom Bildschirm nutzen –
// Oberkante bei 10 %, das Fenster wächst nach unten bis kurz vor den Rand.
// Phase 3 (21.10.2026, 0.5.0): zwei Stufen. Die Leiste (Stufe A) folgt dem
// Inhalt wie bisher; das Gespräch (Stufe B) nimmt EINMAL die Gesprächshöhe an
// (Anteil der Arbeitsfläche oder die zuletzt gezogene Höhe dieses
// Bildschirms) und bleibt dann stehen. Wahlweise sitzt das Fenster mittig.

import { type QuickPosition } from "../../shared/local-api";

export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const QUICK_WIDTH = 680;
export const QUICK_MIN_HEIGHT = 132;
/** Stufe B ist nie niedriger (außer die Arbeitsfläche gibt es nicht her). */
export const QUICK_TALL_MIN = 420;
export const QUICK_SHARE_MIN = 0.4;
export const QUICK_SHARE_MAX = 0.9;

/** Oberkante: 10 % der Arbeitsfläche unter der Menüleiste, mindestens 40 pt. */
const TOP_SHARE = 0.1;
const TOP_MIN = 40;
/** Luft zum unteren Rand der Arbeitsfläche: 4 %, mindestens 28 pt. */
const BOTTOM_SHARE = 0.04;
const BOTTOM_MIN = 28;

/**
 * Oberkante des Fensters. `top`: bleibt beim Wachsen stehen. `center`: das
 * Fenster der Höhe `height` sitzt mittig, aber nie höher als bei `top`.
 */
export function quickTop(area: WorkArea, position: QuickPosition = "top", height = QUICK_MIN_HEIGHT): number {
  const top = Math.round(area.y + Math.max(TOP_MIN, area.height * TOP_SHARE));
  if (position !== "center") return top;
  const centered = Math.round(area.y + (area.height - height) / 2);
  return Math.max(top, centered);
}

/** Linke Kante: waagerecht mittig. */
export function quickLeft(area: WorkArea): number {
  return Math.round(area.x + (area.width - QUICK_WIDTH) / 2);
}

/** Größte Höhe ab der Oberkante `top`, ohne in den unteren Rand zu ragen. */
export function quickMaxHeight(area: WorkArea, top: number): number {
  const gap = Math.max(BOTTOM_MIN, area.height * BOTTOM_SHARE);
  return Math.max(QUICK_MIN_HEIGHT, Math.floor(area.y + area.height - gap - top));
}

/** Gewünschte Inhaltshöhe → Fensterhöhe (zwischen Mindesthöhe und Platz bis unten). */
export function quickHeight(area: WorkArea, top: number, contentHeight: number): number {
  return Math.max(QUICK_MIN_HEIGHT, Math.min(quickMaxHeight(area, top), Math.ceil(contentHeight)));
}

export function clampShare(share: number): number {
  if (!Number.isFinite(share)) return 0.6;
  return Math.min(QUICK_SHARE_MAX, Math.max(QUICK_SHARE_MIN, share));
}

/**
 * Gesprächshöhe (Stufe B): die gemerkte Höhe dieses Bildschirms, sonst der
 * Anteil der Arbeitsfläche – begrenzt auf den Platz bis unten und nach unten
 * auf QUICK_TALL_MIN (auf winzigen Flächen auf den Platz).
 */
export function quickTallHeight(area: WorkArea, top: number, share: number, remembered: number | null | undefined = null): number {
  const max = quickMaxHeight(area, top);
  const min = Math.min(QUICK_TALL_MIN, max);
  const wanted = remembered !== null && remembered !== undefined && Number.isFinite(remembered) ? remembered : area.height * clampShare(share);
  return Math.max(min, Math.min(max, Math.round(wanted)));
}

/** Kennung eines Bildschirms für gemerkte Höhen: Electron-ID, sonst die Fläche. */
export function displayKey(id: number | string | null | undefined, area: WorkArea): string {
  if (typeof id === "number" && Number.isFinite(id)) return `d${id}`;
  if (typeof id === "string" && id) return id.slice(0, 40);
  return `${area.width}x${area.height}`;
}

// Lage und Höhe des Schnellfensters auf der Arbeitsfläche – ohne Electron,
// damit testbar (tests/quick-geometry.test.ts).
//
// Owner-Wunsch 02.10.2026: höher ansetzen und mehr vom Bildschirm nutzen.
// Vorher saß die Oberkante wie bei Spotlight im oberen Fünftel (18 %) und das
// Fenster wuchs höchstens auf 75 % der Höhe – ein langer Chat endete knapp
// über dem Dock, oben blieb ein Fünftel ungenutzt. Jetzt: Oberkante bei 10 %,
// das Fenster wächst nach unten bis kurz vor den unteren Rand (Dock).

export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const QUICK_WIDTH = 680;
export const QUICK_MIN_HEIGHT = 132;

/** Oberkante: 10 % der Arbeitsfläche unter der Menüleiste, mindestens 40 pt. */
const TOP_SHARE = 0.1;
const TOP_MIN = 40;
/** Luft zum unteren Rand der Arbeitsfläche: 4 %, mindestens 28 pt. */
const BOTTOM_SHARE = 0.04;
const BOTTOM_MIN = 28;

/** Oberkante des Fensters (bleibt beim Wachsen stehen). */
export function quickTop(area: WorkArea): number {
  return Math.round(area.y + Math.max(TOP_MIN, area.height * TOP_SHARE));
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

// Tastenhinweise der Fußleiste einpassen (Owner-Befund 22.10.2026: auf
// „Diktate“ schnitt `.q-keys` „esc schließen“ mitten im Wort ab).
//
// Ein unsichtbares Lineal in `.q-keys` trägt alle Hinweise in voller Länge;
// gemessen werden je Hinweis die Breite mit Wort und die der Tastenkappe. Die
// sichtbare Breite von `.q-keys` hängt nicht vom Inhalt ab (flex-basis 0,
// quick.css), also gibt es keine Rückkopplung. `fitHints` (logic.ts)
// entscheidet: erst fallen die Wörter weg, dann ganze Hinweise von hinten.

import { type RefObject, useLayoutEffect, useState } from "react";

import { type HintFit, fitHints } from "./logic";

export function useFitHints(box: RefObject<HTMLElement | null>, ruler: RefObject<HTMLElement | null>, count: number, signature: string): HintFit {
  const [fit, setFit] = useState<HintFit>({ count, labels: true });

  useLayoutEffect(() => {
    const keys = box.current;
    const rule = ruler.current;
    if (!keys || !rule) return undefined;
    let frame = 0;

    const measure = (): void => {
      frame = 0;
      const items = Array.from(rule.children);
      const full = items.map((el) => el.getBoundingClientRect().width);
      const caps = items.map((el) => el.firstElementChild?.getBoundingClientRect().width ?? 0);
      const gap = Number.parseFloat(getComputedStyle(keys).columnGap) || 0;
      const next = fitHints(full, caps, gap, keys.clientWidth);
      setFit((prev) => (prev.count === next.count && prev.labels === next.labels ? prev : next));
    };
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    // Sofort messen (vor dem ersten Zeichnen), danach bei jeder Größenänderung:
    // Fensterbreite, Status-Chip, Knöpfe rechts, Schriftgröße (Lineal).
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(keys);
    observer.observe(rule);
    void document.fonts?.ready.then(schedule);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [box, ruler, signature]);

  return fit.count > count ? { ...fit, count } : fit;
}

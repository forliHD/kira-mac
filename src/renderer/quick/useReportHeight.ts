// Meldet dem Hauptprozess die gewünschte Fensterhöhe (`quickResize`).
//
// Die Wurzel ist höchstens 100vh hoch; passt nicht alles, schrumpft nur der
// Nachrichtenbereich und scrollt innen (Kopf, Eingabe, Fuß bleiben stehen).
// Gewünscht ist trotzdem die volle Höhe: sichtbare Höhe + weggescrollter Rest.
// Ein ResizeObserver auf Wurzel, Nachrichtenbereich und dessen Inhalt löst
// die Messung aus, gebündelt auf einen Frame; gemeldet wird nur bei > 1 px.

import { type RefObject, useLayoutEffect } from "react";

import { desiredHeight, shouldReport } from "./logic";

export interface HeightRefs {
  root: RefObject<HTMLElement | null>;
  thread: RefObject<HTMLElement | null>;
  content: RefObject<HTMLElement | null>;
  /** Folgt der Nachrichtenbereich dem Ende (Nutzer hat nicht hochgescrollt)? */
  follow: RefObject<boolean>;
}

/** Ober-/Unterkante ausblenden, wenn dort weiterer Inhalt liegt. */
export function updateFade(thread: HTMLElement): void {
  const top = thread.scrollTop > 2;
  const bottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight > 2;
  const fade = top && bottom ? "both" : top ? "top" : bottom ? "bottom" : "";
  if (thread.dataset.fade !== fade) thread.dataset.fade = fade;
}

export function useReportHeight(refs: HeightRefs, report: (height: number) => void): void {
  useLayoutEffect(() => {
    const root = refs.root.current;
    if (!root) return undefined;
    let frame = 0;
    let last: number | null = null;

    const measure = (): void => {
      frame = 0;
      const thread = refs.thread.current;
      const visible = thread !== null && !thread.hidden;
      if (visible && refs.follow.current) thread.scrollTop = thread.scrollHeight;
      const next = desiredHeight(root.scrollHeight, visible ? thread.scrollHeight : 0, visible ? thread.clientHeight : 0);
      if (shouldReport(last, next)) {
        last = next;
        report(next);
      }
      if (visible) updateFade(thread);
    };
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    if (refs.thread.current) observer.observe(refs.thread.current);
    if (refs.content.current) observer.observe(refs.content.current);
    // Schriften laden nach: dann ändern sich Zeilenhöhen ohne Größenänderung der Wurzel.
    void document.fonts?.ready.then(schedule);
    schedule();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [refs, report]);
}

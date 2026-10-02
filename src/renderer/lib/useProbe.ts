// Live-Prüfung einer Instanz-Adresse (Einrichtung, Einstellungen → Instanz):
// entprellt nach dem Tippen, sofort beim Verlassen des Felds. Antworten zu
// einer inzwischen geänderten Eingabe werden verworfen.

import { useCallback, useEffect, useRef, useState } from "react";

import { type ProbeResult } from "../../shared/local-api";
import { errorText, localApi } from "./useLocalState";

export type ProbeStatus = "idle" | "checking" | "ok" | "error";

export interface ProbeController {
  /** Die (getrimmte) Eingabe, zu der Status und Ergebnis gehören. */
  value: string;
  status: ProbeStatus;
  result: ProbeResult | null;
  /** Beim Verlassen des Felds: eine noch wartende Prüfung sofort starten. */
  checkNow: () => void;
  /** „Erneut prüfen“: immer neu fragen. */
  recheck: () => void;
}

interface Entry {
  value: string;
  status: ProbeStatus;
  result: ProbeResult | null;
}

const IDLE: Entry = { value: "", status: "idle", result: null };

function failed(url: string, err: unknown): ProbeResult {
  return { url, ok: false, version: null, bridge: false, error: errorText(err), latencyMs: null };
}

export function useProbe(value: string, debounceMs = 500): ProbeController {
  const trimmed = value.trim();
  const [entry, setEntry] = useState<Entry>(IDLE);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(trimmed);
  latest.current = trimmed;

  const clearTimer = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const run = useCallback((target: string) => {
    clearTimer();
    const id = ++seq.current;
    if (!target) {
      setEntry(IDLE);
      return;
    }
    setEntry({ value: target, status: "checking", result: null });
    let request: Promise<ProbeResult>;
    try {
      request = localApi().probe(target);
    } catch (err) {
      setEntry({ value: target, status: "error", result: failed(target, err) });
      return;
    }
    request.then(
      (result) => {
        if (id === seq.current) setEntry({ value: target, status: result.ok ? "ok" : "error", result });
      },
      (err: unknown) => {
        if (id === seq.current) setEntry({ value: target, status: "error", result: failed(target, err) });
      },
    );
  }, []);

  useEffect(() => {
    clearTimer();
    seq.current++; // laufende Antwort zur alten Eingabe verwerfen
    if (!trimmed) {
      setEntry(IDLE);
      return undefined;
    }
    setEntry({ value: trimmed, status: "checking", result: null });
    timer.current = setTimeout(() => run(trimmed), debounceMs);
    return clearTimer;
    // debounceMs bewusst nicht in den Abhängigkeiten: ein Wechsel (z. B. nach
    // dem Vorbefüllen) soll keine neue Prüfung auslösen.
  }, [trimmed, run]);

  useEffect(
    () => () => {
      clearTimer();
      seq.current++;
    },
    [],
  );

  const checkNow = useCallback(() => {
    if (timer.current) run(latest.current);
  }, [run]);
  const recheck = useCallback(() => run(latest.current), [run]);

  // Zwischen Eingabe und Effekt nie das Ergebnis der alten Eingabe zeigen.
  const current: Entry = entry.value === trimmed ? entry : trimmed ? { value: trimmed, status: "checking", result: null } : IDLE;
  return { ...current, checkNow, recheck };
}

// Zustand des Schnellfensters: einmal `quickGetState()`, danach nur noch die
// Ereignisse `quick` des Hauptprozesses. Kommt ein Ereignis vor der Antwort
// auf die erste Abfrage, gewinnt das Ereignis (es ist neuer).

import { useEffect, useState } from "react";

import { type QuickState } from "../../shared/local-api";
import { localApi } from "../lib/useLocalState";

/** Fehlertext für Menschen; Electron stellt IPC-Fehlern „Error invoking remote method …“ voran. */
export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, "");
}

export function useQuickState(): { state: QuickState | null; error: string | null } {
  const [state, setState] = useState<QuickState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let gotEvent = false;
    let off: () => void = () => undefined;
    try {
      const api = localApi();
      off = api.on((event) => {
        if (event.type !== "quick") return;
        gotEvent = true;
        setState(event.quick);
        setError(null);
      });
      api
        .quickGetState()
        .then((initial) => {
          if (alive && !gotEvent) setState(initial);
        })
        .catch((err: unknown) => {
          if (alive) setError(errorText(err));
        });
    } catch (err) {
      setError(errorText(err));
    }
    return () => {
      alive = false;
      off();
    };
  }, []);

  return { state, error };
}

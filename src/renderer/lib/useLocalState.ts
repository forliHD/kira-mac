// Zugriff der lokalen Seiten auf den Hauptprozess (`window.KiraLocal`).

import { useCallback, useEffect, useState } from "react";

import { type KiraLocalApi, type LocalEvent, type LocalState } from "../../shared/local-api";

export function localApi(): KiraLocalApi {
  const api = window.KiraLocal;
  if (!api) throw new Error("KiraLocal fehlt – diese Seite läuft nur in der KIRA-App.");
  return api;
}

export function useLocalState(): { state: LocalState | null; error: string | null; refresh: () => Promise<void>; setState: (s: LocalState) => void } {
  const [state, setState] = useState<LocalState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await localApi().getState());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    let off = (): void => undefined;
    try {
      off = localApi().on((event: LocalEvent) => {
        if (event.type === "state") setState(event.state);
        else if (event.type === "connection") setState((s) => (s ? { ...s, connection: event.connection } : s));
        else if (event.type === "update") setState((s) => (s ? { ...s, update: event.update } : s));
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    return () => off();
  }, [refresh]);

  return { state, error, refresh, setState };
}

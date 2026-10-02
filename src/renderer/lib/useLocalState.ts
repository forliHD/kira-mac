// Zugriff der lokalen Seiten auf den Hauptprozess (`window.KiraLocal`).

import { useCallback, useEffect, useState } from "react";

import { type KiraLocalApi, type LocalEvent, type LocalState, type UiInfo } from "../../shared/local-api";

export function localApi(): KiraLocalApi {
  const api = window.KiraLocal;
  if (!api) throw new Error("KiraLocal fehlt – diese Seite läuft nur in der KIRA-App.");
  return api;
}

/** Fehlertext für Menschen aus einem gefangenen Fehler. */
export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Electron hängt bei abgelehnten invoke-Aufrufen den Kanal davor.
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "").trim() || "Unbekannter Fehler.";
}

/**
 * Wie das Fenster gezeichnet wird → Attribute am <body>, an denen glass.css
 * die Flächen feinjustiert (Vibrancy: Karten etwas deckender; „Transparenz
 * reduzieren“: deckend).
 */
export function applyUiAttributes(ui: UiInfo | null | undefined): void {
  if (!ui || typeof document === "undefined") return;
  document.body.dataset.glass = ui.glass;
  document.body.dataset.reducedTransparency = ui.reducedTransparency ? "true" : "false";
}

export interface UseLocalStateOptions {
  /** Beim Zurückkehren ins Fenster neu laden (z. B. nach den Systemeinstellungen). */
  refreshOnFocus?: boolean;
}

export function useLocalState(options: UseLocalStateOptions = {}): {
  state: LocalState | null;
  error: string | null;
  refresh: () => Promise<void>;
  setState: (s: LocalState) => void;
} {
  const [state, setState] = useState<LocalState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshOnFocus = options.refreshOnFocus === true;

  const refresh = useCallback(async () => {
    try {
      setState(await localApi().getState());
      setError(null);
    } catch (err) {
      setError(errorText(err));
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
      setError(errorText(err));
    }
    return () => off();
  }, [refresh]);

  useEffect(() => {
    if (!refreshOnFocus) return undefined;
    const onFocus = (): void => void refresh();
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, refreshOnFocus]);

  useEffect(() => applyUiAttributes(state?.ui), [state?.ui]);

  return { state, error, refresh, setState };
}

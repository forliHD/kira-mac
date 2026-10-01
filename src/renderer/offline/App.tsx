// Ehrlicher Offline-Zustand des Hauptfensters: Grund, erneut versuchen,
// Einstellungen. Das globale Diktat läuft unabhängig davon weiter.

import { type ReactNode, useState } from "react";

import { localApi, useLocalState } from "../lib/useLocalState";
import { Notice } from "../lib/ui";

export function App(): ReactNode {
  const { state } = useLocalState();
  const [busy, setBusy] = useState(false);
  const params = new URLSearchParams(location.search);
  const reason = state?.connection.lastError ?? params.get("reason") ?? "Instanz nicht erreichbar.";

  async function retry(): Promise<void> {
    setBusy(true);
    try {
      await localApi().retry();
    } finally {
      setTimeout(() => setBusy(false), 1500);
    }
  }

  return (
    <main className="flex h-screen flex-col items-center justify-center gap-5 px-8">
      <div className="k-card flex w-full max-w-md flex-col gap-4">
        <div>
          <h1 className="text-[18px] font-semibold">KIRA ist gerade nicht erreichbar</h1>
          <p className="mt-1 text-text-2">Die App versucht es alle 15 Sekunden erneut. Das globale Diktat funktioniert weiterhin.</p>
        </div>
        <Notice tone="warn">{reason}</Notice>
        {state ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px] text-text-2">
            <dt>Intern</dt>
            <dd className="font-mono">{state.instance.internalUrl ?? "–"}</dd>
            <dt>Extern</dt>
            <dd className="font-mono">{state.instance.externalUrl ?? "–"}</dd>
          </dl>
        ) : null}
        <div className="flex items-center gap-2">
          <button className="k-btn k-btn-primary" disabled={busy} onClick={() => void retry()}>
            {busy ? "Versuche…" : "Erneut versuchen"}
          </button>
          <button className="k-btn" onClick={() => void localApi().openSettings()}>
            Einstellungen…
          </button>
        </div>
      </div>
    </main>
  );
}

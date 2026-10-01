// Erster Start: Instanz-URL(s) eingeben, Erreichbarkeit prüfen, weiter.

import { type ReactNode, useState } from "react";

import { type ProbeResult } from "../../shared/local-api";
import { localApi } from "../lib/useLocalState";
import { Dot, Field, Notice } from "../lib/ui";

function ProbeLine({ label, result, pending }: { label: string; result: ProbeResult | null; pending: boolean }): ReactNode {
  if (pending) {
    return (
      <div className="flex items-center gap-2 text-text-2">
        <Dot tone="idle" /> {label}: wird geprüft…
      </div>
    );
  }
  if (!result) return null;
  if (result.ok) {
    return (
      <div className="flex items-center gap-2">
        <Dot tone={result.bridge ? "ok" : "warn"} />
        <span>
          {label}: erreichbar{result.version ? ` – KIRA ${result.version}` : ""}
          {result.latencyMs !== null ? ` (${result.latencyMs} ms)` : ""}
          {result.bridge ? "" : " – ältere Version, Benachrichtigungen laufen nur im Dashboard"}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-err">
      <Dot tone="err" />
      <span>
        {label}: {result.error ?? "nicht erreichbar"}
      </span>
    </div>
  );
}

export function App(): ReactNode {
  const [internalUrl, setInternalUrl] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [internalResult, setInternalResult] = useState<ProbeResult | null>(null);
  const [externalResult, setExternalResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const anyUrl = internalUrl.trim() || externalUrl.trim();
  const anyOk = Boolean(internalResult?.ok || externalResult?.ok);

  async function check(): Promise<void> {
    setChecking(true);
    setError(null);
    setInternalResult(null);
    setExternalResult(null);
    try {
      const api = localApi();
      const [i, e] = await Promise.all([
        internalUrl.trim() ? api.probe(internalUrl.trim()) : Promise.resolve(null),
        externalUrl.trim() ? api.probe(externalUrl.trim()) : Promise.resolve(null),
      ]);
      setInternalResult(i);
      setExternalResult(e);
      if (!i?.ok && !e?.ok) setError("Keine der Adressen antwortet. Prüfe Netz, VPN und die Schreibweise.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  async function finish(): Promise<void> {
    setFinishing(true);
    setError(null);
    try {
      const api = localApi();
      await api.saveInstance({ internalUrl: internalUrl.trim() || null, externalUrl: externalUrl.trim() || null });
      await api.finishOnboarding();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFinishing(false);
    }
  }

  return (
    <main className="mx-auto flex h-screen max-w-xl flex-col gap-5 px-8 py-8">
      <header className="k-drag">
        <h1 className="text-[20px] font-semibold">KIRA für Mac einrichten</h1>
        <p className="mt-1 text-text-2">
          Die App lädt das Dashboard von deiner KIRA-Instanz. Gib die Adresse im Heimnetz an und, falls vorhanden, die
          Adresse von außen (Cloudflare Access). Im Heimnetz wird die interne Adresse bevorzugt.
        </p>
      </header>

      <div className="k-card flex flex-col gap-4">
        <Field label="Interne Adresse (Heimnetz)" hint="z. B. http://192.168.178.166 oder http://kira.local">
          <input
            className="k-input"
            type="url"
            autoFocus
            placeholder="http://192.168.178.166"
            value={internalUrl}
            onChange={(e) => setInternalUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void check()}
          />
        </Field>
        <Field label="Externe Adresse (optional)" hint="z. B. https://kira.example.de – hinter Cloudflare Access">
          <input
            className="k-input"
            type="url"
            placeholder="https://kira.example.de"
            value={externalUrl}
            onChange={(e) => setExternalUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void check()}
          />
        </Field>
        <div className="flex items-center gap-2">
          <button className="k-btn" disabled={!anyUrl || checking} onClick={() => void check()}>
            {checking ? "Prüfe…" : "Erreichbarkeit prüfen"}
          </button>
        </div>
        {(checking || internalResult || externalResult) && (
          <div className="flex flex-col gap-1 text-[12px]">
            {internalUrl.trim() ? <ProbeLine label="Intern" result={internalResult} pending={checking} /> : null}
            {externalUrl.trim() ? <ProbeLine label="Extern" result={externalResult} pending={checking} /> : null}
          </div>
        )}
        {error ? <Notice tone="err">{error}</Notice> : null}
      </div>

      <footer className="mt-auto flex items-center justify-between">
        <span className="text-[12px] text-text-3">Anmeldung und Daten bleiben auf dem Server.</span>
        <button className="k-btn k-btn-primary" disabled={!anyOk || finishing} onClick={() => void finish()}>
          {finishing ? "Öffne…" : "Weiter"}
        </button>
      </footer>
    </main>
  );
}

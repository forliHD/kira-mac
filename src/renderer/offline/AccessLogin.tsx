// „Im Browser anmelden“: Cloudflare Access will die externe Adresse anmelden.
// Im App-Fenster gehen dort keine Passkeys, deshalb läuft die Anmeldung im
// Standard-Browser (src/main/access-login.ts) und kehrt über
// de.kira.mac:/auth/callback zurück. Der Browser öffnet sich nie ungefragt.

import { type ReactNode, useEffect, useState } from "react";

import { type LocalEvent } from "../../shared/local-api";
import { hostOf } from "../lib/format";
import { IconAlert, IconGlobe, IconShield } from "../lib/icons";
import { errorText, localApi } from "../lib/useLocalState";
import { Button } from "../lib/ui";

type Phase = "idle" | "waiting";

export function AccessLogin({ origin, initialError }: { origin: string | null; initialError: string | null }): ReactNode {
  const host = hostOf(origin);
  const hasApi = Boolean(window.KiraLocal);
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  useEffect(() => {
    document.title = host ? `KIRA – Anmeldung bei ${host}` : "KIRA – Anmeldung";
  }, [host]);

  useEffect(() => {
    if (!hasApi) return undefined;
    return localApi().on((event: LocalEvent) => {
      if (event.type !== "access-login") return;
      setPhase("idle");
      setError(event.message);
    });
  }, [hasApi]);

  async function inBrowser(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await localApi().accessLogin();
      setPhase("waiting");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setTimeout(() => setBusy(false), 600);
    }
  }

  async function inWindow(): Promise<void> {
    setError(null);
    try {
      await localApi().accessLoginInWindow();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <main className="offline">
      <div className="offline-aurora is-a" aria-hidden="true" />
      <div className="offline-aurora is-b" aria-hidden="true" />

      <section className="offline-card" aria-labelledby="access-title">
        <span className="offline-icon" aria-hidden="true">
          <IconShield size={30} />
        </span>
        <div className="flex flex-col gap-2">
          <h1 id="access-title" className="offline-title">
            Anmeldung bei {host ? <span className="g-selectable">{host}</span> : "KIRA"}
          </h1>
          <p className="offline-text">
            {phase === "waiting"
              ? "Melde dich im Browser an. Danach kehrt die Anmeldung von selbst in die App zurück – Safari fragt beim ersten Mal, ob KIRA geöffnet werden darf."
              : "Diese Adresse ist durch Cloudflare Access geschützt. Die Anmeldung läuft in deinem Browser – dort funktionieren Passkeys, Touch ID und das Handy als Schlüssel."}
          </p>
        </div>

        {error ? (
          <div className="offline-reasons">
            <div className="offline-reason">
              <IconAlert size={16} />
              <span className="offline-reason-error g-selectable">{error}</span>
            </div>
          </div>
        ) : null}

        {hasApi ? (
          <div className="flex flex-wrap items-center justify-center gap-[10px]">
            <Button variant="primary" size="md" busy={busy} softDisabled={busy} icon={<IconGlobe size={16} strokeWidth={2.3} />} onClick={() => void inBrowser()}>
              {phase === "waiting" ? "Browser erneut öffnen" : "Im Browser anmelden"}
            </Button>
            <Button variant="glass" size="md" onClick={() => void inWindow()}>
              Im App-Fenster anmelden
            </Button>
          </div>
        ) : (
          <p className="offline-hint">Diese Seite läuft nur in der KIRA-App.</p>
        )}
        <p className="offline-status" role="status">
          {phase === "waiting" && !busy ? "Warte auf die Anmeldung im Browser …" : ""}
        </p>
      </section>
    </main>
  );
}

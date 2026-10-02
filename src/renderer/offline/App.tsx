// Ehrlicher Offline-Zustand des Hauptfensters: welche Adresse warum nicht
// antwortet, „Erneut versuchen“, „Instanz ändern…“. Diktat und Schnellfenster
// laufen unabhängig davon weiter. Läuft im deckenden Hauptfenster und malt
// deshalb ihren eigenen Hintergrund (offline.css).

import { type ReactNode, useEffect, useMemo, useState } from "react";

import { type LocalState } from "../../shared/local-api";
import { formatLastSeen, hostOf, parseOfflineReason, parseTimestamp, type OfflineReason } from "../lib/format";
import { IconAlert, IconCloudOff, IconGlobe, IconHome, IconMic, IconRefresh } from "../lib/icons";
import { errorText, localApi, useLocalState } from "../lib/useLocalState";
import { Button, InfoNote, KbdCombo } from "../lib/ui";

const RETRY_SECONDS = 15;

function titleHost(state: LocalState | null, reason: OfflineReason): string | null {
  if (state) {
    const host = hostOf(state.instance.externalUrl) ?? hostOf(state.instance.internalUrl);
    if (host) return host;
    if (state.instance.label && state.instance.label !== "KIRA") return state.instance.label;
  }
  return reason.items.find((i) => i.kind === "external")?.host ?? reason.items[0]?.host ?? null;
}

function ReasonList({ reason }: { reason: OfflineReason }): ReactNode {
  if (!reason.items.length) {
    return (
      <div className="offline-reasons">
        <div className="offline-reason">
          <IconAlert size={16} />
          <span className="offline-reason-error g-selectable">{reason.summary}</span>
        </div>
      </div>
    );
  }
  return (
    <ul className="offline-reasons" aria-label="Geprüfte Adressen">
      {reason.items.map((item) => (
        <li key={`${item.kind}-${item.origin}`} className="offline-reason">
          {item.kind === "internal" ? <IconHome size={16} /> : <IconGlobe size={16} />}
          <span className="flex min-w-0 flex-col gap-[2px]">
            <span className="offline-reason-head">
              <span className="offline-reason-kind">{item.kind === "internal" ? "Heimnetz" : "Extern"}</span>
              <span className="offline-reason-host g-mono g-selectable">{item.host}</span>
            </span>
            <span className="offline-reason-error g-selectable">{item.error}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function StillWorking({ state }: { state: LocalState | null }): ReactNode {
  const dictationKey = state?.hotkeys.dictation ?? "Control+Alt+D";
  const quickKey = state?.hotkeys.quickWindow ?? "Alt+Space";
  // Ohne Zustand (oder bevor er da ist) beides nennen – das ist der Normalfall.
  const dictation = !state || (state.helper.running && state.dictationStatus.stt?.available !== false && Boolean(dictationKey));
  const quick = !state || (state.helper.info?.features.llm === true && Boolean(quickKey));
  if (!dictation && !quick) return null;
  return (
    <InfoNote icon={<IconMic size={18} />} className="offline-note">
      {dictation && quick ? (
        <>
          Diktat mit <KbdCombo accelerator={dictationKey} small joined /> und das Schnellfenster mit <KbdCombo accelerator={quickKey} small joined />{" "}
          funktionieren weiter. Erkennung und Antworten laufen dann auf diesem Mac – nichts verlässt das Gerät.
        </>
      ) : dictation ? (
        <>
          Diktat mit <KbdCombo accelerator={dictationKey} small joined /> funktioniert weiter. Die Erkennung läuft auf diesem Mac – nichts verlässt das
          Gerät.
        </>
      ) : (
        <>
          Das Schnellfenster mit <KbdCombo accelerator={quickKey} small joined /> antwortet weiter – mit dem Apple-Sprachmodell auf diesem Mac.
        </>
      )}
    </InfoNote>
  );
}

export function App(): ReactNode {
  const { state } = useLocalState();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const hasApi = Boolean(window.KiraLocal);

  // Live-Grund (Hauptprozess prüft alle 15 s) vor dem Grund aus der Adresse.
  const live = state && !state.connection.online ? state.connection.lastError : null;
  const reason = useMemo(() => parseOfflineReason(live ?? params.get("reason")), [live, params]);
  const lastSeen = parseTimestamp(params.get("lastSeen"));
  const host = titleHost(state, reason);

  useEffect(() => {
    document.title = host ? `KIRA – keine Verbindung zu ${host}` : "KIRA – offline";
  }, [host]);

  // Ohne window.KiraLocal (Hauptfenster mit Instanz-Preload) bleibt als
  // „Erneut versuchen“ nur, die Instanz direkt zu laden – Heimnetz zuerst.
  const fallbackOrigin = reason.items.find((i) => i.kind === "internal")?.origin ?? reason.items[0]?.origin ?? null;

  async function retry(): Promise<void> {
    setBusy(true);
    setNote(null);
    try {
      if (hasApi) {
        const api = localApi();
        await api.retry();
        // Gelingt es, lädt der Hauptprozess das Dashboard und diese Seite verschwindet.
        const fresh = await api.getState();
        if (!fresh.connection.online) setNote(`Noch keine Verbindung – nächster Versuch in ${RETRY_SECONDS} Sekunden.`);
      } else if (fallbackOrigin) {
        window.location.href = fallbackOrigin;
        return;
      }
    } catch (err) {
      setNote(errorText(err));
    } finally {
      setTimeout(() => setBusy(false), 600);
    }
  }

  return (
    <main className="offline">
      <div className="offline-aurora is-a" aria-hidden="true" />
      <div className="offline-aurora is-b" aria-hidden="true" />

      <section className="offline-card" aria-labelledby="offline-title">
        <span className="offline-icon" aria-hidden="true">
          <IconCloudOff size={30} />
        </span>
        <div className="flex flex-col gap-2">
          <h1 id="offline-title" className="offline-title">
            {host ? (
              <>
                Keine Verbindung zu <span className="g-selectable">{host}</span>
              </>
            ) : (
              "Keine Verbindung zu KIRA"
            )}
          </h1>
          <p className="offline-text">
            {lastSeen ? `Letzter Kontakt ${formatLastSeen(lastSeen)}. ` : null}
            KIRA versucht es alle {RETRY_SECONDS} Sekunden erneut.
          </p>
        </div>

        <ReasonList reason={reason} />

        <div className="flex flex-wrap items-center justify-center gap-[10px]">
          {hasApi || fallbackOrigin ? (
            <Button variant="primary" size="md" busy={busy} softDisabled={busy} icon={<IconRefresh size={16} strokeWidth={2.3} />} onClick={() => void retry()}>
              {busy ? "Versuche…" : "Erneut versuchen"}
            </Button>
          ) : null}
          {hasApi ? (
            <Button
              variant="glass"
              size="md"
              onClick={() => {
                setNote(null);
                void localApi()
                  .openSettings()
                  .catch((err: unknown) => setNote(errorText(err)));
              }}
            >
              Instanz ändern…
            </Button>
          ) : (
            <p className="offline-hint">
              Adresse ändern: Menü <strong>KIRA → Einstellungen…</strong> (⌘,)
            </p>
          )}
        </div>
        <p className="offline-status" role="status">
          {busy ? "" : note}
        </p>

        <StillWorking state={state} />
      </section>
    </main>
  );
}

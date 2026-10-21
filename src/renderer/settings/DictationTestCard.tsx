// Einstellungen → Diktat → Diktat-Test (Plan 21.10.2026, M6): ein fester Text
// wird vorgelesen, die App misst die Wortfehlerrate und wie viele eigene
// Begriffe ankamen – alles auf diesem Mac, nichts verlässt ihn. Lauf und
// Auswertung: src/main/dictation-test.ts; hier nur die Anzeige.

import { type ReactNode, useCallback, useEffect, useState } from "react";

import { DICTATION_TEST_KINDS, type DictationTestKind, type DictationTestResult, type DictationTestState, IDLE_TEST_STATE, formatWer } from "../../shared/dictation-test";
import { type LocalEvent, type LocalState } from "../../shared/local-api";
import { formatLastSeen } from "../lib/format";
import { IconMic, IconStop } from "../lib/icons";
import { errorText, localApi } from "../lib/useLocalState";
import { Button, GlassCard, InfoNote, cx } from "../lib/ui";

function kindLabel(kind: DictationTestKind): string {
  return DICTATION_TEST_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

function ResultRow({ result }: { result: DictationTestResult }): ReactNode {
  const s = result.settings;
  const parts = [
    `${result.words} Wörter`,
    `${result.substitutions} ersetzt · ${result.insertions} zu viel · ${result.deletions} fehlt`,
    result.termsTotal > 0 ? `Begriffe ${result.termsHit} von ${result.termsTotal}` : null,
    `${Math.round(result.durationMs / 1000)} s`,
  ];
  const settings = [s.locale, s.engine ?? "Engine unbekannt", s.correction ? "Nachkorrektur an" : "Nachkorrektur aus", s.commands ? "Befehle an" : "Befehle aus", `App ${s.appVersion}`];
  return (
    <li className="dt-result">
      <div className="dt-result-head">
        <span className="dt-wer">{formatWer(result.wer)}</span>
        <span className="dt-kind">{kindLabel(result.kind)}</span>
        <span className="dt-when">{formatLastSeen(new Date(result.at)).replace(/^um /, "heute um ")}</span>
      </div>
      <p className="dt-result-line">{parts.filter(Boolean).join(" · ")}</p>
      <p className="dt-result-settings">{settings.join(" · ")}</p>
    </li>
  );
}

export function DictationTestCard({ state }: { state: LocalState }): ReactNode {
  const [test, setTest] = useState<DictationTestState>(IDLE_TEST_STATE);
  const [results, setResults] = useState<DictationTestResult[]>([]);
  const [kind, setKind] = useState<DictationTestKind>("terms");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await localApi().dictationTestState();
      setTest(r.test);
      setResults(r.results);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void load();
    let off = (): void => undefined;
    try {
      off = localApi().on((event: LocalEvent) => {
        if (event.type !== "dictation-test") return;
        setTest(event.test);
        setResults(event.results);
      });
    } catch {
      /* Vorschau ohne Hülle */
    }
    return () => off();
  }, [load]);

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const ready = state.helper.running && Boolean(state.dictationStatus.stt?.available);
  const info = DICTATION_TEST_KINDS.find((k) => k.kind === kind);
  const level = Math.max(0, Math.min(1, test.level * 2.2));

  return (
    <GlassCard className="dh-card dt-card">
      <div className="dh-head">
        <div>
          <h3 className="dh-title">Diktat-Test</h3>
          <p className="dh-sub">
            Lies den Text vor, die App vergleicht ihn mit dem Erkannten: Wortfehlerrate (WER) und – beim Begriffe-Test – wie viele deiner Begriffe
            ankamen. Alles bleibt auf diesem Mac; gespeichert werden nur Zahlen und die Einstellungen des Laufs, nie der Text.
          </p>
        </div>
      </div>

      {!test.active ? (
        <>
          <div className="dt-kinds" role="radiogroup" aria-label="Testart">
            {DICTATION_TEST_KINDS.map((k) => (
              <Button key={k.kind} variant={k.kind === kind ? "primary" : "glass"} role="radio" aria-checked={k.kind === kind} onClick={() => setKind(k.kind)}>
                {k.label}
              </Button>
            ))}
          </div>
          <p className="dh-sub">{info?.hint}</p>
          <div className="dt-actions">
            <Button
              variant="primary"
              icon={<IconMic size={14} />}
              busy={busy}
              disabled={busy || !ready}
              title={ready ? undefined : "Die Apple-Spracherkennung ist nicht bereit (siehe Karte oben)."}
              onClick={() => void run(() => localApi().dictationTestStart(kind))}
            >
              Test starten
            </Button>
            {!ready ? <span className="dh-sub">Erst muss die Spracherkennung bereit sein.</span> : null}
          </div>
        </>
      ) : (
        <>
          <p className="dt-step">
            {test.listening ? (
              <>
                <span className="g-dot is-ok is-glow" aria-hidden="true" /> Ich höre zu – lies den Text in normalem Tempo vor, dann „Auswerten“.
              </>
            ) : (
              <>
                <span className="g-dot is-warn" aria-hidden="true" /> Erkennung startet …
              </>
            )}
          </p>
          <div className="dt-level" aria-hidden="true">
            <span style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          <blockquote className="dt-reference g-selectable">{test.reference}</blockquote>
          <div className="dt-heard">
            <span className="dt-heard-label">Erkannt</span>
            <p className="dt-text g-selectable">
              {test.text}
              {test.partial ? <em className="dt-partial"> {test.partial}</em> : null}
              {!test.text && !test.partial ? <span className="dt-partial">…</span> : null}
            </p>
          </div>
          <div className="dt-actions">
            <Button variant="primary" icon={<IconStop size={14} />} busy={busy} disabled={busy} onClick={() => void run(() => localApi().dictationTestStop())}>
              Auswerten
            </Button>
            <Button disabled={busy} onClick={() => void run(() => localApi().dictationTestCancel())}>
              Abbrechen
            </Button>
          </div>
        </>
      )}

      {test.reason ? (
        <InfoNote tone="err" role="alert">
          Der Test konnte nicht starten: {test.reason}
        </InfoNote>
      ) : null}
      {error ? (
        <InfoNote tone="err" role="alert">
          {error}
        </InfoNote>
      ) : null}

      {results.length > 0 ? (
        <ul className={cx("dt-results", test.active && "is-dimmed")} aria-label="Letzte Ergebnisse">
          {results.map((r) => (
            <ResultRow key={r.id} result={r} />
          ))}
        </ul>
      ) : null}
    </GlassCard>
  );
}

// Einrichtung beim ersten Start (760×560, Ampel oben links, Vibrancy):
// Schritt 1 – Adresse(n) der Instanz mit Live-Prüfung; Schritt 2 – was die
// App kann und welche macOS-Freigaben später gefragt werden. „Los geht’s“
// speichert (falls nötig) und schließt die Einrichtung ab.

import { type ReactNode, useEffect, useRef, useState } from "react";

import { MIN_SERVER_VERSION_WITH_BRIDGE } from "../../shared/bridge";
import { type LocalState } from "../../shared/local-api";
import { mockParam } from "../lib/dev-mock";
import { InstanceField, reachable, valueToSave } from "../lib/instance-field";
import { IconAlert, IconArrowLeft, IconArrowRight, IconBell, IconBolt, IconMic, IconShield } from "../lib/icons";
import { useProbe } from "../lib/useProbe";
import { applyUiAttributes, errorText, localApi } from "../lib/useLocalState";
import { AppTile, Button, GlassCard, IconTile, InfoNote, KbdCombo } from "../lib/ui";

type Step = 1 | 2;

const DEFAULT_HOTKEYS = { quickWindow: "Alt+Space", dictation: "Control+Alt+D" };

function key(internalUrl: string, externalUrl: string): string {
  return `${internalUrl.trim()}\n${externalUrl.trim()}`;
}

function isInvalid(error: string | null | undefined): boolean {
  return /keine gültige/i.test(error ?? "");
}

function Feature({
  icon,
  title,
  hotkey,
  warning,
  children,
}: {
  icon: ReactNode;
  title: string;
  hotkey?: string;
  warning?: string | null;
  children: ReactNode;
}): ReactNode {
  return (
    <li>
      <GlassCard className="flex items-center gap-[14px] px-4 py-3">
        <IconTile tone="info">{icon}</IconTile>
        <div className="flex min-w-0 flex-auto flex-col gap-[2px]">
          <span className="text-[14px] font-semibold text-(--g-text)">{title}</span>
          <span className="text-[12.5px] leading-[1.45] text-(--g-text-2)">{children}</span>
          {warning ? (
            <span className="mt-[2px] flex items-center gap-[6px] text-[12px] text-(--g-warn)">
              <IconAlert size={13} />
              {warning}
            </span>
          ) : null}
        </div>
        {hotkey ? <KbdCombo accelerator={hotkey} /> : null}
      </GlassCard>
    </li>
  );
}

export function App(): ReactNode {
  const [step, setStep] = useState<Step>(mockParam("step") === "2" ? 2 : 1);
  const [state, setState] = useState<LocalState | null>(null);
  const [externalUrl, setExternalUrl] = useState("");
  const [internalUrl, setInternalUrl] = useState("");
  const [fast, setFast] = useState(false);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typed = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef<Step>(step);

  const external = useProbe(externalUrl, fast ? 0 : 500);
  const internal = useProbe(internalUrl, fast ? 0 : 500);

  // Vorhandene Adressen übernehmen (Einrichtung wird erneut gezeigt) und sofort prüfen.
  useEffect(() => {
    let alive = true;
    try {
      void localApi()
        .getState()
        .then(
          (s) => {
            if (!alive) return;
            setState(s);
            applyUiAttributes(s.ui);
            if (!typed.current && (s.instance.externalUrl || s.instance.internalUrl)) {
              setExternalUrl(s.instance.externalUrl ?? "");
              setInternalUrl(s.instance.internalUrl ?? "");
              setFast(true);
            }
          },
          (err: unknown) => alive && setError(errorText(err)),
        );
    } catch (err) {
      setError(errorText(err));
    }
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (fast) setFast(false);
  }, [fast]);

  // Beim Schrittwechsel den Fokus auf die neue Überschrift (Bildschirmleser).
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  const hotkeys = state?.hotkeys ?? DEFAULT_HOTKEYS;
  const anyOk = external.status === "ok" || internal.status === "ok";
  const anyInvalid = isInvalid(external.result?.error) || isInvalid(internal.result?.error);
  const checking = external.status === "checking" || internal.status === "checking";
  const canContinue = anyOk && !anyInvalid && !busy;
  const best = reachable(internal, external);
  const currentKey = key(internalUrl, externalUrl);

  function edit(setter: (v: string) => void): (v: string) => void {
    return (v) => {
      typed.current = true;
      setError(null);
      setter(v);
    };
  }

  async function save(): Promise<void> {
    if (savedKey === currentKey) return;
    await localApi().saveInstance({ internalUrl: valueToSave(internalUrl, internal), externalUrl: valueToSave(externalUrl, external) });
    setSavedKey(currentKey);
  }

  async function next(): Promise<void> {
    if (!canContinue) return;
    setBusy(true);
    setError(null);
    try {
      await save();
      setStep(2);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function finish(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await save();
      await localApi().finishOnboarding();
      // Der Hauptprozess schließt dieses Fenster und öffnet KIRA.
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const stt = state?.dictationStatus.stt;
  const sttWarning =
    state && (!state.helper.running || (stt && !stt.available))
      ? `Auf diesem Mac gerade nicht verfügbar${stt?.reason ? `: ${stt.reason}` : state.helper.lastError ? `: ${state.helper.lastError}` : "."}`
      : null;
  const bridgeWarning =
    best?.version && !best.bridge ? `Braucht KIRA ${MIN_SERVER_VERSION_WITH_BRIDGE} oder neuer – dein Server meldet ${best.version}.` : null;

  return (
    <div className="onb">
      <div className="onb-aurora is-a" aria-hidden="true" />
      <div className="onb-aurora is-b" aria-hidden="true" />

      <header className="onb-top g-drag">
        <p className="onb-step" aria-live="polite">
          Schritt {step} von 2
          <span className="onb-dots" aria-hidden="true">
            <span className={step === 1 ? "is-on" : undefined} />
            <span className={step === 2 ? "is-on" : undefined} />
          </span>
        </p>
      </header>

      {step === 1 ? (
        <main className="onb-body" aria-labelledby="onb-title">
          <div className="flex items-center gap-4">
            <AppTile size={56} />
            <div className="flex min-w-0 flex-col gap-1">
              <h1 id="onb-title" ref={headingRef} tabIndex={-1} className="onb-title">
                Willkommen bei KIRA für Mac
              </h1>
              <p className="onb-lead">Die App ist das Fenster zu deiner KIRA-Instanz. Gib die Adresse ein, die du im Browser nutzt.</p>
            </div>
          </div>

          <InstanceField kind="external" value={externalUrl} onChange={edit(setExternalUrl)} probe={external} autoFocus onEnter={() => void next()} />
          <InstanceField kind="internal" value={internalUrl} onChange={edit(setInternalUrl)} probe={internal} onEnter={() => void next()} />

          {error ? (
            <InfoNote tone="err" role="alert">
              {error}
            </InfoNote>
          ) : null}

          <footer className="mt-auto flex items-center justify-between gap-6">
            <span id="onb-footnote" className="text-[12px] text-(--g-text-3)">
              {!anyOk && !checking && (externalUrl.trim() || internalUrl.trim())
                ? "Weiter geht es, sobald eine der Adressen antwortet."
                : "Ein KIRA-Server bleibt immer nötig. Die App speichert keine Chats und keine Dokumente."}
            </span>
            <Button
              variant="primary"
              size="lg"
              softDisabled={!canContinue}
              busy={busy}
              aria-describedby="onb-footnote"
              iconRight={<IconArrowRight size={16} strokeWidth={2.6} />}
              onClick={() => void next()}
            >
              Weiter
            </Button>
          </footer>
        </main>
      ) : (
        <main className="onb-body" aria-labelledby="onb-title">
          <div className="flex items-center gap-4">
            <AppTile size={56} />
            <div className="flex min-w-0 flex-col gap-1">
              <h1 id="onb-title" ref={headingRef} tabIndex={-1} className="onb-title">
                Das kann KIRA für Mac
              </h1>
              <p className="onb-lead">Drei Dinge, die über den Browser hinausgehen. Die Arbeit macht weiter dein KIRA-Server.</p>
            </div>
          </div>

          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            <Feature icon={<IconBolt size={20} />} title="Schnellfenster" hotkey={hotkeys.quickWindow}>
              Frag KIRA aus jedem Programm, ohne das Hauptfenster zu öffnen.
            </Feature>
            <Feature icon={<IconMic size={20} />} title="Diktat in jedes Programm" hotkey={hotkeys.dictation} warning={sttWarning}>
              Der Text landet am Cursor. Erkannt auf dem Apple-Chip – der Ton bleibt auf dem Mac.
            </Feature>
            <Feature icon={<IconBell size={20} />} title="Mitteilungen vom Server" warning={bridgeWarning}>
              Fertige Antworten und Erinnerungen als macOS-Mitteilung, auch bei geschlossenem Fenster.
            </Feature>
          </ul>

          <InfoNote icon={<IconShield size={16} />}>
            macOS fragt später nach zwei Freigaben: <strong className="font-semibold">Mikrofon</strong> beim ersten Diktat und{" "}
            <strong className="font-semibold">Bedienungshilfen</strong>, damit KIRA Text in andere Programme einsetzen darf. Beides kannst du jederzeit in
            den Einstellungen ändern.
          </InfoNote>

          {error ? (
            <InfoNote tone="err" role="alert">
              {error}
            </InfoNote>
          ) : null}

          <footer className="mt-auto flex items-center justify-between gap-6">
            <Button variant="ghost" size="md" icon={<IconArrowLeft size={16} strokeWidth={2.4} />} disabled={busy} onClick={() => setStep(1)}>
              Zurück
            </Button>
            <Button variant="primary" size="lg" busy={busy} iconRight={<IconArrowRight size={16} strokeWidth={2.6} />} onClick={() => void finish()}>
              Los geht’s
            </Button>
          </footer>
        </main>
      )}
    </div>
  );
}

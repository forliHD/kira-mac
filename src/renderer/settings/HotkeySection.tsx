// Einstellungen → Tastenkürzel: Aufnahme per Tastendruck (Fokus → „Tasten
// drücken…“, Umwandlung in Electron-Schreibweise in lib/accelerator.ts),
// Konflikte aus der Antwort von setHotkeys.

import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { type HotkeyConfig } from "../../shared/local-api";
import { type Modifier, acceleratorFromEvent, describeAccelerator, modifierSymbols, modifiersOf, sameAccelerator, spokenAccelerator } from "../lib/accelerator";
import { errorText, localApi } from "../lib/useLocalState";
import { Button, GlassCard, InfoNote, Kbd, KbdCombo, SettingRow, Spinner, cx } from "../lib/ui";
import { type HotkeyName, type SectionProps } from "./shared";

const DEFAULTS: HotkeyConfig = { quickWindow: "Alt+Space", dictation: "Alt+Command+D" };
const LABEL: Record<HotkeyName, string> = { quickWindow: "Schnellfenster", dictation: "Diktat" };

function HotkeyRecorder({
  name,
  value,
  busy,
  startRecording,
  onRecord,
}: {
  name: HotkeyName;
  value: string;
  busy: boolean;
  /** Sofort fokussieren und aufnehmen (nach „Ändern“ im Bereich Diktat). */
  startRecording: boolean;
  onRecord: (accelerator: string) => void;
}): ReactNode {
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState<Modifier[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const finishedAt = useRef(0);
  const button = useRef<HTMLButtonElement>(null);
  const hintId = useId();

  useEffect(() => {
    if (!startRecording) return;
    button.current?.focus();
    setRecording(true);
  }, [startRecording]);

  // Während der Aufnahme die globalen Kürzel aussetzen – sonst löst z. B. ⌥⌘D
  // beim Drücken das Diktat aus, statt aufgenommen zu werden.
  useEffect(() => {
    if (!recording) return undefined;
    void localApi()
      .setHotkeyRecording(true)
      .catch(() => undefined);
    return () => {
      void localApi()
        .setHotkeyRecording(false)
        .catch(() => undefined);
    };
  }, [recording]);

  function stop(): void {
    setRecording(false);
    setHeld([]);
    finishedAt.current = performance.now();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    const result = acceleratorFromEvent(e.nativeEvent);
    switch (result.type) {
      case "cancel":
        setHint(null);
        stop();
        break;
      case "clear":
        setHint(null);
        stop();
        onRecord("");
        break;
      case "partial":
        setHeld(result.modifiers);
        break;
      case "invalid":
        setHeld(result.modifiers);
        setHint(result.message);
        break;
      case "done":
        setHint(null);
        stop();
        onRecord(result.accelerator);
        break;
      default:
        break;
    }
  }

  function onKeyUp(e: KeyboardEvent<HTMLButtonElement>): void {
    if (recording) {
      e.preventDefault();
      setHeld(modifiersOf(e.nativeEvent));
    } else if (performance.now() - finishedAt.current < 400) {
      // Die Leertaste des Kürzels würde sonst beim Loslassen den Knopf erneut auslösen.
      e.preventDefault();
    }
  }

  function onClick(e: MouseEvent<HTMLButtonElement>): void {
    if (recording || busy) return;
    if (e.detail === 0 && performance.now() - finishedAt.current < 400) return;
    setHint(null);
    setRecording(true);
  }

  const spoken = value ? spokenAccelerator(value) : "kein Kürzel";
  const ariaLabel = recording
    ? `${LABEL[name]}: Aufnahme läuft. Drück die neue Kombination, Escape bricht ab.`
    : `${LABEL[name]}: ${spoken}. Zum Ändern drücken.`;

  return (
    <div className="flex flex-col items-end gap-[6px]">
      <button
        ref={button}
        type="button"
        className={cx("hk-recorder", recording && "is-recording")}
        aria-label={ariaLabel}
        aria-describedby={hint ? hintId : undefined}
        aria-busy={busy || undefined}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={() => {
          if (recording) {
            setHint(null);
            stop();
          }
        }}
      >
        {busy ? (
          <Spinner />
        ) : recording ? (
          held.length ? (
            <span className="g-kbd-combo" aria-hidden="true">
              {modifierSymbols(held).map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
              <span className="hk-wait">…</span>
            </span>
          ) : (
            <span className="hk-wait" aria-hidden="true">
              Tasten drücken…
            </span>
          )
        ) : (
          <KbdCombo accelerator={value} />
        )}
      </button>
      {hint ? (
        <span id={hintId} className="hk-hint" role="status">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function HotkeySection({ state, setState, focusHotkey }: SectionProps & { focusHotkey: HotkeyName | null }): ReactNode {
  const [saving, setSaving] = useState<HotkeyName | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const hotkeys = state.hotkeys;

  async function apply(next: HotkeyConfig, which: HotkeyName | "all"): Promise<void> {
    setSaving(which);
    setError(null);
    setSaved(null);
    try {
      const result = await localApi().setHotkeys(next);
      // Die Konflikte stehen auch im Zustand (dictationStatus.hotkeyConflicts).
      setState({ ...result.state, dictationStatus: { ...result.state.dictationStatus, hotkeyConflicts: result.conflicts } });
      if (!result.conflicts.length) setSaved(which === "all" ? "Standard wiederhergestellt." : `${LABEL[which]}: ${describeAccelerator(next[which]) || "kein Kürzel"} gilt ab sofort.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(null);
    }
  }

  function record(name: HotkeyName, accelerator: string): void {
    const other: HotkeyName = name === "quickWindow" ? "dictation" : "quickWindow";
    if (accelerator && sameAccelerator(accelerator, hotkeys[other])) {
      setSaved(null);
      setError(`${describeAccelerator(accelerator)} nutzt schon das ${LABEL[other]}. Nimm eine andere Kombination.`);
      return;
    }
    if (sameAccelerator(accelerator, hotkeys[name])) return;
    void apply({ ...hotkeys, [name]: accelerator }, name);
  }

  const conflicts = state.dictationStatus.hotkeyConflicts;
  const isDefault = sameAccelerator(hotkeys.quickWindow, DEFAULTS.quickWindow) && sameAccelerator(hotkeys.dictation, DEFAULTS.dictation);

  return (
    <>
      <GlassCard>
        <SettingRow title="Schnellfenster" description="Frag KIRA aus jedem Programm heraus, ohne das Hauptfenster zu öffnen.">
          <HotkeyRecorder
            name="quickWindow"
            value={hotkeys.quickWindow}
            busy={saving === "quickWindow" || saving === "all"}
            startRecording={focusHotkey === "quickWindow"}
            onRecord={(a) => record("quickWindow", a)}
          />
        </SettingRow>
        <SettingRow title="Diktat" description="Spricht in das vorderste Programm, erkannt auf diesem Mac.">
          <HotkeyRecorder
            name="dictation"
            value={hotkeys.dictation}
            busy={saving === "dictation" || saving === "all"}
            startRecording={focusHotkey === "dictation"}
            onRecord={(a) => record("dictation", a)}
          />
        </SettingRow>
      </GlassCard>

      {conflicts.length ? (
        <InfoNote tone="warn" role="status">
          {conflicts.map((c) => (
            <div key={c}>{c}</div>
          ))}
        </InfoNote>
      ) : null}
      {error ? (
        <InfoNote tone="err" role="alert">
          {error}
        </InfoNote>
      ) : null}
      {saved ? (
        <InfoNote tone="ok" role="status">
          {saved}
        </InfoNote>
      ) : null}

      <div className="flex items-start justify-between gap-6">
        <p className="m-0 text-[12px] leading-[1.6] text-(--g-text-3)">
          Klick auf ein Kürzel und drück die neue Kombination mit <Kbd small>⌘</Kbd>, <Kbd small>⌥</Kbd> oder <Kbd small>⌃</Kbd>.{" "}
          <Kbd small>esc</Kbd> bricht ab, <Kbd small>⌫</Kbd> entfernt das Kürzel.
        </p>
        <Button variant="ghost" softDisabled={isDefault || saving !== null} onClick={() => void apply(DEFAULTS, "all")}>
          Standard wiederherstellen
        </Button>
      </div>
    </>
  );
}

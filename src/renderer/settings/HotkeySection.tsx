// Einstellungen → Tastenkürzel: Aufnahme per Tastendruck (Fokus → „Tasten
// drücken…“, Umwandlung in Electron-Schreibweise in lib/accelerator.ts),
// Konflikte aus der Antwort von setHotkeys. Das Diktat lässt sich statt auf
// eine Kombination auch auf die 🌐 fn-Taste legen (`hotkeys.dictation = "Fn"`,
// Stand in `dictationStatus.fnKey`, Logik in src/main/fn-key.ts).

import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { FN_HOTKEY, KEYBOARD_SETTINGS_URL, fnSystemActionLabel, isFnHotkey } from "../../shared/hotkey";
import { type FnKeyStatus, type HotkeyConfig } from "../../shared/local-api";
import { type Modifier, acceleratorFromEvent, describeAccelerator, modifierSymbols, modifiersOf, sameAccelerator, spokenAccelerator } from "../lib/accelerator";
import { IconGlobe, IconKeyboard } from "../lib/icons";
import { errorText, localApi } from "../lib/useLocalState";
import { Button, GlassCard, InfoNote, Kbd, KbdCombo, Pill, SettingRow, Spinner, type Tone, cx } from "../lib/ui";
import { type HotkeyName, type SectionProps } from "./shared";

const DEFAULTS: HotkeyConfig = { quickWindow: "Alt+Space", dictation: "Control+Alt+D" };
const LABEL: Record<HotkeyName, string> = { quickWindow: "Schnellfenster", dictation: "Diktat" };

type Trigger = "fn" | "combo";

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

  // Während der Aufnahme die globalen Kürzel (und die fn-Taste) aussetzen –
  // sonst löst z. B. ⌃⌥D beim Drücken das Diktat aus, statt aufgenommen zu werden.
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

/** Auswahl „🌐 fn-Taste“ oder „Tastenkombination“ (Radiogruppe, Pfeiltasten wechseln). */
function TriggerChoice({
  value,
  busy,
  labelledBy,
  describedBy,
  focus,
  onChange,
}: {
  value: Trigger;
  busy: boolean;
  labelledBy: string;
  describedBy: string | undefined;
  /** Nach „Ändern“ im Bereich Diktat den gewählten Knopf fokussieren. */
  focus: boolean;
  onChange: (value: Trigger) => void;
}): ReactNode {
  const refs = useRef(new Map<Trigger, HTMLButtonElement>());
  const options: Array<{ id: Trigger; label: ReactNode; spoken: string }> = [
    {
      id: "fn",
      label: (
        <>
          <IconGlobe size={13} strokeWidth={2.2} />
          fn-Taste
        </>
      ),
      spoken: "fn-Taste (Globus)",
    },
    {
      id: "combo",
      label: (
        <>
          <IconKeyboard size={14} strokeWidth={2} />
          Tastenkombination
        </>
      ),
      spoken: "Tastenkombination",
    },
  ];

  useEffect(() => {
    if (focus) refs.current.get(value)?.focus();
  }, [focus, value]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const next: Trigger = value === "fn" ? "combo" : "fn";
    refs.current.get(next)?.focus();
    if (!busy) onChange(next);
  }

  return (
    <div className="hk-seg" role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy} aria-busy={busy || undefined} onKeyDown={onKeyDown}>
      {options.map((o) => {
        const checked = o.id === value;
        return (
          <button
            key={o.id}
            ref={(el) => {
              if (el) refs.current.set(o.id, el);
              else refs.current.delete(o.id);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.spoken}
            tabIndex={checked ? 0 : -1}
            className="hk-seg-item"
            disabled={busy && !checked}
            onClick={() => {
              if (!checked && !busy) onChange(o.id);
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function fnPill(status: FnKeyStatus): { tone: Tone; text: string } {
  switch (status.state) {
    case "active":
      return { tone: "ok", text: "Aktiv" };
    case "starting":
      return { tone: "idle", text: "Wird eingeschaltet…" };
    case "paused":
      return { tone: "idle", text: "Pausiert" };
    case "permission":
      return { tone: "warn", text: "Freigabe fehlt" };
    case "unavailable":
      return { tone: "err", text: "Nicht verfügbar" };
    case "error":
      return { tone: "err", text: "Fehler" };
    default:
      return { tone: "idle", text: "Aus" };
  }
}

/** Hinweis, wenn macOS beim Drücken von fn/🌐 selbst etwas tut (Emoji, Eingabequelle …). */
function systemActionText(status: FnKeyStatus): string | null {
  const action = status.systemAction;
  if (action === null || action === "none") return null;
  if (action === "default") {
    return "macOS tut beim Tippen auf fn ab Werk selbst etwas (meist „Emoji & Symbole“) – zusätzlich zum Diktat.";
  }
  return `macOS ist bei fn auf „${fnSystemActionLabel(action)}“ gestellt und tut das beim Tippen zusätzlich zum Diktat.`;
}

export function HotkeySection({ state, setState, refresh, go, focusHotkey }: SectionProps & { focusHotkey: HotkeyName | null }): ReactNode {
  const [saving, setSaving] = useState<HotkeyName | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [granting, setGranting] = useState(false);
  const hotkeys = state.hotkeys;
  const fnMode = isFnHotkey(hotkeys.dictation);
  const fnKey = state.dictationStatus.fnKey;
  // Zuletzt genutzte Kombination – kommt zurück, wenn man von fn zurückschaltet.
  const lastCombo = useRef(fnMode || !hotkeys.dictation ? DEFAULTS.dictation : hotkeys.dictation);
  useEffect(() => {
    if (hotkeys.dictation && !isFnHotkey(hotkeys.dictation)) lastCombo.current = hotkeys.dictation;
  }, [hotkeys.dictation]);

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

  function chooseTrigger(trigger: Trigger): void {
    // Wer selbst umschaltet, will danach keine automatische Aufnahme mehr („Ändern“ aus Diktat).
    if (focusHotkey) go("kuerzel");
    if (trigger === "fn") {
      if (!fnMode) void apply({ ...hotkeys, dictation: FN_HOTKEY }, "dictation");
      return;
    }
    if (!fnMode) return;
    const combo = sameAccelerator(lastCombo.current, hotkeys.quickWindow) ? DEFAULTS.dictation : lastCombo.current;
    void apply({ ...hotkeys, dictation: combo }, "dictation");
  }

  async function grantAccessibility(): Promise<void> {
    setGranting(true);
    setError(null);
    try {
      // Fragt macOS bzw. öffnet „Datenschutz & Sicherheit → Bedienungshilfen“.
      await localApi().requestPermission("accessibility");
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setGranting(false);
    }
  }

  function openKeyboardSettings(): void {
    void localApi()
      .openLink(KEYBOARD_SETTINGS_URL)
      .catch((err: unknown) => setError(errorText(err)));
  }

  const conflicts = state.dictationStatus.hotkeyConflicts;
  const isDefault = sameAccelerator(hotkeys.quickWindow, DEFAULTS.quickWindow) && sameAccelerator(hotkeys.dictation, DEFAULTS.dictation);
  const dictationBusy = saving === "dictation" || saving === "all";
  const pill = fnPill(fnKey);
  const systemHint = fnMode ? systemActionText(fnKey) : null;

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
          {(ids) => (
            <TriggerChoice
              value={fnMode ? "fn" : "combo"}
              busy={dictationBusy}
              labelledBy={ids.titleId}
              describedBy={ids.descId}
              focus={fnMode && focusHotkey === "dictation"}
              onChange={chooseTrigger}
            />
          )}
        </SettingRow>
        {fnMode ? (
          <SettingRow
            title={
              <span className="inline-flex items-center gap-2">
                <KbdCombo accelerator={FN_HOTKEY} small />
                So geht’s
              </span>
            }
            description="Kurz tippen: Diktat an oder aus. Gedrückt halten: sprechen – loslassen setzt den Text ein. Zusammen mit einer anderen Taste (fn + ←, fn + ⌫ …) bleibt fn, was es war."
          >
            <Pill tone={pill.tone}>{pill.text}</Pill>
          </SettingRow>
        ) : (
          <SettingRow title="Tastenkombination" description="Startet und beendet das Diktat.">
            <HotkeyRecorder
              name="dictation"
              value={hotkeys.dictation}
              busy={dictationBusy}
              startRecording={focusHotkey === "dictation"}
              onRecord={(a) => record("dictation", a)}
            />
          </SettingRow>
        )}
      </GlassCard>

      {fnMode && fnKey.state === "permission" ? (
        <InfoNote tone="warn" role="status">
          <div className="hk-note">
            <span>KIRA sieht die fn-Taste erst mit der Freigabe „Bedienungshilfen“ – derselben, mit der KIRA Text in andere Programme einsetzt.</span>
            <Button busy={granting} disabled={granting} onClick={() => void grantAccessibility()}>
              Bedienungshilfen öffnen
            </Button>
          </div>
        </InfoNote>
      ) : null}
      {fnMode && (fnKey.state === "unavailable" || fnKey.state === "error") && fnKey.message ? (
        <InfoNote tone="err" role="status">
          {fnKey.message}
        </InfoNote>
      ) : null}
      {systemHint ? (
        <InfoNote tone="warn">
          <div className="hk-note">
            <span>{systemHint} Stell in den Tastatur-Einstellungen für die fn-Taste „Keine Aktion“ ein.</span>
            <Button onClick={openKeyboardSettings}>Tastatur-Einstellungen öffnen</Button>
          </div>
        </InfoNote>
      ) : null}

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

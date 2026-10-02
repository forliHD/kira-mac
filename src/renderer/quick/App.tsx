// Schnellfenster (⌥Leertaste): nativer Mini-Chat auf Liquid Glass.
//
// Der Hauptprozess (src/main/quick-chat.ts) führt das Gespräch und schickt nur
// `QuickState` (Ereignis "quick"); diese Seite zeichnet und nimmt Eingaben an.
// Das Glas kommt vom System (NSGlassEffectView bzw. Vibrancy) – die Seite ist
// transparent und zeichnet nur Lichtkanten und leicht abgedunkelte Flächen
// (quick.css). Die Fensterhöhe folgt dem Inhalt (useReportHeight).

import { type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { type KiraLocalApi, type QuickDictation, type QuickMessage, type QuickTool } from "../../shared/local-api";
import { localApi } from "../lib/useLocalState";
import {
  AlertIcon,
  ArrowUpIcon,
  BrainIcon,
  BubbleIcon,
  CheckIcon,
  ChevronIcon,
  ChipIcon,
  ComposeIcon,
  CrossIcon,
  HistoryIcon,
  MicIcon,
  OfflineIcon,
  OpenIcon,
  StopIcon,
} from "./icons";
import {
  type KeyInfo,
  LOCAL_NOTE,
  OFFLINE_HINT,
  activityLine,
  connectionPill,
  footerNote,
  formatAccelerator,
  groupTools,
  insertText,
  isSubmitKey,
  isSymbolCap,
  keyAction,
  micLevel,
  partialPreview,
  stoppedNote,
  suggestionsFor,
} from "./logic";
import { MarkdownView } from "./MarkdownView";
import { errorText, useQuickState } from "./useQuickState";
import { updateFade, useReportHeight } from "./useReportHeight";

function keyInfo(event: KeyboardEvent): KeyInfo {
  return {
    key: event.key,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    // keyCode 229: so melden Browser Tasten während einer IME-Komposition.
    isComposing: event.nativeEvent.isComposing || event.keyCode === 229,
  };
}

/** IPC-Aufruf ohne Rückmeldung an die Seite (der Hauptprozess protokolliert selbst). */
function call(fn: (api: KiraLocalApi) => Promise<unknown>): void {
  try {
    fn(localApi()).catch(() => undefined);
  } catch {
    /* Ohne KiraLocal (Vorschau im Browser) gibt es nichts zu tun. */
  }
}

export function App(): ReactNode {
  const { state, error } = useQuickState();
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const rootRef = useRef<HTMLElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const followRef = useRef(true);
  const caretRef = useRef<number | null>(null);

  const heightRefs = useMemo(() => ({ root: rootRef, thread: threadRef, content: logRef, follow: followRef }), []);
  const reportHeight = useCallback((height: number) => call((api) => api.quickResize(height)), []);
  useReportHeight(heightRefs, reportHeight);

  const messages = state?.messages ?? [];
  const hasMessages = messages.length > 0;
  const busy = state?.busy ?? false;
  const mode = state?.mode ?? null;
  const sessionId = state?.sessionId ?? null;
  const dictation = state?.dictation ?? null;

  // Owner-Fund 02.10.2026: nach dem Senden blieb die neue Nachricht unten
  // außer Sicht. Folgt der Verlauf dem Ende, nach JEDER Änderung der
  // Nachrichten (neue Nachricht, Text, Werkzeuge, Denkschritte) ans Ende –
  // zusätzlich zur Höhenmessung (useReportHeight), die nur auf Größenänderungen
  // reagiert. tests/quick-scroll.test.tsx
  const lastMessage = messages[messages.length - 1];
  const scrollKey = `${messages.length}:${lastMessage?.id ?? ""}:${lastMessage?.text.length ?? 0}:${lastMessage?.tools.length ?? 0}:${lastMessage?.reasoning.length ?? 0}:${lastMessage?.status ?? ""}`;
  useLayoutEffect(() => {
    const thread = threadRef.current;
    if (!thread || thread.hidden || !followRef.current) return;
    thread.scrollTop = thread.scrollHeight;
    updateFade(thread);
  }, [scrollKey]);

  // Schreibmarke nach programmgesteuerter Änderung (Diktat, Vorschlag) setzen.
  useLayoutEffect(() => {
    const caret = caretRef.current;
    const input = inputRef.current;
    if (caret === null || !input) return;
    caretRef.current = null;
    input.focus();
    input.setSelectionRange(caret, caret);
  }, [draft]);

  const replaceDraft = useCallback((value: string, caret: number) => {
    const input = inputRef.current;
    if (input && input.value === value) {
      input.focus();
      input.setSelectionRange(caret, caret);
      return;
    }
    caretRef.current = caret;
    setDraft(value);
  }, []);

  useEffect(() => {
    try {
      return localApi().on((event) => {
        if (event.type === "quick-shown") {
          followRef.current = true;
          const thread = threadRef.current;
          if (thread) thread.scrollTop = thread.scrollHeight;
          inputRef.current?.focus();
          inputRef.current?.select();
        } else if (event.type === "quick-insert") {
          const input = inputRef.current;
          if (!input) return;
          const next = insertText(input.value, input.selectionStart, input.selectionEnd, event.text);
          if (next.value !== input.value) replaceDraft(next.value, next.caret);
        }
      });
    } catch {
      return undefined;
    }
  }, [replaceDraft]);

  const submit = (): void => {
    const text = (inputRef.current?.value ?? draft).trim();
    if (!text || !state || state.busy) return;
    followRef.current = true;
    setNotice(null);
    setDraft("");
    // Kam der Klick vom Senden-Knopf, verschwindet der gleich (wird Stopp) – Fokus ins Feld.
    inputRef.current?.focus();
    try {
      localApi()
        .quickSend(text)
        .catch((err: unknown) => {
          setNotice(errorText(err));
          setDraft((current) => current || text);
        });
    } catch (err) {
      setNotice(errorText(err));
      setDraft(text);
    }
  };

  const reset = (): void => {
    followRef.current = true;
    setNotice(null);
    call((api) => api.quickReset());
    inputRef.current?.focus();
  };

  const stop = (): void => {
    call((api) => api.quickStop());
    inputRef.current?.focus();
  };

  const openInMain = (): void => call((api) => api.quickOpenInMain());
  const onLink = useCallback((href: string) => call((api) => api.openLink(href)), []);

  const toggleDictation = (): void => {
    if (!dictation) return;
    if (!dictation.available && !dictation.active) {
      setNotice(dictation.reason ? `Diktat nicht verfügbar: ${dictation.reason}` : "Diktat ist gerade nicht verfügbar.");
      return;
    }
    setNotice(null);
    call((api) => api.quickToggleDictation());
    // Fokus zurück ins Feld: der fertige Text landet an der Schreibmarke.
    inputRef.current?.focus();
  };

  const onRootKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const action = keyAction(keyInfo(event), { hasSession: sessionId !== null });
    if (action) {
      event.preventDefault();
      if (action === "hide") call((api) => api.quickHide());
      else if (action === "open-main") openInMain();
      else reset();
      return;
    }
    // Liegt der Fokus auf der Fläche (Klick in eine Antwort), geht Tippen ins Eingabefeld.
    if (event.target === event.currentTarget && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      inputRef.current?.focus();
    }
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isSubmitKey(keyInfo(event))) {
      event.preventDefault();
      submit();
    }
  };

  /** Klick auf den Rand der Eingabe setzt den Fokus ins Feld. */
  const onComposerMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      event.preventDefault();
      inputRef.current?.focus();
    }
  };

  /**
   * Verschwindet das fokussierte Element (Senden wird Stopp, „Neuer Chat“ nach
   * dem Leeren), landet der Fokus auf <body> – dann kämen Esc & Co. nicht mehr
   * am Wurzelelement an. Solange das Fenster den Fokus hat: zurück ins Feld.
   */
  const onRootBlur = (event: FocusEvent<HTMLElement>): void => {
    if (event.relatedTarget !== null) return;
    requestAnimationFrame(() => {
      if (document.hasFocus() && (document.activeElement === document.body || document.activeElement === null)) inputRef.current?.focus({ preventScroll: true });
    });
  };

  const onThreadScroll = (): void => {
    const thread = threadRef.current;
    if (!thread) return;
    followRef.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 28;
    updateFade(thread);
  };

  const pill = connectionPill(state);
  const note = footerNote(mode);
  const suggestions = suggestionsFor(mode);
  const quickKeys = formatAccelerator(state?.hotkeys.quickWindow || "Alt+Space");
  const dictationKeys = state?.hotkeys.dictation ? formatAccelerator(state.hotkeys.dictation).join("") : null;
  const canSend = draft.trim() !== "" && state !== null && !busy;
  const shownNotice = notice ?? error;
  // Diktat: in ein leeres Feld steht der flüchtige Text als Platzhalter IM Feld,
  // sonst als Zeile darunter (der fertige Text kommt per "quick-insert").
  const dictating = dictation?.active ?? false;
  const partial = dictating ? partialPreview(dictation?.partial ?? "") : "";
  const partialInField = dictating && draft === "";

  return (
    <main ref={rootRef} className="qw" tabIndex={-1} onKeyDown={onRootKeyDown} onBlur={onRootBlur}>
      <div className="q-specular" aria-hidden="true" />

      <header className="q-head">
        <div className="q-brand">
          <span className="q-logo" aria-hidden="true">
            <BubbleIcon size={16} />
          </span>
          <h1 className="q-title">KIRA</h1>
          <span className="q-pill q-conn" data-tone={pill.tone} role="status" title={pill.text}>
            <span className="q-dot" aria-hidden="true" />
            <span className="q-ellipsis">{pill.text}</span>
          </span>
        </div>
        <div className="q-head-actions">
          {hasMessages || sessionId !== null ? (
            <>
              <button type="button" className="q-iconbtn" aria-label="Neuer Chat" title="Neuer Chat (⌘N)" aria-keyshortcuts="Meta+N" onClick={reset}>
                <ComposeIcon size={15} />
              </button>
              {sessionId !== null ? (
                <button
                  type="button"
                  className="q-iconbtn"
                  aria-label="Im Hauptfenster öffnen"
                  title="Im Hauptfenster öffnen (⌘↩)"
                  aria-keyshortcuts="Meta+Enter"
                  onClick={openInMain}
                >
                  <OpenIcon size={15} />
                </button>
              ) : null}
            </>
          ) : (
            <span className="q-hint">
              Schnellfenster
              <span className="q-kbds">
                {quickKeys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </span>
          )}
        </div>
      </header>

      <div className="q-composer" onMouseDown={onComposerMouseDown}>
        <label htmlFor="q-input" className="sr-only">
          Frag KIRA
        </label>
        <div className="q-field" onMouseDown={onComposerMouseDown}>
          <textarea
            id="q-input"
            ref={inputRef}
            className={`q-input${partialInField ? " is-dictating" : ""}`}
            rows={1}
            value={draft}
            placeholder={partialInField ? partial || "Ich höre zu …" : "Frag KIRA …"}
            spellCheck
            autoFocus
            onChange={(event) => {
              setDraft(event.target.value);
              if (notice) setNotice(null);
            }}
            onKeyDown={onInputKeyDown}
          />
          {dictating && !partialInField ? (
            <p className="q-partial">
              {partial ? (
                <>
                  {partial}
                  <span className="q-caret" aria-hidden="true" />
                </>
              ) : (
                "Ich höre zu …"
              )}
            </p>
          ) : null}
        </div>
        <MicButton dictation={dictation} shortcut={dictationKeys} onClick={toggleDictation} />
        {busy ? (
          <button type="button" className="q-btn q-btn-pill q-stop" aria-label="Stoppen" title="Stoppen" onClick={stop}>
            <StopIcon size={13} />
          </button>
        ) : (
          <button type="button" className="q-btn q-send" aria-label="Senden" title="Senden (↩)" aria-keyshortcuts="Enter" disabled={!canSend} onClick={submit}>
            <ArrowUpIcon size={18} />
          </button>
        )}
      </div>
      {shownNotice ? (
        <p className="q-notice" role="status">
          {shownNotice}
        </p>
      ) : null}

      <div ref={threadRef} className="q-thread" hidden={!hasMessages} onScroll={onThreadScroll}>
        <div ref={logRef} className="q-log" role="log" aria-live="polite" aria-busy={busy} aria-label="Unterhaltung">
          {messages.map((message) =>
            message.role === "user" ? <UserMessage key={message.id} message={message} /> : <AssistantMessage key={message.id} message={message} onLink={onLink} />,
          )}
        </div>
      </div>

      {!hasMessages ? (
        suggestions.length > 0 ? (
          <div className="q-suggest" role="group" aria-label="Vorschläge">
            {suggestions.map((s) => (
              <button key={s.label} type="button" className="q-sugg" onClick={() => replaceDraft(s.fill, s.fill.length)}>
                {s.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="q-offline">
            <OfflineIcon size={15} />
            <span>{OFFLINE_HINT}</span>
          </p>
        )
      ) : null}

      <footer className="q-foot">
        <div className="q-keys">
          <span>
            <Kbd>↩</Kbd> Senden
          </span>
          {sessionId !== null ? (
            <span>
              <Kbd>⌘↩</Kbd> Im Hauptfenster
            </span>
          ) : null}
          <span>
            <Kbd>esc</Kbd> Schließen
          </span>
        </div>
        <span className="q-pill q-foot-pill" data-icon={note.icon}>
          {note.icon === "chip" ? <ChipIcon size={13} /> : note.icon === "off" ? <OfflineIcon size={13} /> : <HistoryIcon size={13} />}
          <span className="q-ellipsis">{note.text}</span>
        </span>
      </footer>
    </main>
  );
}

function Kbd({ children }: { children: string }): ReactNode {
  return <kbd className={`q-kbd${isSymbolCap(children) ? " is-sym" : ""}`}>{children}</kbd>;
}

function MicButton({ dictation, shortcut, onClick }: { dictation: QuickDictation | null; shortcut: string | null; onClick: () => void }): ReactNode {
  const active = dictation?.active ?? false;
  const unavailable = !active && !(dictation?.available ?? false);
  const action = active ? "Diktat beenden" : "Diktieren";
  const title = unavailable
    ? dictation?.reason
      ? `Diktat nicht verfügbar: ${dictation.reason}`
      : "Diktat nicht verfügbar"
    : shortcut
      ? `${action} (${shortcut})`
      : action;
  const style = { "--q-lvl": micLevel(dictation?.level ?? 0).toFixed(3) } as CSSProperties;
  return (
    <button
      type="button"
      className={`q-btn q-btn-pill q-mic${active ? " is-active" : ""}`}
      // Umschalter: gleiches Label, der Zustand steckt in aria-pressed.
      aria-label="Diktieren"
      aria-pressed={active}
      aria-disabled={unavailable || undefined}
      title={title}
      style={style}
      onClick={onClick}
    >
      <MicIcon size={18} />
    </button>
  );
}

function UserMessage({ message }: { message: QuickMessage }): ReactNode {
  return (
    <div className="q-msg q-msg-user">
      <span className="sr-only">Du:</span>
      <div className="q-bubble">{message.text}</div>
    </div>
  );
}

/**
 * Denkschritte eingeklappt wie im Dashboard („Nachgedacht · 3 Schritte“), auf
 * Klick aufgeklappt. Owner-Wunsch 02.10.2026: sehen können, was KIRA gedacht hat,
 * ohne dass es Platz frisst.
 */
export function Reasoning({ steps, streaming }: { steps: string[]; streaming: boolean }): ReactNode {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  const count = `${steps.length} ${steps.length === 1 ? "Schritt" : "Schritte"}`;
  const preview = steps[steps.length - 1]?.replace(/\s+/g, " ").trim() ?? "";
  return (
    <div className={`q-reason${open ? " is-open" : ""}`}>
      <button type="button" className="q-reason-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={`q-reason-dot${streaming ? " is-busy" : ""}`} aria-hidden="true" />
        <BrainIcon size={14} className="q-reason-icon" />
        <span className="q-reason-label">{streaming ? "Denkt nach" : "Nachgedacht"}</span>
        <span className="q-reason-count">{count}</span>
        {!open ? <span className="q-reason-preview">{preview}</span> : <span className="q-reason-spacer" />}
        <ChevronIcon size={14} className="q-reason-chevron" />
      </button>
      {open ? (
        <ol className="q-reason-steps">
          {steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function AssistantMessage({ message, onLink }: { message: QuickMessage; onLink: (href: string) => void }): ReactNode {
  const streaming = message.status === "streaming";
  const hasText = message.text.trim() !== "";
  // „Denkt nach…“ steht schon in der Denkschritt-Zeile – nicht doppelt zeigen.
  const rawActivity = activityLine(message);
  const activity = rawActivity === "Denkt nach…" && message.reasoning.length > 0 ? null : rawActivity;
  return (
    <div className="q-msg q-msg-kira">
      {/* Wie im Dashboard-Chat: das „K“ der Marke statt einer leeren Fläche. */}
      <span className={`q-avatar${streaming ? " is-busy" : ""}`} aria-hidden="true">
        K
      </span>
      <div className="q-msg-body">
        <span className="sr-only">KIRA:</span>
        <Reasoning steps={message.reasoning} streaming={streaming && !hasText} />
        {message.tools.length > 0 ? <ToolChips tools={message.tools} /> : null}
        {activity ? (
          <p className="q-activity">
            <span className="q-shimmer">{activity}</span>
          </p>
        ) : null}
        {hasText ? <MarkdownView text={message.text} onLink={onLink} caret={streaming} /> : null}
        {!hasText && message.status === "done" ? <p className="q-note">Keine Antwort erhalten.</p> : null}
        {message.status === "error" ? (
          <p className="q-error">
            <AlertIcon size={15} />
            <span>{message.error || "Unbekannter Fehler."}</span>
          </p>
        ) : null}
        {message.status === "stopped" ? <p className="q-note">{stoppedNote(message.local)}</p> : null}
        {message.local ? (
          <p className="q-local">
            <ChipIcon size={13} />
            <span>{LOCAL_NOTE}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

const TOOL_STATUS_TEXT: Record<QuickTool["status"], string> = { running: "läuft", done: "fertig", error: "fehlgeschlagen" };

function ToolChips({ tools }: { tools: QuickTool[] }): ReactNode {
  return (
    <ul className="q-tools" aria-label="Werkzeuge">
      {groupTools(tools).map((group) => (
        <li key={group.label} className="q-tool" data-status={group.status}>
          {group.status === "running" ? (
            <span className="q-spinner" aria-hidden="true" />
          ) : group.status === "done" ? (
            <CheckIcon size={12} className="q-tool-icon" />
          ) : (
            <CrossIcon size={12} className="q-tool-icon" />
          )}
          <span className="q-tool-label">{group.label}</span>
          {group.count > 1 ? <span className="q-tool-count">×{group.count}</span> : null}
          <span className="sr-only">{` – ${TOOL_STATUS_TEXT[group.status]}`}</span>
        </li>
      ))}
    </ul>
  );
}

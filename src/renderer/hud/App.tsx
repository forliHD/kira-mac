// Diktat-HUD (⌃⌥D): rahmenloses, nicht fokussierbares Panel unten mittig.
// Das Glas zeichnet der Hauptprozess (Liquid Glass bzw. Vibrancy, Radius 24);
// die Seite ist transparent und malt nur Lichtkante, Glanz und Inhalt.
// Zustand kommt ausschließlich per `local:event` (type "hud"); Kürzel und
// Glasart einmal über getState (und bei späteren "state"-Ereignissen).
// Das ganze Panel ist Zieh-Bereich – bis auf den Stopp-Knopf.

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { type HudPhase, type HudState } from "../../shared/local-api";
import { IconAlert, IconClose, IconMic, IconStop } from "../lib/icons";
import { applyUiAttributes, localApi } from "../lib/useLocalState";
import { KbdCombo, Spinner, cx } from "../lib/ui";

const INITIAL: HudState = { phase: "starting", level: 0, partial: "", app: null, message: null };
const BARS = 7;
/** Hüllkurve: die äußeren Balken etwas kürzer, wie eine Welle. */
const ENVELOPE = [0.62, 0.8, 0.94, 1, 0.94, 0.8, 0.62];

/** RMS (0…1, ~10/s vom Helfer) → Balkenhöhe 0…1, logarithmisch wie das Ohr. */
function levelToBar(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 50) / 38));
}

function isProblem(phase: HudPhase): boolean {
  return phase === "unavailable" || phase === "error";
}

function label(state: HudState): string {
  switch (state.phase) {
    case "starting":
      return "Diktat startet";
    case "listening":
      return state.app ? `Diktat in ${state.app}` : "Diktat läuft";
    case "stopping":
      return "Diktat endet";
    case "unavailable":
      return "Diktat nicht verfügbar";
    case "error":
      return "Diktat abgebrochen";
    default:
      return "Diktat";
  }
}

function placeholder(state: HudState): string {
  switch (state.phase) {
    case "starting":
      return "Mikrofon wird vorbereitet…";
    case "stopping":
      return "Der letzte Satz wird eingefügt…";
    default:
      return state.app ? `Sprich einfach – der Text landet in ${state.app}.` : "Sprich einfach – der Text landet im vordersten Programm.";
  }
}

/** Letzte Pegel als Balken (alt links → neu rechts); ohne Zuhören flach. */
function useLevelHistory(state: HudState): number[] {
  const [history, setHistory] = useState<number[]>(() => Array.from({ length: BARS }, () => 0));
  useEffect(() => {
    const value = state.phase === "listening" ? levelToBar(state.level) : 0;
    setHistory((h) => [...h.slice(1), value]);
  }, [state]);
  return history;
}

/** Flüchtiger Text: passt er nicht, bleibt das ENDE sichtbar (links ausgeblendet). */
function TailText({ text, className }: { text: string; className?: string }): ReactNode {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    const measure = (): void => {
      if (outer.current && inner.current) setOverflow(inner.current.offsetWidth > outer.current.clientWidth + 1);
    };
    measure();
    const el = outer.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  return (
    <span ref={outer} className={cx("hud-tail", overflow && "is-overflow", className)}>
      <span ref={inner}>{text}</span>
    </span>
  );
}

export function App(): ReactNode {
  const [state, setState] = useState<HudState>(INITIAL);
  const [hotkey, setHotkey] = useState("Control+Alt+D");
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    let alive = true;
    let off = (): void => undefined;
    try {
      const api = localApi();
      off = api.on((event) => {
        if (event.type === "hud") setState(event.hud);
        else if (event.type === "state") {
          setHotkey(event.state.hotkeys.dictation);
          applyUiAttributes(event.state.ui);
        }
      });
      void api.getState().then(
        (s) => {
          if (!alive) return;
          setHotkey(s.hotkeys.dictation);
          applyUiAttributes(s.ui);
        },
        () => undefined,
      );
    } catch {
      /* außerhalb der App: nur der Anfangszustand */
    }
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Neuer Lauf: den gedrückten Stopp-Knopf wieder freigeben – spätestens nach
  // 4 s, falls der Hauptprozess (warum auch immer) keine neue Phase meldet.
  useEffect(() => {
    if (state.phase === "starting" || state.phase === "listening") setStopping(false);
  }, [state.phase]);
  useEffect(() => {
    if (!stopping) return undefined;
    const t = setTimeout(() => setStopping(false), 4000);
    return () => clearTimeout(t);
  }, [stopping]);

  const bars = useLevelHistory(state);
  const problem = isProblem(state.phase);
  const busy = !problem && (state.phase === "stopping" || stopping);

  function stop(): void {
    if (!problem) setStopping(true);
    try {
      void localApi()
        .hudStop()
        .catch(() => setStopping(false));
    } catch {
      setStopping(false);
    }
  }

  let line: ReactNode;
  if (problem) {
    line = <span className="hud-line is-message">{state.message ?? "Die Spracherkennung ist gerade nicht verfügbar."}</span>;
  } else if (state.partial) {
    line = <TailText text={state.partial} className="hud-line" />;
  } else {
    line = <span className="hud-line is-placeholder hud-ellipsis">{state.message ?? placeholder(state)}</span>;
  }

  const newest = bars[BARS - 1] ?? 0;

  return (
    <main className="hud" data-phase={state.phase} data-problem={problem ? "true" : undefined} aria-label="Diktat">
      <div className="hud-orb" aria-hidden="true">
        {state.phase === "listening" ? <span className="hud-ring" /> : null}
        <span className="hud-orb-core" style={problem ? undefined : { transform: `scale(${(1 + newest * 0.06).toFixed(3)})` }}>
          <IconMic size={18} strokeWidth={2.3} />
        </span>
      </div>

      <div className="hud-bars" aria-hidden="true">
        {bars.map((v, i) => (
          <span key={i} className="hud-bar" style={{ height: `${Math.round(4 + v * (ENVELOPE[i] ?? 1) * 22)}px` }} />
        ))}
      </div>

      <div className="hud-text" role="status">
        <span className={cx("hud-label", problem && `is-${state.phase}`)}>
          {problem ? <IconAlert size={13} strokeWidth={2.4} /> : null}
          <span className="hud-ellipsis">{label(state)}</span>
          {state.phase === "listening" ? <span className="g-dot is-ok is-glow hud-dot" aria-hidden="true" /> : null}
          {state.phase === "starting" || state.phase === "stopping" ? <span className="g-dot is-warn hud-dot" aria-hidden="true" /> : null}
        </span>
        {line}
      </div>

      <div className="hud-actions">
        <KbdCombo accelerator={hotkey} small joined />
        <button
          type="button"
          className="g-btn g-btn-glass g-btn-icon hud-stop"
          aria-label={problem ? "Schließen" : "Diktat beenden"}
          title={problem ? "Schließen" : "Diktat beenden"}
          disabled={busy}
          onClick={stop}
        >
          {problem ? <IconClose size={16} strokeWidth={2.4} /> : busy ? <Spinner /> : <IconStop size={16} />}
        </button>
      </div>
    </main>
  );
}

// Diktat-HUD: Pegel, flüchtiger Text, Zielprogramm, Stopp. Bekommt seinen
// Zustand ausschließlich per `local:event` (type "hud") vom Hauptprozess.

import { type ReactNode, useEffect, useState } from "react";

import { type HudState } from "../../shared/local-api";
import { localApi } from "../lib/useLocalState";

const INITIAL: HudState = { phase: "starting", level: 0, partial: "", app: null, message: null };

function phaseLabel(state: HudState): string {
  switch (state.phase) {
    case "starting":
      return "Diktat startet…";
    case "listening":
      return state.app ? `Diktat in ${state.app}` : "Diktat läuft";
    case "stopping":
      return "Diktat wird beendet…";
    case "unavailable":
      return "Diktat nicht verfügbar";
    case "error":
      return "Diktat abgebrochen";
    default:
      return "Diktat";
  }
}

export function App(): ReactNode {
  const [state, setState] = useState<HudState>(INITIAL);

  useEffect(() => {
    try {
      return localApi().on((event) => {
        if (event.type === "hud") setState(event.hud);
      });
    } catch {
      return undefined;
    }
  }, []);

  const bars = 18;
  const active = Math.round(Math.min(1, state.level * 2.2) * bars);
  const problem = state.phase === "unavailable" || state.phase === "error";

  return (
    <main className="k-drag flex h-screen flex-col justify-between rounded-[14px] px-4 py-3 text-text">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`size-2.5 rounded-full ${problem ? "bg-err" : state.phase === "listening" ? "bg-ok" : "bg-warn"}`} aria-hidden="true" />
          <span className="text-[12px] font-semibold">{phaseLabel(state)}</span>
        </div>
        <button className="k-btn k-nodrag px-2 py-1 text-[11px]" onClick={() => void localApi().hudStop()}>
          Stopp
        </button>
      </div>

      {problem ? (
        <p className="text-[12px] text-err">{state.message}</p>
      ) : (
        <>
          <div className="flex h-6 items-end gap-[3px]" aria-hidden="true">
            {Array.from({ length: bars }, (_, i) => (
              <span
                key={i}
                className={`w-[5px] rounded-sm transition-[height] duration-75 ${i < active ? "bg-brand" : "bg-tint-strong"}`}
                style={{ height: `${Math.max(3, (i < active ? 100 : 20) * (0.35 + 0.65 * Math.sin((Math.PI * (i + 1)) / (bars + 1)))) / 4}px` }}
              />
            ))}
          </div>
          <p className="min-h-[18px] truncate text-[12px] text-text-2" title={state.partial}>
            {state.partial || state.message || (state.phase === "listening" ? "Sprich – der Text landet im vordersten Programm." : "")}
          </p>
        </>
      )}
    </main>
  );
}

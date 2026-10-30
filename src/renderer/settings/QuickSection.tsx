// Einstellungen → Schnellfenster (Phase 3, 0.5.0): Lage, Gesprächshöhe,
// Textgröße, Sendetaste, Verhalten nach dem Senden, Gespräch fortsetzen,
// Vorschläge, Mikrofon-Knopf. Das Erscheinungsbild folgt dem System: das Glas
// ist nativ, eine eigene Wahl würde nur den Text umfärben.

import { type ReactNode, useState } from "react";

import { QUICK_RESET_CHOICES, type QuickSettings } from "../../shared/local-api";
import { errorText, localApi } from "../lib/useLocalState";
import { Button, GlassCard, InfoNote, KbdCombo, SettingRow, Switch } from "../lib/ui";
import { type SectionProps } from "./shared";

const SHARES = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

function resetLabel(minutes: number): string {
  return minutes === 0 ? "Immer fortsetzen" : `Neu nach ${minutes} Minuten Ruhe`;
}

export function QuickSection({ state, setState, go }: SectionProps): ReactNode {
  const [pending, setPending] = useState<Partial<QuickSettings>>({});
  const [error, setError] = useState<string | null>(null);
  const { heights, ...saved } = state.quick;
  const quick: QuickSettings = { ...saved, ...pending };
  const remembered = Object.keys(heights).length;

  async function update(patch: Partial<QuickSettings>): Promise<void> {
    setPending((p) => ({ ...p, ...patch }));
    setError(null);
    try {
      setState(await localApi().setQuick({ ...quick, ...patch }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending({});
    }
  }

  async function forgetHeights(): Promise<void> {
    setError(null);
    try {
      setState(await localApi().resetQuickHeights());
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <>
      <GlassCard>
        <SettingRow title="Tastenkürzel" description="Öffnet und schließt das Schnellfenster in jedem Programm.">
          <KbdCombo accelerator={state.hotkeys.quickWindow} />
          <Button aria-label="Tastenkürzel für das Schnellfenster ändern" onClick={() => go("kuerzel", "quickWindow")}>
            Ändern
          </Button>
        </SettingRow>
        <SettingRow title="Lage" description="Oben: die Oberkante bleibt bei 10 % der Arbeitsfläche. Mittig: das Fenster sitzt in der Mitte und wächst nach beiden Seiten.">
          {(ids) => (
            <select className="g-select" aria-labelledby={ids.titleId} aria-describedby={ids.descId} value={quick.position} onChange={(e) => void update({ position: e.target.value === "center" ? "center" : "top" })}>
              <option value="top">Oben</option>
              <option value="center">Mittig</option>
            </select>
          )}
        </SettingRow>
        <SettingRow
          title="Höhe im Gespräch"
          description="Mit der ersten Nachricht nimmt das Fenster einmal diese Höhe an; der Verlauf scrollt innen, die Eingabe bleibt unten. Der untere Rand lässt sich ziehen."
        >
          {(ids) => (
            <select
              className="g-select"
              aria-labelledby={ids.titleId}
              aria-describedby={ids.descId}
              value={String(SHARES.reduce((best, s) => (Math.abs(s - quick.chatHeightShare) < Math.abs(best - quick.chatHeightShare) ? s : best), 0.6))}
              onChange={(e) => void update({ chatHeightShare: Number(e.target.value) })}
            >
              {SHARES.map((s) => (
                <option key={s} value={String(s)}>
                  {Math.round(s * 100)} % des Bildschirms
                </option>
              ))}
            </select>
          )}
        </SettingRow>
        <SettingRow
          title="Gezogene Höhe merken"
          description={`Je Bildschirm.${remembered > 0 ? ` Gemerkt für ${remembered} ${remembered === 1 ? "Bildschirm" : "Bildschirme"}.` : ""}`}
        >
          {(ids) => (
            <>
              {remembered > 0 ? (
                <Button size="sm" onClick={() => void forgetHeights()}>
                  Vergessen
                </Button>
              ) : null}
              <Switch checked={quick.rememberHeight} labelledBy={ids.titleId} describedBy={ids.descId} onChange={(v) => void update({ rememberHeight: v })} />
            </>
          )}
        </SettingRow>
        <SettingRow title="Textgröße" description="Eingabe und Antworten im Schnellfenster.">
          {(ids) => (
            <select
              className="g-select"
              aria-labelledby={ids.titleId}
              aria-describedby={ids.descId}
              value={quick.textSize}
              onChange={(e) => void update({ textSize: e.target.value === "s" ? "s" : e.target.value === "l" ? "l" : "m" })}
            >
              <option value="s">Klein</option>
              <option value="m">Normal</option>
              <option value="l">Groß</option>
            </select>
          )}
        </SettingRow>
      </GlassCard>

      <GlassCard>
        <SettingRow title="Senden mit" description="↩ sendet (⇧↩ macht eine Zeile) – oder ⌘↩ sendet und ↩ macht die Zeile; „Im Hauptfenster“ liegt dann auf ⌘⇧↩.">
          {(ids) => (
            <select
              className="g-select"
              aria-labelledby={ids.titleId}
              aria-describedby={ids.descId}
              value={quick.sendKey}
              onChange={(e) => void update({ sendKey: e.target.value === "cmd-enter" ? "cmd-enter" : "enter" })}
            >
              <option value="enter">↩ Return</option>
              <option value="cmd-enter">⌘↩ Befehl-Return</option>
            </select>
          )}
        </SettingRow>
        <SettingRow title="Nach dem Senden" description="Schließen: das Fenster geht sofort zu, die fertige Antwort kommt als Mitteilung (Klick öffnet das Fenster). Der Chat auf dem Server bekommt sie in jedem Fall.">
          {(ids) => (
            <select
              className="g-select"
              aria-labelledby={ids.titleId}
              aria-describedby={ids.descId}
              value={quick.afterSend}
              onChange={(e) => void update({ afterSend: e.target.value === "hide" ? "hide" : "stay" })}
            >
              <option value="stay">Offen lassen</option>
              <option value="hide">Schließen, Antwort als Mitteilung</option>
            </select>
          )}
        </SettingRow>
        <SettingRow title="Gespräch fortsetzen" description="Nach einer Pause beginnt das nächste Öffnen ein neues Gespräch; das alte bleibt im Chat-Verlauf auf dem Server.">
          {(ids) => (
            <select
              className="g-select"
              aria-labelledby={ids.titleId}
              aria-describedby={ids.descId}
              value={String(quick.resetAfterMin)}
              onChange={(e) => void update({ resetAfterMin: Number(e.target.value) })}
            >
              {QUICK_RESET_CHOICES.map((m) => (
                <option key={m} value={String(m)}>
                  {resetLabel(m)}
                </option>
              ))}
            </select>
          )}
        </SettingRow>
        <SettingRow title="Vorschläge anzeigen" description="Drei Beispielfragen unter der leeren Eingabe.">
          {(ids) => <Switch checked={quick.suggestions} labelledBy={ids.titleId} describedBy={ids.descId} onChange={(v) => void update({ suggestions: v })} />}
        </SettingRow>
        <SettingRow title="Mikrofon-Knopf" description="Diktat direkt im Schnellfenster. Das Diktat-Kürzel zielt ins Fenster, solange es vorn ist – auch ohne Knopf.">
          {(ids) => <Switch checked={quick.dictationButton} labelledBy={ids.titleId} describedBy={ids.descId} onChange={(v) => void update({ dictationButton: v })} />}
        </SettingRow>
      </GlassCard>

      <InfoNote>
        Das Erscheinungsbild folgt dem System: Das Glas zeichnet macOS, die Seite passt Text und Flächen an Hell und Dunkel an. Ansichten: ⌘1 Chat, ⌘2 Diktate; Esc schließt.
      </InfoNote>

      {error ? (
        <InfoNote tone="err" role="alert">
          {error}
        </InfoNote>
      ) : null}
    </>
  );
}

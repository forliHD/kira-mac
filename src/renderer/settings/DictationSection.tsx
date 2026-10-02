// Einstellungen → Diktat: Stand der Apple-Spracherkennung (bereit bzw. Grund,
// Sprache, Sprachpaket), Sprache, Diktierbefehle, Kürzel.

import { type ReactNode, useState } from "react";

import { type DictationConfig, type LocalState } from "../../shared/local-api";
import { localeName, sortLocales } from "../lib/format";
import { IconAlert, IconCheck, IconDownload, IconRefresh, IconWave } from "../lib/icons";
import { errorText, localApi } from "../lib/useLocalState";
import { Button, GlassCard, InfoNote, KbdCombo, SettingRow, StatusCard, Switch, type Tone } from "../lib/ui";
import { type SectionProps } from "./shared";

interface SttView {
  tone: Tone;
  icon: ReactNode;
  title: string;
  detail: string;
}

function sttView(state: LocalState, locale: string): SttView {
  const helper = state.helper;
  const stt = state.dictationStatus.stt;
  const language = localeName(locale);
  if (!helper.running) {
    return { tone: "err", icon: <IconAlert size={22} />, title: "Diktat nicht verfügbar", detail: helper.lastError ?? "Der Helfer läuft nicht." };
  }
  if (!stt) {
    return { tone: "idle", icon: <IconWave size={22} />, title: "Stand unbekannt", detail: "Der Helfer hat den Stand der Spracherkennung nicht gemeldet." };
  }
  if (stt.available && stt.assets !== "downloading") {
    const info = helper.info;
    const parts = [
      info?.chip ?? null,
      info?.macos ? `macOS ${info.macos}` : state.ui.macos ? `macOS ${state.ui.macos}` : null,
      stt.assets === "installed" ? `Sprachpaket ${language} geladen` : `Sprache ${language}`,
      info?.locales.length ? `${info.locales.length} Sprachen verfügbar` : null,
    ];
    return { tone: "ok", icon: <IconCheck size={22} strokeWidth={2.4} />, title: "Apple-Spracherkennung bereit", detail: parts.filter(Boolean).join(" · ") };
  }
  if (stt.assets === "downloading") {
    return { tone: "info", icon: <IconDownload size={22} />, title: "Sprachpaket wird geladen", detail: `${language} – das dauert einen Moment, danach geht das Diktat sofort.` };
  }
  if (stt.assets === "missing" && stt.engine) {
    return { tone: "warn", icon: <IconDownload size={22} />, title: "Sprachpaket fehlt", detail: stt.reason ?? `Für ${language} ist auf diesem Mac noch kein Sprachpaket installiert.` };
  }
  return {
    tone: "err",
    icon: <IconAlert size={22} />,
    title: "Spracherkennung nicht verfügbar",
    detail: stt.reason ?? "Die Apple-Spracherkennung ist auf diesem Mac nicht verfügbar. Einen Rückfall auf den Server gibt es für das globale Diktat nicht.",
  };
}

export function DictationSection({ state, setState, refresh, go }: SectionProps): ReactNode {
  const [pending, setPending] = useState<Partial<DictationConfig>>({});
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dictation: DictationConfig = { ...state.dictation, ...pending };
  const locales = sortLocales(state.helper.info?.locales?.length ? state.helper.info.locales : ["de-DE", "en-US"], dictation.locale);
  const view = sttView(state, dictation.locale);
  const accessibility = state.dictationStatus.permissions?.accessibility;

  async function update(patch: Partial<DictationConfig>): Promise<void> {
    setPending((p) => ({ ...p, ...patch }));
    setError(null);
    try {
      setState(await localApi().setDictation({ ...dictation, ...patch }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending({});
    }
  }

  async function recheck(): Promise<void> {
    setChecking(true);
    try {
      await refresh();
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <StatusCard
        live
        tone={view.tone}
        icon={view.icon}
        title={view.title}
        detail={view.detail}
        action={
          <Button icon={<IconRefresh size={14} strokeWidth={2.3} />} busy={checking} disabled={checking} onClick={() => void recheck()}>
            Erneut prüfen
          </Button>
        }
      />

      <GlassCard>
        <SettingRow title="Sprache" description="Erkennung und Diktierbefehle">
          {(ids) => (
            <select
              className="g-select"
              aria-labelledby={ids.titleId}
              aria-describedby={ids.descId}
              value={dictation.locale}
              onChange={(e) => void update({ locale: e.target.value })}
            >
              {locales.map((code) => (
                <option key={code} value={code}>
                  {localeName(code)}
                </option>
              ))}
            </select>
          )}
        </SettingRow>
        <SettingRow
          title="Im Dashboard den Mac nutzen"
          description="Aus: der KIRA-Server erkennt wie im Browser. Scheitert der Mac, übernimmt der Server dieselbe Äußerung. Das Dashboard lädt beim Umschalten neu."
        >
          {(ids) => (
            <Switch checked={dictation.dashboardStt} labelledBy={ids.titleId} describedBy={ids.descId} onChange={(v) => void update({ dashboardStt: v })} />
          )}
        </SettingRow>
        <SettingRow title="Diktierbefehle" description="„Punkt“, „Komma“, „neue Zeile“, „neuer Absatz“, „Anführungszeichen auf/zu“, „das löschen“">
          {(ids) => <Switch checked={dictation.commands} labelledBy={ids.titleId} describedBy={ids.descId} onChange={(v) => void update({ commands: v })} />}
        </SettingRow>
        <SettingRow title="Globales Diktat" description="Spricht in das vorderste Programm. Eigene Begriffe kommen aus „Mein Konto“ auf dem Server.">
          <KbdCombo accelerator={state.hotkeys.dictation} />
          <Button aria-label="Tastenkürzel für das Diktat ändern" onClick={() => go("kuerzel", "dictation")}>
            Ändern
          </Button>
        </SettingRow>
      </GlassCard>

      {error ? (
        <InfoNote tone="err" role="alert">
          {error}
        </InfoNote>
      ) : null}

      {accessibility === false ? (
        <InfoNote>
          Für das Einfügen in andere Programme braucht KIRA die Freigabe „Bedienungshilfen“. Status und Knopf unter{" "}
          <button type="button" className="g-link" onClick={() => go("berechtigungen")}>
            Berechtigungen
          </button>
          .
        </InfoNote>
      ) : null}
    </>
  );
}

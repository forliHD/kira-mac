// Einstellungen → Diktat: Stand der Apple-Spracherkennung (bereit bzw. Grund,
// Sprache, Sprachpaket), Sprache, Diktierbefehle, Kürzel und der Verlauf der
// letzten Diktate (DictationHistoryCard).

import { type ReactNode, useState } from "react";

import { type DictationConfig } from "../../shared/local-api";
import { formatModelDiagnostics } from "../../shared/dictation-model";
import { modelCard } from "../lib/dictation-model";
import { formatLastSeen, localeName, sortLocales } from "../lib/format";
import { IconAlert, IconCheck, IconDownload, IconRefresh, IconWave } from "../lib/icons";
import { errorText, localApi } from "../lib/useLocalState";
import { Button, GlassCard, InfoNote, KbdCombo, SettingRow, StatusCard, Switch, type Tone } from "../lib/ui";
import { DictationHistoryCard } from "./DictationHistoryCard";
import { DictationTestCard } from "./DictationTestCard";
import { type SectionProps } from "./shared";

function toneIcon(tone: Tone): ReactNode {
  if (tone === "ok") return <IconCheck size={22} strokeWidth={2.4} />;
  if (tone === "info" || tone === "warn") return <IconDownload size={22} />;
  if (tone === "idle") return <IconWave size={22} />;
  return <IconAlert size={22} />;
}

export function DictationSection({ state, setState, refresh, go }: SectionProps): ReactNode {
  const [pending, setPending] = useState<Partial<DictationConfig>>({});
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dictation: DictationConfig = { ...state.dictation, ...pending };
  const locales = sortLocales(state.helper.info?.locales?.length ? state.helper.info.locales : ["de-DE", "en-US"], dictation.locale);
  const info = state.helper.info;
  const card = modelCard({
    helperRunning: state.helper.running,
    helperError: state.helper.lastError,
    stt: state.dictationStatus.stt,
    download: state.dictationStatus.modelDownload,
    language: localeName(dictation.locale),
    chip: info?.chip ?? null,
    macos: info?.macos ?? state.ui.macos ?? null,
    localeCount: info?.locales.length ?? 0,
    offline: !state.connection.online,
  });
  const diagnostics = formatModelDiagnostics(state.dictationStatus.stt, {
    macos: info?.macos ?? state.ui.macos,
    chip: info?.chip,
    arch: state.dictationStatus.stt?.diagnostics?.arch ?? null,
  });
  const accessibility = state.dictationStatus.permissions?.accessibility;
  const defaultDevice = state.dictationStatus.inputDevices.find((d) => d.default) ?? null;
  const vocabulary = state.dictationStatus.vocabulary;
  const vocabularyNote = vocabulary
    ? `${vocabulary.count} ${vocabulary.count === 1 ? "Begriff" : "Begriffe"} (KIRA, dein Name, eigene Begriffe), Stand ${formatLastSeen(new Date(vocabulary.fetchedAt)).replace(/^um /, "heute um ")} – bleibt verschlüsselt auf diesem Mac, auch offline.`
    : "Noch keine Begriffe geholt – sie kommen beim ersten Diktat vom Server (Anmeldung im Hauptfenster).";

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

  async function download(): Promise<void> {
    setError(null);
    try {
      setState(await localApi().prepareDictationModel());
    } catch (err) {
      setError(errorText(err));
      await refresh().catch(() => undefined);
    }
  }

  return (
    <>
      <StatusCard
        live
        tone={card.tone}
        icon={toneIcon(card.tone)}
        title={card.title}
        detail={card.detail}
        action={
          <>
            {card.showDownload ? (
              <Button variant="primary" icon={<IconDownload size={14} />} busy={card.downloading} disabled={card.downloading} onClick={() => void download()}>
                {card.downloadLabel}
              </Button>
            ) : null}
            <Button icon={<IconRefresh size={14} strokeWidth={2.3} />} busy={checking || card.downloading} disabled={checking || card.downloading} onClick={() => void recheck()}>
              Erneut prüfen
            </Button>
          </>
        }
      />
      <p className="g-selectable px-1 text-[11px] leading-snug text-(--g-text-3)">Diagnose: {diagnostics}</p>

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
        <SettingRow title="Mikrofon" description="Welches Mikrofon das Diktat öffnet. Systemstandard folgt den Systemeinstellungen → Ton.">
          {(ids) => (
            <select
              className="g-select"
              aria-labelledby={ids.titleId}
              aria-describedby={ids.descId}
              value={dictation.inputDevice ?? ""}
              onChange={(e) => void update({ inputDevice: e.target.value || null })}
            >
              <option value="">Systemstandard{defaultDevice ? ` (${defaultDevice.name})` : ""}</option>
              {state.dictationStatus.inputDevices.map((d) => (
                <option key={d.uid} value={d.uid}>
                  {d.name}
                </option>
              ))}
              {dictation.inputDevice && !state.dictationStatus.inputDevices.some((d) => d.uid === dictation.inputDevice) ? (
                <option value={dictation.inputDevice}>Nicht angeschlossen ({dictation.inputDevice.slice(0, 24)}…)</option>
              ) : null}
            </select>
          )}
        </SettingRow>
        <SettingRow
          title="Apple-Sprachfilter"
          description="Echo-Unterdrückung, Rauschfilter und Pegelregelung wie bei FaceTime. Anderer Ton wird dabei leicht gedämpft. Geht es auf diesem Mac nicht, läuft das Diktat ohne."
        >
          {(ids) => (
            <Switch checked={dictation.voiceProcessing} labelledBy={ids.titleId} describedBy={ids.descId} onChange={(v) => void update({ voiceProcessing: v })} />
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
        <SettingRow
          title="Eigene Begriffe nachkorrigieren"
          description={`Ähnlich Klingendes wird zu deinen Begriffen („Tira“ → KIRA, „Lukas“ → Lucas); Wörter aus dem Wörterbuch bleiben. ${vocabularyNote}`}
        >
          {(ids) => (
            <Switch checked={dictation.correctVocabulary} labelledBy={ids.titleId} describedBy={ids.descId} onChange={(v) => void update({ correctVocabulary: v })} />
          )}
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

      <DictationTestCard state={state} />

      <DictationHistoryCard />

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

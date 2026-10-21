// Karte „Diktat“ aus dem Helfer-Stand und dem Download. Reine Funktion
// (tests/dictation-model.test.ts) – die Seite zeichnet nur.

import { canDownloadAssets, type DictationModelDownload } from "../../shared/dictation-model";
import { type HelperSttStatus } from "../../shared/helper-types";
import { type Tone } from "./format";

export interface ModelCard {
  tone: Tone;
  title: string;
  detail: string;
  /** Knopf „Modell laden“ / „Erneut laden“. */
  showDownload: boolean;
  downloadLabel: string;
  downloading: boolean;
}

export function modelCard(input: {
  helperRunning: boolean;
  helperError: string | null;
  stt: HelperSttStatus | null;
  download: DictationModelDownload;
  language: string;
  chip: string | null;
  macos: string | null;
  localeCount: number;
  /** Keine Verbindung zum KIRA-Server. Der Modell-Download geht an Apple, nicht dorthin. */
  offline: boolean;
}): ModelCard {
  const { stt, download, language } = input;
  if (!input.helperRunning) {
    return {
      tone: "err",
      title: "Diktat nicht verfügbar",
      detail: input.helperError ?? "Der Helfer läuft nicht.",
      showDownload: false,
      downloadLabel: "",
      downloading: false,
    };
  }
  if (!stt) {
    return {
      tone: "idle",
      title: "Stand unbekannt",
      detail: "Der Helfer hat den Stand der Spracherkennung nicht gemeldet.",
      showDownload: false,
      downloadLabel: "",
      downloading: false,
    };
  }
  if (download.phase === "downloading" || stt.assets === "downloading") {
    const pct = download.progress !== null ? ` · ${download.progress} %` : "";
    return {
      tone: "info",
      title: "Diktat-Modell wird geladen",
      detail: `${language}${pct}. Danach geht das Diktat sofort und auch ohne Verbindung zum KIRA-Server.`,
      showDownload: false,
      downloadLabel: "",
      downloading: true,
    };
  }
  if (stt.available) {
    const parts = [
      input.chip,
      input.macos ? `macOS ${input.macos}` : null,
      `Diktat-Modell ${language} geladen`,
      input.localeCount ? `${input.localeCount} Sprachen verfügbar` : null,
    ];
    return {
      tone: "ok",
      title: "Apple-Spracherkennung bereit",
      detail: parts.filter(Boolean).join(" · "),
      showDownload: false,
      downloadLabel: "",
      downloading: false,
    };
  }
  const failedHere = download.phase === "failed" && (!download.locale || !stt.locale || download.locale === stt.locale);
  if (failedHere || (stt.assets === "missing" && canDownloadAssets(stt))) {
    const reason = failedHere && download.error
      ? download.error
      : (stt.reason ?? `Für ${language} ist auf diesem Mac noch kein Diktat-Modell installiert.`);
    const offlineHint = input.offline
      ? " Ohne Internet kann das Modell nicht von Apple geladen werden. Ist es einmal da, läuft das Diktat auch offline."
      : "";
    return {
      tone: failedHere ? "err" : "warn",
      title: "Diktat-Modell fehlt",
      detail: `${reason}${offlineHint}`,
      showDownload: true,
      downloadLabel: failedHere ? "Erneut laden" : "Modell laden",
      downloading: false,
    };
  }
  if (stt.assets === "missing" && stt.engine) {
    return {
      tone: "warn",
      title: "Diktat-Modell fehlt",
      detail: stt.reason ?? `Für ${language} ist auf diesem Mac noch kein Diktat-Modell installiert. Unter Systemeinstellungen → Tastatur → Diktat die Sprache hinzufügen.`,
      showDownload: false,
      downloadLabel: "",
      downloading: false,
    };
  }
  return {
    tone: "err",
    title: "Spracherkennung nicht verfügbar",
    detail: stt.reason ?? "Die Apple-Spracherkennung ist auf diesem Mac nicht verfügbar. Einen Rückfall auf den Server gibt es für das globale Diktat nicht.",
    showDownload: false,
    downloadLabel: "",
    downloading: false,
  };
}

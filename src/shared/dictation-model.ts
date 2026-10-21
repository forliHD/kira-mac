// Stand des Diktat-Modells: wann die Hülle laden darf und wie die Diagnose
// für den Menschen aussieht. Reine Funktionen – Helfer und Oberfläche nutzen
// dieselben Regeln (tests/dictation-model.test.ts).

import { type HelperSttStatus } from "./helper-types";

/** Laufender oder gescheiterter Download, den die Hülle anstößt (`stt.prepare`). */
export interface DictationModelDownload {
  phase: "idle" | "downloading" | "failed";
  /** 0…100, sonst null. */
  progress: number | null;
  error: string | null;
  locale: string | null;
}

export const IDLE_MODEL_DOWNLOAD: DictationModelDownload = {
  phase: "idle",
  progress: null,
  error: null,
  locale: null,
};

/**
 * Darf die App das Modell selbst laden? Ältere Helfer ohne `downloadable`
 * gelten als ladbar, wenn die Engine der SpeechAnalyzer ist und das Paket
 * fehlt oder schon lädt – genau dann gibt es `stt.prepare`.
 */
export function canDownloadAssets(
  status: Pick<HelperSttStatus, "engine" | "assets"> & { downloadable?: boolean; available?: boolean },
): boolean {
  if (typeof status.downloadable === "boolean") return status.downloadable;
  return status.engine === "analyzer" && (status.assets === "missing" || status.assets === "downloading");
}

/** Fehlt das Modell, und ein Download (oder das Abwarten eines laufenden) hilft? */
export function needsAssetDownload(status: HelperSttStatus): boolean {
  if (status.available) return false;
  return canDownloadAssets(status) && (status.assets === "missing" || status.assets === "downloading");
}

const PERMISSION_DE: Record<string, string> = {
  granted: "erteilt",
  denied: "verweigert",
  notDetermined: "nicht gefragt",
  notRequired: "nicht nötig",
  restricted: "gesperrt",
};

function permissionLabel(value: string): string {
  return PERMISSION_DE[value] ?? value;
}

/**
 * Eine Zeile zum Kopieren: macOS, Architektur, Chip, Sprache, Modellzustand,
 * Freigaben. Steht in den Einstellungen und (dieselben Felder) im Protokoll.
 */
export function formatModelDiagnostics(
  stt: HelperSttStatus | null,
  extra?: { macos?: string | null; chip?: string | null; arch?: string | null },
): string {
  const d = stt?.diagnostics;
  const parts = [
    `macOS ${d?.macos || extra?.macos || "?"}`,
    d?.arch || extra?.arch || "?",
    d?.chip || extra?.chip || null,
    `Sprache ${stt?.locale || d?.locale || "?"}`,
    stt ? `Modell ${d?.assetState || stt.assets}` : "Modell unbekannt",
    stt?.engine ? `Engine ${stt.engine}` : stt ? "Engine keine" : null,
    stt?.code ? `Code ${stt.code}` : null,
    d?.microphone ? `Mikrofon ${permissionLabel(d.microphone)}` : null,
    d?.speech ? `Spracherkennung ${permissionLabel(d.speech)}` : null,
    d?.preferred ? `Systemsprache ${d.preferred}` : null,
    stt ? (canDownloadAssets(stt) ? "Download möglich" : "kein Download aus der App") : null,
  ];
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

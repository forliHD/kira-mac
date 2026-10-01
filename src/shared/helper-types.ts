// Typen des Helfer-Protokolls (docs/helper-protocol.md, Version 1).

export const HELPER_PROTOCOL_VERSION = 1 as const;

export interface HelperFeatures {
  stt: boolean;
  sttStream: boolean;
  llm: boolean;
  systemAudio: boolean;
  insertText: boolean;
}

export interface HelperInfo {
  protocol: number;
  version: string;
  macos: string;
  chip: string;
  features: HelperFeatures;
  locales: string[];
}

export type PermissionState = "granted" | "denied" | "notDetermined" | "notRequired";

export interface PermissionsStatus {
  microphone: PermissionState;
  speech: PermissionState;
  accessibility: boolean;
  screenRecording: boolean;
}

export type PermissionKind = "microphone" | "speech" | "accessibility" | "screenRecording";

export interface HelperSttStatus {
  available: boolean;
  engine: "analyzer" | "legacy" | null;
  assets: "installed" | "downloading" | "missing";
  reason?: string;
}

export interface SttFileResult {
  text: string;
  durationMs: number;
  engine: string;
}

export interface SttEnded {
  reason: "stopped" | "error" | "silence" | "replaced";
  message?: string;
}

export interface FrontmostApp {
  bundleId: string;
  name: string;
}

export interface HelperErrorShape {
  code: string;
  message?: string;
}

/** Eine Anfrage-Zeile Electron → Helfer. */
export interface HelperRequest {
  id: string;
  cmd: string;
  params?: Record<string, unknown>;
}

/** Eine Antwort-Zeile Helfer → Electron. */
export type HelperResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: HelperErrorShape };

/** Ein Ereignis Helfer → Electron. */
export interface HelperEvent {
  event: string;
  stream?: string;
  data?: unknown;
}

/** Zeitlimits je Kommando (docs/helper-protocol.md, „Lebenszyklus in Electron“). */
export const HELPER_TIMEOUTS_MS: Record<string, number> = {
  "stt.file": 60_000,
  "llm.generate": 120_000,
  "stt.prepare": 600_000,
};
export const HELPER_DEFAULT_TIMEOUT_MS = 10_000;
export const HELPER_RESTART_BACKOFF_MS = [1_000, 2_000, 5_000, 30_000] as const;

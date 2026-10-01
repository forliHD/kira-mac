// Typen der Schnittstelle zwischen den lokalen Seiten (onboarding, settings,
// hud, offline) und dem Hauptprozess – `window.KiraLocal`, bereitgestellt von
// src/preload/local.ts. Nicht Teil des Vertrags mit dem Dashboard.

import { type HelperInfo, type HelperSttStatus, type PermissionKind, type PermissionsStatus } from "./helper-types";

export interface InstanceConfig {
  internalUrl: string | null;
  externalUrl: string | null;
  label: string;
}

export interface HotkeyConfig {
  quickWindow: string;
  dictation: string;
}

export interface DictationConfig {
  locale: string;
  commands: boolean;
}

export interface GeneralConfig {
  launchAtLogin: boolean;
  notifications: boolean;
}

export interface ProbeResult {
  url: string;
  ok: boolean;
  version: string | null;
  bridge: boolean;
  error: string | null;
  latencyMs: number | null;
}

export interface ConnectionState {
  online: boolean;
  origin: string | null;
  kind: "internal" | "external" | null;
  serverVersion: string | null;
  serverHasBridge: boolean;
  lastError: string | null;
}

export interface UpdateState {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "none" | "error" | "unsupported";
  version: string | null;
  message: string | null;
  progress: number | null;
}

export interface HelperState {
  running: boolean;
  info: HelperInfo | null;
  lastError: string | null;
}

export interface DictationStatus {
  stt: HelperSttStatus | null;
  permissions: PermissionsStatus | null;
  hotkeyConflicts: string[];
}

export interface LocalState {
  appVersion: string;
  instance: InstanceConfig;
  hotkeys: HotkeyConfig;
  dictation: DictationConfig;
  general: GeneralConfig;
  connection: ConnectionState;
  update: UpdateState;
  helper: HelperState;
  dictationStatus: DictationStatus;
  onboarded: boolean;
  logPath: string;
}

export type HudPhase = "starting" | "listening" | "stopping" | "unavailable" | "error";

export interface HudState {
  phase: HudPhase;
  level: number;
  partial: string;
  app: string | null;
  message: string | null;
}

export type LocalEvent =
  | { type: "state"; state: LocalState }
  | { type: "hud"; hud: HudState }
  | { type: "connection"; connection: ConnectionState }
  | { type: "update"; update: UpdateState };

export interface KiraLocalApi {
  getState(): Promise<LocalState>;
  probe(url: string): Promise<ProbeResult>;
  saveInstance(instance: { internalUrl: string | null; externalUrl: string | null }): Promise<LocalState>;
  finishOnboarding(): Promise<void>;
  setHotkeys(hotkeys: HotkeyConfig): Promise<{ state: LocalState; conflicts: string[] }>;
  setDictation(dictation: DictationConfig): Promise<LocalState>;
  setGeneral(general: GeneralConfig): Promise<LocalState>;
  requestPermission(kind: PermissionKind): Promise<PermissionsStatus | null>;
  checkForUpdates(): Promise<UpdateState>;
  openLogs(): Promise<void>;
  hudStop(): Promise<void>;
  retry(): Promise<void>;
  openSettings(): Promise<void>;
  openMain(): Promise<void>;
  on(listener: (event: LocalEvent) => void): () => void;
}

declare global {
  interface Window {
    KiraLocal?: KiraLocalApi;
  }
}

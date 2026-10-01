// Typen des Vertrags „Native-Brücke: Dashboard ↔ Mac-App“, Version 1.
// Quelle der Wahrheit: kira/docs/native-bridge.md. Änderungen dort zuerst,
// dann hier und in src/preload/api.ts; tests/bridge.test.ts prüft die Felder.

/** Vertragsversion. Eine brechende Änderung erhöht die Zahl (siehe native-bridge.md). */
export const BRIDGE_VERSION = 1 as const;

/** Fähigkeiten, die die Hülle dem Dashboard melden kann (Tabelle „Fähigkeiten“). */
export const CAPABILITIES = [
  "session",
  "notifications",
  "open-external",
  "stt",
  "quick-window",
  "system-audio",
  "apple-intelligence",
  "insert-text",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Methoden von `window.KiraNative` – exakt die Tabelle im Vertrag. */
export const NATIVE_METHODS = [
  "getInfo",
  "setSession",
  "notify",
  "openExternal",
  "sttStatus",
  "transcribe",
] as const;
export type NativeMethod = (typeof NATIVE_METHODS)[number];

/** Ereignistypen Hülle → Dashboard (`CustomEvent("kira:native", { detail })`). */
export const NATIVE_EVENT_TYPES = ["navigate", "notification", "connectivity", "session-request", "share"] as const;
export type NativeEventType = (typeof NATIVE_EVENT_TYPES)[number];

export interface AppInfo {
  name: string;
  version: string;
  platform: "darwin";
  arch: string;
}

export interface InstanceInfo {
  origin: string;
  label: string;
}

export interface BridgeInfo {
  bridge: typeof BRIDGE_VERSION;
  app: AppInfo;
  capabilities: Capability[];
  instance: InstanceInfo;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface NotifyPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  category?: string;
}

export interface SttStatus {
  available: boolean;
  engine: "apple" | null;
  locale?: string;
  reason?: string;
}

export interface TranscribeOptions {
  mime: string;
  context?: string;
  locale?: string;
}

export interface TranscribeResult {
  text: string;
  engine: "apple";
  durationMs?: number;
}

/** Das Objekt, das der Preload per `contextBridge` als `window.KiraNative` bereitstellt. */
export interface KiraNativeApi {
  bridge: typeof BRIDGE_VERSION;
  app: AppInfo;
  capabilities: Capability[];
  getInfo(): Promise<BridgeInfo>;
  setSession(tokens: SessionTokens | null): Promise<void>;
  notify(payload: NotifyPayload): Promise<void>;
  openExternal(url: string): Promise<void>;
  sttStatus(): Promise<SttStatus>;
  transcribe(audio: ArrayBuffer, options: TranscribeOptions): Promise<TranscribeResult>;
}

export type NativeEvent =
  | { type: "navigate"; url: string }
  | { type: "notification"; title: string; body: string; url?: string; category?: string }
  | { type: "connectivity"; online: boolean }
  | { type: "session-request" }
  | { type: "share"; title?: string; text?: string; url?: string };

/** Payload eines `notification`-Frames vom Server (identisch zu Web Push). */
export interface ServerNotification {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  category?: string;
  icon?: string;
}

/** Ab dieser Serverversion gibt es die Brücke serverseitig (Stream, Geräte). */
export const MIN_SERVER_VERSION_WITH_BRIDGE = "3.297.0";

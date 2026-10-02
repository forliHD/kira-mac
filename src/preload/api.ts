// Reine Fabrik für `window.KiraNative` – ohne Electron-Import, damit
// tests/bridge.test.ts das Objekt Feld für Feld gegen den Vertrag prüft.
// Alle Methoden geben Promises zurück und werfen nie synchron.

import {
  type AppInfo,
  BRIDGE_VERSION,
  type BridgeInfo,
  type BrowserSignInResult,
  type Capability,
  type InstanceInfo,
  type KiraNativeApi,
  type NotifyPayload,
  type SessionTokens,
  type SttStatus,
  type TranscribeOptions,
  type TranscribeResult,
} from "../shared/bridge";
import { IPC } from "../shared/ipc";

export interface PreloadBootstrap {
  allowed: boolean;
  app: AppInfo;
  capabilities: Capability[];
  instance: InstanceInfo;
}

export interface PreloadIo {
  bootstrap: PreloadBootstrap;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  /** WebM/Opus (oder anderes) → WAV 16 kHz Mono 16 Bit, plus Dauer. */
  decodeToWav: (audio: ArrayBuffer, mime: string) => Promise<{ wav: Uint8Array; durationMs: number }>;
}

function isSttStatus(v: unknown): v is SttStatus {
  return Boolean(v && typeof v === "object" && typeof (v as SttStatus).available === "boolean");
}

function isTranscribeResult(v: unknown): v is TranscribeResult {
  return Boolean(v && typeof v === "object" && typeof (v as TranscribeResult).text === "string");
}

function isBridgeInfo(v: unknown): v is BridgeInfo {
  return Boolean(v && typeof v === "object" && (v as BridgeInfo).bridge === BRIDGE_VERSION && Array.isArray((v as BridgeInfo).capabilities));
}

export function createKiraNative(io: PreloadIo): KiraNativeApi {
  const app: AppInfo = Object.freeze({ ...io.bootstrap.app });
  const capabilities: Capability[] = Object.freeze([...io.bootstrap.capabilities]) as Capability[];

  const api: KiraNativeApi = {
    bridge: BRIDGE_VERSION,
    app,
    capabilities,

    async getInfo(): Promise<BridgeInfo> {
      const info = await io.invoke(IPC.getInfo);
      if (!isBridgeInfo(info)) throw new Error("Ungültige Antwort der Hülle (getInfo).");
      return info;
    },

    async setSession(tokens: SessionTokens | null): Promise<void> {
      if (tokens !== null) {
        if (!tokens || typeof tokens !== "object" || typeof tokens.accessToken !== "string" || typeof tokens.refreshToken !== "string") {
          throw new Error("setSession erwartet { accessToken, refreshToken } oder null.");
        }
        await io.invoke(IPC.setSession, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
        return;
      }
      await io.invoke(IPC.setSession, null);
    },

    async notify(payload: NotifyPayload): Promise<void> {
      if (!payload || typeof payload !== "object") throw new Error("notify erwartet { title, body }.");
      const clean: NotifyPayload = {
        title: typeof payload.title === "string" ? payload.title : "KIRA",
        body: typeof payload.body === "string" ? payload.body : "",
      };
      if (typeof payload.url === "string") clean.url = payload.url;
      if (typeof payload.tag === "string") clean.tag = payload.tag;
      if (typeof payload.category === "string") clean.category = payload.category;
      await io.invoke(IPC.notify, clean);
    },

    async openExternal(url: string): Promise<void> {
      if (typeof url !== "string" || !url) throw new Error("openExternal erwartet eine URL.");
      await io.invoke(IPC.openExternal, url);
    },

    async sttStatus(): Promise<SttStatus> {
      const status = await io.invoke(IPC.sttStatus);
      if (!isSttStatus(status)) throw new Error("Ungültige Antwort der Hülle (sttStatus).");
      return status;
    },

    async transcribe(audio: ArrayBuffer, options: TranscribeOptions): Promise<TranscribeResult> {
      if (!(audio instanceof ArrayBuffer) || audio.byteLength === 0) throw new Error("transcribe erwartet einen ArrayBuffer mit Audio.");
      const mime = options && typeof options.mime === "string" ? options.mime : "audio/webm";
      const { wav, durationMs } = await io.decodeToWav(audio, mime);
      const result = await io.invoke(IPC.transcribe, {
        wav,
        durationMs,
        context: options && typeof options.context === "string" ? options.context : "",
        locale: options && typeof options.locale === "string" ? options.locale : "",
      });
      if (!isTranscribeResult(result)) throw new Error("Ungültige Antwort der Hülle (transcribe).");
      return { text: result.text, engine: "apple", durationMs: result.durationMs ?? durationMs };
    },

    async signInWithBrowser(): Promise<BrowserSignInResult> {
      const result = await io.invoke(IPC.signInWithBrowser);
      if (!result || typeof result !== "object" || typeof (result as BrowserSignInResult).started !== "boolean") {
        throw new Error("Ungültige Antwort der Hülle (signInWithBrowser).");
      }
      const r = result as BrowserSignInResult;
      return r.error ? { started: r.started, error: String(r.error) } : { started: r.started };
    },
  };
  return api;
}

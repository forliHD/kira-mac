// IPC-Handler hinter `window.KiraNative` (Vertrag docs/native-bridge.md).
// Jeder Handler prüft den Absender: nur Frames einer Instanz-Origin dürfen
// die Brücke nutzen. Eingaben werden zur Laufzeit geprüft (`unknown` →
// Typ), nie blind vertraut.

import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type IpcMainEvent, type IpcMainInvokeEvent, Notification, app, ipcMain } from "electron";

import {
  type AppInfo,
  BRIDGE_VERSION,
  type BridgeInfo,
  type Capability,
  type InstanceInfo,
  type NotifyPayload,
  type SessionTokens,
  type SttStatus,
  type TranscribeResult,
} from "../shared/bridge";
import { type HelperSttStatus, type SttFileResult } from "../shared/helper-types";
import { IPC } from "../shared/ipc";
import { type GlobalDictation, splitVocabulary } from "./dictation";
import { type HelperClient, HelperError } from "./helper";
import { isInstanceUrl } from "./instance";
import { openExternalSafely } from "./links";
import { scoped } from "./log";
import { type Session } from "./session";

const log = scoped("bridge");

export interface BridgeContext {
  origins: () => string[];
  appInfo: AppInfo;
  capabilities: () => Capability[];
  instance: () => InstanceInfo;
  session: Session;
  helper: HelperClient;
  dictation: GlobalDictation;
  locale: () => string;
  /** Hauptfenster zeigen + Navigation (Klick auf eine Benachrichtigung aus `notify`). */
  onNotificationClick: (url: string | undefined) => void;
  onSessionChanged: (hasTokens: boolean) => void;
}

/** Bootstrap-Antwort für den Preload (synchron, beim Laden jeder Instanz-Seite). */
export interface BridgeBootstrap {
  allowed: boolean;
  app: AppInfo;
  capabilities: Capability[];
  instance: InstanceInfo;
}

function senderUrl(event: IpcMainEvent | IpcMainInvokeEvent): string {
  try {
    return event.senderFrame?.url ?? "";
  } catch {
    return "";
  }
}

function isTrusted(event: IpcMainEvent | IpcMainInvokeEvent, origins: string[]): boolean {
  return isInstanceUrl(senderUrl(event), origins);
}

function asTokens(value: unknown): SessionTokens | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.accessToken !== "string" || typeof v.refreshToken !== "string") return undefined;
  if (!v.accessToken || !v.refreshToken) return undefined;
  return { accessToken: v.accessToken, refreshToken: v.refreshToken };
}

function asNotify(value: unknown): NotifyPayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.title !== "string" && typeof v.body !== "string") return null;
  const str = (x: unknown): string | undefined => (typeof x === "string" ? x : undefined);
  return {
    title: str(v.title) || "KIRA",
    body: str(v.body) ?? "",
    url: str(v.url),
    tag: str(v.tag),
    category: str(v.category),
  };
}

export function mapSttStatus(status: HelperSttStatus | null, locale: string, reason?: string): SttStatus {
  if (!status) return { available: false, engine: null, locale, reason: reason ?? "Helfer nicht verfügbar." };
  if (!status.available) {
    return {
      available: false,
      engine: null,
      locale,
      reason: status.reason ?? (status.assets === "missing" ? "Sprachmodell nicht installiert." : "Apple-Spracherkennung nicht verfügbar."),
    };
  }
  return { available: true, engine: "apple", locale };
}

export function registerBridgeIpc(ctx: BridgeContext): void {
  ipcMain.on(IPC.bootstrap, (event, origin: unknown) => {
    const allowed = isTrusted(event, ctx.origins()) && typeof origin === "string" && isInstanceUrl(origin, ctx.origins());
    const reply: BridgeBootstrap = {
      allowed,
      app: ctx.appInfo,
      capabilities: allowed ? ctx.capabilities() : [],
      instance: ctx.instance(),
    };
    event.returnValue = reply;
  });

  ipcMain.handle(IPC.getInfo, (event): BridgeInfo => {
    if (!isTrusted(event, ctx.origins())) throw new Error("Nicht erlaubt.");
    return { bridge: BRIDGE_VERSION, app: ctx.appInfo, capabilities: ctx.capabilities(), instance: ctx.instance() };
  });

  ipcMain.handle(IPC.setSession, (event, value: unknown): void => {
    if (!isTrusted(event, ctx.origins())) throw new Error("Nicht erlaubt.");
    const tokens = asTokens(value);
    if (tokens === undefined) throw new Error("setSession erwartet { accessToken, refreshToken } oder null.");
    ctx.session.setTokens(tokens);
    ctx.onSessionChanged(tokens !== null);
  });

  ipcMain.handle(IPC.notify, (event, value: unknown): void => {
    if (!isTrusted(event, ctx.origins())) throw new Error("Nicht erlaubt.");
    const payload = asNotify(value);
    if (!payload) throw new Error("notify erwartet { title, body }.");
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: payload.title, body: payload.body });
    n.on("click", () => ctx.onNotificationClick(payload.url));
    n.show();
  });

  ipcMain.handle(IPC.openExternal, (event, value: unknown): void => {
    if (!isTrusted(event, ctx.origins())) throw new Error("Nicht erlaubt.");
    if (typeof value !== "string" || !/^(https?|mailto|tel):/i.test(value)) throw new Error("openExternal erwartet eine http(s)-, mailto- oder tel-URL.");
    openExternalSafely(value);
  });

  ipcMain.handle(IPC.sttStatus, async (event): Promise<SttStatus> => {
    if (!isTrusted(event, ctx.origins())) throw new Error("Nicht erlaubt.");
    const locale = ctx.locale();
    if (!ctx.helper.running) return mapSttStatus(null, locale, ctx.helper.lastError ?? "Der Helfer läuft nicht.");
    const info = ctx.helper.info;
    if (info && !info.features.stt) return mapSttStatus(null, locale, "Dieser Mac bietet keine Apple-Spracherkennung.");
    try {
      const status = await ctx.helper.request<HelperSttStatus>("stt.status", { locale });
      return mapSttStatus(status, locale);
    } catch (err) {
      return mapSttStatus(null, locale, err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.transcribe, async (event, value: unknown): Promise<TranscribeResult> => {
    if (!isTrusted(event, ctx.origins())) throw new Error("Nicht erlaubt.");
    const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const wav = v.wav;
    if (!(wav instanceof Uint8Array) || wav.byteLength < 44) throw new Error("transcribe: keine WAV-Daten.");
    if (wav.byteLength > 64 * 1024 * 1024) throw new Error("transcribe: Aufnahme zu groß (max. 64 MB).");
    const locale = typeof v.locale === "string" && v.locale ? v.locale : ctx.locale();
    const context = typeof v.context === "string" ? v.context : "";
    if (!ctx.helper.running) throw new HelperError("stt_unavailable", "Der Helfer läuft nicht.");

    const base = await ctx.dictation.contextualStrings();
    const extra = splitVocabulary(context).filter((t) => !base.some((b) => b.toLowerCase() === t.toLowerCase()));
    const contextualStrings = [...base, ...extra].slice(0, 300);

    const path = join(app.getPath("temp"), `kira-stt-${randomUUID()}.wav`);
    try {
      await writeFile(path, wav, { mode: 0o600 });
      const result = await ctx.helper.request<SttFileResult>("stt.file", { path, locale, contextualStrings });
      return { text: typeof result.text === "string" ? result.text : "", engine: "apple", durationMs: result.durationMs };
    } finally {
      await unlink(path).catch(() => undefined);
    }
  });

  log.info("bridge_ipc_registered");
}

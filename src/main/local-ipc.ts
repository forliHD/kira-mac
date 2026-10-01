// IPC der lokalen Seiten (`window.KiraLocal`): Onboarding, Einstellungen,
// HUD, Offline-Seite. Absender müssen eine lokale Seite sein (file:// oder
// der Vite-Entwicklungsserver).

import { type IpcMainInvokeEvent, app, ipcMain, shell } from "electron";

import { type PermissionKind, type PermissionsStatus } from "../shared/helper-types";
import { LOCAL_IPC } from "../shared/ipc-local";
import { type DictationConfig, type GeneralConfig, type HotkeyConfig, type LocalState, type ProbeResult, type UpdateState } from "../shared/local-api";
import { scoped } from "./log";

const log = scoped("local-ipc");

export interface LocalIpcContext {
  getState: () => Promise<LocalState>;
  probe: (url: string) => Promise<ProbeResult>;
  saveInstance: (instance: { internalUrl: string | null; externalUrl: string | null }) => Promise<void>;
  finishOnboarding: () => Promise<void>;
  setHotkeys: (hotkeys: HotkeyConfig) => Promise<string[]>;
  setDictation: (dictation: DictationConfig) => Promise<void>;
  setGeneral: (general: GeneralConfig) => Promise<void>;
  requestPermission: (kind: PermissionKind) => Promise<PermissionsStatus | null>;
  checkForUpdates: () => Promise<UpdateState>;
  logPath: () => string;
  hudStop: () => Promise<void>;
  retry: () => Promise<void>;
  openSettings: () => void;
  openMain: () => void;
}

function isLocalSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? "";
  if (url.startsWith("file://")) return true;
  const dev = process.env.ELECTRON_RENDERER_URL;
  return Boolean(!app.isPackaged && dev && url.startsWith(dev));
}

function guard<T extends unknown[], R>(fn: (...args: T) => Promise<R> | R): (event: IpcMainInvokeEvent, ...args: T) => Promise<R> {
  return async (event, ...args) => {
    if (!isLocalSender(event)) throw new Error("Nicht erlaubt.");
    return fn(...args);
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

export function registerLocalIpc(ctx: LocalIpcContext): void {
  ipcMain.handle(LOCAL_IPC.getState, guard(() => ctx.getState()));
  ipcMain.handle(
    LOCAL_IPC.probe,
    guard((url: unknown) => ctx.probe(str(url))),
  );
  ipcMain.handle(
    LOCAL_IPC.saveInstance,
    guard(async (value: unknown) => {
      const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      await ctx.saveInstance({ internalUrl: strOrNull(v.internalUrl), externalUrl: strOrNull(v.externalUrl) });
      return ctx.getState();
    }),
  );
  ipcMain.handle(LOCAL_IPC.finishOnboarding, guard(() => ctx.finishOnboarding()));
  ipcMain.handle(
    LOCAL_IPC.setHotkeys,
    guard(async (value: unknown) => {
      const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      const conflicts = await ctx.setHotkeys({ quickWindow: str(v.quickWindow), dictation: str(v.dictation) });
      return { state: await ctx.getState(), conflicts };
    }),
  );
  ipcMain.handle(
    LOCAL_IPC.setDictation,
    guard(async (value: unknown) => {
      const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      await ctx.setDictation({ locale: str(v.locale) || "de-DE", commands: bool(v.commands, true) });
      return ctx.getState();
    }),
  );
  ipcMain.handle(
    LOCAL_IPC.setGeneral,
    guard(async (value: unknown) => {
      const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      await ctx.setGeneral({ launchAtLogin: bool(v.launchAtLogin, false), notifications: bool(v.notifications, true) });
      return ctx.getState();
    }),
  );
  ipcMain.handle(
    LOCAL_IPC.requestPermission,
    guard((kind: unknown) => {
      const k = str(kind);
      if (k !== "microphone" && k !== "speech" && k !== "accessibility" && k !== "screenRecording") throw new Error("Unbekannte Berechtigung.");
      return ctx.requestPermission(k);
    }),
  );
  ipcMain.handle(LOCAL_IPC.checkUpdates, guard(() => ctx.checkForUpdates()));
  ipcMain.handle(
    LOCAL_IPC.openLogs,
    guard(() => {
      shell.showItemInFolder(ctx.logPath());
    }),
  );
  ipcMain.handle(LOCAL_IPC.hudStop, guard(() => ctx.hudStop()));
  ipcMain.handle(LOCAL_IPC.retry, guard(() => ctx.retry()));
  ipcMain.handle(LOCAL_IPC.openSettings, guard(() => ctx.openSettings()));
  ipcMain.handle(LOCAL_IPC.openMain, guard(() => ctx.openMain()));
  log.info("local_ipc_registered");
}

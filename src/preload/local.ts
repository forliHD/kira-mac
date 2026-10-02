// Preload der lokalen Seiten (Onboarding, Einstellungen, HUD, Offline):
// `window.KiraLocal` – nicht Teil des Vertrags mit dem Dashboard.

import { contextBridge, ipcRenderer } from "electron";

import { LOCAL_IPC } from "../shared/ipc-local";
import { type KiraLocalApi, type LocalEvent, type LocalState, type ProbeResult, type QuickState, type UpdateState } from "../shared/local-api";
import { type PermissionsStatus } from "../shared/helper-types";

const api: KiraLocalApi = {
  getState: () => ipcRenderer.invoke(LOCAL_IPC.getState) as Promise<LocalState>,
  probe: (url) => ipcRenderer.invoke(LOCAL_IPC.probe, url) as Promise<ProbeResult>,
  saveInstance: (instance) => ipcRenderer.invoke(LOCAL_IPC.saveInstance, instance) as Promise<LocalState>,
  finishOnboarding: () => ipcRenderer.invoke(LOCAL_IPC.finishOnboarding) as Promise<void>,
  setHotkeys: (hotkeys) => ipcRenderer.invoke(LOCAL_IPC.setHotkeys, hotkeys) as Promise<{ state: LocalState; conflicts: string[] }>,
  setDictation: (dictation) => ipcRenderer.invoke(LOCAL_IPC.setDictation, dictation) as Promise<LocalState>,
  setGeneral: (general) => ipcRenderer.invoke(LOCAL_IPC.setGeneral, general) as Promise<LocalState>,
  requestPermission: (kind) => ipcRenderer.invoke(LOCAL_IPC.requestPermission, kind) as Promise<PermissionsStatus | null>,
  checkForUpdates: () => ipcRenderer.invoke(LOCAL_IPC.checkUpdates) as Promise<UpdateState>,
  installUpdate: () => ipcRenderer.invoke(LOCAL_IPC.installUpdate) as Promise<void>,
  setHotkeyRecording: (active) => ipcRenderer.invoke(LOCAL_IPC.setHotkeyRecording, active) as Promise<void>,
  openLogs: () => ipcRenderer.invoke(LOCAL_IPC.openLogs) as Promise<void>,
  hudStop: () => ipcRenderer.invoke(LOCAL_IPC.hudStop) as Promise<void>,
  retry: () => ipcRenderer.invoke(LOCAL_IPC.retry) as Promise<void>,
  openSettings: () => ipcRenderer.invoke(LOCAL_IPC.openSettings) as Promise<void>,
  openMain: () => ipcRenderer.invoke(LOCAL_IPC.openMain) as Promise<void>,
  openLink: (url) => ipcRenderer.invoke(LOCAL_IPC.openLink, url) as Promise<void>,
  quickGetState: () => ipcRenderer.invoke(LOCAL_IPC.quickGetState) as Promise<QuickState>,
  quickSend: (text) => ipcRenderer.invoke(LOCAL_IPC.quickSend, text) as Promise<void>,
  quickStop: () => ipcRenderer.invoke(LOCAL_IPC.quickStop) as Promise<void>,
  quickReset: () => ipcRenderer.invoke(LOCAL_IPC.quickReset) as Promise<void>,
  quickOpenInMain: () => ipcRenderer.invoke(LOCAL_IPC.quickOpenInMain) as Promise<void>,
  quickHide: () => ipcRenderer.invoke(LOCAL_IPC.quickHide) as Promise<void>,
  quickResize: (height) => ipcRenderer.invoke(LOCAL_IPC.quickResize, height) as Promise<void>,
  quickToggleDictation: () => ipcRenderer.invoke(LOCAL_IPC.quickToggleDictation) as Promise<void>,
  on: (listener) => {
    const handler = (_event: unknown, payload: unknown): void => {
      if (payload && typeof payload === "object" && typeof (payload as LocalEvent).type === "string") listener(payload as LocalEvent);
    };
    ipcRenderer.on(LOCAL_IPC.event, handler);
    return () => {
      ipcRenderer.removeListener(LOCAL_IPC.event, handler);
    };
  },
};

contextBridge.exposeInMainWorld("KiraLocal", api);

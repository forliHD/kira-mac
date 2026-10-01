// Preload der lokalen Seiten (Onboarding, Einstellungen, HUD, Offline):
// `window.KiraLocal` – nicht Teil des Vertrags mit dem Dashboard.

import { contextBridge, ipcRenderer } from "electron";

import { LOCAL_IPC } from "../shared/ipc-local";
import { type KiraLocalApi, type LocalEvent, type LocalState, type ProbeResult, type UpdateState } from "../shared/local-api";
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
  openLogs: () => ipcRenderer.invoke(LOCAL_IPC.openLogs) as Promise<void>,
  hudStop: () => ipcRenderer.invoke(LOCAL_IPC.hudStop) as Promise<void>,
  retry: () => ipcRenderer.invoke(LOCAL_IPC.retry) as Promise<void>,
  openSettings: () => ipcRenderer.invoke(LOCAL_IPC.openSettings) as Promise<void>,
  openMain: () => ipcRenderer.invoke(LOCAL_IPC.openMain) as Promise<void>,
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

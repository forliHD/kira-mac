// Kanalnamen der IPC zwischen Hauptprozess und den lokalen Seiten
// (`window.KiraLocal`, Präfix `local:`). Getrennt von ipc.ts – siehe dort.

export const LOCAL_IPC = {
  // Lokale Seiten → Hauptprozess (local-ipc.ts)
  getState: "local:getState",
  probe: "local:probe",
  saveInstance: "local:saveInstance",
  finishOnboarding: "local:finishOnboarding",
  setHotkeys: "local:setHotkeys",
  setDictation: "local:setDictation",
  setGeneral: "local:setGeneral",
  requestPermission: "local:requestPermission",
  checkUpdates: "local:checkUpdates",
  installUpdate: "local:installUpdate",
  setHotkeyRecording: "local:setHotkeyRecording",
  openLogs: "local:openLogs",
  hudStop: "local:hudStop",
  retry: "local:retry",
  openSettings: "local:openSettings",
  openMain: "local:openMain",
  openLink: "local:openLink",
  accessLogin: "local:accessLogin",
  accessLoginInWindow: "local:accessLoginInWindow",
  quickGetState: "local:quickGetState",
  quickSend: "local:quickSend",
  quickStop: "local:quickStop",
  quickReset: "local:quickReset",
  quickOpenInMain: "local:quickOpenInMain",
  quickHide: "local:quickHide",
  quickResize: "local:quickResize",
  quickToggleDictation: "local:quickToggleDictation",
  // Hauptprozess → lokale Seiten
  event: "local:event",
} as const;

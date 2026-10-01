// Preload für Seiten der KIRA-Instanz: stellt `window.KiraNative` exakt nach
// docs/native-bridge.md bereit – und NUR, wenn die Seite eine http(s)-Seite
// einer konfigurierten Instanz-Origin ist. Fremde Seiten (Anmeldung,
// `blob:`-Ansichten, Vorschau-Proxys) bekommen nichts; der Hauptprozess
// bestätigt die Origin beim Bootstrap, das Protokoll prüft der Preload selbst.

import { contextBridge, ipcRenderer } from "electron";

import { IPC } from "../shared/ipc";
import { type PreloadBootstrap, createKiraNative } from "./api";
import { decodeToWav16k } from "./audio";

function bootstrap(): PreloadBootstrap | null {
  if (!/^https?:$/.test(location.protocol)) return null;
  try {
    const reply = ipcRenderer.sendSync(IPC.bootstrap, location.origin) as PreloadBootstrap | undefined;
    if (!reply || typeof reply !== "object" || reply.allowed !== true) return null;
    return reply;
  } catch {
    return null;
  }
}

const boot = bootstrap();
if (boot) {
  const api = createKiraNative({
    bootstrap: boot,
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    decodeToWav: (audio) => decodeToWav16k(audio),
  });
  contextBridge.exposeInMainWorld("KiraNative", api);
  ipcRenderer.on(IPC.nativeEvent, (_event, detail: unknown) => {
    if (!detail || typeof detail !== "object") return;
    // Über Welten hinweg: Blink klont `detail` beim Zugriff aus der Hauptwelt
    // (strukturiertes Klonen), deshalb reicht ein einfaches Objekt.
    window.dispatchEvent(new CustomEvent("kira:native", { detail }));
  });
}

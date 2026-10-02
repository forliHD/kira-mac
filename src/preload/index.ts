// Preload für Seiten der KIRA-Instanz: stellt `window.KiraNative` exakt nach
// docs/native-bridge.md bereit – und NUR, wenn die Seite eine http(s)-Seite
// einer konfigurierten Instanz-Origin ist. Fremde Seiten (Anmeldung,
// `blob:`-Ansichten, Vorschau-Proxys) bekommen nichts; der Hauptprozess
// bestätigt die Origin beim Bootstrap, das Protokoll prüft der Preload selbst.

import { contextBridge, ipcRenderer } from "electron";

import { IPC } from "../shared/ipc";
import { type PreloadBootstrap, createKiraNative } from "./api";
import { decodeToWav16k } from "./audio";
import { createLocalSubset, isLocalAppPage } from "./local-subset";

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

// Lokale Seiten im Hauptfenster (Offline-Seite): Teil von window.KiraLocal.
// Der Hauptprozess prüft jeden Aufruf ohnehin auf einen lokalen Absender.
if (isLocalAppPage(location.href, process.env.ELECTRON_RENDERER_URL)) {
  const api = createLocalSubset({
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    subscribe: (channel, handler) => {
      const listener = (_event: unknown, payload: unknown): void => handler(payload);
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    },
  });
  contextBridge.exposeInMainWorld("KiraLocal", api);
}

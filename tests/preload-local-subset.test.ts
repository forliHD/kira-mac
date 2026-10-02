import { describe, expect, it, vi } from "vitest";

import { SUBSET_CHANNELS, createLocalSubset, isLocalAppPage } from "../src/preload/local-subset";
import { LOCAL_IPC } from "../src/shared/ipc-local";

// Offline-Seite im Hauptfenster: Teil von window.KiraLocal aus dem
// Instanz-Preload. Die Kanal-Literale müssen zu LOCAL_IPC passen.
describe("Offline-Teil von KiraLocal", () => {
  it("benutzt dieselben Kanäle wie der lokale Preload", () => {
    expect(SUBSET_CHANNELS.getState).toBe(LOCAL_IPC.getState);
    expect(SUBSET_CHANNELS.retry).toBe(LOCAL_IPC.retry);
    expect(SUBSET_CHANNELS.openSettings).toBe(LOCAL_IPC.openSettings);
    expect(SUBSET_CHANNELS.openMain).toBe(LOCAL_IPC.openMain);
    expect(SUBSET_CHANNELS.openLink).toBe(LOCAL_IPC.openLink);
    expect(SUBSET_CHANNELS.accessLogin).toBe(LOCAL_IPC.accessLogin);
    expect(SUBSET_CHANNELS.accessLoginInWindow).toBe(LOCAL_IPC.accessLoginInWindow);
    expect(SUBSET_CHANNELS.event).toBe(LOCAL_IPC.event);
  });

  it("leitet Aufrufe weiter und filtert Ereignisse", async () => {
    const invoke = vi.fn(async () => undefined);
    let handler: ((p: unknown) => void) | null = null;
    const api = createLocalSubset({
      invoke,
      subscribe: (_c, h) => {
        handler = h;
        return () => undefined;
      },
    });
    await api.retry();
    await api.openLink("/chat");
    expect(invoke).toHaveBeenNthCalledWith(1, "local:retry");
    expect(invoke).toHaveBeenNthCalledWith(2, "local:openLink", "/chat");
    const seen: string[] = [];
    api.on((e) => seen.push(e.type));
    handler!({ type: "connection", connection: {} });
    handler!({ kein: "Ereignis" });
    handler!(null);
    expect(seen).toEqual(["connection"]);
  });

  it("erkennt lokale Seiten", () => {
    expect(isLocalAppPage("file:///Applications/KIRA.app/Contents/Resources/app.asar/out/renderer/offline/index.html", undefined)).toBe(true);
    expect(isLocalAppPage("http://localhost:5173/offline/index.html", "http://localhost:5173")).toBe(true);
    expect(isLocalAppPage("https://kira.example.de/chat", "http://localhost:5173")).toBe(false);
    expect(isLocalAppPage("http://localhost:5173/x", undefined)).toBe(false);
    expect(isLocalAppPage("file:///Users/x/Downloads/fremd.html", undefined)).toBe(false);
    expect(isLocalAppPage("file:///Applications/KIRA.app/Contents/Resources/app.asar/out/renderer/offline/index.html?reason=x", undefined)).toBe(true);
  });
});

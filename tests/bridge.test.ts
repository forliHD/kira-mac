// Vertragstest gegen docs/native-bridge.md (Version 1): Felder, Methoden,
// Fähigkeiten, Ereignisse. Wenn dieser Test bricht, weicht eine Seite ab.

import { describe, expect, it, vi } from "vitest";

import { createKiraNative, type PreloadIo } from "../src/preload/api";
import { BRIDGE_VERSION, CAPABILITIES, NATIVE_EVENT_TYPES, NATIVE_METHODS } from "../src/shared/bridge";
import { capabilitiesFrom } from "../src/shared/capabilities";
import { IPC } from "../src/shared/ipc";

function io(overrides: Partial<PreloadIo> = {}): PreloadIo {
  const invoke = vi.fn(async (channel: string) => {
    switch (channel) {
      case IPC.getInfo:
        return { bridge: 1, app: APP, capabilities: ["session"], instance: { origin: "https://kira.example.de", label: "kira.example.de" } };
      case IPC.sttStatus:
        return { available: true, engine: "apple", locale: "de-DE" };
      case IPC.transcribe:
        return { text: "Hallo Welt.", engine: "apple", durationMs: 1200 };
      default:
        return undefined;
    }
  });
  return {
    bootstrap: {
      allowed: true,
      app: APP,
      capabilities: ["session", "notifications", "open-external", "quick-window", "stt"],
      instance: { origin: "https://kira.example.de", label: "kira.example.de" },
    },
    invoke,
    decodeToWav: async () => ({ wav: new Uint8Array(44), durationMs: 1200 }),
    ...overrides,
  };
}

const APP = { name: "KIRA für Mac", version: "0.1.0", platform: "darwin" as const, arch: "arm64" };

describe("Vertrag: Konstanten", () => {
  it("Vertragsversion 1", () => {
    expect(BRIDGE_VERSION).toBe(1);
  });

  it("Methoden- und Ereignislisten entsprechen den Tabellen", () => {
    expect([...NATIVE_METHODS]).toEqual(["getInfo", "setSession", "notify", "openExternal", "sttStatus", "transcribe"]);
    expect([...NATIVE_EVENT_TYPES]).toEqual(["navigate", "notification", "connectivity", "session-request", "share"]);
    expect([...CAPABILITIES]).toEqual([
      "session",
      "notifications",
      "open-external",
      "stt",
      "quick-window",
      "system-audio",
      "apple-intelligence",
      "insert-text",
      "inset-titlebar",
    ]);
  });
});

describe("Vertrag: window.KiraNative", () => {
  it("hat genau die Felder und Methoden des Vertrags", () => {
    const api = createKiraNative(io());
    expect(api.bridge).toBe(1);
    expect(Number.isInteger(api.bridge)).toBe(true);
    expect(api.app).toEqual(APP);
    expect(api.app.platform).toBe("darwin");
    expect(Array.isArray(api.capabilities)).toBe(true);
    for (const m of NATIVE_METHODS) expect(typeof api[m]).toBe("function");
    expect(Object.keys(api).sort()).toEqual(["app", "bridge", "capabilities", ...NATIVE_METHODS].sort());
  });

  it("Erkennung wie im Dashboard: bridge ist ganzzahlig und ≥ 1", () => {
    const shell = createKiraNative(io());
    const native = shell && Number.isInteger(shell.bridge) && shell.bridge >= 1 ? shell : null;
    expect(native).not.toBeNull();
  });

  it("getInfo liefert bridge, app, capabilities und instance", async () => {
    const api = createKiraNative(io());
    const info = await api.getInfo();
    expect(info).toMatchObject({ bridge: 1, app: APP, instance: { origin: "https://kira.example.de", label: "kira.example.de" } });
    expect(Array.isArray(info.capabilities)).toBe(true);
  });

  it("setSession nimmt Tokens oder null und lehnt anderes als Promise-Fehler ab", async () => {
    const i = io();
    const api = createKiraNative(i);
    await api.setSession({ accessToken: "a", refreshToken: "r" });
    expect(i.invoke).toHaveBeenLastCalledWith(IPC.setSession, { accessToken: "a", refreshToken: "r" });
    await api.setSession(null);
    expect(i.invoke).toHaveBeenLastCalledWith(IPC.setSession, null);
    // nie synchron werfen
    const bad = api.setSession({ accessToken: 1 } as unknown as { accessToken: string; refreshToken: string });
    expect(bad).toBeInstanceOf(Promise);
    await expect(bad).rejects.toThrow(/setSession/);
  });

  it("notify reicht nur die Vertragsfelder weiter", async () => {
    const i = io();
    const api = createKiraNative(i);
    await api.notify({ title: "KIRA", body: "Antwort da", url: "/chat", tag: "chat-1", category: "chat", extra: 1 } as never);
    expect(i.invoke).toHaveBeenLastCalledWith(IPC.notify, { title: "KIRA", body: "Antwort da", url: "/chat", tag: "chat-1", category: "chat" });
  });

  it("openExternal verlangt eine URL", async () => {
    const api = createKiraNative(io());
    await expect(api.openExternal("")).rejects.toThrow();
    await expect(api.openExternal("https://example.de")).resolves.toBeUndefined();
  });

  it("sttStatus liefert { available, engine, locale?, reason? }", async () => {
    const api = createKiraNative(io());
    await expect(api.sttStatus()).resolves.toEqual({ available: true, engine: "apple", locale: "de-DE" });
  });

  it("transcribe dekodiert im Preload und liefert { text, engine: 'apple', durationMs }", async () => {
    const decode = vi.fn(async () => ({ wav: new Uint8Array(100), durationMs: 1200 }));
    const i = io({ decodeToWav: decode });
    const api = createKiraNative(i);
    const audio = new ArrayBuffer(10);
    const result = await api.transcribe(audio, { mime: "audio/webm", context: "Musterfirma", locale: "de-DE" });
    expect(decode).toHaveBeenCalledWith(audio, "audio/webm");
    expect(i.invoke).toHaveBeenLastCalledWith(IPC.transcribe, expect.objectContaining({ context: "Musterfirma", locale: "de-DE", durationMs: 1200 }));
    expect(result).toEqual({ text: "Hallo Welt.", engine: "apple", durationMs: 1200 });
  });

  it("transcribe wirft (als Promise), wenn die Hülle scheitert – das Dashboard fällt dann auf den Server zurück", async () => {
    const i = io({
      invoke: vi.fn(async () => {
        throw new Error("stt_unavailable");
      }),
    });
    const api = createKiraNative(i);
    const p = api.transcribe(new ArrayBuffer(4), { mime: "audio/webm" });
    expect(p).toBeInstanceOf(Promise);
    await expect(p).rejects.toThrow(/stt_unavailable/);
    await expect(api.transcribe(new ArrayBuffer(0), { mime: "audio/webm" })).rejects.toThrow(/ArrayBuffer/);
  });
});

describe("Fähigkeiten aus info.features", () => {
  it("ohne Helfer nur die Electron-Fähigkeiten", () => {
    expect(capabilitiesFrom(null)).toEqual(["session", "notifications", "open-external", "quick-window"]);
  });

  it("mit Helfer je nach Feature-Flags", () => {
    expect(capabilitiesFrom({ stt: true, sttStream: true, llm: true, systemAudio: true, insertText: true })).toEqual([
      "session",
      "notifications",
      "open-external",
      "quick-window",
      "stt",
      "system-audio",
      "apple-intelligence",
      "insert-text",
    ]);
    expect(capabilitiesFrom({ stt: false, sttStream: false, llm: false, systemAudio: false, insertText: true })).toEqual([
      "session",
      "notifications",
      "open-external",
      "quick-window",
      "insert-text",
    ]);
  });

  it("liefert nur Werte aus der Vertragstabelle", () => {
    for (const c of capabilitiesFrom({ stt: true, sttStream: true, llm: true, systemAudio: true, insertText: true })) {
      expect(CAPABILITIES).toContain(c);
    }
  });
});

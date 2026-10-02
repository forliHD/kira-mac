import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { type DictationHelper, GlobalDictation, buildContextualStrings, pieceToInsert, splitVocabulary } from "../src/main/dictation";
import { applyDictationCommands, joinDictation } from "../src/shared/dictationText.js";
import { type HelperEvent, type HelperInfo } from "../src/shared/helper-types";
import { type HudState } from "../src/shared/local-api";

describe("Diktierbefehle (Kopie aus dem Dashboard)", () => {
  it("setzt Satzzeichen und Strukturbefehle um", () => {
    expect(applyDictationCommands("Hallo Welt Punkt").text).toBe("Hallo Welt.");
    expect(applyDictationCommands("erstens Komma zweitens").text).toBe("erstens, zweitens");
    expect(applyDictationCommands("neuer Absatz").text).toBe("\n\n");
    expect(applyDictationCommands("E Bindestrich Mail").text).toBe("E-Mail");
  });

  it("lässt Hauptwörter nach Artikeln in Ruhe", () => {
    expect(applyDictationCommands("der Punkt ist wichtig").text).toBe("der Punkt ist wichtig");
  });

  it("erkennt Rückgängig", () => {
    expect(applyDictationCommands("das löschen")).toEqual({ text: "", op: "undo" });
  });

  it("lässt sich abschalten", () => {
    expect(applyDictationCommands("Hallo Punkt", { enabled: false }).text).toBe("Hallo Punkt");
  });

  it("joinDictation setzt genau ein Leerzeichen", () => {
    expect(joinDictation("Hallo.", "Welt")).toBe("Hallo. Welt");
    expect(joinDictation("Hallo", ", oder?")).toBe("Hallo, oder?");
  });
});

describe("Wortschatz", () => {
  it("teilt an Komma und Zeile, ohne Duplikate", () => {
    expect(splitVocabulary("Musterfirma, Lucas\nKIRA,  kira ")).toEqual(["Musterfirma", "Lucas", "KIRA"]);
    expect(splitVocabulary(null)).toEqual([]);
  });

  it("Reihenfolge: KIRA, Anzeigename, eigene Begriffe", () => {
    expect(buildContextualStrings("Lucas", "Musterfirma, Lucas, Proxmox")).toEqual(["KIRA", "Lucas", "Musterfirma", "Proxmox"]);
    expect(buildContextualStrings(null, null)).toEqual(["KIRA"]);
  });

  it("pieceToInsert ergänzt das Leerzeichen bezogen auf die letzte Einfügung", () => {
    expect(pieceToInsert("", "Hallo")).toBe("Hallo");
    expect(pieceToInsert("o.", "Welt")).toBe(" Welt");
    expect(pieceToInsert("lo", ", oder")).toBe(", oder");
    expect(pieceToInsert("lo", "\n\nNeu")).toBe("\n\nNeu");
  });
});

class FakeHelper extends EventEmitter implements DictationHelper {
  running = true;
  info: HelperInfo | null = {
    protocol: 1,
    version: "0.1.0",
    macos: "27.0.1",
    chip: "Apple M3",
    features: { stt: true, sttStream: true, llm: false, systemAudio: false, insertText: true },
    locales: ["de-DE"],
  };
  readonly calls: Array<{ cmd: string; params?: Record<string, unknown> }> = [];
  permissions = { microphone: "granted", speech: "granted", accessibility: true, screenRecording: false };
  sttStatus: { available: boolean; engine: string | null; assets: string; reason?: string } = { available: true, engine: "analyzer", assets: "installed" };
  /** Hält `stt.start` auf, bis die Zusage erfüllt ist (Start dauert). */
  sttStartGate: Promise<void> | null = null;
  /** Diese Äußerungen spült `stt.stop` noch als `stt.final`, bevor `stt.ended` kommt. */
  flushOnStop: string[] = [];

  request<T = unknown>(cmd: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ cmd, params });
    if (cmd === "stt.start" && this.sttStartGate) {
      return this.sttStartGate.then(() => ({ started: true }) as unknown as T);
    }
    if (cmd === "stt.stop") {
      const pending = this.flushOnStop;
      this.flushOnStop = [];
      queueMicrotask(() => {
        for (const text of pending) this.emit("event", { event: "stt.final", stream: "dictation", data: { text } });
        this.emit("event", { event: "stt.ended", stream: "dictation", data: { reason: "stopped" } });
      });
      return Promise.resolve({ stopped: true } as unknown as T);
    }
    switch (cmd) {
      case "stt.status":
        return Promise.resolve(this.sttStatus as unknown as T);
      case "permissions.status":
        return Promise.resolve({ ...this.permissions } as unknown as T);
      case "text.frontmost":
        return Promise.resolve({ bundleId: "com.apple.mail", name: "Mail" } as unknown as T);
      case "stt.start":
        return Promise.resolve({ started: true } as unknown as T);
      case "stt.stop":
        queueMicrotask(() => this.emit("event", { event: "stt.ended", stream: "dictation", data: { reason: "stopped" } }));
        return Promise.resolve({ stopped: true } as unknown as T);
      case "text.insert":
        return Promise.resolve({ method: "ax" } as unknown as T);
      default:
        return Promise.resolve({} as T);
    }
  }

  override on(event: "event", listener: (ev: HelperEvent) => void): this {
    return super.on(event, listener);
  }

  override off(event: "event", listener: (ev: HelperEvent) => void): this {
    return super.off(event, listener);
  }

  emitEvent(ev: HelperEvent): void {
    this.emit("event", ev);
  }
}

function build(helper: FakeHelper, opts: { commands?: boolean; vocabulary?: string | null; vocabularyGate?: Promise<void> } = {}) {
  const hud = { show: vi.fn(), hide: vi.fn(), update: vi.fn<(s: HudState) => void>() };
  const dictation = new GlobalDictation({
    helper,
    server: {
      fetchVocabulary: async () => {
        if (opts.vocabularyGate) await opts.vocabularyGate;
        return opts.vocabulary ?? "Musterfirma, Proxmox";
      },
      fetchDisplayName: async () => "Lucas",
    },
    hud,
    getLocale: () => "de-DE",
    getCommandsEnabled: () => opts.commands ?? true,
    errorLingerMs: 5,
  });
  return { dictation, hud };
}

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe("GlobalDictation", () => {
  it("startet stt.start mit contextualStrings (KIRA, Name, Begriffe) und zeigt das Zielprogramm", async () => {
    const helper = new FakeHelper();
    const { dictation, hud } = build(helper);
    await dictation.start();
    expect(dictation.currentState).toBe("listening");
    const start = helper.calls.find((c) => c.cmd === "stt.start");
    expect(start?.params).toEqual({
      stream: "dictation",
      locale: "de-DE",
      contextualStrings: ["KIRA", "Lucas", "Musterfirma", "Proxmox"],
      source: "microphone",
    });
    expect(hud.show).toHaveBeenCalled();
    const last = hud.update.mock.calls.at(-1)?.[0];
    expect(last).toMatchObject({ phase: "listening", app: "Mail" });
  });

  it("wendet die Diktierbefehle an und fügt per text.insert (auto) ein", async () => {
    const helper = new FakeHelper();
    const { dictation } = build(helper);
    const inserted: string[] = [];
    dictation.on("inserted", (e) => inserted.push(e.text));
    await dictation.start();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: "Hallo Welt Punkt" } });
    await tick();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: "neuer Absatz" } });
    await tick();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: "Zweiter Satz" } });
    await tick();
    const inserts = helper.calls.filter((c) => c.cmd === "text.insert").map((c) => c.params);
    expect(inserts).toEqual([
      { text: "Hallo Welt.", mode: "auto" },
      { text: "\n\n", mode: "auto" },
      { text: "Zweiter Satz", mode: "auto" },
    ]);
    expect(inserted).toEqual(["Hallo Welt.", "\n\n", "Zweiter Satz"]);
  });

  it("setzt zwischen zwei Äußerungen ein Leerzeichen", async () => {
    const helper = new FakeHelper();
    const { dictation } = build(helper);
    await dictation.start();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: "Erster Satz Punkt" } });
    await tick();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: "zweiter Satz" } });
    await tick();
    const inserts = helper.calls.filter((c) => c.cmd === "text.insert").map((c) => c.params?.text);
    expect(inserts).toEqual(["Erster Satz.", " zweiter Satz"]);
  });

  it("fügt bei Rückgängig nichts ein und ignoriert fremde Streams", async () => {
    const helper = new FakeHelper();
    const { dictation } = build(helper);
    await dictation.start();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: "das löschen" } });
    helper.emitEvent({ event: "stt.final", stream: "other", data: { text: "Fremd" } });
    await tick();
    expect(helper.calls.filter((c) => c.cmd === "text.insert")).toHaveLength(0);
  });

  it("lässt Befehle abschaltbar", async () => {
    const helper = new FakeHelper();
    const { dictation } = build(helper, { commands: false });
    await dictation.start();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: "Hallo Punkt" } });
    await tick();
    expect(helper.calls.find((c) => c.cmd === "text.insert")?.params?.text).toBe("Hallo Punkt");
  });

  it("aktualisiert Pegel und flüchtigen Text im HUD", async () => {
    const helper = new FakeHelper();
    const { dictation, hud } = build(helper);
    await dictation.start();
    helper.emitEvent({ event: "stt.level", stream: "dictation", data: { rms: 0.5 } });
    helper.emitEvent({ event: "stt.partial", stream: "dictation", data: { text: "Hal" } });
    const last = hud.update.mock.calls.at(-1)?.[0];
    expect(last).toMatchObject({ level: 0.5, partial: "Hal" });
  });

  it("stoppt über stt.stop und versteckt das HUD nach stt.ended", async () => {
    const helper = new FakeHelper();
    const { dictation, hud } = build(helper);
    await dictation.start();
    await dictation.toggle();
    await tick();
    expect(helper.calls.find((c) => c.cmd === "stt.stop")?.params).toEqual({ stream: "dictation" });
    expect(dictation.currentState).toBe("idle");
    expect(hud.hide).toHaveBeenCalled();
  });

  it("ohne Apple-Spracherkennung: klarer Hinweis mit Grund, kein Start, kein Rückfall", async () => {
    const helper = new FakeHelper();
    helper.sttStatus = { available: false, engine: null, assets: "missing", reason: "Sprachmodell für de-DE fehlt." };
    const { dictation, hud } = build(helper);
    const unavailable = vi.fn();
    dictation.on("unavailable", unavailable);
    await dictation.start();
    expect(dictation.currentState).toBe("idle");
    expect(helper.calls.find((c) => c.cmd === "stt.start")).toBeUndefined();
    expect(unavailable).toHaveBeenCalledWith("Sprachmodell für de-DE fehlt.");
    expect(hud.update.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "unavailable", message: "Sprachmodell für de-DE fehlt." });
  });

  it("fragt die Mikrofon-Freigabe nach und bricht bei Verweigerung ab", async () => {
    const helper = new FakeHelper();
    helper.permissions = { ...helper.permissions, microphone: "notDetermined" };
    const originalRequest = helper.request.bind(helper);
    helper.request = <T>(cmd: string, params?: Record<string, unknown>): Promise<T> => {
      if (cmd === "permissions.request") {
        helper.calls.push({ cmd, params });
        return Promise.resolve({ status: "denied" } as unknown as T);
      }
      return originalRequest<T>(cmd, params);
    };
    const { dictation } = build(helper);
    await dictation.start();
    expect(helper.calls.find((c) => c.cmd === "permissions.request")?.params).toEqual({ kind: "microphone" });
    expect(dictation.currentState).toBe("idle");
    expect(helper.calls.find((c) => c.cmd === "stt.start")).toBeUndefined();
  });

  it("Stopp während des Starts (vor stt.start): sofort aus, kein Stream beim Helfer", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const helper = new FakeHelper();
    const { dictation, hud } = build(helper, { vocabularyGate: gate });
    const states: string[] = [];
    dictation.on("state", (st) => states.push(st));
    const starting = dictation.start();
    await tick();
    expect(dictation.currentState).toBe("starting");
    await dictation.stop();
    expect(dictation.currentState).toBe("idle");
    expect(hud.hide).toHaveBeenCalled();
    open();
    await starting;
    await tick();
    expect(helper.calls.find((c) => c.cmd === "stt.start")).toBeUndefined();
    expect(dictation.currentState).toBe("idle");
    expect(states).not.toContain("listening");
  });

  it("Stopp, während stt.start unterwegs ist: der Stream wird danach gleich beendet", async () => {
    let open!: () => void;
    const helper = new FakeHelper();
    helper.sttStartGate = new Promise<void>((resolve) => (open = resolve));
    const { dictation } = build(helper);
    const states: string[] = [];
    dictation.on("state", (st) => states.push(st));
    const starting = dictation.start();
    await vi.waitFor(() => expect(helper.calls.some((c) => c.cmd === "stt.start")).toBe(true));
    await dictation.stop();
    expect(dictation.currentState).toBe("stopping");
    expect(helper.calls.find((c) => c.cmd === "stt.stop")).toBeUndefined();
    open();
    await starting;
    await tick();
    const cmds = helper.calls.map((c) => c.cmd);
    expect(cmds.indexOf("stt.stop")).toBeGreaterThan(cmds.indexOf("stt.start"));
    expect(dictation.currentState).toBe("idle");
    expect(states).not.toContain("listening");
  });

  it("cancel verwirft ausstehende Äußerungen und blendet die Pille sofort aus", async () => {
    const helper = new FakeHelper();
    const { dictation, hud } = build(helper);
    await dictation.start();
    helper.flushOnStop = ["noch gespült"];
    hud.hide.mockClear();
    const cancelling = dictation.cancel();
    expect(hud.hide).toHaveBeenCalledTimes(1);
    await cancelling;
    await tick();
    expect(helper.calls.find((c) => c.cmd === "stt.stop")).toBeDefined();
    expect(helper.calls.filter((c) => c.cmd === "text.insert")).toHaveLength(0);
    expect(dictation.currentState).toBe("idle");

    // Der nächste Start setzt wieder ein.
    await dictation.start();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: "Danach" } });
    await tick();
    expect(helper.calls.filter((c) => c.cmd === "text.insert").map((c) => c.params?.text)).toEqual(["Danach"]);
  });

  it("stop setzt dagegen noch gespülte Äußerungen ein", async () => {
    const helper = new FakeHelper();
    const { dictation } = build(helper);
    await dictation.start();
    helper.flushOnStop = ["letzter Satz"];
    await dictation.stop();
    await tick();
    expect(helper.calls.filter((c) => c.cmd === "text.insert").map((c) => c.params?.text)).toEqual(["letzter Satz"]);
  });

  it("cancel ohne laufendes Diktat nimmt eine stehende Meldung weg", async () => {
    const helper = new FakeHelper();
    helper.sttStatus = { available: false, engine: null, assets: "missing", reason: "Sprachmodell fehlt." };
    const { dictation, hud } = build(helper);
    await dictation.start();
    expect(hud.update.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "unavailable" });
    hud.hide.mockClear();
    await dictation.cancel();
    expect(hud.hide).toHaveBeenCalledTimes(1);
    expect(dictation.currentState).toBe("idle");
  });

  it("hält den Wortschatz eine Stunde im Cache", async () => {
    const helper = new FakeHelper();
    let now = 0;
    const fetchVocabulary = vi.fn(async () => "A");
    const dictation = new GlobalDictation({
      helper,
      server: { fetchVocabulary, fetchDisplayName: async () => null },
      hud: { show: () => undefined, hide: () => undefined, update: () => undefined },
      getLocale: () => "de-DE",
      getCommandsEnabled: () => true,
      now: () => now,
    });
    await dictation.contextualStrings();
    await dictation.contextualStrings();
    expect(fetchVocabulary).toHaveBeenCalledTimes(1);
    now = 61 * 60 * 1000;
    await dictation.contextualStrings();
    expect(fetchVocabulary).toHaveBeenCalledTimes(2);
  });
});

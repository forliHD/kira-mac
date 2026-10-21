import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  type DictationHelper,
  type DictationSession,
  type DictationSink,
  GlobalDictation,
  type StoredVocabulary,
  type VocabularyStore,
  buildContextualStrings,
  isPunctuationOnly,
  pieceToInsert,
  splitVocabulary,
} from "../src/main/dictation";
import { applyDictationCommands, joinDictation } from "../src/shared/dictationText.js";
import { type HelperEvent, type HelperInfo, type HelperSttStatus } from "../src/shared/helper-types";
import { type HudState } from "../src/shared/local-api";
import { type Logger } from "../src/shared/logger";

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
  sttStatus: HelperSttStatus = { available: true, engine: "analyzer", assets: "installed" };
  /** Hält `stt.start` auf, bis die Zusage erfüllt ist (Start dauert). */
  sttStartGate: Promise<void> | null = null;
  /** Wirft `stt.prepare` mit diesem Text. */
  prepareError: string | null = null;
  /** Eigener `stt.prepare`-Lauf (Fortschritt), sonst gilt das Modell danach als da. */
  prepareImpl: (() => Promise<void> | void) | null = null;
  /** Diese Äußerungen spült `stt.stop` noch als `stt.final`, bevor `stt.ended` kommt. */
  flushOnStop: string[] = [];
  /** Antwort auf `text.knownWords` (Wörter, die das Wörterbuch kennt). */
  knownWords: string[] = [];
  /** Hält `text.knownWords` auf (die Wörterbuch-Frage dauert). */
  knownWordsGate: Promise<void> | null = null;

  request<T = unknown>(cmd: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ cmd, params });
    if (cmd === "stt.start" && this.sttStartGate) {
      return this.sttStartGate.then(() => ({ started: true }) as unknown as T);
    }
    if (cmd === "text.knownWords") {
      const answer = { known: this.knownWords } as unknown as T;
      return this.knownWordsGate ? this.knownWordsGate.then(() => answer) : Promise.resolve(answer);
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
      case "stt.prepare":
        if (this.prepareError) return Promise.reject(new Error(this.prepareError));
        if (this.prepareImpl) {
          return Promise.resolve(this.prepareImpl()).then(() => ({ assets: "installed" }) as unknown as T);
        }
        this.sttStatus = { available: true, engine: "analyzer", assets: "installed" };
        return Promise.resolve({ assets: "installed" } as unknown as T);
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

function build(
  helper: FakeHelper,
  opts: {
    commands?: boolean;
    correction?: boolean;
    vocabulary?: string | null;
    displayName?: string | null;
    vocabularyGate?: Promise<void>;
    test?: DictationSink;
    vocabularyStore?: VocabularyStore;
    log?: Logger;
  } = {},
) {
  const hud = { show: vi.fn(), hide: vi.fn(), update: vi.fn<(s: HudState) => void>() };
  const dictation = new GlobalDictation({
    helper,
    server: {
      fetchVocabulary: async () => {
        if (opts.vocabularyGate) await opts.vocabularyGate;
        return opts.vocabulary === undefined ? "Musterfirma, Proxmox" : opts.vocabulary;
      },
      fetchDisplayName: async () => (opts.displayName === undefined ? "Lucas" : opts.displayName),
    },
    hud,
    test: opts.test,
    vocabularyStore: opts.vocabularyStore,
    getLocale: () => "de-DE",
    getCommandsEnabled: () => opts.commands ?? true,
    getCorrectionEnabled: () => opts.correction ?? true,
    log: opts.log,
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

  it("verwirft reine Satzzeichen („..“), ein gesprochenes „Punkt“ bleibt (Live-Befund 02.10.2026)", async () => {
    const helper = new FakeHelper();
    const { dictation } = build(helper);
    await dictation.start();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: ".." } });
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: " ." } });
    await tick();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: "Satz Punkt" } });
    await tick();
    const inserts = helper.calls.filter((c) => c.cmd === "text.insert").map((c) => c.params?.text);
    expect(inserts).toEqual(["Satz."]);
    expect(isPunctuationOnly("..")).toBe(true);
    expect(isPunctuationOnly("…?!")).toBe(true);
    expect(isPunctuationOnly("Punkt")).toBe(false);
    expect(isPunctuationOnly("3.")).toBe(false);
    expect(isPunctuationOnly("  ")).toBe(false);
  });

  it("meldet das fertige Diktat für den Verlauf – auch wenn das Einsetzen scheitert", async () => {
    const helper = new FakeHelper();
    const original = helper.request.bind(helper);
    helper.request = (<T,>(cmd: string, params?: Record<string, unknown>): Promise<T> => {
      if (cmd === "text.insert" && params?.text === " Zweiter Satz.") return Promise.reject(new Error("Element nimmt keinen Text an"));
      return original<T>(cmd, params);
    }) as typeof helper.request;
    const { dictation } = build(helper);
    const sessions: DictationSession[] = [];
    dictation.on("session", (s) => sessions.push(s));
    await dictation.start();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: "Erster Satz Punkt" } });
    await tick();
    helper.flushOnStop = ["Zweiter Satz Punkt"];
    await dictation.stop();
    await tick();
    await tick();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ app: "Mail", target: "insert", text: "Erster Satz. Zweiter Satz." });
    expect(typeof sessions[0]?.startedAt).toBe("number");
  });

  it("meldet ein Diktat ohne Text nicht", async () => {
    const helper = new FakeHelper();
    const { dictation } = build(helper);
    const sessions: DictationSession[] = [];
    dictation.on("session", (s) => sessions.push(s));
    await dictation.start();
    await dictation.stop();
    await tick();
    expect(sessions).toEqual([]);
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

  it("lädt ein fehlendes Diktat-Modell und startet die Erkennung danach", async () => {
    const helper = new FakeHelper();
    helper.sttStatus = {
      available: false,
      engine: "analyzer",
      assets: "missing",
      downloadable: true,
      reason: "Diktat-Modell fehlt: Für „de-DE“ ist noch keines installiert.",
    };
    const { dictation } = build(helper);
    await dictation.start();
    const cmds = helper.calls.map((c) => c.cmd);
    expect(cmds.indexOf("stt.prepare")).toBeGreaterThanOrEqual(0);
    expect(cmds.indexOf("stt.prepare")).toBeLessThan(cmds.indexOf("stt.start"));
    expect(dictation.currentState).toBe("listening");
  });

  it("zeigt den Ladefortschritt und den Fehler, wenn das Modell nicht ankommt", async () => {
    const helper = new FakeHelper();
    helper.sttStatus = { available: false, engine: "analyzer", assets: "missing", downloadable: true, reason: "Diktat-Modell fehlt." };
    helper.prepareImpl = () => {
      helper.emitEvent({ event: "stt.progress", data: { locale: "de-DE", fraction: 0.42 } });
      throw new Error("Das Diktat-Modell für „de-DE“ konnte nicht geladen werden: keine Verbindung zu Apple (NSURLErrorDomain -1009).");
    };
    const { dictation, hud } = build(helper);
    await dictation.start();
    expect(helper.calls.find((c) => c.cmd === "stt.start")).toBeUndefined();
    expect(dictation.currentState).toBe("idle");
    const messages = hud.update.mock.calls.map((c) => c[0].message);
    expect(messages).toContain("Diktat-Modell wird geladen… 42 %");
    expect(messages.at(-1)).toMatch(/keine Verbindung zu Apple/);
  });

  it("lädt auf macOS 14/15 nicht selbst, sondern nennt die Systemeinstellung", async () => {
    const helper = new FakeHelper();
    helper.sttStatus = {
      available: false,
      engine: "legacy",
      assets: "missing",
      downloadable: false,
      reason: "Diktat-Modell fehlt: Bitte die Sprache unter Systemeinstellungen → Tastatur → Diktat hinzufügen.",
    };
    const { dictation } = build(helper);
    await dictation.start();
    expect(helper.calls.find((c) => c.cmd === "stt.prepare")).toBeUndefined();
    expect(helper.calls.find((c) => c.cmd === "stt.start")).toBeUndefined();
    expect(dictation.currentState).toBe("idle");
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

describe("Nachkorrektur, Diktat-Test und Wortschatz-Speicher (Phase 1, 0.4.0)", () => {
  it("korrigiert ein verhörtes Wort gegen den Wortschatz und fragt das Wörterbuch nur nach Tippfehler-Kandidaten", async () => {
    const helper = new FakeHelper();
    const { dictation } = build(helper);
    await dictation.start();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: "Hallo Tira, frag Lugas nach Proxmocks Punkt" } });
    await tick();
    await tick();
    const inserts = helper.calls.filter((c) => c.cmd === "text.insert").map((c) => c.params?.text);
    expect(inserts).toEqual(["Hallo KIRA, frag Lucas nach Proxmox."]);
    const asked = helper.calls.find((c) => c.cmd === "text.knownWords");
    expect(asked?.params).toEqual({ locale: "de-DE", words: ["Tira"] });
  });

  it("lässt ein Wort stehen, das das Wörterbuch kennt, und merkt sich die Antwort", async () => {
    const helper = new FakeHelper();
    helper.knownWords = ["Tira"];
    const { dictation } = build(helper);
    await dictation.start();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: "Tira kommt" } });
    await tick();
    await tick();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: "Tira geht" } });
    await tick();
    await tick();
    const inserts = helper.calls.filter((c) => c.cmd === "text.insert").map((c) => c.params?.text);
    expect(inserts).toEqual(["Tira kommt", " Tira geht"]);
    expect(helper.calls.filter((c) => c.cmd === "text.knownWords")).toHaveLength(1);
  });

  it("lässt sich abschalten", async () => {
    const helper = new FakeHelper();
    const { dictation } = build(helper, { correction: false });
    await dictation.start();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: "Hallo Tira" } });
    await tick();
    expect(helper.calls.filter((c) => c.cmd === "text.insert").map((c) => c.params?.text)).toEqual(["Hallo Tira"]);
    expect(helper.calls.some((c) => c.cmd === "text.knownWords")).toBe(false);
    expect(dictation.correctText("Hallo Tira")).toEqual({ text: "Hallo Tira", replacements: 0 });
  });

  it("wartet mit dem Ende auf eine laufende Wörterbuch-Frage, damit der letzte Satz nicht fehlt", async () => {
    const helper = new FakeHelper();
    let release = (): void => undefined;
    helper.knownWordsGate = new Promise<void>((r) => (release = r));
    const { dictation } = build(helper);
    const sessions: DictationSession[] = [];
    dictation.on("session", (s) => sessions.push(s));
    await dictation.start();
    helper.flushOnStop = ["Letzter Satz mit Tira"];
    await dictation.stop();
    await tick();
    await tick();
    expect(dictation.currentState).toBe("stopping");
    expect(sessions).toHaveLength(0);
    release();
    await tick();
    await tick();
    await tick();
    expect(dictation.currentState).toBe("idle");
    expect(sessions[0]?.text).toBe("Letzter Satz mit KIRA");
    expect(sessions[0]).toMatchObject({ finals: 1, replacements: 1 });
  });

  it("Ziel „test“: keine Pille, keine Bedienungshilfen nötig, Text geht in die Senke", async () => {
    const helper = new FakeHelper();
    helper.permissions = { ...helper.permissions, accessibility: false };
    const updates: Array<{ active: boolean; reason: string | null }> = [];
    const inserted: string[] = [];
    const sink: DictationSink = {
      update: (s) => updates.push({ active: s.active, reason: s.reason }),
      insert: (t) => inserted.push(t),
    };
    const { dictation, hud } = build(helper, { test: sink });
    const sessions: DictationSession[] = [];
    dictation.on("session", (s) => sessions.push(s));
    await dictation.start("test");
    expect(dictation.currentTarget).toBe("test");
    expect(hud.show).not.toHaveBeenCalled();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: "Hallo Tira Punkt" } });
    await tick();
    await tick();
    expect(inserted).toEqual(["Hallo KIRA."]);
    expect(helper.calls.some((c) => c.cmd === "text.insert")).toBe(false);
    await dictation.stop();
    await tick();
    await tick();
    expect(updates.at(-1)).toEqual({ active: false, reason: null });
    expect(sessions[0]).toMatchObject({ target: "test", app: "Diktat-Test", text: "Hallo KIRA." });
  });

  it("ohne Test-Senke fällt „test“ auf das Einsetzen zurück", async () => {
    const helper = new FakeHelper();
    const { dictation, hud } = build(helper);
    await dictation.start("test");
    expect(dictation.currentTarget).toBe("insert");
    expect(hud.show).toHaveBeenCalled();
  });

  it("Wortschatz-Speicher: speichert nach dem Holen, dient offline als Rückfall und meldet den Stand", async () => {
    const saved: StoredVocabulary[] = [];
    const store: VocabularyStore = { load: () => saved.at(-1) ?? null, save: (v) => void saved.push(v) };
    const online = build(new FakeHelper(), { vocabularyStore: store });
    expect(online.dictation.vocabularyInfo()).toBeNull();
    expect(await online.dictation.contextualStrings()).toEqual(["KIRA", "Lucas", "Musterfirma", "Proxmox"]);
    expect(saved).toHaveLength(1);
    expect(online.dictation.vocabularyInfo()).toMatchObject({ count: 4 });

    // Zweite Instanz, keine Sitzung (Server liefert null): der gespeicherte Stand gilt, auch wenn er alt ist.
    const offline = build(new FakeHelper(), { vocabularyStore: store, vocabulary: null, displayName: null });
    expect(await offline.dictation.contextualStrings()).toEqual(["KIRA", "Lucas", "Musterfirma", "Proxmox"]);
    expect(saved).toHaveLength(1);
    const helper = new FakeHelper();
    const offlineDictation = build(helper, { vocabularyStore: store, vocabulary: null, displayName: null }).dictation;
    await offlineDictation.start();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: "Gruß an Lugas" } });
    await tick();
    await tick();
    expect(helper.calls.filter((c) => c.cmd === "text.insert").map((c) => c.params?.text)).toEqual(["Gruß an Lucas"]);

    // Ohne Speicher und ohne Sitzung bleibt die Mindestliste.
    const bare = build(new FakeHelper(), { vocabulary: null, displayName: null });
    expect(await bare.dictation.contextualStrings()).toEqual(["KIRA"]);
  });

  it("protokolliert je Diktat Zähler und Zeiten, nie Text", async () => {
    const helper = new FakeHelper();
    const info = vi.fn<(message: string, ...meta: unknown[]) => void>();
    const log: Logger = { debug: () => undefined, info, warn: () => undefined, error: () => undefined };
    const { dictation } = build(helper, { log });
    await dictation.start();
    helper.emitEvent({ event: "stt.final", stream: "dictation", data: { text: "Hallo Tira Punkt" } });
    await tick();
    await tick();
    await dictation.stop();
    await tick();
    await tick();
    const entry = info.mock.calls.find((c) => c[0] === "dictation_session");
    expect(entry?.[1]).toMatchObject({ target: "insert", app: "Mail", locale: "de-DE", finals: 1, replacements: 1, failed: false, chars: 11 });
    expect(JSON.stringify(entry?.[1])).not.toContain("Hallo");
    expect(typeof (entry?.[1] as { flushMs: unknown }).flushMs).toBe("number");
  });
});

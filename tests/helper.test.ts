import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HelperClient, HelperError, type HelperProcess } from "../src/main/helper";
import { type HelperEvent } from "../src/shared/helper-types";

/** Gefälschter Kindprozess: sammelt stdin-Zeilen, lässt Antworten einspielen. */
class FakeProcess extends EventEmitter implements HelperProcess {
  readonly stdin: Writable;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly lines: Array<{ id: string; cmd: string; params?: Record<string, unknown> }> = [];
  pid = 4242;
  killed: string | number | undefined;

  constructor() {
    super();
    this.stdin = new Writable({
      write: (chunk: Buffer | string, _enc, cb) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim()) this.lines.push(JSON.parse(line));
        }
        cb();
      },
    });
    // info-Anfrage nach dem Start automatisch beantworten
    this.stdin.on("finish", () => undefined);
  }

  reply(id: string, result: unknown): void {
    this.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
  }

  fail(id: string, code: string, message?: string): void {
    this.stdout.write(`${JSON.stringify({ id, ok: false, error: { code, message } })}\n`);
  }

  event(event: string, stream: string | undefined, data: unknown): void {
    this.stdout.write(`${JSON.stringify({ event, stream, data })}\n`);
  }

  raw(text: string): void {
    this.stdout.write(text);
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = signal ?? "SIGTERM";
    return true;
  }

  exit(code: number | null = 1): void {
    this.emit("exit", code, null);
  }

  /** Letzte Anfrage mit diesem Kommando. */
  last(cmd: string): { id: string; cmd: string; params?: Record<string, unknown> } {
    const found = [...this.lines].reverse().find((l) => l.cmd === cmd);
    if (!found) throw new Error(`keine Anfrage ${cmd}`);
    return found;
  }
}

const INFO = {
  protocol: 1,
  version: "0.1.0",
  macos: "27.0.1",
  chip: "Apple M3",
  features: { stt: true, sttStream: true, llm: false, systemAudio: true, insertText: true },
  locales: ["de-DE", "en-US"],
};

async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("HelperClient", () => {
  let procs: FakeProcess[];
  let client: HelperClient;

  beforeEach(() => {
    procs = [];
    client = new HelperClient({
      binaryPath: "/fake/kira-helper",
      spawn: () => {
        const p = new FakeProcess();
        procs.push(p);
        return p;
      },
      backoffMs: [10, 20, 50],
      defaultTimeoutMs: 100,
      healthyAfterMs: 10_000,
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await client.stop();
  });

  it("startet, fragt info ab und meldet die Fähigkeiten", async () => {
    const infoEvent = vi.fn();
    client.on("info", infoEvent);
    client.start();
    await flush();
    const p = procs[0]!;
    expect(p.lines[0]).toMatchObject({ cmd: "info" });
    p.reply(p.lines[0]!.id, INFO);
    await flush();
    expect(client.info?.features.stt).toBe(true);
    expect(infoEvent).toHaveBeenCalledOnce();
    expect(client.running).toBe(true);
  });

  it("ordnet Antworten nach id zu, auch in anderer Reihenfolge", async () => {
    client.start();
    await flush();
    const p = procs[0]!;
    const a = client.request<{ pong: boolean }>("ping");
    const b = client.request<{ text: string }>("stt.file", { path: "/tmp/x.wav", locale: "de-DE" });
    await flush();
    const reqA = p.last("ping");
    const reqB = p.last("stt.file");
    expect(reqB.params).toEqual({ path: "/tmp/x.wav", locale: "de-DE" });
    p.reply(reqB.id, { text: "Hallo", durationMs: 10, engine: "apple" });
    p.reply(reqA.id, { pong: true });
    await expect(b).resolves.toEqual({ text: "Hallo", durationMs: 10, engine: "apple" });
    await expect(a).resolves.toEqual({ pong: true });
  });

  it("gibt Fehlercodes des Helfers als HelperError weiter", async () => {
    client.start();
    await flush();
    const p = procs[0]!;
    const r = client.request("stt.start", { stream: "s1" });
    await flush();
    p.fail(p.last("stt.start").id, "stt_unavailable", "Keine Spracherkennung.");
    await expect(r).rejects.toMatchObject({ name: "HelperError", code: "stt_unavailable", message: "Keine Spracherkennung." });
  });

  it("hält das Zeitlimit je Anfrage ein", async () => {
    client.start();
    await flush();
    const r = client.request("ping", undefined, 20);
    await expect(r).rejects.toMatchObject({ code: "timeout" });
  });

  it("reicht Ereignisse mit stream und data durch", async () => {
    client.start();
    await flush();
    const events: HelperEvent[] = [];
    client.on("event", (ev) => events.push(ev));
    const p = procs[0]!;
    p.event("stt.partial", "s1", { text: "Hal" });
    p.event("stt.level", "s1", { rms: 0.4 });
    await flush();
    expect(events).toEqual([
      { event: "stt.partial", stream: "s1", data: { text: "Hal" } },
      { event: "stt.level", stream: "s1", data: { rms: 0.4 } },
    ]);
  });

  it("überlebt kaputte Zeilen und zerstückelte Zeilen auf stdout", async () => {
    client.start();
    await flush();
    const p = procs[0]!;
    const events: HelperEvent[] = [];
    client.on("event", (ev) => events.push(ev));
    p.raw("kein json\n");
    p.raw('{"event":"stt.fin');
    p.raw('al","stream":"s1","data":{"text":"Ende."}}\n');
    await flush();
    expect(events).toEqual([{ event: "stt.final", stream: "s1", data: { text: "Ende." } }]);
  });

  it("lehnt offene Anfragen bei einem Absturz mit helper_restarted ab und startet neu", async () => {
    vi.useFakeTimers();
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    const p = procs[0]!;
    const pending = client.request("stt.file", { path: "/tmp/x.wav" });
    await vi.advanceTimersByTimeAsync(0);
    p.exit(137);
    await expect(pending).rejects.toMatchObject({ code: "helper_restarted" });
    expect(client.running).toBe(false);
    // Backoff 10 ms → zweiter Prozess
    await vi.advanceTimersByTimeAsync(9);
    expect(procs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(procs).toHaveLength(2);
    expect(client.running).toBe(true);
    // zweiter Absturz → 20 ms
    procs[1]!.exit(1);
    await vi.advanceTimersByTimeAsync(19);
    expect(procs).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2);
    expect(procs).toHaveLength(3);
  });

  it("verweigert Anfragen ohne laufenden Prozess", async () => {
    await expect(client.request("ping")).rejects.toBeInstanceOf(HelperError);
    await expect(client.request("ping")).rejects.toMatchObject({ code: "helper_unavailable" });
  });

  it("stop schickt shutdown und startet nicht neu", async () => {
    client.start();
    await flush();
    const p = procs[0]!;
    const stopping = client.stop();
    await flush();
    const req = p.last("shutdown");
    p.reply(req.id, { ok: true });
    p.exit(0);
    await stopping;
    await flush();
    expect(procs).toHaveLength(1);
    expect(client.running).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { type SseMessage, SseParser, pumpSseStream } from "../src/main/sse";

function collect(parser: SseParser): { messages: SseMessage[]; comments: string[] } {
  const messages: SseMessage[] = [];
  const comments: string[] = [];
  parser.onMessage((m) => messages.push(m));
  parser.onComment((c) => comments.push(c));
  return { messages, comments };
}

describe("SseParser", () => {
  it("liefert ein einfaches Ereignis mit Standardnamen", () => {
    const p = new SseParser();
    const { messages } = collect(p);
    p.feed("data: hallo\n\n");
    expect(messages).toEqual([{ event: "message", data: "hallo", id: null, retry: null }]);
  });

  it("erkennt event-, id- und retry-Felder", () => {
    const p = new SseParser();
    const { messages } = collect(p);
    p.feed("event: notification\nid: 7\nretry: 3000\ndata: {\"title\":\"KIRA\"}\n\n");
    expect(messages[0]).toEqual({ event: "notification", data: '{"title":"KIRA"}', id: "7", retry: 3000 });
    // id bleibt für Folge-Ereignisse erhalten, event wird zurückgesetzt
    p.feed("data: x\n\n");
    expect(messages[1]).toMatchObject({ event: "message", id: "7" });
  });

  it("fügt mehrzeilige data mit \\n zusammen", () => {
    const p = new SseParser();
    const { messages } = collect(p);
    p.feed("data: zeile 1\ndata: zeile 2\ndata:\n\n");
    expect(messages[0]?.data).toBe("zeile 1\nzeile 2\n");
  });

  it("meldet Kommentarzeilen (Server-Ping) ohne ein Ereignis auszulösen", () => {
    const p = new SseParser();
    const { messages, comments } = collect(p);
    p.feed(": ping\n\n");
    p.feed(":keepalive\n");
    expect(comments).toEqual(["ping", "keepalive"]);
    expect(messages).toEqual([]);
  });

  it("verträgt Fragmentierung über Chunk-Grenzen", () => {
    const p = new SseParser();
    const { messages } = collect(p);
    const full = "event: notification\ndata: {\"body\":\"ab\"}\n\n";
    for (const ch of full) p.feed(ch);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ event: "notification", data: '{"body":"ab"}' });
  });

  it("verarbeitet CRLF, CR und ein über Chunks zerrissenes CRLF", () => {
    const p = new SseParser();
    const { messages } = collect(p);
    p.feed("data: eins\r\n\r\n");
    p.feed("data: zwei\r\r");
    p.feed("data: drei\r");
    p.feed("\n\r\n");
    expect(messages.map((m) => m.data)).toEqual(["eins", "zwei", "drei"]);
  });

  it("entfernt genau ein Leerzeichen nach dem Doppelpunkt und ignoriert unbekannte Felder", () => {
    const p = new SseParser();
    const { messages } = collect(p);
    p.feed("data:  zwei leerzeichen\nfoo: bar\n\n");
    expect(messages[0]?.data).toBe(" zwei leerzeichen");
  });

  it("verwirft leere Blöcke und ein unvollständiges Ereignis am Stream-Ende", () => {
    const p = new SseParser();
    const { messages } = collect(p);
    p.feed("\n\n\nevent: x\n\n");
    p.feed("data: offen");
    p.end();
    expect(messages).toEqual([]);
  });

  it("entfernt eine BOM am Anfang", () => {
    const p = new SseParser();
    const { messages } = collect(p);
    p.feed("﻿data: a\n\n");
    expect(messages[0]?.data).toBe("a");
  });
});

describe("pumpSseStream", () => {
  it("dekodiert UTF-8 über Chunk-Grenzen", async () => {
    const encoded = new TextEncoder().encode("data: Grüße aus Köln\n\n");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 9)); // mitten im „ü“
        controller.enqueue(encoded.slice(9));
        controller.close();
      },
    });
    const p = new SseParser();
    const { messages } = collect(p);
    await pumpSseStream(stream, p);
    expect(messages[0]?.data).toBe("Grüße aus Köln");
  });

  it("bricht bei einem Abort-Signal ab", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise(() => undefined);
      },
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    const p = new SseParser();
    const run = pumpSseStream(stream, p, controller.signal);
    controller.abort();
    await run;
    expect(cancelled).toBe(true);
  });
});

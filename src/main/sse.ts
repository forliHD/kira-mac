// Reiner Server-Sent-Events-Parser nach der WHATWG-Spezifikation
// (EventSource, „Interpreting an event stream“). Kein Netz, kein Electron –
// tests/sse.test.ts prüft Kommentarzeilen, mehrzeilige `data`, Fragmentierung
// über Chunk-Grenzen und alle drei Zeilenenden.

export interface SseMessage {
  event: string; // Standard "message"
  data: string;
  id: string | null;
  retry: number | null;
}

export type SseMessageListener = (message: SseMessage) => void;
export type SseCommentListener = (comment: string) => void;

export class SseParser {
  private buffer = "";
  private dataLines: string[] = [];
  private eventName = "";
  private lastId: string | null = null;
  private retry: number | null = null;
  private sawFirstChunk = false;
  private messageListeners: SseMessageListener[] = [];
  private commentListeners: SseCommentListener[] = [];

  onMessage(listener: SseMessageListener): () => void {
    this.messageListeners.push(listener);
    return () => {
      this.messageListeners = this.messageListeners.filter((l) => l !== listener);
    };
  }

  /** Kommentarzeilen (`: ping`) – der Server schickt sie alle 25 s als Lebenszeichen. */
  onComment(listener: SseCommentListener): () => void {
    this.commentListeners.push(listener);
    return () => {
      this.commentListeners = this.commentListeners.filter((l) => l !== listener);
    };
  }

  /** Nimmt beliebige Textstücke entgegen; Zeilen dürfen über Stücke hinweg zerbrochen sein. */
  feed(chunk: string): void {
    if (!chunk) return;
    if (!this.sawFirstChunk) {
      this.sawFirstChunk = true;
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1); // BOM
    }
    this.buffer += chunk;
    // Ein einzelnes abschließendes "\r" könnte der Anfang von "\r\n" sein –
    // es bleibt bis zum nächsten Stück im Puffer.
    let start = 0;
    for (;;) {
      const idx = findLineEnd(this.buffer, start);
      if (idx === -1) break;
      const line = this.buffer.slice(start, idx);
      let next = idx + 1;
      if (this.buffer[idx] === "\r") {
        if (idx + 1 >= this.buffer.length) break; // "\r" am Ende – auf "\n" warten
        if (this.buffer[idx + 1] === "\n") next = idx + 2;
      }
      this.handleLine(line);
      start = next;
    }
    this.buffer = this.buffer.slice(start);
  }

  /** Stream zu Ende: ein unvollständiges letztes Ereignis wird laut Spezifikation verworfen. */
  end(): void {
    if (this.buffer.length) {
      // Letzte Zeile ohne Zeilenende: verarbeiten, dann wie die Spezifikation
      // den offenen Block verwerfen.
      const line = this.buffer.replace(/\r$/, "");
      this.buffer = "";
      if (line) this.handleLine(line);
    }
    this.dataLines = [];
    this.eventName = "";
  }

  private handleLine(line: string): void {
    if (line === "") {
      this.dispatch();
      return;
    }
    if (line.startsWith(":")) {
      const comment = line.slice(1).replace(/^ /, "");
      for (const l of this.commentListeners) l(comment);
      return;
    }
    const colon = line.indexOf(":");
    let field: string;
    let value: string;
    if (colon === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
    }
    switch (field) {
      case "event":
        this.eventName = value;
        break;
      case "data":
        this.dataLines.push(value);
        break;
      case "id":
        if (!value.includes("\u0000")) this.lastId = value;
        break;
      case "retry": {
        if (/^\d+$/.test(value)) this.retry = Number.parseInt(value, 10);
        break;
      }
      default:
        // Unbekannte Felder werden ignoriert (Spezifikation).
        break;
    }
  }

  private dispatch(): void {
    if (this.dataLines.length === 0) {
      this.eventName = "";
      return;
    }
    const message: SseMessage = {
      event: this.eventName || "message",
      data: this.dataLines.join("\n"),
      id: this.lastId,
      retry: this.retry,
    };
    this.dataLines = [];
    this.eventName = "";
    for (const l of this.messageListeners) l(message);
  }
}

function findLineEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "\n" || c === "\r") return i;
  }
  return -1;
}

/**
 * Liest einen Byte-Stream (`Response.body`) in den Parser. Löst auf, wenn der
 * Stream endet; wirft, wenn das Lesen fehlschlägt oder `signal` abbricht.
 */
export async function pumpSseStream(
  body: ReadableStream<Uint8Array>,
  parser: SseParser,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  const abort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) parser.feed(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) parser.feed(tail);
    parser.end();
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

import { describe, expect, it, vi } from "vitest";

import { type QuickChatDeps, QuickChat, REASONING_MAX_CHARS, REASONING_MAX_STEPS, appendReasoning, buildLocalPrompt, localReason, toolLabel } from "../src/main/quick-chat";
import { type QuickMessage, type QuickState } from "../src/shared/local-api";

// Schnellfenster-Gespräch: Frames des KIRA-Servers (POST /api/chat/stream),
// Fehlerpfade, Stopp, neues Gespräch und das Notlicht über das Apple-Modell.

function sseResponse(frames: string[], status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(`data: ${f}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

function deps(over: Partial<QuickChatDeps> = {}): QuickChatDeps {
  return {
    server: { streamChat: vi.fn(async () => sseResponse(["[DONE]"])) },
    local: { status: vi.fn(async () => ({ available: true, reason: null })), stream: vi.fn(async () => "lokal") },
    connection: () => ({ online: true, label: "kira.example.de" }),
    hotkeys: () => ({ quickWindow: "Alt+Space", dictation: "Control+Alt+D" }),
    schedule: (fn) => fn(),
    ...over,
  };
}

function last(state: QuickState): QuickMessage {
  const m = state.messages[state.messages.length - 1];
  if (!m) throw new Error("keine Nachricht");
  return m;
}

describe("toolLabel / localReason", () => {
  it("beschreibt Werkzeuge auf Deutsch, mit Präfix-Regeln und Rückfall", () => {
    expect(toolLabel("mail_search")).toBe("Durchsucht das Postfach");
    expect(toolLabel("tool_web_search")).toBe("Sucht im Web");
    expect(toolLabel("browser_navigate")).toBe("Arbeitet im KI-Browser");
    expect(toolLabel("sandbox_run")).toBe("Arbeitet in der Sandbox");
    expect(toolLabel("irgendwas")).toBe("Nutzt „irgendwas“");
  });

  it("übersetzt die Gründe des Apple-Modells", () => {
    expect(localReason("appleIntelligenceNotEnabled")).toBe("Apple Intelligence ist ausgeschaltet");
    expect(localReason(null)).toBeNull();
    expect(localReason("neuer_code")).toBe("neuer_code");
  });
});

describe("buildLocalPrompt", () => {
  const msg = (role: "user" | "assistant", text: string, status: QuickMessage["status"] = "done"): QuickMessage => ({
    id: Math.random().toString(36),
    role,
    text,
    status,
    tools: [],
    activity: null,
    reasoning: [],
    local: false,
    error: null,
  });

  it("setzt die Wechsel in Reihenfolge und endet mit „KIRA:“", () => {
    const p = buildLocalPrompt([msg("user", "Hallo"), msg("assistant", "Hi!"), msg("user", "Wie spät?")]);
    expect(p).toBe("Nutzer: Hallo\nKIRA: Hi!\nNutzer: Wie spät?\nKIRA:");
  });

  it("lässt laufende Antworten weg und kürzt alte Wechsel zuerst", () => {
    const p = buildLocalPrompt([msg("user", "a".repeat(50)), msg("assistant", "läuft", "streaming"), msg("user", "Neu")], 20);
    expect(p).toBe("Nutzer: Neu\nKIRA:");
  });
});

describe("QuickChat – Server", () => {
  it("verarbeitet start, thinking, Werkzeug und Antwort", async () => {
    const streamChat = vi.fn(async () =>
      sseResponse([
        JSON.stringify({ type: "start", session_id: 42 }),
        JSON.stringify({ type: "thinking", message: "Denke nach…" }),
        JSON.stringify({ type: "tool_call", tool: "mail_search", args: { query: "Weber" } }),
        JSON.stringify({ type: "tool_call", tool: "inner_thought", args: { thought: "x" } }),
        JSON.stringify({ type: "tool_result", tool: "mail_search", result: "3 Treffer" }),
        JSON.stringify({ type: "response", message: "Drei Mails von **Frau Weber**." }),
        JSON.stringify({ type: "message_persisted", id: 7 }),
        "[DONE]",
      ]),
    );
    const chat = new QuickChat(deps({ server: { streamChat } }));
    const states: QuickState[] = [];
    chat.on("state", (s) => states.push(s));
    await chat.send("  Fasse die Mails zusammen  ");

    expect(streamChat).toHaveBeenCalledWith({ message: "Fasse die Mails zusammen" }, expect.any(AbortSignal));
    const s = chat.getState();
    expect(s.sessionId).toBe(42);
    expect(s.busy).toBe(false);
    expect(s.mode).toBe("server");
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    const a = last(s);
    expect(a).toMatchObject({ text: "Drei Mails von **Frau Weber**.", status: "done", activity: null, local: false });
    expect(a.tools).toEqual([{ name: "mail_search", label: "Durchsucht das Postfach", status: "done" }]);
    // Unterwegs war die Aktivität sichtbar.
    expect(states.some((st) => last(st).activity === "Durchsucht das Postfach…")).toBe(true);
    // Denkschritte (thinking + inner_thought) bleiben für das eingeklappte „Nachgedacht“;
    // die Statuszeile „Denke nach…“ des Servers ist kein Schritt (Live 02.10.2026).
    expect(a.reasoning).toEqual(["x"]);
  });

  it("begrenzt Denkschritte und überspringt Wiederholungen", () => {
    expect(appendReasoning(["a"], "a")).toEqual(["a"]);
    expect(appendReasoning([], "Denke nach…")).toEqual([]);
    expect(appendReasoning([], "Denkt nach...")).toEqual([]);
    expect(appendReasoning([], "Denke nach, ob days=1 reicht")).toEqual(["Denke nach, ob days=1 reicht"]);
    expect(appendReasoning(["a"], "b")).toEqual(["a", "b"]);
    const many = Array.from({ length: REASONING_MAX_STEPS }, (_, i) => `s${i}`);
    expect(appendReasoning(many, "neu")).toHaveLength(REASONING_MAX_STEPS);
    expect(appendReasoning(many, "neu").at(-1)).toBe("neu");
    expect(appendReasoning([], "x".repeat(REASONING_MAX_CHARS + 50)).at(0)).toHaveLength(REASONING_MAX_CHARS + 1);
  });

  it("schickt ab dem zweiten Zug die Sitzung mit", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce(sseResponse([JSON.stringify({ type: "start", session_id: 9 }), JSON.stringify({ type: "response", message: "Eins" })]))
      .mockResolvedValueOnce(sseResponse([JSON.stringify({ type: "start", session_id: 9 }), JSON.stringify({ type: "response", message: "Zwei" })]));
    const chat = new QuickChat(deps({ server: { streamChat } }));
    await chat.send("A");
    await chat.send("B");
    expect(streamChat.mock.calls[1]?.[0]).toEqual({ message: "B", session_id: 9 });
    expect(chat.getState().messages.map((m) => m.text)).toEqual(["A", "Eins", "B", "Zwei"]);
  });

  it("zeigt Server-Fehler und abgelaufene Sitzungen", async () => {
    const chat = new QuickChat(
      deps({ server: { streamChat: async () => sseResponse([JSON.stringify({ type: "error", message: "Stream error: kaputt" })]) } }),
    );
    await chat.send("x");
    expect(last(chat.getState())).toMatchObject({ status: "error", error: "Stream error: kaputt" });

    const chat2 = new QuickChat(
      deps({ server: { streamChat: async () => sseResponse([JSON.stringify({ type: "error", code: "session_ended", message: "…" })]) } }),
    );
    await chat2.send("x");
    expect(last(chat2.getState()).error).toBe("Sitzung beendet – bitte im Hauptfenster neu anmelden.");
  });

  it("übersetzt HTTP-Fehler", async () => {
    const chat = new QuickChat(deps({ server: { streamChat: async () => new Response("{}", { status: 401 }) } }));
    await chat.send("x");
    expect(last(chat.getState()).error).toBe("Nicht angemeldet – bitte im Hauptfenster bei KIRA anmelden.");

    const chat2 = new QuickChat(
      deps({ server: { streamChat: async () => new Response(JSON.stringify({ detail: "Limit 5 €" }), { status: 402 }) } }),
    );
    await chat2.send("x");
    expect(last(chat2.getState()).error).toBe("Budget erreicht: Limit 5 €");
  });

  it("meldet Netzfehler und bittet um eine neue Verbindungsprüfung", async () => {
    const onNetworkError = vi.fn();
    const chat = new QuickChat(
      deps({
        onNetworkError,
        server: {
          streamChat: async () => {
            throw new Error("ECONNREFUSED");
          },
        },
      }),
    );
    await chat.send("x");
    expect(onNetworkError).toHaveBeenCalledTimes(1);
    expect(last(chat.getState()).error).toBe("Keine Verbindung zum KIRA-Server: ECONNREFUSED");
  });

  it("bricht ab, ohne die Antwort als Fehler zu werten", async () => {
    let release: (() => void) | null = null;
    const streamChat = vi.fn(
      (_body: Record<string, unknown>, signal: AbortSignal) =>
        new Promise<Response>((resolve, reject) => {
          release = () => resolve(sseResponse(["[DONE]"]));
          signal.addEventListener("abort", () => reject(new DOMException("abgebrochen", "AbortError")));
        }),
    );
    const chat = new QuickChat(deps({ server: { streamChat } }));
    const running = chat.send("lange Aufgabe");
    expect(chat.getState().busy).toBe(true);
    await chat.stop();
    await running;
    expect(release).not.toBeNull();
    const a = last(chat.getState());
    expect(a.status).toBe("stopped");
    expect(chat.getState().busy).toBe(false);
  });

  it("endet der Stream ohne Antwort, sagt es das ehrlich", async () => {
    const chat = new QuickChat(deps({ server: { streamChat: async () => sseResponse([JSON.stringify({ type: "start", session_id: 1 })]) } }));
    await chat.send("x");
    expect(last(chat.getState()).error).toContain("Die Verbindung brach ab");
  });

  it("neues Gespräch leert Verlauf und Sitzung", async () => {
    const chat = new QuickChat(
      deps({ server: { streamChat: async () => sseResponse([JSON.stringify({ type: "start", session_id: 5 }), JSON.stringify({ type: "response", message: "ok" })]) } }),
    );
    await chat.send("x");
    chat.reset();
    expect(chat.getState()).toMatchObject({ sessionId: null, messages: [] });
  });
});

describe("QuickChat – ohne Verbindung (Apple-Modell)", () => {
  it("antwortet lokal, gekennzeichnet und mit Zwischenständen", async () => {
    const stream = vi.fn(async (_p: string, _i: string, onText: (t: string) => void) => {
      onText("Hal");
      onText("Hallo!");
      return "Hallo!";
    });
    const chat = new QuickChat(deps({ connection: () => ({ online: false, label: "kira" }), local: { status: async () => ({ available: true, reason: null }), stream } }));
    const texts: string[] = [];
    chat.on("state", (s) => texts.push(last(s).text));
    await chat.send("Sag hallo");
    expect(stream.mock.calls[0]?.[0]).toBe("Nutzer: Sag hallo\nKIRA:");
    expect(last(chat.getState())).toMatchObject({ text: "Hallo!", status: "done", local: true });
    expect(texts).toContain("Hal");
    expect(chat.getState().mode).toBe("local");
  });

  it("ohne Apple-Modell eine klare Meldung mit Grund", async () => {
    const chat = new QuickChat(
      deps({
        connection: () => ({ online: false, label: "kira" }),
        local: { status: async () => ({ available: false, reason: "Apple Intelligence ist ausgeschaltet" }), stream: vi.fn() },
      }),
    );
    await chat.send("x");
    expect(last(chat.getState()).error).toBe(
      "Keine Verbindung zum KIRA-Server – und das Apple-Sprachmodell ist auf diesem Mac nicht verfügbar (Apple Intelligence ist ausgeschaltet).",
    );
    expect(chat.getState().mode).toBe("offline");
  });
});

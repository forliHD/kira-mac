// Schnellfenster-Gespräch (nativer Mini-Chat): führt den Zug über
// `POST /api/chat/stream` der Instanz und meldet der Seite nur `QuickState`.
// Ohne Verbindung antwortet das Apple-Sprachmodell auf diesem Mac (Notlicht,
// über den Swift-Helfer) – klar gekennzeichnet und nicht gespeichert.
//
// Kein Electron-Import: Server, lokales Modell und Takt werden injiziert
// (tests/quick-chat.test.ts). Frames des Servers (siehe
// dashboard/src/pages/ChatPage.jsx): start, thinking, tool_call, tool_result,
// tool_pending, response_delta (nur Sprachmodus), response, error,
// message_persisted, memory, ping, „[DONE]“.

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { type HotkeyConfig, type QuickDictation, type QuickMessage, type QuickState, type QuickTool } from "../shared/local-api";
import { type Logger, silentLogger } from "../shared/logger";
import { SseParser, pumpSseStream } from "./sse";

export interface QuickChatServer {
  /** `POST /api/chat/stream` mit JSON-Körper; liefert die Antwort mit SSE-Körper. */
  streamChat(body: Record<string, unknown>, signal: AbortSignal): Promise<Response>;
}

export interface QuickChatLocalModel {
  status(): Promise<{ available: boolean; reason: string | null }>;
  /** Streamt eine Antwort; `onText` bekommt den bisher erzeugten Gesamttext. */
  stream(prompt: string, instructions: string, onText: (text: string) => void, signal: AbortSignal): Promise<string>;
}

export interface QuickChatDeps {
  server: QuickChatServer;
  local: QuickChatLocalModel;
  connection: () => { online: boolean; label: string };
  hotkeys: () => HotkeyConfig;
  /** Netzfehler beim Senden: die Hülle prüft die Verbindung neu. */
  onNetworkError?: () => void;
  log?: Logger;
  /** Bündelt Zustandsmeldungen (Standard: ein Takt von 16 ms). */
  schedule?: (fn: () => void) => void;
  now?: () => number;
}

export interface QuickChatEvents {
  state: [QuickState];
}

export const LOCAL_INSTRUCTIONS = [
  "Du bist KIRA, ein hilfreicher persönlicher Assistent.",
  "Gerade besteht KEINE Verbindung zum KIRA-Server: Du läufst lokal auf diesem Mac (Apple-Sprachmodell).",
  "Du hast keinen Zugriff auf Mails, Kalender, Aufgaben, Dokumente, das Web oder frühere Gespräche.",
  "Antworte kurz, freundlich und auf Deutsch. Braucht die Frage solche Daten, sag ehrlich, dass das erst wieder mit Verbindung zum KIRA-Server geht, und hilf mit dem, was ohne geht (formulieren, kürzen, übersetzen, erklären).",
].join(" ");

/** Etwa 6.000 Zeichen Verlauf – das Apple-Modell hat ein kleines Kontextfenster (4.096 Token). */
const LOCAL_CONTEXT_CHARS = 6_000;
const LOCAL_STATUS_TTL_MS = 60_000;

const TOOL_LABELS: Record<string, string> = {
  web_search: "Sucht im Web",
  web_search_research: "Recherchiert im Web",
  fetch_page: "Liest eine Webseite",
  web_scrape: "Liest eine Webseite",
  web_watch: "Beobachtet eine Webseite",
  image_search: "Sucht Bilder",
  deep_research: "Startet eine Recherche",
  weather: "Holt das Wetter",
  public_transport: "Prüft Verbindungen",
  traffic: "Prüft den Verkehr",
  calculate: "Rechnet",
  entity_lookup: "Schlägt nach",
  mail_search: "Durchsucht das Postfach",
  mail_read: "Liest eine Mail",
  check_mail: "Prüft neue Mails",
  email_filter: "Sichtet Mails",
  email_parse: "Liest Mails",
  mail_compose_draft: "Schreibt einen Entwurf",
  mail_draft_reply: "Schreibt eine Antwort",
  mail_send: "Sendet eine Mail",
  send_mail: "Sendet eine Mail",
  mail_task: "Arbeitet im Postfach",
  calendar_list_events: "Schaut in den Kalender",
  get_events: "Schaut in den Kalender",
  calendar_create_event: "Trägt einen Termin ein",
  todo_list: "Prüft Aufgaben",
  todo_create: "Legt eine Aufgabe an",
  todo_update: "Aktualisiert eine Aufgabe",
  todo_delete: "Entfernt eine Aufgabe",
  contact_search: "Sucht im Adressbuch",
  document_search: "Durchsucht Dokumente",
  document_read: "Liest ein Dokument",
  document_list: "Sichtet Dokumente",
  document_create: "Erstellt ein Dokument",
  document_edit: "Bearbeitet ein Dokument",
  document_task: "Arbeitet an einem Dokument",
  notebook_search: "Durchsucht das Notizbuch",
  search_paperless: "Durchsucht das Archiv",
  archival_memory_search: "Erinnert sich",
  conversation_search: "Durchsucht frühere Gespräche",
  core_memory_read: "Erinnert sich",
  archival_memory_save: "Merkt sich etwas",
  core_memory_append: "Merkt sich etwas",
  core_memory_update: "Merkt sich etwas",
  pdf_create: "Erstellt ein PDF",
  word_create: "Erstellt ein Word-Dokument",
  excel_create: "Erstellt eine Tabelle",
  pptx_create: "Erstellt eine Präsentation",
  pdf_read: "Liest ein PDF",
  word_read: "Liest ein Dokument",
  excel_read: "Liest eine Tabelle",
  pptx_read: "Liest eine Präsentation",
  template_fill: "Füllt eine Vorlage",
  send_file: "Sendet eine Datei",
  send_photo: "Sendet ein Bild",
  coding_task: "Programmiert in der Sandbox",
  update_plan: "Plant die Schritte",
  pipeline_draft: "Entwirft einen Ablauf",
  system_health: "Prüft das System",
  system_usage: "Prüft das System",
  disk_usage: "Prüft den Speicher",
  docker_status: "Prüft die Container",
  http_request: "Fragt einen Dienst ab",
};

/** Höchstens so viele Denkschritte je Antwort, je Schritt höchstens so viele Zeichen. */
export const REASONING_MAX_STEPS = 40;
export const REASONING_MAX_CHARS = 2_000;

/** Statuszeilen des Servers („Denke nach…“) sind kein Denkschritt. */
const REASONING_PLACEHOLDER = /^(denke|denkt|überlege|überlegt)( kurz)? nach\s*(…|\.{3})?$/i;

/** Denkschritt anhängen (begrenzt; ein wiederholter letzter Schritt zählt nicht doppelt). */
export function appendReasoning(steps: readonly string[], step: string): string[] {
  if (REASONING_PLACEHOLDER.test(step.trim())) return [...steps];
  const clipped = step.length > REASONING_MAX_CHARS ? `${step.slice(0, REASONING_MAX_CHARS)}…` : step;
  if (steps[steps.length - 1] === clipped) return [...steps];
  return [...steps, clipped].slice(-REASONING_MAX_STEPS);
}

/** Deutsche Beschreibung eines Werkzeugs für die Aktivitätszeile. */
export function toolLabel(name: string): string {
  const key = name.replace(/^tool_/, "");
  if (TOOL_LABELS[key]) return TOOL_LABELS[key];
  if (key.startsWith("browser_")) return "Arbeitet im KI-Browser";
  if (key.startsWith("sandbox_")) return "Arbeitet in der Sandbox";
  if (key.startsWith("document_")) return "Arbeitet an Dokumenten";
  if (key.startsWith("mail_") || key.startsWith("email_")) return "Arbeitet im Postfach";
  return `Nutzt „${key}“`;
}

/** Gründe des Apple-Modells (Helfer `llm.status`) als deutscher Halbsatz. */
export function localReason(code: string | null | undefined): string | null {
  switch (code) {
    case null:
    case undefined:
    case "":
      return null;
    case "appleIntelligenceNotEnabled":
      return "Apple Intelligence ist ausgeschaltet";
    case "deviceNotEligible":
      return "dieser Mac unterstützt Apple Intelligence nicht";
    case "modelNotReady":
      return "das Apple-Modell wird noch geladen";
    case "unsupportedOS":
      return "dafür braucht es macOS 26 oder neuer";
    default:
      return code;
  }
}

/** Verlauf für das lokale Modell: die letzten Wechsel, gekürzt, neueste Frage zuletzt. */
export function buildLocalPrompt(messages: QuickMessage[], maxChars = LOCAL_CONTEXT_CHARS): string {
  const turns: string[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || (m.role === "assistant" && (!m.text || m.status === "streaming"))) continue;
    const line = `${m.role === "user" ? "Nutzer" : "KIRA"}: ${m.text.trim()}`;
    if (used + line.length > maxChars) {
      if (turns.length === 0) turns.unshift(line.slice(-maxChars));
      break;
    }
    turns.unshift(line);
    used += line.length + 1;
  }
  return `${turns.join("\n")}\nKIRA:`;
}

function newMessage(role: QuickMessage["role"], text: string): QuickMessage {
  return { id: randomUUID(), role, text, status: role === "user" ? "done" : "streaming", tools: [], activity: null, reasoning: [], local: false, error: null };
}

function settleTools(tools: QuickTool[], status: QuickTool["status"] = "done"): QuickTool[] {
  return tools.map((t) => (t.status === "running" ? { ...t, status } : t));
}

export class QuickChat extends EventEmitter<QuickChatEvents> {
  private readonly deps: QuickChatDeps;
  private readonly log: Logger;
  private messages: QuickMessage[] = [];
  private session: number | null = null;
  private abort: AbortController | null = null;
  private pending = false;
  private dictation: QuickDictation = { available: false, active: false, level: 0, partial: "", reason: null };
  private localStatusCache: { at: number; available: boolean; reason: string | null } | null = null;

  constructor(deps: QuickChatDeps) {
    super();
    this.deps = deps;
    this.log = deps.log ?? silentLogger;
  }

  get sessionId(): number | null {
    return this.session;
  }

  get busy(): boolean {
    return this.abort !== null;
  }

  getState(): QuickState {
    const conn = this.deps.connection();
    const localOk = this.localStatusCache?.available ?? false;
    return {
      sessionId: this.session,
      messages: this.messages.map((m) => ({ ...m, tools: m.tools.map((t) => ({ ...t })) })),
      busy: this.busy,
      mode: conn.online ? "server" : localOk ? "local" : "offline",
      connection: conn,
      dictation: { ...this.dictation },
      hotkeys: this.deps.hotkeys(),
    };
  }

  /** Verbindung oder Kürzel haben sich geändert – Seite auffrischen, Apple-Modell neu prüfen. */
  refresh(): void {
    if (!this.deps.connection().online) void this.localStatus(true);
    this.changed();
  }

  setDictation(patch: Partial<QuickDictation>): void {
    this.dictation = { ...this.dictation, ...patch };
    this.changed();
  }

  async send(text: string): Promise<void> {
    const message = text.trim();
    if (!message || this.busy) return;
    const user = newMessage("user", message);
    const assistant = newMessage("assistant", "");
    assistant.activity = "Denkt nach…";
    this.messages = [...this.messages, user, assistant];
    const controller = new AbortController();
    this.abort = controller;
    this.changed();
    try {
      if (this.deps.connection().online) await this.serverTurn(assistant, message, controller.signal);
      else await this.localTurn(assistant, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) this.fail(assistant, err instanceof Error ? err.message : String(err));
    } finally {
      if (this.abort === controller) this.abort = null;
      this.changed();
    }
  }

  /** Stoppt die Anzeige des laufenden Zugs. Der Server arbeitet abgekoppelt weiter und speichert die Antwort. */
  async stop(): Promise<void> {
    const controller = this.abort;
    if (!controller) return;
    controller.abort();
    this.abort = null;
    const last = this.messages[this.messages.length - 1];
    if (last && last.role === "assistant" && last.status === "streaming") {
      this.patch(last.id, { status: "stopped", activity: null, tools: settleTools(last.tools) });
    }
    this.changed();
  }

  /** Neues Gespräch: Verlauf im Fenster leeren, nächste Frage öffnet einen neuen Chat auf dem Server. */
  reset(): void {
    if (this.abort) void this.stop();
    this.messages = [];
    this.session = null;
    this.changed();
  }

  // ── Server ───────────────────────────────────────────────────────────

  private async serverTurn(assistant: QuickMessage, text: string, signal: AbortSignal): Promise<void> {
    const body: Record<string, unknown> = { message: text };
    if (this.session !== null) body.session_id = this.session;
    let res: Response;
    try {
      res = await this.deps.server.streamChat(body, signal);
    } catch (err) {
      if (signal.aborted) return;
      this.deps.onNetworkError?.();
      this.fail(assistant, `Keine Verbindung zum KIRA-Server: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (!res.ok || !res.body) {
      this.fail(assistant, await describeHttpError(res));
      return;
    }
    const parser = new SseParser();
    parser.onMessage((msg) => this.onFrame(assistant.id, msg.data));
    try {
      await pumpSseStream(res.body, parser, signal);
    } catch (err) {
      if (signal.aborted) return;
      this.log.warn("quick_stream_broken", { error: err instanceof Error ? err.message : String(err) });
    }
    if (signal.aborted) return;
    const current = this.find(assistant.id);
    if (current && current.status === "streaming") {
      if (current.text) this.patch(current.id, { status: "done", activity: null, tools: settleTools(current.tools) });
      else this.fail(current, "Die Verbindung brach ab, bevor die Antwort kam. KIRA arbeitet im Hintergrund weiter – die Antwort steht gleich im Chat.");
    }
  }

  /** Ein `data:`-Frame des Servers. Exportiert für Tests über `handleFrameForTest`. */
  private onFrame(id: string, data: string): void {
    const msg = this.find(id);
    if (!msg) return;
    if (data === "[DONE]") {
      if (msg.status === "streaming" && msg.text) this.patch(id, { status: "done", activity: null, tools: settleTools(msg.tools) });
      return;
    }
    let p: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(data);
      if (!parsed || typeof parsed !== "object") return;
      p = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    switch (p.type) {
      case "start":
        if (typeof p.session_id === "number") this.session = p.session_id;
        break;
      case "thinking": {
        // Jeder Frame ist ein Denkschritt (wie im Dashboard, ChatPage „Nachgedacht“).
        const step = str(p.message).trim();
        const reasoning = step ? appendReasoning(msg.reasoning, step) : msg.reasoning;
        const activity = !msg.tools.some((t) => t.status === "running") && !msg.text ? "Denkt nach…" : msg.activity;
        this.patch(id, { reasoning, activity });
        break;
      }
      case "tool_call": {
        const name = str(p.tool);
        if (name === "inner_thought") {
          const args = p.args && typeof p.args === "object" ? (p.args as Record<string, unknown>) : {};
          const thought = str(args.thought).trim();
          if (thought) this.patch(id, { reasoning: appendReasoning(msg.reasoning, thought) });
          break;
        }
        if (!name || name === "send_message") break;
        const label = toolLabel(name);
        this.patch(id, { tools: [...msg.tools, { name, label, status: "running" }], activity: `${label}…` });
        break;
      }
      case "tool_result": {
        const idx = msg.tools.findIndex((t) => t.status === "running");
        if (idx < 0) break;
        const tools = msg.tools.map((t, i) => (i === idx ? { ...t, status: "done" as const } : t));
        const next = tools.find((t) => t.status === "running");
        this.patch(id, { tools, activity: next ? `${next.label}…` : "Denkt nach…" });
        break;
      }
      case "tool_pending":
        if (str(p.message)) this.patch(id, { activity: str(p.message).slice(0, 140) });
        break;
      case "response_delta":
        if (str(p.message)) this.patch(id, { text: msg.text + str(p.message) });
        break;
      case "response":
        this.patch(id, { text: str(p.message) || msg.text, status: "done", activity: null, tools: settleTools(msg.tools) });
        break;
      case "error": {
        const text =
          p.code === "session_ended" ? "Sitzung beendet – bitte im Hauptfenster neu anmelden." : str(p.message) || "Unbekannter Fehler auf dem Server.";
        this.fail(msg, text);
        break;
      }
      default:
        break;
    }
  }

  /** Nur für Tests: einen Frame direkt verarbeiten. */
  handleFrameForTest(id: string, data: string): void {
    this.onFrame(id, data);
  }

  // ── Lokal (Apple-Sprachmodell) ───────────────────────────────────────

  private async localStatus(force = false): Promise<{ available: boolean; reason: string | null }> {
    const now = (this.deps.now ?? Date.now)();
    const cached = this.localStatusCache;
    if (!force && cached && now - cached.at < LOCAL_STATUS_TTL_MS) return cached;
    let status: { available: boolean; reason: string | null };
    try {
      status = await this.deps.local.status();
    } catch (err) {
      status = { available: false, reason: err instanceof Error ? err.message : String(err) };
    }
    const changed = !cached || cached.available !== status.available;
    this.localStatusCache = { at: now, ...status };
    if (changed) this.changed();
    return status;
  }

  private async localTurn(assistant: QuickMessage, signal: AbortSignal): Promise<void> {
    this.patch(assistant.id, { local: true, activity: "Denkt lokal nach…" });
    const status = await this.localStatus();
    if (signal.aborted) return;
    if (!status.available) {
      const why = status.reason ? ` (${status.reason})` : "";
      this.fail(this.find(assistant.id) ?? assistant, `Keine Verbindung zum KIRA-Server – und das Apple-Sprachmodell ist auf diesem Mac nicht verfügbar${why}.`);
      return;
    }
    const prompt = buildLocalPrompt(this.messages.filter((m) => m.id !== assistant.id));
    const text = await this.deps.local.stream(
      prompt,
      LOCAL_INSTRUCTIONS,
      (partial) => {
        if (!signal.aborted) this.patch(assistant.id, { text: partial, activity: null });
      },
      signal,
    );
    if (signal.aborted) return;
    const current = this.find(assistant.id);
    this.patch(assistant.id, { text: text || current?.text || "", status: "done", activity: null });
  }

  // ── Hilfen ───────────────────────────────────────────────────────────

  private find(id: string): QuickMessage | undefined {
    return this.messages.find((m) => m.id === id);
  }

  private patch(id: string, patch: Partial<QuickMessage>): void {
    this.messages = this.messages.map((m) => (m.id === id ? { ...m, ...patch } : m));
    this.changed();
  }

  private fail(msg: QuickMessage, error: string): void {
    this.patch(msg.id, { status: "error", error, activity: null, tools: settleTools(msg.tools, "error") });
  }

  private changed(): void {
    if (this.pending) return;
    this.pending = true;
    const run = (): void => {
      this.pending = false;
      this.emit("state", this.getState());
    };
    if (this.deps.schedule) this.deps.schedule(run);
    else setTimeout(run, 16);
  }
}

async function describeHttpError(res: Response): Promise<string> {
  let detail = "";
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object") {
      const d = (body as { detail?: unknown }).detail;
      if (typeof d === "string") detail = d;
      else if (d && typeof d === "object" && typeof (d as { message?: unknown }).message === "string") detail = (d as { message: string }).message;
    }
  } catch {
    /* kein JSON */
  }
  switch (res.status) {
    case 401:
      return "Nicht angemeldet – bitte im Hauptfenster bei KIRA anmelden.";
    case 402:
      return detail ? `Budget erreicht: ${detail}` : "Das Monatsbudget ist aufgebraucht.";
    case 403:
      return detail ? `Keine Berechtigung: ${detail}` : "Für den Chat fehlt die Berechtigung.";
    default:
      return `KIRA antwortet mit HTTP ${res.status}${detail ? `: ${detail}` : "."}`;
  }
}

// Attrappe von `window.KiraLocal` für die Vorschau des Schnellfensters im
// Browser (Gestaltung, Bildschirmfotos). NIE in der App: main.tsx lädt dieses
// Modul nur, wenn die Brücke fehlt – in der App stellt der Preload sie immer
// bereit. Es spielt Zustände nach; nichts verlässt die Seite.
//
//   ?mock=1         Frage, Markdown-Antwort, laufender Zug mit Werkzeug-Chip
//   ?mock=empty | local | offline | error | stopped | dictation | rich | long
//   ?theme=light|dark       Hell/Dunkel erzwingen (sonst System)
//   ?backdrop=aurora|bright Kulisse + nachgeahmtes Glas hinter dem Fenster

import { type KiraLocalApi, type LocalEvent, type QuickMessage, type QuickState, type QuickTool } from "../../shared/local-api";

let seq = 0;
const id = (): string => `mock-${++seq}`;

function user(text: string): QuickMessage {
  return { id: id(), role: "user", text, status: "done", tools: [], activity: null, local: false, error: null };
}

function kira(text: string, patch: Partial<QuickMessage> = {}): QuickMessage {
  return { id: id(), role: "assistant", text, status: "done", tools: [], activity: null, local: false, error: null, ...patch };
}

const tool = (name: string, label: string, status: QuickTool["status"] = "done"): QuickTool => ({ name, label, status });

const WEBER = [
  "Drei Mails von **Frau Weber** seit gestern, alle zum Projekt *Nordlicht*:",
  "",
  "- `09:12` Angebot V3 freigegeben, Rechnungsadresse bleibt die Zentrale.",
  "- `11:40` Termin am Donnerstag 14 Uhr bestätigt, sie bringt Herrn Kaya mit.",
  "- `heute 08:05` Bittet um die Datenschutz-Anlage als PDF bis Mittwoch.",
  "",
  "Die Anlage liegt unter [Dokumente › Nordlicht](https://kira.reiser.de/documents) bereit. Ein Anfang für die Antwort:",
  "",
  "```text",
  "Hallo Frau Weber,",
  "anbei die Datenschutz-Anlage für das Projekt Nordlicht.",
  "```",
].join("\n");

const RICH = [
  "## Wochenplan",
  "",
  "| Tag | Termin | Ort |",
  "|:--|:--|--:|",
  "| Mo | Jour fixe | Raum 2 |",
  "| Mi | **Nordlicht** Abnahme | online |",
  "| Fr | Zahnarzt | Praxis Dr. Lang |",
  "",
  "1. Angebot prüfen",
  "   - Preise",
  "   - Fristen",
  "2. Anlage senden",
  "",
  "> Hinweis: Der Termin am Mittwoch wurde zweimal verschoben.",
  "",
  "Mehr unter https://kira.reiser.de/calendar. Unsicher: [klick](javascript:alert(1)) <script>alert(1)</script>",
  "",
  "![Grundriss Büro](https://kira.reiser.de/files/grundriss.png)",
].join("\n");

function base(): QuickState {
  return {
    sessionId: null,
    messages: [],
    busy: false,
    mode: "server",
    connection: { online: true, label: "kira.reiser.de" },
    dictation: { available: true, active: false, level: 0, partial: "", reason: null },
    hotkeys: { quickWindow: "Alt+Space", dictation: "Alt+Command+D" },
  };
}

function scenario(name: string): QuickState {
  const s = base();
  switch (name) {
    case "empty":
      return s;
    case "offline":
      return { ...s, mode: "offline", connection: { online: false, label: "kira.reiser.de" }, dictation: { ...s.dictation, available: false, reason: "Der Helfer läuft nicht." } };
    case "local":
      return {
        ...s,
        mode: "local",
        connection: { online: false, label: "kira.reiser.de" },
        messages: [
          user("Formuliere eine kurze Absage für den Termin am Freitag"),
          kira("Gern – zum Beispiel:\n\nHallo Herr Kaya,\nleider muss ich den Termin am Freitag absagen. Passt Ihnen nächste Woche Dienstag?\n\nViele Grüße\nLucas", { local: true }),
        ],
      };
    case "error":
      return {
        ...s,
        sessionId: 4711,
        messages: [user("Was steht heute an?"), kira("", { status: "error", tools: [tool("calendar_list_events", "Schaut in den Kalender", "error")], error: "Nicht angemeldet – bitte im Hauptfenster bei KIRA anmelden." })],
      };
    case "stopped":
      return { ...s, sessionId: 4711, messages: [user("Recherchiere die besten Wanderwege im Allgäu"), kira("", { status: "stopped", tools: [tool("web_search", "Sucht im Web"), tool("fetch_page", "Liest eine Webseite")] })] };
    case "dictation":
      return { ...s, dictation: { available: true, active: true, level: 0.32, partial: "ob Herr Kaya die Unterlagen ebenfalls erhalten soll", reason: null } };
    case "rich":
      return { ...s, sessionId: 4711, messages: [user("Zeig mir die Woche"), kira(RICH, { tools: [tool("calendar_list_events", "Schaut in den Kalender"), tool("todo_list", "Prüft Aufgaben")] })] };
    case "long":
      return {
        ...s,
        sessionId: 4711,
        messages: [user("Fasse die drei neuesten Mails von Frau Weber zusammen"), kira(WEBER, { tools: [tool("mail_search", "Durchsucht das Postfach")] }), user("Zeig mir die Woche"), kira(RICH), user("Danke!"), kira("Gern geschehen.")],
      };
    default:
      return {
        ...s,
        sessionId: 4711,
        busy: true,
        messages: [
          user("Fasse die drei neuesten Mails von Frau Weber zusammen"),
          kira(WEBER, { tools: [tool("mail_search", "Durchsucht das Postfach"), tool("mail_read", "Liest eine Mail"), tool("mail_read", "Liest eine Mail")] }),
          user("Und was steht morgen im Kalender?"),
          kira("", { status: "streaming", tools: [tool("calendar_list_events", "Schaut in den Kalender", "running")], activity: "Schaut in den Kalender…" }),
        ],
      };
  }
}

/** Kulisse für Bildschirmfotos: Hintergrund + nachgeahmtes Glas (in der App macht das macOS). */
function installBackdrop(kind: string): void {
  const style = document.createElement("style");
  const bright = kind === "bright";
  style.textContent = `
    html.quick { background: ${
      bright
        ? "radial-gradient(60% 80% at 10% 0%, #bfe3ff, transparent 70%), radial-gradient(60% 80% at 100% 30%, #ffd9c7, transparent 70%), #eef3fb"
        : "radial-gradient(50% 70% at 0% 0%, rgba(56,189,248,.55), transparent 70%), radial-gradient(55% 70% at 100% 40%, rgba(167,139,250,.45), transparent 70%), radial-gradient(60% 60% at 40% 110%, rgba(45,212,191,.35), transparent 70%), #0b1020"
    } !important; }
    html.quick .qw { background: ${bright ? "rgba(244,246,250,.55)" : "rgba(16,18,24,.56)"}; -webkit-backdrop-filter: blur(44px) saturate(170%); backdrop-filter: blur(44px) saturate(170%); }
  `;
  document.head.append(style);
}

export function installQuickMock(params: URLSearchParams): void {
  const theme = params.get("theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  const backdrop = params.get("backdrop");
  if (backdrop) installBackdrop(backdrop);

  let state = scenario(params.get("mock") ?? "1");
  const listeners = new Set<(event: LocalEvent) => void>();
  const emit = (event: LocalEvent): void => listeners.forEach((listener) => listener(event));
  const set = (next: QuickState): void => {
    state = next;
    emit({ type: "quick", quick: state });
  };
  const patchLast = (patch: Partial<QuickMessage>): void => {
    const messages = state.messages.slice();
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    messages[messages.length - 1] = { ...last, ...patch };
    set({ ...state, messages });
  };
  let timers: number[] = [];
  const later = (ms: number, fn: () => void): void => {
    timers.push(window.setTimeout(fn, ms));
  };
  const notInPreview = (): Promise<never> => Promise.reject(new Error("In der Vorschau nicht verfügbar."));

  const api: KiraLocalApi = {
    getState: notInPreview,
    probe: notInPreview,
    saveInstance: notInPreview,
    finishOnboarding: notInPreview,
    setHotkeys: notInPreview,
    setDictation: notInPreview,
    setGeneral: notInPreview,
    requestPermission: notInPreview,
    checkForUpdates: notInPreview,
    openLogs: notInPreview,
    hudStop: notInPreview,
    retry: notInPreview,
    openSettings: notInPreview,
    openMain: notInPreview,
    openLink: async (url) => console.info("[Vorschau] openLink", url),
    quickGetState: async () => state,
    quickSend: async (text) => {
      if (state.busy) return;
      if (text.length > 20_000) throw new Error("Die Nachricht ist zu lang (höchstens 20.000 Zeichen).");
      const local = state.mode !== "server";
      set({
        ...state,
        busy: true,
        sessionId: local ? state.sessionId : (state.sessionId ?? 4711),
        messages: [...state.messages, user(text), kira("", { status: "streaming", activity: local ? "Denkt lokal nach…" : "Denkt nach…", local })],
      });
      if (local) {
        const answer = "Ohne Verbindung kann ich nur formulieren, kürzen, übersetzen und erklären – **Mails und Kalender** gehen erst wieder mit dem KIRA-Server.";
        let shown = 0;
        const step = (): void => {
          shown = Math.min(answer.length, shown + 12);
          patchLast({ text: answer.slice(0, shown), activity: null });
          if (shown < answer.length) later(60, step);
          else {
            patchLast({ status: "done" });
            set({ ...state, busy: false });
          }
        };
        later(700, step);
        return;
      }
      later(600, () => patchLast({ tools: [tool("mail_search", "Durchsucht das Postfach", "running")], activity: "Durchsucht das Postfach…" }));
      later(1600, () => patchLast({ tools: [tool("mail_search", "Durchsucht das Postfach")], activity: "Denkt nach…" }));
      later(2400, () => {
        patchLast({ text: WEBER, status: "done", activity: null });
        set({ ...state, busy: false });
      });
    },
    quickStop: async () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers = [];
      patchLast({ status: "stopped", activity: null, tools: (state.messages[state.messages.length - 1]?.tools ?? []).map((t) => (t.status === "running" ? { ...t, status: "done" } : t)) });
      set({ ...state, busy: false });
    },
    quickReset: async () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers = [];
      set({ ...state, busy: false, messages: [], sessionId: null });
    },
    quickOpenInMain: async () => console.info("[Vorschau] Im Hauptfenster öffnen", state.sessionId),
    quickHide: async () => console.info("[Vorschau] Fenster ausblenden"),
    quickResize: async (height) => {
      // Für Bildschirmfotos: gewünschte Höhe ablesbar (z. B. per --dump-dom).
      document.documentElement.dataset.mockHeight = String(height);
    },
    quickToggleDictation: async () => {
      const active = !state.dictation.active;
      set({ ...state, dictation: { ...state.dictation, active, partial: active ? "" : state.dictation.partial, level: 0 } });
      if (!active) {
        const partial = state.dictation.partial;
        set({ ...state, dictation: { ...state.dictation, partial: "" } });
        if (partial) emit({ type: "quick-insert", text: partial });
        return;
      }
      const words = "bitte schick mir die Anlage bis Mittwoch".split(" ");
      words.forEach((_, i) =>
        later(350 * (i + 1), () => {
          if (!state.dictation.active) return;
          set({ ...state, dictation: { ...state.dictation, partial: words.slice(0, i + 1).join(" "), level: 0.15 + ((i * 37) % 50) / 100 } });
        }),
      );
    },
    on: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  window.KiraLocal = api;
  // Wie in der App: nach dem Zeigen bekommt das Feld den Fokus.
  window.setTimeout(() => emit({ type: "quick-shown" }), 50);
}

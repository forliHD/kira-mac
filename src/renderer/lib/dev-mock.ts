// Attrappe von `window.KiraLocal` für die optische Kontrolle im Browser
// (`npm run build`, out/renderer über einen lokalen Server, Seite mit
// `?mock=1`). Greift NUR, wenn `window.KiraLocal` fehlt UND die Adresse
// `mock=1` enthält. In der App setzt der Preload `window.KiraLocal` immer –
// dann tut diese Datei nichts.
//
// Schalter in der Adresse: theme=light|dark · backdrop=1 (Schreibtisch hinter
// den transparenten Seiten nachstellen) · glass=liquid|vibrancy ·
// reduced=1 · offline=1 · helper=0 · stt=ready|missing|downloading|unavailable ·
// perms=mixed|granted|denied · bridge=0 · prefill=1 (Einrichtung mit Adressen),
// ext=…/int=… (gespeicherte Adressen; „offline“/„alt“/„cf.“ im Namen steuern
// die Prüfung) ·
// step=2 (Einrichtung) · conflicts=1 · update=<Status> · HUD: phase=…,
// app=…, partial=…, message=…, live=1 · Diktat auf der 🌐 fn-Taste: fn=1
// (bzw. fn=permission|unavailable|error), fnaction=none|inputSource|emoji|dictation|default.

import { FN_HOTKEY, fnSystemActionFrom, isFnHotkey } from "../../shared/hotkey";
import { type HelperInfo, type PermissionKind, type PermissionsStatus } from "../../shared/helper-types";
import {
  type FnKeyStatus,
  type FnSystemAction,
  type HudPhase,
  type HudState,
  type KiraLocalApi,
  type LocalEvent,
  type LocalState,
  type ProbeResult,
  type QuickState,
  type UpdateState,
} from "../../shared/local-api";

export type MockPage = "onboarding" | "settings" | "hud" | "offline";

let active = false;
let params = new URLSearchParams();

/** Läuft die Seite mit der Attrappe? */
export function isMock(): boolean {
  return active;
}

/** Ein Schalter der Attrappe (null ohne Attrappe – in der App also immer null). */
export function mockParam(name: string): string | null {
  return active ? params.get(name) : null;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const LOCALES = [
  "de-DE", "de-AT", "de-CH", "en-US", "en-GB", "en-AU", "en-CA", "en-IN", "en-IE", "en-NZ", "en-SG", "en-ZA",
  "fr-FR", "fr-CA", "fr-BE", "fr-CH", "it-IT", "it-CH", "es-ES", "es-MX", "es-US", "es-CL", "es-CO", "pt-BR",
  "pt-PT", "nl-NL", "nl-BE", "da-DK", "sv-SE", "nb-NO", "fi-FI", "pl-PL", "cs-CZ", "sk-SK", "hu-HU", "ro-RO",
  "tr-TR", "el-GR", "ru-RU", "uk-UA", "he-IL", "ar-SA", "ja-JP", "ko-KR", "zh-CN",
];

export const MOCK_OFFLINE_REASON =
  "Instanz nicht erreichbar: intern http://192.168.178.166: Rechner nicht erreichbar (anderes Netz, VPN aus?).; extern https://kira.example.de: Keine Antwort innerhalb von 4 s.";

const LONG_PARTIAL =
  "Die Datenschutz-Anlage schicke ich Ihnen bis Mittwoch als PDF, bitte geben Sie mir noch kurz Bescheid, ob Herr Kaya die Unterlagen ebenfalls erhalten soll";

function normalize(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const host = raw.replace(/^[a-z]+:\/\//i, "").split("/")[0] ?? "";
  const lan = /^(localhost|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)|\.(local|lan|home)(:\d+)?$/i.test(host);
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${lan ? "http" : "https"}://${raw}`);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || !url.hostname.includes(".")) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

function permissions(kind: string | null): PermissionsStatus {
  if (kind === "granted") return { microphone: "granted", speech: "granted", accessibility: true, screenRecording: true };
  if (kind === "denied") return { microphone: "denied", speech: "denied", accessibility: false, screenRecording: false };
  return { microphone: "granted", speech: "notDetermined", accessibility: false, screenRecording: false };
}

function updateState(status: string | null): UpdateState {
  switch (status) {
    case "downloading":
      return { status: "downloading", version: "0.2.0", message: "Version 0.2.0 wird geladen…", progress: 45 };
    case "downloaded":
      return { status: "downloaded", version: "0.2.0", message: "Version 0.2.0 ist bereit und wird beim Beenden installiert.", progress: 100 };
    case "error":
      return { status: "error", version: null, message: "Update-Prüfung fehlgeschlagen: net::ERR_INTERNET_DISCONNECTED", progress: null };
    case "unsupported":
      return { status: "unsupported", version: null, message: "Updates gibt es nur in der gepackten App (DMG).", progress: null };
    case "idle":
      return { status: "idle", version: null, message: null, progress: null };
    default:
      return { status: "none", version: null, message: "Keine neue Version – 0.1.0 ist aktuell.", progress: null };
  }
}

const FN_ACTIONS: Record<string, number | null> = { none: 0, inputSource: 1, emoji: 2, dictation: 3, default: null };

function fnSystemAction(p: URLSearchParams): FnSystemAction {
  const raw = p.get("fnaction") ?? "emoji";
  return fnSystemActionFrom(raw in FN_ACTIONS ? FN_ACTIONS[raw] : null);
}

/** Wie der Hauptprozess (fn-key.ts) den Stand der fn-Taste meldet. */
function fnKeyStatus(dictationHotkey: string, p: URLSearchParams, permissionGranted: boolean): FnKeyStatus {
  const systemAction = fnSystemAction(p);
  if (!isFnHotkey(dictationHotkey)) return { state: "off", message: null, systemAction };
  const mode = p.get("fn");
  if (mode === "unavailable" || p.get("helper") === "0") {
    return { state: "unavailable", message: "Der Helfer läuft nicht – ohne ihn hört KIRA nicht auf die fn-Taste.", systemAction };
  }
  if (mode === "error") return { state: "error", message: "Die fn-Taste lässt sich nicht einschalten: macOS hat den Event-Tap abgelehnt.", systemAction };
  if (mode === "permission" && !permissionGranted) {
    return {
      state: "permission",
      message: "KIRA sieht die fn-Taste erst mit der Freigabe „Bedienungshilfen“. Bitte „KIRA für Mac“ unter „Datenschutz & Sicherheit → Bedienungshilfen“ erlauben.",
      systemAction,
    };
  }
  return { state: "active", message: null, systemAction };
}

function initialState(page: MockPage, p: URLSearchParams): LocalState {
  const offline = p.get("offline") === "1" || page === "offline";
  const bridge = p.get("bridge") !== "0";
  const helperRunning = p.get("helper") !== "0";
  const sttMode = p.get("stt") ?? "ready";
  const info: HelperInfo = {
    protocol: 1,
    version: "0.1.0",
    macos: "27.0.1",
    chip: "Apple M3",
    features: { stt: sttMode !== "unavailable", sttStream: true, llm: true, systemAudio: true, insertText: true },
    locales: LOCALES,
  };
  const stt =
    sttMode === "missing"
      ? { available: false, engine: "analyzer" as const, assets: "missing" as const, reason: "Das Sprachpaket für Deutsch (Deutschland) ist nicht installiert." }
      : sttMode === "downloading"
        ? { available: false, engine: "analyzer" as const, assets: "downloading" as const }
        : sttMode === "unavailable"
          ? { available: false, engine: null, assets: "missing" as const, reason: "Spracherkennung auf dem Gerät braucht macOS 26 auf einem Apple-Chip." }
          : { available: true, engine: "analyzer" as const, assets: "installed" as const };
  const onboarding = page === "onboarding";
  const prefill = p.get("prefill") === "1";
  return {
    appVersion: "0.1.0",
    ui: { glass: p.get("glass") === "vibrancy" ? "vibrancy" : "liquid", macos: "27.0.1", reducedTransparency: p.get("reduced") === "1" },
    instance:
      onboarding && !prefill
        ? { internalUrl: null, externalUrl: null, label: "KIRA" }
        : {
            internalUrl: p.get("int") ?? "http://192.168.178.166",
            externalUrl: p.get("ext") ?? "https://kira.example.de",
            label: "kira.example.de",
          },
    hotkeys: { quickWindow: "Alt+Space", dictation: p.get("fn") ? FN_HOTKEY : "Control+Alt+D" },
    dictation: { locale: "de-DE", commands: true, dashboardStt: true },
    general: { launchAtLogin: true, notifications: true },
    connection: offline
      ? { online: false, origin: null, kind: null, serverVersion: null, serverHasBridge: false, lastError: MOCK_OFFLINE_REASON, lastOnlineAt: Date.now() - 120_000 }
      : {
          online: true,
          origin: "http://192.168.178.166",
          kind: "internal",
          serverVersion: bridge ? "3.297.0" : "3.290.0",
          serverHasBridge: bridge,
          lastError: null,
          lastOnlineAt: Date.now(),
        },
    update: updateState(p.get("update")),
    helper: helperRunning
      ? { running: true, info, lastError: null }
      : { running: false, info: null, lastError: "Der Helfer ist nicht gebaut (scripts/build-helper.sh) – Apple-Schnittstellen fehlen." },
    dictationStatus: {
      stt: helperRunning ? stt : null,
      permissions: helperRunning ? permissions(p.get("perms")) : null,
      hotkeyConflicts: p.get("conflicts") === "1" ? ["Globales Diktat: „⌃⌥D“ wird bereits von einem anderen Programm oder macOS belegt."] : [],
      fnKey: fnKeyStatus(p.get("fn") ? FN_HOTKEY : "Control+Alt+D", p, helperRunning && permissions(p.get("perms")).accessibility),
    },
    onboarded: !onboarding,
    logPath: "/Users/kira/Library/Logs/KIRA/main.log",
  };
}

function hudScript(p: URLSearchParams, emit: (hud: HudState) => void): () => void {
  const phase = (p.get("phase") ?? "listening") as HudPhase;
  const app = p.get("app") ?? "Mail";
  const partial = p.get("partial") ?? LONG_PARTIAL;
  const message =
    p.get("message") ??
    (phase === "unavailable"
      ? "Das Sprachpaket für Deutsch (Deutschland) fehlt – macOS lädt es beim ersten Diktat."
      : phase === "error"
        ? "Spracherkennung abgebrochen: Das Mikrofon ist nicht mehr verfügbar."
        : null);
  const base: HudState = { phase, level: 0, partial: phase === "listening" || phase === "stopping" ? partial : "", app, message };
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  if (p.get("live") === "1" && phase === "listening") {
    const words = partial.split(" ");
    let n = 0;
    const id = setInterval(() => {
      n = (n + 1) % (words.length * 3);
      emit({ ...base, level: 0.02 + Math.random() * 0.25, partial: words.slice(0, Math.ceil(n / 3)).join(" ") });
    }, 100);
    return () => clearInterval(id);
  }
  const levels = phase === "listening" ? [0.03, 0.09, 0.18, 0.12, 0.26, 0.15, 0.07] : [0, 0, 0, 0, 0, 0, 0];
  levels.forEach((level, i) => timers.push(setTimeout(() => emit({ ...base, level }), 40 + i * 110)));
  return () => timers.forEach(clearTimeout);
}

function createMockApi(page: MockPage, p: URLSearchParams): KiraLocalApi {
  let state = initialState(page, p);
  const listeners = new Set<(event: LocalEvent) => void>();
  const emit = (event: LocalEvent): void => listeners.forEach((l) => l(event));
  const setState = (next: LocalState): LocalState => {
    state = next;
    emit({ type: "state", state });
    return state;
  };
  const quick: QuickState = {
    sessionId: null,
    messages: [],
    busy: false,
    mode: "server",
    connection: { online: true, label: "kira.example.de" },
    dictation: { available: true, active: false, level: 0, partial: "", reason: null },
    hotkeys: state.hotkeys,
  };
  const log = (what: string): void => console.info(`[Attrappe] ${what}`);

  return {
    getState: async () => {
      await delay(30);
      return state;
    },
    probe: async (url): Promise<ProbeResult> => {
      await delay(450);
      const origin = normalize(url);
      if (!origin) return { url, ok: false, version: null, bridge: false, error: "Keine gültige http(s)-Adresse.", latencyMs: null };
      if (/offline|down|nicht/.test(origin)) {
        return { url: origin, ok: false, version: null, bridge: false, error: "Rechner nicht erreichbar (anderes Netz, VPN aus?).", latencyMs: 4000 };
      }
      if (/alt|old/.test(origin)) return { url: origin, ok: true, version: "3.290.0", bridge: false, error: null, latencyMs: 40 };
      if (/access|cf\./.test(origin)) return { url: origin, ok: true, version: null, bridge: false, error: null, latencyMs: 80 };
      return { url: origin, ok: true, version: "3.297.0", bridge: true, error: null, latencyMs: origin.startsWith("http:") ? 8 : 64 };
    },
    saveInstance: async (instance) => {
      await delay(200);
      log(`Instanz gespeichert: ${JSON.stringify(instance)}`);
      const label = (instance.internalUrl ?? instance.externalUrl ?? "").replace(/^[a-z]+:\/\//i, "").split("/")[0] || "KIRA";
      return setState({ ...state, instance: { ...instance, label } });
    },
    finishOnboarding: async () => {
      await delay(300);
      log("Einrichtung abgeschlossen");
      state = { ...state, onboarded: true };
    },
    setHotkeys: async (hotkeys) => {
      await delay(200);
      const conflicts =
        p.get("conflicts") === "1" && !isFnHotkey(hotkeys.dictation)
          ? [`Globales Diktat: „${hotkeys.dictation}“ wird bereits von einem anderen Programm oder macOS belegt.`]
          : [];
      const fnKey = fnKeyStatus(hotkeys.dictation, p, state.dictationStatus.permissions?.accessibility === true);
      return { state: setState({ ...state, hotkeys, dictationStatus: { ...state.dictationStatus, hotkeyConflicts: conflicts, fnKey } }), conflicts };
    },
    setDictation: async (dictation) => {
      await delay(150);
      return setState({ ...state, dictation });
    },
    setGeneral: async (general) => {
      await delay(150);
      return setState({ ...state, general });
    },
    requestPermission: async (kind: PermissionKind) => {
      await delay(700);
      const current = state.dictationStatus.permissions ?? permissions(null);
      const next: PermissionsStatus =
        kind === "accessibility" || kind === "screenRecording" ? { ...current, [kind]: true } : { ...current, [kind]: "granted" };
      const fnKey = kind === "accessibility" ? fnKeyStatus(state.hotkeys.dictation, p, true) : state.dictationStatus.fnKey;
      setState({ ...state, dictationStatus: { ...state.dictationStatus, permissions: next, fnKey } });
      return next;
    },
    checkForUpdates: async () => {
      const checking: UpdateState = { status: "checking", version: null, message: "Suche nach Updates…", progress: null };
      state = { ...state, update: checking };
      emit({ type: "update", update: checking });
      await delay(900);
      const done = updateState("none");
      state = { ...state, update: done };
      emit({ type: "update", update: done });
      return done;
    },
    openLogs: async () => log("Protokolle öffnen"),
    hudStop: async () => log("Diktat beenden"),
    retry: async () => {
      log("Erneut versuchen");
      await delay(1200);
    },
    openSettings: async (section) => log(`Einstellungen öffnen${section ? ` (Bereich ${section})` : ""}`),
    installUpdate: async () => log("Update installieren"),
    setHotkeyRecording: async (active) => log(`Kürzel ${active ? "ausgesetzt" : "wieder aktiv"}`),
    openMain: async () => log("Hauptfenster öffnen"),
    openLink: async (url) => log(`Link öffnen: ${url}`),
    quickGetState: async () => quick,
    quickSend: async () => undefined,
    quickStop: async () => undefined,
    quickReset: async () => undefined,
    quickOpenInMain: async () => undefined,
    quickHide: async () => undefined,
    quickResize: async () => undefined,
    quickToggleDictation: async () => undefined,
    on: (listener) => {
      listeners.add(listener);
      const stop = page === "hud" ? hudScript(p, (hud) => listener({ type: "hud", hud })) : () => undefined;
      return () => {
        stop();
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Setzt die Attrappe ein – nur ohne `window.KiraLocal` und mit `mock=1`.
 * Muss vor dem ersten Rendern laufen (main.tsx).
 */
export function installDevMock(page: MockPage): void {
  if (typeof window === "undefined" || window.KiraLocal) return;
  const search = new URLSearchParams(window.location.search);
  if (search.get("mock") !== "1") return;
  active = true;
  params = search;
  const theme = search.get("theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  if (search.get("backdrop") === "1" && page !== "offline") paintBackdrop(theme);
  window.KiraLocal = createMockApi(page, search);
  console.info("[Attrappe] window.KiraLocal ist eine Attrappe (mock=1).");
}

/**
 * `backdrop=1`: Hintergrund wie Glas/Vibrancy über einem Schreibtischbild
 * (Aurora bzw. „Morgen“ aus dem Design) – nur für Bildschirmfotos der
 * transparenten Seiten; in der App liefert das Fenster das Material.
 */
function paintBackdrop(theme: string | null): void {
  const light = theme === "light" || (theme !== "dark" && window.matchMedia("(prefers-color-scheme: light)").matches);
  const veil = light ? "rgba(246, 247, 250, 0.62)" : "rgba(24, 27, 34, 0.62)";
  const wallpaper = light
    ? "radial-gradient(60% 70% at 0% 0%, rgba(56, 189, 248, 0.35), transparent 70%), linear-gradient(160deg, #dbe9ff 0%, #eef3fb 45%, #ffe7d6 100%)"
    : "radial-gradient(60% 70% at 0% 0%, rgba(56, 189, 248, 0.45), transparent 70%), radial-gradient(60% 70% at 100% 100%, rgba(167, 139, 250, 0.4), transparent 70%), linear-gradient(160deg, #0b1020 0%, #121a33 50%, #0a1a2e 100%)";
  document.documentElement.style.background = `linear-gradient(${veil}, ${veil}), ${wallpaper}`;
  document.documentElement.style.minHeight = "100%";
}

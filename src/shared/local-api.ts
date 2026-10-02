// Typen der Schnittstelle zwischen den lokalen Seiten (onboarding, settings,
// hud, offline) und dem Hauptprozess – `window.KiraLocal`, bereitgestellt von
// src/preload/local.ts. Nicht Teil des Vertrags mit dem Dashboard.

import { type HelperInfo, type HelperSttStatus, type PermissionKind, type PermissionsStatus } from "./helper-types";

export interface InstanceConfig {
  internalUrl: string | null;
  externalUrl: string | null;
  label: string;
}

export interface HotkeyConfig {
  quickWindow: string;
  /** Electron-Kürzel („Control+Alt+D“) oder „Fn“ für die 🌐 fn-Taste (src/shared/hotkey.ts). */
  dictation: string;
}

export interface DictationConfig {
  locale: string;
  commands: boolean;
  /** Diktat im Dashboard über den Apple-Chip (Fähigkeit `stt`); aus = Server wie im Browser. */
  dashboardStt: boolean;
}

export interface GeneralConfig {
  launchAtLogin: boolean;
  notifications: boolean;
}

export interface ProbeResult {
  url: string;
  ok: boolean;
  version: string | null;
  bridge: boolean;
  error: string | null;
  latencyMs: number | null;
}

export interface ConnectionState {
  online: boolean;
  origin: string | null;
  kind: "internal" | "external" | null;
  serverVersion: string | null;
  serverHasBridge: boolean;
  lastError: string | null;
  /** Letzter erfolgreicher Kontakt (ms seit 1970), für „Letzter Kontakt …“. */
  lastOnlineAt: number | null;
}

export interface UpdateState {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "none" | "error" | "unsupported";
  version: string | null;
  message: string | null;
  progress: number | null;
}

export interface HelperState {
  running: boolean;
  info: HelperInfo | null;
  lastError: string | null;
}

export interface DictationStatus {
  stt: HelperSttStatus | null;
  permissions: PermissionsStatus | null;
  hotkeyConflicts: string[];
  fnKey: FnKeyStatus;
}

/** Was macOS selbst beim Drücken von 🌐 tut (`AppleFnUsageType`); `default` = nie geändert. */
export type FnSystemAction = "none" | "inputSource" | "emoji" | "dictation" | "default";

/** Die 🌐 fn-Taste als Auslöser des globalen Diktats (src/main/fn-key.ts). */
export interface FnKeyStatus {
  /**
   * off: nicht gewählt · starting: wird eingeschaltet · active: KIRA hört auf fn ·
   * paused: während ein Kürzel aufgenommen wird · permission: Freigabe „Bedienungshilfen“ fehlt ·
   * unavailable: Helfer läuft nicht oder kennt fn nicht · error: anderer Fehler
   */
  state: "off" | "starting" | "active" | "paused" | "permission" | "unavailable" | "error";
  /** Deutscher Satz zum Zustand (Grund bei permission/unavailable/error), sonst null. */
  message: string | null;
  /** macOS-Einstellung zu 🌐; null = unbekannt (Helfer hat nicht geantwortet). */
  systemAction: FnSystemAction | null;
}

/** Wie die Fenster gezeichnet werden: echtes Liquid Glass (macOS 26+,
 *  NSGlassEffectView) oder der Rückfall auf Vibrancy. Lokale Seiten passen ihre
 *  Flächen daran an (auf echtem Glas keine eigene Unschärfe, nur Lichtkanten). */
export interface UiInfo {
  glass: "liquid" | "vibrancy";
  macos: string;
  reducedTransparency: boolean;
}

export interface LocalState {
  appVersion: string;
  ui: UiInfo;
  instance: InstanceConfig;
  hotkeys: HotkeyConfig;
  dictation: DictationConfig;
  general: GeneralConfig;
  connection: ConnectionState;
  update: UpdateState;
  helper: HelperState;
  dictationStatus: DictationStatus;
  onboarded: boolean;
  logPath: string;
}

export type HudPhase = "starting" | "listening" | "stopping" | "unavailable" | "error";

export interface HudState {
  phase: HudPhase;
  level: number;
  partial: string;
  app: string | null;
  message: string | null;
}

// ── Schnellfenster (nativer Mini-Chat) ─────────────────────────────────
// Der Hauptprozess (src/main/quick-chat.ts) führt das Gespräch über
// `POST /api/chat/stream` der Instanz; die Seite zeigt nur `QuickState`.
// Ohne Verbindung antwortet das Apple-Sprachmodell lokal (Notlicht), dann ist
// `QuickMessage.local` gesetzt und nichts landet auf dem Server.

export type QuickRole = "user" | "assistant";

export interface QuickTool {
  name: string;
  /** Deutsche Beschreibung („Durchsucht das Postfach“). */
  label: string;
  status: "running" | "done" | "error";
}

export interface QuickMessage {
  id: string;
  role: QuickRole;
  /** Nutzer: Klartext. Assistent: Markdown (wird in der Seite sicher gerendert). */
  text: string;
  status: "streaming" | "done" | "error" | "stopped";
  /** Nur Assistent: laufende/fertige Werkzeuge dieses Zugs. */
  tools: QuickTool[];
  /** Nur Assistent, solange er arbeitet: „Denkt nach…“, „Durchsucht das Postfach…“. */
  activity: string | null;
  /** Nur Assistent: Denkschritte des Modells (Frames `thinking`, `inner_thought`) – im Fenster eingeklappt. */
  reasoning: string[];
  /** Antwort kam vom Apple-Sprachmodell auf diesem Mac (ohne KIRA-Server). */
  local: boolean;
  error: string | null;
}

export interface QuickDictation {
  available: boolean;
  active: boolean;
  level: number;
  partial: string;
  reason: string | null;
}

export interface QuickState {
  /** Chat-Sitzung auf dem Server (null bis zum ersten `start`-Frame). */
  sessionId: number | null;
  messages: QuickMessage[];
  busy: boolean;
  /** server = KIRA antwortet; local = offline, Apple-Modell antwortet; offline = gar nichts. */
  mode: "server" | "local" | "offline";
  connection: { online: boolean; label: string };
  dictation: QuickDictation;
  hotkeys: HotkeyConfig;
}

export type LocalEvent =
  | { type: "state"; state: LocalState }
  | { type: "hud"; hud: HudState }
  | { type: "connection"; connection: ConnectionState }
  | { type: "update"; update: UpdateState }
  | { type: "quick"; quick: QuickState }
  /** Diktat im Schnellfenster: fertiger Text (Diktierbefehle schon angewandt) an der Cursorposition einfügen. */
  | { type: "quick-insert"; text: string }
  /** Schnellfenster wurde gezeigt: Eingabefeld fokussieren. */
  | { type: "quick-shown" }
  /** Einstellungen (schon offen): zu diesem Bereich wechseln (`openSettings(section)`). */
  | { type: "settings-section"; section: string }
  /** Cloudflare-Access-Anmeldung im Browser ist gescheitert (Seite „Im Browser anmelden“). */
  | { type: "access-login"; status: "error" | "expired"; message: string }
  /** Der Diktat-Verlauf hat sich geändert (neues Diktat, gelöscht). */
  | { type: "dictation-history" }
  /** Schnellfenster: Ansicht wechseln (Menüleiste „Diktat-Verlauf…“ → Diktate). */
  | { type: "quick-view"; view: "chat" | "dictations" };

/** Ein Eintrag im Diktat-Verlauf (nur auf diesem Mac, src/main/dictation-history.ts). */
export interface DictationEntry {
  id: string;
  /** Beginn des Diktats (ms seit 1970). */
  at: number;
  /** Zielprogramm laut Helfer („Safari“) bzw. „KIRA“ beim Schnellfenster. */
  app: string | null;
  target: "insert" | "quick";
  text: string;
  /** Kam beim Einsetzen ein Fehler? (Dann steht der Text NUR hier.) */
  failed: boolean;
}

export interface DictationHistoryView {
  entries: DictationEntry[];
  /** false = Schlüsselbund-Verschlüsselung fehlt, der Verlauf hält nur bis zum Beenden. */
  persistent: boolean;
}

export interface KiraLocalApi {
  getState(): Promise<LocalState>;
  probe(url: string): Promise<ProbeResult>;
  saveInstance(instance: { internalUrl: string | null; externalUrl: string | null }): Promise<LocalState>;
  finishOnboarding(): Promise<void>;
  setHotkeys(hotkeys: HotkeyConfig): Promise<{ state: LocalState; conflicts: string[] }>;
  setDictation(dictation: DictationConfig): Promise<LocalState>;
  setGeneral(general: GeneralConfig): Promise<LocalState>;
  requestPermission(kind: PermissionKind): Promise<PermissionsStatus | null>;
  checkForUpdates(): Promise<UpdateState>;
  /** Geladenes Update jetzt installieren (App startet neu). */
  installUpdate(): Promise<void>;
  /** Während der Aufnahme eines Tastenkürzels die globalen Kürzel aussetzen. */
  setHotkeyRecording(active: boolean): Promise<void>;
  openLogs(): Promise<void>;
  hudStop(): Promise<void>;
  retry(): Promise<void>;
  /** Einstellungen öffnen, optional bei einem Bereich (z. B. „kuerzel“ für die Tastenkürzel). */
  openSettings(section?: string): Promise<void>;
  openMain(): Promise<void>;
  /** Link aus einer lokalen Seite: Instanz-Adresse → Hauptfenster, sonst System-Browser. */
  openLink(url: string): Promise<void>;
  /** Cloudflare Access: Anmeldung im System-Browser starten (access-login.ts). */
  accessLogin(): Promise<void>;
  /** Cloudflare Access: doch im App-Fenster anmelden (z. B. mit E-Mail-Code). */
  accessLoginInWindow(): Promise<void>;
  // Diktat-Verlauf (nur lokal)
  dictationHistory(): Promise<DictationHistoryView>;
  /** Text eines Eintrags in die Zwischenablage. */
  copyDictation(id: string): Promise<void>;
  deleteDictation(id: string): Promise<DictationHistoryView>;
  clearDictationHistory(): Promise<DictationHistoryView>;
  // Schnellfenster
  quickGetState(): Promise<QuickState>;
  quickSend(text: string): Promise<void>;
  quickStop(): Promise<void>;
  quickReset(): Promise<void>;
  quickOpenInMain(): Promise<void>;
  quickHide(): Promise<void>;
  /** Gewünschte Höhe des Inhalts in CSS-Pixeln; der Hauptprozess begrenzt sie auf den Bildschirm. */
  quickResize(height: number): Promise<void>;
  quickToggleDictation(): Promise<void>;
  on(listener: (event: LocalEvent) => void): () => void;
}

declare global {
  interface Window {
    KiraLocal?: KiraLocalApi;
  }
}

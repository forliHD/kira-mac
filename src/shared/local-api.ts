// Typen der Schnittstelle zwischen den lokalen Seiten (onboarding, settings,
// hud, offline) und dem Hauptprozess – `window.KiraLocal`, bereitgestellt von
// src/preload/local.ts. Nicht Teil des Vertrags mit dem Dashboard.

import { type DictationModelDownload } from "./dictation-model";
import { type DictationTestKind, type DictationTestResult, type DictationTestState } from "./dictation-test";
import { type AudioInputDevice, type HelperInfo, type HelperSttStatus, type PermissionKind, type PermissionsStatus } from "./helper-types";

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
  /** Nachkorrektur gegen den Wortschatz („Tira“ → KIRA), seit 0.4.0, Standard an. */
  correctVocabulary: boolean;
  /** Apples Sprachfilter beim Diktat (Echo, Rauschen, Pegel), seit 0.6.0, Standard an. */
  voiceProcessing: boolean;
  /** UID des Mikrofons aus `audio.inputs`; null = Systemstandard. */
  inputDevice: string | null;
}

export interface GeneralConfig {
  launchAtLogin: boolean;
  notifications: boolean;
}

// ── Schnellfenster-Einstellungen (Phase 3, 0.5.0) ─────────────────────
export type QuickPosition = "top" | "center";
export type QuickTextSize = "s" | "m" | "l";
/** ↩ sendet (⇧↩ Zeile) oder ⌘↩ sendet (↩ Zeile; „Im Hauptfenster“ wird dann ⌘⇧↩). */
export type QuickSendKey = "enter" | "cmd-enter";
export type QuickAfterSend = "stay" | "hide";

export interface QuickConfig {
  position: QuickPosition;
  /** Anteil der Arbeitsfläche für die Gesprächshöhe (Stufe B), 0,4 … 0,9. */
  chatHeightShare: number;
  /** Zuletzt gezogene Höhe je Bildschirm merken. */
  rememberHeight: boolean;
  /** Gemerkte Gesprächshöhen je Bildschirm-Kennung (pt). */
  heights: Record<string, number>;
  textSize: QuickTextSize;
  sendKey: QuickSendKey;
  /** Nach dem Senden offen lassen oder schließen (Antwort kommt als Mitteilung). */
  afterSend: QuickAfterSend;
  /** Nach so vielen Minuten Ruhe beginnt das nächste Öffnen ein neues Gespräch; 0 = nie. */
  resetAfterMin: number;
  suggestions: boolean;
  /** Mikrofon-Knopf im Eingabefeld zeigen. */
  dictationButton: boolean;
}

/** Was die Einstellungen schreiben – die gemerkten Höhen verwaltet die Hülle selbst. */
export type QuickSettings = Omit<QuickConfig, "heights">;

/** Was die Schnellfenster-Seite von den Einstellungen braucht. */
export type QuickPrefs = Pick<QuickConfig, "textSize" | "sendKey" | "suggestions" | "dictationButton">;

export const QUICK_RESET_CHOICES: readonly number[] = [0, 10, 30, 60];

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
  /** Laufender oder gescheiterter Download des Diktat-Modells. */
  modelDownload: DictationModelDownload;
  /** Wortschatz für die Nachkorrektur: Anzahl und Stand (null = noch nie geholt). */
  vocabulary: { count: number; fetchedAt: number } | null;
  /** Mikrofone dieses Macs (leer, wenn der Helfer sie nicht kennt). */
  inputDevices: AudioInputDevice[];
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
  quick: QuickConfig;
  connection: ConnectionState;
  update: UpdateState;
  helper: HelperState;
  dictationStatus: DictationStatus;
  onboarded: boolean;
  logPath: string;
}

/** `inserted`: kurze Bestätigung am Ende („Eingefügt · 42 Zeichen“), dann weg. */
export type HudPhase = "starting" | "listening" | "stopping" | "inserted" | "unavailable" | "error";

export interface HudState {
  phase: HudPhase;
  level: number;
  partial: string;
  app: string | null;
  /** Symbol des Zielprogramms (PNG, Base64) oder null. */
  appIcon: string | null;
  message: string | null;
  /** Fortschritt 0…1 (Modell-Download), sonst null. */
  progress: number | null;
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
  prefs: QuickPrefs;
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
  /** Fortschritt oder Fehler beim Laden des Diktat-Modells (ohne den ganzen Zustand neu zu holen). */
  | { type: "dictation-model"; download: DictationModelDownload }
  /** Schnellfenster: Ansicht wechseln (Menüleiste „Diktat-Verlauf…“ → Diktate). */
  | { type: "quick-view"; view: "chat" | "dictations" }
  /** Diktat-Test (Einstellungen → Diktat): Lauf und bisherige Ergebnisse. */
  | { type: "dictation-test"; test: DictationTestState; results: DictationTestResult[] };

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

export type { DictationTestKind, DictationTestResult, DictationTestState };

export interface KiraLocalApi {
  getState(): Promise<LocalState>;
  probe(url: string): Promise<ProbeResult>;
  saveInstance(instance: { internalUrl: string | null; externalUrl: string | null }): Promise<LocalState>;
  finishOnboarding(): Promise<void>;
  setHotkeys(hotkeys: HotkeyConfig): Promise<{ state: LocalState; conflicts: string[] }>;
  setDictation(dictation: DictationConfig): Promise<LocalState>;
  /** Fehlendes Diktat-Modell jetzt laden. Wirft mit der deutschen Ursache, wenn es scheitert. */
  prepareDictationModel(): Promise<LocalState>;
  // Diktat-Test (Einstellungen → Diktat, src/main/dictation-test.ts)
  dictationTestState(): Promise<{ test: DictationTestState; results: DictationTestResult[] }>;
  /** Vorlage bauen und die Erkennung starten; Fortschritt kommt als Ereignis `dictation-test`. */
  dictationTestStart(kind: DictationTestKind): Promise<DictationTestState>;
  /** Erkennung beenden; das Ergebnis kommt als Ereignis `dictation-test`, sobald der Helfer gespült hat. */
  dictationTestStop(): Promise<void>;
  dictationTestCancel(): Promise<void>;
  setGeneral(general: GeneralConfig): Promise<LocalState>;
  setQuick(quick: QuickSettings): Promise<LocalState>;
  /** Gemerkte Gesprächshöhen vergessen (zurück zum eingestellten Anteil). */
  resetQuickHeights(): Promise<LocalState>;
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
  /** Stufe B (Gespräch, Diktate): das Fenster nimmt die Gesprächshöhe an und lässt sich unten ziehen; false = Leiste folgt dem Inhalt. */
  quickSetTall(tall: boolean): Promise<void>;
  /** Diktat aus dem Verlauf in das Programm einsetzen, das vor dem Schnellfenster vorn war (blendet das Fenster aus). */
  quickReinsertDictation(id: string): Promise<void>;
  on(listener: (event: LocalEvent) => void): () => void;
}

declare global {
  interface Window {
    KiraLocal?: KiraLocalApi;
  }
}

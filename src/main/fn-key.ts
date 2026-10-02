// Globales Diktat über die 🌐 fn-Taste (`hotkeys.dictation === "Fn"`).
//
// Der Swift-Helfer hört mit einem passiven Event-Tap auf fn und meldet nur
// `fn.down`, `fn.chord` (während fn gedrückt war, kam eine andere Taste) und
// `fn.up` – nie Tastencodes oder Zeichen. Hier entscheidet eine reine
// Zustandsmaschine, was ein Druck bedeutet:
//
// - kurz tippen (< 300 ms, ohne andere Taste) → Diktat an/aus, wie ⌃⌥D
// - halten (≥ 300 ms) → Diktat startet, loslassen beendet und setzt ein
// - fn zusammen mit einer anderen Taste (fn+⌫, fn+←, fn+F-Tasten …) → nichts;
//   hatte das Halten schon ein Diktat gestartet, wird es verworfen
//
// Kein Electron-Import: Helfer und Diktat werden injiziert (tests/fn-key.test.ts).

import { EventEmitter } from "node:events";

import { fnSystemActionFrom } from "../shared/hotkey";
import { type HelperEvent } from "../shared/helper-types";
import { type FnKeyStatus, type FnSystemAction } from "../shared/local-api";
import { type Logger, silentLogger } from "../shared/logger";

/** Ab so langem Halten (ohne andere Taste) ist es Sprechen-solange-gedrückt. */
export const FN_HOLD_MS = 300;
const WATCH_TIMEOUT_MS = 5_000;
const STATUS_TIMEOUT_MS = 3_000;
/** `fn.status` (Systemeinstellung zu 🌐) höchstens so oft fragen. */
const STATUS_TTL_MS = 2_000;
/** Fehlte die Freigabe, höchstens so oft neu versuchen (Nutzer kommt aus den Systemeinstellungen). */
const PERMISSION_RETRY_MS = 1_500;

// ── Zustandsmaschine (rein) ──────────────────────────────────────────────

/** Was die Maschine vom Diktat braucht – dieselben Wege wie das Tastenkürzel. */
export interface FnDictationControl {
  /** Läuft ein Diktat (startet oder hört zu)? */
  isActive(): boolean;
  /** Wie ⌃⌥D: an, wenn aus; aus, wenn an (Ziel: Schnellfenster oder vorderstes Programm). */
  toggle(): void;
  start(): void;
  /** Beenden und noch Erkanntes einsetzen. */
  stop(): void;
  /** Abbrechen, nichts einsetzen. */
  cancel(): void;
}

/**
 * up: fn nicht gedrückt · pressed: gedrückt, noch unter der Haltezeit ·
 * held: über der Haltezeit · chorded: es kam eine andere Taste ·
 * ignored: Druck zählt nicht (sichere Texteingabe, kein Diktat lief)
 */
export type FnPhase = "up" | "pressed" | "held" | "chorded" | "ignored";

export type FnAction = "tap" | "hold-start" | "hold-stop" | "chord-cancel" | "stop" | "secure-ignored";

export interface FnKeyMachineOptions {
  dictation: FnDictationControl;
  holdMs?: number;
  /** Für Protokoll und Tests: was ein Druck ausgelöst hat (ohne Tastendaten). */
  onAction?: (action: FnAction) => void;
}

export class FnKeyMachine {
  private readonly dictation: FnDictationControl;
  private readonly holdMs: number;
  private readonly onAction: (action: FnAction) => void;
  private phase: FnPhase = "up";
  /** Lief schon ein Diktat, als fn gedrückt wurde? Dann beendet Loslassen es. */
  private wasActive = false;
  /** Dieses Halten hat das Diktat gestartet (Sprechen-solange-gedrückt). */
  private holdStarted = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: FnKeyMachineOptions) {
    this.dictation = options.dictation;
    this.holdMs = options.holdMs ?? FN_HOLD_MS;
    this.onAction = options.onAction ?? (() => undefined);
  }

  get currentPhase(): FnPhase {
    return this.phase;
  }

  /** fn gedrückt. `secure`: Passwortfeld – andere Tasten sind dann unsichtbar. */
  down(options: { secure?: boolean } = {}): void {
    if (this.phase !== "up") return;
    this.wasActive = this.dictation.isActive();
    this.holdStarted = false;
    // In einem Passwortfeld sieht der Helfer keine anderen Tasten, fn+⌫ sähe
    // aus wie Tippen. Starten darf fn dort deshalb nie, Beenden schon.
    if (options.secure && !this.wasActive) {
      // Fürs Protokoll: hält ein Programm die sichere Eingabe dauerhaft an,
      // „tut fn nichts“ – so lässt sich das nachvollziehen.
      this.phase = "ignored";
      this.onAction("secure-ignored");
      return;
    }
    this.phase = "pressed";
    this.timer = setTimeout(() => this.onHold(), this.holdMs);
    this.timer.unref?.();
  }

  /** Während fn gedrückt ist, kam eine andere Taste: eine Tastenkombination. */
  chord(): void {
    if (this.phase === "pressed") {
      this.clearTimer();
      this.phase = "chorded";
    } else if (this.phase === "held") {
      this.phase = "chorded";
      if (this.holdStarted) {
        this.holdStarted = false;
        this.onAction("chord-cancel");
        this.dictation.cancel();
      }
    }
  }

  /** fn losgelassen. */
  up(): void {
    const phase = this.phase;
    const holdStarted = this.holdStarted;
    this.clearTimer();
    this.phase = "up";
    this.holdStarted = false;
    if (phase === "pressed") {
      this.onAction("tap");
      this.dictation.toggle();
    } else if (phase === "held") {
      if (holdStarted) {
        this.onAction("hold-stop");
        this.dictation.stop();
      } else if (this.wasActive) {
        // Lief schon (per Tippen gestartet): auch langes Drücken beendet es.
        this.onAction("stop");
        this.dictation.stop();
      }
    }
  }

  /** Zurück auf Anfang (Helfer neu gestartet, Aufnahme eines Kürzels, ausgeschaltet). */
  reset(): void {
    this.clearTimer();
    this.phase = "up";
    this.holdStarted = false;
    this.wasActive = false;
  }

  private onHold(): void {
    this.timer = null;
    if (this.phase !== "pressed") return;
    this.phase = "held";
    if (!this.wasActive && !this.dictation.isActive()) {
      this.holdStarted = true;
      this.onAction("hold-start");
      this.dictation.start();
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

// ── Steuerung: Helfer ↔ Maschine ↔ Diktat ────────────────────────────────

/** Was die Steuerung vom Helfer braucht (Teilmenge von HelperClient). */
export interface FnKeyHelper {
  readonly running: boolean;
  request<T = unknown>(cmd: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  on(event: "event", listener: (ev: HelperEvent) => void): unknown;
  on(event: "started" | "exited", listener: () => void): unknown;
  off(event: "event", listener: (ev: HelperEvent) => void): unknown;
  off(event: "started" | "exited", listener: () => void): unknown;
}

export interface FnKeyControllerOptions {
  helper: FnKeyHelper;
  dictation: FnDictationControl;
  /** Ist die fn-Taste als Auslöser gewählt (`hotkeys.dictation === "Fn"`)? */
  enabled: () => boolean;
  log?: Logger;
  holdMs?: number;
  now?: () => number;
}

export interface FnKeyEvents {
  status: [FnKeyStatus];
}

/** Antwort von `fn.watch` / `fn.status` (docs/helper-protocol.md). */
interface FnHelperStatus {
  watching?: unknown;
  tap?: unknown;
  fnUsage?: unknown;
}

type Failure = { state: "permission" | "unavailable" | "error"; message: string };

const HELPER_DOWN = "Der Helfer läuft nicht – ohne ihn hört KIRA nicht auf die fn-Taste.";

function describeFailure(err: unknown): Failure {
  const code = err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : "";
  const message = err instanceof Error ? err.message : String(err);
  switch (code) {
    case "permission_denied":
      return { state: "permission", message };
    case "unknown_command":
      return { state: "unavailable", message: "Dieser Helfer kennt die fn-Taste noch nicht (Helfer zu alt – neu bauen bzw. App aktualisieren)." };
    case "helper_unavailable":
    case "helper_restarted":
      return { state: "unavailable", message: HELPER_DOWN };
    default:
      return { state: "error", message: `Die fn-Taste lässt sich nicht einschalten: ${message}` };
  }
}

export class FnKeyController extends EventEmitter<FnKeyEvents> {
  readonly machine: FnKeyMachine;
  private readonly helper: FnKeyHelper;
  private readonly enabled: () => boolean;
  private readonly log: Logger;
  private readonly now: () => number;
  private watching = false;
  private pending = false;
  private paused = false;
  private failure: Failure | null = null;
  private systemAction: FnSystemAction | null = null;
  private queue: Promise<void> = Promise.resolve();
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
  private lastStatusAt = Number.NEGATIVE_INFINITY;
  private lastEmitted = "";

  private readonly onEvent = (ev: HelperEvent): void => this.handleEvent(ev);
  private readonly onStarted = (): void => {
    // Neuer Helfer-Prozess = kein Tap mehr: neu einschalten.
    this.watching = false;
    this.machine.reset();
    void this.apply();
  };
  private readonly onExited = (): void => {
    this.watching = false;
    this.machine.reset();
    this.emitStatus();
  };

  constructor(options: FnKeyControllerOptions) {
    super();
    this.helper = options.helper;
    this.enabled = options.enabled;
    this.log = options.log ?? silentLogger;
    this.now = options.now ?? (() => Date.now());
    this.machine = new FnKeyMachine({
      dictation: options.dictation,
      holdMs: options.holdMs,
      onAction: (action) => this.log.info("fn_action", { action }),
    });
    this.helper.on("event", this.onEvent);
    this.helper.on("started", this.onStarted);
    this.helper.on("exited", this.onExited);
  }

  get status(): FnKeyStatus {
    const systemAction = this.systemAction;
    if (!this.enabled()) return { state: "off", message: null, systemAction };
    if (!this.helper.running) return { state: "unavailable", message: HELPER_DOWN, systemAction };
    if (this.paused) return { state: "paused", message: null, systemAction };
    if (this.watching) return { state: "active", message: null, systemAction };
    if (!this.pending && this.failure) return { ...this.failure, systemAction };
    return { state: "starting", message: null, systemAction };
  }

  /** Abhören ein- oder ausschalten – je nach Auswahl und Helfer (Aufrufe werden gereiht). */
  apply(): Promise<void> {
    const run = this.queue.then(() => this.applyNow());
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Während ein Kürzel aufgenommen wird, löst fn nichts aus. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.machine.reset();
    this.emitStatus();
  }

  /**
   * Für die Einstellungen: Systemeinstellung zu 🌐 nachlesen und – fehlte die
   * Freigabe – neu versuchen (der Nutzer kommt gerade aus den Systemeinstellungen).
   */
  async refresh(): Promise<FnKeyStatus> {
    if (!this.enabled() || !this.helper.running) return this.status;
    if (this.now() - this.lastStatusAt >= STATUS_TTL_MS) {
      this.lastStatusAt = this.now();
      try {
        this.noteSystem(await this.helper.request<FnHelperStatus>("fn.status", undefined, STATUS_TIMEOUT_MS));
      } catch {
        /* alter Helfer oder beschäftigt: der bekannte Stand bleibt */
      }
    }
    if (!this.watching && !this.pending && this.failure?.state === "permission" && this.now() - this.lastAttemptAt >= PERMISSION_RETRY_MS) {
      await this.apply();
    }
    return this.status;
  }

  dispose(): void {
    this.machine.reset();
    this.helper.off("event", this.onEvent);
    this.helper.off("started", this.onStarted);
    this.helper.off("exited", this.onExited);
  }

  private async applyNow(): Promise<void> {
    if (!this.enabled() || !this.helper.running) {
      this.machine.reset();
      const was = this.watching;
      this.watching = false;
      this.failure = null;
      if (was && this.helper.running) {
        await this.helper.request("fn.watch", { enabled: false }, WATCH_TIMEOUT_MS).catch((err: unknown) => {
          this.log.warn("fn_unwatch_failed", { error: err instanceof Error ? err.message : String(err) });
        });
        this.log.info("fn_watch", { state: "off" });
      }
      this.emitStatus();
      return;
    }
    if (this.watching) {
      this.emitStatus();
      return;
    }
    this.pending = true;
    this.emitStatus();
    try {
      const result = await this.helper.request<FnHelperStatus>("fn.watch", { enabled: true }, WATCH_TIMEOUT_MS);
      this.noteSystem(result);
      this.lastStatusAt = this.now(); // die Antwort trägt den Stand von fn.status schon mit
      this.watching = result?.watching === true;
      this.failure = this.watching ? null : { state: "error", message: "Der Helfer hat die fn-Taste nicht eingeschaltet." };
      this.log.info("fn_watch", { state: this.watching ? "active" : "error" });
    } catch (err) {
      this.watching = false;
      this.failure = describeFailure(err);
      this.log.warn("fn_watch_failed", { state: this.failure.state, code: (err as { code?: unknown } | null)?.code ?? null });
    } finally {
      this.pending = false;
      this.lastAttemptAt = this.now();
    }
    // Inzwischen abgewählt (z. B. schnell zurückgeschaltet)? Dann gleich wieder aus.
    if (this.watching && !this.enabled()) {
      await this.applyNow();
      return;
    }
    this.emitStatus();
  }

  private handleEvent(ev: HelperEvent): void {
    if (!ev.event.startsWith("fn.")) return;
    if (!this.watching || this.paused || !this.enabled()) return;
    const data = (ev.data && typeof ev.data === "object" ? ev.data : {}) as Record<string, unknown>;
    switch (ev.event) {
      case "fn.down":
        this.machine.down({ secure: data.secure === true });
        break;
      case "fn.chord":
        this.machine.chord();
        break;
      case "fn.up":
        // `chord` im Loslassen sichert ab, falls `fn.chord` verloren ging.
        if (data.chord === true) this.machine.chord();
        this.machine.up();
        break;
      default:
        break;
    }
  }

  private noteSystem(result: FnHelperStatus | null | undefined): void {
    if (result && typeof result === "object" && "fnUsage" in result) this.systemAction = fnSystemActionFrom(result.fnUsage);
  }

  private emitStatus(): void {
    const status = this.status;
    const key = JSON.stringify(status);
    if (key === this.lastEmitted) return;
    this.lastEmitted = key;
    this.emit("status", status);
  }
}

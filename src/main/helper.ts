// Prozessverwaltung des Swift-Helfers nach docs/helper-protocol.md:
// Spawn, JSON-Zeilen auf stdin/stdout, Request/Response über `id`, Ereignisse
// über `event`/`stream`, Zeitlimits je Kommando, Neustart mit Backoff
// (1/2/5/30 s), offene Anfragen bei Absturz mit `helper_restarted` ablehnen.
// Kein Electron-Import – tests/helper.test.ts fährt einen gefälschten Prozess.

import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { type Readable, type Writable } from "node:stream";

import {
  HELPER_DEFAULT_TIMEOUT_MS,
  HELPER_RESTART_BACKOFF_MS,
  HELPER_TIMEOUTS_MS,
  type HelperErrorShape,
  type HelperEvent,
  type HelperInfo,
  type HelperResponse,
} from "../shared/helper-types";
import { type Logger, silentLogger } from "../shared/logger";

export class HelperError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? helperMessage(code));
    this.name = "HelperError";
    this.code = code;
  }
}

function helperMessage(code: string): string {
  switch (code) {
    case "helper_restarted":
      return "Der Helfer wurde neu gestartet; die Anfrage ist verloren.";
    case "helper_unavailable":
      return "Der Helfer läuft nicht (Apple-Schnittstellen nicht verfügbar).";
    case "timeout":
      return "Der Helfer hat nicht rechtzeitig geantwortet.";
    case "protocol":
      return "Der Helfer hat eine unverständliche Antwort geschickt.";
    default:
      return `Helfer-Fehler: ${code}`;
  }
}

/** Das Minimum eines Kindprozesses, das der Client braucht (echt oder gefälscht). */
export interface HelperProcess {
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  pid?: number | undefined;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

export type SpawnLike = (binaryPath: string) => HelperProcess;

export interface HelperClientOptions {
  binaryPath: string;
  spawn?: SpawnLike;
  log?: Logger;
  /** Backoff-Stufen in ms für Neustarts; die letzte Stufe wiederholt sich. */
  backoffMs?: readonly number[];
  defaultTimeoutMs?: number;
  timeoutsMs?: Record<string, number>;
  /** Nach so vielen ms Laufzeit gilt ein Start als gelungen (Backoff zurücksetzen). */
  healthyAfterMs?: number;
}

interface Pending {
  cmd: string;
  resolve: (value: unknown) => void;
  reject: (err: HelperError) => void;
  timer: NodeJS.Timeout;
}

export interface HelperEvents {
  event: [HelperEvent];
  started: [];
  exited: [{ code: number | null; signal: NodeJS.Signals | null }];
  info: [HelperInfo];
  stopped: [];
}

const defaultSpawn: SpawnLike = (binaryPath) =>
  nodeSpawn(binaryPath, [], { stdio: ["pipe", "pipe", "pipe"], env: process.env }) as unknown as HelperProcess;

export class HelperClient extends EventEmitter<HelperEvents> {
  readonly binaryPath: string;
  private readonly spawnImpl: SpawnLike;
  private readonly log: Logger;
  private readonly backoffMs: readonly number[];
  private readonly defaultTimeoutMs: number;
  private readonly timeoutsMs: Record<string, number>;
  private readonly healthyAfterMs: number;

  private child: HelperProcess | null = null;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private restarts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private healthyTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private stdoutBuffer = "";
  private cachedInfo: HelperInfo | null = null;
  private lastErrorText: string | null = null;

  constructor(options: HelperClientOptions) {
    super();
    this.binaryPath = options.binaryPath;
    this.spawnImpl = options.spawn ?? defaultSpawn;
    this.log = options.log ?? silentLogger;
    this.backoffMs = options.backoffMs ?? HELPER_RESTART_BACKOFF_MS;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? HELPER_DEFAULT_TIMEOUT_MS;
    this.timeoutsMs = options.timeoutsMs ?? HELPER_TIMEOUTS_MS;
    this.healthyAfterMs = options.healthyAfterMs ?? 30_000;
  }

  /** Läuft gerade ein Helfer-Prozess? */
  get running(): boolean {
    return this.child !== null;
  }

  /** Das zuletzt gelesene `info` (oder null, wenn der Helfer nie antwortete). */
  get info(): HelperInfo | null {
    return this.cachedInfo;
  }

  get lastError(): string | null {
    return this.lastErrorText;
  }

  /** Startet den Helfer (idempotent). Fehler beim Spawn führen in den Backoff. */
  start(): void {
    this.stopping = false;
    if (this.child) return;
    this.clearRestartTimer();
    let child: HelperProcess;
    try {
      child = this.spawnImpl(this.binaryPath);
    } catch (err) {
      this.lastErrorText = `Helfer konnte nicht gestartet werden: ${err instanceof Error ? err.message : String(err)}`;
      this.log.error("helper_spawn_failed", { error: this.lastErrorText });
      this.scheduleRestart();
      return;
    }
    this.child = child;
    this.stdoutBuffer = "";
    this.log.info("helper_started", { pid: child.pid ?? null, restarts: this.restarts });
    child.stdout?.setEncoding?.("utf8");
    child.stdout?.on("data", (chunk: string | Buffer) => this.onStdout(typeof chunk === "string" ? chunk : chunk.toString("utf8")));
    child.stderr?.setEncoding?.("utf8");
    child.stderr?.on("data", (chunk: string | Buffer) => {
      const text = (typeof chunk === "string" ? chunk : chunk.toString("utf8")).trim();
      if (text) this.log.debug("helper_stderr", { text: text.slice(0, 500) });
    });
    child.on("error", (err) => {
      this.lastErrorText = `Helfer-Prozessfehler: ${err.message}`;
      this.log.error("helper_process_error", { error: err.message });
    });
    child.once("exit", (code, signal) => this.onExit(child, code, signal));
    this.healthyTimer = setTimeout(() => {
      this.restarts = 0;
      this.healthyTimer = null;
    }, this.healthyAfterMs);
    this.healthyTimer.unref?.();
    this.emit("started");
    // `info` einmal nach jedem Start – die Fähigkeiten der Brücke hängen daran.
    void this.request<HelperInfo>("info")
      .then((info) => {
        this.cachedInfo = info;
        this.lastErrorText = null;
        this.emit("info", info);
      })
      .catch((err: unknown) => {
        this.log.warn("helper_info_failed", { error: err instanceof Error ? err.message : String(err) });
      });
  }

  /** Beendet den Helfer sauber (`shutdown`, dann SIGTERM) und verhindert Neustarts. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.clearRestartTimer();
    const child = this.child;
    if (!child) return;
    try {
      await this.request("shutdown", undefined, 1_500);
    } catch {
      /* Helfer antwortet nicht mehr – unten hart beenden */
    }
    if (this.child === child) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* schon weg */
      }
    }
    this.emit("stopped");
  }

  /**
   * Schickt ein Kommando und wartet auf die Antwort mit derselben `id`.
   * Zeitlimit laut Tabelle (`stt.file` 60 s, `llm.generate` 120 s, sonst 10 s).
   */
  request<T = unknown>(cmd: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    const child = this.child;
    if (!child || !child.stdin || !child.stdin.writable) {
      return Promise.reject(new HelperError("helper_unavailable"));
    }
    const id = `r${++this.seq}`;
    const limit = timeoutMs ?? this.timeoutsMs[cmd] ?? this.defaultTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HelperError("timeout", `Der Helfer hat auf „${cmd}“ nicht innerhalb von ${Math.round(limit / 1000)} s geantwortet.`));
      }, limit);
      timer.unref?.();
      this.pending.set(id, { cmd, resolve: resolve as (value: unknown) => void, reject, timer });
      const line = `${JSON.stringify(params === undefined ? { id, cmd } : { id, cmd, params })}\n`;
      try {
        child.stdin!.write(line);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new HelperError("helper_unavailable", `Schreiben an den Helfer fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let idx: number;
    while ((idx = this.stdoutBuffer.indexOf("\n")) !== -1) {
      const line = this.stdoutBuffer.slice(0, idx).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1);
      if (line.trim()) this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      this.log.warn("helper_bad_json", { length: line.length });
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const obj = msg as Record<string, unknown>;
    if (typeof obj.id === "string") {
      this.handleResponse(obj as unknown as HelperResponse);
      return;
    }
    if (typeof obj.event === "string") {
      const ev: HelperEvent = {
        event: obj.event,
        stream: typeof obj.stream === "string" ? obj.stream : undefined,
        data: obj.data,
      };
      if (ev.event === "protocol.error") {
        this.log.warn("helper_protocol_error", { data: ev.data });
      }
      this.emit("event", ev);
    }
  }

  private handleResponse(res: HelperResponse): void {
    const pending = this.pending.get(res.id);
    if (!pending) {
      this.log.debug("helper_orphan_response", { id: res.id });
      return;
    }
    this.pending.delete(res.id);
    clearTimeout(pending.timer);
    if (res.ok === true) {
      pending.resolve(res.result);
      return;
    }
    const error: HelperErrorShape | undefined = res.error;
    const code = error && typeof error.code === "string" ? error.code : "internal";
    const message = error && typeof error.message === "string" ? error.message : undefined;
    pending.reject(new HelperError(code, message));
  }

  private onExit(child: HelperProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) return;
    this.child = null;
    if (this.healthyTimer) {
      clearTimeout(this.healthyTimer);
      this.healthyTimer = null;
    }
    this.log.warn("helper_exited", { code, signal, pending: this.pending.size });
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new HelperError("helper_restarted"));
      this.pending.delete(id);
    }
    this.emit("exited", { code, signal });
    if (!this.stopping) {
      this.lastErrorText = `Der Helfer wurde beendet (Code ${code ?? signal ?? "?"}).`;
      this.scheduleRestart();
    }
  }

  private scheduleRestart(): void {
    if (this.stopping || this.restartTimer) return;
    const step = this.backoffMs[Math.min(this.restarts, this.backoffMs.length - 1)] ?? 30_000;
    this.restarts += 1;
    this.log.info("helper_restart_scheduled", { inMs: step, attempt: this.restarts });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, step);
    this.restartTimer.unref?.();
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }
}

/** Typ-Wächter für den echten Node-Kindprozess (nur für Lesbarkeit an der Aufrufstelle). */
export function asHelperProcess(child: ChildProcess): HelperProcess {
  return child as unknown as HelperProcess;
}

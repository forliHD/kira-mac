// Lädt das Diktat-Modell über den Helfer (`stt.prepare`), einmal je Sprache,
// und hält Fortschritt und Fehler für Einstellungen und Diktat. Zwei Aufrufe
// (Knopf und automatischer Start) teilen sich denselben Lauf. Kein Electron.

import { EventEmitter } from "node:events";

import { type DictationModelDownload, IDLE_MODEL_DOWNLOAD, needsAssetDownload } from "../shared/dictation-model";
import { type HelperEvent, type HelperSttStatus } from "../shared/helper-types";
import { type Logger, silentLogger } from "../shared/logger";

export interface SttAssetClient {
  request<T = unknown>(cmd: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  on(event: "event", listener: (ev: HelperEvent) => void): unknown;
  off(event: "event", listener: (ev: HelperEvent) => void): unknown;
}

interface Events {
  change: [DictationModelDownload];
  /** 0…1, nur für Aufrufer, die den laufenden Download beobachten. */
  progress: [locale: string, fraction: number];
}

export class SttAssets extends EventEmitter<Events> {
  private readonly helper: SttAssetClient;
  private readonly log: Logger;
  private current: DictationModelDownload = { ...IDLE_MODEL_DOWNLOAD };
  private readonly inflight = new Map<string, Promise<void>>();
  /** Sprachen, für die der automatische Versuch schon lief (Erfolg oder Fehler). */
  private readonly autoTried = new Set<string>();
  private lastLogged = "";

  constructor(helper: SttAssetClient, log?: Logger) {
    super();
    this.helper = helper;
    this.log = log ?? silentLogger;
    this.helper.on("event", (ev) => this.onHelperEvent(ev));
  }

  snapshot(): DictationModelDownload {
    return this.current;
  }

  /** Einmal je Sprache nach dem Start des Helfers. Ein Fehler bleibt stehen, bis jemand neu lädt. */
  async ensureAutomatic(locale: string): Promise<void> {
    if (this.autoTried.has(locale)) return;
    this.autoTried.add(locale);
    try {
      await this.ensure(locale);
    } catch (err) {
      this.log.warn("stt_prepare_failed", { locale, error: err instanceof Error ? err.message : String(err), trigger: "auto" });
    }
  }

  /**
   * Stellt das Modell bereit. Ist es schon da, passiert nichts. Fehlt es und
   * ein Download ist unmöglich, wirft die Methode den Grund des Helfers.
   */
  async ensure(locale: string, onProgress?: (fraction: number) => void): Promise<void> {
    const status = await this.readStatus(locale);
    if (!needsAssetDownload(status)) {
      if (!status.available) throw new Error(status.reason ?? "Diktat-Modell fehlt und kann auf diesem Mac nicht geladen werden.");
      return;
    }
    await this.download(locale, onProgress);
    const after = await this.readStatus(locale);
    if (!after.available) {
      throw new Error(after.reason ?? this.current.error ?? "Das Diktat-Modell ist nach dem Laden nicht verfügbar.");
    }
  }

  /** Knopf „Modell laden“: immer ein neuer Versuch, auch nach einem Fehler. */
  async download(locale: string, onProgress?: (fraction: number) => void): Promise<void> {
    const listener = onProgress
      ? (loc: string, fraction: number): void => {
          if (loc === locale) onProgress(fraction);
        }
      : null;
    if (listener) this.on("progress", listener);
    try {
      const existing = this.inflight.get(locale);
      if (existing) return await existing;
      const job = this.run(locale);
      this.inflight.set(locale, job);
      try {
        await job;
      } finally {
        if (this.inflight.get(locale) === job) this.inflight.delete(locale);
      }
    } finally {
      if (listener) this.off("progress", listener);
    }
  }

  private async run(locale: string): Promise<void> {
    this.publish({ locale, phase: "downloading", progress: 0, error: null }, true);
    this.log.info("stt_prepare_started", { locale });
    try {
      await this.helper.request("stt.prepare", { locale });
      this.publish({ locale, phase: "idle", progress: null, error: null }, true);
      this.log.info("stt_prepare_done", { locale });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.publish({ locale, phase: "failed", progress: this.current.progress, error: message }, true);
      this.log.warn("stt_prepare_failed", { locale, error: message, trigger: "download" });
      throw err instanceof Error ? err : new Error(message);
    }
  }

  private async readStatus(locale: string): Promise<HelperSttStatus> {
    const status = await this.helper.request<HelperSttStatus>("stt.status", { locale });
    this.logStatus(status, locale);
    return status;
  }

  private logStatus(status: HelperSttStatus, locale: string): void {
    const d = status.diagnostics;
    const key = [locale, status.available, status.assets, status.code ?? "", status.reason ?? "", d?.assetState ?? ""].join("|");
    if (key === this.lastLogged) return;
    this.lastLogged = key;
    // `reason` ist der deutsche Satz des Helfers – kein Diktat-Text. Der
    // Schlüssel `message` würde vom Protokoll verborgen, darum `reason`.
    this.log.info("dictation_model", {
      locale: status.locale ?? locale,
      available: status.available,
      engine: status.engine,
      assets: status.assets,
      code: status.code ?? null,
      downloadable: status.downloadable ?? null,
      assetState: d?.assetState ?? null,
      macos: d?.macos ?? null,
      arch: d?.arch ?? null,
      chip: d?.chip ?? null,
      speech: d?.speech ?? null,
      microphone: d?.microphone ?? null,
      preferred: d?.preferred ?? null,
      reason: status.reason ?? null,
    });
  }

  private onHelperEvent(ev: HelperEvent): void {
    if (ev.event !== "stt.progress") return;
    const data = (ev.data && typeof ev.data === "object" ? ev.data : {}) as Record<string, unknown>;
    const locale = typeof data.locale === "string" ? data.locale : this.current.locale;
    const fraction = typeof data.fraction === "number" ? data.fraction : null;
    if (!locale || fraction === null || !Number.isFinite(fraction)) return;
    const progress = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    this.emit("progress", locale, fraction);
    if (this.current.phase !== "downloading" || this.current.locale !== locale) {
      this.publish({ locale, phase: "downloading", progress, error: null });
      return;
    }
    if (progress === this.current.progress) return;
    this.publish({ ...this.current, progress });
  }

  /** Fortschritt nur alle 5 Punkte, Phasenwechsel sofort – sonst flutet das die Fenster. */
  private publish(next: DictationModelDownload, force = false): void {
    const prev = this.current;
    const phaseChanged = prev.phase !== next.phase || prev.error !== next.error || prev.locale !== next.locale;
    const jumped = next.progress === null || prev.progress === null || Math.abs(next.progress - prev.progress) >= 5 || next.progress === 100;
    this.current = next;
    if (!force && !phaseChanged && !jumped) return;
    this.emit("change", next);
  }
}

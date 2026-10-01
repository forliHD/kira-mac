// Benachrichtigungen ohne Web Push: SSE-Verbindung zu
// `GET /api/push/stream?endpoint=kira-app://<uuid>`. Anmeldung des Geräts
// über `POST /api/push/subscribe` beim ersten Start und bei 404
// `not_subscribed`; Reconnect mit Backoff 1/2/5/10/30 s; 60 s ohne Daten
// (der Server pingt alle 25 s als Kommentarzeile) → neu verbinden. Ein
// `notification`-Frame wird zum System-Banner – außer das Hauptfenster ist
// fokussiert: dann bekommt das Dashboard das Ereignis `notification` und es
// gibt KEIN Banner (dieselbe Regel wie dashboard/public/sw.js).

import { EventEmitter } from "node:events";

import { Notification } from "electron";

import { type NativeEvent, type ServerNotification } from "../shared/bridge";
import { scoped } from "./log";
import { type Session } from "./session";
import { SseParser, pumpSseStream } from "./sse";

const log = scoped("notifications");

export const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
export const IDLE_TIMEOUT_MS = 60_000;

export interface NotificationClientDeps {
  session: Session;
  deviceId: string;
  isMainFocused: () => boolean;
  /** Hauptfenster zeigen (Klick auf ein Banner). */
  showMain: () => void;
  /** Ereignis ins Dashboard; false, wenn gerade kein Dashboard geladen ist. */
  sendToDashboard: (event: NativeEvent) => boolean;
  /** Rückfall, wenn das Dashboard nicht geladen ist: Pfad direkt laden. */
  navigateFallback: (path: string) => void;
}

export interface NotificationClientEvents {
  connected: [];
  disconnected: [string];
  notification: [ServerNotification];
}

export function endpointFor(deviceId: string): string {
  return `kira-app://${deviceId}`;
}

/** Validiert ein `notification`-Frame; fehlende Felder bekommen Standardwerte. */
export function parseNotificationFrame(data: string): ServerNotification | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return {
    title: str(r.title) || "KIRA",
    body: str(r.body) ?? "",
    url: str(r.url),
    tag: str(r.tag),
    category: str(r.category),
    icon: str(r.icon),
  };
}

export class NotificationClient extends EventEmitter<NotificationClientEvents> {
  private readonly deps: NotificationClientDeps;
  private running = false;
  private abort: AbortController | null = null;
  private attempt = 0;
  private subscribedOnce = false;
  private loopPromise: Promise<void> | null = null;
  private wakeResolve: (() => void) | null = null;
  private connected = false;

  constructor(deps: NotificationClientDeps) {
    super();
    this.deps = deps;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get endpoint(): string {
    return endpointFor(this.deps.deviceId);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.abort?.abort();
    this.wakeResolve?.();
    await this.loopPromise?.catch(() => undefined);
    this.loopPromise = null;
  }

  /** Sofort neu verbinden (z. B. nach Instanzwechsel oder neuer Sitzung). */
  reconnectNow(): void {
    this.attempt = 0;
    this.abort?.abort();
    this.wakeResolve?.();
  }

  /** `POST /api/push/subscribe` – Stream-Geräte brauchen keine Schlüssel. */
  async subscribe(): Promise<boolean> {
    try {
      const res = await this.deps.session.fetchWithSessionRetry("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: { endpoint: this.endpoint }, prefs: null }),
      });
      if (!res.ok) {
        log.warn("push_subscribe_failed", { status: res.status });
        return false;
      }
      this.subscribedOnce = true;
      log.info("push_subscribed");
      return true;
    } catch (err) {
      log.warn("push_subscribe_error", { error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  /** `DELETE /api/push/subscribe` – „Benachrichtigungen aus“. */
  async unsubscribe(): Promise<void> {
    try {
      const res = await this.deps.session.fetchWithSessionRetry("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: this.endpoint }),
      });
      log.info("push_unsubscribed", { status: res.status });
      this.subscribedOnce = false;
    } catch (err) {
      log.warn("push_unsubscribe_error", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      if (!this.subscribedOnce) await this.subscribe();
      const outcome = await this.connectOnce();
      if (!this.running) break;
      if (outcome === "retry-now") {
        continue;
      }
      const delay = RECONNECT_BACKOFF_MS[Math.min(this.attempt, RECONNECT_BACKOFF_MS.length - 1)] ?? 30_000;
      this.attempt += 1;
      log.info("push_stream_reconnect", { inMs: delay, attempt: this.attempt });
      await this.sleep(delay);
    }
    this.setConnected(false, "gestoppt");
  }

  private async connectOnce(): Promise<"retry-now" | "backoff"> {
    const controller = new AbortController();
    this.abort = controller;
    let idleTimer: NodeJS.Timeout | null = null;
    const resetIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        log.warn("push_stream_idle", { afterMs: IDLE_TIMEOUT_MS });
        controller.abort();
      }, IDLE_TIMEOUT_MS);
      idleTimer.unref?.();
    };
    try {
      const res = await this.deps.session.fetch(`/api/push/stream?endpoint=${encodeURIComponent(this.endpoint)}`, {
        method: "GET",
        headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
        signal: controller.signal,
      });
      if (res.status === 401) {
        this.setConnected(false, "Sitzung abgelaufen");
        const ok = await this.deps.session.requestFreshSession();
        return ok ? "retry-now" : "backoff";
      }
      if (res.status === 404) {
        const text = await res.text().catch(() => "");
        if (text.includes("not_subscribed")) {
          log.info("push_stream_not_subscribed");
          const ok = await this.subscribe();
          return ok ? "retry-now" : "backoff";
        }
        this.setConnected(false, "Stream-Endpunkt fehlt (ältere KIRA-Version?)");
        return "backoff";
      }
      if (!res.ok || !res.body) {
        this.setConnected(false, `HTTP ${res.status}`);
        return "backoff";
      }
      const parser = new SseParser();
      parser.onComment(() => resetIdle());
      parser.onMessage((msg) => {
        resetIdle();
        if (msg.event === "hello") {
          this.attempt = 0;
          this.setConnected(true);
          return;
        }
        if (msg.event === "notification") {
          const frame = parseNotificationFrame(msg.data);
          if (frame) this.deliver(frame);
        }
      });
      resetIdle();
      this.attempt = 0;
      this.setConnected(true);
      await pumpSseStream(res.body, parser, controller.signal);
      this.setConnected(false, "Verbindung beendet");
      return "backoff";
    } catch (err) {
      const reason = controller.signal.aborted ? "abgebrochen" : err instanceof Error ? err.message : String(err);
      this.setConnected(false, reason);
      return "backoff";
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      if (this.abort === controller) this.abort = null;
    }
  }

  private deliver(frame: ServerNotification): void {
    this.emit("notification", frame);
    if (this.deps.isMainFocused()) {
      // Fenster im Vordergrund: In-App-Toast statt Banner (Regel aus sw.js).
      const delivered = this.deps.sendToDashboard({
        type: "notification",
        title: frame.title,
        body: frame.body,
        ...(frame.url ? { url: frame.url } : {}),
        ...(frame.category ? { category: frame.category } : {}),
      });
      if (delivered) return;
    }
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: frame.title, body: frame.body, silent: false });
    n.on("click", () => {
      this.deps.showMain();
      const target = frame.url || "/";
      if (!this.deps.sendToDashboard({ type: "navigate", url: target })) this.deps.navigateFallback(target);
    });
    n.show();
  }

  private setConnected(connected: boolean, reason = ""): void {
    if (this.connected === connected) return;
    this.connected = connected;
    if (connected) {
      log.info("push_stream_connected");
      this.emit("connected");
    } else {
      log.info("push_stream_disconnected", { reason });
      this.emit("disconnected", reason);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wakeResolve = null;
        resolve();
      }, ms);
      timer.unref?.();
      this.wakeResolve = () => {
        clearTimeout(timer);
        this.wakeResolve = null;
        resolve();
      };
    });
  }
}

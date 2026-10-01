// Die eine Stelle für Serveranfragen aus dem Hauptprozess: Bearer-Token vom
// Dashboard (`setSession`), Cookies der WebView-Sitzung (`credentials:
// "include"` – Cloudflare Access), deutsche Fehler. Die Hülle ruft NIE
// `/api/auth/refresh`: Refresh-Tokens rotieren, zwei Erneuerer machen sich
// gegenseitig ungültig. Braucht sie ein frisches Token, sendet sie
// `session-request` ans Dashboard und wartet höchstens 10 s auf `setSession`.

import { net } from "electron";

import { type SessionTokens } from "../shared/bridge";
import { type FetchLike } from "./instance";
import { scoped } from "./log";

const log = scoped("session");

export const SESSION_REQUEST_TIMEOUT_MS = 10_000;

export class InstanceError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "InstanceError";
    this.status = status;
  }
}

export class Session {
  private tokens: SessionTokens | null = null;
  private origin: string | null = null;
  private requestSessionHook: (() => void) | null = null;
  private waiters: Array<{ resolve: (ok: boolean) => void; timer: NodeJS.Timeout }> = [];
  private inflightRequest: Promise<boolean> | null = null;
  private userAgent: string | null = null;

  /** Die aktive Instanz-Origin (nach der Wahl intern/extern). */
  setOrigin(origin: string | null): void {
    if (this.origin !== origin) {
      this.origin = origin;
      log.info("session_origin", { origin });
    }
  }

  getOrigin(): string | null {
    return this.origin;
  }

  setUserAgent(ua: string): void {
    this.userAgent = ua;
  }

  /** Vom Dashboard über `setSession`: Tokens oder null (Abmeldung, Cloudflare Access). */
  setTokens(tokens: SessionTokens | null): void {
    this.tokens = tokens;
    log.info("session_tokens", { present: tokens !== null });
    if (tokens) {
      const waiters = this.waiters;
      this.waiters = [];
      for (const w of waiters) {
        clearTimeout(w.timer);
        w.resolve(true);
      }
    }
  }

  hasTokens(): boolean {
    return this.tokens !== null;
  }

  /** index.ts hängt hier das Senden von `session-request` ans Hauptfenster ein. */
  onSessionRequest(hook: () => void): void {
    this.requestSessionHook = hook;
  }

  /**
   * Bittet das Dashboard um frische Tokens und wartet bis zu 10 s auf
   * `setSession`. Mehrere gleichzeitige Bitten teilen sich eine Anfrage.
   */
  requestFreshSession(timeoutMs: number = SESSION_REQUEST_TIMEOUT_MS): Promise<boolean> {
    if (this.inflightRequest) return this.inflightRequest;
    const hook = this.requestSessionHook;
    if (!hook) return Promise.resolve(false);
    const p = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        resolve(false);
      }, timeoutMs);
      timer.unref?.();
      this.waiters.push({ resolve, timer });
      try {
        hook();
      } catch (err) {
        log.warn("session_request_hook_failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }).finally(() => {
      this.inflightRequest = null;
    });
    this.inflightRequest = p;
    return p;
  }

  /** Vollständige URL für einen Pfad der aktiven Instanz. */
  url(path: string): string {
    if (!this.origin) throw new InstanceError("Keine Instanz verbunden.");
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.origin}${path.startsWith("/") ? path : `/${path}`}`;
  }

  /**
   * `net.fetch` mit Cookies der WebView-Sitzung und, falls vorhanden, Bearer.
   * Wirft `InstanceError` bei Netzfehlern; HTTP-Status prüft der Aufrufer.
   */
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const url = this.url(path);
    const headers = new Headers(init.headers ?? {});
    if (this.tokens && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${this.tokens.accessToken}`);
    if (this.userAgent && !headers.has("User-Agent")) headers.set("User-Agent", this.userAgent);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    try {
      return await net.fetch(url, { ...init, headers, credentials: "include" });
    } catch (err) {
      throw new InstanceError(`Instanz nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`, null, { cause: err });
    }
  }

  /** Anfrage, die bei 401 einmal um eine frische Sitzung bittet und wiederholt. */
  async fetchWithSessionRetry(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.fetch(path, init);
    if (res.status !== 401) return res;
    const ok = await this.requestFreshSession();
    if (!ok) return res;
    return this.fetch(path, init);
  }

  /** JSON-Anfrage; wirft bei Nicht-2xx mit deutscher Ursache. */
  async fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchWithSessionRetry(path, init);
    if (!res.ok) {
      let detail = "";
      try {
        const body: unknown = await res.json();
        if (body && typeof body === "object" && typeof (body as { detail?: unknown }).detail === "string") {
          detail = (body as { detail: string }).detail;
        }
      } catch {
        /* kein JSON */
      }
      throw new InstanceError(`Instanz antwortet mit HTTP ${res.status}${detail ? `: ${detail}` : "."}`, res.status);
    }
    return (await res.json()) as T;
  }

  /** `fetch` ohne Pfad-Auflösung, für Proben beliebiger Origins (instance.ts). */
  get rawFetch(): FetchLike {
    return async (url, init) => {
      const headers = new Headers(init?.headers ?? {});
      if (this.userAgent && !headers.has("User-Agent")) headers.set("User-Agent", this.userAgent);
      return net.fetch(url, { ...init, headers, credentials: "include" });
    };
  }
}

export const session = new Session();

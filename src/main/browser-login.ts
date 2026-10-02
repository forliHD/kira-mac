// Anmeldung beim Identitätsanbieter im System-Browser (RFC 8252 + PKCE,
// Vertrag kira/docs/native-bridge.md, KIRA ab 3.299.0).
//
// Warum: Im App-Fenster (Electron) erreichen Passkeys weder den iCloud-
// Schlüsselbund noch das Handy oder einen Sicherheitsschlüssel – Microsofts
// Abfrage „Face, fingerprint, PIN or security key“ wartet dort endlos.
// `app.configureWebAuthn` kennt nur gerätegebundene Touch-ID-Schlüssel.
//
// Ablauf: Das Dashboard ruft `signInWithBrowser()`. Wir erzeugen ein
// Geheimnis (code_verifier) und öffnen `/api/auth/app/login` im Browser. Nach
// der Anmeldung öffnet der Browser `de.kira.mac:/auth/callback?code=…&state=…`;
// macOS gibt die Adresse an die App (`open-url`). Wir prüfen `state`, lösen
// den Einmalcode mit dem Geheimnis bei `POST /api/auth/app/token` ein und
// laden `/auth/callback#access_token=…` im Hauptfenster – ab da übernimmt das
// Dashboard wie nach jeder Anmeldung (Tokens speichern, `setSession`).

import { createHash, randomBytes } from "node:crypto";

import { type Logger, silentLogger } from "../shared/logger";

export const URL_SCHEME = "de.kira.mac";
export const APP_REDIRECT_URI = `${URL_SCHEME}:/auth/callback`;
/** So lange wartet die App auf die Rückkehr aus dem Browser. */
export const PENDING_TTL_MS = 10 * 60 * 1000;

export type BrowserLoginStatus = "error" | "expired" | "cancelled";

export interface BrowserLoginResult {
  started: boolean;
  error?: string;
}

export interface LoginTokens {
  accessToken: string;
  refreshToken: string;
}

export interface BrowserLoginDeps {
  openExternal: (url: string) => Promise<void>;
  /** POST mit JSON über die Sitzung der WebView (Cloudflare-Cookie, User-Agent der App). */
  postJson: (url: string, body: unknown) => Promise<{ status: number; body: unknown }>;
  /** Tokens ins Dashboard bringen (Hauptfenster lädt /auth/callback#…) und App nach vorn. */
  complete: (origin: string, tokens: LoginTokens) => void;
  /** Rückmeldung an das Dashboard (Ereignis `browser-login`). */
  report: (status: BrowserLoginStatus, message?: string) => void;
  /** Ohne laufende Anmeldung kam eine Rückkehr an (z. B. App neu gestartet). */
  onStray?: () => void;
  now?: () => number;
  random?: (bytes: number) => Buffer;
  log?: Logger;
}

interface Pending {
  origin: string;
  verifier: string;
  state: string;
  startedAt: number;
}

export interface ParsedCallback {
  state: string;
  code: string;
  /** Verschlüsseltes Cloudflare-Access-Token (access-login.ts), sonst leer. */
  access: string;
  error: string;
  message: string;
}

export function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE S256: base64url(sha256(verifier)) ohne Auffüllung. */
export function challengeFor(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export function buildLoginUrl(origin: string, challenge: string, state: string): string {
  const url = new URL("/api/auth/app/login", origin);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", APP_REDIRECT_URI);
  return url.toString();
}

/**
 * `de.kira.mac:/auth/callback?…` zerlegen. Manche Browser schreiben die
 * Adresse als `de.kira.mac://auth/callback` – beides gilt, alles andere nicht.
 */
export function parseCallback(raw: string): ParsedCallback | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${URL_SCHEME}:`) return null;
  const path = `${url.host ? `/${url.host}` : ""}${url.pathname}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  if (path !== "/auth/callback") return null;
  const get = (key: string): string => (url.searchParams.get(key) ?? "").trim();
  return { state: get("state"), code: get("code"), access: get("access"), error: get("error"), message: get("error_description").slice(0, 300) };
}

function detailOf(body: unknown): string {
  if (body && typeof body === "object" && typeof (body as { detail?: unknown }).detail === "string") {
    return (body as { detail: string }).detail;
  }
  return "";
}

function tokensOf(body: unknown): LoginTokens | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.access_token !== "string" || typeof b.refresh_token !== "string") return null;
  if (!b.access_token || !b.refresh_token) return null;
  return { accessToken: b.access_token, refreshToken: b.refresh_token };
}

export class BrowserLogin {
  private pending: Pending | null = null;
  private readonly deps: BrowserLoginDeps;
  private readonly log: Logger;

  constructor(deps: BrowserLoginDeps) {
    this.deps = deps;
    this.log = deps.log ?? silentLogger;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private random(bytes: number): Buffer {
    return this.deps.random ? this.deps.random(bytes) : randomBytes(bytes);
  }

  /** Läuft gerade eine Anmeldung im Browser? */
  isPending(): boolean {
    return this.pending !== null && this.now() - this.pending.startedAt <= PENDING_TTL_MS;
  }

  /**
   * Neue Anmeldung starten (ersetzt eine laufende – „Browser erneut öffnen“
   * soll nicht an einem alten Geheimnis hängen bleiben).
   */
  async start(origin: string): Promise<BrowserLoginResult> {
    let base: string;
    try {
      base = new URL(origin).origin;
    } catch {
      return { started: false, error: "Ungültige Instanz-Adresse." };
    }
    const verifier = base64url(this.random(32)); // 43 Zeichen (RFC 7636: 43–128)
    const state = base64url(this.random(18)); // 24 Zeichen
    this.pending = { origin: base, verifier, state, startedAt: this.now() };
    try {
      await this.deps.openExternal(buildLoginUrl(base, challengeFor(verifier), state));
      this.log.info("browser_login_started", { origin: base });
      return { started: true };
    } catch (err) {
      this.pending = null;
      const reason = err instanceof Error ? err.message : String(err);
      this.log.warn("browser_login_open_failed", { error: reason });
      return { started: false, error: `Der Browser ließ sich nicht öffnen: ${reason}` };
    }
  }

  /** Abbrechen (z. B. Abmelden); eine spätere Rückkehr wird ignoriert. */
  cancel(): void {
    if (!this.pending) return;
    this.pending = null;
    this.deps.report("cancelled");
  }

  /**
   * Rückkehr aus dem Browser (`open-url`). Ergebnis: "done", "error" oder
   * "ignored" (fremde Adresse, unbekannter `state`).
   */
  async handleCallback(raw: string): Promise<"done" | "error" | "ignored"> {
    const parsed = parseCallback(raw);
    if (!parsed) {
      this.log.warn("browser_login_foreign_url");
      return "ignored";
    }
    const pending = this.pending;
    if (!pending) {
      // App wurde dazwischen neu gestartet, oder die Rückkehr kam doppelt.
      this.log.warn("browser_login_without_pending");
      this.deps.onStray?.();
      return "ignored";
    }
    if (!parsed.state || parsed.state !== pending.state) {
      this.log.warn("browser_login_state_mismatch");
      return "ignored";
    }
    this.pending = null;
    if (this.now() - pending.startedAt > PENDING_TTL_MS) {
      this.deps.report("expired", "Die Anmeldung im Browser hat zu lange gedauert. Bitte erneut anmelden.");
      return "error";
    }
    if (parsed.error || !parsed.code) {
      this.log.warn("browser_login_denied", { error: parsed.error || "no_code" });
      this.deps.report("error", parsed.message || "Die Anmeldung wurde im Browser abgebrochen.");
      return "error";
    }
    let res: { status: number; body: unknown };
    try {
      res = await this.deps.postJson(`${pending.origin}/api/auth/app/token`, { code: parsed.code, code_verifier: pending.verifier });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log.warn("browser_login_redeem_failed", { error: reason });
      this.deps.report("error", `Der KIRA-Server ist nicht erreichbar: ${reason}`);
      return "error";
    }
    const tokens = res.status === 200 ? tokensOf(res.body) : null;
    if (!tokens) {
      const detail = detailOf(res.body);
      this.log.warn("browser_login_redeem_refused", { status: res.status });
      this.deps.report("error", detail || `Die Anmeldung wurde vom Server abgelehnt (HTTP ${res.status}).`);
      return "error";
    }
    this.log.info("browser_login_done", { origin: pending.origin });
    this.deps.complete(pending.origin, tokens);
    return "done";
  }
}

/** Ziel im Hauptfenster: das Dashboard speichert die Tokens und räumt die Adresse auf. */
export function callbackPath(tokens: LoginTokens): string {
  const params = new URLSearchParams({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
  return `/auth/callback#${params.toString()}`;
}

// Cloudflare-Access-Anmeldung im System-Browser (KIRA ab 3.300.0, Vertrag
// kira/docs/native-bridge.md „Cloudflare Access im System-Browser“).
//
// Warum: Hinter Cloudflare Access leitet die externe Adresse das App-Fenster
// auf die Access-Anmeldung um, und die hängt bei einem Passkey-Anbieter
// (Microsoft) endlos – Electron erreicht keine Passkeys. Ein Einmalcode wie in
// browser-login.ts geht hier nicht: Ohne Access-Cookie hält Access auch das
// Einlösen am Rand auf.
//
// Ablauf: Wir erzeugen ein Einmal-Schlüsselpaar (X25519) und `state` und öffnen
// `/api/auth/app/access` im Browser. Access meldet dort an und lässt die
// Anfrage durch; KIRA prüft das Access-Token und schickt es verschlüsselt an
// `de.kira.mac:/auth/callback?state=…&access=…` (X25519 → HKDF-SHA256 →
// AES-256-GCM, `state` als Zusatzdaten; Gegenstück kira/core/utils/
// app_handover.py). Wir entschlüsseln, setzen es als Cookie `CF_Authorization`
// der Instanz und laden neu. Der private Schlüssel verlässt den Hauptprozess
// nie, das Token landet nie im Protokoll.

import { type KeyObject, createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";

import { type Logger, silentLogger } from "../shared/logger";
import { APP_REDIRECT_URI, PENDING_TTL_MS, base64url, parseCallback } from "./browser-login";

export const HANDOVER_VERSION = 1;
export const HANDOVER_INFO = "kira-app-handover-v1";
/** Das Cookie, das Cloudflare Access für die Anwendung erwartet. */
export const ACCESS_COOKIE = "CF_Authorization";
/** Ein Access-Token ist ein JWT von gut 1 KB; alles weit darüber ist kein Token. */
const MAX_TOKEN_LENGTH = 16_384;
/** Kürzer gültig als das ist sinnlos – die Anmeldung begänne sofort von vorn. */
const MIN_REMAINING_S = 60;

export type AccessLoginStatus = "error" | "expired";

export interface AccessKeyPair {
  privateKey: KeyObject;
  /** Roh-Schlüssel (32 Byte), so geht er base64url an den Server. */
  publicRaw: Buffer;
}

export interface AccessLoginDeps {
  openExternal: (url: string) => Promise<void>;
  /** Token als Cookie der Instanz setzen (`expiresAt` in Sekunden seit 1970). */
  setCookie: (origin: string, token: string, expiresAt: number) => Promise<void>;
  /** Cookie sitzt: Instanz neu laden, App nach vorn. */
  complete: (origin: string) => void;
  /** Rückmeldung an die Anmeldeseite im Hauptfenster. */
  report: (status: AccessLoginStatus, message: string) => void;
  now?: () => number;
  random?: (bytes: number) => Buffer;
  generateKey?: () => AccessKeyPair;
  log?: Logger;
}

interface Pending {
  origin: string;
  state: string;
  key: AccessKeyPair;
  startedAt: number;
}

export function generateAccessKey(): AccessKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const x = publicKey.export({ format: "jwk" }).x;
  if (!x) throw new Error("X25519-Schlüssel ohne öffentlichen Teil.");
  return { privateKey, publicRaw: Buffer.from(x, "base64url") };
}

/** Leitet Cloudflare Access auf seine Anmeldung um (`<team>.cloudflareaccess.com`)? */
export function isAccessLoginUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".cloudflareaccess.com");
  } catch {
    return false;
  }
}

export function buildAccessUrl(origin: string, publicRaw: Buffer, state: string): string {
  const url = new URL("/api/auth/app/access", origin);
  url.searchParams.set("state", state);
  url.searchParams.set("key", base64url(publicRaw));
  url.searchParams.set("redirect_uri", APP_REDIRECT_URI);
  return url.toString();
}

/**
 * Entschlüsselt die Übergabe des Servers. Format (base64url):
 * `0x01 ‖ Server-Schlüssel (32) ‖ Nonce (12) ‖ Chiffrat ‖ GCM-Tag (16)`.
 * Wirft bei falschem Schlüssel, falschem `state` oder kaputten Daten.
 */
export function openHandover(sealed: string, key: AccessKeyPair, state: string): string {
  const raw = Buffer.from(sealed, "base64url");
  if (raw.length < 1 + 32 + 12 + 16 || raw[0] !== HANDOVER_VERSION) throw new Error("Unbekanntes Übergabeformat.");
  const serverRaw = raw.subarray(1, 33);
  const nonce = raw.subarray(33, 45);
  const body = raw.subarray(45, raw.length - 16);
  const tag = raw.subarray(raw.length - 16);
  const serverKey = createPublicKey({ key: { kty: "OKP", crv: "X25519", x: serverRaw.toString("base64url") }, format: "jwk" });
  const shared = diffieHellman({ privateKey: key.privateKey, publicKey: serverKey });
  const aesKey = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([serverRaw, key.publicRaw]), Buffer.from(HANDOVER_INFO), 32));
  const decipher = createDecipheriv("aes-256-gcm", aesKey, nonce);
  decipher.setAAD(Buffer.from(state));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/** Ablauf (`exp`, Sekunden) eines JWT – ohne Signaturprüfung, die macht Access. */
export function tokenExpiry(token: string): number | null {
  if (token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8"));
    const exp = payload && typeof payload === "object" ? (payload as { exp?: unknown }).exp : undefined;
    return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

export class AccessLogin {
  private pending: Pending | null = null;
  private readonly deps: AccessLoginDeps;
  private readonly log: Logger;

  constructor(deps: AccessLoginDeps) {
    this.deps = deps;
    this.log = deps.log ?? silentLogger;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /** Läuft gerade eine Access-Anmeldung im Browser? */
  isPending(): boolean {
    return this.pending !== null && this.now() - this.pending.startedAt <= PENDING_TTL_MS;
  }

  /** Neue Anmeldung starten (ersetzt eine laufende, „Browser erneut öffnen“). */
  async start(origin: string): Promise<{ started: boolean; error?: string }> {
    let base: string;
    try {
      base = new URL(origin).origin;
    } catch {
      return { started: false, error: "Ungültige Instanz-Adresse." };
    }
    const random = this.deps.random ?? randomBytes;
    const state = base64url(random(18)); // 24 Zeichen
    const key = (this.deps.generateKey ?? generateAccessKey)();
    this.pending = { origin: base, state, key, startedAt: this.now() };
    try {
      await this.deps.openExternal(buildAccessUrl(base, key.publicRaw, state));
      this.log.info("access_login_started", { origin: base });
      return { started: true };
    } catch (err) {
      this.pending = null;
      const reason = err instanceof Error ? err.message : String(err);
      this.log.warn("access_login_open_failed", { error: reason });
      return { started: false, error: `Der Browser ließ sich nicht öffnen: ${reason}` };
    }
  }

  /** Gehört diese Rückkehr zu unserer laufenden Anmeldung (gleicher `state`)? */
  owns(raw: string): boolean {
    const parsed = parseCallback(raw);
    return Boolean(parsed && this.pending && parsed.state && parsed.state === this.pending.state);
  }

  cancel(): void {
    this.pending = null;
  }

  /** Rückkehr aus dem Browser. Nur aufrufen, wenn `owns(raw)` gilt. */
  async handleCallback(raw: string): Promise<"done" | "error" | "ignored"> {
    const parsed = parseCallback(raw);
    const pending = this.pending;
    if (!parsed || !pending || !parsed.state || parsed.state !== pending.state) return "ignored";
    this.pending = null;
    const origin = pending.origin;
    if (this.now() - pending.startedAt > PENDING_TTL_MS) {
      this.deps.report("expired", "Die Anmeldung im Browser hat zu lange gedauert. Bitte erneut anmelden.");
      return "error";
    }
    if (parsed.error || !parsed.access) {
      this.log.warn("access_login_denied", { error: parsed.error || "no_access" });
      this.deps.report("error", parsed.message || "Die Anmeldung wurde im Browser abgebrochen.");
      return "error";
    }
    let token: string;
    try {
      token = openHandover(parsed.access, pending.key, pending.state);
    } catch (err) {
      this.log.warn("access_login_unseal_failed", { error: err instanceof Error ? err.message : String(err) });
      this.deps.report("error", "Die Antwort des Servers ließ sich nicht lesen. Bitte erneut anmelden.");
      return "error";
    }
    const exp = tokenExpiry(token);
    if (exp === null || exp - this.now() / 1000 < MIN_REMAINING_S) {
      this.log.warn("access_login_token_unusable", { exp: exp !== null });
      this.deps.report("error", "Cloudflare Access hat kein gültiges Token geliefert. Bitte erneut anmelden.");
      return "error";
    }
    try {
      await this.deps.setCookie(origin, token, exp);
    } catch (err) {
      this.log.warn("access_login_cookie_failed", { error: err instanceof Error ? err.message : String(err) });
      this.deps.report("error", "Die Anmeldung ließ sich in der App nicht speichern.");
      return "error";
    }
    this.log.info("access_login_done", { origin, validForMin: Math.round((exp - this.now() / 1000) / 60) });
    this.deps.complete(origin);
    return "done";
  }
}

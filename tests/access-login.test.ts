import { createCipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ACCESS_COOKIE,
  AccessLogin,
  type AccessKeyPair,
  type AccessLoginDeps,
  HANDOVER_INFO,
  buildAccessUrl,
  generateAccessKey,
  isAccessLoginUrl,
  openHandover,
  tokenExpiry,
} from "../src/main/access-login";
import { APP_REDIRECT_URI, PENDING_TTL_MS } from "../src/main/browser-login";

// Cloudflare-Access-Anmeldung im System-Browser: Schlüssel, Übergabe des
// Servers (kira/core/utils/app_handover.py), Cookie, Fehlerwege.

const ORIGIN = "https://kira.example.de";
const STATE = "app-state-0123456789";

// Fester Prüfvektor aus kira/tests/test_app_access_login.py – beide Seiten
// müssen ihn lesen können, sonst passen Server und App nicht zusammen.
const VECTOR_APP_PRIVATE = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const VECTOR_APP_PUBLIC = "B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9_AsrhtHHw";
const VECTOR_SECRET = "eyJhbGciOiJSUzI1NiJ9.eyJlbWFpbCI6InRlc3RAa2lyYS5kZSJ9.c2ln";
const VECTOR_SEALED =
  "AVcUdp0Ra_dkNq50vHk9LDCtGQPFmsUnOAXH4mmLQQw2AAECAwQFBgcICQoLRxtcGa5S4JJWpHqB6zELquJFPNCaAZup" +
  "Sl9mivatnQYCWPPOMKoVVPah0hgkhhCQoX0lEbX2NhmEJxOf9106psGTTPjsG6llDiM";

function keyFromRaw(raw: Buffer): AccessKeyPair {
  // PKCS#8-Hülle eines X25519-Schlüssels (RFC 8410) um die 32 Rohbytes.
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), raw]), format: "der", type: "pkcs8" });
  const x = createPublicKey(privateKey).export({ format: "jwk" }).x ?? "";
  return { privateKey, publicRaw: Buffer.from(x, "base64url") };
}

/** Was der Server tut (app_handover.seal), für Rundläufe mit Zufallsschlüsseln. */
function seal(secret: string, appPublic: Buffer, state: string): string {
  const eph = generateKeyPairSync("x25519");
  const ephRaw = Buffer.from(eph.publicKey.export({ format: "jwk" }).x ?? "", "base64url");
  const appKey = createPublicKey({ key: { kty: "OKP", crv: "X25519", x: appPublic.toString("base64url") }, format: "jwk" });
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: appKey });
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([ephRaw, appPublic]), Buffer.from(HANDOVER_INFO), 32));
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(state));
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), ephRaw, nonce, body, cipher.getAuthTag()]).toString("base64url");
}

function jwt(exp: number | null): string {
  const part = (v: object): string => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${part({ alg: "RS256", kid: "k1" })}.${part(exp === null ? { email: "lucas@example.de" } : { email: "lucas@example.de", exp })}.c2lnbmF0dXJl`;
}

type TestDeps = AccessLoginDeps & {
  opened: string[];
  cookies: Array<{ origin: string; token: string; expiresAt: number }>;
  completed: string[];
  reports: Array<{ status: string; message: string }>;
  key: AccessKeyPair;
  advance: (ms: number) => void;
};

function deps(over: Partial<AccessLoginDeps> = {}): TestDeps {
  const opened: string[] = [];
  const cookies: Array<{ origin: string; token: string; expiresAt: number }> = [];
  const completed: string[] = [];
  const reports: Array<{ status: string; message: string }> = [];
  const key = generateAccessKey();
  let clock = 1_800_000_000_000;
  return {
    openExternal: async (url: string) => {
      opened.push(url);
    },
    setCookie: async (origin: string, token: string, expiresAt: number) => {
      cookies.push({ origin, token, expiresAt });
    },
    complete: (origin: string) => {
      completed.push(origin);
    },
    report: (status, message) => {
      reports.push({ status, message });
    },
    now: () => clock,
    random: (n: number) => Buffer.alloc(n, 9),
    generateKey: () => key,
    ...over,
    opened,
    cookies,
    completed,
    reports,
    key,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function callback(params: Record<string, string>): string {
  return `${APP_REDIRECT_URI}?${new URLSearchParams(params).toString()}`;
}

async function started(d: TestDeps): Promise<{ login: AccessLogin; state: string }> {
  const login = new AccessLogin(d);
  expect(await login.start(`${ORIGIN}/chat`)).toEqual({ started: true });
  const url = new URL(d.opened[0] ?? "");
  return { login, state: url.searchParams.get("state") ?? "" };
}

describe("Übergabe (Format des Servers)", () => {
  it("liest den festen Prüfvektor des Servers", () => {
    const key = keyFromRaw(VECTOR_APP_PRIVATE);
    expect(key.publicRaw.toString("base64url")).toBe(VECTOR_APP_PUBLIC);
    expect(openHandover(VECTOR_SEALED, key, STATE)).toBe(VECTOR_SECRET);
  });

  it("scheitert mit fremdem Schlüssel, fremdem state oder verändertem Chiffrat", () => {
    const key = keyFromRaw(VECTOR_APP_PRIVATE);
    expect(() => openHandover(VECTOR_SEALED, generateAccessKey(), STATE)).toThrow();
    expect(() => openHandover(VECTOR_SEALED, key, "anderer-state-0123456789")).toThrow();
    const raw = Buffer.from(VECTOR_SEALED, "base64url");
    raw[60] = (raw[60] ?? 0) ^ 1;
    expect(() => openHandover(raw.toString("base64url"), key, STATE)).toThrow();
    expect(() => openHandover("AQ", key, STATE)).toThrow("Unbekanntes Übergabeformat.");
  });

  it("Rundlauf mit frischem Schlüssel", () => {
    const key = generateAccessKey();
    expect(key.publicRaw).toHaveLength(32);
    expect(openHandover(seal("a.b.c", key.publicRaw, STATE), key, STATE)).toBe("a.b.c");
  });
});

describe("Hilfen", () => {
  it("erkennt die Access-Anmeldung", () => {
    expect(isAccessLoginUrl("https://it-reiser.cloudflareaccess.com/cdn-cgi/access/login/kira.example.de?kid=1")).toBe(true);
    expect(isAccessLoginUrl("https://kira.example.de/cdn-cgi/access/login")).toBe(false);
    expect(isAccessLoginUrl("https://cloudflareaccess.com.evil.example/")).toBe(false);
    expect(isAccessLoginUrl("http://team.cloudflareaccess.com/")).toBe(false);
    expect(isAccessLoginUrl("kein url")).toBe(false);
  });

  it("baut die Start-Adresse", () => {
    const url = new URL(buildAccessUrl(ORIGIN, Buffer.alloc(32, 1), STATE));
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/api/auth/app/access`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ state: STATE, key: Buffer.alloc(32, 1).toString("base64url"), redirect_uri: APP_REDIRECT_URI });
  });

  it("liest den Ablauf eines JWT", () => {
    expect(tokenExpiry(jwt(1_800_003_600))).toBe(1_800_003_600);
    expect(tokenExpiry(jwt(null))).toBeNull();
    expect(tokenExpiry("a.b")).toBeNull();
    expect(tokenExpiry("a.b.c d")).toBeNull();
    expect(tokenExpiry(`${"a".repeat(20_000)}.b.c`)).toBeNull();
  });
});

describe("AccessLogin", () => {
  it("öffnet den Browser, entschlüsselt, setzt das Cookie und lädt neu", async () => {
    const d = deps();
    const { login, state } = await started(d);
    expect(new URL(d.opened[0] ?? "").searchParams.get("key")).toBe(d.key.publicRaw.toString("base64url"));
    expect(login.isPending()).toBe(true);
    const token = jwt(1_800_000_000 + 24 * 3600);
    const url = callback({ state, access: seal(token, d.key.publicRaw, state) });
    expect(login.owns(url)).toBe(true);
    expect(await login.handleCallback(url)).toBe("done");
    expect(d.cookies).toEqual([{ origin: ORIGIN, token, expiresAt: 1_800_000_000 + 24 * 3600 }]);
    expect(d.completed).toEqual([ORIGIN]);
    expect(d.reports).toEqual([]);
    expect(login.isPending()).toBe(false);
    // Einmalig: dieselbe Rückkehr ein zweites Mal gehört niemandem mehr.
    expect(login.owns(url)).toBe(false);
    expect(await login.handleCallback(url)).toBe("ignored");
  });

  it("fremder state gehört nicht uns (dann ist es die SSO-Anmeldung)", async () => {
    const d = deps();
    const { login } = await started(d);
    const url = callback({ state: "fremder-state-0123456789", code: "abc" });
    expect(login.owns(url)).toBe(false);
    expect(await login.handleCallback(url)).toBe("ignored");
    expect(login.isPending()).toBe(true);
  });

  it("meldet Fehler des Servers", async () => {
    const d = deps();
    const { login, state } = await started(d);
    expect(await login.handleCallback(callback({ state, error: "access_denied", error_description: "Dieser Account ist deaktiviert." }))).toBe("error");
    expect(d.reports).toEqual([{ status: "error", message: "Dieser Account ist deaktiviert." }]);
    expect(d.cookies).toEqual([]);
  });

  it("lehnt eine Übergabe für einen anderen Schlüssel ab", async () => {
    const d = deps();
    const { login, state } = await started(d);
    const other = generateAccessKey();
    expect(await login.handleCallback(callback({ state, access: seal(jwt(1_800_090_000), other.publicRaw, state) }))).toBe("error");
    expect(d.reports[0]?.message).toBe("Die Antwort des Servers ließ sich nicht lesen. Bitte erneut anmelden.");
    expect(d.cookies).toEqual([]);
  });

  it("lehnt abgelaufene oder kaputte Tokens ab", async () => {
    for (const token of [jwt(1_800_000_030), jwt(null), "kein-jwt"]) {
      const d = deps();
      const { login, state } = await started(d);
      expect(await login.handleCallback(callback({ state, access: seal(token, d.key.publicRaw, state) }))).toBe("error");
      expect(d.reports[0]?.message).toBe("Cloudflare Access hat kein gültiges Token geliefert. Bitte erneut anmelden.");
      expect(d.cookies).toEqual([]);
    }
  });

  it("zu spät zurück → abgelaufen", async () => {
    const d = deps();
    const { login, state } = await started(d);
    d.advance(PENDING_TTL_MS + 1);
    expect(login.isPending()).toBe(false);
    expect(await login.handleCallback(callback({ state, access: seal(jwt(1_800_090_000), d.key.publicRaw, state) }))).toBe("error");
    expect(d.reports[0]?.status).toBe("expired");
    expect(d.cookies).toEqual([]);
  });

  it("Cookie lässt sich nicht setzen → Fehler statt Neuladen", async () => {
    const d = deps({
      setCookie: async () => {
        throw new Error("Failed to set cookie");
      },
    });
    const { login, state } = await started(d);
    expect(await login.handleCallback(callback({ state, access: seal(jwt(1_800_090_000), d.key.publicRaw, state) }))).toBe("error");
    expect(d.completed).toEqual([]);
    expect(d.reports[0]?.message).toBe("Die Anmeldung ließ sich in der App nicht speichern.");
  });

  it("Browser lässt sich nicht öffnen", async () => {
    const d = deps({
      openExternal: async () => {
        throw new Error("kein Standardbrowser");
      },
    });
    const login = new AccessLogin(d);
    expect(await login.start(ORIGIN)).toEqual({ started: false, error: "Der Browser ließ sich nicht öffnen: kein Standardbrowser" });
    expect(login.isPending()).toBe(false);
    expect(await new AccessLogin(deps()).start("kein-origin")).toEqual({ started: false, error: "Ungültige Instanz-Adresse." });
  });

  it("das Cookie heißt wie bei Cloudflare", () => {
    expect(ACCESS_COOKIE).toBe("CF_Authorization");
  });
});

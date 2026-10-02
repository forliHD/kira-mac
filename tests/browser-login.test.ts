import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  APP_REDIRECT_URI,
  BrowserLogin,
  type BrowserLoginDeps,
  type BrowserLoginStatus,
  type LoginTokens,
  PENDING_TTL_MS,
  buildLoginUrl,
  callbackPath,
  challengeFor,
  parseCallback,
} from "../src/main/browser-login";

// SSO im System-Browser (RFC 8252 + PKCE): Start, Rückkehr über
// de.kira.mac:/auth/callback, Einlösen des Einmalcodes, Fehlerwege.

const ORIGIN = "http://192.168.178.166";

type TestDeps = BrowserLoginDeps & {
  opened: string[];
  reports: Array<{ status: string; message?: string }>;
  completed: Array<{ origin: string; accessToken: string; refreshToken: string }>;
  advance: (ms: number) => void;
};

function deps(over: Partial<BrowserLoginDeps> = {}): TestDeps {
  const opened: string[] = [];
  const reports: Array<{ status: string; message?: string }> = [];
  const completed: Array<{ origin: string; accessToken: string; refreshToken: string }> = [];
  let clock = 1_000_000;
  const base: BrowserLoginDeps = {
    openExternal: async (url: string) => {
      opened.push(url);
    },
    postJson: vi.fn(async () => ({ status: 200, body: { access_token: "acc.ess", refresh_token: "ref.resh", token_type: "bearer" } })),
    complete: (origin: string, tokens: LoginTokens) => {
      completed.push({ origin, ...tokens });
    },
    report: (status: BrowserLoginStatus, message?: string) => {
      reports.push({ status, message });
    },
    now: () => clock,
    random: (n: number) => Buffer.alloc(n, 7),
  };
  return {
    ...base,
    ...over,
    opened,
    reports,
    completed,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function stateOf(url: string): string {
  return new URL(url).searchParams.get("state") ?? "";
}

describe("Bausteine", () => {
  it("PKCE S256 rechnet wie der KIRA-Server (routes/oidc.py::_s256)", () => {
    // Wert mit Python berechnet: base64url(sha256(verifier)) ohne „=“.
    expect(challengeFor("dBjftJeZ4CVP-mJ92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("ngF5GsXcbwljx6u133FFr3Xht9xooA_DuaX_3QwODtc");
    const v = "x".repeat(43);
    expect(challengeFor(v)).toBe(createHash("sha256").update(v).digest("base64url"));
  });

  it("baut die Start-Adresse mit festem Rücksprungziel", () => {
    const url = new URL(buildLoginUrl(`${ORIGIN}/`, "c".repeat(43), "s".repeat(24)));
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/api/auth/app/login`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      code_challenge: "c".repeat(43),
      code_challenge_method: "S256",
      state: "s".repeat(24),
      redirect_uri: APP_REDIRECT_URI,
    });
  });

  it("erkennt nur die eigene Rücksprung-Adresse", () => {
    expect(parseCallback("de.kira.mac:/auth/callback?code=abc&state=xyz")).toEqual({ state: "xyz", code: "abc", access: "", error: "", message: "" });
    expect(parseCallback("de.kira.mac://auth/callback?code=abc&state=xyz")?.code).toBe("abc");
    expect(parseCallback("de.kira.mac:/auth/callback/?error=access_denied&error_description=Nein&state=s")).toMatchObject({
      error: "access_denied",
      message: "Nein",
    });
    expect(parseCallback("de.kira.mac:/andere/seite?code=abc")).toBeNull();
    expect(parseCallback("https://evil.example/auth/callback?code=abc")).toBeNull();
    expect(parseCallback("kein url")).toBeNull();
  });

  it("legt die Tokens ins Fragment (nie in die Abfrage)", () => {
    const path = callbackPath({ accessToken: "a.b-c_d", refreshToken: "e.f" });
    expect(path).toBe("/auth/callback#access_token=a.b-c_d&refresh_token=e.f");
  });
});

describe("BrowserLogin", () => {
  it("startet im Browser, löst den Code mit dem Geheimnis ein und meldet sich an", async () => {
    const d = deps();
    const login = new BrowserLogin(d);
    expect(await login.start(`${ORIGIN}/login`)).toEqual({ started: true });
    expect(login.isPending()).toBe(true);
    const opened = new URL(d.opened[0] ?? "");
    expect(opened.origin).toBe(ORIGIN);
    const state = stateOf(d.opened[0] ?? "");
    expect(state).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    const challenge = opened.searchParams.get("code_challenge") ?? "";
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const result = await login.handleCallback(`de.kira.mac:/auth/callback?code=CODE123&state=${state}`);
    expect(result).toBe("done");
    const [url, body] = (d.postJson as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { code: string; code_verifier: string }];
    expect(url).toBe(`${ORIGIN}/api/auth/app/token`);
    expect(body.code).toBe("CODE123");
    expect(challengeFor(body.code_verifier)).toBe(challenge); // dasselbe Geheimnis wie beim Start
    expect(d.completed).toEqual([{ origin: ORIGIN, accessToken: "acc.ess", refreshToken: "ref.resh" }]);
    expect(login.isPending()).toBe(false);

    // Doppelte Rückkehr: nichts passiert mehr.
    expect(await login.handleCallback(`de.kira.mac:/auth/callback?code=CODE123&state=${state}`)).toBe("ignored");
    expect(d.completed).toHaveLength(1);
  });

  it("ignoriert fremden state und behält die laufende Anmeldung", async () => {
    const d = deps();
    const login = new BrowserLogin(d);
    await login.start(ORIGIN);
    expect(await login.handleCallback("de.kira.mac:/auth/callback?code=X&state=fremd-fremd-fremd-1")).toBe("ignored");
    expect(d.postJson).not.toHaveBeenCalled();
    expect(login.isPending()).toBe(true);
  });

  it("„Browser erneut öffnen“ ersetzt das alte Geheimnis", async () => {
    let n = 0;
    const d = deps({ random: (bytes) => Buffer.alloc(bytes, ++n) });
    const login = new BrowserLogin(d);
    await login.start(ORIGIN);
    await login.start(ORIGIN);
    const [first, second] = d.opened.map(stateOf);
    expect(first).not.toBe(second);
    expect(await login.handleCallback(`de.kira.mac:/auth/callback?code=X&state=${first}`)).toBe("ignored");
    expect(await login.handleCallback(`de.kira.mac:/auth/callback?code=X&state=${second}`)).toBe("done");
  });

  it("meldet Abbruch im Browser mit dem Text des Servers", async () => {
    const d = deps();
    const login = new BrowserLogin(d);
    await login.start(ORIGIN);
    const state = stateOf(d.opened[0] ?? "");
    const r = await login.handleCallback(
      `de.kira.mac:/auth/callback?error=access_denied&error_description=${encodeURIComponent("Dieser Account ist deaktiviert.")}&state=${state}`,
    );
    expect(r).toBe("error");
    expect(d.reports).toEqual([{ status: "error", message: "Dieser Account ist deaktiviert." }]);
    expect(d.postJson).not.toHaveBeenCalled();
  });

  it("meldet abgelehnte Codes und Netzfehler", async () => {
    const d = deps({ postJson: vi.fn(async () => ({ status: 400, body: { detail: "Der Anmeldecode ist ungültig oder abgelaufen." } })) });
    const login = new BrowserLogin(d);
    await login.start(ORIGIN);
    expect(await login.handleCallback(`de.kira.mac:/auth/callback?code=X&state=${stateOf(d.opened[0] ?? "")}`)).toBe("error");
    expect(d.reports[0]).toEqual({ status: "error", message: "Der Anmeldecode ist ungültig oder abgelaufen." });

    const d2 = deps({
      postJson: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    });
    const login2 = new BrowserLogin(d2);
    await login2.start(ORIGIN);
    expect(await login2.handleCallback(`de.kira.mac:/auth/callback?code=X&state=${stateOf(d2.opened[0] ?? "")}`)).toBe("error");
    expect(d2.reports[0]?.message).toBe("Der KIRA-Server ist nicht erreichbar: ECONNREFUSED");
    expect(d2.completed).toEqual([]);
  });

  it("verfällt nach zehn Minuten", async () => {
    const d = deps();
    const login = new BrowserLogin(d);
    await login.start(ORIGIN);
    d.advance(PENDING_TTL_MS + 1);
    expect(login.isPending()).toBe(false);
    expect(await login.handleCallback(`de.kira.mac:/auth/callback?code=X&state=${stateOf(d.opened[0] ?? "")}`)).toBe("error");
    expect(d.reports[0]?.status).toBe("expired");
    expect(d.postJson).not.toHaveBeenCalled();
  });

  it("Rückkehr ohne laufende Anmeldung (App neu gestartet)", async () => {
    const onStray = vi.fn();
    const login = new BrowserLogin(deps({ onStray }));
    expect(await login.handleCallback("de.kira.mac:/auth/callback?code=X&state=abcdefghijklmnopq")).toBe("ignored");
    expect(onStray).toHaveBeenCalledTimes(1);
  });

  it("Browser lässt sich nicht öffnen", async () => {
    const login = new BrowserLogin(
      deps({
        openExternal: async () => {
          throw new Error("kein Standardbrowser");
        },
      }),
    );
    expect(await login.start(ORIGIN)).toEqual({ started: false, error: "Der Browser ließ sich nicht öffnen: kein Standardbrowser" });
    expect(login.isPending()).toBe(false);
  });

  it("abbrechen meldet „cancelled“ und verwirft die Rückkehr", async () => {
    const d = deps();
    const login = new BrowserLogin(d);
    await login.start(ORIGIN);
    login.cancel();
    expect(d.reports).toEqual([{ status: "cancelled", message: undefined }]);
    expect(await login.handleCallback(`de.kira.mac:/auth/callback?code=X&state=${stateOf(d.opened[0] ?? "")}`)).toBe("ignored");
  });

  it("ungültige Instanz-Adresse", async () => {
    const login = new BrowserLogin(deps());
    expect(await login.start("kein-origin")).toEqual({ started: false, error: "Ungültige Instanz-Adresse." });
  });
});

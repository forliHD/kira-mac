// Ende-zu-Ende-Prüfung der Anmeldung im System-Browser (KIRA ≥ 3.299.0):
// Login-Seite in der App → „Mit … anmelden“ → App öffnet /api/auth/app/login
// (hier abgefangen) → Browser-Teil (hier per fetch: KIRA → Test-Anbieter →
// KIRA-Callback) → Seite mit de.kira.mac:/auth/callback?code=… → App löst den
// Code ein → Dashboard angemeldet, Sitzung „macOS · KIRA für Mac“.
//
// Der Test-Anbieter (OIDC, genehmigt alles) läuft in diesem Skript. Die
// KIRA-Instanz muss auf ihn zeigen und darf keinen Entwicklerzugang haben:
//
//   OIDC_ENABLED=true OIDC_ISSUER=http://127.0.0.1:8498 OIDC_CLIENT_ID=kira-e2e \
//   OIDC_CLIENT_SECRET=e2e OIDC_PROVIDER_NAME=Microsoft KIRA_DEV_BYPASS=false \
//   .venv/bin/python kira.py
//   npm run build
//   node scripts/e2e/browser-login.mjs --instance http://localhost:8420 --idp-port 8498 --out /tmp/kira-e2e-login

import { spawn } from "node:child_process";
import { createSign, generateKeyPairSync, randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { connect, listTargets, sleep, waitFor } from "./cdp.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const INSTANCE = opt("instance", "http://localhost:8420");
const IDP_PORT = Number(opt("idp-port", "8498"));
const OUT = resolve(opt("out", "/tmp/kira-e2e-login"));
const PROFILE = join(OUT, "profile");
const RENDER_PORT = Number(opt("render-port", "9335"));
const INSPECT_PORT = Number(opt("inspect-port", "9336"));
const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const ISSUER = `http://127.0.0.1:${IDP_PORT}`;
const EMAIL = "e2e-login@kira.test";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` – ${detail}` : ""}`);
};

// ── Test-Anbieter (OIDC) ─────────────────────────────────────────────────
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "e2e", alg: "RS256", use: "sig" };
const codes = new Map();
const b64url = (buf) => Buffer.from(buf).toString("base64url");
function signJwt(claims) {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "e2e" }));
  const body = b64url(JSON.stringify(claims));
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${b64url(signer.sign(privateKey))}`;
}
function startIdp() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, ISSUER);
    const json = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration") {
      return json(200, { issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` });
    }
    if (url.pathname === "/jwks") return json(200, { keys: [jwk] });
    if (url.pathname === "/authorize") {
      const q = url.searchParams;
      const code = randomUUID();
      codes.set(code, { nonce: q.get("nonce"), clientId: q.get("client_id"), challenge: q.get("code_challenge") });
      const back = new URL(q.get("redirect_uri"));
      back.searchParams.set("code", code);
      back.searchParams.set("state", q.get("state"));
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const form = new URLSearchParams(raw);
        const entry = codes.get(form.get("code"));
        codes.delete(form.get("code"));
        if (!entry) return json(400, { error: "invalid_grant" });
        const verifier = form.get("code_verifier") || "";
        if (entry.challenge && createHash("sha256").update(verifier).digest("base64url") !== entry.challenge) return json(400, { error: "invalid_grant" });
        const now = Math.floor(Date.now() / 1000);
        const idToken = signJwt({ iss: ISSUER, aud: entry.clientId, sub: "e2e-1", email: EMAIL, email_verified: true, name: "E2E Nutzer", nonce: entry.nonce, iat: now, exp: now + 300 });
        json(200, { id_token: idToken, access_token: "x", token_type: "Bearer" });
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolveListen) => server.listen(IDP_PORT, "127.0.0.1", () => resolveListen(server)));
}

// ── „Browser“: Weiterleitungen von Hand, mit Cookie-Dose ────────────────
async function browse(startUrl) {
  const jar = new Map();
  let url = startUrl;
  for (let hop = 0; hop < 10; hop++) {
    const host = new URL(url).host;
    const cookie = [...(jar.get(host) ?? new Map())].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(url, { redirect: "manual", headers: cookie ? { cookie } : {} });
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const [k, ...v] = pair.split("=");
      if (!jar.has(host)) jar.set(host, new Map());
      jar.get(host).set(k.trim(), v.join("="));
    }
    if (res.status >= 300 && res.status < 400) {
      url = new URL(res.headers.get("location"), url).toString();
      continue;
    }
    return { status: res.status, url, html: await res.text() };
  }
  throw new Error("zu viele Weiterleitungen");
}

async function main() {
  const idp = await startIdp();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(PROFILE, { recursive: true });
  writeFileSync(
    join(PROFILE, "config.json"),
    JSON.stringify({
      version: 1,
      deviceId: randomUUID(),
      instance: { internalUrl: INSTANCE, externalUrl: null, label: new URL(INSTANCE).host },
      hotkeys: { quickWindow: "Control+Alt+Shift+F11", dictation: "Control+Alt+Shift+F12" },
      dictation: { locale: "de-DE", commands: true },
      general: { launchAtLogin: false, notifications: true },
      onboarded: true,
      mainWindow: { width: 1100, height: 760 },
      lastServerVersion: "3.299.0",
    }),
  );
  const child = spawn(join(ROOT, "node_modules", ".bin", "electron"), [".", `--remote-debugging-port=${RENDER_PORT}`, `--inspect=${INSPECT_PORT}`], {
    cwd: ROOT,
    env: { ...process.env, KIRA_MAC_PROFILE: PROFILE, KIRA_MAC_TEST_HOOKS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));

  try {
    const inspector = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${INSPECT_PORT}/json/list`)).json())[0], { what: "Inspector" });
    const main = await connect(inspector.webSocketDebuggerUrl);
    await main.send("Runtime.enable");
    await waitFor(() => main.evaluate("Boolean(globalThis.__kira && globalThis.__kira.browserLogin)"), { what: "Testschnittstelle" });

    const providers = await (await fetch(`${INSTANCE}/api/auth/providers`)).json();
    check("Server bietet die App-Anmeldung an", providers.app_login === true && providers.oidc?.enabled, JSON.stringify(providers));

    const dash = await waitFor(async () => (await listTargets(RENDER_PORT)).find((t) => t.type === "page" && t.url.startsWith(INSTANCE)), { what: "Dashboard" });
    const page = await connect(dash.webSocketDebuggerUrl);
    await page.send("Runtime.enable");
    await waitFor(() => page.evaluate("location.pathname === '/login' && [...document.querySelectorAll('button')].some(b => /anmelden/.test(b.textContent) && /Microsoft/.test(b.textContent))"), {
      what: "Login-Seite mit SSO-Knopf",
    });
    const hint = await page.evaluate("document.body.innerText.includes('Öffnet die Anmeldung in deinem Browser')");
    check("Login-Seite erklärt den Browser-Weg", hint);
    const shot1 = await page.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, "01-login.png"), Buffer.from(shot1.data, "base64"));

    await page.evaluate("[...document.querySelectorAll('button')].find(b => /Microsoft/.test(b.textContent)).click(); true");
    const opened = await waitFor(() => main.evaluate("globalThis.__kira.testOpened.at(-1) || null"), { what: "Browser-Start" });
    check("App öffnet /api/auth/app/login im Browser", opened.startsWith(`${INSTANCE}/api/auth/app/login?`), opened.replace(/state=[^&]+/, "state=…").slice(0, 120));
    await waitFor(() => page.evaluate("document.body.innerText.includes('Anmeldung im Browser')"), { what: "Wartezustand" });
    check("Dashboard zeigt „Anmeldung im Browser …“", true);
    const shot2 = await page.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, "02-warten.png"), Buffer.from(shot2.data, "base64"));

    const done = await browse(opened);
    const m = done.html.match(/url=(de\.kira\.mac:\/auth\/callback\?[^"]+)"/);
    check("Browser endet auf der Übergabe-Seite", done.status === 200 && Boolean(m), `${done.status} ${new URL(done.url).pathname}`);
    check("Browser bekommt keine Tokens", !/access_token|refresh_token/.test(done.html));
    const handover = m[1].replaceAll("&amp;", "&");

    const result = await main.evaluate(`globalThis.__kira.browserLogin.handleCallback(${JSON.stringify(handover)})`);
    check("App löst den Code ein", result === "done", String(result));
    const signedIn = await waitFor(
      () => page.evaluate("(location.pathname === '/dashboard' || location.pathname === '/') && Boolean(localStorage.getItem('kira_access_token')) ? location.pathname : null"),
      { what: "Dashboard angemeldet", timeout: 20_000 },
    ).catch(() => null);
    check("Dashboard ist angemeldet", Boolean(signedIn), signedIn ?? "");
    const tokensInShell = await waitFor(() => main.evaluate("globalThis.__kira.sessionHasTokens()"), { what: "Tokens in der Hülle", timeout: 15_000 }).catch(() => false);
    check("Hülle hat die Tokens (setSession)", tokensInShell);
    const token = await page.evaluate("localStorage.getItem('kira_access_token')");
    const sessions = await (await fetch(`${INSTANCE}/api/auth/sessions`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const devices = (sessions.sessions ?? []).map((s) => s.device);
    check("Sitzung heißt „macOS · KIRA für Mac“", devices.includes("macOS · KIRA für Mac"), devices.join(", "));
    const replay = await main.evaluate(`globalThis.__kira.browserLogin.handleCallback(${JSON.stringify(handover)})`);
    check("Zweite Rückkehr mit demselben Code wird ignoriert", replay === "ignored", String(replay));
    await sleep(1200);
    const shot3 = await page.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, "03-angemeldet.png"), Buffer.from(shot3.data, "base64"));
    page.close();
    main.close();
  } finally {
    child.kill("SIGTERM");
    await sleep(1500);
    if (!child.killed) child.kill("SIGKILL");
    writeFileSync(join(OUT, "electron.log"), output);
    idp.close();
  }
  const failed = results.filter((r) => !r.ok);
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} Prüfungen bestanden. Ausgabe: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("Abbruch:", err instanceof Error ? err.message : err);
  process.exit(2);
});

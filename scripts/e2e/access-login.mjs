// Ende-zu-Ende-Prüfung der Cloudflare-Access-Anmeldung im System-Browser
// (KIRA ≥ 3.300.0): Instanz leitet auf *.cloudflareaccess.com um → App zeigt
// „Im Browser anmelden“ statt der Access-Seite → App öffnet
// /api/auth/app/access (hier abgefangen) → Browser-Teil (hier per fetch:
// Rand → „Anmeldung“ → Rand → echter KIRA-Endpunkt) → Seite mit
// de.kira.mac:/auth/callback?access=… → App setzt das Access-Cookie → die
// Instanz lädt angemeldet.
//
// Der nachgebaute Rand (scripts/e2e/access-edge.py) startet dieses Skript
// selbst, mit dem KIRA-Checkout aus --kira:
//
//   npm run build
//   node scripts/e2e/access-login.mjs --kira ../kira --out /tmp/kira-e2e-access
//   node scripts/e2e/access-login.mjs --kira ../kira --binding   # Binding-Cookie: Hinweis statt Schleife

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { connect, listTargets, sleep, waitFor } from "./cdp.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const KIRA = resolve(opt("kira", "../kira"));
const PYTHON = opt("python", join(KIRA, ".venv", "bin", "python"));
const EDGE_PORT = Number(opt("edge-port", "8497"));
const BINDING = args.includes("--binding");
const OUT = resolve(opt("out", BINDING ? "/tmp/kira-e2e-access-binding" : "/tmp/kira-e2e-access"));
const PROFILE = join(OUT, "profile");
const RENDER_PORT = Number(opt("render-port", "9337"));
const INSPECT_PORT = Number(opt("inspect-port", "9338"));
const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const INSTANCE = `http://127.0.0.1:${EDGE_PORT}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` – ${detail}` : ""}`);
};

function startEdge() {
  const edge = spawn(PYTHON, [join(ROOT, "scripts", "e2e", "access-edge.py"), "--kira", KIRA, "--port", String(EDGE_PORT), ...(BINDING ? ["--binding"] : [])], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  edge.stdout.on("data", (d) => (log += d));
  edge.stderr.on("data", (d) => (log += d));
  return { edge, log: () => log };
}

// ── „Browser“: Weiterleitungen von Hand, Cookie-Dose, Access-Anmeldung ──
async function browse(startUrl) {
  const jar = new Map();
  let url = startUrl;
  for (let hop = 0; hop < 10; hop++) {
    const target = new URL(url);
    if (target.hostname.endsWith(".cloudflareaccess.com")) {
      // Hier meldet man sich bei Access an (Passkey usw.); der Rand setzt danach das Cookie.
      url = `${INSTANCE}/__e2e/login?redirect_url=${encodeURIComponent(target.searchParams.get("redirect_url") ?? "/")}`;
      continue;
    }
    const cookie = [...(jar.get(target.host) ?? new Map())].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(url, { redirect: "manual", headers: cookie ? { cookie } : {} });
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const [k, ...v] = pair.split("=");
      if (!jar.has(target.host)) jar.set(target.host, new Map());
      jar.get(target.host).set(k.trim(), v.join("="));
    }
    if (res.status >= 300 && res.status < 400) {
      url = new URL(res.headers.get("location"), url).toString();
      continue;
    }
    return { status: res.status, url, html: await res.text(), jar };
  }
  throw new Error("zu viele Weiterleitungen");
}

async function mainWindowTarget(predicate, what) {
  return waitFor(async () => (await listTargets(RENDER_PORT)).find((t) => t.type === "page" && predicate(t.url)), { what, timeout: 30_000 });
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(PROFILE, { recursive: true });
  const { edge, log: edgeLog } = startEdge();
  await waitFor(async () => (await fetch(`${INSTANCE}/api/health`)).status === 401, { what: "Rand", timeout: 30_000 });
  writeFileSync(
    join(PROFILE, "config.json"),
    JSON.stringify({
      version: 1,
      deviceId: randomUUID(),
      instance: { internalUrl: null, externalUrl: INSTANCE, label: "Extern" },
      hotkeys: { quickWindow: "Control+Alt+Shift+F11", dictation: "Control+Alt+Shift+F12" },
      dictation: { locale: "de-DE", commands: true },
      general: { launchAtLogin: false, notifications: false },
      onboarded: true,
      mainWindow: { width: 1100, height: 760 },
      lastServerVersion: "3.300.0",
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
    await waitFor(() => main.evaluate("Boolean(globalThis.__kira && globalThis.__kira.accessLogin)"), { what: "Testschnittstelle" });

    // 1. Statt der Access-Seite im Fenster: „Im Browser anmelden“.
    const accessPage = await mainWindowTarget((u) => u.includes("/offline/index.html") && u.includes("mode=access"), "Seite „Im Browser anmelden“");
    check("App bricht die Umleitung zu Cloudflare ab und zeigt die eigene Seite", true, new URL(accessPage.url).search.slice(0, 60));
    const page = await connect(accessPage.webSocketDebuggerUrl);
    await page.send("Runtime.enable");
    await waitFor(() => page.evaluate("document.body.innerText.includes('Im Browser anmelden')"), { what: "Knopf" });
    const text = await page.evaluate("document.body.innerText");
    check("Seite nennt Host und Browser-Weg", text.includes("127.0.0.1") && text.includes("Cloudflare Access") && text.includes("Im App-Fenster anmelden"));
    const opened0 = await main.evaluate("globalThis.__kira.testOpened.length");
    check("Browser öffnet sich nicht ungefragt", opened0 === 0, String(opened0));
    const shot1 = await page.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, "01-im-browser-anmelden.png"), Buffer.from(shot1.data, "base64"));

    // 2. Klick → Browser-Start mit Einmal-Schlüssel.
    await page.evaluate("[...document.querySelectorAll('button')].find(b => /Im Browser anmelden/.test(b.textContent)).click(); true");
    const opened = await waitFor(() => main.evaluate("globalThis.__kira.testOpened.at(-1) || null"), { what: "Browser-Start" });
    const openedUrl = new URL(opened);
    check(
      "App öffnet /api/auth/app/access im Browser",
      opened.startsWith(`${INSTANCE}/api/auth/app/access?`) && /^[A-Za-z0-9_-]{43}$/.test(openedUrl.searchParams.get("key") ?? "") && openedUrl.searchParams.get("redirect_uri") === "de.kira.mac:/auth/callback",
      opened.replace(/(state|key)=[^&]+/g, "$1=…"),
    );
    await waitFor(() => page.evaluate("document.body.innerText.includes('Warte auf die Anmeldung im Browser')"), { what: "Wartezustand" });
    check("Seite wartet auf den Browser", true);
    const shot2 = await page.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, "02-warten.png"), Buffer.from(shot2.data, "base64"));

    // 3. Browser-Teil: Rand → Access-Anmeldung → Rand → KIRA → Übergabe-Seite.
    const done = await browse(opened);
    const m = done.html.match(/url=(de\.kira\.mac:\/auth\/callback\?[^"]+)"/);
    check("Browser endet auf der Übergabe-Seite", done.status === 200 && Boolean(m), `${done.status} ${new URL(done.url).pathname}`);
    const browserCookie = done.jar.get(`127.0.0.1:${EDGE_PORT}`)?.get("CF_Authorization") ?? "";
    check("Übergabe-Seite enthält das Token nicht im Klartext", browserCookie.length > 20 && !done.html.includes(browserCookie));
    const handover = m[1].replaceAll("&amp;", "&");
    check("Übergabe trägt nur Chiffrat", /[?&]access=[A-Za-z0-9_-]{100,}/.test(handover) && !handover.includes(browserCookie));

    // 4. Rückkehr in die App → Cookie → Instanz lädt.
    await main.evaluate(`globalThis.__kira.handleOpenUrl(${JSON.stringify(handover)}); true`);
    if (BINDING) {
      const again = await mainWindowTarget((u) => u.includes("mode=access") && u.includes("error="), "Hinweis „Binding Cookie“");
      check("Binding-Cookie: App erkennt die Schleife und erklärt sie", /Binding/.test(decodeURIComponent(again.url)));
      const p2 = await connect(again.webSocketDebuggerUrl);
      await p2.send("Runtime.enable");
      await waitFor(() => p2.evaluate("document.body.innerText.includes('Binding Cookie')"), { what: "Hinweistext" });
      const shot3 = await p2.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(OUT, "03-binding-hinweis.png"), Buffer.from(shot3.data, "base64"));
      p2.close();
    } else {
      const dash = await mainWindowTarget((u) => u === `${INSTANCE}/`, "Instanz geladen");
      const p2 = await connect(dash.webSocketDebuggerUrl);
      await p2.send("Runtime.enable");
      const title = await waitFor(() => p2.evaluate("document.title === 'KIRA Test-Dashboard' ? document.title : null"), { what: "Dashboard" });
      check("Instanz lädt angemeldet (Access-Cookie sitzt)", title === "KIRA Test-Dashboard");
      const jsCookie = await p2.evaluate("document.cookie");
      check("Cookie ist HttpOnly (für Seitenskripte unsichtbar)", !String(jsCookie).includes("CF_Authorization"), String(jsCookie));
      const replay = await main.evaluate(`globalThis.__kira.accessLogin.handleCallback(${JSON.stringify(handover)})`);
      check("Zweite Rückkehr mit derselben Übergabe wird ignoriert", replay === "ignored", String(replay));
      const shot3 = await p2.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(OUT, "03-angemeldet.png"), Buffer.from(shot3.data, "base64"));

      p2.close();
    }
    page.close();
    main.close();
  } finally {
    child.kill("SIGTERM");
    await sleep(1500);
    if (!child.killed) child.kill("SIGKILL");
    writeFileSync(join(OUT, "electron.log"), output);
  }

  try {
    if (!BINDING) {
      // Zweiter Start mit demselben Profil: angemeldet, ohne Umweg über die Seite.
      const child2 = spawn(join(ROOT, "node_modules", ".bin", "electron"), [".", `--remote-debugging-port=${RENDER_PORT}`], {
        cwd: ROOT,
        env: { ...process.env, KIRA_MAC_PROFILE: PROFILE, KIRA_MAC_TEST_HOOKS: "1" },
        stdio: "ignore",
      });
      try {
        const dash = await mainWindowTarget((u) => u === `${INSTANCE}/`, "Instanz nach Neustart").catch(() => null);
        check("Nach Neustart der App direkt angemeldet", Boolean(dash));
      } finally {
        child2.kill("SIGTERM");
        await sleep(1500);
      }
    }
  } finally {
    edge.kill("SIGTERM");
    writeFileSync(join(OUT, "edge.log"), edgeLog());
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

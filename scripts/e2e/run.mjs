// Ende-zu-Ende-Prüfung der unverpackten App gegen eine laufende KIRA-Instanz
// (lokal: KIRA_ENV=development mit Entwicklerzugang, kein Passwort nötig).
//
//   npm run build
//   node scripts/e2e/run.mjs --instance http://localhost:8420 --out /tmp/kira-e2e
//
// Startet Electron mit eigenem Profil (KIRA_MAC_PROFILE), Testschnittstelle
// (KIRA_MAC_TEST_HOOKS=1, nur unverpackt), Renderer-Debugging und Inspector,
// prüft Brücke, eingelassene Titelleiste, Mitteilungs-Stream, Schnellfenster
// mit echter Antwort, HUD, Einstellungen und Offline-Seite und legt
// Bildschirmfotos des Webinhalts ab (natives Glas ist darauf nicht zu sehen).

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
const INSTANCE = opt("instance", "http://localhost:8420");
const OUT = resolve(opt("out", "/tmp/kira-e2e"));
const PROFILE = join(OUT, "profile");
const RENDER_PORT = Number(opt("render-port", "9333"));
const INSPECT_PORT = Number(opt("inspect-port", "9334"));
const ROOT = resolve(new URL("../..", import.meta.url).pathname);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` – ${detail}` : ""}`);
};

async function shot(target, file) {
  const page = await connect(target.webSocketDebuggerUrl);
  try {
    const r = await page.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, file), Buffer.from(r.data, "base64"));
    return join(OUT, file);
  } finally {
    page.close();
  }
}

async function pageTarget(match, what) {
  return waitFor(async () => (await listTargets(RENDER_PORT)).find((t) => t.type === "page" && match(t.url)), { what, timeout: 30_000 });
}

async function main() {
  rmSync(PROFILE, { recursive: true, force: true });
  mkdirSync(PROFILE, { recursive: true });
  writeFileSync(
    join(PROFILE, "config.json"),
    JSON.stringify(
      {
        version: 1,
        deviceId: randomUUID(),
        instance: { internalUrl: INSTANCE, externalUrl: null, label: new URL(INSTANCE).host },
        // Ungewöhnliche Kürzel: die Prüfung soll keine echten Kürzel belegen.
        hotkeys: { quickWindow: "Control+Alt+Shift+F11", dictation: "Control+Alt+Shift+F12" },
        dictation: { locale: "de-DE", commands: true },
        general: { launchAtLogin: false, notifications: true },
        onboarded: true,
        mainWindow: { width: 1280, height: 820 },
        lastServerVersion: "3.298.0",
      },
      null,
      2,
    ),
  );

  const electronBin = join(ROOT, "node_modules", ".bin", "electron");
  const child = spawn(electronBin, [".", `--remote-debugging-port=${RENDER_PORT}`, `--inspect=${INSPECT_PORT}`], {
    cwd: ROOT,
    env: { ...process.env, KIRA_MAC_PROFILE: PROFILE, KIRA_MAC_TEST_HOOKS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));

  try {
    // ── Hauptprozess ──────────────────────────────────────────────────
    const inspector = await waitFor(
      async () => {
        const res = await fetch(`http://127.0.0.1:${INSPECT_PORT}/json/list`);
        const list = await res.json();
        return list[0];
      },
      { what: "Inspector des Hauptprozesses" },
    );
    const main = await connect(inspector.webSocketDebuggerUrl);
    await main.send("Runtime.enable");
    await waitFor(() => main.evaluate("Boolean(globalThis.__kira)"), { what: "Testschnittstelle __kira" });

    // ── Hauptfenster: Dashboard, Brücke, Titelleiste ──────────────────
    const dash = await pageTarget((u) => u.startsWith(INSTANCE), "Dashboard im Hauptfenster");
    const page = await connect(dash.webSocketDebuggerUrl);
    await page.send("Runtime.enable");
    const bridge = await waitFor(
      () =>
        page.evaluate(
          `(() => { const n = window.KiraNative; if (!n || !document.querySelector("[data-shell-top]")) return null; return { bridge: n.bridge, caps: n.capabilities, app: n.app, chrome: document.documentElement.dataset.shellChrome || null, pad: getComputedStyle(document.querySelector("[data-shell-top]")).paddingLeft, drag: getComputedStyle(document.querySelector("[data-shell-top]")).webkitAppRegion || getComputedStyle(document.querySelector("[data-shell-top]")).getPropertyValue("-webkit-app-region") }; })()`,
        ),
      { what: "Brücke im Dashboard" },
    );
    check("Brücke Version 1", bridge.bridge === 1, `App ${bridge.app?.version}`);
    check("Fähigkeiten", ["session", "notifications", "inset-titlebar"].every((c) => bridge.caps.includes(c)), bridge.caps.join(", "));
    check("Eingelassene Titelleiste markiert", bridge.chrome === "inset", `padding-left ${bridge.pad}, app-region ${bridge.drag}`);
    check("Seitenleiste rückt für die Ampel ein", bridge.pad === "82px" || bridge.drag === "drag", bridge.pad);
    await sleep(1500);
    console.log("  Foto:", await shot(dash, "01-hauptfenster.png"));

    // ── Mitteilungs-Stream ────────────────────────────────────────────
    const connected = await waitFor(() => main.evaluate("Boolean(globalThis.__kira.notifications && globalThis.__kira.notifications.isConnected)"), {
      what: "Mitteilungs-Stream verbunden",
      timeout: 20_000,
    }).catch(() => false);
    check("Mitteilungs-Stream verbunden", connected);
    if (connected) {
      await main.evaluate("globalThis.__kira.notifications.on('notification', (f) => { globalThis.__lastNote = f; }); true");
      const res = await fetch(`${INSTANCE}/api/push/test`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      const note = await waitFor(() => main.evaluate("globalThis.__lastNote || null"), { what: "Test-Mitteilung", timeout: 10_000 }).catch(() => null);
      check("Test-Mitteilung kommt an", Boolean(note && note.tag === "kira-test"), `Server zählt ${body.sent ?? "?"} Gerät(e)`);
    }

    // ── Schnellfenster: echte Frage an die Instanz ────────────────────
    await main.evaluate("globalThis.__kira.quickWin.show(); true");
    const quick = await pageTarget((u) => u.includes("/quick/index.html"), "Schnellfenster");
    const q = await connect(quick.webSocketDebuggerUrl);
    await q.send("Runtime.enable");
    await waitFor(() => q.evaluate("Boolean(window.KiraLocal && document.querySelector('textarea'))"), { what: "Schnellfenster bereit" });
    await sleep(600);
    console.log("  Foto:", await shot(quick, "02-schnellfenster-leer.png"));
    await q.evaluate("window.KiraLocal.quickSend('Test: Antworte nur mit dem Wort Hallo.')");
    const answer = await waitFor(
      async () => {
        const s = await q.evaluate("window.KiraLocal.quickGetState()");
        const last = s.messages[s.messages.length - 1];
        return last && last.role === "assistant" && last.status !== "streaming" ? { s, last } : null;
      },
      { what: "Antwort im Schnellfenster", timeout: 180_000, interval: 500 },
    );
    check("Schnellfenster bekommt eine Antwort", answer.last.status === "done" && /hallo/i.test(answer.last.text), JSON.stringify(answer.last.text).slice(0, 80));
    check("Sitzung auf dem Server angelegt", typeof answer.s.sessionId === "number", `Sitzung ${answer.s.sessionId}`);
    await sleep(800);
    const dom = await q.evaluate("document.body.innerText");
    check("Antwort ist im Fenster zu sehen", /hallo/i.test(dom));
    console.log("  Foto:", await shot(quick, "03-schnellfenster-antwort.png"));
    const bounds = await main.evaluate("globalThis.__kira.quickWin.window.getBounds()");
    check("Schnellfenster wächst mit dem Inhalt", bounds.height > 140 && bounds.width === 680, `${bounds.width}×${bounds.height}`);

    // Im Hauptfenster öffnen
    await q.evaluate("window.KiraLocal.quickOpenInMain()");
    const opened = await waitFor(
      async () => {
        const url = await page.evaluate("location.pathname + location.search");
        return url.includes(`session=${answer.s.sessionId}`) ? url : null;
      },
      { what: "Chat im Hauptfenster", timeout: 15_000 },
    ).catch(() => null);
    check("„Im Hauptfenster öffnen“ springt in den Chat", Boolean(opened), opened ?? "");
    q.close();

    // ── HUD ───────────────────────────────────────────────────────────
    await main.evaluate(
      "globalThis.__kira.hud.show(); globalThis.__kira.hud.update({ phase: 'listening', level: 0.42, partial: 'ob Herr Kaya die Unterlagen ebenfalls erhalten soll', app: 'Mail', message: null }); true",
    );
    const hud = await pageTarget((u) => u.includes("/hud/index.html"), "HUD");
    await sleep(900);
    console.log("  Foto:", await shot(hud, "04-hud.png"));
    await main.evaluate("globalThis.__kira.hud.hide(); true");

    // ── Einstellungen ─────────────────────────────────────────────────
    await main.evaluate("globalThis.__kira.showSettings(); true");
    const settings = await pageTarget((u) => u.includes("/settings/index.html"), "Einstellungen").catch(() => null);
    if (settings) {
      await sleep(1200);
      console.log("  Foto:", await shot(settings, "05-einstellungen.png"));
    }
    check("Einstellungen öffnen", Boolean(settings));

    // ── Offline-Seite ─────────────────────────────────────────────────
    await main.evaluate("globalThis.__kira.mainWin.showOffline('Instanz nicht erreichbar: Test'); true");
    const offline = await pageTarget((u) => u.includes("/offline/index.html"), "Offline-Seite");
    await sleep(1000);
    console.log("  Foto:", await shot(offline, "06-offline.png"));
    check("Offline-Seite zeigt den Grund", /Test/.test(await (async () => {
      const o = await connect(offline.webSocketDebuggerUrl);
      try {
        return await o.evaluate("document.body.innerText");
      } finally {
        o.close();
      }
    })()));

    page.close();
    main.close();
  } finally {
    child.kill("SIGTERM");
    await sleep(1500);
    if (!child.killed) child.kill("SIGKILL");
    writeFileSync(join(OUT, "electron.log"), output);
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

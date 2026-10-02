// Ende-zu-Ende-Prüfung zum Live-Befund 02.10.2026: KIRA frisch gestartet,
// Hauptfenster vorn, ⌥ Leertaste → das Hauptfenster verschwand. Das erste
// Schnellfenster machte aus der App ein Hintergrundprogramm (UIElement: kein
// Dock-Symbol, kein ⌘-Tab, Fokus weg). Diese Prüfung startet die unverpackte
// App, öffnet Schnellfenster und Diktat-HUD über die Testschnittstelle und
// fragt macOS (lsappinfo), ob KIRA ein normales Programm („Foreground“) bleibt.
// Braucht keinen KIRA-Server – die App zeigt dann die Offline-Seite.
//
//   npm run build
//   node scripts/e2e/process-type.mjs [--out /tmp/kira-e2e-type] [--hold 20]
//
// --hold N lässt beide Fenster danach N Sekunden offen (z. B. um sie über einer
// Vollbild-App anzusehen).

import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { connect, sleep, waitFor } from "./cdp.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(opt("out", "/tmp/kira-e2e-type"));
const HOLD_S = Number(opt("hold", "0"));
const PROFILE = join(OUT, "profile");
const INSPECT_PORT = Number(opt("inspect-port", "9338"));
const ROOT = resolve(new URL("../..", import.meta.url).pathname);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` – ${detail}` : ""}`);
};

/** Prozessart laut Launch Services: "Foreground" (Dock, ⌘-Tab) oder "UIElement". */
function appType(pid) {
  const asn = execFileSync("lsappinfo", ["find", `pid=${pid}`], { encoding: "utf8" }).trim();
  if (!asn) return null;
  const info = execFileSync("lsappinfo", ["info", asn], { encoding: "utf8" });
  return /type="([^"]+)"/.exec(info)?.[1] ?? null;
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
        // Absichtlich unerreichbar: geprüft wird nur das Fensterverhalten.
        instance: { internalUrl: "http://127.0.0.1:9", externalUrl: null, label: "unerreichbar" },
        hotkeys: { quickWindow: "Control+Alt+Shift+F11", dictation: "Control+Alt+Shift+F12" },
        dictation: { locale: "de-DE", commands: true },
        general: { launchAtLogin: false, notifications: false },
        onboarded: true,
        mainWindow: { width: 1100, height: 720 },
        lastServerVersion: "3.300.1",
      },
      null,
      2,
    ),
  );

  const child = spawn(join(ROOT, "node_modules", ".bin", "electron"), [".", `--inspect=${INSPECT_PORT}`], {
    cwd: ROOT,
    env: { ...process.env, KIRA_MAC_PROFILE: PROFILE, KIRA_MAC_TEST_HOOKS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));

  try {
    const inspector = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${INSPECT_PORT}/json/list`)).json())[0], {
      what: "Inspector des Hauptprozesses",
    });
    const app = await connect(inspector.webSocketDebuggerUrl);
    await app.send("Runtime.enable");
    await waitFor(() => app.evaluate("Boolean(globalThis.__kira)"), { what: "Testschnittstelle __kira" });
    const pid = await app.evaluate("process.pid");
    await waitFor(() => app.evaluate("Boolean(globalThis.__kira.mainWin.window && globalThis.__kira.mainWin.window.isVisible())"), {
      what: "Hauptfenster sichtbar",
    });
    // Launch Services meldet die Prozessart erst nach dem Start verlässlich.
    await waitFor(() => appType(pid), { what: "Prozessart" });
    await sleep(1000);
    const before = appType(pid);
    check("Nach dem Start ein normales Programm", before === "Foreground", before ?? "unbekannt");

    await app.evaluate("globalThis.__kira.quickWin.show(); true");
    await sleep(2000);
    const afterQuick = appType(pid);
    check("Schnellfenster lässt die App ein normales Programm", afterQuick === "Foreground", afterQuick ?? "unbekannt");
    check(
      "Hauptfenster bleibt sichtbar",
      await app.evaluate("globalThis.__kira.mainWin.window.isVisible() && globalThis.__kira.quickWin.isVisible()"),
    );

    await app.evaluate(
      "globalThis.__kira.hud.show(); globalThis.__kira.hud.update({ phase: 'listening', level: 0.4, partial: 'Probe', app: 'TextEdit', message: null }); true",
    );
    await sleep(2000);
    const afterHud = appType(pid);
    check("Diktat-HUD lässt die App ein normales Programm", afterHud === "Foreground", afterHud ?? "unbekannt");

    if (HOLD_S > 0) {
      console.log(`  Fenster bleiben ${HOLD_S} s offen …`);
      await sleep(HOLD_S * 1000);
    }
    await app.evaluate("globalThis.__kira.hud.hide(); globalThis.__kira.quickWin.hide(); true");
    app.close();
  } catch (err) {
    check("Ablauf", false, err instanceof Error ? err.message : String(err));
    console.log(output.split("\n").slice(-30).join("\n"));
  } finally {
    child.kill("SIGTERM");
    await sleep(500);
  }

  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? `\nAlles bestanden (${results.length}).` : `\n${failed.length} von ${results.length} fehlgeschlagen.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();

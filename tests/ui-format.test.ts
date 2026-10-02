// Texte der lokalen Seiten (src/renderer/lib/format.ts): Prüfergebnis,
// Offline-Grund, Updates, Berechtigungen, Sprachnamen.

import { describe, expect, it } from "vitest";

import {
  formatLastSeen,
  hostOf,
  humanizeError,
  localeName,
  parseOfflineReason,
  parseTimestamp,
  permissionView,
  probeView,
  sortLocales,
  updateLong,
  updateShort,
} from "../src/renderer/lib/format";
import { sectionFromName, sectionFromQuery } from "../src/renderer/settings/shared";
import { type ProbeResult } from "../src/shared/local-api";

const probe = (p: Partial<ProbeResult>): ProbeResult => ({ url: "https://kira.example.de", ok: true, version: "3.297.0", bridge: true, error: null, latencyMs: 12, ...p });

describe("Prüfergebnis einer Adresse", () => {
  it("aktuelle Version mit Brücke", () => {
    expect(probeView(probe({}))).toEqual({ tone: "ok", badge: "Erreichbar", detail: "KIRA 3.297.0 · Benachrichtigungen und Diktat werden unterstützt" });
  });

  it("ältere Version: Hinweis statt Fehler", () => {
    const v = probeView(probe({ version: "3.290.0", bridge: false }));
    expect(v.tone).toBe("warn");
    expect(v.detail).toContain("3.297.0");
  });

  it("Cloudflare Access ohne Version: erreichbar, Anmeldung folgt", () => {
    const v = probeView(probe({ version: null, bridge: false }));
    expect(v.tone).toBe("ok");
    expect(v.detail).toMatch(/Anmeldung/);
  });

  it("Fehler und ungültige Adresse", () => {
    expect(probeView(probe({ ok: false, version: null, bridge: false, error: "Zeitüberschreitung." }))).toMatchObject({ tone: "err", badge: "Nicht erreichbar" });
    expect(probeView(probe({ ok: false, version: null, bridge: false, error: "Keine gültige http(s)-Adresse." })).badge).toBe("Ungültig");
  });
});

describe("Offline-Grund", () => {
  it("zerlegt describeResolveFailure in Zeilen", () => {
    const r = parseOfflineReason(
      "Instanz nicht erreichbar: intern http://192.168.178.166: Rechner nicht erreichbar (anderes Netz, VPN aus?).; extern https://kira.example.de:8443: Keine Antwort innerhalb von 4 s.",
    );
    expect(r.summary).toBeNull();
    expect(r.items).toEqual([
      { kind: "internal", origin: "http://192.168.178.166", host: "192.168.178.166", error: "Rechner nicht erreichbar (anderes Netz, VPN aus?)." },
      { kind: "external", origin: "https://kira.example.de:8443", host: "kira.example.de:8443", error: "Keine Antwort innerhalb von 4 s." },
    ]);
  });

  it("übersetzt Chromium-Codes aus did-fail-load", () => {
    expect(parseOfflineReason("Instanz nicht erreichbar: ERR_NAME_NOT_RESOLVED")).toEqual({
      summary: "Instanz nicht erreichbar: Hostname konnte nicht aufgelöst werden.",
      items: [],
    });
    expect(humanizeError("ERR_INTERNET_DISCONNECTED")).toBe("Keine Netzwerkverbindung.");
    expect(humanizeError("Zeitüberschreitung.")).toBe("Zeitüberschreitung.");
  });

  it("unbekannte Formen bleiben ein Satz", () => {
    expect(parseOfflineReason("Keine Instanz-URL konfiguriert.")).toEqual({ summary: "Keine Instanz-URL konfiguriert.", items: [] });
    expect(parseOfflineReason(null).summary).toBe("Instanz nicht erreichbar.");
  });

  it("letzter Kontakt", () => {
    const now = new Date(2026, 9, 2, 10, 0);
    expect(formatLastSeen(new Date(2026, 9, 2, 9, 50), now)).toBe("um 09:50");
    expect(formatLastSeen(new Date(2026, 9, 1, 18, 5), now)).toBe("gestern um 18:05");
    expect(formatLastSeen(new Date(2026, 8, 28, 7, 30), now)).toBe("am 28.09. um 07:30");
    expect(parseTimestamp("1759391400000")?.getTime()).toBe(1759391400000);
    expect(parseTimestamp("2026-10-02T09:50:00+02:00")).not.toBeNull();
    expect(parseTimestamp("gestern")).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
  });
});

describe("Updates", () => {
  it("kurz und lang", () => {
    expect(updateShort({ status: "none", version: null, message: null, progress: null })).toEqual({ text: "Auf dem neuesten Stand", tone: "ok" });
    expect(updateShort({ status: "downloading", version: "0.2.0", message: null, progress: 45 }).text).toBe("Update 0.2.0 wird geladen · 45 %");
    expect(updateLong({ status: "downloading", version: "0.2.0", message: "Version 0.2.0 wird geladen…", progress: 45 })).toBe("Version 0.2.0 wird geladen… (45 %)");
    expect(updateLong({ status: "unsupported", version: null, message: "Updates gibt es nur in der gepackten App (DMG).", progress: null })).toBe(
      "Updates gibt es nur in der gepackten App (DMG).",
    );
  });
});

describe("Berechtigungen und Sprachen", () => {
  it("Status-Pillen", () => {
    expect(permissionView("granted")).toMatchObject({ tone: "ok", granted: true });
    expect(permissionView(true)).toMatchObject({ tone: "ok", granted: true });
    expect(permissionView("denied")).toMatchObject({ tone: "err", granted: false });
    expect(permissionView(false)).toMatchObject({ tone: "warn", granted: false });
    expect(permissionView("notDetermined").text).toBe("Noch nicht gefragt");
    expect(permissionView(undefined).tone).toBe("idle");
  });

  it("Sprachnamen auf Deutsch, aktuelle Sprache immer in der Liste", () => {
    expect(localeName("de-DE")).toBe("Deutsch (Deutschland)");
    expect(localeName("nicht_gültig")).toBe("nicht_gültig");
    const list = sortLocales(["en-US", "de-DE", "de-CH", "en-US"], "fr-FR");
    expect(list).toHaveLength(4);
    expect(list).toContain("fr-FR");
    expect(list[0]).toBe("de-DE");
  });

  it("Host einer Adresse", () => {
    expect(hostOf("https://kira.example.de/")).toBe("kira.example.de");
    expect(hostOf("192.168.178.166:8420")).toBe("192.168.178.166:8420");
    expect(hostOf("")).toBeNull();
  });
});

describe("Einstellungen: Bereich aus Name oder ?section=", () => {
  it("kennt deutsche und englische Namen, sonst nichts", () => {
    expect(sectionFromName("kuerzel")).toBe("kuerzel");
    expect(sectionFromName("Hotkeys")).toBe("kuerzel");
    expect(sectionFromName("constructor")).toBeNull();
    expect(sectionFromName("")).toBeNull();
    expect(sectionFromQuery("?section=hotkeys")).toBe("kuerzel");
    expect(sectionFromQuery("?section=__proto__")).toBe("instanz");
  });
});

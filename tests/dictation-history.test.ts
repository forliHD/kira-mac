import { describe, expect, it } from "vitest";

import { DictationHistory, HISTORY_MAX_AGE_MS, HISTORY_MAX_ENTRIES, type HistoryCodec, type HistoryFs } from "../src/main/dictation-history";

// Diktat-Verlauf (Owner-Wunsch 02.10.2026): nur lokal, verschlüsselt, begrenzt.

/** Spielzeug-Verschlüsselung: kehrt die Bytes um – genug, um „kein Klartext“ zu prüfen. */
const codec: HistoryCodec = {
  encrypt: (plain) => Buffer.from(Buffer.from(plain, "utf8").reverse()),
  decrypt: (data) => Buffer.from(data).reverse().toString("utf8"),
};

function memoryFs(): HistoryFs & { data: Buffer | null; writes: number } {
  const fs = {
    data: null as Buffer | null,
    writes: 0,
    read: () => fs.data,
    write: (d: Buffer) => {
      fs.data = Buffer.from(d);
      fs.writes += 1;
    },
    remove: () => {
      fs.data = null;
    },
  };
  return fs;
}

const T0 = 1_800_000_000_000;

function entry(text: string, at = T0, extra: Partial<{ app: string | null; failed: boolean }> = {}) {
  return { at, app: extra.app ?? "Mail", target: "insert" as const, text, failed: extra.failed ?? false };
}

describe("DictationHistory", () => {
  it("speichert verschlüsselt und liest es wieder (neueste zuerst)", () => {
    const fs = memoryFs();
    const h = new DictationHistory({ codec, fs, now: () => T0 });
    h.add(entry("Erstes Diktat"));
    h.add(entry("Zweites Diktat mit Umlaut äöü", T0 + 1000, { failed: true }));
    expect(fs.data).not.toBeNull();
    expect(fs.data?.toString("utf8")).not.toContain("Zweites Diktat");

    const again = new DictationHistory({ codec, fs, now: () => T0 + 2000 });
    again.load();
    expect(again.list().map((e) => e.text)).toEqual(["Zweites Diktat mit Umlaut äöü", "Erstes Diktat"]);
    expect(again.latest()?.failed).toBe(true);
    expect(again.persistent).toBe(true);
  });

  it("ohne Verschlüsselung nur im Arbeitsspeicher – nie Klartext auf der Platte", () => {
    const fs = memoryFs();
    const h = new DictationHistory({ codec: null, fs, now: () => T0 });
    h.add(entry("Geheim"));
    expect(h.list()).toHaveLength(1);
    expect(fs.writes).toBe(0);
    expect(h.persistent).toBe(false);
  });

  it("leere Diktate zählen nicht, Text wird getrimmt", () => {
    const h = new DictationHistory({ codec, fs: memoryFs(), now: () => T0 });
    expect(h.add(entry("   "))).toBeNull();
    expect(h.add(entry("  Hallo  "))?.text).toBe("Hallo");
  });

  it("hält höchstens 100 Einträge und 30 Tage", () => {
    let now = T0;
    const h = new DictationHistory({ codec, fs: memoryFs(), now: () => now });
    for (let i = 0; i < HISTORY_MAX_ENTRIES + 5; i++) h.add(entry(`D${i}`, T0 + i));
    expect(h.list()).toHaveLength(HISTORY_MAX_ENTRIES);
    expect(h.list()[0]?.text).toBe(`D${HISTORY_MAX_ENTRIES + 4}`);
    now = T0 + HISTORY_MAX_AGE_MS + 1_000;
    h.add(entry("Neu", now));
    expect(h.list().map((e) => e.text)).toEqual(["Neu"]);
  });

  it("löscht einzeln und komplett (Datei weg)", () => {
    const fs = memoryFs();
    const h = new DictationHistory({ codec, fs, now: () => T0 });
    const a = h.add(entry("A"));
    h.add(entry("B"));
    expect(h.remove(a?.id ?? "")).toBe(true);
    expect(h.remove("gibt-es-nicht")).toBe(false);
    expect(h.list().map((e) => e.text)).toEqual(["B"]);
    h.clear();
    expect(h.list()).toEqual([]);
    expect(fs.data).toBeNull();
  });

  it("unlesbare Datei (anderer Schlüssel) → leer statt Absturz", () => {
    const fs = memoryFs();
    fs.data = Buffer.from("kaputt");
    const warnings: string[] = [];
    const h = new DictationHistory({ codec, fs, now: () => T0, onWarn: (e) => warnings.push(e) });
    h.load();
    expect(h.list()).toEqual([]);
    expect(warnings).toContain("dictation_history_unreadable");
  });
});

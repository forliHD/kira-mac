import { describe, expect, it } from "vitest";

import {
  type KeyInfo,
  activityLine,
  connectionPill,
  desiredHeight,
  dictationClock,
  dictationTime,
  filterDictations,
  fitHints,
  footerHints,
  footerNote,
  formatAccelerator,
  groupDictations,
  groupTools,
  insertText,
  isSubmitKey,
  keyAction,
  micLevel,
  moveSelection,
  partialPreview,
  quickStage,
  shortHost,
  shouldReport,
  statusChip,
  stoppedNote,
  suggestionsFor,
} from "../src/renderer/quick/logic";

const key = (k: string, mods: Partial<KeyInfo> = {}): KeyInfo => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, ...mods });

describe("Tasten", () => {
  it("Esc blendet aus, ⌘↩ öffnet nur mit Sitzung, ⌘N startet neu", () => {
    expect(keyAction(key("Escape"), { hasSession: false })).toBe("hide");
    expect(keyAction(key("Enter", { metaKey: true }), { hasSession: true })).toBe("open-main");
    expect(keyAction(key("Enter", { metaKey: true }), { hasSession: false })).toBeNull();
    expect(keyAction(key("n", { metaKey: true }), { hasSession: false })).toBe("reset");
  });

  it("⌘1 Chat, ⌘2 Diktate – ohne ⌘ nichts", () => {
    expect(keyAction(key("1", { metaKey: true }), { hasSession: false })).toBe("view-chat");
    expect(keyAction(key("2", { metaKey: true }), { hasSession: false })).toBe("view-dictations");
    expect(keyAction(key("2"), { hasSession: false })).toBeNull();
    expect(keyAction(key("2", { metaKey: true, shiftKey: true }), { hasSession: false })).toBeNull();
  });

  it("fängt während einer IME-Komposition und bei fremden Kürzeln nichts ab", () => {
    expect(keyAction(key("Escape", { isComposing: true }), { hasSession: true })).toBeNull();
    // ⌘⇧D gehört dem globalen Diktat, ⌘C/⌘A dem Text.
    expect(keyAction(key("d", { metaKey: true, shiftKey: true }), { hasSession: true })).toBeNull();
    expect(keyAction(key("c", { metaKey: true }), { hasSession: true })).toBeNull();
    expect(keyAction(key("n", { metaKey: true, shiftKey: true }), { hasSession: true })).toBeNull();
    expect(keyAction(key("Escape", { shiftKey: true }), { hasSession: true })).toBeNull();
  });

  it("↩ sendet, ⇧↩ und IME-Bestätigung nicht", () => {
    expect(isSubmitKey(key("Enter"))).toBe(true);
    expect(isSubmitKey(key("Enter", { shiftKey: true }))).toBe(false);
    expect(isSubmitKey(key("Enter", { isComposing: true }))).toBe(false);
    expect(isSubmitKey(key("Enter", { metaKey: true }))).toBe(false);
    expect(isSubmitKey(key("a"))).toBe(false);
  });

  it("zeigt Electron-Kürzel als Mac-Zeichen in Apple-Reihenfolge", () => {
    expect(formatAccelerator("Alt+Space")).toEqual(["⌥", "␣"]);
    expect(formatAccelerator("CommandOrControl+Shift+D")).toEqual(["⇧", "⌘", "D"]);
    expect(formatAccelerator("Command+Alt+Control+k")).toEqual(["⌃", "⌥", "⌘", "K"]);
    expect(formatAccelerator("F5")).toEqual(["F5"]);
    expect(formatAccelerator("")).toEqual([]);
    expect(formatAccelerator("Fn")).toEqual(["🌐 fn"]);
  });
});

describe("Texte", () => {
  it("Verbindungspille je Modus", () => {
    expect(connectionPill(null)).toEqual({ tone: "idle", text: "Verbinde…" });
    expect(connectionPill({ mode: "server", connection: { online: true, label: "kira.reiser.de" } })).toEqual({ tone: "ok", text: "Verbunden · kira.reiser.de" });
    expect(connectionPill({ mode: "server", connection: { online: true, label: " " } })).toEqual({ tone: "ok", text: "Verbunden" });
    expect(connectionPill({ mode: "local", connection: { online: false, label: "x" } })).toEqual({ tone: "warn", text: "Offline · Apple-Modell auf diesem Mac" });
    expect(connectionPill({ mode: "offline", connection: { online: false, label: "x" } })).toEqual({ tone: "err", text: "Offline" });
  });

  it("Fußzeile und Vorschläge je Modus; offline ohne Vorschläge", () => {
    expect(footerNote("server").text).toBe("Antworten landen im Chat-Verlauf");
    expect(footerNote("local").text).toBe("Ohne Verbindung: Apple-Modell");
    expect(suggestionsFor("server").map((s) => s.label)).toEqual(["Was steht heute an?", "Fasse meine neuen Mails zusammen", "Formuliere eine kurze Antwort …"]);
    expect(suggestionsFor("local")).toHaveLength(3);
    expect(suggestionsFor("offline")).toEqual([]);
  });

  it("Stopp-Hinweis: Server arbeitet weiter, lokal nicht", () => {
    expect(stoppedNote(false)).toBe("Gestoppt – KIRA arbeitet im Hintergrund weiter, die Antwort steht im Chat.");
    expect(stoppedNote(true)).toBe("Gestoppt.");
  });

  it("Aktivitätszeile nur beim Arbeiten und nicht doppelt zum laufenden Werkzeug", () => {
    const running = { name: "mail_search", label: "Durchsucht das Postfach", status: "running" as const };
    expect(activityLine({ status: "streaming", text: "", activity: "Denkt nach…", tools: [] })).toBe("Denkt nach…");
    expect(activityLine({ status: "streaming", text: "", activity: null, tools: [] })).toBe("Denkt nach…");
    expect(activityLine({ status: "streaming", text: "", activity: "Durchsucht das Postfach…", tools: [running] })).toBeNull();
    expect(activityLine({ status: "streaming", text: "", activity: "Warte auf Bestätigung", tools: [running] })).toBe("Warte auf Bestätigung");
    expect(activityLine({ status: "streaming", text: "Antwort", activity: "Denkt nach…", tools: [] })).toBeNull();
    expect(activityLine({ status: "done", text: "", activity: "Denkt nach…", tools: [] })).toBeNull();
  });

  it("bündelt gleiche Werkzeuge; ein laufendes macht den Chip laufend", () => {
    expect(
      groupTools([
        { name: "mail_read", label: "Liest eine Mail", status: "done" },
        { name: "calendar_list_events", label: "Schaut in den Kalender", status: "done" },
        { name: "mail_read", label: "Liest eine Mail", status: "running" },
        { name: "x", label: "", status: "error" },
      ]),
    ).toEqual([
      { label: "Liest eine Mail", status: "running", count: 2 },
      { label: "Schaut in den Kalender", status: "done", count: 1 },
      { label: "x", status: "error", count: 1 },
    ]);
  });

  it("Diktat-Vorschau zeigt das Ende langer Texte", () => {
    expect(partialPreview("  kurz  und   gut ")).toBe("kurz und gut");
    const long = "eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf dreizehn vierzehn fünfzehn sechzehn siebzehn achtzehn";
    const preview = partialPreview(long, 40);
    expect(preview.startsWith("… ")).toBe(true);
    expect(preview.endsWith("achtzehn")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(42);
  });
});

describe("Einfügen und Höhe", () => {
  it("fügt Diktat an der Schreibmarke ein – ein Leerzeichen, keins vor Satzzeichen", () => {
    expect(insertText("", 0, 0, "Hallo")).toEqual({ value: "Hallo", caret: 5 });
    expect(insertText("Hallo", 5, 5, "Welt")).toEqual({ value: "Hallo Welt", caret: 10 });
    expect(insertText("Hallo ", 6, 6, "Welt")).toEqual({ value: "Hallo Welt", caret: 10 });
    expect(insertText("Hallo", 5, 5, ", oder?")).toEqual({ value: "Hallo, oder?", caret: 12 });
    // Mitten im Text: Lücke danach ergänzen; markierter Text wird ersetzt.
    expect(insertText("Hallo Welt", 5, 5, "liebe")).toEqual({ value: "Hallo liebe Welt", caret: 11 });
    expect(insertText("Hallo Welt", 6, 10, "KIRA")).toEqual({ value: "Hallo KIRA", caret: 10 });
    expect(insertText("Hallo", 5, 5, "  ")).toEqual({ value: "Hallo", caret: 5 });
  });

  it("gewünschte Höhe = sichtbar + weggescrollt, gemeldet nur bei > 1 px", () => {
    expect(desiredHeight(170, 0, 0)).toBe(170);
    expect(desiredHeight(700, 1240, 500.4)).toBe(1440);
    expect(shouldReport(null, 170)).toBe(true);
    expect(shouldReport(170, 171)).toBe(false);
    expect(shouldReport(170, 172)).toBe(true);
    expect(shouldReport(null, 0)).toBe(false);
  });

  it("Mikrofonpegel wird verstärkt und begrenzt", () => {
    expect(micLevel(0)).toBe(0);
    expect(micLevel(0.25)).toBeCloseTo(0.55);
    expect(micLevel(3)).toBe(1);
    expect(micLevel(Number.NaN)).toBe(0);
  });
});


describe("Diktate-Ansicht", () => {
  const e = (id: string, text: string, app: string | null = "Mail", at = 0) => ({ id, at, app, target: "insert" as const, text, failed: false });
  const list = [e("1", "Hallo Herr Kaya, anbei die Unterlagen"), e("2", "Datensicherung fehlgeschlagen", "Google Chrome"), e("3", "Was steht heute an?", "KIRA")];

  it("sucht in Text und Programm, jedes Wort muss passen", () => {
    expect(filterDictations(list, "").map((x) => x.id)).toEqual(["1", "2", "3"]);
    expect(filterDictations(list, "kaya").map((x) => x.id)).toEqual(["1"]);
    expect(filterDictations(list, "chrome sicherung").map((x) => x.id)).toEqual(["2"]);
    expect(filterDictations(list, "kaya chrome")).toEqual([]);
    expect(filterDictations(list, "  HEUTE  ").map((x) => x.id)).toEqual(["3"]);
  });

  it("Zeitangaben", () => {
    const now = new Date(2026, 9, 2, 14, 0).getTime();
    expect(dictationTime(now - 20_000, now)).toBe("gerade eben");
    expect(dictationTime(now - 4 * 60_000, now)).toBe("vor 4 Min.");
    expect(dictationTime(new Date(2026, 9, 2, 9, 5).getTime(), now)).toBe("heute 09:05");
    expect(dictationTime(new Date(2026, 9, 1, 11, 56).getTime(), now)).toBe("gestern 11:56");
    expect(dictationTime(new Date(2026, 8, 28, 9, 10).getTime(), now)).toBe("28.09. 09:10");
  });

  it("Auswahl mit Pfeiltasten bleibt im Bereich", () => {
    expect(moveSelection(-1, 1, 3)).toBe(0);
    expect(moveSelection(-1, -1, 3)).toBe(2);
    expect(moveSelection(0, -1, 3)).toBe(0);
    expect(moveSelection(2, 1, 3)).toBe(2);
    expect(moveSelection(1, 1, 3)).toBe(2);
    expect(moveSelection(0, 1, 0)).toBe(-1);
  });
});

describe("Zwei Stufen und Fußleiste (Phase 3)", () => {
  it("Stufe: Leiste nur im leeren Chat, sonst Gesprächshöhe", () => {
    expect(quickStage("chat", false, false)).toBe("bar");
    expect(quickStage("chat", true, false)).toBe("tall");
    expect(quickStage("chat", false, true)).toBe("tall");
    expect(quickStage("dictations", false, false)).toBe("tall");
  });

  it("kurzer Instanzname und Status-Chip", () => {
    expect(shortHost("kira-dev.it-reiser.cloud")).toBe("kira-dev");
    expect(shortHost("kira.reiser.de")).toBe("kira");
    expect(shortHost("192.168.178.166")).toBe("192.168.178.166");
    expect(shortHost("localhost")).toBe("localhost");
    expect(statusChip(null)).toMatchObject({ tone: "idle", text: "Verbinde…" });
    expect(statusChip({ mode: "server", connection: { online: true, label: "kira-dev.it-reiser.cloud" } })).toMatchObject({ tone: "ok", text: "kira-dev" });
    expect(statusChip({ mode: "server", connection: { online: true, label: "kira-dev.it-reiser.cloud" } }).title).toContain("Chat-Verlauf");
    expect(statusChip({ mode: "local", connection: { online: false, label: "x" } })).toMatchObject({ tone: "warn", text: "Apple-Modell" });
    expect(statusChip({ mode: "offline", connection: { online: false, label: "x" } })).toMatchObject({ tone: "err", text: "Offline" });
  });

  it("Sendetaste ⌘↩: ↩ macht die Zeile, ⌘↩ sendet, ⌘⇧↩ öffnet das Hauptfenster", () => {
    expect(isSubmitKey(key("Enter"), "cmd-enter")).toBe(false);
    expect(isSubmitKey(key("Enter", { metaKey: true }), "cmd-enter")).toBe(true);
    expect(isSubmitKey(key("Enter", { metaKey: true, shiftKey: true }), "cmd-enter")).toBe(false);
    expect(isSubmitKey(key("Enter", { metaKey: true }), "enter")).toBe(false);
    expect(keyAction(key("Enter", { metaKey: true }), { hasSession: true, sendKey: "cmd-enter" })).toBeNull();
    expect(keyAction(key("Enter", { metaKey: true, shiftKey: true }), { hasSession: true, sendKey: "cmd-enter" })).toBe("open-main");
    expect(keyAction(key("Enter", { metaKey: true, shiftKey: true }), { hasSession: true, sendKey: "enter" })).toBeNull();
  });

  it("Tastenhinweise je Ansicht und Sendetaste", () => {
    expect(footerHints("chat", false).map((h) => h.keys)).toEqual(["↩", "esc"]);
    expect(footerHints("chat", true).map((h) => h.keys)).toEqual(["↩", "⌘↩", "esc"]);
    expect(footerHints("chat", true, "cmd-enter").map((h) => h.keys)).toEqual(["⌘↩", "⌘⇧↩", "esc"]);
    expect(footerHints("dictations", true).map((h) => h.label)).toEqual(["kopieren", "in den Chat", "schließen"]);
  });

  it("Hinweise passen sich ein: erst Wörter weg, dann ganze Hinweise von hinten", () => {
    // ↩ kopieren · ⌘↩ in den Chat · esc schließen (Breiten wie im Fenster, gerundet)
    const full = [80, 100, 95];
    const caps = [22, 30, 30];
    expect(fitHints(full, caps, 10, 400)).toEqual({ count: 3, labels: true });
    expect(fitHints(full, caps, 10, 295)).toEqual({ count: 3, labels: true });
    expect(fitHints(full, caps, 10, 295.4)).toEqual({ count: 3, labels: true });
    expect(fitHints(full, caps, 10, 294)).toEqual({ count: 3, labels: false });
    expect(fitHints(full, caps, 10, 102)).toEqual({ count: 3, labels: false });
    expect(fitHints(full, caps, 10, 101)).toEqual({ count: 2, labels: false });
    expect(fitHints(full, caps, 10, 22)).toEqual({ count: 1, labels: false });
    expect(fitHints(full, caps, 10, 10)).toEqual({ count: 0, labels: false });
    expect(fitHints([], [], 10, 0)).toEqual({ count: 0, labels: true });
  });

  it("Diktate nach Tagen, Uhrzeit innerhalb des Tages", () => {
    const now = new Date(2026, 9, 21, 14, 0).getTime();
    const e = (id: string, at: number) => ({ id, at, app: "Mail", target: "insert" as const, text: id, failed: false });
    const groups = groupDictations(
      [e("a", now - 30_000), e("b", new Date(2026, 9, 21, 9, 5).getTime()), e("c", new Date(2026, 9, 20, 18, 30).getTime()), e("d", new Date(2026, 9, 12, 8, 0).getTime())],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(["Heute", "Gestern", "Mo., 12.10."]);
    expect(groups.map((g) => g.entries.map((x) => x.id))).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(dictationClock(now - 30_000, now)).toBe("gerade eben");
    expect(dictationClock(now - 4 * 60_000, now)).toBe("vor 4 Min.");
    expect(dictationClock(new Date(2026, 9, 21, 9, 5).getTime(), now)).toBe("09:05");
    expect(groupDictations([], now)).toEqual([]);
  });
});

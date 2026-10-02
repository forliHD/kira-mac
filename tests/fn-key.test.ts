import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FN_HOLD_MS, type FnDictationControl, FnKeyController, FnKeyMachine } from "../src/main/fn-key";
import { FN_HOTKEY, FN_LABEL, KEYBOARD_SETTINGS_URL, fnSystemActionFrom, fnSystemActionLabel, isAllowedSettingsUrl, isFnHotkey } from "../src/shared/hotkey";
import { type HelperEvent } from "../src/shared/helper-types";
import { type FnKeyStatus } from "../src/shared/local-api";

// Diktat über die 🌐 fn-Taste: Tippen schaltet um, Halten ist Sprechen, eine
// andere Taste dazu ist eine Tastenkombination (dann passiert nichts bzw. ein
// gerade gestartetes Diktat wird verworfen).

function fakeDictation(initiallyActive = false) {
  let active = initiallyActive;
  const calls: string[] = [];
  const control: FnDictationControl = {
    isActive: () => active,
    toggle: () => {
      calls.push("toggle");
      active = !active;
    },
    start: () => {
      calls.push("start");
      active = true;
    },
    stop: () => {
      calls.push("stop");
      active = false;
    },
    cancel: () => {
      calls.push("cancel");
      active = false;
    },
  };
  return {
    calls,
    control,
    setActive: (value: boolean) => {
      active = value;
    },
  };
}

describe("shared/hotkey", () => {
  it("erkennt die fn-Taste und zeigt sie wie auf der Tastatur", () => {
    expect(FN_HOTKEY).toBe("Fn");
    expect(isFnHotkey("Fn")).toBe(true);
    expect(isFnHotkey(" fn ")).toBe(true);
    expect(isFnHotkey("Control+Alt+D")).toBe(false);
    expect(isFnHotkey("Control+Fn")).toBe(false);
    expect(isFnHotkey(null)).toBe(false);
    expect(FN_LABEL).toBe("🌐 fn");
  });

  it("übersetzt AppleFnUsageType in die Optionen von macOS", () => {
    expect(fnSystemActionFrom(0)).toBe("none");
    expect(fnSystemActionFrom(1)).toBe("inputSource");
    expect(fnSystemActionFrom(2)).toBe("emoji");
    expect(fnSystemActionFrom(3)).toBe("dictation");
    expect(fnSystemActionFrom(null)).toBe("default");
    expect(fnSystemActionFrom(9)).toBe("default");
    expect(fnSystemActionLabel("none")).toBe("Keine Aktion");
    expect(fnSystemActionLabel("emoji")).toBe("Emoji & Symbole");
  });

  it("lässt lokale Seiten nur die Tastatur-Einstellungen öffnen", () => {
    expect(isAllowedSettingsUrl(KEYBOARD_SETTINGS_URL)).toBe(true);
    expect(isAllowedSettingsUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")).toBe(false);
    expect(isAllowedSettingsUrl("file:///etc/passwd")).toBe(false);
  });
});

describe("FnKeyMachine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("kurz tippen schaltet um (wie das Tastenkürzel)", () => {
    const d = fakeDictation();
    const m = new FnKeyMachine({ dictation: d.control });
    m.down();
    vi.advanceTimersByTime(120);
    m.up();
    expect(d.calls).toEqual(["toggle"]);
    vi.advanceTimersByTime(1_000);
    expect(d.calls).toEqual(["toggle"]);
    expect(m.currentPhase).toBe("up");
  });

  it("ein zweites Tippen beendet das laufende Diktat", () => {
    const d = fakeDictation();
    const m = new FnKeyMachine({ dictation: d.control });
    m.down();
    m.up();
    expect(d.control.isActive()).toBe(true);
    vi.advanceTimersByTime(5_000);
    m.down();
    vi.advanceTimersByTime(80);
    m.up();
    expect(d.calls).toEqual(["toggle", "toggle"]);
    expect(d.control.isActive()).toBe(false);
  });

  it("halten startet nach der Haltezeit, loslassen beendet und setzt ein", () => {
    const d = fakeDictation();
    const m = new FnKeyMachine({ dictation: d.control });
    m.down();
    vi.advanceTimersByTime(FN_HOLD_MS - 1);
    expect(d.calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(d.calls).toEqual(["start"]);
    expect(m.currentPhase).toBe("held");
    vi.advanceTimersByTime(4_000);
    m.up();
    expect(d.calls).toEqual(["start", "stop"]);
  });

  it("fn mit einer anderen Taste vor der Haltezeit: nichts passiert", () => {
    const d = fakeDictation();
    const m = new FnKeyMachine({ dictation: d.control });
    m.down();
    vi.advanceTimersByTime(90);
    m.chord();
    vi.advanceTimersByTime(2_000);
    m.up();
    expect(d.calls).toEqual([]);
  });

  it("Kombination nach gestartetem Halten verwirft das Diktat (nichts eingesetzt)", () => {
    const d = fakeDictation();
    const m = new FnKeyMachine({ dictation: d.control });
    m.down();
    vi.advanceTimersByTime(FN_HOLD_MS + 50);
    expect(d.calls).toEqual(["start"]);
    m.chord();
    expect(d.calls).toEqual(["start", "cancel"]);
    m.chord();
    m.up();
    expect(d.calls).toEqual(["start", "cancel"]);
  });

  it("während eines getippten Diktats bleibt eine Kombination ohne Wirkung", () => {
    const d = fakeDictation(true);
    const m = new FnKeyMachine({ dictation: d.control });
    m.down();
    vi.advanceTimersByTime(60);
    m.chord();
    vi.advanceTimersByTime(600);
    m.up();
    expect(d.calls).toEqual([]);
    expect(d.control.isActive()).toBe(true);
  });

  it("langes Drücken beendet ein schon laufendes Diktat beim Loslassen, startet aber nichts", () => {
    const d = fakeDictation(true);
    const m = new FnKeyMachine({ dictation: d.control });
    m.down();
    vi.advanceTimersByTime(800);
    expect(d.calls).toEqual([]);
    m.up();
    expect(d.calls).toEqual(["stop"]);
  });

  it("im Passwortfeld startet fn nichts, beendet aber ein laufendes Diktat", () => {
    const idle = fakeDictation();
    const actions: string[] = [];
    const m1 = new FnKeyMachine({ dictation: idle.control, onAction: (a) => actions.push(a) });
    m1.down({ secure: true });
    vi.advanceTimersByTime(900);
    m1.up();
    m1.down({ secure: true });
    m1.up();
    expect(idle.calls).toEqual([]);
    expect(actions).toEqual(["secure-ignored", "secure-ignored"]);

    const running = fakeDictation(true);
    const m2 = new FnKeyMachine({ dictation: running.control });
    m2.down({ secure: true });
    m2.up();
    expect(running.calls).toEqual(["toggle"]);
  });

  it("reset vergisst den Druck samt Haltezeit, doppeltes Drücken zählt einmal", () => {
    const d = fakeDictation();
    const m = new FnKeyMachine({ dictation: d.control });
    m.down();
    m.reset();
    vi.advanceTimersByTime(2_000);
    m.up();
    expect(d.calls).toEqual([]);

    m.down();
    vi.advanceTimersByTime(100);
    m.down();
    vi.advanceTimersByTime(100);
    m.up();
    expect(d.calls).toEqual(["toggle"]);
  });

  it("meldet, was ein Druck ausgelöst hat (für das Protokoll, ohne Tasten)", () => {
    const d = fakeDictation();
    const actions: string[] = [];
    const m = new FnKeyMachine({ dictation: d.control, onAction: (a) => actions.push(a) });
    m.down();
    m.up();
    d.setActive(false); // das getippte Diktat ist inzwischen wieder aus
    m.down();
    vi.advanceTimersByTime(FN_HOLD_MS);
    m.chord();
    m.up();
    expect(actions).toEqual(["tap", "hold-start", "chord-cancel"]);
  });
});

class FakeFnHelper extends EventEmitter {
  running = true;
  readonly calls: Array<{ cmd: string; params?: Record<string, unknown> }> = [];
  fnUsage: number | null = 0;
  /** Nächste Antwort auf fn.watch {enabled:true}: Ergebnis oder Fehler. */
  watchError: { code: string; message: string } | null = null;

  request<T = unknown>(cmd: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push(params === undefined ? { cmd } : { cmd, params });
    if (cmd === "fn.watch") {
      if (params?.enabled === true && this.watchError) {
        const err = Object.assign(new Error(this.watchError.message), { code: this.watchError.code });
        return Promise.reject(err);
      }
      return Promise.resolve({ watching: params?.enabled === true, tap: params?.enabled === true ? "active" : "off", fnUsage: this.fnUsage } as T);
    }
    if (cmd === "fn.status") return Promise.resolve({ watching: true, tap: "active", fnUsage: this.fnUsage } as T);
    return Promise.reject(Object.assign(new Error("unbekannt"), { code: "unknown_command" }));
  }

  fire(event: string, data: Record<string, unknown> = {}): void {
    const ev: HelperEvent = { event, data };
    this.emit("event", ev);
  }

  watchCalls(): Array<unknown> {
    return this.calls.filter((c) => c.cmd === "fn.watch").map((c) => c.params?.enabled);
  }
}

function controller(opts: { enabled?: () => boolean; helper?: FakeFnHelper; now?: () => number; active?: boolean } = {}) {
  const helper = opts.helper ?? new FakeFnHelper();
  const d = fakeDictation(opts.active ?? false);
  const statuses: FnKeyStatus[] = [];
  const c = new FnKeyController({ helper, dictation: d.control, enabled: opts.enabled ?? (() => true), now: opts.now });
  c.on("status", (s) => statuses.push(s));
  return { helper, d, c, statuses };
}

describe("FnKeyController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ohne Auswahl „Fn“: kein Abhören, Ereignisse ohne Wirkung", async () => {
    const { helper, d, c } = controller({ enabled: () => false });
    await c.apply();
    expect(helper.watchCalls()).toEqual([]);
    expect(c.status.state).toBe("off");
    helper.fire("fn.down", { secure: false });
    helper.fire("fn.up", { chord: false });
    expect(d.calls).toEqual([]);
  });

  it("mit „Fn“: schaltet den Tap ein, meldet „active“ und die Systemeinstellung", async () => {
    const helper = new FakeFnHelper();
    helper.fnUsage = 2;
    const { c, statuses } = controller({ helper });
    await c.apply();
    expect(helper.watchCalls()).toEqual([true]);
    expect(c.status).toEqual({ state: "active", message: null, systemAction: "emoji" });
    expect(statuses.map((s) => s.state)).toEqual(["starting", "active"]);
    // Nochmal anwenden ändert nichts und meldet nichts Neues.
    await c.apply();
    expect(helper.watchCalls()).toEqual([true]);
    expect(statuses).toHaveLength(2);
  });

  it("Ereignisse des Helfers treiben die Maschine: Tippen, Halten, Kombination", async () => {
    const { helper, d, c } = controller();
    await c.apply();

    helper.fire("fn.down", { secure: false });
    vi.advanceTimersByTime(100);
    helper.fire("fn.up", { chord: false });
    expect(d.calls).toEqual(["toggle"]);

    helper.fire("fn.down", { secure: false });
    vi.advanceTimersByTime(100);
    helper.fire("fn.up", { chord: false });
    expect(d.calls).toEqual(["toggle", "toggle"]);

    helper.fire("fn.down", { secure: false });
    vi.advanceTimersByTime(FN_HOLD_MS);
    helper.fire("fn.chord");
    helper.fire("fn.up", { chord: true });
    expect(d.calls).toEqual(["toggle", "toggle", "start", "cancel"]);
  });

  it("`chord` im Loslassen genügt, falls `fn.chord` verloren ging", async () => {
    const { helper, d, c } = controller();
    await c.apply();
    helper.fire("fn.down", { secure: false });
    vi.advanceTimersByTime(50);
    helper.fire("fn.up", { chord: true });
    expect(d.calls).toEqual([]);
  });

  it("andere Helfer-Ereignisse (stt.*) stören nicht", async () => {
    const { helper, d, c } = controller();
    await c.apply();
    helper.emit("event", { event: "stt.final", stream: "dictation", data: { text: "x" } } satisfies HelperEvent);
    expect(d.calls).toEqual([]);
  });

  it("abwählen schaltet den Tap aus; danach bleiben Ereignisse ohne Wirkung", async () => {
    let enabled = true;
    const { helper, d, c } = controller({ enabled: () => enabled });
    await c.apply();
    enabled = false;
    await c.apply();
    expect(helper.watchCalls()).toEqual([true, false]);
    expect(c.status.state).toBe("off");
    helper.fire("fn.down", { secure: false });
    helper.fire("fn.up", { chord: false });
    expect(d.calls).toEqual([]);
  });

  it("nach einem Neustart des Helfers wird der Tap neu eingeschaltet", async () => {
    const { helper, d, c } = controller();
    await c.apply();
    helper.fire("fn.down", { secure: false });

    helper.running = false;
    helper.emit("exited");
    expect(c.status.state).toBe("unavailable");
    // Ein halber Druck vor dem Absturz löst nach dem Neustart nichts aus.
    vi.advanceTimersByTime(FN_HOLD_MS * 3);
    expect(d.calls).toEqual([]);

    helper.running = true;
    helper.emit("started");
    await vi.waitFor(() => expect(c.status.state).toBe("active"));
    expect(helper.watchCalls()).toEqual([true, true]);

    helper.fire("fn.down", { secure: false });
    helper.fire("fn.up", { chord: false });
    expect(d.calls).toEqual(["toggle"]);
  });

  it("während der Aufnahme eines Kürzels löst fn nichts aus", async () => {
    const { helper, d, c } = controller();
    await c.apply();
    c.setPaused(true);
    expect(c.status.state).toBe("paused");
    helper.fire("fn.down", { secure: false });
    vi.advanceTimersByTime(FN_HOLD_MS * 2);
    helper.fire("fn.up", { chord: false });
    expect(d.calls).toEqual([]);

    c.setPaused(false);
    expect(c.status.state).toBe("active");
    helper.fire("fn.down", { secure: false });
    helper.fire("fn.up", { chord: false });
    expect(d.calls).toEqual(["toggle"]);
  });

  it("fehlende Freigabe: Zustand „permission“ mit Grund, nach der Freigabe klappt es beim Nachsehen", async () => {
    let now = 0;
    const helper = new FakeFnHelper();
    helper.watchError = { code: "permission_denied", message: "KIRA sieht die fn-Taste erst mit der Freigabe „Bedienungshilfen“." };
    const { c } = controller({ helper, now: () => now });
    await c.apply();
    expect(c.status).toMatchObject({ state: "permission", message: "KIRA sieht die fn-Taste erst mit der Freigabe „Bedienungshilfen“." });

    // Gleich danach kein neuer Versuch (kein Dauerfeuer bei jedem Zustandsabruf).
    await c.refresh();
    expect(helper.watchCalls()).toEqual([true]);

    helper.watchError = null;
    now = 5_000;
    const status = await c.refresh();
    expect(helper.watchCalls()).toEqual([true, true]);
    expect(status.state).toBe("active");
  });

  it("refresh liest die Systemeinstellung zu 🌐 nach (höchstens alle 2 s)", async () => {
    let now = 0;
    const helper = new FakeFnHelper();
    helper.fnUsage = null;
    const { c } = controller({ helper, now: () => now });
    await c.apply();
    expect(c.status.systemAction).toBe("default");
    helper.fnUsage = 0;
    now = 1_000;
    expect((await c.refresh()).systemAction).toBe("default");
    now = 3_000;
    expect((await c.refresh()).systemAction).toBe("none");
    expect(helper.calls.filter((x) => x.cmd === "fn.status")).toHaveLength(1);
  });

  it("alter Helfer ohne fn-Kommandos: verständlich „nicht verfügbar“", async () => {
    const helper = new FakeFnHelper();
    helper.watchError = { code: "unknown_command", message: "Unbekanntes Kommando „fn.watch“." };
    const { c } = controller({ helper });
    await c.apply();
    expect(c.status.state).toBe("unavailable");
    expect(c.status.message).toMatch(/Helfer/);
  });

  it("Helfer läuft nicht: „unavailable“ ohne Anfrage", async () => {
    const helper = new FakeFnHelper();
    helper.running = false;
    const { c } = controller({ helper });
    await c.apply();
    expect(helper.calls).toEqual([]);
    expect(c.status.state).toBe("unavailable");
  });

  it("dispose meldet sich vom Helfer ab", async () => {
    const { helper, d, c } = controller();
    await c.apply();
    c.dispose();
    expect(helper.listenerCount("event")).toBe(0);
    expect(helper.listenerCount("started")).toBe(0);
    helper.fire("fn.down", { secure: false });
    helper.fire("fn.up", { chord: false });
    expect(d.calls).toEqual([]);
  });
});

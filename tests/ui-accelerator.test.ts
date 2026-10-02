// Tastenkürzel-Aufnahme der Einstellungen: Tastendruck → Electron-Accelerator
// (src/renderer/lib/accelerator.ts) und die Anzeige als Tastenkappen.

import { describe, expect, it } from "vitest";

import {
  type KeyLike,
  acceleratorFromEvent,
  acceleratorKeys,
  describeAccelerator,
  normalizeAccelerator,
  sameAccelerator,
  spokenAccelerator,
} from "../src/renderer/lib/accelerator";

function key(code: string, mods: Partial<Pick<KeyLike, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">> = {}, keyValue?: string): KeyLike {
  return {
    code,
    key: keyValue ?? (code.startsWith("Key") ? code.slice(3).toLowerCase() : code.startsWith("Digit") ? code.slice(5) : code),
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  };
}

describe("Tastendruck → Accelerator", () => {
  it("wandelt die Standardkürzel in die Schreibweise von config.ts um", () => {
    expect(acceleratorFromEvent(key("Space", { altKey: true }, " "))).toEqual({ type: "done", accelerator: "Alt+Space" });
    expect(acceleratorFromEvent(key("KeyD", { altKey: true, ctrlKey: true }, "∂"))).toEqual({ type: "done", accelerator: "Control+Alt+D" });
  });

  it("lehnt Systemkürzel von macOS ab (⌥⌘D Dock, ⌃⌘D Nachschlagen, ⌃⌘F Vollbild)", () => {
    for (const [code, mods] of [
      ["KeyD", { altKey: true, metaKey: true }],
      ["KeyD", { ctrlKey: true, metaKey: true }],
      ["KeyF", { ctrlKey: true, metaKey: true }],
    ] as const) {
      expect(acceleratorFromEvent(key(code, mods)).type).toBe("invalid");
    }
  });

  it("ordnet Zusatztasten wie macOS (⌃⌥⇧⌘), unabhängig von der Druckreihenfolge", () => {
    expect(acceleratorFromEvent(key("KeyK", { shiftKey: true, ctrlKey: true }))).toEqual({ type: "done", accelerator: "Control+Shift+K" });
    expect(acceleratorFromEvent(key("KeyJ", { metaKey: true, shiftKey: true, altKey: true, ctrlKey: true }))).toEqual({
      type: "done",
      accelerator: "Control+Alt+Shift+Command+J",
    });
  });

  it("nimmt die physische Taste, nicht das Sonderzeichen der ⌥-Belegung", () => {
    expect(acceleratorFromEvent(key("KeyS", { altKey: true, ctrlKey: true }, "‚"))).toEqual({ type: "done", accelerator: "Control+Alt+S" });
    expect(acceleratorFromEvent(key("Digit1", { altKey: true }, "¡"))).toEqual({ type: "done", accelerator: "Alt+1" });
  });

  it("erlaubt F-Tasten auch ohne Zusatztaste", () => {
    expect(acceleratorFromEvent(key("F5"))).toEqual({ type: "done", accelerator: "F5" });
    expect(acceleratorFromEvent(key("F13", { shiftKey: true }))).toEqual({ type: "done", accelerator: "Shift+F13" });
    expect(acceleratorFromEvent(key("F12", { metaKey: true }))).toEqual({ type: "done", accelerator: "Command+F12" });
  });

  it("Esc bricht ab – auch mit Zusatztasten", () => {
    expect(acceleratorFromEvent(key("Escape"))).toEqual({ type: "cancel" });
    expect(acceleratorFromEvent(key("Escape", { metaKey: true }))).toEqual({ type: "cancel" });
  });

  it("⌫ ohne Zusatztaste entfernt das Kürzel", () => {
    expect(acceleratorFromEvent(key("Backspace"))).toEqual({ type: "clear" });
    expect(acceleratorFromEvent(key("Delete"))).toEqual({ type: "clear" });
    expect(acceleratorFromEvent(key("Backspace", { altKey: true })).type).toBe("invalid");
  });

  it("wartet, solange nur Zusatztasten gedrückt sind", () => {
    expect(acceleratorFromEvent(key("MetaLeft", { metaKey: true }, "Meta"))).toEqual({ type: "partial", modifiers: ["Command"] });
    expect(acceleratorFromEvent(key("AltRight", { altKey: true, metaKey: true }, "Alt"))).toEqual({ type: "partial", modifiers: ["Alt", "Command"] });
  });

  it("lehnt Tasten ohne ⌘/⌥/⌃ ab", () => {
    expect(acceleratorFromEvent(key("KeyA")).type).toBe("invalid");
    expect(acceleratorFromEvent(key("KeyA", { shiftKey: true })).type).toBe("invalid");
    expect(acceleratorFromEvent(key("Space", {}, " ")).type).toBe("invalid");
  });

  it("lehnt Kürzel ab, die macOS oder die Programme brauchen", () => {
    expect(acceleratorFromEvent(key("KeyC", { metaKey: true })).type).toBe("invalid");
    expect(acceleratorFromEvent(key("Space", { metaKey: true }, " ")).type).toBe("invalid");
    expect(acceleratorFromEvent(key("Space", { ctrlKey: true }, " ")).type).toBe("invalid");
    expect(acceleratorFromEvent(key("Digit4", { metaKey: true, shiftKey: true })).type).toBe("invalid");
    // ⇧⌘ mit einem Buchstaben bleibt erlaubt.
    expect(acceleratorFromEvent(key("KeyK", { metaKey: true, shiftKey: true }))).toEqual({ type: "done", accelerator: "Shift+Command+K" });
  });

  it("lehnt nicht unterstützte Tasten mit Hinweis ab", () => {
    const r = acceleratorFromEvent(key("Minus", { altKey: true }, "–"));
    expect(r.type).toBe("invalid");
    if (r.type === "invalid") {
      expect(r.message).toMatch(/Buchstaben/);
      expect(r.modifiers).toEqual(["Alt"]);
    }
  });

  it("nutzt `key`, wenn `code` fehlt", () => {
    expect(acceleratorFromEvent({ code: "", key: "k", metaKey: false, ctrlKey: true, altKey: true, shiftKey: false })).toEqual({
      type: "done",
      accelerator: "Control+Alt+K",
    });
  });
});

describe("Accelerator → Anzeige", () => {
  it("zeigt Tastenkappen in macOS-Reihenfolge", () => {
    expect(acceleratorKeys("Alt+Command+D")).toEqual(["⌥", "⌘", "D"]);
    expect(acceleratorKeys("Command+Alt+D")).toEqual(["⌥", "⌘", "D"]);
    expect(acceleratorKeys("Alt+Space")).toEqual(["⌥", "␣"]);
    expect(acceleratorKeys("CommandOrControl+Shift+k")).toEqual(["⇧", "⌘", "K"]);
    expect(acceleratorKeys("")).toEqual([]);
  });

  it("Kurzform und gesprochene Form", () => {
    expect(describeAccelerator("Alt+Command+D")).toBe("⌥⌘D");
    expect(spokenAccelerator("Alt+Space")).toBe("Wahltaste Leertaste");
    expect(spokenAccelerator("Control+Shift+K")).toBe("Control Umschalttaste K");
    expect(spokenAccelerator("")).toBe("kein Kürzel");
  });

  it("vergleicht unabhängig von Reihenfolge, Groß/klein und Aliasen", () => {
    expect(normalizeAccelerator("cmd+option+d")).toBe("Alt+Command+D");
    expect(sameAccelerator("Command+Alt+D", "alt+cmd+d")).toBe(true);
    expect(sameAccelerator("Alt+space", "Option+Space")).toBe(true);
    expect(sameAccelerator("Alt+Space", "Alt+Command+D")).toBe(false);
    expect(sameAccelerator("", "")).toBe(false);
  });
});

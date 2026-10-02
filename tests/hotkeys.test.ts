import { beforeEach, describe, expect, it, vi } from "vitest";

// hotkeys.ts registriert über Electrons globalShortcut – hier eine Attrappe.
const register = vi.fn((_accelerator: string, _handler: () => void) => true);
vi.mock("electron", () => ({ globalShortcut: { register, unregisterAll: vi.fn() } }));
vi.mock("../src/main/log", () => ({ scoped: () => ({ debug() {}, info() {}, warn() {}, error() {} }) }));

const { describeAccelerator, registerHotkeys } = await import("../src/main/hotkeys");

describe("Globale Kürzel und die 🌐 fn-Taste", () => {
  beforeEach(() => {
    register.mockClear();
  });

  it("registriert für „Fn“ kein Electron-Kürzel und meldet keinen Konflikt", () => {
    const conflicts = registerHotkeys({ quickWindow: "Alt+Space", dictation: "Fn" }, { quickWindow: () => undefined, dictation: () => undefined });
    expect(conflicts).toEqual([]);
    expect(register.mock.calls.map((c) => c[0])).toEqual(["Alt+Space"]);
  });

  it("fn geht nur für das Diktat", () => {
    const conflicts = registerHotkeys({ quickWindow: "Fn", dictation: "Control+Alt+D" }, { quickWindow: () => undefined, dictation: () => undefined });
    expect(conflicts).toEqual(["Schnellfenster: Die 🌐 fn-Taste geht nur für das Diktat."]);
    expect(register.mock.calls.map((c) => c[0])).toEqual(["Control+Alt+D"]);
  });

  it("zeigt fn in Menüs als „🌐 fn“", () => {
    expect(describeAccelerator("Fn")).toBe("🌐 fn");
    expect(describeAccelerator("Control+Alt+D")).toBe("⌃⌥D");
    expect(describeAccelerator("Alt+Space")).toBe("⌥Leertaste");
  });
});

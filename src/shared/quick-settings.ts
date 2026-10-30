// Einstellungen des Schnellfensters aus beliebigem JSON (Konfigurationsdatei,
// IPC der Einstellungen) – rein, kein Electron (tests/config-migration.test.ts).

import { QUICK_RESET_CHOICES, type QuickSettings } from "./local-api";

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
export const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** Einstellungen des Schnellfensters aus beliebigem JSON (local-ipc, config). */
export function parseQuickSettings(value: unknown, base: QuickSettings): QuickSettings {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const share = typeof v.chatHeightShare === "number" && Number.isFinite(v.chatHeightShare) ? v.chatHeightShare : base.chatHeightShare;
  const reset = typeof v.resetAfterMin === "number" && QUICK_RESET_CHOICES.includes(v.resetAfterMin) ? v.resetAfterMin : base.resetAfterMin;
  return {
    position: oneOf(v.position, ["top", "center"] as const, base.position),
    chatHeightShare: Math.min(0.9, Math.max(0.4, share)),
    rememberHeight: bool(v.rememberHeight, base.rememberHeight),
    textSize: oneOf(v.textSize, ["s", "m", "l"] as const, base.textSize),
    sendKey: oneOf(v.sendKey, ["enter", "cmd-enter"] as const, base.sendKey),
    afterSend: oneOf(v.afterSend, ["stay", "hide"] as const, base.afterSend),
    resetAfterMin: reset,
    suggestions: bool(v.suggestions, base.suggestions),
    dictationButton: bool(v.dictationButton, base.dictationButton),
  };
}

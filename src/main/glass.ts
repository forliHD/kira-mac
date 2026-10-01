// Liquid Glass für rahmenlose Fenster: auf macOS 26+ echtes NSGlassEffectView
// über `electron-liquid-glass` (N-API, vorgebaut für arm64/x64), sonst der
// Rückfall auf Vibrancy (NSVisualEffectView). Electron selbst hat keine
// Glas-API (PR electron/electron#50415 wurde nie gemergt).
//
// Regeln (siehe README des Pakets): Fenster `transparent: true`, KEINE
// Vibrancy gleichzeitig (beides übereinander wirkt matschig), Seiten-
// hintergrund transparent. Lädt das Addon nicht (älteres macOS, kaputte
// Binärdatei), bleibt die App benutzbar – nur eben mit Vibrancy.

import { type BrowserWindow, nativeTheme } from "electron";

import { type UiInfo } from "../shared/local-api";
import { scoped } from "./log";

const log = scoped("glass");

interface LiquidGlassModule {
  isGlassSupported(): boolean;
  addView(handle: Buffer, options?: { cornerRadius?: number; tintColor?: string; opaque?: boolean }): number;
}

let addon: LiquidGlassModule | null | undefined;

function loadAddon(): LiquidGlassModule | null {
  if (addon !== undefined) return addon;
  if (process.platform !== "darwin") {
    addon = null;
    return addon;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("electron-liquid-glass") as { default?: LiquidGlassModule } & LiquidGlassModule;
    const glass = (mod.default ?? mod) as LiquidGlassModule;
    addon = typeof glass.addView === "function" && glass.isGlassSupported() ? glass : null;
  } catch (err) {
    log.warn("glass_addon_unavailable", { error: err instanceof Error ? err.message : String(err) });
    addon = null;
  }
  log.info("glass_mode", { mode: addon ? "liquid" : "vibrancy" });
  return addon;
}

/** „Transparenz reduzieren“ in den Bedienungshilfen: dann keine Glaseffekte. */
function reducedTransparency(): boolean {
  try {
    return nativeTheme.prefersReducedTransparency === true;
  } catch {
    return false;
  }
}

export function glassMode(): UiInfo["glass"] {
  return loadAddon() && !reducedTransparency() ? "liquid" : "vibrancy";
}

export function uiInfo(): UiInfo {
  return { glass: glassMode(), macos: process.getSystemVersion(), reducedTransparency: reducedTransparency() };
}

export type GlassFallback = "hud" | "popover" | "under-window" | "sidebar" | "window" | "menu";

export interface GlassOptions {
  cornerRadius: number;
  /** #RRGGBBAA – Tönung des Glases (dunkel für Lesbarkeit). */
  tint?: string;
  /** Vibrancy-Material, wenn kein echtes Glas verfügbar ist. */
  fallback: GlassFallback;
}

/**
 * Glas hinter den Webinhalt legen. Muss NACH dem Erzeugen des Fensters
 * laufen; das Fenster braucht `transparent: true` und keinen Hintergrund.
 * Gibt den gewählten Modus zurück.
 */
export function applyGlass(win: BrowserWindow, options: GlassOptions): UiInfo["glass"] {
  const glass = glassMode() === "liquid" ? loadAddon() : null;
  if (glass) {
    try {
      const tint = options.tint ?? (nativeTheme.shouldUseDarkColors ? "#0b0f1a55" : "#f4f6fa40");
      const id = glass.addView(win.getNativeWindowHandle(), { cornerRadius: options.cornerRadius, tintColor: tint });
      if (id >= 0) return "liquid";
      log.warn("glass_add_view_failed", { id });
    } catch (err) {
      log.warn("glass_add_view_error", { error: err instanceof Error ? err.message : String(err) });
    }
  }
  win.setVibrancy(options.fallback);
  return "vibrancy";
}

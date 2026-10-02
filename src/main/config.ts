// Konfiguration der Hülle: eine JSON-Datei in app.getPath("userData"),
// atomar geschrieben (Temp-Datei + rename), ohne electron-store. Tokens
// stehen NIE hier – die hält session.ts nur im Speicher.

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { app } from "electron";

import { type DictationConfig, type GeneralConfig, type HotkeyConfig, type InstanceConfig } from "../shared/local-api";
import { scoped } from "./log";

const log = scoped("config");

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export interface AppConfig {
  version: 1;
  /** Gerätekennung für `kira-app://<uuid>` – bleibt über Updates stabil. */
  deviceId: string;
  instance: InstanceConfig;
  hotkeys: HotkeyConfig;
  dictation: DictationConfig;
  general: GeneralConfig;
  onboarded: boolean;
  mainWindow: WindowBounds | null;
  /** Zuletzt gesehene Server-Version – entscheidet beim Start über die eingelassene Titelleiste. */
  lastServerVersion: string | null;
}

export const DEFAULT_HOTKEYS: HotkeyConfig = {
  quickWindow: "Alt+Space",
  // ⌃⌥D: ⌥⌘D blendet unter macOS das Dock ein/aus (Systemkürzel) – 0.1.0
  // hatte es als Standard, normalizeConfig zieht es um.
  dictation: "Control+Alt+D",
};

export function defaultConfig(): AppConfig {
  return {
    version: 1,
    deviceId: randomUUID(),
    instance: { internalUrl: null, externalUrl: null, label: "KIRA" },
    hotkeys: { ...DEFAULT_HOTKEYS },
    dictation: { locale: "de-DE", commands: true, dashboardStt: true },
    general: { launchAtLogin: false, notifications: true },
    onboarded: false,
    mainWindow: null,
    lastServerVersion: null,
  };
}

/** ⌥⌘D (Standard in 0.1.0) kollidiert mit „Dock ein-/ausblenden“ – auf ⌃⌥D umziehen. */
export function migrateDictationHotkey(value: string): string {
  return value === "Alt+Command+D" ? DEFAULT_HOTKEYS.dictation : value;
}

/** Macht aus beliebigem JSON eine gültige Konfiguration; Unbekanntes fällt weg. */
export function normalizeConfig(raw: unknown): AppConfig {
  const base = defaultConfig();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
  const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
  const inst = (r.instance && typeof r.instance === "object" ? r.instance : {}) as Record<string, unknown>;
  const hk = (r.hotkeys && typeof r.hotkeys === "object" ? r.hotkeys : {}) as Record<string, unknown>;
  const dict = (r.dictation && typeof r.dictation === "object" ? r.dictation : {}) as Record<string, unknown>;
  const gen = (r.general && typeof r.general === "object" ? r.general : {}) as Record<string, unknown>;
  const mw = r.mainWindow && typeof r.mainWindow === "object" ? (r.mainWindow as Record<string, unknown>) : null;
  const bounds: WindowBounds | null =
    mw && typeof mw.width === "number" && typeof mw.height === "number"
      ? {
          width: mw.width,
          height: mw.height,
          ...(typeof mw.x === "number" ? { x: mw.x } : {}),
          ...(typeof mw.y === "number" ? { y: mw.y } : {}),
        }
      : null;
  return {
    version: 1,
    deviceId: /^[0-9a-f-]{36}$/i.test(str(r.deviceId, "")) ? str(r.deviceId, "") : base.deviceId,
    instance: {
      internalUrl: strOrNull(inst.internalUrl),
      externalUrl: strOrNull(inst.externalUrl),
      label: str(inst.label, base.instance.label) || base.instance.label,
    },
    hotkeys: {
      quickWindow: str(hk.quickWindow, base.hotkeys.quickWindow),
      dictation: migrateDictationHotkey(str(hk.dictation, base.hotkeys.dictation)),
    },
    dictation: {
      locale: str(dict.locale, base.dictation.locale) || base.dictation.locale,
      commands: bool(dict.commands, base.dictation.commands),
      dashboardStt: bool(dict.dashboardStt, base.dictation.dashboardStt),
    },
    general: {
      launchAtLogin: bool(gen.launchAtLogin, base.general.launchAtLogin),
      notifications: bool(gen.notifications, base.general.notifications),
    },
    onboarded: bool(r.onboarded, false),
    mainWindow: bounds,
    lastServerVersion: strOrNull(r.lastServerVersion),
  };
}

type Listener = (config: AppConfig) => void;

class ConfigStore {
  private config: AppConfig | null = null;
  private listeners = new Set<Listener>();

  get path(): string {
    return join(app.getPath("userData"), "config.json");
  }

  load(): AppConfig {
    if (this.config) return this.config;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(readFileSync(this.path, "utf8"));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") log.warn("config_read_failed", { error: err instanceof Error ? err.message : String(err) });
    }
    this.config = normalizeConfig(parsed);
    if (!parsed) this.write(this.config); // deviceId sofort festhalten
    return this.config;
  }

  get(): AppConfig {
    return this.config ?? this.load();
  }

  update(patch: Partial<AppConfig> | ((current: AppConfig) => Partial<AppConfig>)): AppConfig {
    const current = this.get();
    const delta = typeof patch === "function" ? patch(current) : patch;
    const next = normalizeConfig({ ...current, ...delta });
    this.config = next;
    this.write(next);
    for (const l of this.listeners) {
      try {
        l(next);
      } catch (err) {
        log.warn("config_listener_failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }
    return next;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private write(config: AppConfig): void {
    const path = this.path;
    try {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      renameSync(tmp, path);
    } catch (err) {
      log.error("config_write_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

export const configStore = new ConfigStore();

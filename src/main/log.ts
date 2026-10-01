// Protokoll des Hauptprozesses (electron-log). Regel: nie Tokens, nie
// Nachrichtentexte, nie Diktat-Text. Meta-Objekte werden vor dem Schreiben
// um verdächtige Schlüssel bereinigt – als zweite Sicherung, nicht als Freibrief.

import log from "electron-log/main";

import { type Logger } from "../shared/logger";

// Teilstrings für Geheimnisse (accessToken, refreshToken, Cookie …) und exakte
// Schlüssel für Inhalte (text, body, partial, message, vocabulary) – ein
// Feature-Flag wie `insertText` bleibt lesbar.
const SECRET_KEYS = /token|secret|password|authorization|cookie|^(text|body|partial|message|vocabulary|prompt)$/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[…]";
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[verborgen]" : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

let initialized = false;

export function initLog(): void {
  if (initialized) return;
  initialized = true;
  log.initialize();
  log.transports.file.level = "info";
  log.transports.file.maxSize = 2 * 1024 * 1024;
  log.transports.console.level = process.env.NODE_ENV === "development" || process.env.ELECTRON_RENDERER_URL ? "debug" : "warn";
  log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {scope} {text}";
  log.errorHandler.startCatching({ showDialog: false });
}

/** Pfad der Protokolldatei (Einstellungen → „Protokolle anzeigen“). */
export function logFilePath(): string {
  return log.transports.file.getFile().path;
}

export function scoped(scope: string): Logger {
  const s = log.scope(scope);
  const wrap =
    (fn: (...args: unknown[]) => void) =>
    (message: string, ...meta: unknown[]): void => {
      fn(message, ...meta.map((m) => scrub(m)));
    };
  return {
    debug: wrap(s.debug.bind(s)),
    info: wrap(s.info.bind(s)),
    warn: wrap(s.warn.bind(s)),
    error: wrap(s.error.bind(s)),
  };
}

export { scrub };

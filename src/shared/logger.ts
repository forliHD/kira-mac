// Kleine Protokoll-Schnittstelle, damit die testbaren Module (sse, helper,
// dictation, instance) kein electron-log importieren müssen. Der Hauptprozess
// reicht einen Scope aus src/main/log.ts hinein; Tests übergeben nichts.

export interface Logger {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

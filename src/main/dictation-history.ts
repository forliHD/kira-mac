// Diktat-Verlauf: Jedes globale Diktat landet hier, auch wenn das Einsetzen
// im fremden Programm scheitert oder dort etwas anderes ankommt
// (Owner-Wunsch 02.10.2026: „dass der Text nicht verloren geht“).
//
// Nur auf diesem Mac: Die Datei ist mit `safeStorage` verschlüsselt (Schlüssel
// im macOS-Schlüsselbund). Gibt es keine Verschlüsselung, bleibt der Verlauf
// nur im Arbeitsspeicher – nie Klartext auf der Platte. Nichts davon geht an
// den Server, nichts ins Protokoll.
// Kein Electron-Import: Verschlüsselung und Dateizugriff werden injiziert
// (tests/dictation-history.test.ts).

import { randomUUID } from "node:crypto";

import { type DictationEntry } from "../shared/local-api";

export type { DictationEntry };

export const HISTORY_MAX_ENTRIES = 100;
export const HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface HistoryCodec {
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export interface HistoryFs {
  read(): Buffer | null;
  write(data: Buffer): void;
  remove(): void;
}

export interface HistoryOptions {
  /** null = keine Verschlüsselung verfügbar → nur im Arbeitsspeicher. */
  codec: HistoryCodec | null;
  fs: HistoryFs;
  now?: () => number;
  onWarn?: (event: string, data?: Record<string, unknown>) => void;
}

function isEntry(v: unknown): v is DictationEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.at === "number" &&
    (e.app === null || typeof e.app === "string") &&
    (e.target === "insert" || e.target === "quick") &&
    typeof e.text === "string" &&
    typeof e.failed === "boolean"
  );
}

export class DictationHistory {
  private entries: DictationEntry[] = [];
  private readonly opts: HistoryOptions;

  constructor(opts: HistoryOptions) {
    this.opts = opts;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /** Wird der Verlauf auf der Platte gehalten (verschlüsselt)? */
  get persistent(): boolean {
    return this.opts.codec !== null;
  }

  load(): void {
    if (!this.opts.codec) return;
    let raw: Buffer | null;
    try {
      raw = this.opts.fs.read();
    } catch (err) {
      this.opts.onWarn?.("dictation_history_read_failed", { error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!raw || raw.length === 0) return;
    try {
      const parsed: unknown = JSON.parse(this.opts.codec.decrypt(raw));
      this.entries = Array.isArray(parsed) ? parsed.filter(isEntry) : [];
      this.prune();
    } catch (err) {
      // Anderer Schlüssel (neues Benutzerkonto, zurückgesetzter Schlüsselbund):
      // lieber leer anfangen als hängen.
      this.opts.onWarn?.("dictation_history_unreadable", { error: err instanceof Error ? err.message : String(err) });
      this.entries = [];
    }
  }

  /** Neueste zuerst. */
  list(): DictationEntry[] {
    this.prune();
    return [...this.entries];
  }

  latest(): DictationEntry | null {
    this.prune();
    return this.entries[0] ?? null;
  }

  get(id: string): DictationEntry | null {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  add(entry: Omit<DictationEntry, "id">): DictationEntry | null {
    const text = entry.text.trim();
    if (!text) return null;
    const full: DictationEntry = { ...entry, text, id: randomUUID() };
    this.entries = [full, ...this.entries];
    this.prune();
    this.save();
    return full;
  }

  remove(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length === before) return false;
    this.save();
    return true;
  }

  clear(): void {
    this.entries = [];
    try {
      this.opts.fs.remove();
    } catch (err) {
      this.opts.onWarn?.("dictation_history_remove_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private prune(): void {
    const cutoff = this.now() - HISTORY_MAX_AGE_MS;
    const kept = this.entries.filter((e) => e.at >= cutoff).slice(0, HISTORY_MAX_ENTRIES);
    if (kept.length !== this.entries.length) {
      this.entries = kept;
      this.save();
    }
  }

  private save(): void {
    const codec = this.opts.codec;
    if (!codec) return;
    try {
      if (this.entries.length === 0) this.opts.fs.remove();
      else this.opts.fs.write(codec.encrypt(JSON.stringify(this.entries)));
    } catch (err) {
      this.opts.onWarn?.("dictation_history_write_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

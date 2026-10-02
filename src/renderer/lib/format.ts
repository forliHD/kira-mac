// Texte der lokalen Seiten aus dem Zustand des Hauptprozesses: Prüfergebnis
// einer Adresse, Update-Stand, Offline-Grund, Sprachnamen. Reine Funktionen
// (kein DOM, kein React) – tests/ui-format.test.ts.

import { MIN_SERVER_VERSION_WITH_BRIDGE } from "../../shared/bridge";
import { type PermissionState } from "../../shared/helper-types";
import { type ProbeResult, type UpdateState } from "../../shared/local-api";

export type Tone = "ok" | "warn" | "err" | "info" | "idle";

export { MIN_SERVER_VERSION_WITH_BRIDGE };

/** Host einer Adresse („kira.example.de“, „192.168.178.166:8420“) oder null. */
export function hostOf(url: string | null | undefined): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).host || null;
  } catch {
    return null;
  }
}

const displayNames = new Map<string, Intl.DisplayNames | null>();

/** „de-DE“ → „Deutsch (Deutschland)“; unbekannte Codes bleiben stehen. */
export function localeName(code: string, uiLocale = "de"): string {
  let names = displayNames.get(uiLocale);
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames([uiLocale], { type: "language" });
    } catch {
      names = null;
    }
    displayNames.set(uiLocale, names);
  }
  try {
    const name = names?.of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

/** Sprachliste für die Auswahl: eindeutig, die aktuelle immer dabei, nach Namen sortiert. */
export function sortLocales(codes: readonly string[], current: string): string[] {
  const unique = [...new Set([current, ...codes].filter(Boolean))];
  const collator = new Intl.Collator("de");
  return unique.sort((a, b) => collator.compare(localeName(a), localeName(b)));
}

export interface ProbeView {
  tone: "ok" | "warn" | "err";
  /** Kurz, rechts im Feld. */
  badge: string;
  /** Zeile unter dem Feld. */
  detail: string;
}

/** Was ein Prüfergebnis für Menschen bedeutet. */
export function probeView(result: ProbeResult): ProbeView {
  if (!result.ok) {
    const invalid = /keine gültige/i.test(result.error ?? "");
    return { tone: "err", badge: invalid ? "Ungültig" : "Nicht erreichbar", detail: result.error ?? "Nicht erreichbar." };
  }
  if (!result.version) {
    // 302/401/403 von Cloudflare Access: erreichbar, die Anmeldung fehlt noch.
    return { tone: "ok", badge: "Erreichbar", detail: "Erreichbar · Die Anmeldung (z. B. Cloudflare Access) läuft danach in deinem Browser." };
  }
  if (!result.bridge) {
    return {
      tone: "warn",
      badge: "Erreichbar",
      detail: `KIRA ${result.version} · Ältere Version: Mitteilungen der App brauchen KIRA ${MIN_SERVER_VERSION_WITH_BRIDGE} oder neuer. Dashboard und Diktat funktionieren.`,
    };
  }
  return { tone: "ok", badge: "Erreichbar", detail: `KIRA ${result.version} · Benachrichtigungen und Diktat werden unterstützt` };
}

/** Kurzer Update-Stand für die Seitenleiste. */
export function updateShort(u: UpdateState): { text: string; tone: Tone } {
  switch (u.status) {
    case "checking":
      return { text: "Sucht nach Updates…", tone: "idle" };
    case "available":
      return { text: u.version ? `Update ${u.version} verfügbar` : "Update verfügbar", tone: "info" };
    case "downloading":
      return {
        text: `${u.version ? `Update ${u.version}` : "Update"} wird geladen${u.progress !== null ? ` · ${u.progress} %` : ""}`,
        tone: "info",
      };
    case "downloaded":
      return { text: u.version ? `Update ${u.version} bereit` : "Update bereit", tone: "info" };
    case "none":
      return { text: "Auf dem neuesten Stand", tone: "ok" };
    case "error":
      return { text: "Update-Prüfung fehlgeschlagen", tone: "warn" };
    case "unsupported":
      return { text: "Updates nur in der installierten App", tone: "idle" };
    default:
      return { text: "Updates werden automatisch geprüft", tone: "idle" };
  }
}

/** Ausführlicher Update-Stand (Bereich „Über“). Der Hauptprozess liefert meist schon einen Satz. */
export function updateLong(u: UpdateState): string {
  if (u.message) {
    return u.status === "downloading" && u.progress !== null && !u.message.includes("%") ? `${u.message} (${u.progress} %)` : u.message;
  }
  if (u.status === "idle") return "KIRA sucht regelmäßig nach Updates und installiert sie beim Beenden.";
  return updateShort(u).text;
}

// ── Offline-Grund ─────────────────────────────────────────────────────

const CHROMIUM_ERRORS: Array<[RegExp, string]> = [
  [/ERR_INTERNET_DISCONNECTED/, "Keine Netzwerkverbindung."],
  [/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/, "Hostname konnte nicht aufgelöst werden."],
  [/ERR_CONNECTION_REFUSED/, "Verbindung abgelehnt (läuft KIRA auf diesem Port?)."],
  [/ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT/, "Zeitüberschreitung."],
  [/ERR_ADDRESS_UNREACHABLE/, "Rechner nicht erreichbar (anderes Netz, VPN aus?)."],
  [/ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/, "Die Verbindung wurde abgebrochen."],
  [/ERR_NETWORK_CHANGED/, "Das Netzwerk hat gewechselt."],
  [/ERR_CERT_[A-Z_]+|ERR_SSL_[A-Z_]+/, "TLS-Zertifikat wird nicht akzeptiert."],
];

/**
 * Chromium-Fehlercode am Satzende („… ERR_NAME_NOT_RESOLVED“, so meldet
 * `did-fail-load` des Hauptfensters) → deutsche Ursache. Sätze bleiben, wie sie sind.
 */
export function humanizeError(text: string): string {
  const trimmed = text.trim();
  const m = /^(.*?)(?:net::)?(ERR_[A-Z_]+)\.?$/.exec(trimmed);
  if (!m) return trimmed;
  const code = m[2] ?? "";
  for (const [pattern, german] of CHROMIUM_ERRORS) {
    if (pattern.test(code)) return `${m[1] ?? ""}${german}`;
  }
  return trimmed;
}

export interface OfflineReasonItem {
  kind: "internal" | "external";
  origin: string;
  host: string;
  error: string;
}

export interface OfflineReason {
  /** Ein Satz, wenn sich der Grund nicht in Adressen zerlegen ließ. */
  summary: string | null;
  /** Je geprüfter Adresse: Art, Host, Ursache (aus `describeResolveFailure`). */
  items: OfflineReasonItem[];
}

const PREFIX = /^Instanz nicht erreichbar:\s*/i;

/**
 * Zerlegt den Grund aus dem Hauptprozess („Instanz nicht erreichbar: intern
 * http://…: Ursache; extern https://…: Ursache“) in Zeilen. Unbekannte Formen
 * bleiben ein Satz.
 */
export function parseOfflineReason(reason: string | null | undefined): OfflineReason {
  const raw = (reason ?? "").trim();
  if (!raw) return { summary: "Instanz nicht erreichbar.", items: [] };
  const body = raw.replace(PREFIX, "");
  const parts = body.split(/;\s+/).filter(Boolean);
  const items: OfflineReasonItem[] = [];
  for (const part of parts) {
    const m = /^(intern|extern)\s+(\S+?):\s+(.+)$/.exec(part.trim());
    if (!m) return { summary: humanizeError(raw), items: [] };
    const origin = m[2] ?? "";
    items.push({
      kind: m[1] === "intern" ? "internal" : "external",
      origin,
      host: hostOf(origin) ?? origin,
      error: humanizeError(m[3] ?? ""),
    });
  }
  return items.length ? { summary: null, items } : { summary: humanizeError(raw), items: [] };
}

/** „Letzter Kontakt“ aus `?lastSeen=` (Millisekunden oder ISO-Datum). */
export function parseTimestamp(value: string | null | undefined): Date | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const date = /^\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** „09:50“, an einem anderen Tag „gestern, 09:50“ bzw. „28.09., 09:50“. */
export function formatLastSeen(date: Date, now: Date = new Date()): string {
  const time = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const day = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((day(now) - day(date)) / 86_400_000);
  if (diffDays === 0) return `um ${time}`;
  if (diffDays === 1) return `gestern um ${time}`;
  return `am ${date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} um ${time}`;
}

// ── Berechtigungen ────────────────────────────────────────────────────

export function permissionView(value: PermissionState | boolean | undefined): { text: string; tone: Tone; granted: boolean } {
  if (value === true || value === "granted") return { text: "Erlaubt", tone: "ok", granted: true };
  if (value === "notRequired") return { text: "Nicht nötig", tone: "ok", granted: true };
  if (value === "denied") return { text: "Abgelehnt", tone: "err", granted: false };
  if (value === false) return { text: "Nicht erlaubt", tone: "warn", granted: false };
  if (value === "notDetermined") return { text: "Noch nicht gefragt", tone: "warn", granted: false };
  return { text: "Unbekannt", tone: "idle", granted: false };
}

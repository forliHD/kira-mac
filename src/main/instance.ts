// Instanz-Politik: interne (LAN) und externe (Cloudflare Access) URL wie bei
// Home Assistant. Reine Funktionen ohne Electron – der Hauptprozess reicht
// seine `fetch`-Implementierung (session.ts) hinein. tests/instance.test.ts.

import { MIN_SERVER_VERSION_WITH_BRIDGE } from "../shared/bridge";

export type InstanceKind = "internal" | "external";

export interface InstanceCandidate {
  kind: InstanceKind;
  origin: string;
}

export interface HealthProbe {
  ok: boolean;
  status: number | null;
  version: string | null;
  error: string | null;
  latencyMs: number;
}

export interface ResolvedInstance {
  kind: InstanceKind;
  origin: string;
  version: string | null;
  serverHasBridge: boolean;
  latencyMs: number;
}

export interface ResolveResult {
  resolved: ResolvedInstance | null;
  probes: Array<InstanceCandidate & HealthProbe>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Standard-Zeitlimit je Probe: im LAN antwortet KIRA in Millisekunden. */
export const PROBE_TIMEOUT_MS = 4_000;

/**
 * Normalisiert eine Nutzereingabe zu einer Origin (`https://kira.example`).
 * Ohne Schema wird `https://` angenommen – außer bei privaten IPv4-Adressen,
 * `localhost` und `.local`/`.lan`-Namen, wo KIRA im LAN typischerweise über
 * nginx ohne TLS läuft (kira-dev: http://192.168.178.166/). Pfad, Query und
 * Fragment fallen weg: die Instanz ist eine Origin, nicht eine Seite.
 * Gibt `null` zurück, wenn daraus keine http(s)-Origin wird.
 */
export function normalizeInstanceUrl(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  let candidate = raw;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    const hostPart = candidate.split("/")[0] ?? "";
    candidate = `${looksLikeLan(hostPart) ? "http" : "https"}://${candidate}`;
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  if (url.username || url.password) return null;
  return url.origin.toLowerCase();
}

function looksLikeLan(hostPart: string): boolean {
  const host = hostPart.replace(/:\d+$/, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home")) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true;
  return false;
}

/** Zwei URLs/Origins gehören zur selben Origin (Schema, Host, Port). */
export function sameOrigin(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  try {
    return new URL(a).origin.toLowerCase() === new URL(b).origin.toLowerCase();
  } catch {
    return false;
  }
}

/** Die Origin einer beliebigen URL oder `null` (für `blob:`, `about:` usw.). */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Gehört `url` zu einer der konfigurierten Instanz-Origins (intern oder extern)? */
export function isInstanceUrl(url: string | null | undefined, origins: readonly string[]): boolean {
  const origin = originOf(url);
  if (!origin) return false;
  return origins.some((o) => o.toLowerCase() === origin);
}

/** Konfigurierte Kandidaten in Vorzugsreihenfolge: intern vor extern. */
export function instanceCandidates(config: {
  internalUrl: string | null;
  externalUrl: string | null;
}): InstanceCandidate[] {
  const out: InstanceCandidate[] = [];
  const internal = normalizeInstanceUrl(config.internalUrl);
  const external = normalizeInstanceUrl(config.externalUrl);
  if (internal) out.push({ kind: "internal", origin: internal });
  if (external && external !== internal) out.push({ kind: "external", origin: external });
  return out;
}

/** Alle erlaubten Origins (für Preload-Injektion und Fensterpolitik). */
export function instanceOrigins(config: { internalUrl: string | null; externalUrl: string | null }): string[] {
  return instanceCandidates(config).map((c) => c.origin);
}

/** Vergleicht zwei Versionen `a.b.c` (nur Ziffern-Teile). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Hat der Server die Brücke (Benachrichtigungs-Stream, Geräte) – ab 3.297.0? */
export function serverHasBridge(version: string | null | undefined): boolean {
  if (!version) return false;
  const m = /^(\d+\.\d+\.\d+)/.exec(version.trim());
  if (!m) return false;
  return compareVersions(m[1] ?? "0", MIN_SERVER_VERSION_WITH_BRIDGE) >= 0;
}

/** Ab KIRA 3.298.0 kennt das Dashboard die eingelassene Titelleiste (`inset-titlebar`). */
export const MIN_SERVER_VERSION_WITH_INSET_TITLEBAR = "3.298.0";

export function serverSupportsInsetTitlebar(version: string | null | undefined): boolean {
  if (!version) return false;
  const m = /^(\d+\.\d+\.\d+)/.exec(version.trim());
  if (!m) return false;
  return compareVersions(m[1] ?? "0", MIN_SERVER_VERSION_WITH_INSET_TITLEBAR) >= 0;
}

/**
 * Ruft `GET /api/health` einer Origin ab. Fehler werden nie geworfen, sondern
 * als deutsche Ursache im Ergebnis geliefert („Instanz nicht erreichbar: …“).
 */
export async function probeHealth(
  origin: string,
  fetchImpl: FetchLike,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<HealthProbe> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${origin}/api/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    const latencyMs = Date.now() - started;
    let version: string | null = null;
    try {
      const body: unknown = await res.json();
      if (body && typeof body === "object" && typeof (body as { version?: unknown }).version === "string") {
        version = (body as { version: string }).version;
      }
    } catch {
      /* kein JSON – Status reicht */
    }
    if (res.status === 200) return { ok: true, status: 200, version, error: null, latencyMs };
    if (res.status === 503) {
      return { ok: false, status: 503, version, error: "Instanz meldet sich als nicht bereit (Datenbank fehlt).", latencyMs };
    }
    if (res.status === 302 || res.status === 401 || res.status === 403) {
      // Cloudflare Access leitet unangemeldete Anfragen zur Anmeldung um; die
      // Instanz ist erreichbar, nur die Anmeldung fehlt noch – das regelt die WebView.
      return { ok: true, status: res.status, version, error: null, latencyMs };
    }
    return { ok: false, status: res.status, version, error: `Instanz antwortet mit HTTP ${res.status}.`, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - started;
    if (controller.signal.aborted) {
      return { ok: false, status: null, version: null, error: `Keine Antwort innerhalb von ${Math.round(timeoutMs / 1000)} s.`, latencyMs };
    }
    return { ok: false, status: null, version: null, error: describeNetworkError(err), latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

/** Macht aus einem Netzwerkfehler eine kurze deutsche Ursache. */
export function describeNetworkError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const msg = raw.toLowerCase();
  if (msg.includes("enotfound") || msg.includes("name_not_resolved")) return "Hostname konnte nicht aufgelöst werden.";
  if (msg.includes("econnrefused") || msg.includes("connection_refused")) return "Verbindung abgelehnt (läuft KIRA auf diesem Port?).";
  if (msg.includes("ehostunreach") || msg.includes("enetunreach") || msg.includes("address_unreachable"))
    return "Rechner nicht erreichbar (anderes Netz, VPN aus?).";
  if (msg.includes("cert") || msg.includes("ssl") || msg.includes("tls")) return "TLS-Zertifikat wird nicht akzeptiert.";
  if (msg.includes("timed out") || msg.includes("etimedout") || msg.includes("timeout")) return "Zeitüberschreitung.";
  if (msg.includes("abort")) return "Abgebrochen.";
  const cleaned = (err instanceof Error ? err.message : String(err)).replace(/^TypeError:\s*/i, "").trim();
  return cleaned ? cleaned : "Unbekannter Netzwerkfehler.";
}

/**
 * Wählt die Instanz: alle Kandidaten werden parallel geprüft (schnell), die
 * Wahl folgt der Vorzugsreihenfolge – intern gewinnt, wenn sie antwortet.
 */
export async function resolveInstance(
  candidates: InstanceCandidate[],
  fetchImpl: FetchLike,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ResolveResult> {
  const probes = await Promise.all(
    candidates.map(async (c) => ({ ...c, ...(await probeHealth(c.origin, fetchImpl, timeoutMs)) })),
  );
  const winner = probes.find((p) => p.ok);
  if (!winner) return { resolved: null, probes };
  return {
    resolved: {
      kind: winner.kind,
      origin: winner.origin,
      version: winner.version,
      serverHasBridge: serverHasBridge(winner.version),
      latencyMs: winner.latencyMs,
    },
    probes,
  };
}

/** Eine Zeile für Menschen, warum keine Instanz erreichbar war. */
export function describeResolveFailure(result: ResolveResult): string {
  if (result.probes.length === 0) return "Keine Instanz-URL konfiguriert.";
  const parts = result.probes.map((p) => `${p.kind === "internal" ? "intern" : "extern"} ${p.origin}: ${p.error ?? "nicht erreichbar"}`);
  return `Instanz nicht erreichbar: ${parts.join("; ")}`;
}

// Einstellungen → Über: Version und Updates, Server und Verbindung, dieser
// Mac (Chip, macOS, Glasart, Helfer), Protokolle.

import { type ReactNode, useState } from "react";

import { MIN_SERVER_VERSION_WITH_BRIDGE, hostOf, parseOfflineReason, updateLong, updateShort } from "../lib/format";
import { IconFolder, IconRefresh } from "../lib/icons";
import { errorText, localApi } from "../lib/useLocalState";
import { AppTile, Button, GlassCard, InfoNote, SettingRow, StatusDot } from "../lib/ui";
import { type SectionProps } from "./shared";

function Item({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="about-item">
      <dt>{label}</dt>
      <dd className="g-selectable">{children}</dd>
    </div>
  );
}

export function AboutSection({ state }: SectionProps): ReactNode {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const u = state.update;
  const short = updateShort(u);
  const c = state.connection;
  const info = state.helper.info;
  const busy = checking || u.status === "checking";
  const downloading = u.status === "downloading";

  async function check(): Promise<void> {
    setChecking(true);
    setError(null);
    try {
      await localApi().checkForUpdates();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  }

  async function installNow(): Promise<void> {
    setError(null);
    try {
      await localApi().installUpdate();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function openLogs(): Promise<void> {
    setError(null);
    try {
      await localApi().openLogs();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const offlineReason = !c.online && c.lastError ? parseOfflineReason(c.lastError) : null;

  return (
    <>
      <GlassCard className="flex items-center gap-4 px-4 py-4">
        <AppTile size={52} />
        <div className="flex min-w-0 flex-auto flex-col gap-[3px]">
          <span className="text-[15px] font-semibold text-(--g-text)">KIRA für Mac</span>
          <span className="text-[12.5px] text-(--g-text-2)">Version {state.appVersion}</span>
          <span className="flex items-center gap-[6px] text-[12px] text-(--g-text-3)" role="status">
            <StatusDot tone={short.tone} />
            {updateLong(u)}
          </span>
          {u.status === "downloading" && u.progress !== null ? (
            <div
              className="g-progress mt-1 max-w-[280px]"
              role="progressbar"
              aria-label="Update wird geladen"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={u.progress}
            >
              <span style={{ width: `${Math.max(0, Math.min(100, u.progress))}%` }} />
            </div>
          ) : null}
        </div>
        {u.status === "downloaded" ? (
          <Button variant="primary" icon={<IconRefresh size={14} strokeWidth={2.3} />} onClick={() => void installNow()}>
            Jetzt neu starten
          </Button>
        ) : (
          <Button icon={<IconRefresh size={14} strokeWidth={2.3} />} busy={busy} disabled={busy || downloading || u.status === "unsupported"} onClick={() => void check()}>
            Nach Updates suchen
          </Button>
        )}
      </GlassCard>

      <GlassCard>
        <dl className="about-list">
          <Item label="Server">
            {c.online ? `${hostOf(c.origin) ?? "KIRA"}${c.serverVersion ? ` · KIRA ${c.serverVersion}` : ""}` : "Nicht verbunden"}
          </Item>
          <Item label="Verbindung">
            {c.online
              ? `${c.kind === "internal" ? "Heimnetz" : "Extern"} · ${c.origin ?? ""}`
              : offlineReason?.items.length
                ? offlineReason.items.map((i) => `${i.kind === "internal" ? "Heimnetz" : "Extern"}: ${i.error}`).join(" · ")
                : (offlineReason?.summary ?? "Noch keine Verbindung.")}
          </Item>
          <Item label="Mitteilungen">
            {c.online
              ? c.serverHasBridge
                ? state.general.notifications
                  ? "Aktiv – über den Geräte-Stream des Servers"
                  : "Ausgeschaltet (Allgemein)"
                : `Brauchen KIRA ${MIN_SERVER_VERSION_WITH_BRIDGE} oder neuer`
              : "Ohne Verbindung keine Mitteilungen"}
          </Item>
          <Item label="Dieser Mac">{[info?.chip, state.ui.macos ? `macOS ${state.ui.macos}` : null].filter(Boolean).join(" · ") || "–"}</Item>
          <Item label="Darstellung">
            {state.ui.glass === "liquid" ? "Liquid Glass" : "Vibrancy"}
            {state.ui.reducedTransparency ? " · Transparenz reduziert" : ""}
          </Item>
          <Item label="Helfer">
            {state.helper.running && info
              ? `Version ${info.version} · Apple-Sprachmodell ${info.features.llm ? "verfügbar" : "nicht verfügbar"} · Systemton ${info.features.systemAudio ? "verfügbar" : "nicht verfügbar"}`
              : (state.helper.lastError ?? "Läuft nicht.")}
          </Item>
        </dl>
      </GlassCard>

      <GlassCard>
        <SettingRow
          title="Protokolle"
          description={
            <>
              Für die Fehlersuche. Sie enthalten keine Chats, Tokens oder Diktat-Texte.
              <span className="g-mono g-selectable mt-[2px] block truncate text-[11.5px]" title={state.logPath}>
                {state.logPath}
              </span>
            </>
          }
        >
          <Button icon={<IconFolder size={15} />} onClick={() => void openLogs()}>
            Im Finder zeigen
          </Button>
        </SettingRow>
      </GlassCard>

      {error ? (
        <InfoNote tone="err" role="alert">
          {error}
        </InfoNote>
      ) : null}
    </>
  );
}

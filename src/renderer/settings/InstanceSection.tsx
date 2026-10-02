// Einstellungen → Instanz: Verbindungsstatus, beide Adressen mit
// Live-Prüfung, Speichern (der Hauptprozess verbindet danach neu).

import { type ReactNode, useEffect, useRef, useState } from "react";

import { type LocalState } from "../../shared/local-api";
import { MIN_SERVER_VERSION_WITH_BRIDGE, hostOf, parseOfflineReason } from "../lib/format";
import { InstanceField, valueToSave } from "../lib/instance-field";
import { IconCheck, IconCloudOff, IconRefresh, IconServer } from "../lib/icons";
import { useProbe } from "../lib/useProbe";
import { errorText, localApi } from "../lib/useLocalState";
import { Button, GlassCard, InfoNote, StatusCard, type Tone } from "../lib/ui";
import { type SectionProps } from "./shared";

function ConnectionCard({ state, onRetry, busy }: { state: LocalState; onRetry: () => void; busy: boolean }): ReactNode {
  const c = state.connection;
  const action = (
    <Button icon={<IconRefresh size={14} strokeWidth={2.3} />} busy={busy} disabled={busy} onClick={onRetry}>
      {c.online ? "Neu verbinden" : "Erneut versuchen"}
    </Button>
  );
  if (c.online) {
    const where = c.kind === "internal" ? "Heimnetz" : c.kind === "external" ? "Extern" : null;
    const notify = c.serverHasBridge
      ? state.general.notifications
        ? "Mitteilungen aktiv"
        : "Mitteilungen ausgeschaltet"
      : `Mitteilungen ab KIRA ${MIN_SERVER_VERSION_WITH_BRIDGE}`;
    return (
      <StatusCard
        live
        tone="ok"
        icon={<IconCheck size={22} strokeWidth={2.4} />}
        title={`Verbunden mit ${hostOf(c.origin) ?? "KIRA"}`}
        detail={[where, c.serverVersion ? `KIRA ${c.serverVersion}` : null, notify].filter(Boolean).join(" · ")}
        action={action}
      />
    );
  }
  if (c.lastError) {
    const reason = parseOfflineReason(c.lastError);
    return (
      <StatusCard
        live
        tone="warn"
        icon={<IconCloudOff size={22} />}
        title="Nicht verbunden"
        detail={
          reason.items.length ? (
            <span className="flex flex-col">
              {reason.items.map((i) => (
                <span key={`${i.kind}-${i.origin}`}>
                  {i.kind === "internal" ? "Heimnetz" : "Extern"} · {i.host}: {i.error}
                </span>
              ))}
            </span>
          ) : (
            reason.summary
          )
        }
        action={action}
      />
    );
  }
  return <StatusCard live tone="idle" icon={<IconServer size={20} />} title="Noch nicht verbunden" detail="KIRA verbindet sich, sobald eine Adresse gespeichert ist." action={action} />;
}

export function InstanceSection({ state, setState, refresh }: SectionProps): ReactNode {
  const savedExternal = state.instance.externalUrl ?? "";
  const savedInternal = state.instance.internalUrl ?? "";
  const [externalUrl, setExternalUrl] = useState(savedExternal);
  const [internalUrl, setInternalUrl] = useState(savedInternal);
  const [fast, setFast] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);
  const edited = useRef(false);

  // Gespeicherte Adressen sofort prüfen, beim Tippen entprellt.
  const external = useProbe(externalUrl, fast ? 0 : 500);
  const internal = useProbe(internalUrl, fast ? 0 : 500);
  useEffect(() => {
    if (fast) setFast(false);
  }, [fast]);

  // Von außen geänderte Adressen übernehmen, solange hier nichts bearbeitet ist.
  useEffect(() => {
    if (edited.current) return;
    setExternalUrl(savedExternal);
    setInternalUrl(savedInternal);
  }, [savedExternal, savedInternal]);

  const dirty = externalUrl.trim() !== savedExternal.trim() || internalUrl.trim() !== savedInternal.trim();
  const empty = !externalUrl.trim() && !internalUrl.trim();
  const invalid = [external, internal].some((p) => p.status === "error" && /keine gültige/i.test(p.result?.error ?? ""));
  const noneReachable = !empty && external.status !== "ok" && internal.status !== "ok" && external.status !== "checking" && internal.status !== "checking";
  const canSave = dirty && !empty && !invalid && !saving;

  function edit(setter: (v: string) => void): (v: string) => void {
    return (v) => {
      edited.current = true;
      setMessage(null);
      setter(v);
    };
  }

  async function save(): Promise<void> {
    setSaving(true);
    setMessage(null);
    try {
      const next = await localApi().saveInstance({ internalUrl: valueToSave(internalUrl, internal), externalUrl: valueToSave(externalUrl, external) });
      edited.current = false;
      setState(next);
      setMessage({ tone: "ok", text: next.connection.online ? "Gespeichert. KIRA ist neu verbunden." : "Gespeichert. KIRA versucht, sich zu verbinden." });
    } catch (err) {
      setMessage({ tone: "err", text: errorText(err) });
    } finally {
      setSaving(false);
    }
  }

  function discard(): void {
    edited.current = false;
    setExternalUrl(savedExternal);
    setInternalUrl(savedInternal);
    setMessage(null);
  }

  async function retry(): Promise<void> {
    setRetrying(true);
    try {
      await localApi().retry();
      await refresh();
    } catch (err) {
      setMessage({ tone: "err", text: errorText(err) });
    } finally {
      setRetrying(false);
    }
  }

  return (
    <>
      <ConnectionCard state={state} onRetry={() => void retry()} busy={retrying} />

      <GlassCard className="flex flex-col gap-4 px-[18px] pt-4 pb-[14px]">
        <InstanceField kind="external" value={externalUrl} onChange={edit(setExternalUrl)} probe={external} onEnter={() => canSave && void save()} />
        <InstanceField kind="internal" value={internalUrl} onChange={edit(setInternalUrl)} probe={internal} onEnter={() => canSave && void save()} />
        <div className="flex items-center justify-end gap-2 border-t border-(--g-divider) pt-[14px]">
          <span className="mr-auto text-[12px] text-(--g-text-3)">
            {dirty && noneReachable ? "Gerade antwortet keine der Adressen – speichern geht trotzdem." : "Eine Adresse reicht. Mit beiden wählt KIRA selbst."}
          </span>
          {dirty ? (
            <Button variant="ghost" disabled={saving} onClick={discard}>
              Verwerfen
            </Button>
          ) : null}
          <Button variant="primary" busy={saving} softDisabled={!canSave} onClick={() => void save()}>
            Speichern
          </Button>
        </div>
      </GlassCard>

      {message ? (
        <InfoNote tone={message.tone} role={message.tone === "err" ? "alert" : "status"}>
          {message.text}
        </InfoNote>
      ) : null}
    </>
  );
}

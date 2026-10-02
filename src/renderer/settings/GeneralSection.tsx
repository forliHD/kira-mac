// Einstellungen → Allgemein: Beim Anmelden starten, Mitteilungen.

import { type ReactNode, useState } from "react";

import { type GeneralConfig } from "../../shared/local-api";
import { MIN_SERVER_VERSION_WITH_BRIDGE } from "../lib/format";
import { IconAlert } from "../lib/icons";
import { errorText, localApi } from "../lib/useLocalState";
import { GlassCard, InfoNote, SettingRow, Switch } from "../lib/ui";
import { type SectionProps } from "./shared";

export function GeneralSection({ state, setState }: SectionProps): ReactNode {
  const [pending, setPending] = useState<Partial<GeneralConfig>>({});
  const [error, setError] = useState<string | null>(null);
  const general: GeneralConfig = { ...state.general, ...pending };
  const c = state.connection;
  const oldServer = c.online && !c.serverHasBridge;

  async function update(patch: Partial<GeneralConfig>): Promise<void> {
    setPending((p) => ({ ...p, ...patch }));
    setError(null);
    try {
      setState(await localApi().setGeneral({ ...general, ...patch }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending({});
    }
  }

  return (
    <>
      <GlassCard>
        <SettingRow title="Beim Anmelden starten" description="KIRA startet mit macOS und wartet in der Menüleiste.">
          {(ids) => <Switch checked={general.launchAtLogin} labelledBy={ids.titleId} describedBy={ids.descId} onChange={(v) => void update({ launchAtLogin: v })} />}
        </SettingRow>
        <SettingRow
          title="Mitteilungen"
          description={
            <>
              Mitteilungen deines KIRA-Servers als macOS-Mitteilung – auch wenn das Fenster zu ist.
              {oldServer ? (
                <span className="mt-1 flex items-center gap-[6px] text-(--g-warn)">
                  <IconAlert size={13} />
                  Dein Server{c.serverVersion ? ` (KIRA ${c.serverVersion})` : ""} kann das erst ab KIRA {MIN_SERVER_VERSION_WITH_BRIDGE}.
                </span>
              ) : null}
            </>
          }
        >
          {(ids) => <Switch checked={general.notifications} labelledBy={ids.titleId} describedBy={ids.descId} onChange={(v) => void update({ notifications: v })} />}
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

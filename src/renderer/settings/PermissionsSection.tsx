// Einstellungen → Berechtigungen: Mikrofon, Spracherkennung (nur wenn nötig),
// Bedienungshilfen, Bildschirmaufnahme – Stand als Pille, „Erlauben…“ fragt
// macOS über den Helfer. Zurück im Fenster lädt die Seite den Stand neu.

import { type ReactNode, useState } from "react";

import { type PermissionKind, type PermissionState } from "../../shared/helper-types";
import { permissionView } from "../lib/format";
import { IconAccessibility, IconMic, IconScreen, IconWave } from "../lib/icons";
import { errorText, localApi } from "../lib/useLocalState";
import { Button, GlassCard, IconTile, InfoNote, Pill, SettingRow } from "../lib/ui";
import { type SectionProps } from "./shared";

interface Row {
  kind: PermissionKind;
  title: string;
  icon: ReactNode;
  why: string;
  value: PermissionState | boolean | undefined;
  /** Wo man eine Ablehnung in den Systemeinstellungen zurücknimmt. */
  pane: string;
}

export function PermissionsSection({ state, setState, refresh }: SectionProps): ReactNode {
  const p = state.dictationStatus.permissions;
  const running = state.helper.running;
  const [busy, setBusy] = useState<PermissionKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const all: Row[] = [
    {
      kind: "microphone",
      title: "Mikrofon",
      icon: <IconMic size={18} />,
      why: "Für das Diktat – im Dashboard und in jedem anderen Programm.",
      value: p?.microphone,
      pane: "Mikrofon",
    },
    {
      kind: "speech",
      title: "Spracherkennung",
      icon: <IconWave size={18} />,
      why: "Erkennt Sprache direkt auf diesem Mac, ohne Server.",
      value: p?.speech,
      pane: "Spracherkennung",
    },
    {
      kind: "accessibility",
      title: "Bedienungshilfen",
      icon: <IconAccessibility size={18} />,
      why: "Setzt diktierten Text in das vorderste Programm ein.",
      value: p?.accessibility,
      pane: "Bedienungshilfen",
    },
    {
      kind: "screenRecording",
      title: "Bildschirmaufnahme",
      icon: <IconScreen size={18} />,
      why: "Nimmt bei Besprechungen den Computer-Ton auf – nur Ton, kein Bild.",
      value: p?.screenRecording,
      pane: "Bildschirm- und Systemaudioaufnahme",
    },
  ];
  const rows = all.filter((r) => !(r.kind === "speech" && r.value === "notRequired"));

  async function request(kind: PermissionKind): Promise<void> {
    setBusy(kind);
    setError(null);
    try {
      const permissions = await localApi().requestPermission(kind);
      if (permissions) setState({ ...state, dictationStatus: { ...state.dictationStatus, permissions } });
      // Danach den ganzen Stand frisch holen (die Spracherkennung hängt z. B. am Mikrofon).
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {!running ? (
        <InfoNote tone="warn" role="status">
          Der Helfer läuft nicht – die Freigaben lassen sich gerade nicht prüfen.{state.helper.lastError ? ` ${state.helper.lastError}` : ""}
        </InfoNote>
      ) : null}

      <GlassCard>
        {rows.map((row) => {
          const view = permissionView(row.value);
          const denied = row.value === "denied";
          return (
            <SettingRow
              key={row.kind}
              leading={<IconTile small>{row.icon}</IconTile>}
              title={row.title}
              description={
                denied ? (
                  <>
                    {row.why} Abgelehnt – in den Systemeinstellungen unter „Datenschutz & Sicherheit → {row.pane}“ wieder erlauben.
                  </>
                ) : (
                  row.why
                )
              }
            >
              <Pill tone={view.tone}>{view.text}</Pill>
              {!view.granted ? (
                <Button
                  aria-label={`${row.title} erlauben`}
                  busy={busy === row.kind}
                  disabled={!running || busy !== null}
                  onClick={() => void request(row.kind)}
                >
                  Erlauben…
                </Button>
              ) : null}
            </SettingRow>
          );
        })}
      </GlassCard>

      {error ? (
        <InfoNote tone="err" role="alert">
          {error}
        </InfoNote>
      ) : null}

      <p className="m-0 text-[12px] leading-[1.55] text-(--g-text-3)">
        Bei Bedienungshilfen und Bildschirmaufnahme öffnet „Erlauben…“ die passende Seite der Systemeinstellungen. Kommst du zu KIRA zurück, ist der
        Stand hier gleich aktuell.
      </p>
    </>
  );
}

// Adressfeld einer KIRA-Instanz mit Live-Prüfung (Einrichtung und
// Einstellungen → Instanz): Status rechts im Feld, Version bzw. Grund darunter.

import { type ReactNode, type Ref } from "react";

import { type ProbeResult } from "../../shared/local-api";
import { probeView } from "./format";
import { IconCheck, IconClose, IconGlobe, IconHome } from "./icons";
import { type ProbeController } from "./useProbe";
import { Spinner, TextField, type Tone, cx } from "./ui";

export type InstanceKind = "external" | "internal";

const FIELD: Record<InstanceKind, { label: string; note?: string; placeholder: string; hint: string; icon: ReactNode }> = {
  external: {
    label: "Adresse deiner Instanz",
    placeholder: "https://kira.example.de",
    hint: "Die Adresse, die du im Browser nutzt.",
    icon: <IconGlobe size={18} />,
  },
  internal: {
    label: "Adresse im Heimnetz",
    note: "optional, wird dort bevorzugt",
    placeholder: "http://192.168.178.166",
    hint: "Im Heimnetz schneller und ohne Anmeldung über Cloudflare Access.",
    icon: <IconHome size={18} />,
  },
};

export function InstanceField({
  kind,
  value,
  onChange,
  probe,
  onEnter,
  autoFocus,
  inputRef,
}: {
  kind: InstanceKind;
  value: string;
  onChange: (value: string) => void;
  probe: ProbeController;
  onEnter?: () => void;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}): ReactNode {
  const cfg = FIELD[kind];
  const view = probe.result ? probeView(probe.result) : null;

  let status: ReactNode = null;
  let meta: ReactNode = cfg.hint;
  let metaTone: Tone | undefined;
  if (probe.status === "checking") {
    status = (
      <span className="g-field-status">
        <Spinner />
        Prüft…
      </span>
    );
    meta = (
      <>
        <span className="sr-only">Die Adresse wird geprüft. </span>
        {cfg.hint}
      </>
    );
  } else if (view) {
    status = (
      <span className={cx("g-field-status", `is-${view.tone}`)}>
        {view.tone === "err" ? <IconClose size={14} strokeWidth={2.6} /> : <IconCheck size={14} strokeWidth={2.6} />}
        {view.badge}
      </span>
    );
    meta = (
      <>
        <span className="sr-only">{view.badge}. </span>
        {view.detail}
      </>
    );
    metaTone = view.tone === "ok" ? undefined : view.tone;
  }

  return (
    <TextField
      label={cfg.label}
      labelNote={cfg.note}
      icon={cfg.icon}
      value={value}
      placeholder={cfg.placeholder}
      inputMode="url"
      autoComplete="url"
      autoFocus={autoFocus}
      inputRef={inputRef}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => probe.checkNow()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          probe.checkNow();
          onEnter?.();
        }
      }}
      status={status}
      meta={meta}
      metaTone={metaTone}
      invalid={probe.status === "error"}
    />
  );
}

/**
 * Was gespeichert wird: die vom Hauptprozess normalisierte Origin, sobald die
 * Prüfung zu genau dieser Eingabe vorliegt („kira.example.de/chat“ →
 * „https://kira.example.de“), sonst die Eingabe selbst (leer → null).
 */
export function valueToSave(raw: string, probe: ProbeController): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const url = probe.result?.url ?? "";
  return probe.value === trimmed && /^https?:\/\/[^/]+$/i.test(url) ? url : trimmed;
}

/** Bevorzugtes erreichbares Ergebnis (Heimnetz vor extern) – für Version/Brücke. */
export function reachable(internal: ProbeController, external: ProbeController): ProbeResult | null {
  if (internal.status === "ok" && internal.result) return internal.result;
  if (external.status === "ok" && external.result) return external.result;
  return null;
}

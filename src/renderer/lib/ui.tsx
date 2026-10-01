// Kleine, schlichte Bausteine für die lokalen Seiten (Nocturne-Token).

import { type ReactNode } from "react";

export function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }): ReactNode {
  return (
    <section className="k-card flex flex-col gap-3">
      <header>
        <h2 className="text-[13px] font-semibold text-text">{title}</h2>
        {hint ? <p className="text-[12px] text-text-3">{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }): ReactNode {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-text-2">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-text-3">{hint}</span> : null}
    </label>
  );
}

export function Dot({ tone }: { tone: "ok" | "warn" | "err" | "idle" }): ReactNode {
  const color = tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : tone === "err" ? "bg-err" : "bg-text-3";
  return <span className={`inline-block size-2 rounded-full ${color}`} aria-hidden="true" />;
}

export function Notice({ tone, children }: { tone: "ok" | "warn" | "err" | "info"; children: ReactNode }): ReactNode {
  const cls =
    tone === "ok"
      ? "bg-ok-tint text-ok"
      : tone === "warn"
        ? "bg-warn-tint text-warn"
        : tone === "err"
          ? "bg-err-tint text-err"
          : "bg-brand-tint text-brand-ink";
  return <div className={`rounded-control px-3 py-2 text-[12px] ${cls}`}>{children}</div>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }): ReactNode {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="text-text">{label}</span>
      <input type="checkbox" className="size-4 accent-[var(--k-brand)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

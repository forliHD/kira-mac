// Bausteine der lokalen Seiten im Liquid-Glass-Design (Klassen g-* aus
// styles/glass.css): Karten mit Lichtkante, Zeilen, Pillen, Tastenkappen,
// Schalter, Knöpfe, Eingabefelder, Hinweise. Echte <button>/<input>/<label>,
// Schalter mit role="switch", Symbole immer aria-hidden.
//
// Unten stehen zusätzlich die alten, schlichten Nocturne-Bausteine (Section,
// Field, Dot, Notice, Toggle) mit unveränderter Signatur – für Seiten, die
// noch nicht umgestellt sind.

import { type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref, useId } from "react";

import { acceleratorKeys, spokenAccelerator } from "./accelerator";
import { type Tone } from "./format";
import { IconAlert, IconChat, IconCheck, IconInfo } from "./icons";

export type { Tone };

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ── Flächen ────────────────────────────────────────────────────────────

export function GlassCard({ className, ...rest }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cx("g-card", className)} {...rest} />;
}

export function SectionHeader({ id, title, subtitle }: { id?: string; title: ReactNode; subtitle?: ReactNode }): ReactNode {
  return (
    <header className="flex flex-col gap-1">
      <h1 id={id} className="g-title">
        {title}
      </h1>
      {subtitle ? <p className="g-subtitle">{subtitle}</p> : null}
    </header>
  );
}

export interface RowIds {
  titleId: string;
  descId: string | undefined;
}

/**
 * Zeile in einer Karte: Symbol (optional), Titel + Beschreibung, rechts das
 * Bedienelement. `children` darf eine Funktion sein, die die IDs für
 * aria-labelledby/aria-describedby bekommt.
 */
export function SettingRow({
  title,
  description,
  leading,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  children?: ReactNode | ((ids: RowIds) => ReactNode);
  className?: string;
}): ReactNode {
  const titleId = useId();
  const descId = useId();
  const ids: RowIds = { titleId, descId: description ? descId : undefined };
  return (
    <div className={cx("g-row", className)}>
      {leading}
      <div className="g-row-text">
        <span id={titleId} className="g-row-title">
          {title}
        </span>
        {description ? (
          <span id={descId} className="g-row-desc">
            {description}
          </span>
        ) : null}
      </div>
      {children ? <div className="g-row-control">{typeof children === "function" ? children(ids) : children}</div> : null}
    </div>
  );
}

/** Symbol-Kachel mit Ton (Statuskarten, Berechtigungen). */
export function IconTile({ tone = "idle", small, children }: { tone?: Tone; small?: boolean; children: ReactNode }): ReactNode {
  return (
    <span className={cx("g-tile", small && "g-tile-sm", tone !== "idle" && `is-${tone}`)} aria-hidden="true">
      {children}
    </span>
  );
}

/** App-Kachel: Sprechblase auf Himmelblau. */
export function AppTile({ size = 56 }: { size?: number }): ReactNode {
  return (
    <span className="g-app-tile" style={{ width: size, height: size, borderRadius: Math.round(size * 0.32) }} aria-hidden="true">
      <IconChat size={Math.round(size * 0.5)} strokeWidth={2.4} />
    </span>
  );
}

/** Karte mit Kachel, Titel, Erklärung und optional einem Knopf rechts. */
export function StatusCard({
  tone,
  icon,
  title,
  detail,
  action,
  live,
}: {
  tone: Tone;
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  /** Änderungen ansagen (role="status"). */
  live?: boolean;
}): ReactNode {
  return (
    <GlassCard className="flex items-center gap-[14px] px-4 py-[14px]" role={live ? "status" : undefined}>
      <IconTile tone={tone}>{icon}</IconTile>
      <div className="flex min-w-0 flex-auto flex-col gap-[3px]">
        <span className="text-[14px] font-semibold text-(--g-text)">{title}</span>
        {detail ? <span className="g-selectable text-[12px] leading-[1.45] text-(--g-text-2)">{detail}</span> : null}
      </div>
      {action ? <div className="flex flex-none items-center gap-2">{action}</div> : null}
    </GlassCard>
  );
}

// ── Status ─────────────────────────────────────────────────────────────

export function StatusDot({ tone, glow }: { tone: Tone; glow?: boolean }): ReactNode {
  return <span className={cx("g-dot", `is-${tone}`, glow && "is-glow")} aria-hidden="true" />;
}

/** Status-Pille: Punkt + Text. */
export function Pill({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }): ReactNode {
  return (
    <span className={cx("g-status", className)}>
      <StatusDot tone={tone} glow={tone === "ok"} />
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }): ReactNode {
  return <span className={cx("g-spinner", className)} aria-hidden="true" />;
}

const NOTE_ICONS: Record<Tone, ReactNode> = {
  info: <IconInfo size={16} />,
  idle: <IconInfo size={16} />,
  ok: <IconCheck size={16} strokeWidth={2.4} />,
  warn: <IconAlert size={16} />,
  err: <IconAlert size={16} />,
};

/** Hinweiskasten (Info, Warnung, Fehler, Erfolg). */
export function InfoNote({
  tone = "info",
  icon,
  children,
  role,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  role?: "status" | "alert";
  className?: string;
}): ReactNode {
  return (
    <div className={cx("g-note", tone !== "info" && tone !== "idle" && `is-${tone}`, className)} role={role}>
      {icon ?? NOTE_ICONS[tone]}
      <div className="min-w-0 flex-auto">{children}</div>
    </div>
  );
}

// ── Tastenkappen ───────────────────────────────────────────────────────

/** Tastensymbole, die in der Monospace-Schrift zu klein geraten – sie kommen aus der Systemschrift. */
const KEY_GLYPHS = new Set(["⌘", "⌥", "⇧", "⌃", "␣", "↩", "⇥", "⌫", "⌦", "↑", "↓", "←", "→"]);

function withGlyphs(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let run = "";
  for (const ch of text) {
    if (!KEY_GLYPHS.has(ch)) {
      run += ch;
      continue;
    }
    if (run) parts.push(run);
    run = "";
    parts.push(
      <span key={parts.length} className="g-kbd-glyph">
        {ch}
      </span>,
    );
  }
  if (run) parts.push(run);
  return parts;
}

export function Kbd({ children, small }: { children: ReactNode; small?: boolean }): ReactNode {
  return <kbd className={cx("g-kbd", small && "g-kbd-sm")}>{typeof children === "string" ? withGlyphs(children) : children}</kbd>;
}

/**
 * Kürzel als Kappen („⌥ ⌘ D“) oder als eine Kappe („⌥⌘D“, `joined`).
 * Bildschirmleser hören „Wahltaste Befehlstaste D“.
 */
export function KbdCombo({ accelerator, small, joined }: { accelerator: string; small?: boolean; joined?: boolean }): ReactNode {
  const keys = acceleratorKeys(accelerator);
  if (!keys.length) return <span className="text-[12px] text-(--g-text-3)">Kein Kürzel</span>;
  return (
    <span className="g-kbd-combo">
      <span className="sr-only">{spokenAccelerator(accelerator)}</span>
      <span className="g-kbd-combo" aria-hidden="true">
        {joined ? (
          <Kbd small={small}>{keys.join("")}</Kbd>
        ) : (
          keys.map((k, i) => (
            <Kbd key={`${k}-${i}`} small={small}>
              {k}
            </Kbd>
          ))
        )}
      </span>
    </span>
  );
}

// ── Bedienelemente ─────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "glass" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

/**
 * Knopf im Glas-Stil. `softDisabled` sperrt wie `disabled`, bleibt aber
 * fokussierbar (aria-disabled) – für Knöpfe, die nach dem Klick selbst
 * gesperrt werden („Speichern“, „Weiter“), damit der Tastaturfokus nicht verloren geht.
 */
export function Button({
  variant = "glass",
  size = "sm",
  icon,
  iconRight,
  busy,
  softDisabled,
  className,
  children,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  busy?: boolean;
  softDisabled?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      className={cx("g-btn", `g-btn-${variant}`, size !== "sm" && `g-btn-${size}`, className)}
      aria-busy={busy || undefined}
      aria-disabled={softDisabled || undefined}
      onClick={(e) => {
        if (softDisabled) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      {busy ? <Spinner /> : icon}
      {children}
      {busy ? null : iconRight}
    </button>
  );
}

/** Quadratischer Symbolknopf – `label` wird zum aria-label. */
export function IconButton({
  label,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }): ReactNode {
  return (
    <button type="button" aria-label={label} title={label} className={cx("g-btn g-btn-glass g-btn-icon h-10", className)} {...rest}>
      {children}
    </button>
  );
}

/** Schalter im iOS-Stil (`role="switch"`). Beschriftung über `label` oder `labelledBy`. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  labelledBy,
  describedBy,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
}): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      className="g-switch"
      onClick={() => onChange(!checked)}
    >
      <span className="g-switch-knob" aria-hidden="true" />
    </button>
  );
}

/**
 * Eingabefeld im Glas-Stil: Beschriftung oben, Symbol links, Status rechts im
 * Feld, Zeile darunter (wird angesagt, `aria-live`).
 */
export function TextField({
  label,
  labelNote,
  icon,
  status,
  meta,
  metaTone,
  invalid,
  inputRef,
  className,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
  label: ReactNode;
  labelNote?: ReactNode;
  icon?: ReactNode;
  status?: ReactNode;
  meta?: ReactNode;
  metaTone?: Tone;
  invalid?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}): ReactNode {
  const id = useId();
  const metaId = useId();
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="g-label">
        {label}
        {labelNote ? <span className="g-label-note">{labelNote}</span> : null}
      </label>
      <div className="g-field" data-invalid={invalid ? "true" : undefined}>
        {icon}
        <input
          id={id}
          ref={inputRef}
          type="text"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={invalid || undefined}
          aria-describedby={metaId}
          {...input}
        />
        {status}
      </div>
      <p id={metaId} className={cx("g-meta", metaTone && `is-${metaTone}`)} aria-live="polite">
        {meta}
      </p>
    </div>
  );
}

// ── Alte Nocturne-Bausteine (unverändert, für noch nicht umgestellte Seiten) ──

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

// Inline-SVG-Symbole des Schnellfensters (Strich, currentColor, 24er-Raster).
// Alle sind dekorativ (aria-hidden) – die Bedeutung trägt das aria-label des Knopfs.

import { type ReactNode, type SVGProps } from "react";

type IconProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, "children">;

function Svg({ size = 16, strokeWidth = 2, children, ...rest }: IconProps & { children: ReactNode }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Sprechblase mit dem „K“ des App-Symbols (Kopf des Schnellfensters). */
export function BubbleIcon(props: IconProps): ReactNode {
  return (
    <Svg strokeWidth={2.4} {...props}>
      <path d="M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8H6l-2 2v-10z" />
      <path d="M10 8.5v7M14.5 8.5l-4.1 3.8M11.9 11.2l2.7 4.3" strokeWidth="2" />
    </Svg>
  );
}

export function MicIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </Svg>
  );
}

export function ArrowUpIcon(props: IconProps): ReactNode {
  return (
    <Svg strokeWidth={2.4} {...props}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </Svg>
  );
}

export function StopIcon({ size = 14, ...rest }: IconProps): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...rest}>
      <rect x="6" y="6" width="12" height="12" rx="3" />
    </svg>
  );
}

/** Neuer Chat: Blatt mit Stift. */
export function ComposeIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
      <path d="M17.6 3.6a2 2 0 0 1 2.8 2.8L12 14.8 8.5 15.5l.7-3.5z" />
    </Svg>
  );
}

/** Im Hauptfenster öffnen: Fenster mit Pfeil nach rechts oben. */
export function OpenIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8.5 8.5" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps): ReactNode {
  return (
    <Svg strokeWidth={2.6} {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function CrossIcon(props: IconProps): ReactNode {
  return (
    <Svg strokeWidth={2.6} {...props}>
      <path d="M7 7l10 10M17 7L7 17" />
    </Svg>
  );
}

export function AlertIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M12 4.5 2.8 19.5h18.4z" />
      <path d="M12 10v4M12 17h.01" />
    </Svg>
  );
}

/** Verlauf: Uhr mit Pfeil. */
export function HistoryIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4.5l3 1.8" />
    </Svg>
  );
}

/** Chip: das Apple-Modell auf diesem Mac. */
export function ChipIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
      <path d="M10 10h4v4h-4zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </Svg>
  );
}

/** Keine Verbindung: Wolke durchgestrichen. */
export function OfflineIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M7.5 18H17a4 4 0 0 0 1.2-7.8A6 6 0 0 0 7.3 8.4" />
      <path d="M5.2 9.6A4.3 4.3 0 0 0 7.5 18" />
      <path d="M3 3l18 18" />
    </Svg>
  );
}

export function ImageIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M8.5 10.5a1.5 1.5 0 1 0 0-.01M20.5 15.5l-5-5-9 9" />
    </Svg>
  );
}

/** Denkschritte („Nachgedacht“), wie das Gehirn-Symbol im Dashboard. */
export function BrainIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M9.5 4.5a2.5 2.5 0 0 0-2.45 2 2.75 2.75 0 0 0-1.8 4.3A2.75 2.75 0 0 0 7 15.5a2.5 2.5 0 0 0 2.5 2.5h.5V4.5z" />
      <path d="M14.5 4.5a2.5 2.5 0 0 1 2.45 2 2.75 2.75 0 0 1 1.8 4.3A2.75 2.75 0 0 1 17 15.5a2.5 2.5 0 0 1-2.5 2.5H14V4.5z" />
    </Svg>
  );
}

export function ChevronIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  );
}

export function CopyIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9" />
    </Svg>
  );
}

/** Schlichte Sprechblase („In den Chat“). */
export function ChatIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8H6l-2 2v-10z" />
    </Svg>
  );
}

/** Schloss („nur auf diesem Mac“). */
export function LockIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Svg>
  );
}

/** Wellenform – das Diktat-Zeichen der Ansicht „Diktate“. */
export function WaveIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
    </Svg>
  );
}

export function GearIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  );
}

/** Text in ein Programm einsetzen (Pfeil in ein Feld). */
export function InsertIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      <path d="M3 12h11M10 8l4 4-4 4" />
    </Svg>
  );
}

export function TrashIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </Svg>
  );
}

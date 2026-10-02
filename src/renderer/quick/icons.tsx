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

/** Sprechblase – das KIRA-Zeichen der Kachel (wie Menüleiste und Design). */
export function BubbleIcon(props: IconProps): ReactNode {
  return (
    <Svg strokeWidth={2.4} {...props}>
      <path d="M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8H6l-2 2v-10z" />
      <path d="M9 11h6M9 14h4" />
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

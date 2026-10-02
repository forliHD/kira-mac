// Symbole der lokalen Seiten: Inline-SVG, 24er-Raster, Kontur in currentColor
// (Farbe kommt vom umgebenden Text). Immer aria-hidden – die Bedeutung trägt
// der Text daneben bzw. das aria-label des Knopfs.

import { type ReactNode } from "react";

export interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

function Svg({ size = 16, strokeWidth = 2, className, children }: IconProps & { children: ReactNode }): ReactNode {
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
      className={className}
    >
      {children}
    </svg>
  );
}

/** Die Sprechblase der Marke mit dem „K“ des App-Symbols (wie Menüleiste und Dock). */
export function IconChat(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <path d="M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8H6l-2 2v-10z" />
      <path d="M10 8.5v7M14.5 8.5l-4.1 3.8M11.9 11.2l2.7 4.3" strokeWidth="2" />
    </Svg>
  );
}

export function IconGlobe(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </Svg>
  );
}

export function IconHome(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </Svg>
  );
}

export function IconKeyboard(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" />
    </Svg>
  );
}

export function IconMic(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </Svg>
  );
}

export function IconShield(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
    </Svg>
  );
}

export function IconGear(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Svg>
  );
}

export function IconInfo(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v4h1" />
    </Svg>
  );
}

export function IconCheck(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </Svg>
  );
}

export function IconClose(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Svg>
  );
}

export function IconAlert(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <path d="M10.3 4.4a2 2 0 0 1 3.4 0l7.4 12.9a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3z" />
      <path d="M12 9.5v4M12 16.8h.01" />
    </Svg>
  );
}

export function IconArrowRight(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

export function IconArrowLeft(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Svg>
  );
}

export function IconBolt(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
    </Svg>
  );
}

export function IconBell(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </Svg>
  );
}

export function IconCloudOff(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 0 1 0 9z" />
      <path d="M3 3l18 18" />
    </Svg>
  );
}

export function IconRefresh(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </Svg>
  );
}

export function IconFolder(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Svg>
  );
}

export function IconAccessibility(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="7.6" r="1.1" />
      <path d="M7.8 10.4l4.2.9 4.2-.9M12 11.3v3l-2 3.6M12 14.3l2 3.6" />
    </Svg>
  );
}

export function IconScreen(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="12" rx="2.5" />
      <path d="M8 20h8M12 16v4" />
    </Svg>
  );
}

/** Schallwellen – Spracherkennung. */
export function IconWave(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
    </Svg>
  );
}

export function IconPower(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <path d="M12 3v9" />
      <path d="M6.3 6.3a8 8 0 1 0 11.4 0" />
    </Svg>
  );
}

export function IconServer(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <rect x="4" y="4" width="16" height="7" rx="2" />
      <rect x="4" y="13" width="16" height="7" rx="2" />
      <path d="M8 7.5h.01M8 16.5h.01" />
    </Svg>
  );
}

export function IconChip(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
      <path d="M9.5 2.5v3M14.5 2.5v3M9.5 18.5v3M14.5 18.5v3M2.5 9.5h3M2.5 14.5h3M18.5 9.5h3M18.5 14.5h3" />
    </Svg>
  );
}

export function IconDownload(p: IconProps): ReactNode {
  return (
    <Svg {...p}>
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </Svg>
  );
}

/** Ausgefülltes Quadrat – Stopp. */
export function IconStop({ size = 16, className }: IconProps): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      <rect x="6" y="6" width="12" height="12" rx="3" />
    </svg>
  );
}

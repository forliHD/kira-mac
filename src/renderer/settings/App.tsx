// Einstellungen (900×620, Ampel über der Seitenleiste, Vibrancy): links die
// Bereiche als senkrechte Tab-Liste, rechts Titel + Karten. Die Auswahl ist
// reiner Zustand (kein Router); `?section=` wählt den Startbereich, das
// Ereignis `settings-section` wechselt in einem schon offenen Fenster.

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { updateShort } from "../lib/format";
import { IconGear, IconGlobe, IconInfo, IconKeyboard, IconMic, IconShield } from "../lib/icons";
import { localApi, useLocalState } from "../lib/useLocalState";
import { GlassCard, InfoNote, SectionHeader, Spinner, StatusDot, cx } from "../lib/ui";
import { AboutSection } from "./AboutSection";
import { DictationSection } from "./DictationSection";
import { GeneralSection } from "./GeneralSection";
import { HotkeySection } from "./HotkeySection";
import { InstanceSection } from "./InstanceSection";
import { PermissionsSection } from "./PermissionsSection";
import { type HotkeyName, type SectionId, type SectionProps, sectionFromName, sectionFromQuery } from "./shared";

const SECTIONS: Array<{ id: SectionId; label: string; icon: ReactNode; title: string; subtitle: string }> = [
  {
    id: "instanz",
    label: "Instanz",
    icon: <IconGlobe size={16} />,
    title: "Instanz",
    subtitle: "Die Adresse deines KIRA-Servers. Im Heimnetz nutzt die App die interne Adresse, unterwegs die externe.",
  },
  {
    id: "kuerzel",
    label: "Tastenkürzel",
    icon: <IconKeyboard size={16} />,
    title: "Tastenkürzel",
    subtitle: "Gelten in jedem Programm, auch wenn KIRA im Hintergrund läuft.",
  },
  {
    id: "diktat",
    label: "Diktat",
    icon: <IconMic size={16} />,
    title: "Diktat",
    subtitle: "Spracherkennung auf diesem Mac. Der Ton verlässt das Gerät nicht.",
  },
  {
    id: "berechtigungen",
    label: "Berechtigungen",
    icon: <IconShield size={16} />,
    title: "Berechtigungen",
    subtitle: "macOS fragt erst, wenn eine Funktion eine Freigabe braucht. Hier siehst du den Stand.",
  },
  {
    id: "allgemein",
    label: "Allgemein",
    icon: <IconGear size={16} />,
    title: "Allgemein",
    subtitle: "Wie sich KIRA auf diesem Mac verhält.",
  },
  {
    id: "ueber",
    label: "Über",
    icon: <IconInfo size={16} />,
    title: "Über KIRA für Mac",
    subtitle: "Version, Updates und Hilfe bei der Fehlersuche.",
  },
];

function SectionBody({ id, props, focusHotkey }: { id: SectionId; props: SectionProps; focusHotkey: HotkeyName | null }): ReactNode {
  switch (id) {
    case "instanz":
      return <InstanceSection {...props} />;
    case "kuerzel":
      return <HotkeySection {...props} focusHotkey={focusHotkey} />;
    case "diktat":
      return <DictationSection {...props} />;
    case "berechtigungen":
      return <PermissionsSection {...props} />;
    case "allgemein":
      return <GeneralSection {...props} />;
    case "ueber":
      return <AboutSection {...props} />;
    default:
      return null;
  }
}

export function App(): ReactNode {
  const { state, error, refresh, setState } = useLocalState({ refreshOnFocus: true });
  const [section, setSection] = useState<SectionId>(() => sectionFromQuery(window.location.search));
  const [focusHotkey, setFocusHotkey] = useState<HotkeyName | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<SectionId, HTMLButtonElement>());

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [section]);

  // „Ändern“ aus der Einrichtung o. ä., während die Einstellungen schon offen sind.
  useEffect(() => {
    let off = (): void => undefined;
    try {
      off = localApi().on((event) => {
        if (event.type !== "settings-section") return;
        const target = sectionFromName(event.section);
        if (!target) return;
        setFocusHotkey(null);
        setSection(target);
      });
    } catch {
      /* außerhalb der App: nichts zu hören */
    }
    return () => off();
  }, []);

  function go(id: SectionId, focus?: HotkeyName): void {
    setFocusHotkey(focus ?? null);
    setSection(id);
  }

  function onTabKey(e: KeyboardEvent<HTMLDivElement>): void {
    const index = SECTIONS.findIndex((s) => s.id === section);
    let next = index;
    if (e.key === "ArrowDown") next = (index + 1) % SECTIONS.length;
    else if (e.key === "ArrowUp") next = (index - 1 + SECTIONS.length) % SECTIONS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = SECTIONS.length - 1;
    else return;
    e.preventDefault();
    const target = SECTIONS[next];
    if (!target) return;
    go(target.id);
    tabRefs.current.get(target.id)?.focus();
  }

  const meta = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!;
  const update = state ? updateShort(state.update) : null;

  let body: ReactNode;
  if (error) {
    body = (
      <InfoNote tone="err" role="alert">
        {error}
      </InfoNote>
    );
  } else if (!state) {
    body = (
      <GlassCard className="flex items-center gap-3 px-4 py-4 text-(--g-text-2)" role="status">
        <Spinner /> Lade die Einstellungen…
      </GlassCard>
    );
  } else {
    body = <SectionBody id={section} props={{ state, setState, refresh, go }} focusHotkey={focusHotkey} />;
  }

  return (
    <div className="settings">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-top g-drag" aria-hidden="true" />
        <nav aria-label="Einstellungen">
          <div className="settings-nav" role="tablist" aria-orientation="vertical" aria-label="Bereiche" onKeyDown={onTabKey}>
            {SECTIONS.map((s) => {
              const active = s.id === section;
              return (
                <button
                  key={s.id}
                  ref={(el) => {
                    if (el) tabRefs.current.set(s.id, el);
                    else tabRefs.current.delete(s.id);
                  }}
                  id={`tab-${s.id}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="settings-panel"
                  tabIndex={active ? 0 : -1}
                  className="g-nav-item"
                  onClick={() => go(s.id)}
                >
                  {s.icon}
                  {s.label}
                </button>
              );
            })}
          </div>
        </nav>

        <button
          type="button"
          className={cx("settings-version", section === "ueber" && "is-current")}
          aria-label={`KIRA für Mac ${state?.appVersion ?? ""}${update ? `, ${update.text}` : ""} – Über öffnen`}
          onClick={() => go("ueber")}
        >
          <span className="settings-version-name">KIRA für Mac {state?.appVersion ?? ""}</span>
          {update ? (
            <span className="flex items-center gap-[6px]">
              <StatusDot tone={update.tone} />
              {update.text}
            </span>
          ) : null}
        </button>
      </aside>

      <div className="settings-main">
        <div className="settings-titlebar g-drag" aria-hidden="true" />
        <div ref={scrollRef} id="settings-panel" className="settings-scroll g-scroll" role="tabpanel" aria-labelledby="settings-title">
          <div className="settings-content">
            <SectionHeader id="settings-title" title={meta.title} subtitle={meta.subtitle} />
            {body}
          </div>
        </div>
      </div>
    </div>
  );
}

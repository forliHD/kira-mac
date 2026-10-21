// Diktate-Ansicht des Schnellfensters (⌘2): die letzten globalen Diktate als
// Karten in Tagesgruppen – Kopieren, in den Chat übernehmen, erneut einsetzen,
// löschen. Owner-Wunsch 02.10.2026: der Verlauf war unter Einstellungen →
// Diktat zu versteckt. Die Daten kommen aus src/main/dictation-history.ts
// (nur auf diesem Mac, verschlüsselt). Phase 3 (0.5.0): Tagesgruppen und
// „Erneut einsetzen“ (Fenster geht zu, der Text landet im Programm davor).

import { type ReactNode, useState } from "react";

import { type DictationEntry } from "../../shared/local-api";
import { AlertIcon, ChatIcon, CheckIcon, CopyIcon, CrossIcon, InsertIcon } from "./icons";
import { dictationClock, groupDictations } from "./logic";

export interface DictationListProps {
  entries: DictationEntry[];
  selected: number;
  copiedId: string | null;
  now: number;
  onSelect: (index: number) => void;
  onCopy: (entry: DictationEntry) => void;
  onToChat: (entry: DictationEntry) => void;
  onReinsert: (entry: DictationEntry) => void;
  onDelete: (entry: DictationEntry) => void;
}

export function dictationItemId(entry: DictationEntry): string {
  return `q-dict-${entry.id}`;
}

export function DictationList({ entries, selected, copiedId, now, onSelect, onCopy, onToChat, onReinsert, onDelete }: DictationListProps): ReactNode {
  let index = -1;
  return (
    <div className="q-dict-groups" role="listbox" aria-label="Letzte Diktate">
      {groupDictations(entries, now).map((group) => (
        <section key={group.key} className="q-dict-group" aria-label={group.label}>
          <h2 className="q-dict-day">{group.label}</h2>
          <ul className="q-dict-list">
            {group.entries.map((entry) => {
              index++;
              const i = index;
              return (
                <DictationCard
                  key={entry.id}
                  entry={entry}
                  selected={i === selected}
                  copied={copiedId === entry.id}
                  now={now}
                  onSelect={() => onSelect(i)}
                  onCopy={() => onCopy(entry)}
                  onToChat={() => onToChat(entry)}
                  onReinsert={() => onReinsert(entry)}
                  onDelete={() => onDelete(entry)}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface CardProps {
  entry: DictationEntry;
  selected: boolean;
  copied: boolean;
  now: number;
  onSelect: () => void;
  onCopy: () => void;
  onToChat: () => void;
  onReinsert: () => void;
  onDelete: () => void;
}

function DictationCard({ entry, selected, copied, now, onSelect, onCopy, onToChat, onReinsert, onDelete }: CardProps): ReactNode {
  const [open, setOpen] = useState(false);
  const long = entry.text.length > 240 || entry.text.split("\n").length > 4;
  const app = entry.target === "quick" ? "Schnellfenster" : entry.app;
  return (
    <li id={dictationItemId(entry)} role="option" aria-selected={selected} className={`q-dict${selected ? " is-selected" : ""}`} onMouseEnter={onSelect}>
      <div className="q-dict-meta">
        <span className="q-dict-time">{dictationClock(entry.at, now)}</span>
        {app ? <span className="q-dict-app">{app}</span> : null}
        {entry.failed ? (
          <span className="q-dict-failed" title="Das Einsetzen im Programm ist gescheitert – der Text steht nur hier.">
            <AlertIcon size={12} />
            nicht eingesetzt
          </span>
        ) : null}
      </div>
      <p className={`q-dict-text${long && !open ? " is-clamped" : ""}`}>{entry.text}</p>
      <div className="q-dict-actions">
        {long ? (
          <button type="button" className="q-dict-more" onClick={() => setOpen((v) => !v)}>
            {open ? "Weniger" : "Ganzen Text"}
          </button>
        ) : (
          <span />
        )}
        <span className="q-dict-buttons">
          <button type="button" className={`q-dict-btn is-primary${copied ? " is-done" : ""}`} onClick={onCopy}>
            {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
            {copied ? "Kopiert" : "Kopieren"}
          </button>
          <button type="button" className="q-dict-btn" onClick={onToChat} title="Als Frage an KIRA übernehmen">
            <ChatIcon size={13} />
            In den Chat
          </button>
          {entry.target === "insert" ? (
            <button type="button" className="q-dict-btn" onClick={onReinsert} title="Das Fenster geht zu, der Text landet im Programm, das davor vorn war (Bedienungshilfen nötig).">
              <InsertIcon size={13} />
              Erneut einsetzen
            </button>
          ) : null}
          <button type="button" className="q-dict-del" aria-label="Aus dem Verlauf löschen" title="Löschen" onClick={onDelete}>
            <CrossIcon size={13} />
          </button>
        </span>
      </div>
    </li>
  );
}

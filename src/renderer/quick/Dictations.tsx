// Diktate-Ansicht des Schnellfensters (⌘2): die letzten globalen Diktate als
// Karten – Kopieren, in den Chat übernehmen, löschen. Owner-Wunsch 02.10.2026:
// der Verlauf war unter Einstellungen → Diktat zu versteckt. Die Daten kommen
// aus src/main/dictation-history.ts (nur auf diesem Mac, verschlüsselt).

import { type ReactNode, useState } from "react";

import { type DictationEntry } from "../../shared/local-api";
import { AlertIcon, ChatIcon, CheckIcon, CopyIcon, CrossIcon } from "./icons";
import { dictationTime } from "./logic";

export interface DictationListProps {
  entries: DictationEntry[];
  selected: number;
  copiedId: string | null;
  now: number;
  onSelect: (index: number) => void;
  onCopy: (entry: DictationEntry) => void;
  onToChat: (entry: DictationEntry) => void;
  onDelete: (entry: DictationEntry) => void;
}

export function dictationItemId(entry: DictationEntry): string {
  return `q-dict-${entry.id}`;
}

export function DictationList({ entries, selected, copiedId, now, onSelect, onCopy, onToChat, onDelete }: DictationListProps): ReactNode {
  return (
    <ul className="q-dict-list" role="listbox" aria-label="Letzte Diktate">
      {entries.map((entry, index) => (
        <DictationCard
          key={entry.id}
          entry={entry}
          selected={index === selected}
          copied={copiedId === entry.id}
          now={now}
          onSelect={() => onSelect(index)}
          onCopy={() => onCopy(entry)}
          onToChat={() => onToChat(entry)}
          onDelete={() => onDelete(entry)}
        />
      ))}
    </ul>
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
  onDelete: () => void;
}

function DictationCard({ entry, selected, copied, now, onSelect, onCopy, onToChat, onDelete }: CardProps): ReactNode {
  const [open, setOpen] = useState(false);
  const long = entry.text.length > 240 || entry.text.split("\n").length > 4;
  const app = entry.target === "quick" ? "Schnellfenster" : entry.app;
  return (
    <li id={dictationItemId(entry)} role="option" aria-selected={selected} className={`q-dict${selected ? " is-selected" : ""}`} onMouseEnter={onSelect}>
      <div className="q-dict-meta">
        <span className="q-dict-time">{dictationTime(entry.at, now)}</span>
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
          <button type="button" className="q-dict-del" aria-label="Aus dem Verlauf löschen" title="Löschen" onClick={onDelete}>
            <CrossIcon size={13} />
          </button>
        </span>
      </div>
    </li>
  );
}

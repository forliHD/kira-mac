// Einstellungen → Diktat → Verlauf: die letzten globalen Diktate zum
// Herauskopieren – auch wenn das Einsetzen im fremden Programm scheiterte
// (Owner-Wunsch 02.10.2026). Bleibt nur auf diesem Mac (src/main/dictation-history.ts).

import { type ReactNode, useCallback, useEffect, useState } from "react";

import { type DictationEntry, type DictationHistoryView, type LocalEvent } from "../../shared/local-api";
import { formatLastSeen } from "../lib/format";
import { IconAlert, IconCheck, IconClose } from "../lib/icons";
import { errorText, localApi } from "../lib/useLocalState";
import { Button, GlassCard, IconButton, InfoNote } from "../lib/ui";

function EntryRow({ entry, onCopy, onDelete, copied }: { entry: DictationEntry; onCopy: () => void; onDelete: () => void; copied: boolean }): ReactNode {
  const [open, setOpen] = useState(false);
  const long = entry.text.length > 180;
  return (
    <li className="dh-item">
      <div className="dh-meta">
        <span>{formatLastSeen(new Date(entry.at)).replace(/^um /, "heute um ")}</span>
        {entry.app ? <span className="dh-app">{entry.target === "quick" ? "Schnellfenster" : entry.app}</span> : null}
        {entry.failed ? (
          <span className="dh-failed">
            <IconAlert size={12} /> nicht eingesetzt
          </span>
        ) : null}
      </div>
      <p className={open || !long ? "dh-text g-selectable" : "dh-text is-clamped g-selectable"}>{entry.text}</p>
      <div className="dh-actions">
        {long ? (
          <button type="button" className="g-link dh-more" onClick={() => setOpen((v) => !v)}>
            {open ? "Weniger" : "Ganzen Text zeigen"}
          </button>
        ) : (
          <span />
        )}
        <span className="dh-buttons">
          <Button size="sm" icon={copied ? <IconCheck size={13} strokeWidth={2.4} /> : undefined} onClick={onCopy}>
            {copied ? "Kopiert" : "Kopieren"}
          </Button>
          <IconButton label="Aus dem Verlauf löschen" className="dh-delete" onClick={onDelete}>
            <IconClose size={14} />
          </IconButton>
        </span>
      </div>
    </li>
  );
}

export function DictationHistoryCard(): ReactNode {
  const [view, setView] = useState<DictationHistoryView | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await localApi().dictationHistory());
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void load();
    let off = (): void => undefined;
    try {
      off = localApi().on((event: LocalEvent) => {
        if (event.type === "dictation-history") void load();
      });
    } catch {
      /* Vorschau ohne Hülle */
    }
    return () => off();
  }, [load]);

  async function copy(id: string): Promise<void> {
    setError(null);
    try {
      await localApi().copyDictation(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1600);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function remove(id: string): Promise<void> {
    setError(null);
    try {
      setView(await localApi().deleteDictation(id));
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function clear(): Promise<void> {
    setError(null);
    try {
      setView(await localApi().clearDictationHistory());
    } catch (err) {
      setError(errorText(err));
    }
  }

  const entries = view?.entries ?? [];
  return (
    <GlassCard className="dh-card">
      <div className="dh-head">
        <div>
          <h3 className="dh-title">Verlauf</h3>
          <p className="dh-sub">
            Deine letzten Diktate zum Herauskopieren – auch wenn das Einsetzen nicht geklappt hat. Bleibt nur auf diesem Mac
            {view && !view.persistent ? " und nur bis zum Beenden der App" : ", verschlüsselt im Schlüsselbund"} (höchstens 100 Diktate, 30
            Tage). Schneller geht es im Schnellfenster: ⌥ Leertaste, dann ⌘2.
          </p>
        </div>
        {entries.length > 0 ? (
          <Button size="sm" onClick={() => void clear()}>
            Verlauf leeren
          </Button>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <p className="dh-empty">Noch keine Diktate.</p>
      ) : (
        <ul className="dh-list" aria-label="Letzte Diktate">
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} copied={copiedId === entry.id} onCopy={() => void copy(entry.id)} onDelete={() => void remove(entry.id)} />
          ))}
        </ul>
      )}
      {error ? (
        <InfoNote tone="err" role="alert">
          {error}
        </InfoNote>
      ) : null}
    </GlassCard>
  );
}

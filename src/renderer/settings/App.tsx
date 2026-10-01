// Einstellungen: Instanz-URLs, Tastenkürzel, Diktat (Engine-Status mit
// Grund), Berechtigungen, Allgemein (Beim Anmelden starten), Updates.

import { type ReactNode, useEffect, useState } from "react";

import { type PermissionKind, type PermissionState } from "../../shared/helper-types";
import { type LocalState, type ProbeResult } from "../../shared/local-api";
import { localApi, useLocalState } from "../lib/useLocalState";
import { Dot, Field, Notice, Section, Toggle } from "../lib/ui";

function permissionLabel(state: PermissionState | boolean | undefined): { text: string; tone: "ok" | "warn" | "err" | "idle" } {
  if (state === true || state === "granted") return { text: "erteilt", tone: "ok" };
  if (state === "notRequired") return { text: "nicht nötig", tone: "ok" };
  if (state === false || state === "denied") return { text: "verweigert", tone: "err" };
  if (state === "notDetermined") return { text: "noch nicht gefragt", tone: "warn" };
  return { text: "unbekannt", tone: "idle" };
}

function InstanceSection({ state, onSaved }: { state: LocalState; onSaved: (s: LocalState) => void }): ReactNode {
  const [internalUrl, setInternalUrl] = useState(state.instance.internalUrl ?? "");
  const [externalUrl, setExternalUrl] = useState(state.instance.externalUrl ?? "");
  const [probes, setProbes] = useState<ProbeResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setInternalUrl(state.instance.internalUrl ?? "");
    setExternalUrl(state.instance.externalUrl ?? "");
  }, [state.instance.internalUrl, state.instance.externalUrl]);

  async function check(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const api = localApi();
      const urls = [internalUrl, externalUrl].map((u) => u.trim()).filter(Boolean);
      setProbes(await Promise.all(urls.map((u) => api.probe(u))));
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      onSaved(await localApi().saveInstance({ internalUrl: internalUrl.trim() || null, externalUrl: externalUrl.trim() || null }));
      setMsg("Gespeichert – die Verbindung wird neu aufgebaut.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const c = state.connection;
  return (
    <Section title="Instanz" hint="Im Heimnetz wird die interne Adresse bevorzugt; sonst die externe.">
      <div className="flex items-center gap-2 text-[12px]">
        <Dot tone={c.online ? "ok" : "err"} />
        {c.online ? (
          <span>
            Verbunden ({c.kind === "internal" ? "intern" : "extern"}) mit {c.origin}
            {c.serverVersion ? ` – KIRA ${c.serverVersion}` : ""}
            {c.serverHasBridge ? "" : " – ohne Brücke (Benachrichtigungen nur im Dashboard)"}
          </span>
        ) : (
          <span className="text-err">{c.lastError ?? "Nicht verbunden."}</span>
        )}
      </div>
      <Field label="Interne Adresse (Heimnetz)">
        <input className="k-input" value={internalUrl} onChange={(e) => setInternalUrl(e.target.value)} placeholder="http://192.168.178.166" />
      </Field>
      <Field label="Externe Adresse">
        <input className="k-input" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://kira.example.de" />
      </Field>
      {probes ? (
        <ul className="flex flex-col gap-1 text-[12px]">
          {probes.map((p) => (
            <li key={p.url} className="flex items-center gap-2">
              <Dot tone={p.ok ? "ok" : "err"} />
              <span className="font-mono">{p.url}</span>
              <span className={p.ok ? "text-text-2" : "text-err"}>{p.ok ? `erreichbar${p.version ? `, KIRA ${p.version}` : ""}` : p.error}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {msg ? <Notice tone="info">{msg}</Notice> : null}
      <div className="flex gap-2">
        <button className="k-btn" disabled={busy} onClick={() => void check()}>
          Prüfen
        </button>
        <button className="k-btn k-btn-primary" disabled={busy} onClick={() => void save()}>
          Speichern
        </button>
      </div>
    </Section>
  );
}

function HotkeySection({ state, onSaved }: { state: LocalState; onSaved: (s: LocalState) => void }): ReactNode {
  const [quick, setQuick] = useState(state.hotkeys.quickWindow);
  const [dict, setDict] = useState(state.hotkeys.dictation);
  const [conflicts, setConflicts] = useState<string[]>(state.dictationStatus.hotkeyConflicts);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const r = await localApi().setHotkeys({ quickWindow: quick.trim(), dictation: dict.trim() });
      onSaved(r.state);
      setConflicts(r.conflicts);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Tastenkürzel" hint="Electron-Schreibweise, z. B. Alt+Space, Alt+Command+D, Control+Shift+K.">
      <Field label="Schnellfenster">
        <input className="k-input font-mono" value={quick} onChange={(e) => setQuick(e.target.value)} />
      </Field>
      <Field label="Globales Diktat">
        <input className="k-input font-mono" value={dict} onChange={(e) => setDict(e.target.value)} />
      </Field>
      {conflicts.length ? (
        <Notice tone="warn">
          {conflicts.map((c) => (
            <div key={c}>{c}</div>
          ))}
        </Notice>
      ) : null}
      <div>
        <button className="k-btn k-btn-primary" disabled={busy} onClick={() => void save()}>
          Übernehmen
        </button>
      </div>
    </Section>
  );
}

function DictationSection({ state, onSaved }: { state: LocalState; onSaved: (s: LocalState) => void }): ReactNode {
  const stt = state.dictationStatus.stt;
  const helper = state.helper;
  const locales = helper.info?.locales?.length ? helper.info.locales : ["de-DE", "en-US"];
  const engine = !helper.running
    ? { tone: "err" as const, text: helper.lastError ?? "Helfer läuft nicht." }
    : stt?.available
      ? { tone: "ok" as const, text: `Apple-Spracherkennung (${stt.engine === "analyzer" ? "SpeechAnalyzer" : "SFSpeechRecognizer"}), Modell ${stt.assets === "installed" ? "installiert" : stt.assets}` }
      : { tone: "err" as const, text: stt?.reason ?? (stt?.assets === "missing" ? "Sprachmodell nicht installiert." : "Apple-Spracherkennung nicht verfügbar – kein Rückfall auf den Server.") };

  async function update(patch: Partial<LocalState["dictation"]>): Promise<void> {
    onSaved(await localApi().setDictation({ ...state.dictation, ...patch }));
  }

  return (
    <Section title="Diktat" hint="Globales Diktat erkennt auf dem Apple-Chip und fügt den Text in das vorderste Programm ein.">
      <div className="flex items-center gap-2 text-[12px]">
        <Dot tone={engine.tone} />
        <span className={engine.tone === "err" ? "text-err" : ""}>{engine.text}</span>
      </div>
      {helper.info ? (
        <p className="text-[11px] text-text-3">
          Helfer {helper.info.version} · macOS {helper.info.macos} · {helper.info.chip} · Apple-Sprachmodell {helper.info.features.llm ? "verfügbar" : "nicht verfügbar"} · Systemton{" "}
          {helper.info.features.systemAudio ? "verfügbar" : "nicht verfügbar"}
        </p>
      ) : null}
      <Field label="Sprache">
        <select className="k-input" value={state.dictation.locale} onChange={(e) => void update({ locale: e.target.value })}>
          {[...new Set([state.dictation.locale, ...locales])].map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Toggle label="Diktierbefehle („Punkt“, „neuer Absatz“, …)" checked={state.dictation.commands} onChange={(v) => void update({ commands: v })} />
    </Section>
  );
}

function PermissionsSection({ state, onChanged }: { state: LocalState; onChanged: () => void }): ReactNode {
  const p = state.dictationStatus.permissions;
  const [busy, setBusy] = useState<PermissionKind | null>(null);
  const rows: Array<{ kind: PermissionKind; label: string; value: PermissionState | boolean | undefined; why: string }> = [
    { kind: "microphone", label: "Mikrofon", value: p?.microphone, why: "Diktat und Besprechungen" },
    { kind: "speech", label: "Spracherkennung", value: p?.speech, why: "Erkennung auf dem Gerät" },
    { kind: "accessibility", label: "Bedienungshilfen", value: p?.accessibility, why: "Text in andere Programme einfügen" },
    { kind: "screenRecording", label: "Bildschirmaufnahme", value: p?.screenRecording, why: "Computer-Ton bei Besprechungen (nur Audio)" },
  ];

  async function request(kind: PermissionKind): Promise<void> {
    setBusy(kind);
    try {
      await localApi().requestPermission(kind);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="Berechtigungen" hint={state.helper.running ? undefined : "Der Helfer läuft nicht – Berechtigungen können nicht geprüft werden."}>
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((r) => {
          const l = permissionLabel(r.value);
          const granted = l.tone === "ok";
          return (
            <li key={r.kind} className="flex items-center justify-between gap-3 py-2">
              <div>
                <div className="flex items-center gap-2">
                  <Dot tone={l.tone} />
                  <span>{r.label}</span>
                  <span className="text-[11px] text-text-3">{l.text}</span>
                </div>
                <div className="text-[11px] text-text-3">{r.why}</div>
              </div>
              <button className="k-btn" disabled={!state.helper.running || granted || busy !== null} onClick={() => void request(r.kind)}>
                {busy === r.kind ? "…" : granted ? "Erteilt" : "Erteilen"}
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function GeneralSection({ state, onSaved }: { state: LocalState; onSaved: (s: LocalState) => void }): ReactNode {
  async function update(patch: Partial<LocalState["general"]>): Promise<void> {
    onSaved(await localApi().setGeneral({ ...state.general, ...patch }));
  }
  return (
    <Section title="Allgemein">
      <Toggle label="Beim Anmelden starten" checked={state.general.launchAtLogin} onChange={(v) => void update({ launchAtLogin: v })} />
      <Toggle label="Benachrichtigungen vom Server empfangen" checked={state.general.notifications} onChange={(v) => void update({ notifications: v })} />
    </Section>
  );
}

function UpdateSection({ state }: { state: LocalState }): ReactNode {
  const [busy, setBusy] = useState(false);
  const u = state.update;
  return (
    <Section title="Updates" hint="Updates kommen über GitHub Releases; die Installation erfolgt beim Beenden.">
      <div className="text-[12px] text-text-2">
        Version {state.appVersion}
        {u.message ? ` · ${u.message}` : ""}
        {u.status === "downloading" && u.progress !== null ? ` (${u.progress} %)` : ""}
      </div>
      <div className="flex gap-2">
        <button
          className="k-btn"
          disabled={busy || u.status === "unsupported"}
          onClick={() => {
            setBusy(true);
            void localApi()
              .checkForUpdates()
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Prüfe…" : "Nach Updates suchen"}
        </button>
        <button className="k-btn" onClick={() => void localApi().openLogs()}>
          Protokolle anzeigen
        </button>
      </div>
    </Section>
  );
}

export function App(): ReactNode {
  const { state, error, refresh, setState } = useLocalState();
  if (error) {
    return (
      <main className="p-6">
        <Notice tone="err">{error}</Notice>
      </main>
    );
  }
  if (!state) return <main className="p-6 text-text-3">Lade…</main>;
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-6">
      <h1 className="text-[18px] font-semibold">Einstellungen</h1>
      <InstanceSection state={state} onSaved={setState} />
      <HotkeySection state={state} onSaved={setState} />
      <DictationSection state={state} onSaved={setState} />
      <PermissionsSection state={state} onChanged={() => void refresh()} />
      <GeneralSection state={state} onSaved={setState} />
      <UpdateSection state={state} />
    </main>
  );
}

# Helfer-Protokoll: Electron ↔ Swift-Helfer

> Version **1**. Der Swift-Helfer (`helper/`, Produkt `kira-helper`) ist ein
> Kommandozeilenprozess, den die Electron-Hauptseite (`src/main/helper.ts`)
> startet und über **JSON-Zeilen** (eine JSON-Objekt-Zeile je Nachricht,
> UTF-8, `\n`-terminiert) auf stdin/stdout anspricht. stderr ist nur für
> Protokollzeilen des Helfers, nie für Daten.

## Warum ein Helfer

Alles, was Apple-Schnittstellen braucht, lebt in Swift: Spracherkennung
(`Speech` / `SpeechAnalyzer`, ab macOS 26; Rückfall `SFSpeechRecognizer`
On-Device), Apple-Sprachmodell (`FoundationModels`, ab macOS 26),
Systemton (`ScreenCaptureKit`), Text in das vorderste Programm einfügen
(Accessibility / `CGEvent`), die 🌐 fn-Taste als Diktat-Auslöser
(passiver Event-Tap), Berechtigungen. Electron bleibt frei von nativen
Node-Modulen; der Helfer ist eine einzelne, signierte Binärdatei in
`Contents/Resources/helper/kira-helper`.

## Rahmen

Anfrage (Electron → Helfer):

```json
{"id": "r12", "cmd": "stt.file", "params": {"path": "/tmp/x.wav", "locale": "de-DE"}}
```

Antwort (Helfer → Electron), genau eine je `id`:

```json
{"id": "r12", "ok": true, "result": {"text": "…", "durationMs": 1830, "engine": "apple"}}
{"id": "r12", "ok": false, "error": {"code": "stt_unavailable", "message": "…"}}
```

Ereignis (Helfer → Electron, unaufgefordert, für laufende Streams):

```json
{"event": "stt.partial", "stream": "s1", "data": {"text": "…"}}
```

- `id` ist ein beliebiger String des Aufrufers; der Helfer gibt ihn
  unverändert zurück. Anfragen dürfen sich überlappen; Antworten kommen in
  beliebiger Reihenfolge.
- Fehlercodes sind stabile Kennungen in `snake_case`; `message` ist Deutsch
  und darf dem Menschen gezeigt werden.
- Unbekanntes `cmd` → `{"ok": false, "error": {"code": "unknown_command"}}`.
- Ein Parse-Fehler auf einer Zeile → Ereignis `{"event": "protocol.error", "data": {"message": "…"}}`,
  der Helfer läuft weiter.
- Der Helfer beendet sich, wenn stdin schließt oder `shutdown` kommt.

## Kommandos

### Allgemein

| `cmd` | `params` | `result` |
|---|---|---|
| `ping` | – | `{"pong": true}` |
| `info` | – | `{"protocol": 1, "version": "<Helfer-Version>", "macos": "27.0.1", "chip": "Apple M3", "features": {"stt": true, "sttStream": true, "llm": true, "systemAudio": true, "insertText": true}, "locales": ["de-DE", "en-US", …]}` |
| `shutdown` | – | `{"ok": true}`, danach Exit 0 |

`features` meldet, was auf DIESEM Mac wirklich geht (Betriebssystemversion,
Apple Intelligence aktiviert, Modell-Assets vorhanden). Electron blendet
danach Funktionen ein oder aus; es verlässt sich nie auf die Betriebssystem-
version allein.

### Berechtigungen

| `cmd` | `params` | `result` |
|---|---|---|
| `permissions.status` | – | `{"microphone": "granted" \| "denied" \| "notDetermined", "speech": "granted" \| "denied" \| "notDetermined" \| "notRequired", "accessibility": true/false, "screenRecording": true/false}` |
| `permissions.request` | `{"kind": "microphone" \| "speech" \| "accessibility" \| "screenRecording"}` | `{"status": "<wie oben>"}`; für `accessibility`/`screenRecording` öffnet der Helfer die passende Seite der Systemeinstellungen, wenn die Freigabe fehlt |

### Spracherkennung

| `cmd` | `params` | `result` / Ereignisse |
|---|---|---|
| `stt.status` | `{"locale": "de-DE"}` | `{"available": true/false, "engine": "analyzer" \| "legacy" \| null, "assets": "installed" \| "downloading" \| "missing", "reason": "…"}` |
| `stt.prepare` | `{"locale": "de-DE"}` | lädt fehlende Modell-Assets herunter (`AssetInventory`), blockiert bis fertig: `{"assets": "installed"}` |
| `stt.file` | `{"path", "locale", "contextualStrings": ["Musterfirma", …]}` | `{"text", "durationMs", "engine"}`. Liest alles, was `AVAudioFile` öffnen kann (WAV, AIFF, CAF, M4A/MP4). Electron liefert immer WAV 16 kHz Mono 16 Bit: WebM/Opus aus der WebView wird im Preload per Web Audio (`OfflineAudioContext`) dekodiert, bevor es den Hauptprozess erreicht |
| `stt.start` | `{"stream": "s1", "locale": "de-DE", "contextualStrings": [...], "source": "microphone"}` | `{"started": true}`; danach Ereignisse `stt.level` (`{"rms": 0.0…1.0}`, ~10/s), `stt.partial` (`{"text"}`, flüchtig), `stt.final` (`{"text"}`, abgeschlossener Satz/Abschnitt), `stt.ended` (`{"reason": "stopped" \| "error" \| "silence", "message"?}`) |
| `stt.stop` | `{"stream": "s1"}` | `{"stopped": true}`; der Helfer spült die Erkennung und sendet noch ausstehende `stt.final`, dann `stt.ended` |

Regeln: Audio verlässt den Helfer nie; `contextualStrings` sind die „Eigenen
Begriffe“ des Nutzers plus Anzeigename und „KIRA“. Höchstens ein Stream je
`stream`-Kennung; ein zweites `stt.start` mit derselben Kennung ersetzt den
ersten (vorher `stt.ended` mit `reason: "replaced"`).

### Apple-Sprachmodell (On-Device)

| `cmd` | `params` | `result` / Ereignisse |
|---|---|---|
| `llm.status` | – | `{"available": true/false, "reason": "appleIntelligenceNotEnabled" \| "deviceNotEligible" \| "modelNotReady" \| "unsupportedOS" \| null}` |
| `llm.generate` | `{"prompt", "instructions"?, "maxTokens"?: 512, "temperature"?: 0.4}` | `{"text"}` |
| `llm.stream` | `{"stream": "l1", "prompt", "instructions"?, "maxTokens"?}` | `{"started": true}`; Ereignisse `llm.delta` (`{"text"}` kumulativ oder Delta, Feld `mode: "cumulative"` im ersten Ereignis), `llm.done` (`{"text"}`), `llm.error` |
| `llm.cancel` | `{"stream": "l1"}` | `{"cancelled": true}` |

Das Modell hat ein kurzes Kontextfenster (4 k Token). Electron schneidet
Eingaben vorher zu; der Helfer meldet Überlänge als `context_too_long`.

### Systemton (Besprechung mit Computer-Ton)

| `cmd` | `params` | `result` / Ereignisse |
|---|---|---|
| `audio.system.start` | `{"stream": "a1", "path": "/tmp/kira-sys.wav", "excludeSelf": true}` | `{"started": true}`; schreibt den Systemton (ScreenCaptureKit, nur Audio, kein Bild) als WAV 48 kHz, Ereignis `audio.level` ~5/s |
| `audio.system.stop` | `{"stream": "a1"}` | `{"path", "durationMs", "bytes"}` |

### Text einfügen

| `cmd` | `params` | `result` |
|---|---|---|
| `text.insert` | `{"text", "mode": "auto" \| "ax" \| "paste"}` | `{"method": "ax" \| "paste"}`. `auto`: erst Accessibility (`kAXSelectedTextAttribute` des fokussierten Elements), bei Fehlschlag Einsetzen über die Zwischenablage mit ⌘V per `CGEvent`; der vorherige Inhalt der Zwischenablage wird danach wiederhergestellt |
| `text.frontmost` | – | `{"bundleId", "name"}` des vordersten Programms (für den HUD-Hinweis „Diktat in Mail“) |

### fn-Taste (🌐) als Diktat-Auslöser

| `cmd` | `params` | `result` / Ereignisse |
|---|---|---|
| `fn.watch` | `{"enabled": true \| false}` | Status wie `fn.status`; `true` legt einen passiven Event-Tap (`listenOnly`, Sitzungsebene) auf einem eigenen Thread mit eigener Run-Loop an, `false` baut ihn ab (beides idempotent). Danach Ereignisse `fn.down` (`{"secure": bool}`), `fn.chord` (`{}`), `fn.up` (`{"chord": bool}`) |
| `fn.status` | – | `{"watching": bool, "tap": "off" \| "active" \| "permission" \| "failed", "accessibility": bool, "inputMonitoring": bool, "fnUsage": 0…3 \| null}` |

- `fn.down`/`fn.up`: die fn-Taste (`kVK_Function`, auch die Globus-Taste)
  wurde gedrückt bzw. losgelassen. `fn.chord` kommt höchstens einmal je Druck,
  sobald währenddessen irgendeine andere Taste kam (auch ⇧⌃⌥⌘ oder eine
  Medien-/Helligkeitstaste, NX_SYSDEFINED); `fn.up` wiederholt das als
  `chord`. Mausklicks zählen nicht. `secure: true`: sichere Texteingabe war
  aktiv (Passwortfeld) – dann sieht der Tap keine anderen Tasten.
- **Datenschutz:** Die Ereignisse tragen nur Wahrheitswerte. Tastencodes und
  Zeichen anderer Tasten werden nie gelesen, gesendet, protokolliert oder
  gespeichert; andere Tasten werden nur angesehen, solange fn gedrückt ist.
- Schaltet macOS den Tap ab (`tapDisabledByTimeout`/`…ByUserInput`), schaltet
  der Helfer ihn sofort wieder ein und holt ein verpasstes `fn.up` nach.
- Ohne Freigabe „Bedienungshilfen“ (oder „Eingabeüberwachung“) antwortet
  `fn.watch` mit `permission_denied` (`reason: "accessibility"`) und fragt
  selbst NICHT nach – kein zweiter Systemdialog; die Hülle führt zu den
  Bedienungshilfen, die sie fürs Einsetzen ohnehin braucht.
- `fnUsage` ist die Systemeinstellung „🌐 drücken für“ (`com.apple.HIToolbox`
  → `AppleFnUsageType`): 0 Keine Aktion, 1 Eingabequelle wechseln, 2 Emoji &
  Symbole, 3 Diktat starten, `null` = nie geändert (macOS-Standard). Der
  Helfer liest sie nur und ändert sie nie.
- Was ein Druck bedeutet (Tippen, Halten, Kombination), entscheidet Electron
  (`src/main/fn-key.ts`).

## Fehlercodes

`unknown_command`, `bad_params`, `permission_denied`, `stt_unavailable`,
`stt_assets_missing`, `stt_failed`, `llm_unavailable`, `llm_failed`,
`context_too_long`, `audio_failed`, `insert_failed`, `internal`.

## Lebenszyklus in Electron

- Start beim App-Start; `info` einmal, Ergebnis wird für `capabilities` der
  Brücke genutzt (siehe `docs/native-bridge.md` im KIRA-Repo).
- Stirbt der Helfer, startet Electron ihn mit Backoff neu (1 s, 2 s, 5 s,
  max. 30 s) und beantwortet offene Anfragen mit `helper_restarted`.
- Zeitlimits je Anfrage setzt Electron (`stt.file` 60 s, `llm.generate`
  120 s, sonst 10 s).

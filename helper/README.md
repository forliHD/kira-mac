# kira-helper — Swift-Helfer für „KIRA für Mac“

Kommandozeilenprozess, den die Electron-Hülle startet und über JSON-Zeilen
auf stdin/stdout anspricht. Der verbindliche Vertrag (Kommandos, Ereignisse,
Fehlercodes) steht in `../docs/helper-protocol.md` (Protokoll 1). Alles, was
Apple-Schnittstellen braucht, lebt hier: Spracherkennung auf dem Gerät,
Apple-Sprachmodell, Systemton, Text ins vorderste Programm, Berechtigungen.

Mindestziel macOS 14 (Apple Silicon und Intel); SpeechAnalyzer und
FoundationModels ab macOS 26, darunter Rückfall bzw. saubere Nichtverfügbarkeit.

## Bauen und testen

```bash
cd helper
swift build -c release          # → .build/release/kira-helper
swift test                      # Vertrags-, Dispatcher- und Writer-Tests
```

Liegt das Repo in iCloud Drive, schlägt das Signieren des Test-Bundles mit
„resource fork, Finder information, or similar detritus not allowed“ fehl.
Dann den Build-Ordner außerhalb legen:

```bash
swift test --scratch-path ~/.cache/kira-helper-build
```

Die Toolchain ist die von Xcode (`xcrun swift …`); `Speech`, `FoundationModels`,
`ScreenCaptureKit`, `AVFoundation` und `ApplicationServices` kommen aus dem SDK.

## Manuell ausprobieren

```bash
echo '{"id":"1","cmd":"ping"}' | .build/release/kira-helper
echo '{"id":"2","cmd":"info"}' | .build/release/kira-helper
echo '{"id":"3","cmd":"stt.prepare","params":{"locale":"de-DE"}}' | .build/release/kira-helper
echo '{"id":"4","cmd":"stt.file","params":{"path":"/tmp/probe.wav","locale":"de-DE"}}' | .build/release/kira-helper
echo '{"id":"5","cmd":"llm.generate","params":{"prompt":"Hauptstadt von Deutschland?","maxTokens":40}}' | .build/release/kira-helper
```

Mehrere Zeilen in einem Rutsch gehen auch (`printf '%s\n' … | kira-helper`);
Antworten kommen in beliebiger Reihenfolge, jede mit ihrer `id`. Bei EOF auf
stdin wartet der Helfer bis zu 15 s auf laufende Anfragen, bei `shutdown` 3 s,
und beendet dann alle Streams. Protokollzeilen gehen mit Präfix
`[kira-helper]` auf stderr, nie Audiodaten oder Nutzertexte.

Ein Test-WAV lässt sich ohne Mikrofon erzeugen:

```bash
say -v Anna -o /tmp/probe.aiff "Der Termin ist am Donnerstag um vierzehn Uhr."
afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/probe.aiff /tmp/probe.wav
```

## Welche Berechtigung wofür

| Funktion | Kommandos | Freigabe |
|---|---|---|
| Spracherkennung aus Datei | `stt.file` | keine (macOS 26+, SpeechAnalyzer); unter macOS 26 „Spracherkennung“ |
| Spracherkennung vom Mikrofon | `stt.start`/`stt.stop` | „Mikrofon“; unter macOS 26 zusätzlich „Spracherkennung“ |
| Apple-Sprachmodell | `llm.*` | keine, aber Apple Intelligence muss eingeschaltet sein (macOS 26+) |
| Systemton aufnehmen | `audio.system.*` | „Bildschirmaufnahme“ (ScreenCaptureKit, es wird nur Audio verarbeitet) |
| Text einfügen | `text.insert` | „Bedienungshilfen“ (Accessibility) — auch für den ⌘V-Rückfall |
| Vorderstes Programm | `text.frontmost` | keine |

`permissions.status` zeigt den Stand, `permissions.request` fragt an;
für Bedienungshilfen und Bildschirmaufnahme öffnet der Helfer zusätzlich die
passende Seite der Systemeinstellungen. Als Kommandozeilenprozess erscheint
der Helfer dort unter seinem **verantwortlichen Prozess**: aus der Mac-App
gestartet also als „KIRA für Mac“, aus dem Terminal als das Terminal. Die
Hülle muss deshalb `NSMicrophoneUsageDescription` (und für macOS 14/15
`NSSpeechRecognitionUsageDescription`) in ihrer Info.plist tragen.

## Verhalten im Detail

- **Spracherkennung (macOS 26+):** `SpeechAnalyzer` + `SpeechTranscriber`,
  On-Device. `stt.status` meldet `assets: "installed"` erst, wenn die Sprache
  über `stt.prepare` reserviert und ihr Modell installiert ist — auch wenn
  das Modell schon für das System-Diktat vorliegt. `stt.prepare` blockiert,
  bis der Download fertig ist. `contextualStrings` gehen als
  `AnalysisContext.contextualStrings[.general]` an die Erkennung.
  Stream-Ereignisse: `stt.level` (~10/s), `stt.partial` (flüchtige Hypothese
  des aktuellen Abschnitts), `stt.final` (abgeschlossener Abschnitt),
  `stt.ended` (`stopped` / `replaced` / `error`). `stt.stop` spült zuerst,
  sendet ausstehende Finals und `stt.ended`, und antwortet danach.
- **Spracherkennung (macOS 14/15):** `SFSpeechRecognizer` mit
  `requiresOnDeviceRecognition`; `engine: "legacy"`. Ein Modell-Download ist
  hier nicht möglich — die Sprache muss unter Systemeinstellungen → Tastatur →
  Diktat vorhanden sein (`stt_assets_missing` sagt das).
- **`stt.file` liefert `engine: "apple"`** (Analyzer) bzw. `"legacy"` wie im
  Vertrag; zusätzlich `audioMs` (Länge der Datei) neben `durationMs`
  (Verarbeitungszeit).
- **Apple-Sprachmodell:** `llm.generate` und `llm.stream` öffnen je Anfrage
  eine `LanguageModelSession(instructions:)`. Stream-Deltas sind kumulativ
  (`mode: "cumulative"` im ersten `llm.delta`). `llm.cancel` bricht den Task
  ab; der Stream endet dann mit `llm.error` `{"code": "cancelled"}`.
  Überlänge → `context_too_long` (Kontextfenster ~4 k Token).
- **Systemton:** ScreenCaptureKit mit `capturesAudio`, Bild auf 2×2 Pixel bei
  1 fps ohne Abonnent. WAV 48 kHz/16 Bit, Pfad muss auf `.wav` enden.
  `excludeSelf` nimmt den eigenen Prozess sowie die Mac-App (Elternprozess,
  gleiches Bundle-Präfix) aus dem Filter; `excludeBundleIds` (optional,
  additiv) erlaubt weitere.
- **Text einfügen:** `auto` setzt erst `kAXSelectedTextAttribute` des
  fokussierten Elements und prüft über `kAXValueAttribute` nach, ob der Text
  wirklich angekommen ist; sonst Zwischenablage + ⌘V per `CGEvent`, nach 300 ms
  wird der vorherige Inhalt der Zwischenablage (alle Typen) zurückgeschrieben.

## Grenzen

- Keine Stille-Erkennung im Helfer (`stt.ended` mit `reason: "silence"` wird
  nicht gesendet); die Äußerungserkennung bleibt bei Electron.
- Der Systemton-Ausschluss der Mac-App beruht auf dem Bundle-Präfix des
  Elternprozesses — Audio aus Chromium-Hilfsprozessen mit anderem Präfix
  müsste über `excludeBundleIds` ergänzt werden.
- Unter macOS 26 gibt es kein Apple-Sprachmodell (`llm_unavailable`,
  `reason: "unsupportedOS"`) und keinen Modell-Download für die Erkennung.
- Der Helfer schreibt sofort und ungepuffert auf stdout; stirbt die Hülle,
  endet er über EOF auf stdin (SIGPIPE wird ignoriert).

## Aufbau

```
Package.swift                        Paket KiraHelper, Produkt kira-helper, macOS ≥ 14, Swift 6
Sources/KiraHelper/
  main.swift                         stdin-Schleife, eine Task je Zeile, EOF/shutdown
  Dispatcher.swift                   Kommandotabelle, Fehlerpfade, In-Flight-Zähler
  SystemInfo.swift                   Versionen, Chip
  Permissions.swift                  Mikrofon, Sprache, Bedienungshilfen, Bildschirmaufnahme
  Protocol/Envelope.swift            Request/Response/Event/HelperError, JSONValue, Params
  Protocol/Writer.swift              stdout-Actor (eine Zeile je Nachricht), stderr-Log
  Commands/General.swift             ping, info, shutdown
  Speech/SpeechService.swift         stt.*: Analyzer- und Legacy-Pfad, Stream-Register
  Speech/AudioSupport.swift          Mikrofon-Tap, Pegel, Konverter, Zeitlimit
  LLM/FoundationModelsService.swift  llm.*
  Audio/SystemAudioRecorder.swift    audio.system.*
  Text/TextInserter.swift            text.*
Tests/KiraHelperTests/               Envelope, Dispatcher, Writer (ohne Berechtigungen)
```

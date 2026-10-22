# Changelog

Alle nennenswerten Änderungen an „KIRA für Mac“. Format nach
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionen nach
[SemVer](https://semver.org/lang/de/).

## [Unreleased]

## [0.6.3] - 2026-10-22

### Sicherheit
- **Electron 44.5.1 → 44.9.3** ([#11](https://github.com/forliHD/kira-mac/pull/11)).
  Schließt die seit 44.5.1 veröffentlichten Sicherheitslücken in Chromium und
  Electron. Keine funktionalen Änderungen; der Helfer bleibt bei 0.6.2.
  Hinweis: Electron 44.9.3 bringt noch Node.js 24.22.0 mit; die Node-Fixes
  vom Oktober 2026 (24.22.1) folgen mit dem nächsten Electron-Release.

## [0.6.2] - 2026-10-21

### Behoben
- **Diktat-Start dauerte ~1,5 s** (Owner-Befund 21.10.2026: „Mikrofon wird
  vorbereitet…“ stand lange, die ersten Worte des Diktats fehlten). Gemessen
  am Helfer: Apples Sprachfilter kostet beim ersten Einschalten je Prozess
  1,0–1,2 s, und die Audio-Engine wurde für jedes Diktat neu gebaut – jedes
  Diktat zahlte den Preis erneut (`stt.start` 1,5 s mit Filter, 0,2 s ohne).
  Jetzt:
  - **Eine warme Audio-Engine je Helfer.** Nach dem Diktat bleibt sie
    eingerichtet (Tap weg, Engine angehalten, Mikrofon zu – kein
    orangefarbener Punkt); der nächste Start kostet 50–80 ms.
  - **Vorwärmen** (`audio.warm`): Die App stellt Gerät und Sprachfilter beim
    Helfer-Start und nach jeder Änderung der Diktat-Einstellungen ein, ohne
    das Mikrofon zu öffnen – auch das erste Diktat nach dem App-Start ist
    schnell.
  - **Mikrofon zuerst.** Das Mikrofon öffnet, bevor die Erkennung vorbereitet
    wird; was in diesen Millisekunden gesagt wird, wartet gepuffert und wird
    nachgeholt.
  - Die vier Prüfungen der App vor dem Start (Modell, Freigaben, vorderstes
    Programm, Wortschatz) laufen parallel statt nacheinander.

  Messung am gebauten Helfer (Apple Silicon, Sprachfilter an): `stt.start`
  vorher 1.473–1.573 ms, nachher 84–134 ms; erster Start nach `audio.warm`
  131 ms, ohne Vorwärmen einmalig 1.189 ms. Neu im Protokoll der App:
  `dictation_start` (Phasen in ms, `helper.timing` vom Helfer) und
  `dictation_session.startMs` – nur Zeiten, nie Text.

## [0.6.1] - 2026-10-21

### Behoben
- **Diktat ohne Text seit 0.6.0** (Owner-Befund 21.10.2026, Schnellfenster und
  globales Diktat: Pegel schlagen aus, nichts wird erkannt). Mit dem
  Apple-Sprachfilter liefert der Mikrofon-Tap 48 kHz mit **9 Kanälen** (das
  gefilterte Signal auf jedem Kanal); `AVAudioConverter` von 9 auf 1 Kanal gab
  leere Puffer an die Erkennung. Der Helfer mischt mehrkanalige Eingaben jetzt
  selbst auf Mono, der Konverter folgt dem Format jedes Puffers (einmal
  protokolliert: Formate und Kanalpegel, nie Audio). Reproduziert und geprüft
  mit `stt.start` am gebauten Helfer: ohne Filter Text, mit Filter vorher
  nichts, nachher Text. Der Sprachfilter bleibt Standard an; abschaltbar unter
  Einstellungen → Diktat.

## [0.6.0] - 2026-10-21

Phase 2 des Plans „Schnellfenster & Diktat“ (KIRA-Repo,
`docs/mac-app-schnellfenster-diktat-plan.md`): das Mikrofon wird wählbar
und sauberer, die Pille sagt, was passiert ist.

### Hinzugefügt
- **Apple-Sprachfilter** (Einstellungen → Diktat, Standard an): Echo-
  Unterdrückung, Rauschfilter und Pegelregelung von macOS (Voice Processing)
  für die Aufnahme des Diktats; anderer Ton wird dabei nur leicht gedämpft.
  Geht es auf einem Mac nicht (bekannt: Aggregat-Gerät, Fehler -10876), läuft
  die Aufnahme ohne weiter – die Antwort auf `stt.start` sagt, was gilt.
- **Mikrofon wählen** (Einstellungen → Diktat): Liste der Mikrofone dieses
  Macs, Standard folgt dem System. Neues Helfer-Kommando `audio.inputs`,
  `stt.start` nimmt `device`/`voiceProcessing` (Protokoll 1, additiv).
- **Pille:** Symbol des Zielprogramms neben „Diktat in Mail“ (`text.frontmost`
  liefert `icon`), Fortschrittsbalken beim Modell-Download, am Ende kurz
  **„Eingefügt · 42 Zeichen“** (900 ms) – und ein gescheitertes Einsetzen
  bleibt vier Sekunden lesbar stehen („Nicht eingefügt – der Text steht im
  Diktat-Verlauf“) statt dass die Pille sofort verschwindet.
- Protokoll: `dictation_session` nennt Sprachfilter und Gerät der Aufnahme.

### Geändert
- Die Mikrofon-Aufnahme stellt Gerät und Sprachfilter VOR dem Aufbau des
  Konverters ein (`MicrophoneCapture.prepare`): der Sprachfilter ändert das
  Eingabeformat.

### Nicht gemacht (bewusst)
- M14 (einen Analyzer für `stt.file` warmhalten) entfällt zugunsten von
  Phase 5 (Streaming ins Dashboard).

## [0.5.0] - 2026-10-21

Phase 3 des Plans „Schnellfenster & Diktat“ (KIRA-Repo,
`docs/mac-app-schnellfenster-diktat-plan.md`; Owner-Entscheid D1/D2 = Ja):
das Schnellfenster wird vom Spotlight-Feld zum Gespräch.

### Hinzugefügt
- **Zwei Stufen.** Leer ist das Schnellfenster eine Leiste: Eingabe mit der
  K-Kachel, Vorschläge, Fußleiste – die Höhe folgt dem Inhalt wie bisher. Mit
  der ersten Nachricht nimmt es EINMAL die Gesprächshöhe an (Standard 60 % der
  Arbeitsfläche, mindestens 420 pt), der Verlauf liegt oben und scrollt innen,
  die Eingabe bleibt unten. Danach springt nichts mehr; der untere Rand lässt
  sich ziehen, die gezogene Höhe wird je Bildschirm gemerkt (Einstellung).
  Die Diktate-Ansicht (⌘2) nutzt dieselbe Höhe. Die Oberkante bleibt bei
  10 %, oder das Fenster sitzt mittig (Einstellung „Lage“).
- **Einstellungen → Schnellfenster** (neuer Bereich): Lage, Höhe im Gespräch
  (40–90 %), gezogene Höhe merken (mit „Vergessen“), Textgröße (Klein/
  Normal/Groß), Senden mit ↩ oder ⌘↩ (dann ↩ = Zeile, „Im Hauptfenster“ auf
  ⌘⇧↩), nach dem Senden offen lassen oder schließen (die fertige Antwort kommt
  als Mitteilung, Klick öffnet das Fenster), Gespräch fortsetzen oder neu nach
  10/30/60 Minuten Ruhe (Standard 30), Vorschläge anzeigen, Mikrofon-Knopf.
  Das Zahnrad in der Fußleiste öffnet den Bereich.
- **Diktate-Ansicht:** Tagesgruppen („Heute“, „Gestern“, Datum) mit Uhrzeit je
  Karte, **Erneut einsetzen** (das Fenster geht zu, der Text landet im
  Programm, das davor vorn war – Bedienungshilfen nötig), „Verlauf leeren“ in
  der Fußleiste, schlanke Suche statt der Chat-Eingabe.

### Geändert
- **Keine Kopfzeile mehr.** Marke und Verbindungsstatus sind ein Punkt auf der
  K-Kachel in der Eingabe (Tooltip erklärt), die Fußleiste trägt Chat | Diktate,
  die Tastenhinweise, rechts „Neuer Chat“ und „Im Hauptfenster“ (im Gespräch),
  den kurzen Instanznamen („kira-dev“ statt des ganzen Hosts) und das Zahnrad.
  Die Fußleiste ist der Zieh-Bereich des Fensters. Die leere Leiste ist damit
  rund ein Viertel niedriger als in 0.4.0.
- Ohne Verbindung steht der Hinweis zum Apple-Modell unter der Eingabe statt
  der Vorschläge; „Antworten landen im Chat-Verlauf“ ist der Tooltip des Status.
- Der Stufenwechsel baut die Eingabe nicht neu auf (CSS-Reihenfolge statt
  neuer Elemente) – Fokus und Schreibmarke bleiben.

### Nicht gemacht (bewusst)
- Eigenes Erscheinungsbild (Hell/Dunkel) für das Schnellfenster: das Glas
  zeichnet macOS nach dem System; eine eigene Wahl würde nur den Text umfärben.
- Programm-Symbole an den Diktate-Karten: kommen mit der Pille in Phase 2.

## [0.4.0] - 2026-10-21

Phase 1 des Plans „Schnellfenster & Diktat“ (KIRA-Repo,
`docs/mac-app-schnellfenster-diktat-plan.md`): die Erkennung wird ehrlich –
genauer, mit Wortschatz, offline-fähig und messbar.

### Hinzugefügt
- **Nachkorrektur gegen den Wortschatz** (Einstellungen → Diktat → „Eigene
  Begriffe nachkorrigieren“, Standard an). Der Helfer gibt KIRA, deinen Namen
  und die eigenen Begriffe zwar als `contextualStrings` an Apple, der
  `SpeechTranscriber` (macOS 26+) wertet sie aber nicht aus (Apple-Forum
  801877, Apple_Agent 09/2025). Deshalb korrigiert die Hülle jedes fertige
  Stück selbst: lautgleiche Wörter („Lukas“ → Lucas, „Lugas“ → Lucas) und
  kleine Tippfehler („Tira“ → KIRA, „Weeber“ → Weber) werden zum Begriff,
  Groß/Klein wird angeglichen („kira“ → KIRA). Vorsichtig: häufige deutsche
  Wörter bleiben, Wörter aus dem macOS-Wörterbuch werden bei bloßer
  Buchstabenähnlichkeit nie ersetzt (neues Helfer-Kommando `text.knownWords`
  über `NSSpellChecker`, „Kita“ bleibt Kita), zwei gleich gute Begriffe heben
  sich auf, Zahlen bleiben. Gilt für das globale Diktat, das Schnellfenster
  und das Dashboard-Diktat über die Hülle. Das Protokoll zählt nur
  Ersetzungen, nie Text (`src/main/dictation-correct.ts`,
  `tests/dictation-correct.test.ts`).
- **Diktat-Test** (Einstellungen → Diktat): drei feste Texte – „Begriffe“
  (aus KIRA, deinem Namen und deinen Begriffen gebaut), „Zahlen und Daten“,
  „Freier Text“ (~1 min). Lies vor, „Auswerten“, und die App zeigt die
  Wortfehlerrate (WER) mit Ersetzungen, zu viel, fehlt, beim Begriffe-Test
  „Begriffe n von m“, dazu Dauer und die Einstellungen des Laufs (Sprache,
  Engine, Nachkorrektur, Befehle, Version). Die letzten fünf Ergebnisse bleiben
  in der Konfiguration – nur Zahlen und Einstellungen, nie der Text; der Ton
  verlässt den Mac nicht (`src/shared/wer.ts`, `src/shared/dictation-test.ts`,
  `src/main/dictation-test.ts`).
- **Wortschatz bleibt auf dem Mac**: Der zuletzt vom Server geholte Wortschatz
  wird wie der Diktat-Verlauf verschlüsselt gespeichert (`vocabulary.bin`,
  `safeStorage`, nur gepackt) und gilt offline oder ohne Sitzung weiter;
  erneuert wird weiter stündlich. Einstellungen → Diktat zeigt Anzahl und
  Stand.
- **Messwerte** im Protokoll, nie Text: je Diktat `dictation_session` (Ziel,
  Programm, Sprache, Engine, Dauer, Spüldauer nach dem Stopp, fertige Stücke,
  Zeichen, Ersetzungen, Fehler), je Dashboard-Äußerung `transcribe_done`
  (Dauer, Audiolänge, Verhältnis, Zeichen, Ersetzungen).

### Geändert
- **Erkennung ohne `.fastResults`.** Der Stream lief mit
  `[.volatileResults, .fastResults]`; Apple dokumentiert `fastResults` als
  „biases the transcriber towards responsiveness, yielding faster but also
  less accurate results“. Die flüchtigen Ergebnisse (`volatileResults`) speisen
  weiter die Vorschau in der Pille; die Finals, die eingesetzt werden, sind
  jetzt die genaue Variante. Fällt die Verzögerung auf, misst der Diktat-Test
  sie (`flushMs` im Protokoll).
- Zeichensetzung auf dem Rückfall-Pfad (`SFSpeechRecognizer`, macOS 14/15):
  `addsPunctuation` war nicht gesetzt, Text kam ohne Punkt und Komma.
- Das Ende eines Diktats wartet auf laufende Wörterbuch-Fragen, damit der
  letzte Satz weder im Verlauf noch im Diktat-Test fehlt.
- Helfer-Protokoll (additiv, Version 1): `text.knownWords`
  (`docs/helper-protocol.md`).

## [0.3.9] - 2026-10-21

### Hinzugefügt
- GitHub Actions auf `xcode-27` (Apple Silicon, macOS-SDK 27): Abhängigkeiten,
  Typprüfung, Lint, Tests, Swift-Helfer inklusive der Fehlerzuordnung beim
  Diktat-Download, Produktionspaket. Ein Push auf `main` legt den
  GitHub-Release `v<Version>` an (DMG, ZIP, `latest-mac.yml`), wenn es ihn
  noch nicht gibt. Mit Developer-ID-Zertifikat und App-Store-Connect-Schlüssel
  wird signiert und notarisiert. Ist das Zertifikat gesetzt, die Signatur
  oder die Notarisierung aber misslungen, wird nichts veröffentlicht.

### Behoben
- **Diktat-Modell fehlt, und der Download tat nichts.** Der Helfer konnte das
  Apple-Modell laden (`stt.prepare`), die Hülle hat ihn aber nie darum gebeten:
  weder beim Start, noch beim Diktat, noch aus den Einstellungen. „Erneut
  prüfen“ hat nur denselben Stand noch einmal gelesen. Zusätzlich hat der
  Helfer den Stand an einer anderen Modell-Konfiguration geprüft als die
  Erkennung selbst und ein schon vorhandenes System-Modell nicht als
  installiert erkannt, solange die Sprache nicht reserviert war.
- Fehlt das Modell und dieser Mac kann es laden (macOS 26, Apple-Chip), startet
  der Download jetzt von selbst, beim ersten Diktat und über **Modell laden**
  in den Einstellungen. Fortschritt in der Karte und in der Diktat-Pille.
  Scheitert er, steht die Ursache dabei (keine Verbindung zu Apple, Zugriff
  verweigert, Sprache nicht unterstützt, kein Apple-Chip, macOS zu alt,
  Geräteverwaltung). Danach läuft das Diktat auf dem Gerät – auch ohne
  Verbindung zum KIRA-Server.
- Diagnose in Einstellungen → Diktat und im Protokoll (`dictation_model`,
  `stt_status`): macOS, Architektur, Chip, Sprache, Modellzustand, Mikrofon,
  Spracherkennung.

## [0.3.8] - 2026-10-02

### Geändert
- Die Aktivitätszeile kennt das neue Server-Werkzeug `mail_send_to_me` (KIRA
  3.302.0, „Schick mir das per Mail“): „Schickt dir eine Mail“ statt des
  allgemeinen „Arbeitet im Postfach“. Entwurfs-Links (`/mail?draft=…`) aus
  KIRAs Antworten öffnen sich wie alle Instanz-Pfade im Hauptfenster.

## [0.3.7] - 2026-10-02

### Geändert
- **Schnellfenster sitzt höher und wird größer** (Owner-Wunsch: „mehr vom
  Bildschirm nutzen“). Oberkante bei 10 % statt 18 % der Arbeitsfläche, das
  Fenster wächst bis kurz vor den unteren Rand (4 %, mindestens 28 pt) statt
  höchstens 75 % der Höhe – auf dem Owner-Mac 859 statt 749 pt. Eine Höhe aus
  einem anderen Bildschirm wird beim Öffnen auf den Platz des aktuellen
  begrenzt. Lage und Höhe rechnet jetzt `src/main/windows/quick-geometry.ts`
  (ohne Electron, `tests/quick-geometry.test.ts`).
- Die Aktivitätszeile kennt die neuen Mail-Werkzeuge des Servers (KIRA
  3.301.0): „Markiert E-Mails“, „Verschiebt E-Mails“, „Schaut in die
  Mail-Ordner“, „Liest einen Mail-Anhang“.

## [0.3.6] - 2026-10-02

### Behoben
- **Hauptfenster verschwand beim ersten ⌥ Leertaste** (Owner-Befund: KIRA
  frisch gestartet, Hauptfenster vorn, Schnellfenster geöffnet → das
  Hauptfenster war weg). Das erste Schnellfenster – ebenso das erste
  Diktat-HUD – rief `setVisibleOnAllWorkspaces(…, { visibleOnFullScreen: true })`.
  Ohne `skipTransformProcessType` verwandelt Electron dabei die ganze App in ein
  Hintergrundprogramm: kein Dock-Symbol, kein ⌘-Tab, keine Menüleiste, die App
  verliert den Fokus und ihr Fenster rutscht hinter die anderen. Beide Fenster
  sind Panels und schweben auch ohne diese Umwandlung über Vollbild-Apps
  (geprüft über TextEdit im Vollbild). Regressionstest
  `tests/panel-windows.test.ts`, Ende-zu-Ende-Prüfung
  `scripts/e2e/process-type.mjs` (fragt macOS per `lsappinfo` nach der
  Prozessart).

## [0.3.5] - 2026-10-02

### Geändert
- Schnellfenster-Kopf aufgeräumt: der Hinweis „Schnellfenster ⌥␣“ neben dem
  Umschalter Chat | Diktate entfällt, die Verbindungsanzeige hat wieder Platz.
- Antwortet die Instanz mit einer Webseite statt mit Daten (unterwegs vor der
  Cloudflare-Anmeldung), sagt das Protokoll das jetzt verständlich statt
  „Unexpected token '<'“.

## [0.3.4] - 2026-10-02

### Behoben
- **„Jetzt neu starten“ startete nicht neu** – KIRA verschwand nur, das
  Menüleisten-Symbol blieb. `quitAndInstall` schließt zuerst alle Fenster, das
  Hauptfenster blendete sich aber nur aus (Menüleisten-App), weil die App noch
  nicht wusste, dass sie beendet wird. Der Updater meldet das jetzt vorher
  (`setBeforeInstall`).

### Geändert
- **Updates sind sichtbar:** Ist ein Update geladen, bekommt das
  Menüleisten-Symbol einen Punkt, ganz oben im Menüleisten-Menü und im
  KIRA-Menü steht „Update installieren (Neustart)“, das Schnellfenster zeigt
  „KIRA x.y.z ist bereit – Jetzt neu starten“, und die Mitteilung hat einen
  Knopf „Neu starten“. Während des Ladens zeigt das Menüleisten-Menü den
  Fortschritt. „Nach Updates suchen“ stößt einen laufenden Download nicht mehr
  neu an, sondern zeigt den Stand – und fragt „Jetzt neu starten / Später“,
  sobald das Update bereit ist.

## [0.3.3] - 2026-10-02

### Hinzugefügt
- **Diktate im Schnellfenster** (Owner-Wunsch: der Verlauf war unter
  Einstellungen zu versteckt): Umschalter **Chat | Diktate** im Kopf (⌘1/⌘2).
  Die Diktate-Ansicht zeigt die letzten Diktate als Karten (Zeit, Programm,
  „nicht eingesetzt“) mit **Kopieren**, **In den Chat** (Text wird zur Frage
  an KIRA) und Löschen; das Eingabefeld sucht dort über alle Diktate, ↑/↓
  wählt, ↩ kopiert, ⌘↩ übernimmt in den Chat. Neue Diktate erscheinen sofort
  oben. Die Menüleiste „Diktat-Verlauf…“ öffnet direkt diese Ansicht.

### Behoben
- „Nachgedacht“ im Schnellfenster zählte die Statuszeile „Denke nach…“ des
  Servers als ersten Denkschritt mit.

## [0.3.2] - 2026-10-02

### Hinzugefügt
- **Diktat-Verlauf** (Owner-Wunsch): Jedes globale Diktat landet zusätzlich im
  Verlauf – auch wenn das Einsetzen im fremden Programm scheitert. Einstellungen
  → Diktat → Verlauf zeigt die letzten Diktate mit „Kopieren“ und Löschen, die
  Menüleiste hat „Letztes Diktat kopieren“ und „Diktat-Verlauf…“. Bleibt nur auf
  diesem Mac, verschlüsselt über den Schlüsselbund (`safeStorage`), höchstens
  100 Diktate und 30 Tage; nichts davon geht an den Server oder ins Protokoll.
- **Schnellfenster zeigt die Denkschritte**: eingeklappt wie im Dashboard
  („Nachgedacht · 2 Schritte“ mit Vorschau), auf Klick aufgeklappt.

### Geändert
- **Schnellfenster: KIRA-Avatar mit „K“** auf Markenblau wie im Dashboard-Chat
  statt einer lila Fläche.
- **Einsetzen in Web- und Electron-Felder** (Chrome, Teams, Slack, VS Code …)
  geht jetzt immer über die Zwischenablage. Dort meldete das Einsetzen über die
  Bedienungshilfen Erfolg, obwohl nicht der ganze Text ankam. In anderen
  Programmen prüft der Helfer nach (Wert bzw. Zeichenzahl).

### Behoben
- **Nur Punkte statt Text:** Antworten der Erkennung, die nur aus Satzzeichen
  bestehen („..“), werden nicht mehr eingesetzt. Ein gesprochenes „Punkt“
  bleibt ein Diktierbefehl.
- **Schnellfenster scrollt mit:** Nach dem Senden springt der Verlauf
  zuverlässig ans Ende, auch wenn das Fenster schon seine volle Höhe hat.

## [0.3.1] - 2026-10-02

### Behoben
- **Langes Diktat auf der fn-Taste brach ab** (meist nach 15–20 Sekunden):
  Das Diktat setzt jeden fertigen Satz sofort ein – in vielen Programmen per
  ⌘V. Die fn-Erkennung sah dieses eigene ⌘V als „fn + andere Taste“ und
  verwarf das gehaltene Diktat. Der Helfer kennzeichnet seine eigenen
  Tastaturereignisse jetzt (`eventSourceUserData`), die fn-Erkennung
  übergeht sie. Das Diktat läuft, solange fn gehalten wird.

### Geändert
- **Menüleisten-Symbol mit „K“:** Die Sprechblase oben in der Menüleiste
  zeigt jetzt das K des App-Symbols (verbunden und getrennt), statt zweier
  Zeilen – ebenso die kleinen App-Kacheln im Schnellfenster, in der
  Einrichtung und unter Einstellungen → Über.

## [0.3.0] - 2026-10-02

### Hinzugefügt
- **Cloudflare-Access-Anmeldung im Browser** (braucht KIRA 3.300.0): Über die
  externe Adresse hing die Access-Anmeldung im App-Fenster an derselben
  Passkey-Abfrage wie früher Microsoft. Leitet Access das Hauptfenster auf
  seine Anmeldung um, zeigt die App jetzt „Im Browser anmelden“ (sie öffnet den
  Browser nie ungefragt). Die Anmeldung läuft in Safari, KIRA reicht das
  Access-Token über `de.kira.mac:/auth/callback` zurück – verschlüsselt für
  einen Einmal-Schlüssel, den nur diese App kennt (X25519 → HKDF → AES-GCM,
  `src/main/access-login.ts`). Die App setzt es als ihr Access-Cookie und lädt
  die Instanz; nach einem Neustart bleibt sie angemeldet, bis die
  Access-Sitzung abläuft. „Im App-Fenster anmelden“ bleibt als Ausweg (etwa
  für einen E-Mail-Code). Ist in Access das „Binding Cookie“ an, erkennt die
  App die Schleife und erklärt sie, statt endlos umzuleiten.
- Ende-zu-Ende-Prüfung `scripts/e2e/access-login.mjs` mit nachgebautem
  Access-Rand vor dem echten KIRA-Endpunkt (`scripts/e2e/access-edge.py`).

### Behoben
- **Access-Anmeldung im Fenster wurde jede Minute zurückgesetzt:** Die
  Verbindungsprüfung lud die Instanz neu, solange das Dashboard nicht geladen
  war – also auch mitten in der Anmeldung. Sie wartet jetzt, solange eine
  Anmeldung läuft.
- **Geschlossenes Hauptfenster kam nach spätestens einer Minute zurück:** Die
  Verbindungsprüfung holte es bei jedem Durchlauf nach vorn. Jetzt nur noch
  beim ersten Verbinden und auf Wunsch (Erneut versuchen, neue Adresse).

## [0.2.0] - 2026-10-02

### Hinzugefügt
- **Anmeldung über Microsoft & Co. im Browser** (braucht KIRA 3.299.0): Die
  Microsoft-Anmeldung hing im App-Fenster bei „Face, fingerprint, PIN or
  security key“. Electron erreicht keine Passkeys aus dem iCloud-Schlüsselbund,
  vom Handy oder von einem Sicherheitsschlüssel. „Mit … anmelden“ öffnet jetzt
  den Standard-Browser (RFC 8252 + PKCE, Fähigkeit `browser-login`,
  `signInWithBrowser()`). Dort klappen Passkeys, Touch ID und der
  Passwort-Manager; danach kommt die Anmeldung über das neue URL-Schema
  `de.kira.mac:/auth/callback` zurück. Die App löst den Einmalcode mit ihrem
  Geheimnis ein und meldet das Dashboard an. Ein abgefangener Code ist ohne
  dieses Geheimnis wertlos.
- **Neues App-Symbol mit „K“:** die Glas-Sprechblase bleibt, darin schwebt ein
  K aus tiefblauem Glas.
- **Globales Diktat auf der 🌐 fn-Taste** (wählbar unter Einstellungen →
  Tastenkürzel → Diktat: „fn-Taste“ oder „Tastenkombination“; Standard bleibt
  ⌃⌥D). Kurz tippen schaltet das Diktat an und aus, gedrückt halten heißt
  sprechen – loslassen setzt den Text ein. fn zusammen mit einer anderen Taste
  (fn + ←, fn + ⌫, F-Tasten …) bleibt, was es war; hatte das Halten schon ein
  Diktat gestartet, wird es ohne Einsetzen verworfen. Im Passwortfeld startet
  fn nichts. Der Swift-Helfer hört dafür mit einem passiven Event-Tap auf einem
  eigenen Thread (`fn.watch`, `fn.status`) und meldet nur „fn gedrückt“,
  „andere Taste dazu“, „fn losgelassen“ – nie Tasten oder Zeichen. Braucht die
  Freigabe „Bedienungshilfen“ (wie das Einsetzen); fehlt sie, zeigen die
  Einstellungen das mit Knopf. Ist macOS bei der fn-Taste auf „Emoji &
  Symbole“, „Eingabequelle wechseln“ o. ä. gestellt, weisen die Einstellungen
  darauf hin und öffnen die Tastatur-Einstellungen (KIRA ändert sie nicht).
- In der Einrichtung steht unter jedem Kürzel „Ändern“ – öffnet die
  Einstellungen direkt bei den Tastenkürzeln.

### Geändert
- Das Protokoll hält beim Laden eines Updates nur noch Statuswechsel fest
  (vorher eine Zeile je Sekunde Fortschritt).

### Behoben
- Ein Diktat, das noch startete, ließ sich nicht sauber beenden: Kam der Stopp
  vor dem Start der Erkennung, lief das Mikrofon danach trotzdem weiter.
- **Mitteilungen ohne Anmeldung:** Abgemeldet fragte die App den Server alle
  10–20 Sekunden an und bat das Dashboard jedes Mal zweimal um eine Sitzung.
  Jetzt wartet der Stream, bis die Anmeldung da ist, und versucht es sonst nur
  alle fünf Minuten. Ein stehender Stream übersteht außerdem jede
  Token-Erneuerung, statt neu aufgebaut zu werden.

## [0.1.1] - 2026-10-02

### Geändert
- **Globales Diktat jetzt auf ⌃⌥D** (vorher ⌥⌘D): ⌥⌘D ist unter macOS das
  Kürzel „Dock ein-/ausblenden“. Gespeichertes ⌥⌘D wird automatisch
  umgezogen; die Aufnahme in den Einstellungen lehnt ⌥⌘D, ⌃⌘D (Nachschlagen)
  und ⌃⌘F (Vollbild) mit Begründung ab.

### Behoben
- Beim Start meldete macOS „Operation not permitted“ für das Anmeldeobjekt,
  obwohl „Beim Anmelden starten“ aus war – die App setzt es nur noch bei einer
  Änderung.

## [0.1.0] - 2026-10-02

Erste Fassung. Signiert mit Developer ID, von Apple beglaubigt, Gatekeeper
„Notarized Developer ID“.

### Hinzugefügt
- **Schnellfenster** (⌥ Leertaste): nativer Mini-Chat aus echtem Liquid Glass
  (nicht aktivierendes Panel wie Spotlight). Antworten kommen über
  `POST /api/chat/stream` vom KIRA-Server und landen im Chat-Verlauf; deutsche
  Aktivitätszeilen und Werkzeug-Chips, sicheres Markdown, ⌘↩ öffnet den Chat
  im Hauptfenster, ⌘N beginnt neu. Ohne Verbindung antwortet das
  Apple-Sprachmodell lokal (gekennzeichnet, nicht gespeichert).
- **Globales Diktat** (⌥⌘D) über die Glas-Pille unten: Spracherkennung auf dem
  Apple-Chip (SpeechAnalyzer), Diktierbefehle wie im Dashboard, Text ins
  vorderste Programm; im Schnellfenster ins Eingabefeld.
- **Brücke zum Dashboard** nach `native-bridge.md` Version 1: Diktat im
  Dashboard über den Apple-Chip (abschaltbar), Tokens, Mitteilungen,
  Navigation; eingelassene Titelleiste ab KIRA 3.298.0 (`inset-titlebar`).
- **Mitteilungen** über den Geräte-Stream `GET /api/push/stream`; kein Banner,
  wenn Hauptfenster oder Schnellfenster den Chat gerade zeigen.
- **Liquid Glass** über `electron-liquid-glass` (NSGlassEffectView, macOS 26+),
  sonst Vibrancy; Einrichtung, Einstellungen, Diktat-Pille und Offline-Seite
  im neuen Design (hell und dunkel, reduzierte Transparenz berücksichtigt).
- App-Symbol im macOS-26-Stil, Menüleiste mit drei Zuständen, DMG mit
  Hintergrund, Auto-Update über GitHub Releases, Links im System-Browser,
  Downloads nach `~/Downloads`, deutsches Menü.
- Swift-Helfer `kira-helper` (Spracherkennung, Apple-Sprachmodell, Systemton,
  Text einfügen, Berechtigungen) nach `helper-protocol.md` Version 1.
- Härtung: Electron-Fuses (kein `--inspect`, kein `ELECTRON_RUN_AS_NODE`,
  keine `NODE_OPTIONS`, asar-Integrität, verschlüsselte Cookies), lokale Seiten
  können nicht wegnavigieren, `file:`-Navigation aus dem Dashboard gesperrt.
- Tests: Vitest (Vertrag, SSE, Helfer, Diktat, Schnellfenster, Markdown,
  Einstellungen) und `swift test`; Ende-zu-Ende-Prüfung `scripts/e2e/run.mjs`
  gegen eine laufende Instanz (13 Prüfungen).

### Behoben (vor dem ersten Release gefunden)
- Der Mitteilungs-Stream wurde von der minütlichen Verbindungsprüfung jedes
  Mal neu aufgebaut; Mitteilungen genau in der Lücke konnten verloren gehen.

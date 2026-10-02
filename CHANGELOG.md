# Changelog

Alle nennenswerten Änderungen an „KIRA für Mac“. Format nach
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionen nach
[SemVer](https://semver.org/lang/de/).

## [Unreleased]

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

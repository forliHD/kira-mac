# Changelog

Alle nennenswerten Änderungen an „KIRA für Mac“. Format nach
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionen nach
[SemVer](https://semver.org/lang/de/).

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

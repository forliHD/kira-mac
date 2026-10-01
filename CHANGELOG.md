# Changelog

Alle nennenswerten Änderungen an „KIRA für Mac“. Format nach
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionen nach
[SemVer](https://semver.org/lang/de/).

## [0.1.0] - unreleased

### Hinzugefügt
- Grundgerüst der Electron-Hülle (electron-vite, TypeScript strict, React 19 +
  Tailwind 4 für die lokalen Seiten).
- `window.KiraNative` nach Vertrag `native-bridge.md` Version 1 (`bridge`,
  `app`, `capabilities`, `getInfo`, `setSession`, `notify`, `openExternal`,
  `sttStatus`, `transcribe`) und die Ereignisse `navigate`, `notification`,
  `connectivity`, `session-request`, `share` als `CustomEvent("kira:native")`.
- Instanz-Wahl intern/extern über `GET /api/health` (intern bevorzugt),
  Onboarding, Einstellungen, Offline-Seite.
- Benachrichtigungen über `GET /api/push/stream` (SSE, Geräte-Anmeldung
  `kira-app://<uuid>`, Reconnect mit Backoff, 60-s-Watchdog, In-App statt
  Banner bei fokussiertem Fenster).
- Swift-Helfer-Anbindung nach `helper-protocol.md` (JSON-Zeilen, Zeitlimits,
  Neustart mit Backoff, `helper_restarted`).
- Globales Diktat mit HUD (Hotkey, Apple-Spracherkennung, Diktierbefehle aus
  dem Dashboard, `text.insert`), Schnellfenster, Menüleiste, deutsches Menü,
  Downloads nach `~/Downloads`, Link-Politik, Auto-Update über GitHub Releases.
- Lokale Release-Skripte (`scripts/release.sh`, `build-helper.sh`,
  `sync-shared.sh`, `make-icon.sh`) und Vitest-Suite (Instanz, SSE, Helfer,
  Vertrag, Diktat).

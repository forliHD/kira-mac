# KIRA für Mac

Native macOS-Hülle um das KIRA-Dashboard. Die App lädt das Dashboard **vom
KIRA-Server** (nie gebündelt) und ergänzt, was ein Browser nicht kann:
Benachrichtigungen ohne Web Push, Spracherkennung auf dem Apple-Chip, globales
Diktat in andere Programme, Menüleiste, Schnellfenster per Tastenkürzel,
Links im System-Browser, Auto-Update. Alles Zustandsbehaftete bleibt auf dem
Server; ohne Server zeigt die App einen ehrlichen Offline-Zustand und das
lokale Diktat.

## Architektur in einem Absatz

Electron (TypeScript, `electron-vite`) bildet die Hülle: der Hauptprozess
(`src/main/`) verwaltet Fenster, Menüleiste, Tastenkürzel, die Konfiguration,
den Benachrichtigungs-Stream (SSE zu `/api/push/stream`) und den Auto-Updater.
Ein Preload (`src/preload/index.ts`) stellt dem Dashboard `window.KiraNative`
bereit – exakt nach dem Vertrag `docs/native-bridge.md` im KIRA-Repo, und nur
auf Seiten der konfigurierten Instanz-Origin. Alles, was Apple-Schnittstellen
braucht (Spracherkennung, Apple-Sprachmodell, Systemton, Text einfügen,
Berechtigungen), lebt im Swift-Helfer `helper/` (`kira-helper`), den Electron
als Kindprozess startet und über JSON-Zeilen anspricht
(`docs/helper-protocol.md`). Die lokalen Seiten (Einrichtung, Einstellungen,
Diktat-HUD, Offline) sind kleine React-Seiten mit den Nocturne-Token des
Dashboards.

## Voraussetzungen

- macOS 14 oder neuer; Spracherkennung auf dem Apple-Chip und das Apple-Sprachmodell
  brauchen macOS 26 auf Apple Silicon (darunter: Diktat im Dashboard über den Server,
  globales Diktat aus). Gebaut wird für Apple Silicon; x64 ist vorbereitet, aber nicht gebaut
- Xcode (für den Swift-Helfer) mit Kommandozeilenwerkzeugen
- Node 22, npm 10
- Für Releases: Developer-ID-Zertifikat im Schlüsselbund, Apple-ID mit
  App-spezifischem Passwort, GitHub CLI (`gh`)
- Optional: `librsvg` (`brew install librsvg`) für `scripts/make-icon.sh`

## Entwicklung

```bash
npm install
npm run dev          # electron-vite: Hauptprozess, Preloads und lokale Seiten mit Hot-Reload
npm run typecheck    # tsc für Hauptprozess/Preload/Tests und lokale Seiten
npm test             # vitest (Instanz-Politik, SSE-Parser, Helfer-Rahmen, Vertrag, Diktat)
npm run lint         # eslint
npm run build        # Produktions-Bündel nach out/ (ohne Paketierung)
```

Beim ersten Start fragt die App die Instanz-Adresse(n) ab: intern (Heimnetz,
z. B. `http://192.168.178.166`) und optional extern (Cloudflare Access). Im
Heimnetz wird die interne Adresse bevorzugt; die Wahl läuft über
`GET /api/health`. Konfiguration: `~/Library/Application Support/KIRA/config.json`
(keine Tokens darin – die hält die App nur im Speicher).

### Helfer bauen

```bash
npm run helper:build   # = bash scripts/build-helper.sh → helper/.build/release/kira-helper
```

Ohne gebauten Helfer startet die App trotzdem; Diktat, Apple-Sprachmodell und
Systemton melden sich dann als nicht verfügbar – mit Grund in den
Einstellungen.

### Gemeinsame Dateien mit dem Dashboard

`src/shared/dictationText.js` ist eine 1:1-Kopie von
`kira/dashboard/src/lib/dictationText.js` (Diktierbefehle müssen auf beiden
Seiten gleich sein). Nachziehen mit:

```bash
scripts/sync-shared.sh /pfad/zum/kira-checkout
```

Die Nocturne-Token (`src/renderer/styles/tokens.css`) stammen aus
`kira/dashboard/src/index.css`.

## Release (lokal, kein CI)

Verteilung als DMG + ZIP über GitHub Releases (`forliHD/kira-mac`);
`electron-updater` liest `latest-mac.yml` von dort. Signatur mit Developer ID,
Hardened Runtime und Notarisierung.

```bash
export APPLE_ID="…@…"                       # Apple-ID des Entwicklerkontos
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-…"  # appleid.apple.com → App-spezifische Passwörter
export APPLE_TEAM_ID="XXXXXXXXXX"
# optional, wenn mehrere Zertifikate im Schlüsselbund liegen:
export CSC_NAME="Developer ID Application: Name (XXXXXXXXXX)"

# 1. Version in package.json erhöhen, CHANGELOG.md und RELEASE_NOTES.md füllen, committen
# 2. App-Symbol (einmalig oder bei Änderung):
scripts/make-icon.sh /pfad/zum/kira/dashboard/public/icon-source.svg
# 3. Release:
npm run release      # = scripts/release.sh
```

`scripts/release.sh` prüft den sauberen Arbeitsbaum, baut den Helfer,
führt Typprüfung und Tests aus, baut mit `electron-builder --mac`
(signiert + notarisiert), setzt den Tag `v<version>` und legt den
GitHub-Release mit `*.dmg`, `*.zip` und `latest-mac.yml` an. Jeder Schritt
bricht bei Fehlern ab. `npm run dist` baut nur das Paket, ohne zu
veröffentlichen.

## Berechtigungen

Die App fragt macOS nur, wenn eine Funktion sie braucht; Einstellungen →
Berechtigungen zeigt den Stand und bietet Knöpfe zum Erteilen.

| Berechtigung | Wofür |
|---|---|
| Mikrofon | Diktat im Dashboard (WebView) und globales Diktat (Helfer) |
| Spracherkennung | Erkennung auf dem Gerät (`Speech`-Framework) |
| Bedienungshilfen | Text in das vorderste Programm einsetzen |
| Bildschirmaufnahme | Computer-Ton bei Besprechungen (nur Audio, ScreenCaptureKit) |

Die Texte dazu stehen in `electron-builder.yml` (`extendInfo`), die
Entitlements in `build/entitlements.mac.plist`.

## Verzeichnisstruktur

```
src/main/            Hauptprozess
  index.ts           Lebenszyklus, Verdrahtung
  config.ts          config.json (atomar), instance.ts  URL-Politik + Health-Wahl
  session.ts         alle Serveranfragen (Bearer/Cookie), session-request-Fluss
  notifications.ts   SSE-Client /api/push/stream, sse.ts  reiner Parser
  helper.ts          Swift-Helfer (Spawn, JSON-Zeilen, Zeitlimits, Neustart)
  dictation.ts       globales Diktat (Hotkey → stt.start → Befehle → text.insert)
  bridge.ts          IPC hinter window.KiraNative, local-ipc.ts  IPC der lokalen Seiten
  hotkeys.ts tray.ts updater.ts links.ts downloads.ts menu.ts log.ts paths.ts
  windows/           main, quick, hud, settings, onboarding, common
src/preload/         index.ts (Instanz: KiraNative), api.ts (reine Fabrik), audio.ts (WAV), local.ts (KiraLocal)
src/renderer/        onboarding, settings, hud, offline (React 19 + Tailwind 4), styles/tokens.css
src/shared/          bridge.ts (Vertragstypen), helper-types.ts, capabilities.ts, dictationText.js (Kopie)
helper/              Swift-Helfer (eigenes Paket, siehe docs/helper-protocol.md)
tests/               vitest
scripts/             build-helper.sh, release.sh, sync-shared.sh, make-icon.sh
build/               entitlements.mac.plist, icon.icns
resources/tray/      Menüleisten-Symbol (Template)
docs/                helper-protocol.md
```

## Verträge

- **Dashboard ↔ Hülle:** `docs/native-bridge.md` im KIRA-Repo (Version 1).
  `tests/bridge.test.ts` prüft den Preload Feld für Feld dagegen.
- **Electron ↔ Swift-Helfer:** `docs/helper-protocol.md` (Version 1).
  `tests/helper.test.ts` prüft den Rahmen mit einem gefälschten Prozess.

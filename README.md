# KIRA für Mac

Native macOS-Hülle um das KIRA-Dashboard. Die App lädt das Dashboard **vom
KIRA-Server** (nie gebündelt) und ergänzt, was ein Browser nicht kann:
Benachrichtigungen ohne Web Push, Spracherkennung auf dem Apple-Chip, globales
Diktat in andere Programme, Menüleiste, Schnellfenster per Tastenkürzel,
Links im System-Browser, Auto-Update. Alles Zustandsbehaftete bleibt auf dem
Server; ohne Server zeigt die App einen ehrlichen Offline-Zustand und das
lokale Diktat.

## Was die App kann

- **Schnellfenster** (⌥ Leertaste): schwebender Mini-Chat aus echtem Liquid
  Glass (Panel wie Spotlight, aktiviert die App nicht). Der Hauptprozess führt
  den Zug über `POST /api/chat/stream` (`src/main/quick-chat.ts`), die Seite
  `src/renderer/quick` zeigt nur Zustand. ⌘↩ öffnet den Chat im Hauptfenster,
  ⌘N beginnt neu. Ohne Verbindung antwortet das Apple-Sprachmodell lokal
  (gekennzeichnet, nicht gespeichert).
- **Globales Diktat** (⌃⌥D) in jedes Programm über die Glas-Pille unten
  (HUD); im Schnellfenster landet es im Eingabefeld. Statt der Kombination
  geht auch die **🌐 fn-Taste**: kurz tippen schaltet das Diktat an und aus,
  gedrückt halten heißt sprechen – loslassen setzt den Text ein; fn zusammen
  mit einer anderen Taste (fn + ←, fn + ⌫ …) bleibt, was es war
  (`src/main/fn-key.ts`, Event-Tap im Helfer). Damit macOS beim Tippen nicht
  zusätzlich „Emoji & Symbole“ o. ä. öffnet, in den Tastatur-Einstellungen
  bei der fn-Taste „Keine Aktion“ wählen – die Einstellungen weisen darauf hin.
- **Tastenkürzel ändern:** Einstellungen → Tastenkürzel (⌘, im Menü KIRA, oder
  „Ändern“ neben den Kürzeln in der Einrichtung): Kürzel per Tastendruck
  aufnehmen, fürs Diktat „fn-Taste“ oder „Tastenkombination“ wählen.
- **Anmeldung über Microsoft & Co. im Browser** (ab KIRA 3.299.0, Fähigkeit
  `browser-login`): Im App-Fenster funktionieren Passkeys nicht, deshalb öffnet
  „Mit … anmelden“ den Standard-Browser (RFC 8252 + PKCE,
  `src/main/browser-login.ts`). Danach kommt die Anmeldung über
  `de.kira.mac:/auth/callback` in die App zurück.
- **Diktat im Dashboard** über den Apple-Chip (Brücke `transcribe`).
- **Mitteilungen** über den Geräte-Stream des Servers; kein Banner, wenn das
  Hauptfenster oder das Schnellfenster den Chat gerade zeigt.
- **Hauptfenster** mit eingelassener Ampel in der Kopfleiste des Dashboards
  (ab KIRA 3.298.0, Fähigkeit `inset-titlebar`), Menüleiste mit drei
  Zuständen, Auto-Update.
- **Liquid Glass** über `electron-liquid-glass` (NSGlassEffectView, macOS 26+),
  sonst Vibrancy – eine Stelle: `src/main/glass.ts`.

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
- Für `scripts/make-icon.sh` (nur bei Änderungen an `build/icon-src/`): Google Chrome (rendert die SVG-Quellen), `sips`, `iconutil`, `tiffutil` sind an Bord

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
(keine Tokens darin – die hält die App nur im Speicher). Die Anmeldung bei
Cloudflare Access läuft im Standard-Browser (ab KIRA 3.300.0); die App bekommt
danach die Access-Sitzung als Cookie, wie es die Anmeldung im Fenster täte.

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

## Testen

```bash
npm run typecheck && npm run lint && npm test     # Vitest: Vertrag, SSE, Helfer, Diktat, Schnellfenster, …
cd helper && swift test --scratch-path ~/.cache/kira-helper-build
```

**Ende zu Ende** gegen eine laufende KIRA-Instanz (lokal mit
`KIRA_ENV=development` + `KIRA_DEV_BYPASS=true`, dann braucht es kein
Passwort):

```bash
npm run build
node scripts/e2e/run.mjs --instance http://localhost:8420 --out /tmp/kira-e2e
```

Das Skript startet die unverpackte App mit eigenem Profil
(`KIRA_MAC_PROFILE`), Testschnittstelle (`KIRA_MAC_TEST_HOOKS=1`) und
DevTools-Protokoll, prüft Brücke, eingelassene Titelleiste, Mitteilungs-Stream,
eine echte Frage im Schnellfenster, „Im Hauptfenster öffnen“, HUD,
Einstellungen und Offline-Seite und legt Bildschirmfotos des Webinhalts ab
(natives Glas ist darauf nicht zu sehen). Beide Umgebungsvariablen wirken nur
unverpackt; die ausgelieferte App sperrt `--inspect` per Electron-Fuse.

**Anmeldung im Browser** Ende zu Ende: `scripts/e2e/browser-login.mjs` bringt
einen Test-Anbieter (OIDC) mit; die Instanz läuft dafür OHNE Entwicklerzugang
und zeigt auf ihn (Befehl im Kopf des Skripts). Geprüft wird Login-Seite →
App öffnet `/api/auth/app/login` → Browser-Teil → Übergabe an
`de.kira.mac:/auth/callback` → Einlösen → Dashboard angemeldet, Gerätesitzung
„macOS · KIRA für Mac“, kein zweites Einlösen.

**Prozessart** ohne Server: `node scripts/e2e/process-type.mjs` öffnet
Schnellfenster und Diktat-HUD und prüft per `lsappinfo`, dass KIRA ein normales
Programm mit Dock-Symbol bleibt (`--hold N` lässt beide Fenster N Sekunden offen,
etwa zum Ansehen über einer Vollbild-App).

## Release (lokal, kein CI)

Die Build-Ausgabe liegt in `~/Library/Caches/kira-mac/dist` (änderbar über
`KIRA_MAC_DIST`), nicht im Repo: Liegt das Repo in iCloud Drive, hängt das
System Finder-Metadaten an die Dateien, und `codesign` lehnt sie ab. Zusätzlich
bereinigt `scripts/after-pack.cjs` die gepackte App vor dem Signieren.

Einmalig einrichten:

1. **Developer-ID-Zertifikat**: Xcode → Einstellungen → Apple Accounts → Team →
   „Manage Certificates…“ → „+“ → „Developer ID Application“ (liegt danach im
   Schlüsselbund; `security find-identity -v -p codesigning` zeigt es).
2. **Notarisierung**: App-spezifisches Passwort unter account.apple.com →
   „Anmeldung und Sicherheit“ → „App-spezifische Passwörter“ anlegen, dann im
   Terminal einmal speichern (fragt das Passwort ab, nichts landet in Dateien):

   ```bash
   xcrun notarytool store-credentials kira-notary --apple-id <deine Apple-ID> --team-id GRPK3Y82ST
   ```

   `scripts/release.sh` nutzt dieses Profil (`APPLE_KEYCHAIN_PROFILE`, Standard
   `kira-notary`); alternativ `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` und
   `APPLE_TEAM_ID` in der Umgebung.


Verteilung als DMG + ZIP über GitHub Releases (`forliHD/kira-mac`, öffentlich,
damit `electron-updater` die `latest-mac.yml` ohne Token lesen kann). Signatur
mit Developer ID, Hardened Runtime, Notarisierung, angeheftetem Ticket und
Electron-Fuses (kein `ELECTRON_RUN_AS_NODE`, keine `NODE_OPTIONS`, kein
`--inspect`, App-Code nur aus dem geprüften asar, verschlüsselte Cookies).

```bash
# 1. Version in package.json erhöhen, CHANGELOG.md und RELEASE_NOTES.md füllen, committen
# 2. App-Symbol, nur bei Änderung der Quelle unter build/icon-src/:
scripts/make-icon.sh
# 3. Release (baut Helfer + App, signiert, beglaubigt, Tag, GitHub-Release):
npm run release      # = scripts/release.sh
```

`scripts/release.sh` prüft Zertifikat, Notarisierungs-Profil und den sauberen
Arbeitsbaum, baut den Helfer, führt Typprüfung und Tests aus, baut mit
`electron-builder --mac` (signiert + notarisiert, Ausgabe außerhalb von iCloud),
setzt den Tag `v<version>` und legt den GitHub-Release mit `*.dmg`, `*.zip` und
`latest-mac.yml` an. Jeder Schritt bricht bei Fehlern ab. `npm run dist` baut
nur das Paket, ohne zu veröffentlichen. Prüfen eines fertigen Pakets:

```bash
spctl -a -vv -t exec ~/Library/Caches/kira-mac/dist/mac-arm64/KIRA.app   # → accepted, Notarized Developer ID
xcrun stapler validate ~/Library/Caches/kira-mac/dist/mac-arm64/KIRA.app
```

## Berechtigungen

Die App fragt macOS nur, wenn eine Funktion sie braucht; Einstellungen →
Berechtigungen zeigt den Stand und bietet Knöpfe zum Erteilen.

| Berechtigung | Wofür |
|---|---|
| Mikrofon | Diktat im Dashboard (WebView) und globales Diktat (Helfer) |
| Spracherkennung | Erkennung auf dem Gerät (`Speech`-Framework) |
| Bedienungshilfen | Text in das vorderste Programm einsetzen; die 🌐 fn-Taste als Diktat-Auslöser erkennen |
| Bildschirmaufnahme | Computer-Ton bei Besprechungen (nur Audio, ScreenCaptureKit) |

Die Texte dazu stehen in `electron-builder.yml` (`extendInfo`), die
Entitlements in `build/entitlements.mac.plist`.

## Verzeichnisstruktur

```
src/main/            Hauptprozess
  index.ts           Lebenszyklus, Verdrahtung
  quick-chat.ts      Gespräch des Schnellfensters (Server-Stream, Apple-Modell offline)
  glass.ts           Liquid Glass mit Rückfall auf Vibrancy
  config.ts          config.json (atomar), instance.ts  URL-Politik + Health-Wahl
  session.ts         alle Serveranfragen (Bearer/Cookie), session-request-Fluss
  notifications.ts   SSE-Client /api/push/stream, sse.ts  reiner Parser
  helper.ts          Swift-Helfer (Spawn, JSON-Zeilen, Zeitlimits, Neustart)
  dictation.ts       globales Diktat (Hotkey → stt.start → Befehle → text.insert)
  fn-key.ts          🌐 fn-Taste: Tippen/Halten/Kombination → Diktat (Zustandsmaschine)
  bridge.ts          IPC hinter window.KiraNative, local-ipc.ts  IPC der lokalen Seiten
  hotkeys.ts tray.ts updater.ts links.ts downloads.ts menu.ts log.ts paths.ts
  windows/           main, quick, hud, settings, onboarding, common
src/preload/         index.ts (Instanz: KiraNative), api.ts (reine Fabrik), audio.ts (WAV), local.ts (KiraLocal)
src/renderer/        onboarding, settings, hud, offline, quick (React 19 + Tailwind 4), lib/, styles/
src/shared/          bridge.ts (Vertragstypen), helper-types.ts, capabilities.ts, hotkey.ts (fn-Taste), dictationText.js (Kopie)
helper/              Swift-Helfer (eigenes Paket, siehe docs/helper-protocol.md)
tests/               vitest
scripts/             build-helper.sh, release.sh, sync-shared.sh, make-icon.sh, after-pack.cjs, e2e/
build/               entitlements.mac.plist, icon.icns
resources/tray/      Menüleisten-Symbol (Template)
docs/                helper-protocol.md
```

## Verträge

- **Dashboard ↔ Hülle:** `docs/native-bridge.md` im KIRA-Repo (Version 1).
  `tests/bridge.test.ts` prüft den Preload Feld für Feld dagegen.
- **Electron ↔ Swift-Helfer:** `docs/helper-protocol.md` (Version 1).
  `tests/helper.test.ts` prüft den Rahmen mit einem gefälschten Prozess.

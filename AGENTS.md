# AGENTS.md — KIRA für Mac

> Kontext für KI-Agenten. Menschen lesen `README.md`.

## Was das ist

Electron-Hülle (TypeScript strict, `electron-vite`) um das KIRA-Dashboard
plus Swift-Helfer `helper/` für Apple-Schnittstellen. Owner: Lucas (einziger
Entwickler). Kein App Store, kein CI: alles baut lokal auf dem Mac des Owners
(macOS 27, Apple Silicon, Xcode 27, Node 22). Verteilung als DMG/ZIP über
GitHub Releases `forliHD/kira-mac`, Auto-Update per `electron-updater`.

Sprache: alles für Menschen (UI, Menüs, Fehler, Doku, Commit-Texte) auf
Deutsch; Bezeichner, Dateinamen, Konfig-Schlüssel auf Englisch. Kommentare
auf Deutsch, wenn sie das WARUM erklären.

## Zwei Verträge, beide verbindlich

1. **Dashboard ↔ Hülle:** `docs/native-bridge.md` im KIRA-Repo
   (`kira/docs/native-bridge.md`), Version 1. Umsetzung: `src/preload/index.ts`
   + `src/preload/api.ts` (das Objekt), `src/main/bridge.ts` (IPC),
   `src/shared/bridge.ts` (Typen/Konstanten). `tests/bridge.test.ts` ist der
   Vertragstest – Änderungen zuerst im Vertrag, dann hier, dann im Dashboard.
2. **Electron ↔ Swift-Helfer:** `docs/helper-protocol.md`, Version 1.
   Umsetzung: `src/main/helper.ts`, Typen in `src/shared/helper-types.ts`.
   `helper/` wird von einem anderen Agenten/Paket gepflegt – nicht anfassen,
   nur das Protokoll nutzen.

## Befehle

```bash
npm install
npm run dev          # electron-vite dev
npm run typecheck    # tsc (tsconfig.node.json + tsconfig.web.json)
npm test             # vitest run
npm run lint         # eslint (flat config, typescript-eslint)
npm run build        # out/ (Pflicht vor npm run dist)
npm run dist         # electron-builder --mac --publish never (braucht Signatur)
npm run helper:build # swift build -c release in helper/
npm run release      # scripts/release.sh (Tag + GitHub-Release)
```

Vor jedem Abschluss: `npm run typecheck && npm test && npm run lint && npm run build` grün.

## Konventionen

- **TypeScript strict**, kein `any`. An IPC-Grenzen kommt `unknown` an und wird
  zur Laufzeit geprüft (siehe `bridge.ts::asTokens`, `local-ipc.ts`).
- **Jede Serveranfrage aus dem Hauptprozess geht durch `session.ts`**
  (`session.fetch`/`fetchJson`/`rawFetch`): eine Stelle für Bearer, Cookies
  (`credentials: "include"` für Cloudflare Access) und deutsche Fehler.
- **Die Hülle ruft NIE `/api/auth/refresh`.** Refresh-Tokens rotieren; das
  Dashboard ist alleiniger Eigentümer. Frisches Token: `session.requestFreshSession()`
  → Ereignis `session-request` ans Dashboard → `setSession` (10 s Limit).
- **Keine Tokens, keine Nachrichtentexte, kein Diktat-Text im Protokoll.**
  `log.ts::scrub` entfernt verdächtige Schlüssel – das ist die zweite Sicherung,
  nicht die erste. Protokolliere Zähler, Status, Dauer.
- **Fehler für Menschen auf Deutsch mit Ursache** („Instanz nicht erreichbar: …“).
  Netzwerkfehler → `instance.ts::describeNetworkError`.
- **Preload nur auf Instanz-Origin.** Fenster, die die Instanz laden, bekommen
  `instanceWebPreferences()`; der Preload prüft zusätzlich Protokoll + Origin
  (Bootstrap per `sendSync`, Hauptprozess bestätigt). Lokale Seiten bekommen
  `localWebPreferences()` mit `window.KiraLocal`.
- **Keine nativen Node-Module.** Alles Apple-spezifische lebt im Helfer.
- **Minimale Abhängigkeiten.** Laufzeit nur `electron-log`, `electron-updater`.
  Keine `electron-store` (eigenes `config.ts` mit atomarem Schreiben).
- **Testbare Module importieren kein `electron`**: `sse.ts`, `instance.ts`,
  `helper.ts`, `dictation.ts`, `preload/api.ts`, `shared/*`. Abhängigkeiten
  (fetch, spawn, HUD, Logger) werden injiziert.

## Fallen

- **Sandboxed Preloads dürfen keine gemeinsamen Chunks haben.** Ihr `require`
  kennt nur `electron`, `events`, `timers`, `url`. Deshalb sind die IPC-Kanäle
  getrennt (`shared/ipc.ts` für den Instanz-Preload, `shared/ipc-local.ts` für
  den lokalen) – ein Modul, das beide importieren, landet als
  `out/preload/chunks/*.js` und bricht zur Laufzeit. Nach `npm run build` darf
  es kein `out/preload/chunks/` geben.
- **CSP der lokalen Seiten ohne `unsafe-inline` für Skripte.** Darum kein
  `@vitejs/plugin-react` (sein Fast-Refresh-Preamble ist ein Inline-Skript);
  esbuild übernimmt den automatischen JSX-Runtime. Kein React-HMR in `dev`,
  nur Neuladen – gewollt.
- **`blob:`-Fenster**: `setWindowOpenHandler` kann den Preload nicht
  „abschalten“ (Kindfenster erben die WebPreferences). Der Preload erkennt
  `location.protocol !== http(s)` und stellt nichts bereit. Nicht als Lücke
  „fixen“.
- **`will-navigate` nur VON einer Instanz-Seite weg blockieren.** Von der
  Cloudflare-Access-Anmeldung (oder einem Identitätsanbieter) aus muss das
  Fenster weiter navigieren dürfen, sonst bricht die Anmeldung (`links.ts`).
- **Benachrichtigungen bei fokussiertem Hauptfenster** gehen als Ereignis
  `notification` ins Dashboard, NICHT als Banner (Regel aus
  `dashboard/public/sw.js`). Nicht beides senden.
- **SSE-Watchdog 60 s**: der Server pingt alle 25 s als Kommentarzeile; der
  Parser meldet Kommentare (`onComment`), damit der Watchdog sie zählt.
- **`mac.binaries` in `electron-builder.yml`** ist relativ zu `Contents/` der
  gebauten App (`Resources/helper/kira-helper`), nicht zum Repo.
- **`npm run dist` nicht in Agenten-Läufen**: braucht Developer-ID-Zertifikat
  und Notarisierungs-Umgebung; ohne diese scheitert es oder erzeugt ein
  unsigniertes Paket, das Gatekeeper ablehnt.
- **`electron-updater` nur gepackt**: in `dev` meldet `updater.ts` den Status
  `unsupported`. Nicht „reparieren“.
- **`src/shared/dictationText.js` nie von Hand ändern** – Kopie aus dem
  Dashboard, `scripts/sync-shared.sh` nachziehen, dann `tests/dictation.test.ts`.
- **`EventEmitter<Events>`-Generics** (Node 22-Typen) werden in `helper.ts`,
  `dictation.ts`, `notifications.ts` genutzt; `@types/node` nicht unter 22
  absenken.

- **Liquid Glass nur über `src/main/glass.ts`**: `electron-liquid-glass`
  legt ein NSGlassEffectView hinter den Webinhalt (macOS 26+), sonst Vibrancy.
  Fenster dafür `transparent: true`, KEINE `vibrancy`-Option gleichzeitig,
  Seitenhintergrund transparent. Die Tönung hängt am Erscheinungsbild –
  Schnellfenster und HUD werden bei `nativeTheme.updated` neu gebaut. Electron
  selbst hat keine Glas-API (PR #50415 nie gemergt).
- **Signieren**: Repo liegt in iCloud → Finder-Metadaten brechen `codesign`
  („resource fork … detritus“). Darum `scripts/after-pack.cjs` (`xattr -cr`)
  und Ausgabe nach `~/Library/Caches/kira-mac/dist`. `electronLanguages` hält
  nur de/en – sonst signiert electron-builder über 200 Sprachordner einzeln
  (15 min). Pfad im `binaries`-Eintrag relativ zum Bündel: `Contents/…`.
- **Electron-Fuses** in der gepackten App: kein `--inspect`, kein
  `ELECTRON_RUN_AS_NODE`. Ende-zu-Ende-Tests laufen deshalb unverpackt
  (`scripts/e2e/run.mjs`, Umgebung `KIRA_MAC_PROFILE` + `KIRA_MAC_TEST_HOOKS=1`,
  beides nur unverpackt wirksam).
- **Schnellfenster** = lokale Seite + `src/main/quick-chat.ts` (Server-Zug über
  `POST /api/chat/stream`, Frames wie im Dashboard). Ohne Verbindung antwortet
  das Apple-Modell (`llm.stream`), gekennzeichnet `local`, nichts geht an den
  Server. Diktat mit Ziel `quick` setzt in das Eingabefeld ein (kein HUD, keine
  Bedienungshilfen nötig).
- **Eingelassene Titelleiste** des Hauptfensters nur, wenn
  `config.lastServerVersion` ≥ 3.298.0 (`serverSupportsInsetTitlebar`); die
  Fähigkeit `inset-titlebar` geht nur an Seiten DIESES Fensters
  (`capabilities(sender)`).

## Offene Punkte (Stand 0.1.0)

- `share`-Ereignis (Teilen aus Finder/Dock) braucht eine Share-Extension – noch
  nicht umgesetzt, der Ereignistyp ist im Vertrag vorgesehen.
- Systemton (`audio.system.*`) ist im Helfer fertig, aber in der Hülle noch
  ohne Oberfläche (Besprechung mit Computer-Ton läuft im Dashboard weiter über
  die Bildschirmfreigabe).
- Apple-Sprachmodell: im Schnellfenster ohne Verbindung genutzt; Textwerkzeuge
  auf Markierung (Umformulieren, Kürzen) fehlen noch.
- Textfeld-Einfügen (`text.insert`) und Systemton sind nur kompiliert geprüft –
  live braucht es die Freigaben Bedienungshilfen bzw. Bildschirmaufnahme.

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
   Umsetzung: `src/main/helper.ts`, Typen in `src/shared/helper-types.ts`,
   Swift unter `helper/`. Jede Protokolländerung zuerst in
   `docs/helper-protocol.md`, dann Swift (`swift test --scratch-path
   ~/.cache/kira-helper-build` – nie im iCloud-Ordner bauen) und TypeScript.

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
  Ausnahme Hauptfenster: Die Umleitung ZUR Access-Anmeldung fängt
  `windows/main.ts` ab (Anmeldung im Browser, siehe unten).
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
- **`setVisibleOnAllWorkspaces` nur mit `skipTransformProcessType: true`**
  (Live-Befund 02.10.2026, 0.3.6): ohne verwandelt Electron die ganze App in ein
  Hintergrundprogramm (UIElement – kein Dock, kein ⌘-Tab, Fokus weg); beim
  ersten ⌥ Leertaste nach dem Start verschwand so das Hauptfenster. Panels
  (`type: "panel"`) schweben auch ohne das über Vollbild-Apps. Prüfung:
  `tests/panel-windows.test.ts`, `scripts/e2e/process-type.mjs` (`lsappinfo`).
- **Eingelassene Titelleiste** des Hauptfensters nur, wenn
  `config.lastServerVersion` ≥ 3.298.0 (`serverSupportsInsetTitlebar`); die
  Fähigkeit `inset-titlebar` geht nur an Seiten DIESES Fensters
  (`capabilities(sender)`).

- **SSO nie im App-Fenster** (seit 0.2.0, KIRA ≥ 3.299.0): Electron erreicht
  keine Passkeys (iCloud-Schlüsselbund, Handy, Sicherheitsschlüssel) – Microsofts
  Passkey-Abfrage hängt dort endlos; `app.configureWebAuthn` kennt nur
  gerätegebundene Touch-ID-Schlüssel. Die Login-Seite ruft
  `signInWithBrowser()` (Fähigkeit `browser-login`), `src/main/browser-login.ts`
  öffnet `/api/auth/app/login` im Standard-Browser (RFC 8252 + PKCE), der Server
  schickt einen Einmalcode an `de.kira.mac:/auth/callback` (URL-Schema in
  `electron-builder.yml` → `protocols`, `open-url` in `index.ts`, auch vor
  `ready`), die App löst ihn mit dem Verifier bei `/api/auth/app/token` ein und
  lädt `/auth/callback#…`. Der Verifier verlässt den Hauptprozess nie, Tokens
  nie ins Protokoll. Prüfung: `tests/browser-login.test.ts`,
  `scripts/e2e/browser-login.mjs` (Test-Anbieter eingebaut).
- **Cloudflare Access nie im App-Fenster** (seit 0.3.0, KIRA ≥ 3.300.0):
  `windows/main.ts` fängt `will-redirect`/`will-navigate` des Hauptdokuments zu
  `*.cloudflareaccess.com` ab, `index.ts::onAccessRedirect` zeigt die lokale
  Seite `offline?mode=access` („Im Browser anmelden“, `AccessLogin.tsx`). Klick
  → `src/main/access-login.ts` öffnet `/api/auth/app/access?state&key` (key =
  Einmal-X25519-Schlüssel); KIRA prüft das Access-Token und schickt es
  verschlüsselt an `de.kira.mac:/auth/callback?access=…` (beide Anmeldungen
  teilen die Adresse, `state` entscheidet: `accessLogin.owns(url)`). Die App
  setzt `CF_Authorization` (HttpOnly, Ablauf = `exp`) und lädt neu. Format und
  fester Prüfvektor müssen zu `kira/core/utils/app_handover.py` passen
  (`tests/access-login.test.ts`). Kein Einmalcode möglich: ohne Cookie hielte
  Access das Einlösen auf. „Im App-Fenster anmelden“ erlaubt Access im Fenster
  für 15 min. Prüfung: `scripts/e2e/access-login.mjs` (+ `--binding`).
- **Minuten-Prüfung lädt nicht in eine laufende Anmeldung** (`accessHold` in
  `connectInner`) und holt das Hauptfenster nur beim ersten Verbinden oder bei
  `force` nach vorn – vorher setzte sie die Access-Anmeldung im Fenster jede
  Minute zurück und zeigte ein geschlossenes Fenster wieder an.
- **Diktat auf der 🌐 fn-Taste** (`hotkeys.dictation = "Fn"`, seit 0.2.0): kein
  `globalShortcut`, sondern ein Event-Tap im Helfer (`fn.watch`, Ereignisse
  `fn.down`/`fn.chord`/`fn.up` NUR als Wahrheitswerte – nie Tastencodes, nie
  Zeichen) und der Zustandsautomat `src/main/fn-key.ts` (< 300 ms tippen =
  an/aus, halten = sprechen, fn + andere Taste = nichts). Braucht dieselbe
  Freigabe Bedienungshilfen wie das Einfügen; bei sicherer Eingabe
  (Passwortfeld) startet fn nie. macOS' eigene 🌐-Aktion (`AppleFnUsageType`
  in `com.apple.HIToolbox`) nur LESEN und in den Einstellungen darauf
  hinweisen – nie selbst umstellen.
- **Eigene Tastaturereignisse sind gekennzeichnet** (seit 0.3.1): Was der
  Helfer selbst sendet (⌘V in `TextInserter`), trägt
  `SyntheticKeyEvents.marker` in `eventSourceUserData`; der fn-Tap übergeht es.
  Sonst wertete er das ⌘V beim Einsetzen eines Satzes als „fn + andere Taste“
  und verwarf ein gehaltenes Diktat nach 15–20 s. Jedes neue künstliche
  Tastaturereignis des Helfers MUSS `SyntheticKeyEvents.mark` bekommen.
- **Diktat-Verlauf** (seit 0.3.2, `src/main/dictation-history.ts`): jedes
  globale Diktat (Ereignis `session` aus `GlobalDictation`, Text VOR dem
  Einsetzen gesammelt) → Verlauf, höchstens 100 Einträge/30 Tage. Verschlüsselt
  über `safeStorage` NUR in der gepackten App und erst beim ersten Gebrauch
  (`history`-Getter): unsignierte Entwickler-Electrons teilen sich den
  Schlüsselbund-Eintrag „Electron Safe Storage“ – dort blockierte der
  Schlüsselbund-Dialog den Hauptprozess beim Start. Ohne Verschlüsselung nur im
  Speicher, nie Klartext auf der Platte. UI: Schnellfenster-Ansicht „Diktate“
  (⌘2, `quick/Dictations.tsx`; Suche im Eingabefeld, Menüleiste
  „Diktat-Verlauf…“ öffnet sie per Ereignis `quick-view`), dazu Einstellungen →
  Diktat → Verlauf und Menüleiste „Letztes Diktat kopieren“. Änderungen am
  Verlauf meldet `notifyHistoryChanged()` an Einstellungen, Schnellfenster UND
  Menüleiste (das Schnellfenster hängt nicht an `broadcast`). Beide Ansichten
  teilen sich `.q-thread`/`.q-log` – die Höhenmessung beobachtet genau diese
  Elemente, also nie durch andere ersetzen.
- **Einsetzen in Web-Inhalte über die Zwischenablage** (seit 0.3.2,
  `TextInserter.isInWebContent`): AXSelectedText in Chromium/Electron/WebKit
  meldet Erfolg, ohne verlässlich einzufügen (Live: nur Punkte). Reine
  Satzzeichen-Finals verwirft `dictation.ts::isPunctuationOnly`. Das Protokoll
  nennt Methode und Zeichenzahl (`dictation_inserted`), nie den Text.
- **Schnellfenster-Denkschritte** (seit 0.3.2): Frames `thinking` und
  `inner_thought` → `QuickMessage.reasoning` (`appendReasoning`, höchstens 40
  Schritte), eingeklappt als „Nachgedacht“ (`Reasoning` in quick/App.tsx).
- **Update-Neustart braucht das Beenden-Signal vorher** (seit 0.3.4):
  `autoUpdater.quitAndInstall()` schließt erst alle Fenster und beendet dann –
  das Hauptfenster blendet sich beim Schließen aber nur aus, solange
  `quitting` falsch ist (`before-quit` kommt zu spät). `updater.installNow()`
  ruft deshalb vorher den Haken aus `setBeforeInstall` (setzt `quitting`).
  Sichtbarkeit eines fertigen Updates: Menüleisten-Symbol „update“ (Punkt),
  Menüeintrag oben, App-Menü, Schnellfenster-Hinweis (`q-update`, Ereignis
  `update` geht auch ans Schnellfenster), Mitteilung mit Knopf.
- **Mitteilungs-Stream ohne Anmeldung wartet** (`LOGIN_WAIT_MS`, 5 min) auf
  `loginChanged()` statt im Takt anzufragen; `reconnectNow()` (Minuten-Prüfung)
  weckt ihn nicht, ein stehender Stream übersteht Token-Erneuerungen.

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

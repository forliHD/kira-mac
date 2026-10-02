## KIRA für Mac 0.1.0

Die erste Fassung der nativen Mac-App für KIRA. Sie lädt das Dashboard deiner
KIRA-Instanz und ergänzt, was ein Browser nicht kann.

**Neu**

- **Schnellfenster** (⌥ Leertaste): ein schwebender Mini-Chat aus echtem Liquid
  Glass wie Spotlight. Die Antwort kommt von deinem KIRA-Server und landet im
  Chat-Verlauf; ⌘↩ öffnet den Chat im Hauptfenster. Ohne Verbindung antwortet
  das Apple-Sprachmodell lokal auf dem Mac (gekennzeichnet, nicht gespeichert).
- **Diktat in jedes Programm** (⌥⌘D): Die Spracherkennung läuft auf dem
  Apple-Chip, der Ton verlässt den Mac nicht. Die Glas-Pille unten zeigt Pegel,
  Zwischentext und das Zielprogramm. Im Schnellfenster landet das Diktat im
  Eingabefeld.
- **Diktat im Dashboard** ebenfalls auf dem Apple-Chip, mit Rückfall auf den
  Server.
- **Mitteilungen** direkt vom KIRA-Server als macOS-Mitteilung, ohne Browser;
  kein doppeltes Banner, wenn du die Antwort gerade siehst.
- **Natives Fenster**: Ampel in der Kopfleiste des Dashboards (ab KIRA
  3.298.0), Menüleiste mit Status, Links im System-Browser, Downloads in
  „Downloads“, Auto-Update.

**Voraussetzungen**

- macOS 14 oder neuer. Spracherkennung und Apple-Modell auf dem Gerät brauchen
  macOS 26 auf Apple Silicon und eingeschaltete Apple Intelligence.
- KIRA ab 3.297.0 für Mitteilungen und Diktat im Dashboard, ab 3.298.0 für die
  eingelassene Titelleiste. Ältere Instanzen laufen im Kompatibilitätsmodus.

**Installation**: DMG öffnen, KIRA in „Programme“ ziehen, starten, Adresse
deiner Instanz eingeben, im Fenster anmelden. Die App ist signiert und von
Apple beglaubigt.

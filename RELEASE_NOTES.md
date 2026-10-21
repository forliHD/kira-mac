## KIRA für Mac 0.6.1

**Behoben**

- Diktat erkannte seit 0.6.0 nichts mehr (Pegel ja, Text nein): Der
  Apple-Sprachfilter liefert das Mikrofon mit 9 Kanälen, die Umwandlung auf
  Mono gab leere Puffer weiter. Jetzt mischt der Helfer selbst auf Mono.

Die App aktualisiert sich selbst; mit „Jetzt neu starten“ wird das Update
sofort installiert.

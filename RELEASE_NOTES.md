## KIRA für Mac 0.6.5

**Sicherheit**

- Werkzeuge, mit denen die App gebaut wird, auf Stände ohne bekannte
  Sicherheitslücken gehoben. In der App selbst ändert sich nichts.

## KIRA für Mac 0.6.4

**Behoben**

- Schnellfenster: Die Tastenhinweise in der Fußleiste („esc schließen“ auf
  „Diktate“) werden nicht mehr mitten im Wort abgeschnitten und liegen nie
  mehr hinter den Knöpfen. Wird es eng, bleiben nur die Tasten stehen.

## KIRA für Mac 0.6.3

**Sicherheit**

- Electron auf 44.9.3 aktualisiert (vorher 44.5.1). Das schließt die
  inzwischen bekannten Sicherheitslücken in Chromium und Electron. Sonst
  ändert sich nichts.

## KIRA für Mac 0.6.2

**Behoben**

- Der Diktat-Start dauerte rund 1,5 Sekunden („Mikrofon wird vorbereitet…“),
  die ersten Worte fehlten: Apples Sprachfilter kostet beim Einschalten gut
  eine Sekunde, und die Audio-Engine wurde für jedes Diktat neu gebaut. Jetzt
  bleibt eine Engine je Helfer warm (Mikrofon dabei zu), die App wärmt sie
  beim Start und nach Änderungen der Diktat-Einstellungen vor, und das
  Mikrofon öffnet, bevor die Erkennung vorbereitet wird – Gesagtes aus
  diesen Millisekunden wird nachgeholt. Gemessen: Start 1,5 s → unter
  0,15 s.

## KIRA für Mac 0.6.1

**Behoben**

- Diktat erkannte seit 0.6.0 nichts mehr (Pegel ja, Text nein): Der
  Apple-Sprachfilter liefert das Mikrofon mit 9 Kanälen, die Umwandlung auf
  Mono gab leere Puffer weiter. Jetzt mischt der Helfer selbst auf Mono.

Die App aktualisiert sich selbst; mit „Jetzt neu starten“ wird das Update
sofort installiert.

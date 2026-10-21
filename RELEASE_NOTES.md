## KIRA für Mac 0.3.9

**Behoben**

- Fehlt das Diktat-Modell, lädt KIRA es jetzt selbst (macOS 26, Apple-Chip),
  beim Start, beim ersten Diktat und über „Modell laden“ in den Einstellungen.
  Fortschritt in der Karte und in der Diktat-Pille. Scheitert der Download,
  steht die Ursache dabei.

**Geändert**

- Neue Versionen baut GitHub Actions (Xcode 27) und veröffentlicht sie auf
  `main` als `v<Version>`, signiert und notarisiert, sobald das
  Developer-ID-Zertifikat und der App-Store-Connect-Schlüssel hinterlegt sind.

Die App aktualisiert sich selbst; mit „Jetzt neu starten“ wird das Update
sofort installiert.

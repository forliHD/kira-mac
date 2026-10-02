## KIRA für Mac 0.3.0

**Neu**

- **Cloudflare-Anmeldung im Browser.** Unterwegs (externe Adresse) hing die
  Anmeldung bei Cloudflare im App-Fenster, weil die App keine Passkeys
  erreicht. Jetzt zeigt die App „Im Browser anmelden“: Die Anmeldung läuft in
  Safari mit Passkey, Touch ID oder Handy, danach springt sie in die App
  zurück („Erlauben“, wenn Safari fragt). Kein E-Mail-Code nötig. Braucht
  KIRA 3.300.0 auf dem Server.

**Behoben**

- Eine angefangene Cloudflare-Anmeldung im App-Fenster wurde nach einer Minute
  zurückgesetzt.
- Das geschlossene Hauptfenster tauchte nach spätestens einer Minute wieder
  auf.

Die App aktualisiert sich selbst und installiert das Update beim nächsten
Beenden (oder sofort über die Menüleiste → „Nach Updates suchen“).

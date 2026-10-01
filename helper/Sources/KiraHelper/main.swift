import Foundation

// Einstieg des Helfers: liest stdin zeilenweise, verarbeitet jede Zeile in
// einer eigenen Task (Anfragen dürfen sich überlappen) und beendet sich bei
// EOF oder nach `shutdown`. Der Main-Thread bleibt frei für Main-Actor-Arbeit
// (Accessibility, Zwischenablage, Tastaturereignisse).

// Ein geschlossenes stdout darf den Prozess nicht per Signal beenden; der
// Helfer endet dann regulär über EOF auf stdin.
signal(SIGPIPE, SIG_IGN)

let writer = OutputWriter()
let dispatcher = Dispatcher(writer: writer)

HelperLog.info(
    "kira-helper \(SystemInfo.helperVersion) (Protokoll \(protocolVersion)) auf macOS \(SystemInfo.macOSVersion), \(SystemInfo.chip)")

do {
    for try await line in FileHandle.standardInput.bytes.lines {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { continue }
        await dispatcher.spawn(line: trimmed)
    }
} catch {
    HelperLog.error("stdin konnte nicht gelesen werden: \(HelperError.describe(error))")
}

// EOF: laufende Anfragen noch beantworten (begrenzt), Streams sauber
// beenden, dann Exit 0.
await dispatcher.drain(timeout: Dispatcher.eofGraceSeconds)
await dispatcher.services.stopAll()
HelperLog.info("stdin geschlossen, Helfer beendet sich.")
exit(0)

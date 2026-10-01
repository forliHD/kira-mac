import Foundation

/// Ein Kommando: bekommt die Anfrage, liefert das `result` oder wirft einen
/// `HelperError` (andere Fehler werden zu `internal`).
typealias CommandHandler = @Sendable (Request) async throws -> JSONValue

/// Alle Dienste des Helfers, einmal je Prozess. Die Kommandotabellen greifen
/// darüber auf Sprache, Sprachmodell, Systemton, Text und Berechtigungen zu.
final class Services: Sendable {
    let writer: OutputWriter
    let permissions: PermissionsService
    let speech: SpeechService
    let llm: FoundationModelsService
    let audio: SystemAudioRecorder
    let text: TextInserter

    init(writer: OutputWriter) {
        self.writer = writer
        self.permissions = PermissionsService()
        self.speech = SpeechService(writer: writer, permissions: permissions)
        self.llm = FoundationModelsService(writer: writer)
        self.audio = SystemAudioRecorder(writer: writer)
        self.text = TextInserter()
    }

    /// Beendet alle laufenden Streams (vor `shutdown` und bei EOF auf stdin).
    func stopAll() async {
        await speech.stopAll()
        await llm.cancelAll()
        await audio.stopAll()
    }
}

/// Zählt laufende Anfragen, damit `shutdown` und EOF nicht mitten in einer
/// Antwort abbrechen (z. B. `echo '…' | kira-helper`).
actor InFlightCounter {
    private var count = 0
    private var waiters: [(limit: Int, continuation: CheckedContinuation<Void, Never>)] = []

    func enter() {
        count += 1
    }

    func leave() {
        count -= 1
        notify()
    }

    /// Wartet, bis höchstens `limit` Anfragen laufen (die wartende selbst zählt mit).
    func waitUntil(atMost limit: Int) async {
        if count <= limit { return }
        await withCheckedContinuation { continuation in
            waiters.append((limit, continuation))
        }
    }

    private func notify() {
        let ready = waiters.filter { count <= $0.limit }
        waiters.removeAll { count <= $0.limit }
        for waiter in ready {
            waiter.continuation.resume()
        }
    }
}

/// Verteilt eingehende Zeilen auf die Kommandotabelle. Jede Zeile wird vom
/// Aufrufer in einer eigenen Task verarbeitet; der Dispatcher selbst hält
/// keinen veränderlichen Zustand und ist deshalb frei nebenläufig nutzbar.
final class Dispatcher: Sendable {
    let writer: OutputWriter
    let services: Services
    private let table: [String: CommandHandler]
    private let terminate: @Sendable (Int32) -> Void
    private let inFlight = InFlightCounter()

    /// So lange wartet `shutdown` auf noch laufende Anfragen (Electron wartet
    /// vorher selbst auf offene Antworten; das hier ist die Sicherheitsreserve).
    static let shutdownGraceSeconds = 3.0
    /// So lange wartet der Helfer bei EOF auf stdin auf laufende Anfragen.
    static let eofGraceSeconds = 15.0

    /// - Parameters:
    ///   - writer: Ausgabe für Antworten und Ereignisse.
    ///   - services: Dienste; standardmäßig werden echte Dienste angelegt.
    ///   - terminate: wird nach `shutdown` mit dem Exit-Code gerufen
    ///     (Standard: `exit`, Tests hängen hier einen Zähler ein).
    init(
        writer: OutputWriter,
        services: Services? = nil,
        terminate: @escaping @Sendable (Int32) -> Void = { exit($0) }
    ) {
        self.writer = writer
        let services = services ?? Services(writer: writer)
        self.services = services
        self.terminate = terminate

        var table: [String: CommandHandler] = [:]
        GeneralCommands.register(into: &table, services: services)
        PermissionCommands.register(into: &table, services: services)
        SpeechCommands.register(into: &table, services: services)
        LLMCommands.register(into: &table, services: services)
        AudioCommands.register(into: &table, services: services)
        TextCommands.register(into: &table, services: services)
        self.table = table
    }

    /// Alle registrierten Kommandonamen (für `info` und Tests).
    var commands: [String] { table.keys.sorted() }

    /// Trägt die Zeile sofort als laufend ein und verarbeitet sie in einer
    /// eigenen Task — so sieht ein direkt folgendes EOF oder `shutdown` die
    /// Anfrage schon im Zähler und wartet auf ihre Antwort.
    func spawn(line: String) async {
        await inFlight.enter()
        Task.detached { [self] in
            await handle(line: line)
            await inFlight.leave()
        }
    }

    /// Verarbeitet eine Zeile vollständig: parsen, ausführen, antworten.
    /// Wirft nie; jeder Fehlerpfad endet in einer Antwort oder einem
    /// `protocol.error`-Ereignis.
    func handle(line: String) async {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let request: Request
        do {
            request = try LineCodec.decodeRequest(trimmed)
        } catch {
            await writer.send(.protocolError("Ungültige JSON-Zeile: \(Self.describeDecodingError(error))"))
            return
        }

        await execute(request)
    }

    /// Führt eine bereits geparste Anfrage aus und schreibt die Antwort.
    func execute(_ request: Request) async {
        guard let handler = table[request.cmd] else {
            await writer.send(.failure(id: request.id, error: .unknownCommand(request.cmd)))
            return
        }

        do {
            let result = try await handler(request)
            await writer.send(.success(id: request.id, result: result))
        } catch {
            let helperError = HelperError.wrap(error)
            if helperError.code == .internalError {
                HelperLog.error("Kommando \(request.cmd) (\(request.id)): \(helperError.message)")
            }
            await writer.send(.failure(id: request.id, error: helperError))
        }

        if request.cmd == "shutdown" {
            // Andere laufende Anfragen (außer dieser) noch kurz zu Ende bringen.
            await drain(atMost: 1, timeout: Self.shutdownGraceSeconds)
            await services.stopAll()
            terminate(0)
        }
    }

    /// Wartet begrenzt, bis höchstens `atMost` Anfragen laufen (bei EOF: 0).
    func drain(atMost limit: Int = 0, timeout: Double) async {
        let counter = inFlight
        _ = try? await withTimeout(seconds: timeout) {
            await counter.waitUntil(atMost: limit)
        }
    }

    /// Lesbare Beschreibung eines Dekodierfehlers ohne den Zeileninhalt
    /// (der könnte Nutzertext enthalten).
    static func describeDecodingError(_ error: any Error) -> String {
        guard let decodingError = error as? DecodingError else {
            return HelperError.describe(error)
        }
        switch decodingError {
        case .keyNotFound(let key, _):
            return "Feld „\(key.stringValue)“ fehlt"
        case .typeMismatch(_, let context), .valueNotFound(_, let context):
            let path = context.codingPath.map(\.stringValue).joined(separator: ".")
            return path.isEmpty ? context.debugDescription : "Feld „\(path)“: \(context.debugDescription)"
        case .dataCorrupted(let context):
            return context.debugDescription.isEmpty ? "kein gültiges JSON-Objekt" : context.debugDescription
        @unknown default:
            return "kein gültiges JSON-Objekt"
        }
    }
}

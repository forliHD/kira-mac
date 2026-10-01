import Foundation

/// Serialisiert alle Schreibzugriffe auf stdout: genau eine JSON-Zeile je
/// Nachricht, `\n`-terminiert, sofort geschrieben (kein Puffer, kein Flush
/// nötig). Alle Antworten und Ereignisse gehen hier durch.
actor OutputWriter {
    typealias Sink = @Sendable (Data) -> Void

    private let sink: Sink

    /// Standard: schreibt direkt auf Dateideskriptor 1 (stdout).
    init(sink: @escaping Sink = OutputWriter.stdoutSink) {
        self.sink = sink
    }

    func send(_ response: Response) {
        write(response, label: "Antwort \(response.id)")
    }

    func send(_ event: Event) {
        write(event, label: "Ereignis \(event.event)")
    }

    /// Kodiert und schreibt eine Nachricht. Schlägt die Kodierung fehl, wird
    /// ein Protokollfehler geschrieben, damit die Gegenseite nie stumm wartet.
    private func write(_ value: some Encodable, label: String) {
        do {
            var data = try LineCodec.encode(value)
            data.append(0x0A)
            sink(data)
        } catch {
            HelperLog.error("Kodierung fehlgeschlagen (\(label)): \(error)")
            let fallback = "{\"event\":\"protocol.error\",\"data\":{\"message\":\"Kodierung fehlgeschlagen\"}}\n"
            sink(Data(fallback.utf8))
        }
    }

    static let stdoutSink: Sink = { data in
        writeFully(fd: STDOUT_FILENO, data: data)
    }
}

/// Schreibt `data` vollständig auf einen Dateideskriptor (Teilschreibvorgänge
/// werden fortgesetzt). Fehler werden verschluckt: Ist stdout geschlossen,
/// beendet sich der Helfer ohnehin über EOF auf stdin.
func writeFully(fd: Int32, data: Data) {
    data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
        guard var pointer = raw.baseAddress else { return }
        var remaining = raw.count
        while remaining > 0 {
            let written = Darwin.write(fd, pointer, remaining)
            if written < 0 {
                if errno == EINTR { continue }
                return
            }
            remaining -= written
            pointer += written
        }
    }
}

/// Protokollzeilen des Helfers auf stderr, immer mit Präfix `[kira-helper]`.
/// Nie Audiodaten oder Nutzertexte protokollieren.
enum HelperLog {
    static func info(_ message: String) {
        emit("INFO", message)
    }

    static func warn(_ message: String) {
        emit("WARN", message)
    }

    static func error(_ message: String) {
        emit("ERROR", message)
    }

    private static func emit(_ level: String, _ message: String) {
        let line = "[kira-helper] \(level) \(message)\n"
        writeFully(fd: STDERR_FILENO, data: Data(line.utf8))
    }
}

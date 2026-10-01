import Foundation

/// `ping`, `info`, `shutdown`.
enum GeneralCommands {
    static func register(into table: inout [String: CommandHandler], services: Services) {
        table["ping"] = { _ in
            ["pong": true]
        }

        table["info"] = { _ in
            await info(services: services)
        }

        // Die Antwort geht raus, danach beendet der Dispatcher den Prozess
        // (Streams werden vorher gestoppt).
        table["shutdown"] = { _ in
            ["ok": true]
        }
    }

    /// `features` meldet, was auf DIESEM Mac wirklich geht — nicht nur die
    /// Betriebssystemversion: Sprachmodul vorhanden, Apple Intelligence aktiv.
    static func info(services: Services) async -> JSONValue {
        let speech = await services.speech.engineInfo()
        let llmAvailable = await services.llm.isAvailable()
        let sttAvailable = speech.engine != nil

        return [
            "protocol": .int(protocolVersion),
            "version": .string(SystemInfo.helperVersion),
            "macos": .string(SystemInfo.macOSVersion),
            "chip": .string(SystemInfo.chip),
            "features": [
                "stt": .bool(sttAvailable),
                "sttStream": .bool(sttAvailable),
                "llm": .bool(llmAvailable),
                // ScreenCaptureKit-Audio gibt es ab macOS 13; der Helfer läuft ab 14.
                "systemAudio": true,
                // Accessibility oder Zwischenablage — eines geht immer, die
                // Freigabe prüft `permissions.status`.
                "insertText": true,
            ],
            "sttEngine": .optionalString(speech.engine),
            "locales": .strings(speech.locales),
        ]
    }
}

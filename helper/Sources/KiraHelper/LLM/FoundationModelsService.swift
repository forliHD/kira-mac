import Foundation
#if canImport(FoundationModels)
    import FoundationModels
#endif

/// Apple-Sprachmodell auf dem Gerät (FoundationModels, macOS 26+):
/// `llm.status`, `llm.generate`, `llm.stream`, `llm.cancel`.
/// Unter macOS 26 meldet jedes Kommando `llm_unavailable` mit `unsupportedOS`.
actor FoundationModelsService {
    private let writer: OutputWriter
    private var streams: [String: Task<Void, Never>] = [:]
    private var tokens: [String: UUID] = [:]

    /// Obergrenzen, damit ein falscher Parameter das Modell nicht lahmlegt.
    private static let maxTokensLimit = 4096
    private static let defaultMaxTokens = 512
    private static let defaultTemperature = 0.4

    init(writer: OutputWriter) {
        self.writer = writer
    }

    // MARK: Verfügbarkeit

    /// Grund im Vertrag: `appleIntelligenceNotEnabled`, `deviceNotEligible`,
    /// `modelNotReady`, `unsupportedOS` oder `null`.
    func availability() -> (available: Bool, reason: String?) {
        #if canImport(FoundationModels)
            if #available(macOS 26, *) {
                switch SystemLanguageModel.default.availability {
                case .available:
                    return (true, nil)
                case .unavailable(let reason):
                    switch reason {
                    case .appleIntelligenceNotEnabled: return (false, "appleIntelligenceNotEnabled")
                    case .deviceNotEligible: return (false, "deviceNotEligible")
                    case .modelNotReady: return (false, "modelNotReady")
                    @unknown default: return (false, "unknown")
                    }
                }
            }
        #endif
        return (false, "unsupportedOS")
    }

    func isAvailable() -> Bool {
        availability().available
    }

    func status() -> JSONValue {
        let state = availability()
        return ["available": .bool(state.available), "reason": .optionalString(state.reason)]
    }

    private func ensureAvailable() throws {
        let state = availability()
        guard state.available else {
            throw HelperError(.llmUnavailable, Self.unavailableMessage(for: state.reason), reason: state.reason)
        }
    }

    static func unavailableMessage(for reason: String?) -> String {
        switch reason {
        case "unsupportedOS":
            return "Das Apple-Sprachmodell braucht macOS 26 oder neuer."
        case "appleIntelligenceNotEnabled":
            return "Apple Intelligence ist nicht eingeschaltet (Systemeinstellungen → Apple Intelligence & Siri)."
        case "deviceNotEligible":
            return "Dieser Mac unterstützt Apple Intelligence nicht."
        case "modelNotReady":
            return "Das Apple-Sprachmodell wird noch geladen. Bitte später erneut versuchen."
        default:
            return "Das Apple-Sprachmodell ist nicht verfügbar."
        }
    }

    // MARK: Parameter

    private struct GenerationParams: Sendable {
        let prompt: String
        let instructions: String?
        let maxTokens: Int
        let temperature: Double
    }

    private static func parse(_ params: Params) throws -> GenerationParams {
        let prompt = try params.string("prompt")
        guard !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw HelperError.badParams("Parameter „prompt“ darf nicht leer sein.")
        }
        let instructions = try params.optionalString("instructions")
        let maxTokens = try params.optionalInt("maxTokens") ?? defaultMaxTokens
        guard maxTokens > 0 else {
            throw HelperError.badParams("Parameter „maxTokens“ muss größer als 0 sein.")
        }
        let temperature = try params.optionalDouble("temperature") ?? defaultTemperature
        guard (0.0...2.0).contains(temperature) else {
            throw HelperError.badParams("Parameter „temperature“ muss zwischen 0 und 2 liegen.")
        }
        return GenerationParams(
            prompt: prompt, instructions: instructions, maxTokens: min(maxTokens, maxTokensLimit),
            temperature: temperature)
    }

    // MARK: llm.generate

    func generate(_ params: Params) async throws -> JSONValue {
        let generation = try Self.parse(params)
        try ensureAvailable()
        #if canImport(FoundationModels)
            if #available(macOS 26, *) {
                do {
                    let session = LanguageModelSession(instructions: generation.instructions)
                    let options = GenerationOptions(
                        temperature: generation.temperature, maximumResponseTokens: generation.maxTokens)
                    let response = try await session.respond(to: generation.prompt, options: options)
                    return ["text": .string(response.content)]
                } catch {
                    throw Self.mapError(error)
                }
            }
        #endif
        throw HelperError(.llmUnavailable, Self.unavailableMessage(for: "unsupportedOS"), reason: "unsupportedOS")
    }

    // MARK: llm.stream / llm.cancel

    func startStream(id: String, _ params: Params) throws -> JSONValue {
        let generation = try Self.parse(params)
        try ensureAvailable()

        if let previous = streams.removeValue(forKey: id) {
            previous.cancel()
            tokens[id] = nil
        }
        let token = UUID()

        #if canImport(FoundationModels)
            guard #available(macOS 26, *) else {
                throw HelperError(.llmUnavailable, Self.unavailableMessage(for: "unsupportedOS"), reason: "unsupportedOS")
            }
            let writer = writer
            let task = Task { [weak self] in
                var lastText = ""
                do {
                    let session = LanguageModelSession(instructions: generation.instructions)
                    let options = GenerationOptions(
                        temperature: generation.temperature, maximumResponseTokens: generation.maxTokens)
                    var first = true
                    for try await snapshot in session.streamResponse(to: generation.prompt, options: options) {
                        try Task.checkCancellation()
                        lastText = snapshot.content
                        var data: [String: JSONValue] = ["text": .string(lastText)]
                        if first {
                            // Die Deltas sind kumulativ: jedes Ereignis enthält den ganzen bisherigen Text.
                            data["mode"] = "cumulative"
                            first = false
                        }
                        await writer.send(Event("llm.delta", stream: id, data: .object(data)))
                    }
                    try Task.checkCancellation()
                    await writer.send(Event("llm.done", stream: id, data: ["text": .string(lastText)]))
                } catch is CancellationError {
                    await writer.send(
                        Event("llm.error", stream: id, data: ["code": "cancelled", "message": "Abgebrochen."]))
                } catch {
                    let helperError = Self.mapError(error)
                    await writer.send(
                        Event(
                            "llm.error", stream: id,
                            data: [
                                "code": .string(helperError.code.rawValue), "message": .string(helperError.message),
                            ]))
                }
                await self?.streamFinished(id: id, token: token)
            }
            streams[id] = task
            tokens[id] = token
            return ["started": true]
        #else
            throw HelperError(.llmUnavailable, Self.unavailableMessage(for: "unsupportedOS"), reason: "unsupportedOS")
        #endif
    }

    /// Nur austragen, wenn kein neuer Stream mit derselben Kennung läuft
    /// (der alte Task ist dann bereits abgebrochen und ersetzt).
    private func streamFinished(id: String, token: UUID) {
        if tokens[id] == token {
            streams[id] = nil
            tokens[id] = nil
        }
    }

    func cancel(id: String) -> JSONValue {
        tokens[id] = nil
        if let task = streams.removeValue(forKey: id) {
            task.cancel()
            return ["cancelled": true]
        }
        return ["cancelled": false]
    }

    func cancelAll() {
        for task in streams.values {
            task.cancel()
        }
        streams = [:]
        tokens = [:]
    }

    // MARK: Fehler

    /// Bildet Modellfehler auf Vertragscodes ab. macOS 27 wirft
    /// `LanguageModelError`, macOS 26 `LanguageModelSession.GenerationError`;
    /// beide werden geprüft.
    static func mapError(_ error: any Error) -> HelperError {
        if let helperError = error as? HelperError { return helperError }
        if error is CancellationError { return HelperError(.llmFailed, "Abgebrochen.") }

        #if canImport(FoundationModels)
            if #available(macOS 27, *), let modelError = error as? LanguageModelError {
                switch modelError {
                case .contextSizeExceeded:
                    return HelperError(.contextTooLong, "Die Eingabe ist zu lang für das Apple-Sprachmodell (Kontextfenster überschritten).")
                case .guardrailViolation:
                    return HelperError(.llmFailed, "Das Apple-Sprachmodell hat die Anfrage aus Sicherheitsgründen abgelehnt.", reason: "guardrailViolation")
                case .refusal:
                    return HelperError(.llmFailed, "Das Apple-Sprachmodell hat die Anfrage abgelehnt.", reason: "refusal")
                case .rateLimited:
                    return HelperError(.llmFailed, "Das Apple-Sprachmodell ist gerade ausgelastet. Bitte kurz warten.", reason: "rateLimited")
                case .unsupportedLanguageOrLocale:
                    return HelperError(.llmFailed, "Diese Sprache unterstützt das Apple-Sprachmodell nicht.", reason: "unsupportedLanguageOrLocale")
                case .timeout:
                    return HelperError(.llmFailed, "Das Apple-Sprachmodell hat nicht rechtzeitig geantwortet.", reason: "timeout")
                default:
                    return HelperError(.llmFailed, "Apple-Sprachmodell: \(HelperError.describe(error))")
                }
            }
            if #available(macOS 27, *), let sessionError = error as? LanguageModelSession.Error {
                switch sessionError {
                case .concurrentRequests:
                    return HelperError(.llmFailed, "Das Apple-Sprachmodell bearbeitet bereits eine Anfrage dieser Sitzung.", reason: "concurrentRequests")
                default:
                    return HelperError(.llmFailed, "Apple-Sprachmodell: \(HelperError.describe(error))")
                }
            }
            if #available(macOS 27, *), let modelError = error as? SystemLanguageModel.Error {
                switch modelError {
                case .assetsUnavailable:
                    return HelperError(.llmUnavailable, unavailableMessage(for: "modelNotReady"), reason: "modelNotReady")
                @unknown default:
                    return HelperError(.llmFailed, "Apple-Sprachmodell: \(HelperError.describe(error))")
                }
            }
            if #available(macOS 26, *), let generationError = error as? LanguageModelSession.GenerationError {
                switch generationError {
                case .exceededContextWindowSize:
                    return HelperError(.contextTooLong, "Die Eingabe ist zu lang für das Apple-Sprachmodell (Kontextfenster überschritten).")
                case .assetsUnavailable:
                    return HelperError(.llmUnavailable, unavailableMessage(for: "modelNotReady"), reason: "modelNotReady")
                case .guardrailViolation:
                    return HelperError(.llmFailed, "Das Apple-Sprachmodell hat die Anfrage aus Sicherheitsgründen abgelehnt.", reason: "guardrailViolation")
                case .refusal:
                    return HelperError(.llmFailed, "Das Apple-Sprachmodell hat die Anfrage abgelehnt.", reason: "refusal")
                case .rateLimited:
                    return HelperError(.llmFailed, "Das Apple-Sprachmodell ist gerade ausgelastet. Bitte kurz warten.", reason: "rateLimited")
                case .concurrentRequests:
                    return HelperError(.llmFailed, "Das Apple-Sprachmodell bearbeitet bereits eine Anfrage dieser Sitzung.", reason: "concurrentRequests")
                case .unsupportedLanguageOrLocale:
                    return HelperError(.llmFailed, "Diese Sprache unterstützt das Apple-Sprachmodell nicht.", reason: "unsupportedLanguageOrLocale")
                default:
                    return HelperError(.llmFailed, "Apple-Sprachmodell: \(HelperError.describe(error))")
                }
            }
        #endif
        return HelperError(.llmFailed, "Apple-Sprachmodell: \(HelperError.describe(error))")
    }
}

enum LLMCommands {
    static func register(into table: inout [String: CommandHandler], services: Services) {
        table["llm.status"] = { _ in
            await services.llm.status()
        }
        table["llm.generate"] = { request in
            try await services.llm.generate(request.params)
        }
        table["llm.stream"] = { request in
            let stream = try request.params.string("stream")
            return try await services.llm.startStream(id: stream, request.params)
        }
        table["llm.cancel"] = { request in
            let stream = try request.params.string("stream")
            return await services.llm.cancel(id: stream)
        }
    }
}

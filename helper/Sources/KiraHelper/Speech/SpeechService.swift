import AVFoundation
import Foundation
import Speech

/// Welche Erkennung dieser Mac bietet.
enum SpeechEngine: String, Sendable {
    /// `SpeechAnalyzer` + `SpeechTranscriber` (macOS 26+), On-Device, ohne
    /// Freigabe für Spracherkennung.
    case analyzer
    /// `SFSpeechRecognizer` mit `requiresOnDeviceRecognition` (macOS 14/15).
    case legacy

    /// Name im `engine`-Feld von `stt.file` (Vertrag: „apple“ für den
    /// Analyzer, „legacy“ für den Rückfall).
    var resultName: String {
        switch self {
        case .analyzer: return "apple"
        case .legacy: return "legacy"
        }
    }
}

/// Ein laufender Erkennungs-Stream (eine Kennung, eine Mikrofonquelle).
protocol SpeechStream: AnyObject, Sendable {
    var id: String { get }
    /// Spült die Erkennung, sendet ausstehende `stt.final`, dann `stt.ended(stopped)`.
    func stop() async
    /// Bricht sofort ab und sendet `stt.ended` mit dem genannten Grund.
    func cancel(reason: String) async
}

/// `stt.status`, `stt.prepare`, `stt.file`, `stt.start`, `stt.stop`.
/// Hält das Stream-Register; die eigentliche Arbeit machen `AnalyzerStream`
/// (macOS 26+) und `LegacyStream`.
actor SpeechService {
    private let writer: OutputWriter
    private let permissions: PermissionsService
    private var streams: [String: any SpeechStream] = [:]

    init(writer: OutputWriter, permissions: PermissionsService) {
        self.writer = writer
        self.permissions = permissions
    }

    // MARK: Engine

    /// Engine dieses Macs; `nil`, wenn keine On-Device-Erkennung möglich ist.
    func engine() -> SpeechEngine? {
        if #available(macOS 26, *), SpeechTranscriber.isAvailable {
            return .analyzer
        }
        if !legacyOnDeviceLocales().isEmpty {
            return .legacy
        }
        return nil
    }

    func usesAnalyzer() -> Bool {
        engine() == .analyzer
    }

    /// Für `info`: Engine-Name und die unterstützten Sprachen als BCP-47.
    func engineInfo() async -> (engine: String?, locales: [String]) {
        guard let engine = engine() else { return (nil, []) }
        switch engine {
        case .analyzer:
            if #available(macOS 26, *) {
                let locales = await SpeechTranscriber.supportedLocales
                return ("analyzer", Self.bcp47(locales))
            }
            return (nil, [])
        case .legacy:
            return ("legacy", Self.bcp47(legacyOnDeviceLocales()))
        }
    }

    private static func bcp47(_ locales: [Locale]) -> [String] {
        Array(Set(locales.map { $0.identifier(.bcp47) })).sorted()
    }

    /// Sprachen, für die `SFSpeechRecognizer` ein On-Device-Modell hat
    /// (Systemeinstellungen → Tastatur → Diktat).
    private func legacyOnDeviceLocales() -> [Locale] {
        SFSpeechRecognizer.supportedLocales().filter { locale in
            SFSpeechRecognizer(locale: locale)?.supportsOnDeviceRecognition == true
        }
    }

    // MARK: stt.status / stt.prepare

    func status(locale localeId: String) async -> JSONValue {
        guard let engine = engine() else {
            return Self.statusValue(
                available: false, engine: nil, assets: "missing",
                reason:
                    "Dieses macOS bietet keine Spracherkennung auf dem Gerät (ab macOS 26 über SpeechAnalyzer, darunter über ein On-Device-Diktatpaket).")
        }
        switch engine {
        case .analyzer:
            if #available(macOS 26, *) {
                return await analyzerStatus(localeId: localeId)
            }
            return Self.statusValue(available: false, engine: nil, assets: "missing", reason: "Nicht verfügbar.")
        case .legacy:
            return legacyStatus(localeId: localeId)
        }
    }

    private static func statusValue(available: Bool, engine: String?, assets: String, reason: String?)
        -> JSONValue
    {
        [
            "available": .bool(available),
            "engine": .optionalString(engine),
            "assets": .string(assets),
            "reason": .optionalString(reason),
        ]
    }

    @available(macOS 26, *)
    private func analyzerStatus(localeId: String) async -> JSONValue {
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeId))
        else {
            return Self.statusValue(
                available: false, engine: "analyzer", assets: "missing",
                reason: "Die Sprache „\(localeId)“ wird von der Spracherkennung nicht unterstützt.")
        }
        let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
        switch await AssetInventory.status(forModules: [transcriber]) {
        case .installed:
            return Self.statusValue(available: true, engine: "analyzer", assets: "installed", reason: nil)
        case .downloading:
            return Self.statusValue(
                available: false, engine: "analyzer", assets: "downloading",
                reason: "Das Sprachmodell für „\(localeId)“ wird gerade geladen.")
        case .supported:
            return Self.statusValue(
                available: false, engine: "analyzer", assets: "missing",
                reason: "Das Sprachmodell für „\(localeId)“ ist nicht installiert – „stt.prepare“ lädt es herunter.")
        case .unsupported:
            return Self.statusValue(
                available: false, engine: "analyzer", assets: "missing",
                reason: "Die Sprache „\(localeId)“ wird von der Spracherkennung nicht unterstützt.")
        @unknown default:
            return Self.statusValue(
                available: false, engine: "analyzer", assets: "missing", reason: "Unbekannter Modellzustand.")
        }
    }

    private func legacyStatus(localeId: String) -> JSONValue {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId)) else {
            return Self.statusValue(
                available: false, engine: "legacy", assets: "missing",
                reason: "Die Sprache „\(localeId)“ wird von der Spracherkennung nicht unterstützt.")
        }
        guard recognizer.supportsOnDeviceRecognition else {
            return Self.statusValue(
                available: false, engine: "legacy", assets: "missing",
                reason:
                    "Für „\(localeId)“ gibt es kein Modell auf dem Gerät. Bitte die Sprache unter Systemeinstellungen → Tastatur → Diktat hinzufügen.")
        }
        guard recognizer.isAvailable else {
            return Self.statusValue(
                available: false, engine: "legacy", assets: "installed",
                reason: "Die Spracherkennung ist gerade nicht verfügbar.")
        }
        return Self.statusValue(available: true, engine: "legacy", assets: "installed", reason: nil)
    }

    func prepare(locale localeId: String) async throws -> JSONValue {
        guard let engine = engine() else {
            throw HelperError(.sttUnavailable, "Dieses macOS bietet keine Spracherkennung auf dem Gerät.")
        }
        switch engine {
        case .analyzer:
            if #available(macOS 26, *) {
                let locale = try await Self.resolveAnalyzerLocale(localeId)
                let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
                if await AssetInventory.status(forModules: [transcriber]) == .installed {
                    return ["assets": "installed"]
                }
                do {
                    _ = try await AssetInventory.reserve(locale: locale)
                } catch {
                    HelperLog.warn("Sprache konnte nicht reserviert werden: \(HelperError.describe(error))")
                }
                do {
                    guard let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber])
                    else {
                        return ["assets": "installed"]
                    }
                    HelperLog.info("Lade Sprachmodell für \(locale.identifier(.bcp47)) …")
                    try await request.downloadAndInstall()
                } catch {
                    throw HelperError(
                        .sttAssetsMissing,
                        "Das Sprachmodell für „\(localeId)“ konnte nicht geladen werden: \(HelperError.describe(error))")
                }
                HelperLog.info("Sprachmodell für \(locale.identifier(.bcp47)) installiert.")
                return ["assets": "installed"]
            }
            throw HelperError(.sttUnavailable, "Nicht verfügbar.")
        case .legacy:
            guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId)) else {
                throw HelperError(.sttUnavailable, "Die Sprache „\(localeId)“ wird nicht unterstützt.")
            }
            guard recognizer.supportsOnDeviceRecognition else {
                throw HelperError(
                    .sttAssetsMissing,
                    "Für „\(localeId)“ gibt es kein Modell auf dem Gerät. Bitte die Sprache unter Systemeinstellungen → Tastatur → Diktat hinzufügen; ein Download aus dem Helfer ist auf diesem macOS nicht möglich.")
            }
            return ["assets": "installed"]
        }
    }

    @available(macOS 26, *)
    private static func resolveAnalyzerLocale(_ localeId: String) async throws -> Locale {
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeId))
        else {
            throw HelperError(.sttUnavailable, "Die Sprache „\(localeId)“ wird von der Spracherkennung nicht unterstützt.")
        }
        return locale
    }

    // MARK: stt.file

    func transcribeFile(path: String, locale localeId: String, contextualStrings: [String]) async throws
        -> JSONValue
    {
        guard FileManager.default.isReadableFile(atPath: path) else {
            throw HelperError(.sttFailed, "Die Audiodatei wurde nicht gefunden oder ist nicht lesbar.")
        }
        guard let engine = engine() else {
            throw HelperError(.sttUnavailable, "Dieses macOS bietet keine Spracherkennung auf dem Gerät.")
        }
        let url = URL(fileURLWithPath: path)
        let started = ContinuousClock.now
        let audioMs = Self.audioDurationMs(url: url)

        let text: String
        switch engine {
        case .analyzer:
            guard #available(macOS 26, *) else {
                throw HelperError(.sttUnavailable, "Nicht verfügbar.")
            }
            let locale = try await Self.resolveAnalyzerLocale(localeId)
            text = try await Self.analyzerTranscribeFile(url: url, locale: locale, contextualStrings: contextualStrings)
        case .legacy:
            try await permissions.ensureSpeechAuthorization()
            text = try await Self.legacyTranscribeFile(
                url: url, locale: Locale(identifier: localeId), contextualStrings: contextualStrings)
        }

        let elapsed = ContinuousClock.now - started
        let durationMs = Int(elapsed / .milliseconds(1))
        return [
            "text": .string(text),
            "durationMs": .int(durationMs),
            "audioMs": .int(audioMs),
            "engine": .string(engine.resultName),
        ]
    }

    private static func audioDurationMs(url: URL) -> Int {
        guard let file = try? AVAudioFile(forReading: url), file.fileFormat.sampleRate > 0 else { return 0 }
        return Int(Double(file.length) / file.fileFormat.sampleRate * 1000)
    }

    @available(macOS 26, *)
    private static func analyzerTranscribeFile(url: URL, locale: Locale, contextualStrings: [String]) async throws
        -> String
    {
        let file: AVAudioFile
        do {
            file = try AVAudioFile(forReading: url)
        } catch {
            throw HelperError(.sttFailed, "Die Audiodatei konnte nicht gelesen werden: \(HelperError.describe(error))")
        }

        let transcriber = SpeechTranscriber(
            locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [])
        guard await AssetInventory.status(forModules: [transcriber]) == .installed else {
            throw HelperError(
                .sttAssetsMissing,
                "Das Sprachmodell für „\(locale.identifier(.bcp47))“ ist nicht installiert – bitte „stt.prepare“ ausführen.")
        }

        // Ergebnisse vor dem Start der Analyse abonnieren, damit nichts verloren geht.
        let collector = Task<String, any Error> {
            var segments: [String] = []
            for try await result in transcriber.results where result.isFinal {
                segments.append(String(result.text.characters))
            }
            return joinSegments(segments)
        }

        let context = AnalysisContext()
        if !contextualStrings.isEmpty {
            context.contextualStrings[.general] = contextualStrings
        }
        let analyzer = SpeechAnalyzer(modules: [transcriber], options: nil)
        do {
            try await analyzer.setContext(context)
            if let lastSample = try await analyzer.analyzeSequence(from: file) {
                try await analyzer.finalizeAndFinish(through: lastSample)
            } else {
                await analyzer.cancelAndFinishNow()
            }
        } catch {
            await analyzer.cancelAndFinishNow()
            collector.cancel()
            throw HelperError(.sttFailed, "Erkennung fehlgeschlagen: \(HelperError.describe(error))")
        }

        do {
            return try await withTimeout(seconds: 30) { try await collector.value }
        } catch is TimeoutError {
            collector.cancel()
            throw HelperError(.sttFailed, "Die Erkennung hat kein Ergebnis geliefert (Zeitüberschreitung).")
        } catch {
            throw HelperError(.sttFailed, "Erkennung fehlgeschlagen: \(HelperError.describe(error))")
        }
    }

    /// Segmente zu einem Text verbinden; doppelte Leerzeichen an den Nahtstellen
    /// zusammenziehen, Rand abschneiden.
    static func joinSegments(_ segments: [String]) -> String {
        let joined = segments.joined(separator: " ")
        let collapsed = joined.replacingOccurrences(of: "[ \\t]{2,}", with: " ", options: .regularExpression)
        return collapsed.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func legacyTranscribeFile(url: URL, locale: Locale, contextualStrings: [String]) async throws
        -> String
    {
        guard let recognizer = SFSpeechRecognizer(locale: locale) else {
            throw HelperError(.sttUnavailable, "Die Sprache „\(locale.identifier(.bcp47))“ wird nicht unterstützt.")
        }
        guard recognizer.supportsOnDeviceRecognition else {
            throw HelperError(
                .sttAssetsMissing,
                "Für „\(locale.identifier(.bcp47))“ gibt es kein Modell auf dem Gerät (Systemeinstellungen → Tastatur → Diktat).")
        }
        guard recognizer.isAvailable else {
            throw HelperError(.sttUnavailable, "Die Spracherkennung ist gerade nicht verfügbar.")
        }

        let request = SFSpeechURLRecognitionRequest(url: url)
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = false
        request.taskHint = .dictation
        if !contextualStrings.isEmpty {
            request.contextualStrings = contextualStrings
        }

        let holder = RecognitionTaskHolder()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let once = OnceFlag()
                holder.task = recognizer.recognitionTask(with: request) { result, error in
                    if let error {
                        guard once.claim() else { return }
                        if Self.isNoSpeechError(error) {
                            continuation.resume(returning: "")
                        } else {
                            continuation.resume(
                                throwing: HelperError(
                                    .sttFailed, "Erkennung fehlgeschlagen: \(HelperError.describe(error))"))
                        }
                        return
                    }
                    if let result, result.isFinal, once.claim() {
                        continuation.resume(returning: result.bestTranscription.formattedString)
                    }
                }
            }
        } onCancel: {
            holder.task?.cancel()
        }
    }

    /// `kAFAssistantErrorDomain` 1110 = „No speech detected“ — kein Fehler,
    /// sondern leeres Ergebnis.
    static func isNoSpeechError(_ error: any Error) -> Bool {
        let ns = error as NSError
        return ns.domain == "kAFAssistantErrorDomain" && ns.code == 1110
    }

    // MARK: stt.start / stt.stop

    func start(stream id: String, locale localeId: String, contextualStrings: [String], source: String)
        async throws -> JSONValue
    {
        guard source == "microphone" else {
            throw HelperError.badParams("Unbekannte Quelle „\(source)“ (erlaubt: microphone).")
        }
        guard let engine = engine() else {
            throw HelperError(.sttUnavailable, "Dieses macOS bietet keine Spracherkennung auf dem Gerät.")
        }

        // Ein zweites stt.start mit derselben Kennung ersetzt den ersten Stream.
        if let existing = streams.removeValue(forKey: id) {
            await existing.cancel(reason: "replaced")
        }

        try await permissions.ensureMicrophone()

        let onEnded: @Sendable (String, ObjectIdentifier) -> Void = { [weak self] id, token in
            Task { await self?.streamEnded(id: id, token: token) }
        }

        let stream: any SpeechStream
        switch engine {
        case .analyzer:
            guard #available(macOS 26, *) else {
                throw HelperError(.sttUnavailable, "Nicht verfügbar.")
            }
            let locale = try await Self.resolveAnalyzerLocale(localeId)
            stream = try await AnalyzerStream.start(
                id: id, locale: locale, contextualStrings: contextualStrings, writer: writer, onEnded: onEnded)
        case .legacy:
            try await permissions.ensureSpeechAuthorization()
            stream = try LegacyStream.start(
                id: id, locale: Locale(identifier: localeId), contextualStrings: contextualStrings,
                writer: writer, onEnded: onEnded)
        }

        // Während des Starts (Freigabe, Modell laden) kann ein weiteres stt.start
        // mit derselben Kennung gekommen sein — der neuere gewinnt.
        if let raced = streams.removeValue(forKey: id) {
            await raced.cancel(reason: "replaced")
        }
        streams[id] = stream
        return ["started": true, "engine": .string(engine.rawValue)]
    }

    func stop(stream id: String) async throws -> JSONValue {
        guard let stream = streams.removeValue(forKey: id) else {
            throw HelperError.badParams("Kein laufender Stream „\(id)“.")
        }
        await stream.stop()
        return ["stopped": true]
    }

    /// Ein Stream hat sich selbst beendet (Fehler); nur austragen, wenn es
    /// noch derselbe Stream ist.
    private func streamEnded(id: String, token: ObjectIdentifier) {
        if let current = streams[id], ObjectIdentifier(current) == token {
            streams[id] = nil
        }
    }

    func stopAll() async {
        let active = streams
        streams = [:]
        for stream in active.values {
            await stream.cancel(reason: "stopped")
        }
    }
}

// MARK: - Hilfsklassen

/// Hält eine `SFSpeechRecognitionTask`, damit ein Abbruch-Handler sie erreicht.
final class RecognitionTaskHolder: @unchecked Sendable {
    private let lock = NSLock()
    private var _task: SFSpeechRecognitionTask?
    var task: SFSpeechRecognitionTask? {
        get {
            lock.lock()
            defer { lock.unlock() }
            return _task
        }
        set {
            lock.lock()
            _task = newValue
            lock.unlock()
        }
    }
}

/// Einmal-Schalter für Continuations, die aus mehreren Rückrufen bedient werden.
final class OnceFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false

    func claim() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if done { return false }
        done = true
        return true
    }
}

// MARK: - Analyzer-Stream (macOS 26+)

@available(macOS 26, *)
final class AnalyzerStream: SpeechStream, @unchecked Sendable {
    let id: String
    private let writer: OutputWriter
    private let transcriber: SpeechTranscriber
    private let analyzer: SpeechAnalyzer
    private let continuation: AsyncStream<AnalyzerInput>.Continuation
    private let mic = MicrophoneCapture()
    private let meter = LevelMeter()
    private let ended = OnceFlag()
    private let onEnded: @Sendable (String, ObjectIdentifier) -> Void
    private var resultsTask: Task<Void, Never>?
    private var levelTask: Task<Void, Never>?

    private init(
        id: String, writer: OutputWriter, transcriber: SpeechTranscriber, analyzer: SpeechAnalyzer,
        continuation: AsyncStream<AnalyzerInput>.Continuation,
        onEnded: @escaping @Sendable (String, ObjectIdentifier) -> Void
    ) {
        self.id = id
        self.writer = writer
        self.transcriber = transcriber
        self.analyzer = analyzer
        self.continuation = continuation
        self.onEnded = onEnded
    }

    static func start(
        id: String, locale: Locale, contextualStrings: [String], writer: OutputWriter,
        onEnded: @escaping @Sendable (String, ObjectIdentifier) -> Void
    ) async throws -> AnalyzerStream {
        let transcriber = SpeechTranscriber(
            locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults, .fastResults],
            attributeOptions: [])
        guard await AssetInventory.status(forModules: [transcriber]) == .installed else {
            throw HelperError(
                .sttAssetsMissing,
                "Das Sprachmodell für „\(locale.identifier(.bcp47))“ ist nicht installiert – bitte „stt.prepare“ ausführen.")
        }
        guard let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber])
        else {
            throw HelperError(.sttFailed, "Kein kompatibles Audioformat für die Erkennung gefunden.")
        }

        let (inputSequence, continuation) = AsyncStream<AnalyzerInput>.makeStream()
        let analyzer = SpeechAnalyzer(modules: [transcriber], options: nil)
        let context = AnalysisContext()
        if !contextualStrings.isEmpty {
            context.contextualStrings[.general] = contextualStrings
        }

        let stream = AnalyzerStream(
            id: id, writer: writer, transcriber: transcriber, analyzer: analyzer, continuation: continuation,
            onEnded: onEnded)

        do {
            try await analyzer.setContext(context)
            try await analyzer.prepareToAnalyze(in: analyzerFormat)
        } catch {
            continuation.finish()
            throw HelperError(.sttFailed, "Erkennung konnte nicht vorbereitet werden: \(HelperError.describe(error))")
        }

        stream.resultsTask = Task { await stream.consumeResults() }

        do {
            try await analyzer.start(inputSequence: inputSequence)
        } catch {
            continuation.finish()
            stream.resultsTask?.cancel()
            throw HelperError(.sttFailed, "Erkennung konnte nicht gestartet werden: \(HelperError.describe(error))")
        }

        let mic = stream.mic
        let meter = stream.meter
        let converter: BufferConverter
        do {
            converter = try BufferConverter(from: mic.inputFormat, to: analyzerFormat)
        } catch {
            await stream.cancel(reason: "error", message: "Audioformat kann nicht konvertiert werden.", notify: false)
            throw error
        }
        let conversionFailed = OnceFlag()
        do {
            try mic.start { buffer in
                meter.update(buffer)
                do {
                    if let converted = try converter.convert(buffer) {
                        continuation.yield(AnalyzerInput(buffer: converted))
                    }
                } catch {
                    if conversionFailed.claim() {
                        HelperLog.warn("Audio-Konvertierung fehlgeschlagen: \(HelperError.describe(error))")
                    }
                }
            }
        } catch {
            await stream.cancel(reason: "error", message: nil, notify: false)
            throw error
        }

        stream.levelTask = LevelReporter.start(
            event: "stt.level", stream: id, meter: meter, writer: writer, intervalMs: 100)
        return stream
    }

    private func consumeResults() async {
        do {
            for try await result in transcriber.results {
                let text = String(result.text.characters)
                let event = result.isFinal ? "stt.final" : "stt.partial"
                await writer.send(Event(event, stream: id, data: ["text": .string(text)]))
            }
        } catch is CancellationError {
            // stop()/cancel() haben übernommen.
        } catch {
            await finish(reason: "error", message: "Erkennung abgebrochen: \(HelperError.describe(error))", notify: true)
        }
    }

    func stop() async {
        mic.stop()
        levelTask?.cancel()
        continuation.finish()
        do {
            try await withTimeout(seconds: 8) { [analyzer] in
                try await analyzer.finalizeAndFinishThroughEndOfInput()
            }
        } catch {
            await analyzer.cancelAndFinishNow()
        }
        if let resultsTask {
            // Nach dem Finish endet die Ergebnisfolge; zur Sicherheit begrenzt warten.
            _ = try? await withTimeout(seconds: 3) { await resultsTask.value }
            resultsTask.cancel()
        }
        await finish(reason: "stopped", message: nil, notify: false)
    }

    func cancel(reason: String) async {
        await cancel(reason: reason, message: nil, notify: false)
    }

    private func cancel(reason: String, message: String?, notify: Bool) async {
        mic.stop()
        levelTask?.cancel()
        continuation.finish()
        await analyzer.cancelAndFinishNow()
        resultsTask?.cancel()
        await finish(reason: reason, message: message, notify: notify)
    }

    /// Sendet `stt.ended` genau einmal; `notify` meldet dem Register, dass
    /// der Stream von selbst endete.
    private func finish(reason: String, message: String?, notify: Bool) async {
        guard ended.claim() else { return }
        mic.stop()
        levelTask?.cancel()
        var data: [String: JSONValue] = ["reason": .string(reason)]
        if let message { data["message"] = .string(message) }
        await writer.send(Event("stt.ended", stream: id, data: .object(data)))
        if notify { onEnded(id, ObjectIdentifier(self)) }
    }
}

// MARK: - Legacy-Stream (SFSpeechRecognizer, macOS 14/15)

final class LegacyStream: SpeechStream, @unchecked Sendable {
    let id: String
    private let writer: OutputWriter
    private let emitter: SerialEmitter
    private let recognizer: SFSpeechRecognizer
    private let request: SFSpeechAudioBufferRecognitionRequest
    private let mic = MicrophoneCapture()
    private let meter = LevelMeter()
    private let ended = OnceFlag()
    private let onEnded: @Sendable (String, ObjectIdentifier) -> Void
    private let lock = NSLock()
    private var task: SFSpeechRecognitionTask?
    private var levelTask: Task<Void, Never>?
    private var completed = false
    private var stopping = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    private init(
        id: String, writer: OutputWriter, recognizer: SFSpeechRecognizer,
        request: SFSpeechAudioBufferRecognitionRequest,
        onEnded: @escaping @Sendable (String, ObjectIdentifier) -> Void
    ) {
        self.id = id
        self.writer = writer
        self.emitter = SerialEmitter(writer: writer)
        self.recognizer = recognizer
        self.request = request
        self.onEnded = onEnded
    }

    static func start(
        id: String, locale: Locale, contextualStrings: [String], writer: OutputWriter,
        onEnded: @escaping @Sendable (String, ObjectIdentifier) -> Void
    ) throws -> LegacyStream {
        guard let recognizer = SFSpeechRecognizer(locale: locale) else {
            throw HelperError(.sttUnavailable, "Die Sprache „\(locale.identifier(.bcp47))“ wird nicht unterstützt.")
        }
        guard recognizer.supportsOnDeviceRecognition else {
            throw HelperError(
                .sttAssetsMissing,
                "Für „\(locale.identifier(.bcp47))“ gibt es kein Modell auf dem Gerät (Systemeinstellungen → Tastatur → Diktat).")
        }
        guard recognizer.isAvailable else {
            throw HelperError(.sttUnavailable, "Die Spracherkennung ist gerade nicht verfügbar.")
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = true
        request.taskHint = .dictation
        if !contextualStrings.isEmpty {
            request.contextualStrings = contextualStrings
        }

        let stream = LegacyStream(id: id, writer: writer, recognizer: recognizer, request: request, onEnded: onEnded)
        let task = recognizer.recognitionTask(with: request) { result, error in
            stream.handle(result: result, error: error)
        }
        stream.lock.lock()
        stream.task = task
        stream.lock.unlock()

        let meter = stream.meter
        do {
            try stream.mic.start { buffer in
                meter.update(buffer)
                stream.request.append(buffer)
            }
        } catch {
            task.cancel()
            throw error
        }
        stream.levelTask = LevelReporter.start(
            event: "stt.level", stream: id, meter: meter, writer: writer, intervalMs: 100)
        return stream
    }

    private func handle(result: SFSpeechRecognitionResult?, error: (any Error)?) {
        if let result {
            let text = result.bestTranscription.formattedString
            let event = result.isFinal ? "stt.final" : "stt.partial"
            emitter.emit(Event(event, stream: id, data: ["text": .string(text)]))
            if result.isFinal {
                markCompleted()
            }
        }
        if let error {
            let wasStopping: Bool
            lock.lock()
            wasStopping = stopping
            lock.unlock()
            markCompleted()
            // Beim Stoppen sind „kein Sprachsignal“ und „abgebrochen“ normal.
            if !wasStopping && !SpeechService.isNoSpeechError(error) {
                Task { await self.finish(reason: "error", message: "Erkennung abgebrochen: \(HelperError.describe(error))", notify: true) }
            }
        }
    }

    private func markCompleted() {
        lock.lock()
        completed = true
        let pending = waiters
        waiters = []
        lock.unlock()
        for waiter in pending {
            waiter.resume()
        }
    }

    private func completion() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            lock.lock()
            if completed {
                lock.unlock()
                continuation.resume()
                return
            }
            waiters.append(continuation)
            lock.unlock()
        }
    }

    func stop() async {
        let task = lock.withLock {
            stopping = true
            return task
        }
        mic.stop()
        levelTask?.cancel()
        request.endAudio()
        do {
            try await withTimeout(seconds: 8) { await self.completion() }
        } catch {
            task?.cancel()
        }
        await emitter.drain()
        await finish(reason: "stopped", message: nil, notify: false)
    }

    func cancel(reason: String) async {
        let task = lock.withLock {
            stopping = true
            return task
        }
        mic.stop()
        levelTask?.cancel()
        task?.cancel()
        markCompleted()
        await emitter.drain()
        await finish(reason: reason, message: nil, notify: false)
    }

    private func finish(reason: String, message: String?, notify: Bool) async {
        guard ended.claim() else { return }
        mic.stop()
        levelTask?.cancel()
        var data: [String: JSONValue] = ["reason": .string(reason)]
        if let message { data["message"] = .string(message) }
        await writer.send(Event("stt.ended", stream: id, data: .object(data)))
        if notify { onEnded(id, ObjectIdentifier(self)) }
    }
}

// MARK: - Kommandos

enum SpeechCommands {
    static func register(into table: inout [String: CommandHandler], services: Services) {
        table["stt.status"] = { request in
            let locale = try request.params.optionalString("locale") ?? defaultLocale()
            return await services.speech.status(locale: locale)
        }
        table["stt.prepare"] = { request in
            let locale = try request.params.optionalString("locale") ?? defaultLocale()
            return try await services.speech.prepare(locale: locale)
        }
        table["stt.file"] = { request in
            let path = try request.params.string("path")
            let locale = try request.params.optionalString("locale") ?? defaultLocale()
            let contextual = try request.params.stringArray("contextualStrings")
            return try await services.speech.transcribeFile(path: path, locale: locale, contextualStrings: contextual)
        }
        table["stt.start"] = { request in
            let stream = try request.params.string("stream")
            let locale = try request.params.optionalString("locale") ?? defaultLocale()
            let contextual = try request.params.stringArray("contextualStrings")
            let source = try request.params.optionalString("source") ?? "microphone"
            return try await services.speech.start(
                stream: stream, locale: locale, contextualStrings: contextual, source: source)
        }
        table["stt.stop"] = { request in
            let stream = try request.params.string("stream")
            return try await services.speech.stop(stream: stream)
        }
    }

    /// Erste bevorzugte Sprache des Nutzers als BCP-47 („de-DE“), ohne
    /// Unicode-Erweiterungen (`Locale.current` liefert z. B. „en-US-u-rg-dezzzz“).
    static func defaultLocale() -> String {
        let preferred = Locale.preferredLanguages.first ?? Locale.current.identifier(.bcp47)
        if let range = preferred.range(of: "-u-") {
            return String(preferred[..<range.lowerBound])
        }
        return preferred
    }
}

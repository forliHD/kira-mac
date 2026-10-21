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

/// Dieselbe `SpeechTranscriber`-Konfiguration für Status, Download und
/// Erkennung. `AssetInventory` hängt am Modul: `preset: .transcription` und
/// der Options-Initialisierer sind verschiedene Assets. Status mit dem Preset
/// sagte deshalb „fehlt“, während die Erkennung ein anderes Modul prüfte –
/// und ein Download des Presets befriedigte den Stream nicht.
@available(macOS 26, *)
enum AnalyzerModels {
    static func stream(locale: Locale) -> SpeechTranscriber {
        SpeechTranscriber(
            locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults, .fastResults],
            attributeOptions: [])
    }

    static func file(locale: Locale) -> SpeechTranscriber {
        SpeechTranscriber(
            locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [])
    }

    static func all(locale: Locale) -> [SpeechTranscriber] {
        [stream(locale: locale), file(locale: locale)]
    }
}

/// KVO-Fortschritt eines Downloads, threadsicher, ohne den Actor zu blockieren.
final class DownloadFractionBox: @unchecked Sendable {
    private let lock = NSLock()
    private var fraction = 0.0

    func set(_ value: Double) {
        lock.lock()
        fraction = value
        lock.unlock()
    }

    func get() -> Double {
        lock.lock()
        defer { lock.unlock() }
        return fraction
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
            return self.report(
                available: false, engine: nil, assets: "missing", code: "unsupported_os",
                downloadable: false, locale: localeId, assetState: "none", progress: nil,
                reason: Self.noEngineReason())
        }
        switch engine {
        case .analyzer:
            if #available(macOS 26, *) {
                return await analyzerStatus(localeId: localeId)
            }
            return self.report(
                available: false, engine: nil, assets: "missing", code: "unsupported_os",
                downloadable: false, locale: localeId, assetState: "none", progress: nil,
                reason: Self.noEngineReason())
        case .legacy:
            return legacyStatus(localeId: localeId)
        }
    }

    /// Warum es auf diesem Mac gar keine On-Device-Erkennung gibt – mit
    /// Version, Chip und Architektur, damit das Protokoll die Ursache zeigt.
    private static func noEngineReason() -> String {
        let os = SystemInfo.macOSVersion
        let arch = SystemInfo.arch
        let chip = SystemInfo.chip
        if !SystemInfo.isAppleSilicon {
            return "Diktat-Modell fehlt: Dieser Mac (\(chip), \(arch), macOS \(os)) hat keinen Apple-Chip. Die Erkennung auf dem Gerät braucht Apple Silicon."
        }
        if !SystemInfo.isAtLeast(major: 26) {
            return "Diktat-Modell fehlt: macOS \(os) (\(chip), \(arch)) kann das Modell nicht selbst laden. Unter Systemeinstellungen → Tastatur → Diktat die Sprache hinzufügen. Der automatische Download gibt es ab macOS 26."
        }
        return "Diktat-Modell fehlt: SpeechAnalyzer ist auf diesem Mac nicht verfügbar (macOS \(os), \(chip), \(arch)). Häufig: Apple Intelligence ist aus, der Mac ist für das Modell zu alt, oder eine Geräteverwaltung sperrt die Spracherkennung."
    }

    private func report(
        available: Bool, engine: String?, assets: String, code: String, downloadable: Bool,
        locale: String, assetState: String, progress: Double?, reason: String?
    ) -> JSONValue {
        let speech = permissions.speechStatus(analyzerEngine: engine == "analyzer").rawValue
        let microphone = permissions.microphoneStatus().rawValue
        let preferred = Locale.preferredLanguages.prefix(3).joined(separator: ",")
        // Jeder nicht bereite Stand ins Protokoll: auf dem betroffenen Mac
        // sieht man OS, Chip, Sprache und den Rohzustand des Modells.
        if !available {
            HelperLog.info(
                "stt_status locale=\(locale) engine=\(engine ?? "none") assets=\(assets) code=\(code) assetState=\(assetState) os=\(SystemInfo.macOSVersion) arch=\(SystemInfo.arch) chip=\(SystemInfo.chip) speech=\(speech) mic=\(microphone) preferred=\(preferred) downloadable=\(downloadable)"
            )
        }
        return [
            "available": .bool(available),
            "engine": .optionalString(engine),
            "assets": .string(assets),
            "reason": .optionalString(reason),
            "code": .string(code),
            "downloadable": .bool(downloadable),
            "locale": .string(locale),
            "progress": progress.map { .double($0) } ?? .null,
            "diagnostics": [
                "macos": .string(SystemInfo.macOSVersion),
                "arch": .string(SystemInfo.arch),
                "chip": .string(SystemInfo.chip),
                "locale": .string(locale),
                "preferred": .string(preferred),
                "assetState": .string(assetState),
                "speech": .string(speech),
                "microphone": .string(microphone),
                "downloadable": .bool(downloadable),
            ],
        ]
    }

    @available(macOS 26, *)
    private func analyzerStatus(localeId: String) async -> JSONValue {
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeId))
        else {
            return self.report(
                available: false, engine: "analyzer", assets: "missing", code: "unsupported_locale",
                downloadable: false, locale: localeId, assetState: "unsupported", progress: nil,
                reason: "Diktat-Modell fehlt: Die Sprache „\(localeId)“ wird von der Spracherkennung nicht unterstützt. Wähle unter Einstellungen → Diktat eine angebotene Sprache.")
        }
        // Reservieren lädt nicht, holt aber ein schon vorhandenes System-Modell
        // in den Status „installed“. Sonst bleibt der Stand auf „supported“
        // (fehlt), obwohl macOS die Sprache längst diktiert.
        var states = await Self.assetStates(locale: locale)
        if states.stream != .installed || states.file != .installed {
            do {
                _ = try await AssetInventory.reserve(locale: locale)
            } catch {
                HelperLog.warn("Sprache \(localeId) konnte nicht reserviert werden: \(SpeechDownloadError.explain(error, locale: localeId))")
            }
            states = await Self.assetStates(locale: locale)
        }
        let assetState = states.label
        if states.stream == .installed && states.file == .installed {
            return self.report(
                available: true, engine: "analyzer", assets: "installed", code: "ok",
                downloadable: true, locale: localeId, assetState: assetState, progress: nil, reason: nil)
        }
        if states.stream == .unsupported || states.file == .unsupported {
            return self.report(
                available: false, engine: "analyzer", assets: "missing", code: "unsupported_locale",
                downloadable: false, locale: localeId, assetState: assetState, progress: nil,
                reason: "Diktat-Modell fehlt: Die Sprache „\(localeId)“ wird von der Spracherkennung nicht unterstützt.")
        }
        if states.stream == .downloading || states.file == .downloading {
            return self.report(
                available: false, engine: "analyzer", assets: "downloading", code: "downloading",
                downloadable: true, locale: localeId, assetState: assetState, progress: nil,
                reason: "Diktat-Modell für „\(localeId)“ wird geladen.")
        }
        return self.report(
            available: false, engine: "analyzer", assets: "missing", code: "assets_missing",
            downloadable: true, locale: localeId, assetState: assetState, progress: nil,
            reason: "Diktat-Modell fehlt: Für „\(localeId)“ ist auf diesem Mac noch keines installiert.")
    }

    @available(macOS 26, *)
    private static func assetStates(locale: Locale) async -> (stream: AssetInventory.Status, file: AssetInventory.Status, label: String) {
        let stream = await AssetInventory.status(forModules: [AnalyzerModels.stream(locale: locale)])
        let file = await AssetInventory.status(forModules: [AnalyzerModels.file(locale: locale)])
        let label = stream == file ? Self.assetStateName(stream) : "stream=\(Self.assetStateName(stream)),file=\(Self.assetStateName(file))"
        return (stream, file, label)
    }

    @available(macOS 26, *)
    private static func assetStateName(_ status: AssetInventory.Status) -> String {
        switch status {
        case .installed: return "installed"
        case .downloading: return "downloading"
        case .supported: return "supported"
        case .unsupported: return "unsupported"
        @unknown default: return "unknown"
        }
    }

    private func legacyStatus(localeId: String) -> JSONValue {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId)) else {
            return self.report(
                available: false, engine: "legacy", assets: "missing", code: "unsupported_locale",
                downloadable: false, locale: localeId, assetState: "unsupported", progress: nil,
                reason: "Diktat-Modell fehlt: Die Sprache „\(localeId)“ wird von der Spracherkennung nicht unterstützt.")
        }
        guard recognizer.supportsOnDeviceRecognition else {
            return self.report(
                available: false, engine: "legacy", assets: "missing", code: "assets_missing",
                downloadable: false, locale: localeId, assetState: "missing", progress: nil,
                reason: "Diktat-Modell fehlt: Für „\(localeId)“ gibt es auf diesem macOS keinen Download aus der App. Bitte die Sprache unter Systemeinstellungen → Tastatur → Diktat hinzufügen.")
        }
        guard recognizer.isAvailable else {
            return self.report(
                available: false, engine: "legacy", assets: "installed", code: "unavailable",
                downloadable: false, locale: localeId, assetState: "installed", progress: nil,
                reason: "Die Spracherkennung ist gerade nicht verfügbar.")
        }
        return self.report(
            available: true, engine: "legacy", assets: "installed", code: "ok",
            downloadable: false, locale: localeId, assetState: "installed", progress: nil, reason: nil)
    }

    func prepare(locale localeId: String) async throws -> JSONValue {
        guard let engine = engine() else {
            throw HelperError(.sttUnavailable, Self.noEngineReason(), reason: "unsupported_os")
        }
        switch engine {
        case .analyzer:
            if #available(macOS 26, *) {
                let locale = try await Self.resolveAnalyzerLocale(localeId)
                try await installAnalyzerAssets(locale: locale, localeId: localeId)
                return ["assets": "installed"]
            }
            throw HelperError(.sttUnavailable, Self.noEngineReason(), reason: "unsupported_os")
        case .legacy:
            guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId)) else {
                throw HelperError(.sttUnavailable, "Die Sprache „\(localeId)“ wird nicht unterstützt.", reason: "unsupported_locale")
            }
            guard recognizer.supportsOnDeviceRecognition else {
                throw HelperError(
                    .sttAssetsMissing,
                    "Diktat-Modell fehlt: Für „\(localeId)“ gibt es auf diesem macOS keinen Download aus der App. Bitte die Sprache unter Systemeinstellungen → Tastatur → Diktat hinzufügen.",
                    reason: "unsupported_os")
            }
            return ["assets": "installed"]
        }
    }

    /// Lädt Stream- und Datei-Modul. Ein `nil` von `assetInstallationRequest`
    /// heißt nur „nichts zu tun“, wenn der Stand danach wirklich `installed`
    /// ist – sonst ist das der Fehler, nicht ein Erfolg.
    @available(macOS 26, *)
    private func installAnalyzerAssets(locale: Locale, localeId: String) async throws {
        if await Self.bothInstalled(locale) { return }
        do {
            _ = try await AssetInventory.reserve(locale: locale)
        } catch {
            HelperLog.warn("Sprache \(localeId) konnte nicht reserviert werden: \(SpeechDownloadError.explain(error, locale: localeId))")
        }
        if await Self.bothInstalled(locale) {
            HelperLog.info("stt_status Diktat-Modell für \(localeId) war nach dem Reservieren schon vorhanden.")
            return
        }
        let modules = AnalyzerModels.all(locale: locale)
        do {
            guard let request = try await AssetInventory.assetInstallationRequest(supporting: modules) else {
                try await noInstallationRequest(locale: locale, localeId: localeId)
                return
            }
            try await download(request, locale: locale, localeId: localeId)
        } catch let error as HelperError {
            throw error
        } catch {
            throw HelperError(.sttAssetsMissing, SpeechDownloadError.explain(error, locale: localeId), reason: SpeechDownloadError.reasonCode(error))
        }
    }

    /// `nil` bedeutet „bereits da“ nur, wenn der Stand das danach bestätigt.
    @available(macOS 26, *)
    private func noInstallationRequest(locale: Locale, localeId: String) async throws {
        if await Self.bothInstalled(locale) { return }
        let states = await Self.assetStates(locale: locale)
        if states.stream == .downloading || states.file == .downloading {
            try await waitUntilInstalled(locale: locale, localeId: localeId)
            return
        }
        throw HelperError(
            .sttAssetsMissing,
            "Diktat-Modell fehlt: Apple hat für „\(localeId)“ keinen Download erzeugt (Modellzustand \(states.label), macOS \(SystemInfo.macOSVersion), \(SystemInfo.arch), \(SystemInfo.chip)). Prüfe die Sprache und ob eine Geräteverwaltung den Modell-Download sperrt.",
            reason: "no_request")
    }

    @available(macOS 26, *)
    private func download(
        _ request: AssetInstallationRequest, locale: Locale, localeId: String
    ) async throws {
        HelperLog.info("stt_status Lade Diktat-Modell für \(localeId) …")
        let box = DownloadFractionBox()
        let observation = request.progress.observe(\.fractionCompleted, options: [.initial, .new]) { progress, _ in
            box.set(progress.fractionCompleted)
        }
        let writer = self.writer
        let pump = Task {
            var last = -1.0
            while !Task.isCancelled {
                let fraction = min(1, max(0, box.get()))
                if last < 0 || fraction - last >= 0.01 {
                    last = fraction
                    await writer.send(Event(
                        "stt.progress",
                        data: ["locale": .string(localeId), "fraction": .double(fraction)]))
                }
                try? await Task.sleep(for: .milliseconds(400))
            }
        }
        defer {
            pump.cancel()
            observation.invalidate()
        }
        do {
            try await request.downloadAndInstall()
        } catch let error as HelperError {
            throw error
        } catch {
            throw HelperError(.sttAssetsMissing, SpeechDownloadError.explain(error, locale: localeId), reason: SpeechDownloadError.reasonCode(error))
        }
        guard await Self.bothInstalled(locale) else {
            let states = await Self.assetStates(locale: locale)
            throw HelperError(
                .sttAssetsMissing,
                "Das Diktat-Modell für „\(localeId)“ ist nach dem Download nicht installiert (Zustand \(states.label), macOS \(SystemInfo.macOSVersion), \(SystemInfo.arch)).",
                reason: "not_installed")
        }
        HelperLog.info("stt_status Diktat-Modell für \(localeId) installiert.")
    }

    @available(macOS 26, *)
    private static func bothInstalled(_ locale: Locale) async -> Bool {
        let states = await assetStates(locale: locale)
        return states.stream == .installed && states.file == .installed
    }

    /// Ein schon laufender System-Download: warten, statt einen zweiten zu starten.
    @available(macOS 26, *)
    private func waitUntilInstalled(locale: Locale, localeId: String) async throws {
        let deadline = ContinuousClock.now + .seconds(600)
        while ContinuousClock.now < deadline {
            let states = await Self.assetStates(locale: locale)
            if states.stream == .installed && states.file == .installed { return }
            if states.stream == .unsupported || states.file == .unsupported {
                throw HelperError(
                    .sttUnavailable,
                    "Diktat-Modell fehlt: Die Sprache „\(localeId)“ wird von der Spracherkennung nicht unterstützt.",
                    reason: "unsupported_locale")
            }
            if states.stream != .downloading && states.file != .downloading {
                throw HelperError(
                    .sttAssetsMissing,
                    "Das Diktat-Modell für „\(localeId)“ wird nicht mehr geladen (Zustand \(states.label)).",
                    reason: "failed")
            }
            try await Task.sleep(for: .seconds(1))
        }
        throw HelperError(
            .sttAssetsMissing,
            "Das Diktat-Modell für „\(localeId)“ wurde nicht fertig geladen (Zeitüberschreitung).",
            reason: "failed")
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

        let transcriber = AnalyzerModels.file(locale: locale)
        guard await AssetInventory.status(forModules: [transcriber]) == .installed else {
            throw HelperError(
                .sttAssetsMissing,
                "Diktat-Modell fehlt: Für „\(locale.identifier(.bcp47))“ ist noch keines installiert.")
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
        let transcriber = AnalyzerModels.stream(locale: locale)
        guard await AssetInventory.status(forModules: [transcriber]) == .installed else {
            throw HelperError(
                .sttAssetsMissing,
                "Diktat-Modell fehlt: Für „\(locale.identifier(.bcp47))“ ist noch keines installiert.")
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

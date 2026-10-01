import AVFoundation
import AppKit
import CoreMedia
import Foundation
import ScreenCaptureKit

/// Systemton-Aufnahme über ScreenCaptureKit (nur Audio; das Bild wird auf
/// 2×2 Pixel bei 1 fps gedrückt und nie abonniert): `audio.system.start`,
/// `audio.system.stop`. Schreibt WAV 48 kHz (16 Bit) und meldet `audio.level`
/// etwa 5× pro Sekunde. Braucht die Freigabe „Bildschirmaufnahme“.
actor SystemAudioRecorder {
    private let writer: OutputWriter
    private var recordings: [String: SystemAudioRecording] = [:]

    init(writer: OutputWriter) {
        self.writer = writer
    }

    func start(stream id: String, path: String, excludeSelf: Bool, excludeBundleIds: [String]) async throws
        -> JSONValue
    {
        guard PermissionsService.screenCaptureGranted() else {
            throw HelperError(
                .permissionDenied,
                "Keine Freigabe für Bildschirmaufnahme. Der Systemton wird über die Bildschirmaufnahme-Schnittstelle erfasst – bitte unter „Datenschutz & Sicherheit → Bildschirmaufnahme“ erlauben.",
                reason: "screenRecording")
        }
        if let existing = recordings.removeValue(forKey: id) {
            _ = try? await existing.stop()
        }

        let url = URL(fileURLWithPath: path)
        let directory = url.deletingLastPathComponent()
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            throw HelperError(.audioFailed, "Zielordner konnte nicht angelegt werden: \(HelperError.describe(error))")
        }

        let recording = try await SystemAudioRecording.start(
            id: id, url: url, excludeSelf: excludeSelf, excludeBundleIds: excludeBundleIds, writer: writer)
        recordings[id] = recording
        return ["started": true]
    }

    func stop(stream id: String) async throws -> JSONValue {
        guard let recording = recordings.removeValue(forKey: id) else {
            throw HelperError.badParams("Keine laufende Aufnahme „\(id)“.")
        }
        let summary = try await recording.stop()
        return [
            "path": .string(summary.path),
            "durationMs": .int(summary.durationMs),
            "bytes": .int(summary.bytes),
        ]
    }

    func stopAll() async {
        let active = recordings
        recordings = [:]
        for recording in active.values {
            _ = try? await recording.stop()
        }
    }
}

/// Eine laufende Aufnahme: SCStream + WAV-Datei. Die Rückrufe kommen auf der
/// eigenen seriellen Queue; `stop()` wartet, bis der Stream steht, bevor die
/// Datei geschlossen wird.
final class SystemAudioRecording: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    struct Summary: Sendable {
        let path: String
        let durationMs: Int
        let bytes: Int
    }

    private static let sampleRate = 48_000.0
    private static let channels: AVAudioChannelCount = 2

    let id: String
    private let url: URL
    private let writer: OutputWriter
    private let queue = DispatchQueue(label: "de.kira.helper.system-audio")
    private let lock = NSLock()
    private let meter = LevelMeter()
    private var stream: SCStream?
    private var file: AVAudioFile?
    private var framesWritten: Int64 = 0
    private var writeError: (any Error)?
    private var streamError: (any Error)?
    private var levelTask: Task<Void, Never>?

    private init(id: String, url: URL, writer: OutputWriter) {
        self.id = id
        self.url = url
        self.writer = writer
    }

    static func start(
        id: String, url: URL, excludeSelf: Bool, excludeBundleIds: [String], writer: OutputWriter
    ) async throws -> SystemAudioRecording {
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        } catch {
            throw HelperError(.audioFailed, "Bildschirminhalte konnten nicht abgefragt werden: \(HelperError.describe(error))")
        }
        guard let display = content.displays.first else {
            throw HelperError(.audioFailed, "Kein Bildschirm für die Systemton-Aufnahme gefunden.")
        }

        // `excludeSelf`: die Mac-App (der Elternprozess des Helfers) und ihre
        // Hilfsprozesse (gleiches Bundle-Präfix) werden aus dem Filter
        // genommen — ihr Ton (z. B. Vorlesen) landet dann nicht in der Aufnahme.
        var excludedApps: [SCRunningApplication] = []
        var excludedIds = Set(excludeBundleIds)
        if excludeSelf, let parentBundle = NSRunningApplication(processIdentifier: getppid())?.bundleIdentifier {
            excludedIds.insert(parentBundle)
        }
        if !excludedIds.isEmpty {
            excludedApps = content.applications.filter { app in
                excludedIds.contains { prefix in
                    app.bundleIdentifier == prefix || app.bundleIdentifier.hasPrefix(prefix + ".")
                }
            }
        }
        let filter = SCContentFilter(display: display, excludingApplications: excludedApps, exceptingWindows: [])

        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = true
        configuration.excludesCurrentProcessAudio = excludeSelf
        configuration.sampleRate = Int(sampleRate)
        configuration.channelCount = Int(channels)
        // Video so klein wie möglich; die Bildpuffer werden nie abonniert.
        configuration.width = 2
        configuration.height = 2
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        configuration.showsCursor = false
        configuration.queueDepth = 3

        let recording = SystemAudioRecording(id: id, url: url, writer: writer)
        let stream = SCStream(filter: filter, configuration: configuration, delegate: recording)
        do {
            try stream.addStreamOutput(recording, type: .audio, sampleHandlerQueue: recording.queue)
            try await stream.startCapture()
        } catch {
            throw HelperError(.audioFailed, "Systemton-Aufnahme konnte nicht gestartet werden: \(HelperError.describe(error))")
        }
        recording.lock.withLock {
            recording.stream = stream
        }
        recording.levelTask = LevelReporter.start(
            event: "audio.level", stream: id, meter: recording.meter, writer: writer, intervalMs: 200)
        HelperLog.info("Systemton-Aufnahme \(id) gestartet.")
        return recording
    }

    // MARK: SCStreamOutput

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid, sampleBuffer.numSamples > 0 else { return }
        guard let description = sampleBuffer.formatDescription else { return }
        let format = AVAudioFormat(cmAudioFormatDescription: description)

        do {
            try sampleBuffer.withAudioBufferList { bufferList, _ in
                guard let pcm = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: bufferList.unsafePointer)
                else { return }
                meter.update(pcm)
                try write(pcm, format: format)
            }
        } catch {
            lock.lock()
            let firstError = writeError == nil
            writeError = error
            lock.unlock()
            if firstError {
                HelperLog.error("Systemton: Schreiben fehlgeschlagen: \(HelperError.describe(error))")
            }
        }
    }

    /// Öffnet die WAV-Datei beim ersten Puffer im Verarbeitungsformat des
    /// Streams (Float32), auf der Platte 16 Bit PCM.
    private func write(_ buffer: AVAudioPCMBuffer, format: AVAudioFormat) throws {
        lock.lock()
        defer { lock.unlock() }
        if file == nil {
            guard format.commonFormat != .otherFormat else {
                throw HelperError(.audioFailed, "Unbekanntes Audioformat des Systemtons.")
            }
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: format.sampleRate,
                AVNumberOfChannelsKey: Int(format.channelCount),
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsNonInterleaved: false,
            ]
            file = try AVAudioFile(
                forWriting: url, settings: settings, commonFormat: format.commonFormat,
                interleaved: format.isInterleaved)
        }
        guard let file else { return }
        try file.write(from: buffer)
        framesWritten += Int64(buffer.frameLength)
    }

    // MARK: SCStreamDelegate

    func stream(_ stream: SCStream, didStopWithError error: any Error) {
        lock.lock()
        streamError = error
        lock.unlock()
        HelperLog.error("Systemton-Aufnahme \(id) unerwartet beendet: \(HelperError.describe(error))")
    }

    // MARK: Stop

    func stop() async throws -> Summary {
        levelTask?.cancel()
        let (stream, streamError): (SCStream?, (any Error)?) = lock.withLock {
            let current = self.stream
            self.stream = nil
            return (current, self.streamError)
        }

        if let stream, streamError == nil {
            do {
                try await stream.stopCapture()
            } catch {
                HelperLog.warn("Systemton-Aufnahme \(id): Stoppen meldete: \(HelperError.describe(error))")
            }
        }

        // Nach stopCapture kommen keine Rückrufe mehr; Datei schließen.
        let (frames, sampleRate, writeError): (Int64, Double, (any Error)?) = queue.sync {
            lock.lock()
            defer { lock.unlock() }
            let rate = file?.processingFormat.sampleRate ?? Self.sampleRate
            file = nil
            return (framesWritten, rate, self.writeError)
        }

        let bytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
        let durationMs = sampleRate > 0 ? Int(Double(frames) / sampleRate * 1000) : 0
        HelperLog.info("Systemton-Aufnahme \(id) beendet: \(durationMs) ms, \(bytes) Bytes.")

        if let streamError {
            throw HelperError(
                .audioFailed,
                "Die Systemton-Aufnahme wurde vom System beendet: \(HelperError.describe(streamError)) (Datei: \(url.path), \(durationMs) ms)")
        }
        if let writeError {
            throw HelperError(
                .audioFailed,
                "Die Aufnahmedatei konnte nicht geschrieben werden: \(HelperError.describe(writeError))")
        }
        if frames == 0 {
            throw HelperError(
                .audioFailed,
                "Es kam kein Systemton an (Datei: \(url.path)). Läuft die Bildschirmaufnahme-Freigabe für diese App?")
        }
        return Summary(path: url.path, durationMs: durationMs, bytes: bytes)
    }
}

enum AudioCommands {
    static func register(into table: inout [String: CommandHandler], services: Services) {
        table["audio.system.start"] = { request in
            let stream = try request.params.string("stream")
            let path = try request.params.string("path")
            guard path.hasPrefix("/") else {
                throw HelperError.badParams("Parameter „path“ muss ein absoluter Pfad sein.")
            }
            let excludeSelf = try request.params.optionalBool("excludeSelf") ?? true
            let excludeBundleIds = try request.params.stringArray("excludeBundleIds")
            return try await services.audio.start(
                stream: stream, path: path, excludeSelf: excludeSelf, excludeBundleIds: excludeBundleIds)
        }
        table["audio.system.stop"] = { request in
            let stream = try request.params.string("stream")
            return try await services.audio.stop(stream: stream)
        }
    }
}

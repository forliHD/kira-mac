import AVFoundation
import Foundation

// Gemeinsame Audio-Bausteine für Spracherkennung und Systemton-Aufnahme.
// Hier fließen Audiodaten durch — sie werden nie protokolliert.

/// Mikrofon-Aufnahme über einen `AVAudioEngine`-Input-Tap. Der Handler
/// bekommt jeden Puffer im nativen Format des Eingabegeräts auf dem
/// Audio-Thread; er muss schnell zurückkehren.
final class MicrophoneCapture: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let lock = NSLock()
    private var running = false

    /// Natives Format des Eingabegeräts (Abtastrate 0 = kein Gerät).
    var inputFormat: AVAudioFormat {
        engine.inputNode.outputFormat(forBus: 0)
    }

    func start(handler: @escaping @Sendable (AVAudioPCMBuffer) -> Void) throws {
        lock.lock()
        defer { lock.unlock() }
        guard !running else { return }

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw HelperError(.sttFailed, "Kein Audio-Eingabegerät gefunden.")
        }

        input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
            handler(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            throw HelperError(
                .sttFailed, "Mikrofon konnte nicht gestartet werden: \(HelperError.describe(error))")
        }
        running = true
    }

    func stop() {
        lock.lock()
        defer { lock.unlock() }
        guard running else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        running = false
    }
}

/// Pegelmesser: merkt sich den höchsten RMS-Wert seit dem letzten `take()`.
/// `update` läuft auf dem Audio-Thread, `take` im Melde-Task.
final class LevelMeter: @unchecked Sendable {
    private let lock = NSLock()
    private var peak: Float = 0

    func update(_ buffer: AVAudioPCMBuffer) {
        let rms = Self.rms(of: buffer)
        lock.lock()
        peak = max(peak, rms)
        lock.unlock()
    }

    /// Liefert den Spitzenwert seit dem letzten Aufruf (0…1) und setzt zurück.
    func take() -> Float {
        lock.lock()
        defer {
            peak = 0
            lock.unlock()
        }
        return peak
    }

    /// RMS des ersten Kanals, normiert auf 0…1 (Float32 oder Int16).
    static func rms(of buffer: AVAudioPCMBuffer) -> Float {
        let frames = Int(buffer.frameLength)
        guard frames > 0 else { return 0 }
        var sum: Float = 0
        if let channels = buffer.floatChannelData {
            let samples = channels[0]
            let stride = buffer.format.isInterleaved ? Int(buffer.format.channelCount) : 1
            for i in 0..<frames {
                let v = samples[i * stride]
                sum += v * v
            }
        } else if let channels = buffer.int16ChannelData {
            let samples = channels[0]
            let stride = buffer.format.isInterleaved ? Int(buffer.format.channelCount) : 1
            for i in 0..<frames {
                let v = Float(samples[i * stride]) / 32768
                sum += v * v
            }
        } else {
            return 0
        }
        let value = (sum / Float(frames)).squareRoot()
        return min(1, max(0, value))
    }
}

/// Sendet in festem Takt den aktuellen Pegel als Ereignis (`stt.level`,
/// `audio.level`), bis der Task abgebrochen wird.
enum LevelReporter {
    static func start(
        event: String, stream: String, meter: LevelMeter, writer: OutputWriter, intervalMs: Int
    ) -> Task<Void, Never> {
        Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(intervalMs))
                if Task.isCancelled { break }
                let rms = Double(meter.take())
                await writer.send(Event(event, stream: stream, data: ["rms": .double(rms)]))
            }
        }
    }
}

/// Konvertiert Puffer vom Geräteformat in das Zielformat (Abtastrate, Kanäle,
/// Sample-Typ) mit einem fortlaufenden `AVAudioConverter`.
final class BufferConverter: @unchecked Sendable {
    private final class InputBox: @unchecked Sendable {
        let buffer: AVAudioPCMBuffer
        var consumed = false
        init(_ buffer: AVAudioPCMBuffer) { self.buffer = buffer }
    }

    private let converter: AVAudioConverter?
    private let outputFormat: AVAudioFormat

    init(from input: AVAudioFormat, to output: AVAudioFormat) throws {
        outputFormat = output
        if input == output {
            converter = nil
        } else {
            guard let converter = AVAudioConverter(from: input, to: output) else {
                throw HelperError(.sttFailed, "Audioformat kann nicht konvertiert werden.")
            }
            converter.primeMethod = .none
            self.converter = converter
        }
    }

    func convert(_ buffer: AVAudioPCMBuffer) throws -> AVAudioPCMBuffer? {
        guard let converter else { return buffer }
        let ratio = outputFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 64
        guard let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else {
            return nil
        }
        let box = InputBox(buffer)
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, outStatus in
            if box.consumed {
                outStatus.pointee = .noDataNow
                return nil
            }
            box.consumed = true
            outStatus.pointee = .haveData
            return box.buffer
        }
        if let error { throw error }
        if status == .error {
            throw HelperError(.sttFailed, "Audio-Konvertierung fehlgeschlagen.")
        }
        return output.frameLength > 0 ? output : nil
    }
}

/// Reiht Ereignisse aus synchronen Rückrufen (Audio-Thread, SFSpeech-Handler)
/// in der Reihenfolge ihres Eintreffens ein — `Task { await writer.send }`
/// allein garantiert keine Reihenfolge.
final class SerialEmitter: @unchecked Sendable {
    private let writer: OutputWriter
    private let lock = NSLock()
    private var tail: Task<Void, Never>?

    init(writer: OutputWriter) {
        self.writer = writer
    }

    func emit(_ event: Event) {
        lock.lock()
        defer { lock.unlock() }
        let previous = tail
        let writer = writer
        tail = Task {
            await previous?.value
            await writer.send(event)
        }
    }

    /// Wartet, bis alles bisher Eingereihte geschrieben ist.
    func drain() async {
        let pending = lock.withLock { tail }
        await pending?.value
    }
}

/// Zeitlimit für Operationen, die eine Abbruchanforderung ignorieren könnten:
/// nach Ablauf kommt `TimeoutError`, die Operation läuft abgebrochen weiter
/// (im Gegensatz zu einer Task-Gruppe wird nicht auf sie gewartet).
private final class TimeoutRaceState: @unchecked Sendable {
    private let lock = NSLock()
    private var claimed = false
    private var _timer: Task<Void, Never>?

    var timer: Task<Void, Never>? {
        get { lock.withLock { _timer } }
        set { lock.withLock { _timer = newValue } }
    }

    func claim() -> Bool {
        lock.withLock {
            if claimed { return false }
            claimed = true
            return true
        }
    }
}

func withTimeout<T: Sendable>(
    seconds: Double,
    _ operation: @escaping @Sendable () async throws -> T
) async throws -> T {
    let state = TimeoutRaceState()
    return try await withCheckedThrowingContinuation { continuation in
        let work = Task {
            do {
                let value = try await operation()
                if state.claim() {
                    state.timer?.cancel()
                    continuation.resume(returning: value)
                }
            } catch {
                if state.claim() {
                    state.timer?.cancel()
                    continuation.resume(throwing: error)
                }
            }
        }
        state.timer = Task {
            try? await Task.sleep(for: .seconds(seconds))
            if !Task.isCancelled, state.claim() {
                work.cancel()
                continuation.resume(throwing: TimeoutError())
            }
        }
    }
}

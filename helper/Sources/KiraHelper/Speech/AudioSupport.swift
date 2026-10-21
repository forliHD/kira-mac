import AVFoundation
import Foundation

// Gemeinsame Audio-Bausteine für Spracherkennung und Systemton-Aufnahme.
// Hier fließen Audiodaten durch — sie werden nie protokolliert.

/// Wie das Mikrofon geöffnet wird (Plan 21.10.2026, Phase 2): ein bestimmtes
/// Gerät (UID, sonst das Systemstandard-Mikrofon) und Apples Sprachfilter
/// (Voice Processing: Echo-Unterdrückung, Rauschfilter, Pegelregelung).
struct MicrophoneOptions: Sendable, Equatable {
    var deviceUID: String? = nil
    var voiceProcessing: Bool = false
}

/// Was `prepare` tatsächlich erreicht hat – fürs Protokoll und die Pille.
struct MicrophoneReport: Sendable, Equatable {
    var voiceProcessing: Bool
    /// Name des genutzten Geräts (nil = Systemstandard oder unbekannt).
    var device: String?

    var json: JSONValue {
        ["voiceProcessing": .bool(voiceProcessing), "device": .optionalString(device)]
    }
}

/// Mikrofon-Aufnahme über einen `AVAudioEngine`-Input-Tap. Der Handler
/// bekommt jeden Puffer im nativen Format des Eingabegeräts auf dem
/// Audio-Thread; er muss schnell zurückkehren.
///
/// Reihenfolge: `prepare(options:)` wählt Gerät und Sprachfilter und liefert
/// den Bericht (das Format ändert sich mit dem Sprachfilter!), dann baut der
/// Aufrufer seinen Konverter aus `inputFormat`, dann `start(handler:)`.
final class MicrophoneCapture: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let lock = NSLock()
    private var running = false
    private(set) var report = MicrophoneReport(voiceProcessing: false, device: nil)

    /// Natives Format des Eingabegeräts (Abtastrate 0 = kein Gerät).
    var inputFormat: AVAudioFormat {
        engine.inputNode.outputFormat(forBus: 0)
    }

    /// Gerät und Sprachfilter einstellen. Scheitert der Sprachfilter (bekannt:
    /// Aggregat-Gerät, Fehler -10876 auf manchen Macs), läuft es ohne weiter.
    @discardableResult
    func prepare(options: MicrophoneOptions) -> MicrophoneReport {
        lock.lock()
        defer { lock.unlock() }
        var report = MicrophoneReport(voiceProcessing: false, device: nil)
        let input = engine.inputNode
        if let uid = options.deviceUID {
            if let device = AudioInputDevices.device(forUID: uid), let unit = input.audioUnit {
                var deviceID = device.id
                let status = AudioUnitSetProperty(
                    unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &deviceID,
                    UInt32(MemoryLayout<AudioDeviceID>.size))
                if status == noErr {
                    report.device = device.name
                } else {
                    HelperLog.warn("Mikrofon „\(device.name)“ ließ sich nicht wählen (\(status)); Systemstandard.")
                }
            } else {
                HelperLog.warn("Mikrofon mit UID \(uid) nicht gefunden; Systemstandard.")
            }
        }
        if options.voiceProcessing {
            do {
                try input.setVoiceProcessingEnabled(true)
                report.voiceProcessing = true
                // Anderen Ton nur leicht dämpfen – das Diktat soll Musik nicht abwürgen.
                input.voiceProcessingOtherAudioDuckingConfiguration = AVAudioVoiceProcessingOtherAudioDuckingConfiguration(
                    enableAdvancedDucking: false, duckingLevel: .min)
            } catch {
                HelperLog.warn("Sprachfilter nicht verfügbar: \(HelperError.describe(error)); Aufnahme ohne.")
                try? input.setVoiceProcessingEnabled(false)
            }
        } else if input.isVoiceProcessingEnabled {
            try? input.setVoiceProcessingEnabled(false)
        }
        self.report = report
        return report
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
///
/// Live-Befund 21.10.2026 (0.6.0): Mit Apples Sprachfilter (Voice Processing)
/// liefert der Tap Puffer in einem ANDEREN Format als `inputNode.outputFormat`
/// vor dem Start meldete – der feste Konverter schwieg, die Erkennung bekam
/// nichts. Der Konverter folgt deshalb dem Format jedes Puffers und baut sich
/// bei einem Wechsel neu (einmal protokolliert, nie Audiodaten).
final class BufferConverter: @unchecked Sendable {
    private final class InputBox: @unchecked Sendable {
        let buffer: AVAudioPCMBuffer
        var consumed = false
        init(_ buffer: AVAudioPCMBuffer) { self.buffer = buffer }
    }

    private let lock = NSLock()
    private var converter: AVAudioConverter?
    private var inputFormat: AVAudioFormat
    private let outputFormat: AVAudioFormat

    init(from input: AVAudioFormat, to output: AVAudioFormat) throws {
        outputFormat = output
        inputFormat = input
        converter = try Self.make(from: input, to: output)
    }

    private static func make(from input: AVAudioFormat, to output: AVAudioFormat) throws -> AVAudioConverter? {
        if input == output { return nil }
        guard let converter = AVAudioConverter(from: input, to: output) else {
            throw HelperError(.sttFailed, "Audioformat kann nicht konvertiert werden.")
        }
        converter.primeMethod = .none
        return converter
    }

    static func describe(_ f: AVAudioFormat) -> String {
        "\(Int(f.sampleRate)) Hz, \(f.channelCount) Kanal/Kanäle, \(f.commonFormat.rawValue)\(f.isInterleaved ? " interleaved" : "")"
    }

    /// Einmal je Prozess, nicht je Diktat.
    nonisolated(unsafe) private static var channelsLogged = false

    /// Mehrkanalige Eingaben (der Sprachfilter liefert z. B. 9 Kanäle) selbst
    /// auf Mono mischen – `AVAudioConverter` lieferte dafür leere Puffer.
    static func mono(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        let channels = Int(buffer.format.channelCount)
        let frames = Int(buffer.frameLength)
        guard channels > 1, frames > 0,
            let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: buffer.format.sampleRate, channels: 1, interleaved: false),
            let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)),
            let dst = out.floatChannelData?[0]
        else { return nil }
        out.frameLength = AVAudioFrameCount(frames)
        let scale = 1 / Float(channels)
        if let src = buffer.floatChannelData {
            if buffer.format.isInterleaved {
                let base = src[0]
                for i in 0..<frames {
                    var sum: Float = 0
                    for c in 0..<channels { sum += base[i * channels + c] }
                    dst[i] = sum * scale
                }
            } else {
                for i in 0..<frames { dst[i] = 0 }
                for c in 0..<channels {
                    let ch = src[c]
                    for i in 0..<frames { dst[i] += ch[i] * scale }
                }
            }
            return out
        }
        if let src = buffer.int16ChannelData {
            let norm = scale / 32768
            if buffer.format.isInterleaved {
                let base = src[0]
                for i in 0..<frames {
                    var sum: Float = 0
                    for c in 0..<channels { sum += Float(base[i * channels + c]) }
                    dst[i] = sum * norm
                }
            } else {
                for i in 0..<frames { dst[i] = 0 }
                for c in 0..<channels {
                    let ch = src[c]
                    for i in 0..<frames { dst[i] += Float(ch[i]) * norm }
                }
            }
            return out
        }
        return nil
    }

    /// Pegel je Kanal (RMS), nur Zahlen – einmal protokolliert, um zu sehen, wo die Stimme liegt.
    private static func channelLevels(_ buffer: AVAudioPCMBuffer) -> [String] {
        let channels = Int(buffer.format.channelCount)
        let frames = Int(buffer.frameLength)
        guard let src = buffer.floatChannelData, frames > 0 else { return [] }
        return (0..<channels).map { c in
            var sum: Float = 0
            if buffer.format.isInterleaved {
                for i in 0..<frames { let v = src[0][i * channels + c]; sum += v * v }
            } else {
                for i in 0..<frames { let v = src[c][i]; sum += v * v }
            }
            return String(format: "%.4f", (sum / Float(frames)).squareRoot())
        }
    }

    func convert(_ raw: AVAudioPCMBuffer) throws -> AVAudioPCMBuffer? {
        var buffer = raw
        if raw.format.channelCount > 1 {
            if !Self.channelsLogged, LevelMeter.rms(of: raw) > 0.01 {
                Self.channelsLogged = true
                HelperLog.info("Kanalpegel der Eingabe: \(Self.channelLevels(raw).joined(separator: " "))")
            }
            if let mixed = Self.mono(raw) { buffer = mixed }
        }
        let converter: AVAudioConverter?
        lock.lock()
        if buffer.format != inputFormat {
            HelperLog.info("Eingabeformat gewechselt: \(Self.describe(inputFormat)) → \(Self.describe(buffer.format)); Konverter neu.")
            inputFormat = buffer.format
            self.converter = try Self.make(from: buffer.format, to: outputFormat)
        }
        converter = self.converter
        lock.unlock()
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

// MARK: - Eingabegeräte (CoreAudio)

struct AudioInputDevice: Sendable, Equatable {
    let id: AudioDeviceID
    let uid: String
    let name: String
    let isDefault: Bool

    var json: JSONValue {
        ["uid": .string(uid), "name": .string(name), "default": .bool(isDefault)]
    }
}

/// Liste der Mikrofone (Geräte mit Eingabekanälen) und Auflösung einer UID.
enum AudioInputDevices {
    private static func address(_ selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal)
        -> AudioObjectPropertyAddress
    {
        AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    }

    private static func string(_ id: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
        var addr = address(selector)
        var size = UInt32(MemoryLayout<CFString?>.size)
        var value: Unmanaged<CFString>?
        let status = withUnsafeMutablePointer(to: &value) { pointer in
            AudioObjectGetPropertyData(id, &addr, 0, nil, &size, pointer)
        }
        guard status == noErr, let value else { return nil }
        return value.takeRetainedValue() as String
    }

    private static func inputChannels(_ id: AudioObjectID) -> Int {
        var addr = address(kAudioDevicePropertyStreamConfiguration, scope: kAudioObjectPropertyScopeInput)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(id, &addr, 0, nil, &size) == noErr, size > 0 else { return 0 }
        let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { raw.deallocate() }
        guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, raw) == noErr else { return 0 }
        let list = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
        return list.reduce(0) { $0 + Int($1.mNumberChannels) }
    }

    static func defaultInputID() -> AudioDeviceID? {
        var addr = address(kAudioHardwarePropertyDefaultInputDevice)
        var id = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id) == noErr, id != 0
        else { return nil }
        return id
    }

    static func list() -> [AudioInputDevice] {
        var addr = address(kAudioHardwarePropertyDevices)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else { return [] }
        let count = Int(size) / MemoryLayout<AudioDeviceID>.size
        var ids = [AudioDeviceID](repeating: 0, count: count)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return [] }
        let defaultID = defaultInputID()
        return ids.compactMap { id in
            guard inputChannels(id) > 0, let uid = string(id, kAudioDevicePropertyDeviceUID) else { return nil }
            let name = string(id, kAudioObjectPropertyName) ?? uid
            return AudioInputDevice(id: id, uid: uid, name: name, isDefault: id == defaultID)
        }
    }

    static func device(forUID uid: String) -> AudioInputDevice? {
        list().first { $0.uid == uid }
    }
}

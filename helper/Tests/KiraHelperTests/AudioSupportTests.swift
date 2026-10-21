import AVFoundation
import XCTest

@testable import KiraHelper

/// Mono-Mischung mehrkanaliger Puffer (Live-Befund 21.10.2026: der
/// Sprachfilter liefert 9 Kanäle, der Konverter gab leere Puffer weiter).
final class AudioSupportTests: XCTestCase {
    private func buffer(channels: AVAudioChannelCount, interleaved: Bool, frames: Int, fill: (Int, Int) -> Float) -> AVAudioPCMBuffer {
        // Ab drei Kanälen verlangt AVAudioFormat ein Kanal-Layout (sonst nil).
        let format: AVAudioFormat
        if channels > 2 {
            let layout = AVAudioChannelLayout(layoutTag: kAudioChannelLayoutTag_DiscreteInOrder | channels)!
            format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000, interleaved: interleaved, channelLayout: layout)
        } else {
            format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000, channels: channels, interleaved: interleaved)!
        }
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames))!
        buffer.frameLength = AVAudioFrameCount(frames)
        let data = buffer.floatChannelData!
        for c in 0..<Int(channels) {
            for i in 0..<frames {
                if interleaved { data[0][i * Int(channels) + c] = fill(c, i) } else { data[c][i] = fill(c, i) }
            }
        }
        return buffer
    }

    func testMonoAveragesChannelsNonInterleaved() {
        let src = buffer(channels: 3, interleaved: false, frames: 4) { c, i in Float(c) + Float(i) * 0.1 }
        let mono = BufferConverter.mono(src)!
        XCTAssertEqual(mono.format.channelCount, 1)
        XCTAssertEqual(mono.format.sampleRate, 48_000)
        XCTAssertEqual(Int(mono.frameLength), 4)
        // Mittel der Kanäle 0, 1, 2 = 1 + i·0,1
        for i in 0..<4 {
            XCTAssertEqual(mono.floatChannelData![0][i], 1 + Float(i) * 0.1, accuracy: 1e-5)
        }
    }

    func testMonoAveragesChannelsInterleaved() {
        let src = buffer(channels: 2, interleaved: true, frames: 3) { c, _ in c == 0 ? 0.5 : -0.5 }
        let mono = BufferConverter.mono(src)!
        for i in 0..<3 { XCTAssertEqual(mono.floatChannelData![0][i], 0, accuracy: 1e-6) }
    }

    func testMonoLeavesSingleChannelAlone() {
        let src = buffer(channels: 1, interleaved: false, frames: 2) { _, i in Float(i) }
        XCTAssertNil(BufferConverter.mono(src))
    }

    func testConverterFollowsChangedInputFormat() throws {
        let analyzer = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true)!
        let declared = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000, channels: 1, interleaved: false)!
        let converter = try BufferConverter(from: declared, to: analyzer)
        // Es kommt ein 9-Kanal-Puffer (wie mit Sprachfilter) – trotzdem muss Mono bei 16 kHz herauskommen.
        let nine = buffer(channels: 9, interleaved: false, frames: 4800) { _, i in sinf(Float(i) * 0.05) * 0.3 }
        let out = try converter.convert(nine)
        XCTAssertNotNil(out)
        XCTAssertEqual(out?.format.channelCount, 1)
        XCTAssertEqual(out?.format.sampleRate, 16_000)
        XCTAssertGreaterThan(Int(out?.frameLength ?? 0), 1000)
    }
}

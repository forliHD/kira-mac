import Foundation
import XCTest

@testable import KiraHelper

/// Sammelt alle geschriebenen Zeilen; thread-sicher, weil der Writer-Actor
/// die Senke von seinem Executor aus ruft.
final class LineCollector: @unchecked Sendable {
    private let lock = NSLock()
    private var buffer = Data()

    func sink(_ data: Data) {
        lock.withLock { buffer.append(data) }
    }

    /// Alle vollständigen Zeilen (ohne `\n`).
    var lines: [String] {
        let data = lock.withLock { buffer }
        let text = String(decoding: data, as: UTF8.self)
        return text.split(separator: "\n", omittingEmptySubsequences: false).dropLast().map(String.init)
    }

    func objects() throws -> [[String: Any]] {
        try lines.map { line in
            try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any], "Zeile: \(line)")
        }
    }
}

final class TerminationRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var codes: [Int32] = []

    func record(_ code: Int32) {
        lock.withLock { codes.append(code) }
    }

    var recorded: [Int32] { lock.withLock { codes } }
}

final class DispatcherTests: XCTestCase {
    private var collector: LineCollector!
    private var terminations: TerminationRecorder!
    private var dispatcher: Dispatcher!

    override func setUp() {
        super.setUp()
        collector = LineCollector()
        terminations = TerminationRecorder()
        let collector = collector!
        let terminations = terminations!
        let writer = OutputWriter(sink: { collector.sink($0) })
        dispatcher = Dispatcher(writer: writer, terminate: { terminations.record($0) })
    }

    func testPingRespondsWithPong() async throws {
        await dispatcher.handle(line: #"{"id":"1","cmd":"ping"}"#)
        let objects = try collector.objects()
        XCTAssertEqual(objects.count, 1)
        XCTAssertEqual(objects[0]["id"] as? String, "1")
        XCTAssertEqual(objects[0]["ok"] as? Bool, true)
        XCTAssertEqual((objects[0]["result"] as? [String: Any])?["pong"] as? Bool, true)
    }

    func testUnknownCommand() async throws {
        await dispatcher.handle(line: #"{"id":"u","cmd":"does.not.exist","params":{}}"#)
        let objects = try collector.objects()
        XCTAssertEqual(objects.count, 1)
        XCTAssertEqual(objects[0]["id"] as? String, "u")
        XCTAssertEqual(objects[0]["ok"] as? Bool, false)
        let error = try XCTUnwrap(objects[0]["error"] as? [String: Any])
        XCTAssertEqual(error["code"] as? String, "unknown_command")
        XCTAssertFalse((error["message"] as? String ?? "").isEmpty)
    }

    func testBadParams() async throws {
        // stt.stop prüft „stream“, bevor irgendein Dienst angefasst wird.
        await dispatcher.handle(line: #"{"id":"b1","cmd":"stt.stop"}"#)
        await dispatcher.handle(line: #"{"id":"b2","cmd":"stt.stop","params":{"stream":5}}"#)
        await dispatcher.handle(line: #"{"id":"b3","cmd":"permissions.request","params":{"kind":"wifi"}}"#)
        await dispatcher.handle(line: #"{"id":"b4","cmd":"text.insert","params":{"text":"x","mode":"teleport"}}"#)
        await dispatcher.handle(line: #"{"id":"b5","cmd":"llm.generate","params":{"prompt":"x","temperature":"warm"}}"#)
        await dispatcher.handle(line: #"{"id":"b6","cmd":"audio.system.start","params":{"stream":"a","path":"relativ.wav"}}"#)
        await dispatcher.handle(line: #"{"id":"b7","cmd":"stt.start","params":{"stream":"s","source":"line-in"}}"#)
        let objects = try collector.objects()
        XCTAssertEqual(objects.count, 7)
        for object in objects {
            XCTAssertEqual(object["ok"] as? Bool, false, "\(object)")
            XCTAssertEqual((object["error"] as? [String: Any])?["code"] as? String, "bad_params", "\(object)")
        }
        XCTAssertEqual(Set(objects.compactMap { $0["id"] as? String }), ["b1", "b2", "b3", "b4", "b5", "b6", "b7"])
    }

    func testParseErrorEmitsProtocolEventAndKeepsRunning() async throws {
        await dispatcher.handle(line: "{nicht json")
        await dispatcher.handle(line: #"{"cmd":"ping"}"#)
        await dispatcher.handle(line: #"{"id":"nach-fehler","cmd":"ping"}"#)
        let objects = try collector.objects()
        XCTAssertEqual(objects.count, 3)
        XCTAssertEqual(objects[0]["event"] as? String, "protocol.error")
        XCTAssertNil(objects[0]["id"])
        XCTAssertFalse(((objects[0]["data"] as? [String: Any])?["message"] as? String ?? "").isEmpty)
        XCTAssertEqual(objects[1]["event"] as? String, "protocol.error", "ohne id gibt es keine Antwort, nur das Ereignis")
        XCTAssertEqual(objects[2]["id"] as? String, "nach-fehler")
        XCTAssertEqual(objects[2]["ok"] as? Bool, true)
        XCTAssertTrue(terminations.recorded.isEmpty)
    }

    func testEmptyLinesAreIgnored() async throws {
        await dispatcher.handle(line: "")
        await dispatcher.handle(line: "   \t ")
        XCTAssertEqual(collector.lines, [])
    }

    func testShutdownAnswersThenTerminates() async throws {
        await dispatcher.handle(line: #"{"id":"s","cmd":"shutdown"}"#)
        let objects = try collector.objects()
        XCTAssertEqual(objects.count, 1)
        XCTAssertEqual(objects[0]["ok"] as? Bool, true)
        XCTAssertEqual((objects[0]["result"] as? [String: Any])?["ok"] as? Bool, true)
        XCTAssertEqual(terminations.recorded, [0])
    }

    func testConcurrentRequestsEachGetExactlyOneResponse() async throws {
        let dispatcher = dispatcher!
        await withTaskGroup(of: Void.self) { group in
            for i in 0..<50 {
                group.addTask {
                    await dispatcher.handle(line: #"{"id":"c\#(i)","cmd":"ping"}"#)
                }
            }
        }
        let objects = try collector.objects()
        XCTAssertEqual(objects.count, 50)
        let ids = Set(objects.compactMap { $0["id"] as? String })
        XCTAssertEqual(ids.count, 50)
        XCTAssertTrue(objects.allSatisfy { ($0["ok"] as? Bool) == true })
    }

    func testCommandTableCoversProtocol() {
        let expected: Set<String> = [
            "ping", "info", "shutdown",
            "permissions.status", "permissions.request",
            "stt.status", "stt.prepare", "stt.file", "stt.start", "stt.stop",
            "llm.status", "llm.generate", "llm.stream", "llm.cancel",
            "audio.system.start", "audio.system.stop",
            "text.insert", "text.frontmost",
        ]
        XCTAssertEqual(Set(dispatcher.commands), expected)
    }

    func testLLMUnavailableOrAvailableIsConsistentWithStatus() async throws {
        // Keine Berechtigungen nötig: llm.status liest nur die Verfügbarkeit.
        await dispatcher.handle(line: #"{"id":"l","cmd":"llm.status"}"#)
        let objects = try collector.objects()
        XCTAssertEqual(objects.count, 1)
        XCTAssertEqual(objects[0]["ok"] as? Bool, true)
        let result = try XCTUnwrap(objects[0]["result"] as? [String: Any])
        let available = try XCTUnwrap(result["available"] as? Bool)
        if available {
            XCTAssertTrue(result["reason"] is NSNull)
        } else {
            let reason = try XCTUnwrap(result["reason"] as? String)
            XCTAssertTrue(
                ["appleIntelligenceNotEnabled", "deviceNotEligible", "modelNotReady", "unsupportedOS", "unknown"]
                    .contains(reason), reason)
        }
    }
}

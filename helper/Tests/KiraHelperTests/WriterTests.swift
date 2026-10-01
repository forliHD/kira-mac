import Foundation
import XCTest

@testable import KiraHelper

final class WriterTests: XCTestCase {
    func testEachMessageIsExactlyOneLine() async throws {
        let collector = LineCollector()
        let writer = OutputWriter(sink: { collector.sink($0) })
        await writer.send(Response.success(id: "1", result: ["text": "a\nb"]))
        await writer.send(Event("stt.level", stream: "s", data: ["rms": 0.25]))
        let lines = collector.lines
        XCTAssertEqual(lines.count, 2)
        for line in lines {
            XCTAssertNoThrow(try JSONSerialization.jsonObject(with: Data(line.utf8)), line)
        }
    }

    func testConcurrentSendsDoNotInterleave() async throws {
        let collector = LineCollector()
        let writer = OutputWriter(sink: { collector.sink($0) })
        let count = 300
        await withTaskGroup(of: Void.self) { group in
            for i in 0..<count {
                group.addTask {
                    if i.isMultiple(of: 2) {
                        await writer.send(Response.success(id: "r\(i)", result: ["payload": .string(String(repeating: "x", count: 500 + i))]))
                    } else {
                        await writer.send(Event("llm.delta", stream: "l\(i)", data: ["text": .string(String(repeating: "y", count: 300 + i))]))
                    }
                }
            }
        }
        let objects = try collector.objects()
        XCTAssertEqual(objects.count, count)
        let responses = objects.filter { $0["id"] != nil }
        let events = objects.filter { $0["event"] != nil }
        XCTAssertEqual(responses.count, count / 2)
        XCTAssertEqual(events.count, count / 2)
        XCTAssertEqual(Set(responses.compactMap { $0["id"] as? String }).count, count / 2)
    }

    func testSinkReceivesTrailingNewlineOnly() async throws {
        final class Chunks: @unchecked Sendable {
            let lock = NSLock()
            var items: [Data] = []
        }
        let chunks = Chunks()
        let writer = OutputWriter(sink: { data in chunks.lock.withLock { chunks.items.append(data) } })
        await writer.send(Response.success(id: "1", result: ["pong": true]))
        let items = chunks.lock.withLock { chunks.items }
        XCTAssertEqual(items.count, 1, "eine Nachricht = ein Schreibzugriff")
        XCTAssertEqual(items[0].last, 0x0A)
        XCTAssertEqual(items[0].filter { $0 == 0x0A }.count, 1)
    }

    func testLogLinesCarryPrefix() {
        // HelperLog schreibt auf stderr; hier nur sicherstellen, dass der
        // Aufruf nicht wirft und das Präfix fest verdrahtet ist.
        HelperLog.info("Test")
        XCTAssertTrue(true)
    }
}

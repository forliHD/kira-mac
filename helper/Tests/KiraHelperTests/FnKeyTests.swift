import Carbon.HIToolbox
import CoreGraphics
import Foundation
import XCTest

@testable import KiraHelper

/// fn-Taste ohne echten Tap: Buchführung, Einordnung der Tap-Ereignisse,
/// Protokoll-Ereignisse und die Kommandos ohne Freigaben.
final class FnChordTrackerTests: XCTestCase {
    func testTapIsDownThenUpWithoutChord() {
        var tracker = FnChordTracker()
        XCTAssertEqual(tracker.handle(.fn(down: true, othersHeld: false)), [.down(secure: false)])
        XCTAssertTrue(tracker.fnDown)
        XCTAssertEqual(tracker.handle(.fn(down: false, othersHeld: false)), [.up(chord: false)])
        XCTAssertFalse(tracker.fnDown)
    }

    func testOtherKeyWhileHeldIsOneChord() {
        var tracker = FnChordTracker()
        _ = tracker.handle(.fn(down: true, othersHeld: false))
        XCTAssertEqual(tracker.handle(.keyPressed), [.chord])
        XCTAssertEqual(tracker.handle(.keyPressed), [], "nur einmal je Druck")
        XCTAssertEqual(tracker.handle(.modifierPressed), [])
        XCTAssertEqual(tracker.handle(.fn(down: false, othersHeld: false)), [.up(chord: true)])
        // Der nächste Druck beginnt sauber.
        XCTAssertEqual(tracker.handle(.fn(down: true, othersHeld: false)), [.down(secure: false)])
        XCTAssertEqual(tracker.handle(.fn(down: false, othersHeld: false)), [.up(chord: false)])
    }

    func testModifierWhileHeldIsChord() {
        var tracker = FnChordTracker()
        _ = tracker.handle(.fn(down: true, othersHeld: false))
        XCTAssertEqual(tracker.handle(.modifierPressed), [.chord])
        XCTAssertEqual(tracker.handle(.fn(down: false, othersHeld: true)), [.up(chord: true)])
    }

    func testFnAddedToHeldModifierIsChordFromTheStart() {
        var tracker = FnChordTracker()
        XCTAssertEqual(tracker.handle(.fn(down: true, othersHeld: true)), [.down(secure: false), .chord])
        XCTAssertEqual(tracker.handle(.keyPressed), [])
        XCTAssertEqual(tracker.handle(.fn(down: false, othersHeld: false)), [.up(chord: true)])
    }

    func testKeysWithoutFnAreIgnored() {
        var tracker = FnChordTracker()
        XCTAssertEqual(tracker.handle(.keyPressed), [])
        XCTAssertEqual(tracker.handle(.modifierPressed), [])
        XCTAssertEqual(tracker.handle(.fn(down: false, othersHeld: false)), [], "Loslassen ohne Drücken")
    }

    func testDuplicateDownIsIgnored() {
        var tracker = FnChordTracker()
        _ = tracker.handle(.fn(down: true, othersHeld: false))
        XCTAssertEqual(tracker.handle(.fn(down: true, othersHeld: false)), [])
    }

    func testSecureInputIsReportedOnDown() {
        var tracker = FnChordTracker()
        XCTAssertEqual(tracker.handle(.fn(down: true, othersHeld: false), secureInput: true), [.down(secure: true)])
    }

    func testResyncOnlyCatchesUpAMissedRelease() {
        var tracker = FnChordTracker()
        XCTAssertEqual(tracker.handle(.resync(fnDown: true)), [], "verpasstes Drücken löst nichts aus")
        XCTAssertFalse(tracker.fnDown)
        _ = tracker.handle(.fn(down: true, othersHeld: false))
        XCTAssertEqual(tracker.handle(.resync(fnDown: true)), [])
        _ = tracker.handle(.keyPressed)
        XCTAssertEqual(tracker.handle(.resync(fnDown: false)), [.up(chord: true)])
        XCTAssertFalse(tracker.fnDown)
    }
}

final class FnEventClassifierTests: XCTestCase {
    private let flagsChanged = CGEventType.flagsChanged.rawValue
    private let keyDown = CGEventType.keyDown.rawValue

    func testFunctionKeyFlagsChanged() {
        XCTAssertEqual(
            FnEventClassifier.classify(
                type: flagsChanged, keyCode: Int64(kVK_Function), flags: [.maskSecondaryFn], previousFlags: [],
                systemDefinedKeyDown: nil),
            .fn(down: true, othersHeld: false))
        XCTAssertEqual(
            FnEventClassifier.classify(
                type: flagsChanged, keyCode: Int64(kVK_Function), flags: [], previousFlags: [.maskSecondaryFn],
                systemDefinedKeyDown: nil),
            .fn(down: false, othersHeld: false))
        XCTAssertEqual(
            FnEventClassifier.classify(
                type: flagsChanged, keyCode: Int64(kVK_Function), flags: [.maskSecondaryFn, .maskCommand],
                previousFlags: [.maskCommand], systemDefinedKeyDown: nil),
            .fn(down: true, othersHeld: true))
    }

    func testGlobeKeyWithOwnCodeCountsByTheFnFlag() {
        XCTAssertEqual(
            FnEventClassifier.classify(
                type: flagsChanged, keyCode: 179, flags: [.maskSecondaryFn], previousFlags: [], systemDefinedKeyDown: nil),
            .fn(down: true, othersHeld: false))
        // Ohne Wechsel des fn-Flags ist ein unbekannter Code nichts.
        XCTAssertNil(
            FnEventClassifier.classify(type: flagsChanged, keyCode: 179, flags: [], previousFlags: [], systemDefinedKeyDown: nil))
    }

    func testOtherModifierPressAndRelease() {
        XCTAssertEqual(
            FnEventClassifier.classify(
                type: flagsChanged, keyCode: Int64(kVK_Shift), flags: [.maskSecondaryFn, .maskShift],
                previousFlags: [.maskSecondaryFn], systemDefinedKeyDown: nil),
            .modifierPressed)
        XCTAssertNil(
            FnEventClassifier.classify(
                type: flagsChanged, keyCode: Int64(kVK_Shift), flags: [.maskSecondaryFn],
                previousFlags: [.maskSecondaryFn, .maskShift], systemDefinedKeyDown: nil),
            "Loslassen ist keine Kombination")
        XCTAssertNil(
            FnEventClassifier.classify(
                type: flagsChanged, keyCode: Int64(kVK_CapsLock), flags: [.maskSecondaryFn, .maskAlphaShift],
                previousFlags: [.maskSecondaryFn], systemDefinedKeyDown: nil),
            "Feststelltaste zählt nicht")
    }

    func testOwnKeyEventsNeverCount() {
        // Live-Befund 02.10.2026: das eigene ⌘V beim Einsetzen brach gehaltene Diktate ab.
        XCTAssertNil(
            FnEventClassifier.classify(
                type: keyDown, keyCode: Int64(kVK_ANSI_V), flags: .maskCommand, previousFlags: [.maskSecondaryFn],
                systemDefinedKeyDown: nil, own: true))
        XCTAssertNil(
            FnEventClassifier.classify(
                type: flagsChanged, keyCode: Int64(kVK_Command), flags: [.maskSecondaryFn, .maskCommand],
                previousFlags: [.maskSecondaryFn], systemDefinedKeyDown: nil, own: true))
        XCTAssertEqual(
            FnEventClassifier.classify(
                type: keyDown, keyCode: Int64(kVK_ANSI_V), flags: .maskCommand, previousFlags: [.maskSecondaryFn],
                systemDefinedKeyDown: nil, own: false),
            .keyPressed, "dasselbe ⌘V vom Nutzer ist eine Kombination")
    }

    func testOwnEventMarkerRoundTrips() throws {
        let source = CGEventSource(stateID: .privateState)
        let event = try XCTUnwrap(CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_ANSI_V), keyDown: true))
        XCTAssertFalse(SyntheticKeyEvents.isOwn(event))
        SyntheticKeyEvents.mark(event)
        XCTAssertTrue(SyntheticKeyEvents.isOwn(event))
    }

    func testKeyDownAndMediaKeys() {
        XCTAssertEqual(
            FnEventClassifier.classify(type: keyDown, keyCode: 0, flags: [], previousFlags: [], systemDefinedKeyDown: nil),
            .keyPressed)
        XCTAssertEqual(
            FnEventClassifier.classify(
                type: FnEventClassifier.systemDefinedType, keyCode: 0, flags: [], previousFlags: [], systemDefinedKeyDown: true),
            .keyPressed)
        XCTAssertNil(
            FnEventClassifier.classify(
                type: FnEventClassifier.systemDefinedType, keyCode: 0, flags: [], previousFlags: [], systemDefinedKeyDown: false))
        XCTAssertNil(
            FnEventClassifier.classify(
                type: CGEventType.leftMouseDown.rawValue, keyCode: 0, flags: [], previousFlags: [], systemDefinedKeyDown: nil),
            "Klicks sind nie eine Kombination")
    }

    func testAuxKeyStateFromData1() {
        // data1 = Tastencode << 16 | Zustand << 8; 0xA = gedrückt, 0xB = losgelassen.
        XCTAssertTrue(FnEventClassifier.isAuxKeyDown(subtype: 8, data1: (2 << 16) | (0x0A << 8)))
        XCTAssertFalse(FnEventClassifier.isAuxKeyDown(subtype: 8, data1: (2 << 16) | (0x0B << 8)))
        XCTAssertFalse(FnEventClassifier.isAuxKeyDown(subtype: 7, data1: 0x0A << 8), "Untertyp 7 sind Maustasten")
    }

    func testEventMaskCoversFlagsKeysAndMediaKeys() {
        let mask = FnEventClassifier.eventMask
        XCTAssertNotEqual(mask & (1 << CGEventMask(CGEventType.flagsChanged.rawValue)), 0)
        XCTAssertNotEqual(mask & (1 << CGEventMask(CGEventType.keyDown.rawValue)), 0)
        XCTAssertNotEqual(mask & (1 << 14), 0)
        XCTAssertEqual(mask & (1 << CGEventMask(CGEventType.keyUp.rawValue)), 0, "Loslassen anderer Tasten wird nicht abgehört")
        XCTAssertEqual(mask & (1 << CGEventMask(CGEventType.leftMouseDown.rawValue)), 0)
    }
}

final class FnKeyProtocolTests: XCTestCase {
    private func object(_ event: Event) throws -> [String: Any] {
        let data = try LineCodec.encode(event)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testEventsCarryOnlyBooleans() throws {
        let down = try object(FnChordTracker.Output.down(secure: false).event)
        XCTAssertEqual(down["event"] as? String, "fn.down")
        XCTAssertNil(down["stream"])
        XCTAssertEqual(down["data"] as? [String: Bool], ["secure": false])

        let chord = try object(FnChordTracker.Output.chord.event)
        XCTAssertEqual(chord["event"] as? String, "fn.chord")
        XCTAssertEqual((chord["data"] as? [String: Any])?.isEmpty, true)

        let up = try object(FnChordTracker.Output.up(chord: true).event)
        XCTAssertEqual(up["event"] as? String, "fn.up")
        XCTAssertEqual(up["data"] as? [String: Bool], ["chord": true])
    }

    func testFnUsageParsing() {
        XCTAssertEqual(FnKeyMonitor.parseFnUsage(NSNumber(value: 0)), 0)
        XCTAssertEqual(FnKeyMonitor.parseFnUsage(NSNumber(value: 2)), 2)
        XCTAssertEqual(FnKeyMonitor.parseFnUsage(3), 3)
        XCTAssertNil(FnKeyMonitor.parseFnUsage(nil))
        XCTAssertNil(FnKeyMonitor.parseFnUsage("2"))
        XCTAssertNil(FnKeyMonitor.parseFnUsage(kCFBooleanTrue))
    }
}

final class FnKeyCommandTests: XCTestCase {
    private var collector: LineCollector!
    private var dispatcher: Dispatcher!

    override func setUp() {
        super.setUp()
        collector = LineCollector()
        let collector = collector!
        dispatcher = Dispatcher(writer: OutputWriter(sink: { collector.sink($0) }), terminate: { _ in })
    }

    func testWatchNeedsABooleanEnabled() async throws {
        await dispatcher.handle(line: #"{"id":"w1","cmd":"fn.watch"}"#)
        await dispatcher.handle(line: #"{"id":"w2","cmd":"fn.watch","params":{"enabled":"ja"}}"#)
        let objects = try collector.objects()
        XCTAssertEqual(objects.count, 2)
        for object in objects {
            XCTAssertEqual((object["error"] as? [String: Any])?["code"] as? String, "bad_params", "\(object)")
        }
    }

    func testStatusAndSwitchingOffWithoutTap() async throws {
        // Kein echter Tap im Test: nur Status und Ausschalten (idempotent).
        await dispatcher.handle(line: #"{"id":"s","cmd":"fn.status"}"#)
        await dispatcher.handle(line: #"{"id":"off","cmd":"fn.watch","params":{"enabled":false}}"#)
        let objects = try collector.objects()
        XCTAssertEqual(objects.count, 2)
        for object in objects {
            XCTAssertEqual(object["ok"] as? Bool, true, "\(object)")
            let result = try XCTUnwrap(object["result"] as? [String: Any])
            XCTAssertEqual(result["watching"] as? Bool, false)
            XCTAssertEqual(result["tap"] as? String, "off")
            XCTAssertNotNil(result["accessibility"] as? Bool)
            XCTAssertNotNil(result["inputMonitoring"] as? Bool)
            XCTAssertTrue(result["fnUsage"] is NSNull || result["fnUsage"] is Int, "\(result)")
            XCTAssertEqual(
                Set(result.keys), ["watching", "tap", "accessibility", "inputMonitoring", "fnUsage"],
                "keine weiteren Felder (schon gar keine Tasten)")
        }
    }
}

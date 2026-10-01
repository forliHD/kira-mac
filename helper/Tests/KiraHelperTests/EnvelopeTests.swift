import Foundation
import XCTest

@testable import KiraHelper

final class EnvelopeTests: XCTestCase {
    // MARK: Anfragen

    func testDecodesRequestWithParams() throws {
        let line = #"{"id": "r12", "cmd": "stt.file", "params": {"path": "/tmp/x.wav", "locale": "de-DE", "contextualStrings": ["Musterfirma", "KIRA"], "maxTokens": 512, "temperature": 0.4, "flag": true}}"#
        let request = try LineCodec.decodeRequest(line)
        XCTAssertEqual(request.id, "r12")
        XCTAssertEqual(request.cmd, "stt.file")
        XCTAssertEqual(try request.params.string("path"), "/tmp/x.wav")
        XCTAssertEqual(try request.params.string("locale"), "de-DE")
        XCTAssertEqual(try request.params.stringArray("contextualStrings"), ["Musterfirma", "KIRA"])
        XCTAssertEqual(try request.params.optionalInt("maxTokens"), 512)
        XCTAssertEqual(try request.params.optionalDouble("temperature"), 0.4)
        XCTAssertEqual(try request.params.optionalBool("flag"), true)
        XCTAssertNil(try request.params.optionalString("missing"))
        XCTAssertEqual(try request.params.stringArray("missing"), [])
    }

    func testDecodesRequestWithoutParamsAndNumericId() throws {
        let plain = try LineCodec.decodeRequest(#"{"id":"1","cmd":"ping"}"#)
        XCTAssertEqual(plain.params, Params())

        let nullParams = try LineCodec.decodeRequest(#"{"id":"1","cmd":"ping","params":null}"#)
        XCTAssertTrue(nullParams.params.isEmpty)

        // Eine Zahl als id wird unverändert als String zurückgegeben.
        let numeric = try LineCodec.decodeRequest(#"{"id":7,"cmd":"ping"}"#)
        XCTAssertEqual(numeric.id, "7")
    }

    func testRejectsMalformedRequests() {
        XCTAssertThrowsError(try LineCodec.decodeRequest("nicht json"))
        XCTAssertThrowsError(try LineCodec.decodeRequest(#"{"cmd":"ping"}"#), "id fehlt")
        XCTAssertThrowsError(try LineCodec.decodeRequest(#"{"id":"1"}"#), "cmd fehlt")
        XCTAssertThrowsError(try LineCodec.decodeRequest(#"{"id":"1","cmd":"ping","params":[1,2]}"#), "params kein Objekt")
        XCTAssertThrowsError(try LineCodec.decodeRequest(#"{"id":true,"cmd":"ping"}"#), "id kein String")
    }

    func testParamsTypeErrorsAreBadParams() throws {
        let params = Params(["n": .string("x"), "s": .int(1), "list": .array([.int(1)]), "nothing": .null])
        assertBadParams(try params.optionalInt("n"))
        assertBadParams(try params.optionalString("s"))
        assertBadParams(try params.stringArray("list"))
        assertBadParams(try params.string("missing"))
        // null zählt wie „nicht gesetzt“.
        XCTAssertNil(try params.optionalString("nothing"))
        XCTAssertEqual(try params.optionalInt("s"), 1)
        XCTAssertEqual(Params(["d": .double(512.0)]).values["d"]?.intValue, 512)
        XCTAssertNil(JSONValue.double(1.5).intValue)
    }

    private func assertBadParams<T>(_ expression: @autoclosure () throws -> T, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try expression(), file: file, line: line) { error in
            XCTAssertEqual((error as? HelperError)?.code, .badParams, file: file, line: line)
        }
    }

    // MARK: Antworten und Ereignisse

    func testEncodesSuccessResponse() throws {
        let response = Response.success(id: "r12", result: ["pong": true, "n": 3, "list": ["a", 1.5], "nested": ["k": .null]])
        let object = try decodeObject(LineCodec.encode(response))
        XCTAssertEqual(object["id"] as? String, "r12")
        XCTAssertEqual(object["ok"] as? Bool, true)
        XCTAssertNil(object["error"], "error wird bei Erfolg weggelassen")
        let result = try XCTUnwrap(object["result"] as? [String: Any])
        XCTAssertEqual(result["pong"] as? Bool, true)
        XCTAssertEqual(result["n"] as? Int, 3)
        let list = try XCTUnwrap(result["list"] as? [Any])
        XCTAssertEqual(list[0] as? String, "a")
        XCTAssertEqual(list[1] as? Double, 1.5)
        let nested = try XCTUnwrap(result["nested"] as? [String: Any])
        XCTAssertTrue(nested["k"] is NSNull)
    }

    func testEncodesFailureResponseWithStableCode() throws {
        let error = HelperError(.llmUnavailable, "Braucht macOS 26.", reason: "unsupportedOS")
        let object = try decodeObject(LineCodec.encode(Response.failure(id: "x", error: error)))
        XCTAssertEqual(object["ok"] as? Bool, false)
        XCTAssertNil(object["result"])
        let body = try XCTUnwrap(object["error"] as? [String: Any])
        XCTAssertEqual(body["code"] as? String, "llm_unavailable")
        XCTAssertEqual(body["message"] as? String, "Braucht macOS 26.")
        XCTAssertEqual(body["reason"] as? String, "unsupportedOS")

        let plain = try decodeObject(LineCodec.encode(Response.failure(id: "y", error: .unknownCommand("nope"))))
        let plainBody = try XCTUnwrap(plain["error"] as? [String: Any])
        XCTAssertEqual(plainBody["code"] as? String, "unknown_command")
        XCTAssertNil(plainBody["reason"], "reason wird ohne Wert weggelassen")
    }

    func testEncodesEvents() throws {
        let partial = try decodeObject(LineCodec.encode(Event("stt.partial", stream: "s1", data: ["text": "Hallo"])))
        XCTAssertEqual(partial["event"] as? String, "stt.partial")
        XCTAssertEqual(partial["stream"] as? String, "s1")
        XCTAssertEqual((partial["data"] as? [String: Any])?["text"] as? String, "Hallo")

        let protocolError = try decodeObject(LineCodec.encode(Event.protocolError("kaputt")))
        XCTAssertEqual(protocolError["event"] as? String, "protocol.error")
        XCTAssertNil(protocolError["stream"])
        XCTAssertEqual((protocolError["data"] as? [String: Any])?["message"] as? String, "kaputt")
    }

    func testEncodedLineNeverContainsNewline() throws {
        let response = Response.success(id: "1", result: ["text": "Zeile 1\nZeile 2\r\nEnde"])
        let data = try LineCodec.encode(response)
        XCTAssertFalse(data.contains(0x0A))
        XCTAssertFalse(data.contains(0x0D))
        let object = try decodeObject(data)
        XCTAssertEqual((object["result"] as? [String: Any])?["text"] as? String, "Zeile 1\nZeile 2\r\nEnde")
    }

    func testErrorCodesMatchProtocolDocument() {
        let expected: Set<String> = [
            "unknown_command", "bad_params", "permission_denied", "stt_unavailable", "stt_assets_missing",
            "stt_failed", "llm_unavailable", "llm_failed", "context_too_long", "audio_failed", "insert_failed",
            "internal",
        ]
        XCTAssertEqual(Set(HelperError.Code.allCases.map(\.rawValue)), expected)
    }

    func testWrapMapsForeignErrorsToInternal() {
        struct Foreign: Error {}
        XCTAssertEqual(HelperError.wrap(Foreign()).code, .internalError)
        XCTAssertEqual(HelperError.wrap(HelperError.badParams("x")).code, .badParams)
        XCTAssertEqual(HelperError.wrap(CancellationError()).message, "Abgebrochen.")
    }

    func testJSONValueRoundTrip() throws {
        let value: JSONValue = ["a": 1, "b": 2.5, "c": "s", "d": true, "e": nil, "f": [1, "x"], "g": ["h": false]]
        let data = try JSONEncoder().encode(value)
        let decoded = try JSONDecoder().decode(JSONValue.self, from: data)
        XCTAssertEqual(decoded, value)
    }

    // MARK: Hilfen

    private func decodeObject(_ data: Data) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}

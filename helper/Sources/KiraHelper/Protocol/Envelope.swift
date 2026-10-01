import Foundation

/// Protokollversion des Helfers (siehe docs/helper-protocol.md).
let protocolVersion = 1

// MARK: - JSONValue

/// Schlanker JSON-Baum („AnyCodable light“): freie `params` einer Anfrage und
/// beliebige `result`/`data`-Objekte werden darüber kodiert und dekodiert.
enum JSONValue: Equatable, Sendable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    /// Ganzzahl; ein Double ohne Nachkommastellen (z. B. `512.0`) zählt mit.
    var intValue: Int? {
        switch self {
        case .int(let i): return i
        case .double(let d) where d.rounded() == d && abs(d) < 9.0e15: return Int(d)
        default: return nil
        }
    }

    var doubleValue: Double? {
        switch self {
        case .int(let i): return Double(i)
        case .double(let d): return d
        default: return nil
        }
    }

    var arrayValue: [JSONValue]? {
        if case .array(let a) = self { return a }
        return nil
    }

    var objectValue: [String: JSONValue]? {
        if case .object(let o) = self { return o }
        return nil
    }

    var isNull: Bool {
        if case .null = self { return true }
        return false
    }

    subscript(key: String) -> JSONValue? {
        objectValue?[key]
    }
}

extension JSONValue: Codable {
    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let b = try? container.decode(Bool.self) {
            self = .bool(b)
        } else if let i = try? container.decode(Int.self) {
            self = .int(i)
        } else if let d = try? container.decode(Double.self) {
            self = .double(d)
        } else if let s = try? container.decode(String.self) {
            self = .string(s)
        } else if let a = try? container.decode([JSONValue].self) {
            self = .array(a)
        } else if let o = try? container.decode([String: JSONValue].self) {
            self = .object(o)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container, debugDescription: "Unbekannter JSON-Wert")
        }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let b): try container.encode(b)
        case .int(let i): try container.encode(i)
        case .double(let d): try container.encode(d)
        case .string(let s): try container.encode(s)
        case .array(let a): try container.encode(a)
        case .object(let o): try container.encode(o)
        }
    }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByFloatLiteral, ExpressibleByBooleanLiteral, ExpressibleByNilLiteral,
    ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral
{
    init(stringLiteral value: String) { self = .string(value) }
    init(integerLiteral value: Int) { self = .int(value) }
    init(floatLiteral value: Double) { self = .double(value) }
    init(booleanLiteral value: Bool) { self = .bool(value) }
    init(nilLiteral: ()) { self = .null }
    init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
    init(dictionaryLiteral elements: (String, JSONValue)...) {
        self = .object(Dictionary(elements, uniquingKeysWith: { _, last in last }))
    }
}

extension JSONValue {
    /// Hilfskonstruktor: `nil` → `.null`, sonst String.
    static func optionalString(_ value: String?) -> JSONValue {
        value.map { .string($0) } ?? .null
    }

    static func strings(_ values: [String]) -> JSONValue {
        .array(values.map { .string($0) })
    }
}

// MARK: - Fehler

/// Fehler mit stabilem Code (`snake_case`, siehe Protokolldokument) und einer
/// deutschen, dem Menschen zeigbaren Meldung.
struct HelperError: Error, Sendable, Equatable {
    enum Code: String, Sendable, CaseIterable {
        case unknownCommand = "unknown_command"
        case badParams = "bad_params"
        case permissionDenied = "permission_denied"
        case sttUnavailable = "stt_unavailable"
        case sttAssetsMissing = "stt_assets_missing"
        case sttFailed = "stt_failed"
        case llmUnavailable = "llm_unavailable"
        case llmFailed = "llm_failed"
        case contextTooLong = "context_too_long"
        case audioFailed = "audio_failed"
        case insertFailed = "insert_failed"
        case internalError = "internal"
    }

    let code: Code
    let message: String
    /// Optionale maschinenlesbare Begründung (z. B. `unsupportedOS` bei
    /// `llm_unavailable`); landet additiv als `reason` im Fehlerobjekt.
    var reason: String? = nil

    init(_ code: Code, _ message: String, reason: String? = nil) {
        self.code = code
        self.message = message
        self.reason = reason
    }

    static func badParams(_ message: String) -> HelperError {
        HelperError(.badParams, message)
    }

    static func unknownCommand(_ cmd: String) -> HelperError {
        HelperError(.unknownCommand, "Unbekanntes Kommando „\(cmd)“.")
    }

    /// Beliebigen Fehler auf einen Helfer-Fehler abbilden; unbekannte Fehler
    /// werden zu `internal` mit der Beschreibung des Fehlers.
    static func wrap(_ error: any Error, fallback: Code = .internalError) -> HelperError {
        if let helperError = error as? HelperError { return helperError }
        if error is CancellationError { return HelperError(fallback, "Abgebrochen.") }
        return HelperError(fallback, describe(error))
    }

    /// Lesbare Beschreibung eines Fehlers ohne Audio- oder Nutzdaten.
    static func describe(_ error: any Error) -> String {
        let ns = error as NSError
        let text = ns.localizedDescription
        if text.isEmpty || text.hasPrefix("The operation couldn’t be completed") {
            return "\(ns.domain) (\(ns.code))"
        }
        return text
    }
}

// MARK: - Anfrage

/// Zugriff auf die freien `params` einer Anfrage mit typisierten Lesern, die
/// bei falschem Typ `bad_params` werfen.
struct Params: Sendable, Equatable {
    let values: [String: JSONValue]

    init(_ values: [String: JSONValue] = [:]) {
        self.values = values
    }

    var isEmpty: Bool { values.isEmpty }

    subscript(key: String) -> JSONValue? {
        let value = values[key]
        if value?.isNull == true { return nil }
        return value
    }

    func string(_ key: String) throws -> String {
        guard let value = self[key] else {
            throw HelperError.badParams("Parameter „\(key)“ fehlt.")
        }
        guard let s = value.stringValue else {
            throw HelperError.badParams("Parameter „\(key)“ muss ein String sein.")
        }
        return s
    }

    func optionalString(_ key: String) throws -> String? {
        guard let value = self[key] else { return nil }
        guard let s = value.stringValue else {
            throw HelperError.badParams("Parameter „\(key)“ muss ein String sein.")
        }
        return s
    }

    func optionalInt(_ key: String) throws -> Int? {
        guard let value = self[key] else { return nil }
        guard let i = value.intValue else {
            throw HelperError.badParams("Parameter „\(key)“ muss eine Ganzzahl sein.")
        }
        return i
    }

    func optionalDouble(_ key: String) throws -> Double? {
        guard let value = self[key] else { return nil }
        guard let d = value.doubleValue else {
            throw HelperError.badParams("Parameter „\(key)“ muss eine Zahl sein.")
        }
        return d
    }

    func optionalBool(_ key: String) throws -> Bool? {
        guard let value = self[key] else { return nil }
        guard let b = value.boolValue else {
            throw HelperError.badParams("Parameter „\(key)“ muss true oder false sein.")
        }
        return b
    }

    func stringArray(_ key: String) throws -> [String] {
        guard let value = self[key] else { return [] }
        guard let array = value.arrayValue else {
            throw HelperError.badParams("Parameter „\(key)“ muss eine Liste von Strings sein.")
        }
        return try array.map { item in
            guard let s = item.stringValue else {
                throw HelperError.badParams("Parameter „\(key)“ muss eine Liste von Strings sein.")
            }
            return s
        }
    }
}

/// Anfrage der Electron-Hauptseite: `{"id": "...", "cmd": "...", "params": {...}}`.
struct Request: Sendable, Equatable {
    let id: String
    let cmd: String
    let params: Params
}

extension Request: Decodable {
    private enum CodingKeys: String, CodingKey {
        case id, cmd, params
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let rawId = try container.decode(JSONValue.self, forKey: .id)
        switch rawId {
        case .string(let s): id = s
        case .int(let i): id = String(i)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .id, in: container, debugDescription: "„id“ muss ein String sein")
        }
        cmd = try container.decode(String.self, forKey: .cmd)
        let rawParams = try container.decodeIfPresent(JSONValue.self, forKey: .params) ?? .null
        switch rawParams {
        case .null: params = Params()
        case .object(let o): params = Params(o)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .params, in: container, debugDescription: "„params“ muss ein Objekt sein")
        }
    }
}

// MARK: - Antwort und Ereignis

/// Antwort auf genau eine Anfrage: `{"id", "ok", "result"}` oder `{"id", "ok": false, "error"}`.
struct Response: Encodable, Sendable, Equatable {
    struct ErrorBody: Encodable, Sendable, Equatable {
        let code: String
        let message: String
        let reason: String?
    }

    let id: String
    let ok: Bool
    let result: JSONValue?
    let error: ErrorBody?

    static func success(id: String, result: JSONValue) -> Response {
        Response(id: id, ok: true, result: result, error: nil)
    }

    static func failure(id: String, error: HelperError) -> Response {
        Response(
            id: id, ok: false, result: nil,
            error: ErrorBody(code: error.code.rawValue, message: error.message, reason: error.reason))
    }
}

/// Unaufgefordertes Ereignis (laufende Streams, Protokollfehler).
struct Event: Encodable, Sendable, Equatable {
    let event: String
    let stream: String?
    let data: JSONValue

    init(_ event: String, stream: String? = nil, data: JSONValue = .object([:])) {
        self.event = event
        self.stream = stream
        self.data = data
    }

    static func protocolError(_ message: String) -> Event {
        Event("protocol.error", data: ["message": .string(message)])
    }
}

// MARK: - Zeilenkodierung

enum LineCodec {
    /// Kodiert eine Nachricht als genau eine JSON-Zeile (ohne das abschließende `\n`).
    static func encode(_ value: some Encodable) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value)
    }

    static func decodeRequest(_ line: String) throws -> Request {
        guard let data = line.data(using: .utf8) else {
            throw DecodingError.dataCorrupted(
                DecodingError.Context(codingPath: [], debugDescription: "Zeile ist kein UTF-8"))
        }
        return try JSONDecoder().decode(Request.self, from: data)
    }
}

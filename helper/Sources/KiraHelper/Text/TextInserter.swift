import AppKit
import ApplicationServices
import Carbon.HIToolbox
import Foundation

/// Text in das vorderste Programm einfügen (`text.insert`) und das vorderste
/// Programm nennen (`text.frontmost`). Läuft auf dem Main-Actor, weil
/// Accessibility, Zwischenablage und Tastaturereignisse dort zu Hause sind.
@MainActor
final class TextInserter {
    enum Mode: String, Sendable {
        case auto, ax, paste
    }

    /// Wie lange ⌘V Zeit bekommt, bevor die Zwischenablage zurückgesetzt wird.
    private static let pasteRestoreDelay: Duration = .milliseconds(300)

    nonisolated init() {}

    func frontmost() -> JSONValue {
        guard let app = NSWorkspace.shared.frontmostApplication else {
            return ["bundleId": .null, "name": .null]
        }
        return [
            "bundleId": .optionalString(app.bundleIdentifier),
            "name": .optionalString(app.localizedName),
        ]
    }

    func insert(text: String, mode: Mode) async throws -> JSONValue {
        guard !text.isEmpty else {
            throw HelperError.badParams("Parameter „text“ darf nicht leer sein.")
        }
        guard PermissionsService.accessibilityTrusted() else {
            throw HelperError(
                .permissionDenied,
                "Keine Freigabe für Bedienungshilfen. Bitte „KIRA für Mac“ unter „Datenschutz & Sicherheit → Bedienungshilfen“ erlauben.",
                reason: "accessibility")
        }

        switch mode {
        case .ax:
            guard insertViaAccessibility(text) else {
                throw HelperError(
                    .insertFailed,
                    "Das fokussierte Element nimmt über Bedienungshilfen keinen Text an.")
            }
            return ["method": "ax"]
        case .paste:
            try await insertViaPasteboard(text)
            return ["method": "paste"]
        case .auto:
            if insertViaAccessibility(text) {
                return ["method": "ax"]
            }
            try await insertViaPasteboard(text)
            return ["method": "paste"]
        }
    }

    // MARK: Accessibility

    /// Setzt `kAXSelectedTextAttribute` des fokussierten Elements. Viele
    /// Programme (WebViews, Electron) nehmen den Wert an, ohne ihn
    /// einzufügen — deshalb wird, wo möglich, über `kAXValueAttribute`
    /// nachgeprüft.
    private func insertViaAccessibility(_ text: String) -> Bool {
        let systemWide = AXUIElementCreateSystemWide()
        var focusedRef: CFTypeRef?
        let focusedStatus = AXUIElementCopyAttributeValue(
            systemWide, kAXFocusedUIElementAttribute as CFString, &focusedRef)
        guard focusedStatus == .success, let focusedRef else { return false }
        // swiftlint:disable:next force_cast
        let element = focusedRef as! AXUIElement

        var settable = DarwinBoolean(false)
        let settableStatus = AXUIElementIsAttributeSettable(
            element, kAXSelectedTextAttribute as CFString, &settable)
        guard settableStatus == .success, settable.boolValue else { return false }

        let setStatus = AXUIElementSetAttributeValue(
            element, kAXSelectedTextAttribute as CFString, text as CFTypeRef)
        guard setStatus == .success else { return false }

        // Nachprüfen, wenn der Wert lesbar ist; bei sehr langen Texten oder
        // Feldern ohne Wert dem Ergebniscode vertrauen.
        var valueRef: CFTypeRef?
        let valueStatus = AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &valueRef)
        if valueStatus == .success, let value = valueRef as? String {
            let probe = text.count > 200 ? String(text.prefix(200)) : text
            return value.contains(probe)
        }
        return true
    }

    // MARK: Zwischenablage

    private func insertViaPasteboard(_ text: String) async throws {
        let pasteboard = NSPasteboard.general
        let saved = Self.snapshot(of: pasteboard)

        pasteboard.clearContents()
        guard pasteboard.setString(text, forType: .string) else {
            throw HelperError(.insertFailed, "Text konnte nicht in die Zwischenablage gelegt werden.")
        }

        guard Self.postCommandV() else {
            Self.restore(saved, to: pasteboard)
            throw HelperError(.insertFailed, "Tastaturereignis ⌘V konnte nicht gesendet werden.")
        }

        try? await Task.sleep(for: Self.pasteRestoreDelay)
        Self.restore(saved, to: pasteboard)
    }

    /// Kopiert alle Einträge der Zwischenablage (alle Typen) in neue Objekte,
    /// die sich später zurückschreiben lassen.
    private static func snapshot(of pasteboard: NSPasteboard) -> [NSPasteboardItem] {
        (pasteboard.pasteboardItems ?? []).compactMap { item in
            let copy = NSPasteboardItem()
            var any = false
            for type in item.types {
                if let data = item.data(forType: type) {
                    copy.setData(data, forType: type)
                    any = true
                }
            }
            return any ? copy : nil
        }
    }

    private static func restore(_ items: [NSPasteboardItem], to pasteboard: NSPasteboard) {
        pasteboard.clearContents()
        if !items.isEmpty {
            pasteboard.writeObjects(items)
        }
    }

    private static func postCommandV() -> Bool {
        let source = CGEventSource(stateID: .combinedSessionState)
        let key = CGKeyCode(kVK_ANSI_V)
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: true),
            let up = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: false)
        else { return false }
        down.flags = .maskCommand
        up.flags = .maskCommand
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        return true
    }
}

enum TextCommands {
    static func register(into table: inout [String: CommandHandler], services: Services) {
        table["text.insert"] = { request in
            let text = try request.params.string("text")
            let rawMode = try request.params.optionalString("mode") ?? "auto"
            guard let mode = TextInserter.Mode(rawValue: rawMode) else {
                throw HelperError.badParams("Unbekannter Modus „\(rawMode)“ (erlaubt: auto, ax, paste).")
            }
            return try await services.text.insert(text: text, mode: mode)
        }
        table["text.frontmost"] = { _ in
            await services.text.frontmost()
        }
    }
}

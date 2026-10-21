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

    /// Programm-Symbole als PNG (Base64), je Bundle einmal gerendert.
    private var iconCache: [String: String] = [:]

    func frontmost() -> JSONValue {
        guard let app = NSWorkspace.shared.frontmostApplication else {
            return ["bundleId": .null, "name": .null, "icon": .null]
        }
        return [
            "bundleId": .optionalString(app.bundleIdentifier),
            "name": .optionalString(app.localizedName),
            "icon": .optionalString(icon(for: app)),
        ]
    }

    /// Symbol des Programms, 64 × 64 px (32 pt @2x), für die Diktat-Pille.
    private func icon(for app: NSRunningApplication) -> String? {
        let key = app.bundleIdentifier ?? app.localizedName ?? ""
        if let cached = iconCache[key] { return cached }
        guard let image = app.icon, let png = Self.pngBase64(image, pixels: 64) else { return nil }
        if !key.isEmpty { iconCache[key] = png }
        return png
    }

    static func pngBase64(_ image: NSImage, pixels: Int) -> String? {
        guard
            let rep = NSBitmapImageRep(
                bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4,
                hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
        else { return nil }
        rep.size = NSSize(width: pixels, height: pixels)
        NSGraphicsContext.saveGraphicsState()
        defer { NSGraphicsContext.restoreGraphicsState() }
        guard let context = NSGraphicsContext(bitmapImageRep: rep) else { return nil }
        NSGraphicsContext.current = context
        context.imageInterpolation = .high
        image.draw(in: NSRect(x: 0, y: 0, width: pixels, height: pixels), from: .zero, operation: .copy, fraction: 1)
        return rep.representation(using: .png, properties: [:])?.base64EncodedString()
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

    // MARK: Wörterbuch

    /// `text.knownWords`: welche der Wörter das Systemwörterbuch der Sprache
    /// kennt (`NSSpellChecker`). Für die Nachkorrektur der Hülle (seit 0.4.0):
    /// ein bekanntes Wort („Kita“) wird bei bloßer Buchstabenähnlichkeit nicht
    /// zu einem Begriff (KIRA). Die Wörter werden weder protokolliert noch
    /// gespeichert.
    func knownWords(locale: String, words: [String]) -> JSONValue {
        let checker = NSSpellChecker.shared
        let language = Self.spellLanguage(for: locale, available: checker.availableLanguages)
        var known: [String] = []
        for word in words.prefix(200) where !word.isEmpty {
            let range = checker.checkSpelling(
                of: word, startingAt: 0, language: language, wrap: false, inSpellDocumentWithTag: 0, wordCount: nil)
            if range.location == NSNotFound { known.append(word) }
        }
        return ["known": .strings(known), "language": .optionalString(language)]
    }

    /// „de-DE“ → „de_DE“, wenn der Prüfer die Variante kennt, sonst „de“ (oder
    /// eine andere Variante der Sprache); nil = der Prüfer wählt selbst.
    nonisolated static func spellLanguage(for locale: String, available: [String]) -> String? {
        let underscored = locale.replacingOccurrences(of: "-", with: "_")
        if available.contains(underscored) { return underscored }
        let base = String(locale.split(whereSeparator: { $0 == "-" || $0 == "_" }).first ?? Substring(""))
        guard !base.isEmpty else { return nil }
        if available.contains(base) { return base }
        return available.first { $0.hasPrefix(base + "_") }
    }

    // MARK: Accessibility

    /// Setzt `kAXSelectedTextAttribute` des fokussierten Elements. Viele
    /// Programme (WebViews, Electron) nehmen den Wert an, ohne ihn
    /// einzufügen — deshalb wird, wo möglich, über `kAXValueAttribute`
    /// nachgeprüft, sonst über die Zeichenzahl.
    ///
    /// Live-Befund 02.10.2026: Nach langem Diktat kamen im fremden Programm nur
    /// Punkte an, obwohl die Erkennung ganze Sätze lieferte und jedes Einsetzen
    /// „erfolgreich“ war. In Web-Inhalten (Chromium, Electron, WebKit) ist das
    /// Setzen von AXSelectedText nicht verlässlich und der Wert oft nicht
    /// lesbar – dort geht der Text deshalb immer über die Zwischenablage.
    private func insertViaAccessibility(_ text: String) -> Bool {
        let systemWide = AXUIElementCreateSystemWide()
        var focusedRef: CFTypeRef?
        let focusedStatus = AXUIElementCopyAttributeValue(
            systemWide, kAXFocusedUIElementAttribute as CFString, &focusedRef)
        guard focusedStatus == .success, let focusedRef else { return false }
        // swiftlint:disable:next force_cast
        let element = focusedRef as! AXUIElement

        if Self.isInWebContent(element) { return false }

        var settable = DarwinBoolean(false)
        let settableStatus = AXUIElementIsAttributeSettable(
            element, kAXSelectedTextAttribute as CFString, &settable)
        guard settableStatus == .success, settable.boolValue else { return false }

        let countBefore = Self.characterCount(element)
        let setStatus = AXUIElementSetAttributeValue(
            element, kAXSelectedTextAttribute as CFString, text as CFTypeRef)
        guard setStatus == .success else { return false }

        // Nachprüfen, wenn der Wert lesbar ist; sonst muss sich wenigstens die
        // Zeichenzahl geändert haben. Nur ohne beides dem Ergebniscode vertrauen.
        var valueRef: CFTypeRef?
        let valueStatus = AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &valueRef)
        if valueStatus == .success, let value = valueRef as? String {
            let probe = text.count > 200 ? String(text.prefix(200)) : text
            return value.contains(probe)
        }
        if let countBefore, let countAfter = Self.characterCount(element) {
            return countAfter != countBefore
        }
        return true
    }

    /// Liegt das Element in Web-Inhalt (Rolle `AXWebArea` in der Vorfahrenkette)?
    static func isInWebContent(_ element: AXUIElement) -> Bool {
        var current: AXUIElement? = element
        for _ in 0..<40 {
            guard let node = current else { return false }
            if Self.role(of: node) == "AXWebArea" { return true }
            var parentRef: CFTypeRef?
            guard AXUIElementCopyAttributeValue(node, kAXParentAttribute as CFString, &parentRef) == .success,
                let parentRef, CFGetTypeID(parentRef) == AXUIElementGetTypeID()
            else { return false }
            // swiftlint:disable:next force_cast
            current = (parentRef as! AXUIElement)
        }
        return false
    }

    private static func role(of element: AXUIElement) -> String? {
        var roleRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleRef) == .success else {
            return nil
        }
        return roleRef as? String
    }

    private static func characterCount(_ element: AXUIElement) -> Int? {
        var countRef: CFTypeRef?
        guard
            AXUIElementCopyAttributeValue(element, kAXNumberOfCharactersAttribute as CFString, &countRef) == .success
        else { return nil }
        return (countRef as? NSNumber)?.intValue
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
        // Gekennzeichnet: die fn-Erkennung darf das eigene ⌘V nicht als
        // „fn + andere Taste“ werten (sonst bricht ein gehaltenes Diktat ab).
        SyntheticKeyEvents.mark(down)
        SyntheticKeyEvents.mark(up)
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
        table["text.knownWords"] = { request in
            let locale = try request.params.optionalString("locale") ?? SpeechCommands.defaultLocale()
            let words = try request.params.stringArray("words")
            return await services.text.knownWords(locale: locale, words: words)
        }
    }
}

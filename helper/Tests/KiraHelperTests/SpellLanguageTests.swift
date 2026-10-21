import XCTest

@testable import KiraHelper

/// Wahl der Prüfsprache für `text.knownWords` (reine Funktion).
final class SpellLanguageTests: XCTestCase {
    func testPrefersExactVariantThenBaseThenAnyVariant() {
        let available = ["de", "de_AT", "en", "en_US", "fr_FR"]
        XCTAssertEqual(TextInserter.spellLanguage(for: "de-AT", available: available), "de_AT")
        XCTAssertEqual(TextInserter.spellLanguage(for: "de-DE", available: available), "de")
        XCTAssertEqual(TextInserter.spellLanguage(for: "fr-CA", available: available), "fr_FR")
        XCTAssertNil(TextInserter.spellLanguage(for: "xx-YY", available: available))
        XCTAssertNil(TextInserter.spellLanguage(for: "", available: available))
    }
}

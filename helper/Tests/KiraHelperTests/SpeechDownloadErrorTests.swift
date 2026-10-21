import Foundation
import XCTest

@testable import KiraHelper

final class SpeechDownloadErrorTests: XCTestCase {
    func testNetworkNamesTheCause() {
        let error = NSError(domain: NSURLErrorDomain, code: NSURLErrorNotConnectedToInternet, userInfo: [
            NSLocalizedDescriptionKey: "The Internet connection appears to be offline.",
        ])
        let text = SpeechDownloadError.explain(error, locale: "de-DE")
        XCTAssertEqual(SpeechDownloadError.reasonCode(error), "network")
        XCTAssertTrue(text.contains("keine Verbindung zu Apple"))
        XCTAssertTrue(text.contains("de-DE"))
        XCTAssertTrue(text.contains("NSURLErrorDomain -1009"))
        XCTAssertTrue(text.contains("Firewall"))
    }

    func testWalksUnderlyingNetworkError() {
        let underlying = NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut)
        let wrapper = NSError(domain: "AssetError", code: 1, userInfo: [NSUnderlyingErrorKey: underlying])
        XCTAssertEqual(SpeechDownloadError.reasonCode(wrapper), "network")
        XCTAssertTrue(SpeechDownloadError.explain(wrapper, locale: "en-US").contains("AssetError 1 → NSURLErrorDomain -1001"))
    }

    func testPermissionAndCancel() {
        let denied = NSError(domain: NSCocoaErrorDomain, code: NSFileReadNoPermissionError)
        XCTAssertEqual(SpeechDownloadError.reasonCode(denied), "permission")
        XCTAssertTrue(SpeechDownloadError.explain(denied, locale: "de-DE").contains("Zugriff verweigert"))

        let posix = NSError(domain: NSPOSIXErrorDomain, code: 13)
        XCTAssertEqual(SpeechDownloadError.reasonCode(posix), "permission")

        let cancel = NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled)
        XCTAssertEqual(SpeechDownloadError.reasonCode(cancel), "cancelled")
        XCTAssertTrue(SpeechDownloadError.explain(cancel, locale: "de-DE").contains("abgebrochen"))
    }

    func testUnknownKeepsDomainAndCode() {
        let error = NSError(domain: "com.apple.MobileAsset", code: 42, userInfo: [
            NSLocalizedDescriptionKey: "The operation couldn’t be completed.",
        ])
        XCTAssertEqual(SpeechDownloadError.reasonCode(error), "failed")
        let text = SpeechDownloadError.explain(error, locale: "de-DE")
        XCTAssertTrue(text.contains("com.apple.MobileAsset 42"))
        XCTAssertFalse(text.contains("The operation couldn’t be completed"))
    }
}

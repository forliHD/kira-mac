import Foundation

/// Deutsche Ursache, wenn das Laden eines Diktat-Modells scheitert.
/// Reine Abbildung von Domain/Code (kein Speech-Framework), damit die
/// Meldung auf dem betroffenen Mac die echte Ursache nennt: Netz, Freigabe,
/// Abbruch – und Domain plus Code, falls keine der bekannten Klassen passt.
enum SpeechDownloadError {
    /// Maschinenlesbar im Feld `error.reason` (`network`, `permission`, …).
    static func reasonCode(_ error: any Error) -> String {
        let ns = error as NSError
        if isNetwork(ns) { return "network" }
        if isPermission(ns) { return "permission" }
        if isCancelled(ns) { return "cancelled" }
        return "failed"
    }

    /// Satz für den Menschen. `locale` ist der BCP-47-Code („de-DE“).
    static func explain(_ error: any Error, locale: String) -> String {
        let ns = error as NSError
        let detail = chain(ns)
        if isNetwork(ns) {
            return "Das Diktat-Modell für „\(locale)“ konnte nicht geladen werden: keine Verbindung zu Apple (\(detail)). Prüfe WLAN, VPN und Proxy. Auf verwalteten Macs blockiert oft eine Firewall die Server, von denen macOS Sprachmodelle lädt."
        }
        if isPermission(ns) {
            return "Das Diktat-Modell für „\(locale)“ konnte nicht geladen werden: macOS hat den Zugriff verweigert (\(detail)). Prüfe „Datenschutz & Sicherheit“ und ob eine Geräteverwaltung den Download sperrt."
        }
        if isCancelled(ns) {
            return "Das Laden des Diktat-Modells für „\(locale)“ wurde abgebrochen (\(detail))."
        }
        let text = ns.localizedDescription
        let readable = text.isEmpty || text.hasPrefix("The operation couldn’t be completed") ? detail : "\(text) (\(detail))"
        return "Das Diktat-Modell für „\(locale)“ konnte nicht geladen werden: \(readable)."
    }

    /// `domain code`, darunterliegende Fehler mit ` → ` angehängt (höchstens 4).
    static func chain(_ error: NSError, depth: Int = 0) -> String {
        let here = "\(error.domain) \(error.code)"
        guard depth < 4, let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError else {
            return here
        }
        return "\(here) → \(chain(underlying, depth: depth + 1))"
    }

    static func isNetwork(_ error: NSError, depth: Int = 0) -> Bool {
        if error.domain == NSURLErrorDomain {
            switch error.code {
            case NSURLErrorNotConnectedToInternet,
                NSURLErrorNetworkConnectionLost,
                NSURLErrorDataNotAllowed,
                NSURLErrorTimedOut,
                NSURLErrorCannotFindHost,
                NSURLErrorCannotConnectToHost,
                NSURLErrorDNSLookupFailed,
                NSURLErrorInternationalRoamingOff,
                NSURLErrorCallIsActive,
                NSURLErrorSecureConnectionFailed,
                NSURLErrorServerCertificateUntrusted,
                NSURLErrorCannotLoadFromNetwork:
                return true
            default:
                break
            }
        }
        if error.domain == kCFErrorDomainCFNetwork as String { return true }
        return underlying(error, depth: depth, where: isNetwork)
    }

    static func isPermission(_ error: NSError, depth: Int = 0) -> Bool {
        if error.domain == NSCocoaErrorDomain && (error.code == NSFileReadNoPermissionError || error.code == NSFileWriteNoPermissionError) {
            return true
        }
        // EPERM / EACCES
        if error.domain == NSPOSIXErrorDomain && (error.code == 1 || error.code == 13) {
            return true
        }
        return underlying(error, depth: depth, where: isPermission)
    }

    static func isCancelled(_ error: NSError, depth: Int = 0) -> Bool {
        if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled { return true }
        if error.domain == NSCocoaErrorDomain && error.code == NSUserCancelledError { return true }
        return underlying(error, depth: depth, where: isCancelled)
    }

    private static func underlying(_ error: NSError, depth: Int, where matches: (NSError, Int) -> Bool) -> Bool {
        guard depth < 4, let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError else { return false }
        return matches(underlying, depth + 1)
    }
}

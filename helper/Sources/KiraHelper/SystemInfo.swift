import Foundation

/// Versions- und Chip-Erkennung für `info`.
enum SystemInfo {
    /// Version des Helfers (unabhängig von der App-Version der Hülle).
    static let helperVersion = "0.1.0"

    /// macOS-Version als „27.0.1“.
    static var macOSVersion: String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)"
    }

    static func isAtLeast(major: Int, minor: Int = 0) -> Bool {
        ProcessInfo.processInfo.isOperatingSystemAtLeast(
            OperatingSystemVersion(majorVersion: major, minorVersion: minor, patchVersion: 0))
    }

    /// Chip-Bezeichnung aus `sysctl machdep.cpu.brand_string` (z. B. „Apple M3“).
    static var chip: String {
        sysctlString("machdep.cpu.brand_string") ?? "unbekannt"
    }

    /// Apple Silicon oder Rosetta/Intel — nur informativ.
    static var isAppleSilicon: Bool {
        #if arch(arm64)
            return true
        #else
            return false
        #endif
    }

    private static func sysctlString(_ name: String) -> String? {
        var size = 0
        guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return nil }
        var buffer = [CChar](repeating: 0, count: size)
        guard sysctlbyname(name, &buffer, &size, nil, 0) == 0 else { return nil }
        let value = buffer.withUnsafeBufferPointer { pointer -> String in
            guard let base = pointer.baseAddress else { return "" }
            return String(cString: base)
        }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// Wird von `withTimeout` (Speech/AudioSupport.swift) nach Ablauf geworfen.
struct TimeoutError: Error, Sendable {}

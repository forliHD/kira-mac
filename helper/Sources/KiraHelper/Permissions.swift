import AVFoundation
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import Speech

/// Berechtigungen: Mikrofon, Spracherkennung, Bedienungshilfen (Accessibility),
/// Bildschirmaufnahme. Zustandslos; alle Abfragen gehen an das System.
///
/// Hinweis: Als Kommandozeilenprozess wird der Helfer in den Systemeinstellungen
/// unter dem „verantwortlichen Prozess“ geführt — beim Start aus der Mac-App
/// also unter „KIRA für Mac“, aus dem Terminal unter dem Terminal.
final class PermissionsService: Sendable {
    enum Kind: String, CaseIterable, Sendable {
        case microphone, speech, accessibility, screenRecording
    }

    /// Gemeinsame Statuswerte für Mikrofon und Sprache.
    enum GrantStatus: String, Sendable {
        case granted, denied, notDetermined, notRequired
    }

    // MARK: Mikrofon

    func microphoneStatus() -> GrantStatus {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return .granted
        case .denied, .restricted: return .denied
        case .notDetermined: return .notDetermined
        @unknown default: return .denied
        }
    }

    func requestMicrophone() async -> GrantStatus {
        if microphoneStatus() == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .audio)
        }
        return microphoneStatus()
    }

    /// Wirft `permission_denied`, wenn das Mikrofon nicht nutzbar ist; eine
    /// noch offene Freigabe wird dabei beim System angefragt.
    func ensureMicrophone() async throws {
        let status = await requestMicrophone()
        guard status == .granted else {
            throw HelperError(
                .permissionDenied,
                "Kein Zugriff auf das Mikrofon. Bitte in den Systemeinstellungen unter „Datenschutz & Sicherheit → Mikrofon“ freigeben.",
                reason: status.rawValue)
        }
    }

    // MARK: Sprache

    /// `analyzerEngine == true`: der SpeechAnalyzer-Pfad (macOS 26+) braucht
    /// keine Freigabe für Spracherkennung — dann `notRequired`.
    func speechStatus(analyzerEngine: Bool) -> GrantStatus {
        if analyzerEngine { return .notRequired }
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: return .granted
        case .denied, .restricted: return .denied
        case .notDetermined: return .notDetermined
        @unknown default: return .denied
        }
    }

    func requestSpeech(analyzerEngine: Bool) async -> GrantStatus {
        if analyzerEngine { return .notRequired }
        if speechStatus(analyzerEngine: false) == .notDetermined {
            _ = await withCheckedContinuation { (continuation: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
                SFSpeechRecognizer.requestAuthorization { status in
                    continuation.resume(returning: status)
                }
            }
        }
        return speechStatus(analyzerEngine: false)
    }

    /// Nur für den Legacy-Pfad (`SFSpeechRecognizer`).
    func ensureSpeechAuthorization() async throws {
        let status = await requestSpeech(analyzerEngine: false)
        guard status == .granted else {
            throw HelperError(
                .permissionDenied,
                "Keine Freigabe für Spracherkennung. Bitte in den Systemeinstellungen unter „Datenschutz & Sicherheit → Spracherkennung“ erlauben.",
                reason: status.rawValue)
        }
    }

    // MARK: Bedienungshilfen / Bildschirmaufnahme

    static func accessibilityTrusted() -> Bool {
        AXIsProcessTrusted()
    }

    static func screenCaptureGranted() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    @MainActor
    private func requestAccessibility() -> Bool {
        if AXIsProcessTrusted() { return true }
        // Zeigt den Systemdialog „… möchte diesen Computer mit Bedienungshilfen steuern“.
        // Wert der Konstante `kAXTrustedCheckOptionPrompt` (die globale Variable
        // ist in Swift 6 nicht nebenläufigkeitssicher ansprechbar).
        let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        let trusted = AXIsProcessTrustedWithOptions(options)
        if !trusted {
            Self.openSystemSettings("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        }
        return trusted
    }

    @MainActor
    private func requestScreenRecording() -> Bool {
        if CGPreflightScreenCaptureAccess() { return true }
        // Systemdialog nur beim ersten Mal; danach muss der Nutzer die Seite selbst öffnen.
        let granted = CGRequestScreenCaptureAccess()
        if !granted {
            Self.openSystemSettings("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        }
        return granted
    }

    @MainActor
    private static func openSystemSettings(_ urlString: String) {
        guard let url = URL(string: urlString) else { return }
        NSWorkspace.shared.open(url)
    }

    // MARK: Kommandos

    func status(analyzerEngine: Bool) -> JSONValue {
        [
            "microphone": .string(microphoneStatus().rawValue),
            "speech": .string(speechStatus(analyzerEngine: analyzerEngine).rawValue),
            "accessibility": .bool(Self.accessibilityTrusted()),
            "screenRecording": .bool(Self.screenCaptureGranted()),
        ]
    }

    func request(kind: Kind, analyzerEngine: Bool) async -> JSONValue {
        switch kind {
        case .microphone:
            return ["status": .string(await requestMicrophone().rawValue)]
        case .speech:
            return ["status": .string(await requestSpeech(analyzerEngine: analyzerEngine).rawValue)]
        case .accessibility:
            return ["status": .bool(await requestAccessibility())]
        case .screenRecording:
            return ["status": .bool(await requestScreenRecording())]
        }
    }
}

enum PermissionCommands {
    static func register(into table: inout [String: CommandHandler], services: Services) {
        table["permissions.status"] = { _ in
            let analyzer = await services.speech.usesAnalyzer()
            return services.permissions.status(analyzerEngine: analyzer)
        }
        table["permissions.request"] = { request in
            let raw = try request.params.string("kind")
            guard let kind = PermissionsService.Kind(rawValue: raw) else {
                let allowed = PermissionsService.Kind.allCases.map(\.rawValue).joined(separator: ", ")
                throw HelperError.badParams("Unbekannte Berechtigung „\(raw)“ (erlaubt: \(allowed)).")
            }
            let analyzer = await services.speech.usesAnalyzer()
            return await services.permissions.request(kind: kind, analyzerEngine: analyzer)
        }
    }
}

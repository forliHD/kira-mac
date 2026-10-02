import AppKit
import ApplicationServices
import Carbon.HIToolbox
import CoreGraphics
import Foundation

// fn-Taste (🌐) als Auslöser des globalen Diktats: `fn.watch` und `fn.status`.
//
// Ein passiver Event-Tap (`listenOnly`, Sitzungsebene) läuft auf einem
// EIGENEN Thread mit eigener Run-Loop – unabhängig davon, was der
// Main-Thread des Helfers gerade tut. Er meldet nur drei Dinge:
// `fn.down`, `fn.chord` (während fn gedrückt ist, kam irgendeine andere
// Taste) und `fn.up`. Was „Tippen“, „Halten“ und „Kombination“ bedeutet,
// entscheidet die Hülle (src/main/fn-key.ts).
//
// Datenschutz: Der Tap sieht technisch jeden Tastendruck. Andere Tasten
// werden nur angesehen, solange fn gedrückt ist, und auch dann nur als
// Wahrheitswert „es kam eine Taste“. Tastencodes und Zeichen werden nie
// gelesen (außer dem Code der Zusatztaste selbst, um fn zu erkennen), nie
// gesendet, nie protokolliert, nie gespeichert.

// MARK: - Buchführung (rein, ohne Tap testbar)

/// Zustand der fn-Taste über eine Folge abstrakter Eingaben. Kennt keine
/// Tastencodes – nur „fn gedrückt/losgelassen“ und „andere Taste kam“.
struct FnChordTracker: Sendable, Equatable {
    enum Input: Equatable, Sendable {
        /// fn/🌐 gedrückt bzw. losgelassen; `othersHeld`: ⇧⌃⌥⌘ waren dabei schon unten.
        case fn(down: Bool, othersHeld: Bool)
        /// Eine andere Zusatztaste (⇧⌃⌥⌘) wurde gedrückt.
        case modifierPressed
        /// Eine andere Taste wurde gedrückt (auch Medien- und Helligkeitstasten).
        case keyPressed
        /// Der Tap war kurz aus: tatsächlicher Zustand der fn-Taste danach.
        case resync(fnDown: Bool)
    }

    enum Output: Equatable, Sendable {
        /// `secure`: sichere Texteingabe war aktiv (Passwortfeld) – dann sieht
        /// der Tap keine anderen Tasten, eine Kombination ist nicht erkennbar.
        case down(secure: Bool)
        /// Erste andere Taste während dieses Drucks (höchstens einmal je Druck).
        case chord
        case up(chord: Bool)
    }

    private(set) var fnDown = false
    private(set) var chorded = false

    /// - Parameter secureInput: nur für `fn(down: true, …)` von Bedeutung.
    mutating func handle(_ input: Input, secureInput: Bool = false) -> [Output] {
        switch input {
        case .fn(let down, let othersHeld):
            if down {
                guard !fnDown else { return [] }
                fnDown = true
                chorded = othersHeld
                // fn zu schon gehaltenem ⌘/⌥/⌃/⇧ ist von vornherein eine Kombination.
                return othersHeld ? [.down(secure: secureInput), .chord] : [.down(secure: secureInput)]
            }
            guard fnDown else { return [] }
            let wasChorded = chorded
            fnDown = false
            chorded = false
            return [.up(chord: wasChorded)]
        case .modifierPressed, .keyPressed:
            guard fnDown, !chorded else { return [] }
            chorded = true
            return [.chord]
        case .resync(let down):
            // Nur ein verpasstes Loslassen nachholen; ein verpasstes Drücken
            // löst nie etwas aus.
            guard fnDown, !down else { return [] }
            return handle(.fn(down: false, othersHeld: false))
        }
    }
}

extension FnChordTracker.Output {
    /// Protokoll-Ereignis: nur Wahrheitswerte, nie Tastencodes oder Zeichen.
    var event: Event {
        switch self {
        case .down(let secure): return Event("fn.down", data: ["secure": .bool(secure)])
        case .chord: return Event("fn.chord")
        case .up(let chord): return Event("fn.up", data: ["chord": .bool(chord)])
        }
    }
}

// MARK: - Einordnung eines Tap-Ereignisses (rein)

enum FnEventClassifier {
    /// NX_SYSDEFINED – Medien-, Lautstärke-, Helligkeitstasten. Kein Fall von
    /// `CGEventType`, deshalb als Rohwert.
    static let systemDefinedType: UInt32 = 14
    /// NX_SUBTYPE_AUX_CONTROL_BUTTONS (Untertyp 7 sind Maustasten – die zählen nicht).
    static let auxControlButtonsSubtype = 8

    /// ⇧⌃⌥⌘ – alles, was zusammen mit fn eine Kombination ergibt (Feststelltaste nicht).
    static let otherModifiers: CGEventFlags = [.maskShift, .maskControl, .maskAlternate, .maskCommand]

    /// Codes der Zusatztasten außer fn (links/rechts, Feststelltaste).
    static let modifierKeyCodes: Set<Int64> = [
        Int64(kVK_Command), Int64(kVK_RightCommand), Int64(kVK_Shift), Int64(kVK_RightShift),
        Int64(kVK_Option), Int64(kVK_RightOption), Int64(kVK_Control), Int64(kVK_RightControl),
        Int64(kVK_CapsLock),
    ]

    static var eventMask: CGEventMask {
        (CGEventMask(1) << CGEventMask(CGEventType.flagsChanged.rawValue))
            | (CGEventMask(1) << CGEventMask(CGEventType.keyDown.rawValue))
            | (CGEventMask(1) << CGEventMask(systemDefinedType))
    }

    /// Macht aus einem Tap-Ereignis eine Eingabe für den Tracker (oder nil).
    /// - Parameters:
    ///   - type: `CGEventType.rawValue`
    ///   - keyCode: nur bei `flagsChanged` von Belang (welche Zusatztaste)
    ///   - previousFlags: Zusatztasten vor diesem Ereignis
    ///   - systemDefinedKeyDown: bei NX_SYSDEFINED „Taste gedrückt“, sonst nil
    static func classify(
        type: UInt32, keyCode: Int64, flags: CGEventFlags, previousFlags: CGEventFlags,
        systemDefinedKeyDown: Bool?
    ) -> FnChordTracker.Input? {
        switch type {
        case CGEventType.flagsChanged.rawValue:
            let fnNow = flags.contains(.maskSecondaryFn)
            let fnBefore = previousFlags.contains(.maskSecondaryFn)
            // kVK_Function (63) ist fn/🌐; manche Tastaturen melden die
            // Globus-Taste mit eigenem Code – dann zählt der Wechsel des fn-Flags.
            if keyCode == Int64(kVK_Function) || (!modifierKeyCodes.contains(keyCode) && fnNow != fnBefore) {
                return .fn(down: fnNow, othersHeld: !flags.intersection(otherModifiers).isEmpty)
            }
            let pressed = flags.intersection(otherModifiers).subtracting(previousFlags.intersection(otherModifiers))
            return pressed.isEmpty ? nil : .modifierPressed
        case CGEventType.keyDown.rawValue:
            return .keyPressed
        case systemDefinedType:
            return systemDefinedKeyDown == true ? .keyPressed : nil
        default:
            return nil
        }
    }

    /// NX_SYSDEFINED: eine Medien-/Helligkeitstaste wurde gedrückt (Zustand
    /// 0xA = gedrückt, 0xB = losgelassen). Der Tastencode in den oberen Bits
    /// von `data1` wird bewusst nicht ausgewertet.
    static func isAuxKeyDown(subtype: Int, data1: Int) -> Bool {
        guard subtype == auxControlButtonsSubtype else { return false }
        let keyFlags = data1 & 0xFFFF
        return (keyFlags & 0xFF00) >> 8 == 0x0A
    }
}

// MARK: - Monitor (Tap auf eigenem Thread)

/// Hört auf die fn-Taste. Lebt so lange wie der Helfer (`Services`); der
/// Tap bekommt deshalb einen nicht gehaltenen Zeiger auf ihn.
final class FnKeyMonitor: @unchecked Sendable {
    enum TapState: String, Sendable {
        /// Nicht eingeschaltet.
        case off
        /// Tap läuft.
        case active
        /// Weder Bedienungshilfen noch Eingabeüberwachung erlaubt.
        case permission
        /// Tap ließ sich trotz Freigabe nicht anlegen.
        case failed
    }

    static let permissionMessage =
        "KIRA sieht die fn-Taste erst mit der Freigabe „Bedienungshilfen“. Bitte „KIRA für Mac“ unter „Datenschutz & Sicherheit → Bedienungshilfen“ erlauben."
    static let failedMessage = "Die fn-Taste lässt sich gerade nicht abhören (macOS hat den Event-Tap abgelehnt)."

    private let writer: OutputWriter
    /// Ein `fn.watch` nach dem anderen (zwei Anfragen dürfen sich überlappen).
    private let control = NSLock()
    /// Schützt alles darunter; der Tap-Thread liest es in jedem Ereignis.
    private let lock = NSLock()
    private var port: CFMachPort?
    private var source: CFRunLoopSource?
    private var runLoop: CFRunLoop?
    private var continuation: AsyncStream<Event>.Continuation?
    private var pump: Task<Void, Never>?
    private var tracker = FnChordTracker()
    private var lastFlags: CGEventFlags = []
    private var tapState: TapState = .off

    init(writer: OutputWriter) {
        self.writer = writer
    }

    var isWatching: Bool {
        lock.withLock { port != nil }
    }

    // MARK: Ein/aus

    /// Legt den Tap an und startet seinen Thread. Wirft `permission_denied`
    /// ohne Freigabe – fragt aber nie selbst nach (kein zweiter Systemdialog
    /// „Eingabeüberwachung“; die Hülle führt zu „Bedienungshilfen“).
    func start() throws {
        try control.withLock {
            if lock.withLock({ port != nil }) { return }

            let trusted = AXIsProcessTrusted()
            guard trusted || CGPreflightListenEventAccess() else {
                lock.withLock { tapState = .permission }
                throw HelperError(.permissionDenied, Self.permissionMessage, reason: "accessibility")
            }
            guard
                let port = CGEvent.tapCreate(
                    tap: .cgSessionEventTap,
                    place: .headInsertEventTap,
                    options: .listenOnly,
                    eventsOfInterest: FnEventClassifier.eventMask,
                    callback: fnTapCallback,
                    userInfo: Unmanaged.passUnretained(self).toOpaque())
            else {
                lock.withLock { tapState = trusted ? .failed : .permission }
                if trusted { throw HelperError(.internalError, Self.failedMessage) }
                throw HelperError(.permissionDenied, Self.permissionMessage, reason: "accessibility")
            }
            guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, port, 0) else {
                CFMachPortInvalidate(port)
                lock.withLock { tapState = .failed }
                throw HelperError(.internalError, Self.failedMessage)
            }

            // Ereignisse in Reihenfolge über EINE Task an den Writer – der
            // Tap-Thread selbst wartet nie auf stdout.
            let (stream, continuation) = AsyncStream.makeStream(of: Event.self, bufferingPolicy: .bufferingNewest(64))
            let writer = self.writer
            let pump = Task.detached {
                for await event in stream {
                    await writer.send(event)
                }
            }
            lock.withLock {
                self.port = port
                self.source = source
                self.continuation = continuation
                self.pump = pump
                self.tracker = FnChordTracker()
                self.lastFlags = CGEventSource.flagsState(.combinedSessionState)
                self.tapState = .active
            }

            let ready = DispatchSemaphore(value: 0)
            let thread = Thread { [self] in
                runTapLoop(ready: ready)
            }
            thread.name = "kira-fn-tap"
            thread.qualityOfService = .userInteractive
            thread.start()
            ready.wait()
            HelperLog.info("fn-Taste: Tap aktiv (listenOnly, eigener Thread).")
        }
    }

    /// Schaltet den Tap ab und beendet seinen Thread (idempotent).
    func stop() {
        control.withLock {
            let taken = lock.withLock { () -> (CFMachPort?, CFRunLoop?, AsyncStream<Event>.Continuation?) in
                let taken = (port, runLoop, continuation)
                port = nil
                source = nil
                runLoop = nil
                continuation = nil
                pump = nil
                tracker = FnChordTracker()
                tapState = .off
                return taken
            }
            guard let port = taken.0 else { return }
            CGEvent.tapEnable(tap: port, enable: false)
            CFMachPortInvalidate(port)
            if let runLoop = taken.1 { CFRunLoopStop(runLoop) }
            taken.2?.finish()
            HelperLog.info("fn-Taste: Tap aus.")
        }
    }

    /// Läuft auf dem Tap-Thread: Quelle in die eigene Run-Loop, dann warten.
    private func runTapLoop(ready: DispatchSemaphore) {
        let current: CFRunLoop = CFRunLoopGetCurrent()
        let setup = lock.withLock { () -> (CFMachPort, CFRunLoopSource)? in
            guard let port, let source else { return nil }
            runLoop = current
            return (port, source)
        }
        guard let setup else {
            ready.signal()
            return
        }
        CFRunLoopAddSource(current, setup.1, .commonModes)
        CGEvent.tapEnable(tap: setup.0, enable: true)
        ready.signal()
        CFRunLoopRun()
    }

    // MARK: Status

    func status() -> JSONValue {
        let (watching, state) = lock.withLock { (port != nil, tapState) }
        return [
            "watching": .bool(watching),
            "tap": .string(state.rawValue),
            "accessibility": .bool(AXIsProcessTrusted()),
            "inputMonitoring": .bool(CGPreflightListenEventAccess()),
            "fnUsage": Self.systemFnUsage().map { JSONValue.int($0) } ?? .null,
        ]
    }

    /// macOS „🌐 drücken für“ (`com.apple.HIToolbox` → `AppleFnUsageType`):
    /// 0 keine Aktion, 1 Eingabequelle wechseln, 2 Emoji & Symbole,
    /// 3 Diktat starten; nil = nie geändert (macOS-Standard). Nur gelesen –
    /// KIRA ändert diese Systemeinstellung nie.
    static func systemFnUsage() -> Int? {
        let domain = "com.apple.HIToolbox" as CFString
        CFPreferencesAppSynchronize(domain)
        return parseFnUsage(CFPreferencesCopyAppValue("AppleFnUsageType" as CFString, domain))
    }

    static func parseFnUsage(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber else { return nil }
        // Ein Wahrheitswert wäre ein Fehlformat – nicht als 0/1 deuten.
        if CFGetTypeID(number) == CFBooleanGetTypeID() { return nil }
        return number.intValue
    }

    // MARK: Tap-Ereignisse (Tap-Thread)

    fileprivate func handle(type: CGEventType, event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            reenable(reason: type == .tapDisabledByTimeout ? "Zeitüberschreitung" : "Nutzereingabe")
            return
        }
        let raw = type.rawValue
        let isFlagsChanged = raw == CGEventType.flagsChanged.rawValue
        var outputs: [FnChordTracker.Output] = []
        var sink: AsyncStream<Event>.Continuation?
        lock.withLock {
            // Andere Tasten interessieren nur, solange fn gedrückt ist – sonst
            // wird das Ereignis gar nicht erst angesehen.
            guard isFlagsChanged || tracker.fnDown else { return }
            let flags = event.flags
            let previous = lastFlags
            if isFlagsChanged { lastFlags = flags }
            let keyCode = isFlagsChanged ? event.getIntegerValueField(.keyboardEventKeycode) : 0
            let auxDown: Bool? = raw == FnEventClassifier.systemDefinedType ? Self.isAuxKeyDown(event) : nil
            guard
                let input = FnEventClassifier.classify(
                    type: raw, keyCode: keyCode, flags: flags, previousFlags: previous, systemDefinedKeyDown: auxDown)
            else { return }
            var secure = false
            if case .fn(down: true, othersHeld: _) = input {
                secure = IsSecureEventInputEnabled()
            }
            outputs = tracker.handle(input, secureInput: secure)
            sink = continuation
        }
        for output in outputs {
            sink?.yield(output.event)
        }
    }

    private static func isAuxKeyDown(_ event: CGEvent) -> Bool {
        guard let ns = NSEvent(cgEvent: event), ns.type == .systemDefined else { return false }
        return FnEventClassifier.isAuxKeyDown(subtype: Int(ns.subtype.rawValue), data1: ns.data1)
    }

    /// macOS schaltet einen Tap ab, wenn er zu langsam war (oder auf
    /// Nutzerwunsch); dann sofort wieder an und ein verpasstes Loslassen von
    /// fn nachholen.
    private func reenable(reason: String) {
        var outputs: [FnChordTracker.Output] = []
        var sink: AsyncStream<Event>.Continuation?
        let reenabled = lock.withLock { () -> Bool in
            guard let port else { return false }
            CGEvent.tapEnable(tap: port, enable: true)
            let flags = CGEventSource.flagsState(.combinedSessionState)
            lastFlags = flags
            outputs = tracker.handle(.resync(fnDown: flags.contains(.maskSecondaryFn)))
            sink = continuation
            return true
        }
        guard reenabled else { return }
        HelperLog.warn("fn-Taste: Tap war abgeschaltet (\(reason)) – wieder eingeschaltet.")
        for output in outputs {
            sink?.yield(output.event)
        }
    }
}

/// C-Rückruf des Event-Taps; `refcon` zeigt auf den `FnKeyMonitor`.
/// Ein `listenOnly`-Tap gibt das Ereignis unverändert weiter.
private func fnTapCallback(
    proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    if let refcon {
        Unmanaged<FnKeyMonitor>.fromOpaque(refcon).takeUnretainedValue().handle(type: type, event: event)
    }
    return Unmanaged.passUnretained(event)
}

// MARK: - Kommandos

enum FnKeyCommands {
    static func register(into table: inout [String: CommandHandler], services: Services) {
        /// `{"enabled": true|false}` → Status wie `fn.status`.
        table["fn.watch"] = { request in
            guard let enabled = try request.params.optionalBool("enabled") else {
                throw HelperError.badParams("Parameter „enabled“ fehlt.")
            }
            if enabled {
                try services.fnKey.start()
            } else {
                services.fnKey.stop()
            }
            return services.fnKey.status()
        }
        table["fn.status"] = { _ in
            services.fnKey.status()
        }
    }
}

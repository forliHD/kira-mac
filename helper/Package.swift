// swift-tools-version: 6.0
import PackageDescription

// Der Helfer ist eine einzelne Kommandozeilen-Binärdatei (`kira-helper`), die
// die Electron-Hülle startet und über JSON-Zeilen anspricht
// (siehe docs/helper-protocol.md). Das Modul heißt `KiraHelper`, damit die
// Tests es mit `@testable import KiraHelper` laden können; das gebaute Produkt
// heißt weiterhin `kira-helper` (`.build/release/kira-helper`).
let package = Package(
    name: "KiraHelper",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "kira-helper", targets: ["KiraHelper"]),
    ],
    targets: [
        .executableTarget(
            name: "KiraHelper",
            path: "Sources/KiraHelper",
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
        .testTarget(
            name: "KiraHelperTests",
            dependencies: ["KiraHelper"],
            path: "Tests/KiraHelperTests",
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
    ]
)

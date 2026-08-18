// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "SiteSourceryResponder",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(name: "ResponderCore", targets: ["ResponderCore"]),
        .executable(name: "ResponderCoreProof", targets: ["ResponderCoreProof"])
    ],
    targets: [
        .target(name: "ResponderCore"),
        .executableTarget(
            name: "ResponderCoreProof",
            dependencies: ["ResponderCore"],
            path: "Proofs/ResponderCoreProof"
        )
    ]
)

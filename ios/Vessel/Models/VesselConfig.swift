import Foundation

struct VesselConfig: Equatable {
    var nexusURL: URL
    var token: String
    var allowInsecureTLS: Bool

    static let `default` = VesselConfig(
        nexusURL: URL(string: "wss://nexus.tail41686e.ts.net:7888/connect")!,
        token: "",
        allowInsecureTLS: true
    )
}

import Foundation

enum AudioOutputPolicy: String, CaseIterable, Identifiable {
    case automatic = "Automatic"
    case speaker = "Speaker"
    case system = "System"

    var id: String { rawValue }
}

struct VesselConfig: Equatable {
    var nexusURL: URL
    var token: String
    var allowInsecureTLS: Bool
    var audioOutputPolicy: AudioOutputPolicy

    static let `default` = VesselConfig(
        nexusURL: URL(string: "wss://nexus.tail41686e.ts.net:7888/connect")!,
        token: "",
        allowInsecureTLS: true,
        audioOutputPolicy: .automatic
    )
}

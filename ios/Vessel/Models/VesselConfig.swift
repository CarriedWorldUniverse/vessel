import Foundation

enum AudioOutputPolicy: String, CaseIterable, Identifiable {
    case automatic = "Automatic"
    case speaker = "Speaker"
    case system = "System"

    var id: String { rawValue }
}

enum TTSProvider: String, CaseIterable, Identifiable {
    case automatic = "Automatic"
    case vessel = "Vessel TTS"
    case apple = "Apple"

    var id: String { rawValue }
}

struct VesselConfig: Equatable {
    var nexusURL: URL
    var token: String
    var allowInsecureTLS: Bool
    var audioOutputPolicy: AudioOutputPolicy
    var ttsProvider: TTSProvider
    var ttsBaseURL: URL
    var ttsModel: String
    var speechRewriteEnabled: Bool
    var speechRewriteBaseURL: URL
    var speechRewriteModel: String

    static let `default` = VesselConfig(
        nexusURL: URL(string: "wss://nexus.tail41686e.ts.net:7888/connect")!,
        token: "",
        allowInsecureTLS: true,
        audioOutputPolicy: .automatic,
        ttsProvider: .automatic,
        ttsBaseURL: URL(string: "http://dmonextreme.tail41686e.ts.net:30435/v1")!,
        ttsModel: "openbmb/VoxCPM2",
        speechRewriteEnabled: true,
        speechRewriteBaseURL: URL(string: "http://dmonextreme.tail41686e.ts.net:30434/v1")!,
        speechRewriteModel: "hf.co/google/gemma-4-12B-it-qat-q4_0-gguf:latest"
    )
}

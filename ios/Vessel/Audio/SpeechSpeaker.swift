import AVFoundation

final class SpeechSpeaker: NSObject, AVSpeechSynthesizerDelegate {
    private struct VoiceProfile {
        let gender: AVSpeechSynthesisVoiceGender
        let languages: [String]
        let rate: Float
        let pitch: Float
        let preferredNames: [String]
    }

    private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(_ text: String, aspectId: String, audioOutputPolicy: AudioOutputPolicy) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        synthesizer.stopSpeaking(at: .immediate)
        configureAudioSession(audioOutputPolicy)

        let utterance = AVSpeechUtterance(string: trimmed)
        let profile = Self.profile(for: aspectId)
        utterance.voice = Self.voice(for: profile)
        utterance.rate = profile.rate
        utterance.pitchMultiplier = profile.pitch
        utterance.volume = 1.0
        synthesizer.speak(utterance)
    }

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
    }

    private func configureAudioSession(_ policy: AudioOutputPolicy) {
        #if os(iOS)
        do {
            let session = AVAudioSession.sharedInstance()
            if shouldForceSpeaker(policy, session: session) {
                try session.setCategory(
                    .playAndRecord,
                    mode: .spokenAudio,
                    options: [.defaultToSpeaker, .allowBluetoothHFP, .allowBluetoothA2DP]
                )
                try session.overrideOutputAudioPort(.speaker)
            } else {
                try session.setCategory(
                    .playback,
                    mode: .spokenAudio,
                    options: [.allowBluetoothA2DP]
                )
                try session.overrideOutputAudioPort(.none)
            }
            try session.setActive(true)
        } catch {
            // Speech can still continue with the system default audio route.
        }
        #endif
    }

    #if os(iOS)
    private func shouldForceSpeaker(_ policy: AudioOutputPolicy, session: AVAudioSession) -> Bool {
        switch policy {
        case .speaker:
            return true
        case .system:
            return false
        case .automatic:
            return !hasExternalAudioOutput(session)
        }
    }

    private func hasExternalAudioOutput(_ session: AVAudioSession) -> Bool {
        session.currentRoute.outputs.contains(where: { output in
            switch output.portType {
            case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE,
                 .headphones, .usbAudio, .carAudio, .airPlay:
                return true
            default:
                return false
            }
        })
    }
    #endif

    private static func profile(for aspectId: String) -> VoiceProfile {
        switch aspectId.lowercased() {
        case "shadow":
            return VoiceProfile(
                gender: .female,
                languages: ["en-NZ", "en-AU", "en-GB", "en-US"],
                rate: 0.47,
                pitch: 1.04,
                preferredNames: ["Siri", "Moira", "Samantha", "Karen"]
            )
        case "keel":
            return VoiceProfile(
                gender: .female,
                languages: ["en-NZ", "en-AU", "en-GB", "en-US"],
                rate: 0.46,
                pitch: 1.0,
                preferredNames: ["Siri", "Moira", "Karen", "Samantha"]
            )
        case "anvil":
            return VoiceProfile(
                gender: .male,
                languages: ["en-AU", "en-GB", "en-US", "en-NZ"],
                rate: 0.44,
                pitch: 0.92,
                preferredNames: ["Siri", "Daniel", "Oliver", "Alex"]
            )
        case "plumb":
            return VoiceProfile(
                gender: .male,
                languages: ["en-GB", "en-AU", "en-US", "en-NZ"],
                rate: 0.49,
                pitch: 1.02,
                preferredNames: ["Siri", "Oliver", "Daniel", "Alex"]
            )
        default:
            return VoiceProfile(
                gender: .unspecified,
                languages: ["en-NZ", "en-AU", "en-GB", "en-US", "en-IE", "en-ZA"],
                rate: 0.47,
                pitch: 1.0,
                preferredNames: ["Siri"]
            )
        }
    }

    private static func voice(for profile: VoiceProfile) -> AVSpeechSynthesisVoice? {
        return AVSpeechSynthesisVoice.speechVoices()
            .filter { voice in
                profile.languages.contains(voice.language)
            }
            .sorted { left, right in
                score(left, profile: profile) > score(right, profile: profile)
            }
            .first
            ?? AVSpeechSynthesisVoice(language: "en-NZ")
            ?? AVSpeechSynthesisVoice(language: "en-AU")
            ?? AVSpeechSynthesisVoice(language: "en-GB")
            ?? AVSpeechSynthesisVoice(language: "en-US")
    }

    private static func score(
        _ voice: AVSpeechSynthesisVoice,
        profile: VoiceProfile
    ) -> Int {
        var value = voice.quality.rawValue * 100
        if voice.gender == profile.gender {
            value += 40
        }
        if let languageIndex = profile.languages.firstIndex(of: voice.language) {
            value += (profile.languages.count - languageIndex) * 10
        }
        if let nameIndex = profile.preferredNames.firstIndex(where: { name in
            voice.name.localizedCaseInsensitiveContains(name)
        }) {
            value += (profile.preferredNames.count - nameIndex) * 15
        }
        return value
    }
}

import AVFoundation

final class SpeechSpeaker: NSObject, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(_ text: String, aspectId: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        synthesizer.stopSpeaking(at: .immediate)

        let utterance = AVSpeechUtterance(string: trimmed)
        utterance.voice = Self.voice(for: aspectId)
        utterance.rate = Self.rate(for: aspectId)
        utterance.pitchMultiplier = Self.pitch(for: aspectId)
        utterance.volume = 1.0
        synthesizer.speak(utterance)
    }

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
    }

    private static func voice(for aspectId: String) -> AVSpeechSynthesisVoice? {
        let lowered = aspectId.lowercased()
        let preferredGender: AVSpeechSynthesisVoiceGender = lowered == "shadow" ? .female : .male
        let preferredLanguages = ["en-NZ", "en-AU", "en-GB", "en-US", "en-IE", "en-ZA"]

        return AVSpeechSynthesisVoice.speechVoices()
            .filter { voice in
                preferredLanguages.contains(voice.language)
            }
            .sorted { left, right in
                score(left, preferredGender: preferredGender, preferredLanguages: preferredLanguages)
                    > score(right, preferredGender: preferredGender, preferredLanguages: preferredLanguages)
            }
            .first
            ?? AVSpeechSynthesisVoice(language: "en-NZ")
            ?? AVSpeechSynthesisVoice(language: "en-AU")
            ?? AVSpeechSynthesisVoice(language: "en-GB")
            ?? AVSpeechSynthesisVoice(language: "en-US")
    }

    private static func score(
        _ voice: AVSpeechSynthesisVoice,
        preferredGender: AVSpeechSynthesisVoiceGender,
        preferredLanguages: [String]
    ) -> Int {
        var value = voice.quality.rawValue * 100
        if voice.gender == preferredGender {
            value += 40
        }
        if let languageIndex = preferredLanguages.firstIndex(of: voice.language) {
            value += (preferredLanguages.count - languageIndex) * 10
        }
        if voice.name.localizedCaseInsensitiveContains("siri") {
            value += 20
        }
        return value
    }

    private static func rate(for aspectId: String) -> Float {
        switch aspectId.lowercased() {
        case "anvil":
            return 0.45
        case "plumb":
            return 0.49
        default:
            return 0.47
        }
    }

    private static func pitch(for aspectId: String) -> Float {
        switch aspectId.lowercased() {
        case "anvil":
            return 0.92
        case "plumb":
            return 1.02
        default:
            return 1.04
        }
    }
}

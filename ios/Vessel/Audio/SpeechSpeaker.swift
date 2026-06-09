import AVFoundation
import Foundation

final class SpeechSpeaker: NSObject, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {
    private struct VoiceProfile {
        let gender: AVSpeechSynthesisVoiceGender
        let languages: [String]
        let rate: Float
        let pitch: Float
        let preferredNames: [String]
        let prompt: String
    }

    private let synthesizer = AVSpeechSynthesizer()
    private var audioPlayer: AVAudioPlayer?
    private var remoteTask: Task<Void, Never>?

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(_ text: String, aspectId: String, config: VesselConfig) {
        let trimmed = Self.shapeForSpeech(text)
        guard !trimmed.isEmpty else { return }
        stop()

        guard config.ttsProvider != .apple else {
            configureAppleAudioSession(config.audioOutputPolicy)
            speakApple(trimmed, aspectId: aspectId)
            return
        }

        configureRemoteAudioSession(config.audioOutputPolicy)
        remoteTask = Task { [weak self] in
            guard let self else { return }
            do {
                let spokenText = await Self.rewriteForSpeechIfNeeded(trimmed, aspectId: aspectId, config: config)
                let data = try await Self.remoteSpeechAudio(text: spokenText, aspectId: aspectId, config: config)
                try self.playRemoteAudio(data)
            } catch {
                guard !Task.isCancelled else { return }
                self.configureAppleAudioSession(config.audioOutputPolicy)
                self.speakApple(trimmed, aspectId: aspectId)
            }
        }
    }

    func stop() {
        remoteTask?.cancel()
        remoteTask = nil
        audioPlayer?.stop()
        audioPlayer = nil
        synthesizer.stopSpeaking(at: .immediate)
    }

    private func speakApple(_ text: String, aspectId: String) {
        let utterance = AVSpeechUtterance(string: text)
        let profile = Self.profile(for: aspectId)
        utterance.voice = Self.voice(for: profile)
        utterance.rate = profile.rate
        utterance.pitchMultiplier = profile.pitch
        utterance.volume = 1.0
        synthesizer.speak(utterance)
    }

    private func playRemoteAudio(_ data: Data) throws {
        let player = try AVAudioPlayer(data: data)
        player.delegate = self
        player.pan = 0
        player.volume = 1
        player.prepareToPlay()
        audioPlayer = player
        player.play()
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        if audioPlayer === player {
            audioPlayer = nil
        }
    }

    private func configureRemoteAudioSession(_ policy: AudioOutputPolicy) {
        #if os(iOS)
        do {
            let session = AVAudioSession.sharedInstance()
            if policy == .speaker {
                try session.setCategory(
                    .playAndRecord,
                    mode: .default,
                    options: [.defaultToSpeaker, .allowBluetoothHFP, .allowBluetoothA2DP]
                )
                try session.overrideOutputAudioPort(.speaker)
            } else {
                try session.setCategory(
                    .playback,
                    mode: .default,
                    options: [.allowBluetoothA2DP]
                )
                try session.overrideOutputAudioPort(.none)
            }
            try session.setActive(true)
        } catch {
            // Remote TTS can still continue with the system default audio route.
        }
        #endif
    }

    private func configureAppleAudioSession(_ policy: AudioOutputPolicy) {
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
                preferredNames: ["Siri", "Moira", "Samantha", "Karen"],
                prompt: "composed female orchestrator, warm but precise, measured pace, clear New Zealand English, conversational flow"
            )
        case "keel":
            return VoiceProfile(
                gender: .female,
                languages: ["en-NZ", "en-AU", "en-GB", "en-US"],
                rate: 0.46,
                pitch: 1.0,
                preferredNames: ["Siri", "Moira", "Karen", "Samantha"],
                prompt: "clear female operational voice, calm and natural, smooth phrasing, light New Zealand English"
            )
        case "anvil":
            return VoiceProfile(
                gender: .male,
                languages: ["en-AU", "en-GB", "en-US", "en-NZ"],
                rate: 0.44,
                pitch: 0.92,
                preferredNames: ["Siri", "Daniel", "Oliver", "Alex"],
                prompt: "grounded male builder, low confident voice, practical cadence, concise delivery"
            )
        case "plumb":
            return VoiceProfile(
                gender: .male,
                languages: ["en-GB", "en-AU", "en-US", "en-NZ"],
                rate: 0.49,
                pitch: 1.02,
                preferredNames: ["Siri", "Oliver", "Daniel", "Alex"],
                prompt: "friendly male builder, lighter voice than Anvil, quick collaborative cadence"
            )
        default:
            return VoiceProfile(
                gender: .unspecified,
                languages: ["en-NZ", "en-AU", "en-GB", "en-US", "en-IE", "en-ZA"],
                rate: 0.47,
                pitch: 1.0,
                preferredNames: ["Siri"],
                prompt: "neutral clear assistant voice, natural conversational delivery, smooth phrasing"
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

    private static func remoteSpeechAudio(text: String, aspectId: String, config: VesselConfig) async throws -> Data {
        let profile = profile(for: aspectId)
        let input = "(\(profile.prompt), avoid robotic word-by-word delivery, use natural pauses)\(sanitizeForTTSMarkup(text))"
        var url = config.ttsBaseURL
        if url.path.hasSuffix("/") {
            url.deleteLastPathComponent()
        }
        url.appendPathComponent("audio")
        url.appendPathComponent("speech")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": config.ttsModel.isEmpty ? "openbmb/VoxCPM2" : config.ttsModel,
            "input": input,
            "voice": aspectId,
            "response_format": "wav"
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw SpeechSpeakerError.remoteTTSFailed
        }
        return data
    }

    private static func rewriteForSpeechIfNeeded(_ text: String, aspectId: String, config: VesselConfig) async -> String {
        guard config.speechRewriteEnabled else { return text }

        do {
            let rewritten = try await remoteSpeechRewrite(text: text, aspectId: aspectId, config: config)
            let clean = shapeForSpeech(rewritten)
            return clean.isEmpty ? text : clean
        } catch {
            return text
        }
    }

    private static func remoteSpeechRewrite(text: String, aspectId: String, config: VesselConfig) async throws -> String {
        var url = config.speechRewriteBaseURL
        if url.path.hasSuffix("/") {
            url.deleteLastPathComponent()
        }
        url.appendPathComponent("chat")
        url.appendPathComponent("completions")

        let prompt = [
            "Convert this assistant response into natural spoken language for text-to-speech.",
            "Keep the meaning, but remove markdown, code formatting, quotes, URLs, bullets, labels, and technical scaffolding.",
            "Speak like a concise human operator. Use complete sentences and natural transitions.",
            "Do not mention that you rewrote or summarized it.",
            "Keep it under 70 words unless the content truly needs more.",
            "Target speaker: \(aspectId).",
            "",
            text
        ].joined(separator: "\n")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 8
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": config.speechRewriteModel.isEmpty
                ? "hf.co/google/gemma-4-12B-it-qat-q4_0-gguf:latest"
                : config.speechRewriteModel,
            "messages": [
                [
                    "role": "system",
                    "content": "You prepare assistant responses for natural speech. Do not reason out loud. Return only the spoken text. No markdown. No quotation marks."
                ],
                [
                    "role": "user",
                    "content": prompt
                ]
            ],
            "temperature": 0.2,
            "max_tokens": 320
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw SpeechSpeakerError.remoteRewriteFailed
        }
        guard
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let choices = json["choices"] as? [[String: Any]],
            let first = choices.first,
            let message = first["message"] as? [String: Any],
            let content = message["content"] as? String
        else {
            throw SpeechSpeakerError.remoteRewriteFailed
        }
        let clean = sanitizeForTTSMarkup(content)
        guard !clean.isEmpty else {
            throw SpeechSpeakerError.remoteRewriteFailed
        }
        return clean
    }

    private static func shapeForSpeech(_ text: String) -> String {
        var clean = text
            .replacingOccurrences(of: #"```[\s\S]*?```"#, with: "I have included code in the details panel.", options: .regularExpression)
            .replacingOccurrences(of: #"`([^`]+)`"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"[`"“”]"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"['‘’]"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"https?://\S+"#, with: "link", options: .regularExpression)
            .replacingOccurrences(of: #"(?m)^\s*[-*]\s+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"(?m)^\s*\d+\.\s+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        clean = clean.replacingOccurrences(of: " - ", with: ". ")
        clean = clean.replacingOccurrences(of: " -- ", with: ". ")
        clean = clean.replacingOccurrences(of: "•", with: ". ")
        clean = clean.replacingOccurrences(of: ":", with: ". ")

        let maxCharacters = 900
        if clean.count > maxCharacters {
            let index = clean.index(clean.startIndex, offsetBy: maxCharacters)
            clean = String(clean[..<index])
            if let sentenceEnd = clean.lastIndex(where: { ".!?".contains($0) }) {
                clean = String(clean[...sentenceEnd])
            }
            clean += " More detail is in the response panel."
        }

        return clean
    }

    private static func sanitizeForTTSMarkup(_ text: String) -> String {
        text
            .replacingOccurrences(of: #"[()]"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"[`"“”]"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"['‘’]"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

enum SpeechSpeakerError: Error {
    case remoteTTSFailed
    case remoteRewriteFailed
}

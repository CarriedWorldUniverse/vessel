import AVFoundation
import Speech

final class SpeechRecognizer {
    private let recognizer = SFSpeechRecognizer()
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    func start(
        onPartial: @escaping (String, Float) -> Void,
        onFinal: @escaping (String) -> Void,
        onError: @escaping (Error) -> Void
    ) {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            guard status == .authorized else {
                onError(SpeechRecognizerError.notAuthorized)
                return
            }
            self?.startAuthorized(onPartial: onPartial, onFinal: onFinal, onError: onError)
        }
    }

    func stop() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
    }

    private func startAuthorized(
        onPartial: @escaping (String, Float) -> Void,
        onFinal: @escaping (String) -> Void,
        onError: @escaping (Error) -> Void
    ) {
        stop()

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        self.request = request

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)

        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
            onPartial("", Self.level(from: buffer))
        }

        task = recognizer?.recognitionTask(with: request) { result, error in
            if let result {
                let text = result.bestTranscription.formattedString
                if result.isFinal {
                    onFinal(text)
                } else {
                    onPartial(text, 0)
                }
            }
            if let error {
                onError(error)
            }
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            onError(error)
        }
    }

    private static func level(from buffer: AVAudioPCMBuffer) -> Float {
        guard let channel = buffer.floatChannelData?[0] else { return 0 }
        let frames = Int(buffer.frameLength)
        guard frames > 0 else { return 0 }

        var sum: Float = 0
        for i in 0..<frames {
            sum += abs(channel[i])
        }
        return min(sum / Float(frames) * 12, 1)
    }
}

enum SpeechRecognizerError: Error {
    case notAuthorized
}

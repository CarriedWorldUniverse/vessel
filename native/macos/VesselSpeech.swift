import Foundation
import Speech

struct Output: Encodable {
    let ok: Bool
    let text: String?
    let error: String?
}

func emit(_ output: Output) {
    let encoder = JSONEncoder()
    if let data = try? encoder.encode(output), let line = String(data: data, encoding: .utf8) {
        print(line)
    } else {
        print("{\"ok\":false,\"error\":\"failed to encode result\"}")
    }
    fflush(stdout)
}

guard CommandLine.arguments.count >= 2 else {
    emit(Output(ok: false, text: nil, error: "usage: VesselSpeech <wav-path>"))
    exit(2)
}

let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)
guard FileManager.default.fileExists(atPath: url.path) else {
    emit(Output(ok: false, text: nil, error: "audio file not found"))
    exit(2)
}

var authStatus = SFSpeechRecognizerAuthorizationStatus.notDetermined
var authDone = false
SFSpeechRecognizer.requestAuthorization { status in
    authStatus = status
    authDone = true
}
let authDeadline = Date().addingTimeInterval(10)
while !authDone && Date() < authDeadline {
    RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
}

guard authStatus == .authorized else {
    emit(Output(ok: false, text: nil, error: "speech recognition permission not granted"))
    exit(1)
}

guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en_US")) else {
    emit(Output(ok: false, text: nil, error: "speech recognizer unavailable"))
    exit(1)
}

guard recognizer.isAvailable else {
    emit(Output(ok: false, text: nil, error: "speech recognizer is not available"))
    exit(1)
}

let request = SFSpeechURLRecognitionRequest(url: url)
request.shouldReportPartialResults = false
request.requiresOnDeviceRecognition = false

var finalText = ""
var finalError: String?
var done = false

let task = recognizer.recognitionTask(with: request) { result, error in
    if let result = result {
        finalText = result.bestTranscription.formattedString
        if result.isFinal {
            done = true
        }
    }
    if let error = error {
        finalError = error.localizedDescription
        done = true
    }
}

let deadline = Date().addingTimeInterval(45)
while !done && Date() < deadline {
    RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
}
task.cancel()

if !done {
    emit(Output(ok: false, text: nil, error: "speech recognition timed out"))
    exit(1)
}

if let finalError = finalError, finalText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
    emit(Output(ok: false, text: nil, error: finalError))
    exit(1)
}

emit(Output(ok: true, text: finalText, error: nil))

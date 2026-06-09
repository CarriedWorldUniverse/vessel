import Foundation
import SwiftUI

@MainActor
final class VesselStore: ObservableObject {
    enum ConnectionState: Equatable {
        case disconnected
        case connecting
        case connected
        case failed(String)
    }

    enum InputMode: String, CaseIterable, Identifiable {
        case conversation = "Conversation"
        case dictation = "Dictation"

        var id: String { rawValue }
    }

    @Published var config = VesselConfig.default
    @Published var connectionState: ConnectionState = .disconnected
    @Published var aspects: [Aspect] = []
    @Published var activeAspectId: String?
    @Published var inputMode: InputMode = .conversation
    @Published var transcript = ""
    @Published var partialTranscript = ""
    @Published var audioLevel: Float = 0
    @Published var isListening = false
    @Published var inbox: [ResponseItem] = []
    @Published var activeResponse: ResponseItem?

    private let targetResolver = TargetResolver()
    private let speaker = SpeechSpeaker()
    private lazy var speechRecognizer = SpeechRecognizer()
    private lazy var nexus = NexusClient()
    private var didAutoConnect = false

    func bootstrap() async {
        loadPreviewRosterIfEmpty()
        guard !didAutoConnect else { return }
        didAutoConnect = true
        await connect()
    }

    func handleScenePhase(_ phase: ScenePhase) async {
        switch phase {
        case .active:
            UIApplication.shared.isIdleTimerDisabled = true
            await reconnectAfterFocus()
        case .inactive:
            if isListening {
                stopListening()
            }
        case .background:
            UIApplication.shared.isIdleTimerDisabled = false
            if isListening {
                stopListening()
            }
        @unknown default:
            break
        }
    }

    func connect() async {
        guard connectionState != .connecting else { return }
        connectionState = .connecting
        do {
            try await nexus.connect(config: config) { [weak self] event in
                Task { @MainActor in
                    self?.handleNexusEvent(event)
                }
            }
            connectionState = .connected
        } catch {
            connectionState = .failed(error.localizedDescription)
        }
    }

    func disconnect() {
        nexus.disconnect()
        connectionState = .disconnected
    }

    func updateConfig(nexusURLString: String, token: String, allowInsecureTLS: Bool) -> Bool {
        guard let url = URL(string: nexusURLString.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            return false
        }
        config = VesselConfig(
            nexusURL: url,
            token: token.trimmingCharacters(in: .whitespacesAndNewlines),
            allowInsecureTLS: allowInsecureTLS
        )
        return true
    }

    func toggleMute(_ aspect: Aspect) {
        guard let index = aspects.firstIndex(where: { $0.id == aspect.id }) else {
            return
        }
        aspects[index].isMuted.toggle()
    }

    func focus(_ aspect: Aspect) {
        activeAspectId = aspect.id
    }

    func startListening() {
        guard !isListening else { return }
        transcript = ""
        partialTranscript = ""
        isListening = true

        speechRecognizer.start(
            onPartial: { [weak self] text, level in
                Task { @MainActor in
                    self?.audioLevel = level
                    if !text.isEmpty {
                        self?.partialTranscript = text
                    }
                }
            },
            onFinal: { [weak self] text in
                Task { @MainActor in
                    self?.finishSpeech(text)
                }
            },
            onError: { [weak self] error in
                Task { @MainActor in
                    self?.isListening = false
                    self?.partialTranscript = error.localizedDescription
                }
            }
        )
    }

    func stopListening() {
        speechRecognizer.stop()
        isListening = false
        if !partialTranscript.isEmpty {
            finishSpeech(partialTranscript)
        }
    }

    func sendTypedInput() {
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        Task {
            await send(text, inputMode: "text")
        }
    }

    private func finishSpeech(_ text: String) {
        isListening = false
        partialTranscript = ""
        transcript = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard inputMode == .conversation else { return }
        Task {
            await send(transcript, inputMode: "voice")
        }
    }

    private func send(_ rawText: String, inputMode: String) async {
        let roster = aspects.filter(\.isOnline)
        let resolved = targetResolver.resolve(rawText, roster: roster, currentTarget: activeAspectId)
        transcript = resolved.cleanText
        activeAspectId = resolved.targetAspectId

        do {
            try await nexus.sendUserMessage(
                text: resolved.cleanText,
                targetAspectId: resolved.targetAspectId,
                inputMode: inputMode
            )
            transcript = ""
        } catch {
            activeResponse = ResponseItem(
                id: UUID().uuidString,
                aspectId: "vessel",
                title: "Send failed",
                speech: "Send failed.",
                detail: error.localizedDescription,
                receivedAt: Date(),
                spoken: true
            )
        }
    }

    private func reconnectAfterFocus() async {
        guard didAutoConnect else { return }
        await connect()
    }

    private func handleNexusEvent(_ event: NexusEvent) {
        switch event {
        case .roster(let roster):
            aspects = roster
            if activeAspectId == nil {
                activeAspectId = roster.first(where: { $0.id == "shadow" })?.id ?? roster.first?.id
            }
        case .message(let item):
            enqueue(item)
        case .connected:
            connectionState = .connected
        case .disconnected(let reason):
            connectionState = reason.isEmpty ? .disconnected : .failed(reason)
        }
    }

    private func enqueue(_ item: ResponseItem) {
        inbox.append(item)
        guard !isListening else { return }
        guard activeResponse == nil || activeResponse?.spoken == true else { return }
        playNextIfPossible()
    }

    private func playNextIfPossible() {
        guard let nextIndex = inbox.firstIndex(where: { item in
            let aspect = aspects.first(where: { $0.id == item.aspectId })
            return !(aspect?.isMuted ?? false)
        }) else {
            return
        }

        var next = inbox.remove(at: nextIndex)
        next.spoken = true
        activeResponse = next
        speaker.speak(next.speech, aspectId: next.aspectId)
    }

    private func loadPreviewRosterIfEmpty() {
        guard aspects.isEmpty else { return }
        aspects = [
            Aspect(id: "shadow", name: "Shadow", colorHex: "#6d5dfc", isOnline: true, isMuted: false),
            Aspect(id: "anvil", name: "Anvil", colorHex: "#f59e0b", isOnline: true, isMuted: false),
            Aspect(id: "plumb", name: "Plumb", colorHex: "#14b8a6", isOnline: true, isMuted: false),
            Aspect(id: "keel", name: "Keel", colorHex: "#38bdf8", isOnline: true, isMuted: false)
        ]
        activeAspectId = "shadow"
    }
}

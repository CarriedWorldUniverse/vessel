import Foundation

enum NexusEvent {
    case connected
    case disconnected(String)
    case roster([Aspect])
    case message(ResponseItem)
}

final class NexusClient {
    private var task: URLSessionWebSocketTask?
    private var eventHandler: ((NexusEvent) -> Void)?

    func connect(config: VesselConfig, onEvent: @escaping (NexusEvent) -> Void) async throws {
        eventHandler = onEvent

        var request = URLRequest(url: config.nexusURL)
        if !config.token.isEmpty {
            request.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
        }

        let session = URLSession(configuration: .default)
        let task = session.webSocketTask(with: request)
        self.task = task
        task.resume()
        onEvent(.connected)
        receiveLoop()
    }

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        eventHandler?(.disconnected(""))
    }

    func sendUserMessage(text: String, targetAspectId: String?, inputMode: String) async throws {
        guard let task else {
            throw NexusClientError.notConnected
        }
        let payload: [String: Any] = [
            "text": text,
            "to": targetAspectId ?? NSNull(),
            "input_mode": inputMode
        ]
        let envelope: [String: Any] = [
            "kind": targetAspectId == nil ? "chat.send" : "aspect.say",
            "payload": payload
        ]
        let data = try JSONSerialization.data(withJSONObject: envelope, options: [])
        guard let raw = String(data: data, encoding: .utf8) else {
            throw NexusClientError.invalidMessage
        }
        try await task.send(.string(raw))
    }

    private func receiveLoop() {
        task?.receive { [weak self] result in
            guard let self else { return }

            switch result {
            case .success(let message):
                self.handle(message)
                self.receiveLoop()
            case .failure(let error):
                self.eventHandler?(.disconnected(error.localizedDescription))
            }
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .string(let raw):
            handleString(raw)
        case .data(let data):
            if let raw = String(data: data, encoding: .utf8) {
                handleString(raw)
            }
        @unknown default:
            break
        }
    }

    private func handleString(_ raw: String) {
        guard
            let data = raw.data(using: .utf8),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return
        }

        let kind = json["kind"] as? String ?? json["type"] as? String ?? ""
        let payload = json["payload"] as? [String: Any] ?? json

        if kind.contains("roster") || kind.contains("presence") {
            eventHandler?(.roster(parseRoster(payload)))
            return
        }

        if kind.contains("chat") || kind.contains("message") || kind.contains("deliver") {
            if let item = parseMessage(payload) {
                eventHandler?(.message(item))
            }
        }
    }

    private func parseRoster(_ payload: [String: Any]) -> [Aspect] {
        let rawAspects = payload["aspects"] as? [[String: Any]]
            ?? payload["members"] as? [[String: Any]]
            ?? []

        return rawAspects.compactMap { raw in
            let id = raw["id"] as? String
                ?? raw["aspect_id"] as? String
                ?? raw["name"] as? String
            guard let id, !isServiceAspect(id) else { return nil }
            return Aspect(
                id: id,
                name: raw["name"] as? String ?? id.capitalized,
                colorHex: raw["color"] as? String,
                isOnline: raw["online"] as? Bool ?? true,
                isMuted: false
            )
        }
    }

    private func parseMessage(_ payload: [String: Any]) -> ResponseItem? {
        let aspectId = payload["from"] as? String
            ?? payload["aspect_id"] as? String
            ?? payload["sender"] as? String
            ?? "unknown"

        guard !isServiceAspect(aspectId) else { return nil }

        let detail = payload["text"] as? String
            ?? payload["body"] as? String
            ?? payload["content"] as? String
            ?? ""
        let speech = payload["speech"] as? String
            ?? payload["speech_text"] as? String
            ?? detail

        guard !detail.isEmpty || !speech.isEmpty else { return nil }

        return ResponseItem(
            id: payload["id"] as? String ?? UUID().uuidString,
            aspectId: aspectId,
            title: aspectId.capitalized,
            speech: speech,
            detail: detail.isEmpty ? speech : detail,
            receivedAt: Date(),
            spoken: false
        )
    }

    private func isServiceAspect(_ id: String) -> Bool {
        let lowered = id.lowercased()
        return lowered.contains("dispatch")
            || lowered.contains("controller")
            || lowered.contains("observer")
            || lowered.contains("operator")
    }
}

enum NexusClientError: Error {
    case notConnected
    case invalidMessage
}

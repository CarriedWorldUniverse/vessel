import Foundation

enum NexusEvent {
    case connected
    case disconnected(String)
    case roster([Aspect])
    case message(ResponseItem)
}

final class NexusClient: NSObject, URLSessionDelegate {
    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private var eventHandler: ((NexusEvent) -> Void)?
    private var config: VesselConfig?
    private var manualDisconnect = false
    private var reconnectAttempt = 0
    private var heartbeatTask: Task<Void, Never>?

    func connect(config: VesselConfig, onEvent: @escaping (NexusEvent) -> Void) async throws {
        disconnect(notify: false)
        self.config = config
        eventHandler = onEvent
        manualDisconnect = false

        var request = URLRequest(url: websocketURL(config))
        request.timeoutInterval = 15
        if !config.token.isEmpty {
            request.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
        }

        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        self.session = session
        let task = session.webSocketTask(with: request)
        self.task = task
        task.resume()
        onEvent(.connected)
        reconnectAttempt = 0
        startHeartbeat()
        try await sendFrame(kind: "roster.list", payload: [:])
        try await sendFrame(kind: "subscribe.chat", payload: [:])
        try await sendFrame(kind: "subscribe.roster", payload: [:])
        receiveLoop()
    }

    func disconnect() {
        disconnect(notify: true)
    }

    private func disconnect(notify: Bool) {
        manualDisconnect = true
        heartbeatTask?.cancel()
        heartbeatTask = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        session?.invalidateAndCancel()
        session = nil
        if notify {
            eventHandler?(.disconnected(""))
        }
    }

    func sendUserMessage(text: String, targetAspectId: String?, inputMode: String) async throws {
        guard let task else {
            throw NexusClientError.notConnected
        }
        if let targetAspectId {
            try await sendFrame(
                kind: "aspect.say",
                payload: [
                    "aspect": targetAspectId,
                    "content": text,
                    "input_mode": inputMode
                ],
                task: task
            )
        } else {
            try await sendFrame(
                kind: "chat.send",
                payload: [
                    "from": "operator",
                    "content": text,
                    "input_mode": inputMode
                ],
                task: task
            )
        }
    }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard config?.allowInsecureTLS == true,
              challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust
        else {
            completionHandler(.performDefaultHandling, nil)
            return
        }

        completionHandler(.useCredential, URLCredential(trust: trust))
    }

    private func websocketURL(_ config: VesselConfig) -> URL {
        var components = URLComponents(url: config.nexusURL, resolvingAgainstBaseURL: false)
        if components?.path.isEmpty == true || components?.path == "/" {
            components?.path = "/connect"
        }
        if !config.token.isEmpty {
            var items = components?.queryItems ?? []
            items.removeAll { $0.name == "token" }
            items.append(URLQueryItem(name: "token", value: config.token))
            components?.queryItems = items
        }
        return components?.url ?? config.nexusURL
    }

    private func sendFrame(kind: String, payload: [String: Any], task explicitTask: URLSessionWebSocketTask? = nil) async throws {
        guard let task = explicitTask ?? task else {
            throw NexusClientError.notConnected
        }
        let envelope: [String: Any] = [
            "kind": kind,
            "id": UUID().uuidString,
            "ts": ISO8601DateFormatter().string(from: Date()),
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
                self.handleDisconnect(error.localizedDescription)
            }
        }
    }

    private func startHeartbeat() {
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                guard let self, !Task.isCancelled else { return }
                self.task?.sendPing { error in
                    if let error {
                        self.handleDisconnect(error.localizedDescription)
                    }
                }
            }
        }
    }

    private func handleDisconnect(_ reason: String) {
        task = nil
        heartbeatTask?.cancel()
        heartbeatTask = nil
        eventHandler?(.disconnected(reason))
        guard !manualDisconnect, let config, let eventHandler else { return }

        reconnectAttempt += 1
        let delay = min(pow(2.0, Double(reconnectAttempt - 1)), 30.0)
        Task {
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !manualDisconnect else { return }
            do {
                try await connect(config: config, onEvent: eventHandler)
            } catch {
                handleDisconnect(error.localizedDescription)
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

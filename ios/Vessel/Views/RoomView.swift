import SwiftUI

struct RoomView: View {
    @EnvironmentObject private var store: VesselStore
    @State private var isShowingSettings = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HeaderView()
                    .padding(.horizontal, 16)
                    .padding(.top, 12)

                ResponsePanel()
                    .padding(16)

                InputDock()
                    .padding(16)
                    .background(.regularMaterial)
            }
            .background(Color(.systemBackground))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        isShowingSettings = true
                    } label: {
                        Image(systemName: "slider.horizontal.3")
                    }
                    .accessibilityLabel("Settings")
                }
            }
            .sheet(isPresented: $isShowingSettings) {
                SettingsPanel()
                    .environmentObject(store)
            }
        }
    }
}

private struct HeaderView: View {
    @EnvironmentObject private var store: VesselStore

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Vessel")
                    .font(.headline)
                Text(statusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if let active = activeAspect {
                Label(active.displayName, systemImage: "person.wave.2")
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.accentColor.opacity(0.12), in: Capsule())
            }
        }
    }

    private var activeAspect: Aspect? {
        store.aspects.first(where: { $0.id == store.activeAspectId })
    }

    private var statusText: String {
        switch store.connectionState {
        case .disconnected:
            return "Disconnected"
        case .connecting:
            return "Connecting"
        case .connected:
            return "Connected to Nexus"
        case .failed(let reason):
            return reason
        }
    }
}

private struct ResponsePanel: View {
    @EnvironmentObject private var store: VesselStore

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(store.activeResponse?.title ?? "Inbox")
                    .font(.title3.weight(.semibold))
                Spacer()
                Text("\(store.inbox.count)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color(.secondarySystemBackground), in: Capsule())
            }

            ScrollView {
                Text(store.activeResponse?.detail ?? "Responses will appear here.")
                    .font(.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .foregroundStyle(store.activeResponse == nil ? .secondary : .primary)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct AspectRoster: View {
    @EnvironmentObject private var store: VesselStore

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(store.aspects) { aspect in
                    AspectButton(aspect: aspect)
                }
            }
        }
    }
}

private struct SettingsPanel: View {
    @EnvironmentObject private var store: VesselStore
    @Environment(\.dismiss) private var dismiss
    @State private var nexusURLString = ""
    @State private var token = ""
    @State private var allowInsecureTLS = true
    @State private var audioOutputPolicy = AudioOutputPolicy.automatic
    @State private var ttsProvider = TTSProvider.automatic
    @State private var ttsBaseURLString = ""
    @State private var ttsModel = ""
    @State private var configError: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Connection") {
                    LabeledContent("Status", value: statusText)

                    TextField("Nexus URL", text: $nexusURLString)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)

                    SecureField("Token", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    Toggle("Allow self-signed TLS", isOn: $allowInsecureTLS)

                    if let configError {
                        Text(configError)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    HStack {
                        Button("Connect") {
                            saveAndConnect()
                        }
                        Spacer()
                        Button("Disconnect", role: .destructive) {
                            store.disconnect()
                        }
                    }
                }

                Section("Audio") {
                    Picker("Output", selection: $audioOutputPolicy) {
                        ForEach(AudioOutputPolicy.allCases) { policy in
                            Text(policy.rawValue).tag(policy)
                        }
                    }

                    Picker("TTS", selection: $ttsProvider) {
                        ForEach(TTSProvider.allCases) { provider in
                            Text(provider.rawValue).tag(provider)
                        }
                    }

                    TextField("TTS URL", text: $ttsBaseURLString)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)

                    TextField("TTS model", text: $ttsModel)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                Section("Aspect") {
                    if store.aspects.isEmpty {
                        Text("No aspects online.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.aspects) { aspect in
                            AspectSettingsRow(aspect: aspect)
                        }
                    }
                }
            }
            .navigationTitle("Vessel")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .onAppear {
                nexusURLString = store.config.nexusURL.absoluteString
                token = store.config.token
                allowInsecureTLS = store.config.allowInsecureTLS
                audioOutputPolicy = store.config.audioOutputPolicy
                ttsProvider = store.config.ttsProvider
                ttsBaseURLString = store.config.ttsBaseURL.absoluteString
                ttsModel = store.config.ttsModel
            }
        }
    }

    private var statusText: String {
        switch store.connectionState {
        case .disconnected:
            return "Disconnected"
        case .connecting:
            return "Connecting"
        case .connected:
            return "Connected"
        case .failed(let reason):
            return reason
        }
    }

    private func saveAndConnect() {
        guard store.updateConfig(
            nexusURLString: nexusURLString,
            token: token,
            allowInsecureTLS: allowInsecureTLS,
            audioOutputPolicy: audioOutputPolicy,
            ttsProvider: ttsProvider,
            ttsBaseURLString: ttsBaseURLString,
            ttsModel: ttsModel
        ) else {
            configError = "Enter valid Nexus and TTS URLs."
            return
        }

        configError = nil
        Task {
            await store.connect()
        }
    }
}

private struct AspectSettingsRow: View {
    @EnvironmentObject private var store: VesselStore
    let aspect: Aspect

    var body: some View {
        HStack(spacing: 12) {
            Button {
                store.focus(aspect)
            } label: {
                HStack(spacing: 10) {
                    Circle()
                        .fill(color)
                        .frame(width: 10, height: 10)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(aspect.displayName)
                        Text(aspect.isOnline ? "Online" : "Offline")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .buttonStyle(.plain)

            Spacer()

            if aspect.id == store.activeAspectId {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.tint)
            }

            Button {
                store.toggleMute(aspect)
            } label: {
                Image(systemName: aspect.isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(aspect.isMuted ? "Unmute" : "Mute")
        }
    }

    private var color: Color {
        Color(hex: aspect.colorHex) ?? .accentColor
    }
}

private struct AspectButton: View {
    @EnvironmentObject private var store: VesselStore
    let aspect: Aspect

    var body: some View {
        Button {
            store.focus(aspect)
        } label: {
            HStack(spacing: 8) {
                Circle()
                    .fill(color)
                    .frame(width: 10, height: 10)
                Text(aspect.displayName)
                    .lineLimit(1)
                Image(systemName: aspect.isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(background, in: Capsule())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button(aspect.isMuted ? "Unmute" : "Mute") {
                store.toggleMute(aspect)
            }
        }
        .onLongPressGesture {
            store.toggleMute(aspect)
        }
    }

    private var background: Color {
        aspect.id == store.activeAspectId ? Color.accentColor.opacity(0.18) : Color(.secondarySystemBackground)
    }

    private var color: Color {
        Color(hex: aspect.colorHex) ?? .accentColor
    }
}

private struct InputDock: View {
    @EnvironmentObject private var store: VesselStore

    var body: some View {
        VStack(spacing: 12) {
            Picker("Input mode", selection: $store.inputMode) {
                ForEach(VesselStore.InputMode.allCases) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            Waveform(level: store.audioLevel, isActive: store.isListening)
                .frame(height: 34)

            TextEditor(text: Binding(
                get: { store.isListening ? store.partialTranscript : store.transcript },
                set: {
                    if store.isListening {
                        store.partialTranscript = $0
                    } else {
                        store.transcript = $0
                    }
                }
            ))
            .frame(minHeight: 82, maxHeight: 120)
            .padding(8)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))

            HStack(spacing: 12) {
                Button {
                    store.isListening ? store.stopListening() : store.startListening()
                } label: {
                    Label(store.isListening ? "Stop" : "Dictate", systemImage: store.isListening ? "stop.fill" : "mic.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)

                Button {
                    store.sendTypedInput()
                } label: {
                    Label("Send", systemImage: "paperplane.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
        }
    }
}

private struct Waveform: View {
    let level: Float
    let isActive: Bool

    var body: some View {
        TimelineView(.periodic(from: .now, by: isActive ? 0.05 : 1.0)) { context in
            Canvas { canvas, size in
                let now = context.date.timeIntervalSinceReferenceDate
                let path = wavePath(size: size, phase: now)
                canvas.stroke(path, with: .color(.accentColor), lineWidth: 2)
            }
        }
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
    }

    private func wavePath(size: CGSize, phase: TimeInterval) -> Path {
        var path = Path()
        let amplitude = max(CGFloat(level), 0.08) * size.height * 0.35
        let midY = size.height / 2
        let step: CGFloat = 4
        var x: CGFloat = 0

        path.move(to: CGPoint(x: 0, y: midY))
        while x <= size.width {
            let progress = x / max(size.width, 1)
            let y = midY + sin(progress * .pi * 4 + phase * 6) * amplitude
            path.addLine(to: CGPoint(x: x, y: y))
            x += step
        }
        return path
    }
}

private extension Color {
    init?(hex: String?) {
        guard let hex else { return nil }
        let clean = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard clean.count == 6, let value = UInt64(clean, radix: 16) else { return nil }

        let red = Double((value >> 16) & 0xff) / 255
        let green = Double((value >> 8) & 0xff) / 255
        let blue = Double(value & 0xff) / 255
        self.init(red: red, green: green, blue: blue)
    }
}

#Preview {
    RoomView()
        .environmentObject(VesselStore())
}

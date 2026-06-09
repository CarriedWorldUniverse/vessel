import SwiftUI

struct RoomView: View {
    @EnvironmentObject private var store: VesselStore

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HeaderView()
                    .padding(.horizontal, 16)
                    .padding(.top, 12)

                ResponsePanel()
                    .padding(16)

                AspectRoster()
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)

                InputDock()
                    .padding(16)
                    .background(.regularMaterial)
            }
            .background(Color(.systemBackground))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task {
                            await store.connect()
                        }
                    } label: {
                        Image(systemName: "bolt.horizontal")
                    }
                    .accessibilityLabel("Connect")
                }
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

            Waveform(level: store.audioLevel)
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

    var body: some View {
        TimelineView(.animation) { context in
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

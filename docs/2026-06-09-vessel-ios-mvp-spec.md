# Vessel iOS MVP Spec

**Date:** 2026-06-09
**Status:** Draft / build seed
**Repo:** `CarriedWorldUniverse/vessel`

## One-liner

Build Vessel iOS as a native SwiftUI companion client for Nexus voice interaction: connect to the Nexus broker, target aspects naturally through speech, send spoken turns, queue incoming responses, speak concise summaries, and show detail text.

This is not an Electron/Tauri port. The iPhone app is a native client that shares the Vessel interaction model and Nexus protocol assumptions with the desktop reference build.

## Goals

- Let the operator talk to Nexus aspects from iPhone.
- Keep the MVP small enough to test on a real device quickly.
- Use Apple-native speech and audio first.
- Preserve the current Vessel flow: attention phrase -> target aspect -> send turn -> receive queued response -> speak summary / show detail.
- Keep backend choice open, but make Nexus the first reference connector.

## Non-goals for MVP

- No always-listening wake mode.
- No background agent inbox.
- No custom VoxCPM voices inside the first iOS app.
- No slime/avatar room rendering in the first build.
- No TestFlight polish until the local device path works.
- No full desktop settings surface.
- No generic OpenAI/Anthropic adapter in the first build.

## Target platform

- iOS 18+ for the first cut.
- SwiftUI app lifecycle.
- Test on operator-owned iPhone using the paid Apple Developer account.
- Bundle identifier: `universe.carriedworld.vessel` unless an existing naming convention says otherwise.

## App shape

```text
vessel/
  ios/
    Vessel.xcodeproj
    Vessel/
      App/
      Nexus/
      Speech/
      Audio/
      Models/
      Views/
      Resources/
```

The iOS target should be self-contained. Shared protocol docs live in `docs/`; shared runtime code with the Electron reference build is not a goal at MVP because the implementations are intentionally different.

## Architecture

```text
SwiftUI views
  RoomView
  InputDock
  ResponsePanel
  AspectRoster
        |
        v
VesselStore (Observable state)
  connection
  roster
  active target
  speech/input state
  inbox queue
  response detail
        |
        +--> NexusClient (URLSessionWebSocketTask)
        +--> SpeechRecognizer (Speech + AVAudioEngine)
        +--> SpeechSpeaker (AVSpeechSynthesizer)
        +--> TargetResolver ("hey <aspect>" + roster aliases)
        +--> KeychainConfig
```

## MVP feature set

### 1. Nexus connection

Use `URLSessionWebSocketTask` to connect to the broker.

Default endpoint:

```text
wss://nexus.tail41686e.ts.net:7888/connect
```

The app should expose a simple settings sheet for:

- Nexus URL
- optional token
- insecure/self-signed toggle only if needed for local development

Store these in Keychain or protected app storage. Token values must not be logged.

### 2. Roster

Show online aspects received from Nexus. MVP behavior:

- display all user-relevant online aspects
- hide dispatch/controller service aspects by default
- allow per-aspect mute
- active target is visually clear
- `keel` remains valid for testing while `shadow` availability varies

Known key aspects:

- `shadow` — orchestrator
- `anvil` — builder
- `plumb` — builder
- `keel` — always-on test aspect

### 3. Input modes

The iOS MVP keeps two modes, matching the desktop direction:

- **Conversation:** speech turn sends automatically on break/finalization.
- **Dictation:** speech fills the input box; cleanup can edit the box; the user taps Send.

First build can implement conversation mode plus manual Send, then add the dictation/conversation toggle once the connection path is proven.

### 4. Speech recognition

Use Apple's Speech framework first:

- `SFSpeechRecognizer`
- `SFSpeechAudioBufferRecognitionRequest`
- `AVAudioEngine`

Unlike the current macOS file-based helper, iOS should use streaming recognition so the input box can show partial text while the operator is speaking.

The input dock should show:

- live partial transcript
- final transcript
- audio waveform / level trace
- listening/transcribing/sending status

If Apple Speech quality is not good enough, add Whisper later through either:

- server-side Whisper on dMon/local cloud
- WhisperKit on-device

### 5. Natural targeting

Treat `hey` as the attention getter. The following name selects the target aspect.

Examples:

```text
Hey shadow, what changed today?
Hey keel, can you confirm the broker is alive?
Hey plumb, take a look at the Vessel build.
```

Targeting rules:

1. Match `hey <name>` at the start of the utterance.
2. Resolve `<name>` against online roster aliases.
3. Remove the attention phrase from the text sent to Nexus.
4. Focus the matched aspect.
5. If no target is found, keep the previous target or leave routing to Nexus.

Target resolution must preserve user intent. It may clean obvious STT errors such as `plum` -> `plumb` and `next us` -> `nexus`, but must not rewrite the request.

### 6. Sending

For targeted turns, send the Nexus `aspect.say` path used by the desktop reference build.

For untargeted turns, use the existing Nexus `chat.send` path or the connector's default routing policy.

The iOS client should capture and track the returned message id when Nexus provides one, so response correlation can improve over time.

### 7. Incoming queue

Incoming messages must not interrupt the operator while speaking.

MVP queue policy:

- If mic is active, queue incoming messages.
- If TTS is speaking, queue later messages.
- New incoming messages do not swap active target mid-speech.
- Muted aspects go to the inbox/detail panel but do not speak.
- A higher-priority direct response to the user's active target may speak next, but still after current speech/input finishes.

### 8. Response output

Use `AVSpeechSynthesizer` for MVP.

The app should support:

- spoken summary
- full detail text in the response panel
- stop speaking
- per-aspect mute

If Nexus messages already include `speech`/`speech_text`, use that for spoken output and show the full body in detail. If not, use a local heuristic summary first; model summarization can come later.

VoxCPM remains a later sidecar/service option for agent-specific tuned voices. It should not block the iOS MVP.

## UI layout

The iPhone UI should be a focused app, not a transparent overlay.

Suggested first screen:

```text
top: connection + active target
middle: response/detail panel
lower: aspect roster row
bottom: input dock with waveform, transcript, dictate/send controls
```

Design notes:

- Keep the bottom input dock large enough to confirm speech is being captured.
- Prefer a waveform/level trace over abstract "listening..." text.
- Keep response detail visible without forcing a navigation transition.
- Use dense, readable controls; this is an operational tool, not a landing page.
- Avoid trying to reproduce the desktop 3D room in the first build.

## Permissions and entitlements

Required:

- Microphone usage description (`NSMicrophoneUsageDescription`)
- Speech recognition usage description (`NSSpeechRecognitionUsageDescription`)

Likely later:

- Push notifications if passive inbox/background awareness is added.
- Background audio only if the UX requires continued speech playback while app is backgrounded.

Signing:

- Use the operator's Apple Developer account for device testing.
- Keep automatic signing enabled in the Xcode project unless the team profile requires manual provisioning.

## Security

- Store tokens in Keychain.
- Do not log bearer tokens, transcripts with secrets, or raw response bodies by default.
- Treat Custodian-backed credentials as handles/policies only; the iPhone app must not receive secret material.
- Prefer Nexus/Herald-mediated access; do not add direct CWB credential paths.
- Keep self-signed/insecure TLS options clearly development-only.

## Build order

1. Create native SwiftUI iOS project under `ios/`.
2. Add app state model and static preview data.
3. Build the focused room/input/detail UI.
4. Add Apple Speech streaming transcript with waveform.
5. Add `NexusClient` WebSocket connect and basic frame logging.
6. Add roster parsing and aspect selection/mute.
7. Add `hey <aspect>` target resolver.
8. Add targeted send path.
9. Add incoming queue and `AVSpeechSynthesizer` output.
10. Test on iPhone over tailnet against Nexus.

## Acceptance criteria

- The app builds and runs on the operator's iPhone.
- It connects to `nexus.tail41686e.ts.net:7888`.
- It shows the live roster.
- The operator can say `Hey keel, ...` and send a targeted turn.
- The input box shows live partial transcription while speaking.
- Incoming responses are queued while the operator is speaking.
- The app speaks a concise response and shows detail text.
- Tokens are not stored in plaintext user defaults.

## Deferred work

- TestFlight distribution.
- WhisperKit or server-side Whisper.
- VoxCPM voice profiles per aspect.
- Slime/embodied room view.
- Background inbox and notification policy.
- Generic non-Nexus connectors.
- Shared protocol package across desktop/iOS.
- Offline mode.

## Open questions

- Should conversation mode send automatically on Apple Speech final result, or require a short silence timer?
- Should the default iOS target be last-focused aspect, `shadow`, or no target?
- Should summaries be produced by Nexus/Gemma, the iOS app, or the sending aspect?
- What is the minimal set of Nexus frame kinds the iOS client should understand directly?
- Should the iOS app register as an operator client or a named aspect-like client?

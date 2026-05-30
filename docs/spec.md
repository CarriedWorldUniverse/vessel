# Vessel — Product Spec v0.2

**Date:** 2026-05-30 (v0.2.1 TTS amendment) — v0.2 amendments dated 2026-05-02, original v0.1 dated 2026-04-29
**Status:** Draft
**Repo:** `nexus-cw/vessel`

## v0.2.1 changes (summary)

Adds **Kokoro-82M** as a first-class **local, high-quality TTS engine** alongside Edge TTS (cloud) and Piper (local-basic). Sections changed: §13 (TTS pipeline — three-engine model + Kokoro rationale), §13.1 (selection logic), §13.2 (licensing — Kokoro is the clean-licensed commercial default candidate), §10.1 (config `tts.engine` values), §14 #11 (open question now has a leading resolution), §21.3 (bundle contents).

Rationale: Kokoro-82M topped the TTS Arena leaderboard (Jan 2026, ahead of XTTS-v2), is **Apache-2.0** (clean for commercial distribution — directly addresses open question #11), is ~82M params / ~300MB, runs faster-than-real-time even on CPU, and exports to **ONNX** so it runs inside the Rust engine via the `ort` (onnxruntime) crate with **no Python runtime dependency** (honours §3 lock #1). Preset voices only — no cloning — which matches vessel's per-recipient-voice model.

## v0.2 changes (summary)

This revision integrates conversation-driven decisions from 2026-05-02. Sections changed: §1 (distribution), §3 (locks #4, #5, new #8/#9), §4 (architecture: container + thin shell), §5.1 (`BackendEvent` extended with UI events), §11 (phase order: chains-first), §12 (STT cleanup-LLM pass), §14 (open questions), §15 (transcription cleanup clarified).

Key shifts:

- **Vessel is architected as a two-tier process model: a self-contained engine process hosting services + SDKs + bundled UI manifests, and a thin native shell window for the transparent overlay.** Throughout this spec, "container" refers to the engine *as a product concept* (a self-contained process that holds the runtime), not to OCI/Docker as a packaging mechanism. **Beta builds run engine and shell as normal local-dev processes**; release-time distribution packaging (OCI image vs self-contained sidecar bundle) is a separate decision pending the audio-passthrough spike.
- **One SDK, not two.** ChatSource extends to carry UI manifests as another payload type — there is no separate Interface SDK. Aspects (or other AIs) author UI manifests; vessel's runtime renders them in a constrained component vocabulary.
- **ChatSource transport is bidirectional and push-capable (WebSocket or SSE-with-uplink). Not MCP.** MCP is pull-shaped and cannot wake an agent with a new turn; ChatSource needs push on both sides for the wake direction. MCP remains optional for vessel's *capability surface* (mic/speaker/avatar control as tools).
- **Build chains-first, integrate UI second.** Input chain CLI, output chain CLI, ChatSource glue CLI all run before the Tauri/VRM integration step.
- **Cross-platform STT is whisper.cpp + cleanup-LLM pass.** The cleanup pass is the moat (per Glaido analysis); STT engine is pluggable behind a trait so per-platform accelerators (WhisperKit on macOS) can drop in later.
- **Transcription cleanup ≠ message rewriting.** §15's non-goal "Modifying recipient behavior" no longer forbids basic punctuation/filler-word cleanup of the user's spoken input — only context injection or persona rewriting.



## 1. What Vessel is

Vessel is a desktop product that gives an LLM a face and a voice. The user speaks (or types), the message is routed to the configured chat backend, and the response comes back as audio in a per-recipient voice, lip-syncing to a 3D VRM avatar in a transparent always-on-top window.

It is a **standalone product**, designed as bring-your-own-backend: any OpenAI-compatible endpoint, Anthropic Claude API, a Nexus broker (the reference network this product was originally designed alongside), or community-built adapters built against the Vessel SDK.

**Architectural shape (v0.2):** vessel is structured as two tiers — an **engine** process hosting the services (STT, TTS, lipsync), the ChatSource SDK runtime, the Interface manifest renderer, and bundled default UIs (avatar shell, chat-only, harness-tuned variants); and a **thin native shell** hosting a transparent always-on-top window pointing at the engine's localhost UI endpoint. The engine is the runtime; the shell is the visual boundary. They communicate over local IPC (§4.6).

**On the word "container."** Where this spec uses "container," it refers to the engine *as a product concept* — a self-contained process holding the runtime — not to OCI/Docker images as a distribution mechanism. The two-tier process model is the architecture and applies regardless of how the binaries are eventually packaged.

**Distribution packaging is a separate, later decision.** Beta builds run the engine and shell as normal local-dev processes (cargo / pnpm tauri dev), the same way any two-process desktop app would. Release-time packaging — whether to ship the engine as an OCI image, as a self-contained sidecar bundle inside the Tauri app, or both — is gated on the Phase 0 audio-passthrough spike (§14 open question #6, §21). That spike's outcome shapes release distribution; it does not gate beta development or change the process-model split.

**The UI is programmable.** The bundled avatar overlay is one default among several. Aspects (or other AIs) can author their own UI by emitting a manifest over ChatSource (§5.1); vessel renders it in a constrained component vocabulary with a declared capability scope. Common harnesses (Claude Code, Cursor) get pre-tuned default UIs alongside the avatar.

The product name reflects the metaphor: the VRM is a vessel for the recipient's identity; the application is a vessel for any LLM. It holds, presents, and speaks for — without claiming to be — the intelligence behind it.

## 2. Why this exists

Two distinct use cases motivate Vessel:

**Ambient interaction.** Chat-based UIs are the right tool for dense, structured work — code review, ticket flow, multi-recipient collaboration. Vessel is for the other mode: ambient interaction. A user says "hey \<recipient-name\>, what's the latest on …" without breaking out of whatever they're doing, hears the response in a configured voice through an avatar with a configured face, and resumes. Recipients-as-individuals reinforced by face + voice.

**Distributable product.** There is a market for "talk to your LLM with a face on it." VTube Studio adjacent tools, AI companion apps, accessibility-driven voice interfaces. Vessel addresses this market by abstracting the chat backend behind an SDK and shipping reference adapters for the common API shapes. Distribution path: desktop binary releases plus the SDK package on npm.

## 3. Architectural decisions (locked)

These are not open questions in this spec:

1. **Native build, not fork.** No Python runtime dependency. No fork-tracking debt against an upstream avatar library.
2. **VRM model format.** Open standard, no licence tax for individual / small-scale use, standardized blendshapes / bones / expressions. Users bring their own; the build bundles CC0 placeholders for development.
3. **Three.js + @pixiv/three-vrm rendering.** Web-tech consistent with the build's frontend. Unity reserved for a possible later swap if animation richness becomes a differentiator.
4. **Tauri v2 thin shell + engine process — two-tier architecture.** Tauri v2 hosts the transparent always-on-top window and routes audio I/O between OS and engine. The engine holds services + SDK + manifest renderer. Smaller binaries than Electron (~5MB vs ~80MB), native APIs for transparent overlay. The two-tier process split is **locked** as the architecture; beta runs the two as ordinary local processes. **Release-time distribution packaging is open** (OCI image, self-contained sidecar bundle, or both) — see §14 open question #6 and §21. That decision shapes release builds; it does not change the process model.
5. **whisper.cpp via Rust backend (`whisper-rs`) as the cross-platform STT default. STT engine is pluggable.** No node-gyp surface; native code stays in Rust where it belongs. The runtime exposes an `STTEngine` trait so per-platform accelerators (WhisperKit on macOS, ONNX+DirectML on Windows) can drop in as Phase 6+ optimisations without changing the chain. **A cleanup-LLM pass follows STT** in the input chain (Claude Haiku or local small model) and is the felt-quality moat — see §12.
6. **SDK-first with reference adapters.** `ChatSource` interface in `@nexus-cw/vessel-sdk`. Reference adapters bundled at v1: `NexusAdapter`, `OpenAIAdapter` (OpenAI-compatible API shape — covers OpenAI, Ollama, LM Studio, llama.cpp server, vLLM, Together, Groq, OpenRouter, Mistral, DeepSeek, and most local LLM tooling), `AnthropicAdapter` (Anthropic Claude API + emulators).
7. **Single-user at v1.** Vessel-the-binary supports a single user / single config. Multi-tenant deployments are downstream consumer concerns, not v1 scope.
8. **ChatSource transport is bidirectional and push-capable (WebSocket or SSE-with-uplink). Not MCP.** MCP is structured as agent-initiated tool calls — pull-shaped, with no clean way to wake an agent with a new turn. ChatSource needs push capability on both sides: user → backend (the wake direction) and backend → user (response stream, attention calls, UI manifests, all unsolicited). MCP remains *optional and orthogonal* — vessel may expose mic/speaker/avatar control as MCP tools the harness can pull on during its own turn, but that is a capability surface, not the conversation channel.
9. **One SDK, not two.** UI manifests are a payload type carried over the same ChatSource connection as chat messages — not a separate Interface SDK. An aspect that wants to push a custom UI uses the same connection it uses to post chat. Trust boundary (component vocabulary, capability gating, user approval) lives in vessel's runtime regardless of which backend emitted the manifest.

## 4. Architecture

Vessel v0.2 is a two-tier architecture: a thin native shell (Tauri v2) hosting the user-facing window and OS-level concerns (audio I/O, global shortcuts, transparent overlay), and a container engine hosting all services and the SDK runtime. The shell talks to the engine over local IPC; the engine talks to backends over the configured ChatSource transport.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  Thin shell (Tauri v2 — native, per platform)            │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Renderer (WebView) — manifest renderer + audio playback         │   │
│  │  ┌─────────────────────────┐  ┌──────────────────────────────┐  │   │
│  │  │ Active surface(s):      │  │ Capability gating UX         │  │   │
│  │  │ • Avatar overlay (VRM)  │  │ • Approval prompts            │  │   │
│  │  │ • Manifest panels       │  │ • Permissions settings        │  │   │
│  │  │ • Sidebar attention     │  │ • Active manifest registry    │  │   │
│  │  └─────────────────────────┘  └──────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Native (Rust) — OS integration                                   │   │
│  │  • Transparent always-on-top window mgmt (per-platform)           │   │
│  │  • Global hotkey registration (push-to-talk, stop)                │   │
│  │  • Mic/speaker capture & playback (cpal / OS APIs)                │   │
│  │  • File picker dialogs (capability-gated)                         │   │
│  │  • IPC client to engine (localhost UDS or TCP)                    │   │
│  │  • Auto-update orchestration                                      │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │ local IPC (Unix domain socket
                                  │ or localhost TCP — see §4.4)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│   Engine (container — OCI image OR self-contained sidecar bundle)        │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Pipelines                                                        │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │   │
│  │  │ STT engine  │  │ TTS engine  │  │ Lip sync (rhubarb)      │  │   │
│  │  │ (whisper.cpp│  │ (Edge TTS / │  │ phoneme timing pre-roll │  │   │
│  │  │  pluggable) │  │  Piper)     │  │                         │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘  │   │
│  │  ┌─────────────────────────────────────────────────────────────┐│   │
│  │  │ Cleanup-LLM pass (Claude Haiku / local small model)          ││   │
│  │  └─────────────────────────────────────────────────────────────┘│   │
│  └──────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  ChatSource SDK runtime                                           │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌─────────────────┐ │   │
│  │  │ Nexus    │ │ Anthropic│ │ OpenAI-compat│ │ Community       │ │   │
│  │  │ adapter  │ │ adapter  │ │ adapter      │ │ adapters        │ │   │
│  │  │ (WS)     │ │ (SSE)    │ │ (SSE)        │ │ (any transport) │ │   │
│  │  └──────────┘ └──────────┘ └──────────────┘ └─────────────────┘ │   │
│  │  Wire-protocol normalisation; push fallback for non-push backends │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Manifest renderer runtime (server-side)                          │   │
│  │  • Vocabulary registry (vessel-shipped components)                │   │
│  │  • Manifest validation, capability resolution                     │   │
│  │  • Patch op application                                           │   │
│  │  • Default UIs: avatar-default, chat-default, harness-tuned       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  State                                                             │   │
│  │  • User config (vessel.config.yaml)                               │   │
│  │  • Permissions store (capability approvals per aspect)            │   │
│  │  • Voice/portrait cache                                           │   │
│  │  • Persistent manifests (display.persistent capability)           │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ ChatSource transport
                                   │ (WS or SSE-with-uplink — §3 lock #8)
                                   ▼
                         ┌─────────────────────┐
                         │ Configured backend  │
                         │ (Nexus / OpenAI /   │
                         │  Anthropic / etc.)  │
                         └─────────────────────┘
```

### 4.1 Process model

Vessel runs as **two processes** at minimum (more with subprocess pipelines):

1. **Shell process** — the Tauri v2 app. Owns the user-facing windows (avatar overlay, manifest panels, settings UI). Owns OS resources that can only be accessed natively: global hotkeys, mic/speaker via `cpal` or platform APIs, transparent always-on-top windows, file picker dialogs, system tray. Lightweight; the heavy lifting happens in the engine.

2. **Engine process** — the container. Runs all services (STT, TTS, lipsync, cleanup-LLM), the ChatSource adapters, the manifest renderer runtime, and holds user-config + permissions state. Started by the shell at app launch; supervised by the shell; co-terminates on shell exit.

3. **Subprocess pipelines (transient)** — rhubarb-lip-sync, optionally external TTS engines, optionally per-platform STT accelerator binaries (e.g. WhisperKit sidecar on macOS Phase 6+). Spawned by the engine on demand.

The container *engine* is the load-bearing process. The shell is deliberately thin so the same engine can be reused if vessel ever sprouts alternative shells (web frontend, mobile companion, headless mode) — see §15 non-goals on multi-tenant for what's *not* on the table.

### 4.2 Data flow (input — voice)

1. User holds push-to-talk hotkey (registered globally by the **shell**).
2. **Shell** captures mic audio (`cpal` or platform-native API), buffers to a WAV in memory.
3. On key release, shell forwards the WAV to the **engine** over IPC.
4. **Engine** runs STT (whisper.cpp by default) on the WAV → raw transcript.
5. **Engine** runs cleanup-LLM pass → cleaned transcript (filler-word stripped, punctuation inserted, intent preserved per §12).
6. **Engine** runs name detector on cleaned transcript → matches `<recipient>:` / `hey <recipient>` / `<recipient>,` / falls back to last-active.
7. **Engine** dispatches `(recipient, cleaned_message)` to the configured ChatSource adapter via `send()`.
8. Adapter delivers to backend; response stream begins.

### 4.3 Data flow (input — text or UI event)

1. User types in a manifest's `text-input` (rendered by **shell** renderer) or types in a chat-default manifest.
2. Shell emits the typed value as a `UIEvent` over IPC to the engine.
3. **Engine** routes to the appropriate ChatSource backend (chat message or UI event payload — same connection, see §5.4).

### 4.4 Data flow (output — voice + avatar)

1. ChatSource adapter (in **engine**) streams response tokens from backend.
2. **Engine** TTS coordinator buffers tokens to sentence boundaries (`.`, `!`, `?`, `\n\n`, or stream-close). Sentence-boundary buffering is the coordinator's job — adapters expose raw token streams; reasons: phoneme timing on a half-sentence produces wrong audio; TTS quality is meaningfully better on coherent sentences; adapters shouldn't need to know that TTS exists.
3. Per sentence: **Engine** runs TTS (Edge TTS primary, Piper fallback) → WAV bytes.
4. Per sentence: **Engine** runs rhubarb-lip-sync subprocess on the WAV with the transcript as hint → phoneme-timing JSON. Pre-playback (~100–300ms per sentence on modern CPUs); the "thinking" expression covers this gap.
5. **Engine** sends `(recipient, text, voice, audio_bytes, blendshape_timeline)` tuple to **shell** over IPC, queued via the speech queue model (§6).
6. **Shell** plays audio (native API), drives `VRMExpressionManager` blendshapes from the precomputed timeline (timeline is a lookup table, not a streaming pipeline).

### 4.5 Data flow (output — UI manifest)

1. ChatSource adapter (in **engine**) receives `BackendEvent { type: "ui.manifest", ... }`.
2. **Engine** validates the manifest (schema_version, vocabulary check), resolves capabilities, performs approval flow if first time from this `from`.
3. **Engine** sends the validated manifest tree + assigned surface to **shell** over IPC.
4. **Shell** renderer instantiates the components from its registry, renders into the assigned surface.
5. User interactions emit `UIEvent`s back via the chain in §4.3.

### 4.6 Inter-process communication (shell ↔ engine)

The shell-engine boundary is local-machine IPC. Two transport candidates, decided at Phase 0:

- **Unix domain sockets** (Linux, macOS) and **named pipes** (Windows) — no listening port, OS enforces local-only access, no firewall prompts. Default choice unless container packaging forces otherwise.
- **Localhost TCP** with a randomly-chosen unprivileged port and a per-launch shared-secret bearer token. Required if the engine is OCI-Docker (Docker on Mac/Windows can't bind UDS to the host filesystem easily). Mitigations against local-other-process tampering: bind to `127.0.0.1` only; require `Authorization: Bearer <secret>` on every IPC call; rotate secret per launch; never log it.

**Frame protocol.** JSON messages over a length-prefixed stream (4-byte big-endian length + UTF-8 JSON). Each message is one of:

- **Request/response** — shell-to-engine commands (`stt.transcribe`, `tts.synthesise`, `chat.send`, `manifest.event`, `permission.set`, etc.) and replies. Correlated by `id`.
- **Push** — engine-to-shell unsolicited messages (`speech.tuple`, `manifest.render`, `manifest.patch`, `attention.show`, `state.update`).
- **Audio binary frames** — for STT input WAV and TTS output WAV, separate binary stream alongside the JSON channel (avoids base64-bloat). Channel multiplexed via a 1-byte frame-type prefix.

**Lifecycle.**

- Shell launches engine on app start. Engine binds its IPC endpoint, writes a connection-info file (`vessel-engine.sock` or `vessel-engine.port` + secret) to a known per-platform location (`$XDG_RUNTIME_DIR` on Linux, `~/Library/Application Support/vessel/runtime/` on macOS, `%LOCALAPPDATA%\vessel\runtime\` on Windows).
- Shell connects, performs version handshake (`engine.hello` → `shell.hello`), then both sides ready.
- If engine crashes: shell detects (read EOF or connect-refused), shows "engine restarting" overlay, respawns engine with backoff (1s → 2s → 4s, cap 30s). Volatile engine state (active manifests, queue) is lost; durable state (config, permissions, voice cache) reloads from disk.
- If shell exits: engine receives EOF, completes any in-flight TTS/STT, cleanly shuts down (drains adapters, persists state, exits within a 5s grace window).
- Watchdog: shell pings engine every 10s; engine pings shell every 10s. Three missed pings → reconnect cycle. Avoids hung-but-not-crashed scenarios.

**Why two processes, not one.** Three reasons: (1) the engine has heavy-compute components (whisper, rhubarb, LLM calls) that benefit from process isolation if they crash; (2) container packaging — the same engine artifact runs in the dev sidecar bundle and could potentially run as OCI; (3) future-proofs alternative shells (web frontend, mobile companion, headless mode) without rebuilding the engine.

## 5. Vessel SDK

The SDK is the integration contract between Vessel and any chat backend. Published as `@nexus-cw/vessel-sdk` on npm.

### 5.1 ChatSource interface

```typescript
export interface ChatSource {
  /** Human-readable name shown in UI ("OpenAI", "Anthropic Claude", "Nexus") */
  readonly name: string;

  /** Adapter implementations declare which recipients are addressable.
      For Nexus, this is the configured roster.
      For OpenAI, it's a single "assistant" identity (or per-config). */
  readonly recipients: Recipient[];

  /**
   * Send a message to a recipient and stream the response text back.
   *
   * Error contract: adapters MUST throw on backend errors (404, rate-limit,
   * timeout, auth failure, network failure). The throw bubbles up to the
   * speech-queue layer which surfaces a user-facing error (spoken offline
   * message template or visual indicator). A clean end-of-stream means
   * "the response finished successfully"; throw means "something went wrong."
   * Never silently terminate the stream on error.
   */
  send(recipient: string, message: string): AsyncIterable<string>;

  /** Optional: subscribe to push events (for backends that support
      server-initiated messages). */
  subscribe?(handler: (event: BackendEvent) => void): () => void;

  /** Lifecycle. */
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
}

export interface Recipient {
  id: string;          // address ID
  displayName: string; // shown in UI
  voice?: string;      // suggested TTS voice ID
  avatar?: string;     // suggested VRM file path
}

/**
 * Discriminated union of backend-pushed events. Adapters that support push
 * (subscribe()) emit these typed events; consumers (AttentionManager,
 * conversation state) match on `type` and access typed `payload`.
 */
export type BackendEvent =
  | { type: "message"; payload: { recipient: string; from: string; text: string; turn_id?: string } }
  | { type: "attention"; payload: { from: string; urgency: "normal" | "critical" } }
  | { type: "thread_changed"; payload: { thread_id: string } }
  // v0.2 additions — UI manifest carriage:
  | { type: "ui.manifest"; payload: { manifest_id: string; from: string; manifest: UIManifest } }
  | { type: "turn.begin"; payload: { turn_id: string; recipient: string } }
  | { type: "turn.end"; payload: { turn_id: string; recipient: string } };

/**
 * UI manifest — declarative description of a view rendered by vessel's runtime.
 * Constrained vocabulary: references named components from a vessel-shipped registry,
 * not raw HTML/JS. Declares its capability requirements (mic, file picker, clipboard,
 * display surface) so the runtime can gate them. Approved per-aspect on first render;
 * sticky thereafter, revocable via vessel UI.
 *
 * v0.2 leaves the precise schema to a follow-up — open question §14 #7 (vocabulary
 * package location). Reference inspirations: MCP-UI, Claude Artifacts, generative-UI
 * patterns. Adapters that don't speak UI manifests simply never emit them.
 */
export interface UIManifest {
  schema_version: string;
  components: ComponentNode[];           // tree of named components from registry
  capabilities_requested: Capability[];  // declared, gated by runtime
  // ... see follow-up vocabulary spec
}
```

UI events flow back through the existing `send()` method as a structured `UIEvent` payload (specifics in the vocabulary spec follow-up). The same connection carries chat input and UI events; the backend distinguishes by payload type.

**ChatSource is push-capable on both sides.** Adapter `subscribe()` is the inbound push channel for `BackendEvent`; the wake direction (user → backend new turn) is push from vessel's side via `send()` at any time. There is no polling. Implementations use WebSocket or SSE-with-uplink — see §3 lock #8 for why MCP is not the right transport.

### 5.2 Reference adapters bundled at v1

**`NexusAdapter`** — talks to a Nexus broker via WebSocket. Auth via Bearer token. Subscribes to message events filtered for the user's active thread (per §8). Emits `attention` events when a Nexus aspect uses the attention message kind. Recipients are the configured roster.

**`OpenAIAdapter`** — talks to any OpenAI-compatible Chat Completions endpoint. Config: `base_url`, `api_key`, `model`. Single recipient (`assistant`) by default, or multiple if config defines per-recipient model overrides. Streams via SSE. Covers OpenAI, Ollama, LM Studio, llama.cpp server, vLLM, Together, Groq, OpenRouter, Mistral, DeepSeek, and most local-LLM tooling.

**`AnthropicAdapter`** — talks to Anthropic Messages API. Config: `api_key`, `model`. Streams via SSE. Single recipient by default. Covers Anthropic Claude API and emulators.

### 5.3 Community adapters

Adapters not in the v1 bundle (Cohere, Replicate, custom backends) are community-contributed. Two paths:
- **Loose:** published as `@<author>/vessel-adapter-<backend>` on npm, users install per-need.
- **Curated:** a `nexus-cw/vessel-adapters` mono-repo accepting community contributions to a quality bar. Optional, depending on contributor signal.

The SDK contract is the only thing core ships forever. Adapters in core (the three above) carry maintenance commitment; everything else is community.

### 5.4 ChatSource wire protocol

ChatSource adapters speak a normalised wire protocol upward to the engine and downward to their backend. The *engine ↔ adapter* boundary is the SDK interface (§5.1); the *adapter ↔ backend* boundary is provider-specific. Adapters translate.

The SDK interface frames are JSON messages over the adapter's chosen transport (WS, SSE-with-uplink, or HTTP for non-push backends). Frame types:

**Outbound (vessel → backend):**

```typescript
type OutboundFrame =
  | { type: "chat.send"; payload: { recipient: string; message: string; reply_to?: string; turn_id?: string } }
  | { type: "ui.event"; payload: { manifest_id: string; component_id: string; event: string; value: any; ts: string } }
  | { type: "presence"; payload: { state: "active" | "idle" | "away" } }
  | { type: "thread.read"; payload: { thread_id: string; up_to_msg_id?: string } }
  | { type: "auth.refresh"; payload: { token: string } };
```

**Inbound (backend → vessel) — same as `BackendEvent` in §5.1, plus connection-level frames:**

```typescript
type InboundFrame =
  | BackendEvent
  | { type: "ack"; payload: { in_reply_to: string } }
  | { type: "error"; payload: { code: string; message: string; retriable: boolean } }
  | { type: "ping" } | { type: "pong" };
```

**Lifecycle:**

1. **Connect.** Adapter dials backend (WS open, SSE+uplink session, or for HTTP-only: nothing — adapter just initialises).
2. **Auth.** Adapter performs whatever auth handshake the backend requires (Bearer token, OAuth, custom signed handshake). On WS, this is usually the upgrade-request `Authorization` header. On SSE, the initial GET; on HTTP, every request.
3. **Subscribe.** If the backend supports push, adapter subscribes to its event stream and starts emitting `BackendEvent`s upward via `subscribe()`. If it doesn't, adapter starts the push-fallback strategy (§5.5).
4. **Send/receive.** `send()` returns an `AsyncIterable<string>` for the response stream; `subscribe()` is the unsolicited push channel.
5. **Reconnect.** Connection loss → exponential backoff (250ms → 30s cap). On reconnect, re-auth, re-subscribe, replay any queued outbound frames. Send a `presence` frame on reconnect if the backend cares.
6. **Disconnect.** `disconnect()` cleanly closes; remaining queued outbound is dropped (the user has signalled they're done).

**Ordering guarantees:** Within a single `send()` stream, response tokens arrive in order. Across multiple concurrent `send()` calls, ordering is not guaranteed (different recipients in flight simultaneously is normal). Across the `subscribe()` channel, order is best-effort — the speech queue (§6) handles the global ordering view that matters to the user.

**Auth refresh:** Long-lived connections may have tokens expire. The adapter must monitor for `auth.expired` errors (or 401s from the backend) and trigger a refresh via the configured auth strategy (§10.x). If no refresh is possible, the connection drops cleanly and the user sees a reauth prompt.

### 5.5 Push fallback for non-push backends

OpenAI Chat Completions, Anthropic Messages API, and most local-LLM serving stacks (Ollama, LM Studio, llama.cpp server, vLLM) are **request/response only** — they have no native server-initiated push channel. The wake direction is fine (user → backend send works trivially), but `BackendEvent` push (attention calls, UI manifests, unsolicited messages) doesn't exist in their model.

For these backends, ChatSource adapters implement a **push fallback strategy**:

- **No push at all.** The adapter's `subscribe()` is a no-op. `BackendEvent` types beyond `message` (i.e. `attention`, `ui.manifest`, `thread_changed`) are not supported. The adapter declares this by setting `supports_push: false` in its capabilities. Vessel hides UI features that require push (attention manager, manifest panels) when configured to use such a backend.

- **Polling fallback (opt-in, per-adapter).** For backends that have a polling-style state endpoint (e.g. an extension API on top of OpenAI-compat), the adapter may emulate push by polling at a configurable interval (default: off; opt-in via adapter config). Vessel surfaces this as "Best-effort push (polling every Ns)" in adapter config UI so users understand the latency cost.

- **Wrapper backends.** A user can run their own thin wrapper service in front of an OpenAI-compatible backend that adds push (WS endpoint that buffers backend responses + emits attention events). The wrapper exposes a custom adapter (community or self-built); vessel's SDK doesn't know or care.

**Practical implication:** vessel's flagship features (multi-recipient speech queue, attention calls, AI-authored UIs) are *fully* available only with backends that support push (Nexus, possibly Anthropic Messages with Server-Sent Events streaming + a wrapper, future OpenAI Realtime). With raw OpenAI/Anthropic, vessel works as a single-recipient voice client — speak, get a voiced reply, repeat. That's the v1 product floor. The product *ceiling* requires a push-capable backend.

This is documented in §10 (per-recipient config) so users know the feature differential before configuring.

### 5.6 Adapter capability declarations

Each adapter declares its capabilities so vessel can gate features:

```typescript
export interface AdapterCapabilities {
  supports_push: boolean;           // server-initiated `BackendEvent`s
  supports_attention: boolean;      // `attention` event type
  supports_ui_manifests: boolean;   // `ui.manifest` event type — Nexus only at v1
  supports_threads: boolean;        // multi-thread state
  supports_multi_recipient: boolean;// multiple addressable recipients vs single assistant
  streaming: boolean;               // streamed `send()` response (vs full text in one shot)
  reauth_strategy: "none" | "refresh-token" | "manual-only";
  wire_protocol: "ws" | "sse" | "http" | "custom";
}
```

The engine reads these at adapter init and disables/enables UI features accordingly.

## 6. Speech queue and interrupts

When multiple recipients have responses pending (broadcast reply, threaded back-and-forth, attention calls), they speak in order — not simultaneously. The queue is the orchestration layer.

### 6.1 Queue model (v1)

- FIFO queue of `(recipient, text, voice, audio, blendshape_timeline)` tuples.
- Active speech plays to completion, then queue advances.
- Avatar swap happens between queue entries — visual + voice change together.
- Single voice at any moment. Multi-avatar visual presence (§7) does not mean multi-voice.

### 6.2 Interrupt rules (v1)

**User-driven only.** A new utterance from the user (typed or spoken, addressing any recipient) interrupts the current speaker. Active speech stops at the next phoneme boundary, queue is preserved (queued items remain queued), and the user's addressed recipient's response (when it arrives) jumps to head-of-queue.

Recipients responding to each other never interrupt each other. They queue. Cleanest mental model: the user is always immediately responsive, recipients wait their turn.

Priority-tagged interrupts and recipient-aware interrupts are deferred to Phase 6+. v1 has the simple rule.

### 6.3 Edge cases

- **Mic active = queue pauses.** When user is speaking (push-to-talk held, or VAD active), avatar speech pauses at the next phoneme boundary and resumes when mic releases.
- **Stale messages drop.** Queue entries older than 30s (configurable) are dropped at dequeue time. Avoids stale ambush after user has moved on.
- **Queue cap.** Maximum 5 entries; older entries dropped if cap hit.
- **Stop hotkey.** Single global hotkey clears the queue + cuts current speaker.

## 7. Visual model

The visual model is expressed as a **bundled default UI manifest** (`avatar-default`) — the same vocabulary and rendering pipeline as aspect-authored manifests, just shipped with vessel. This is deliberate: if the avatar default can't be expressed in the manifest vocabulary, the vocabulary is missing something.

### 7.1 v1: active VRM + static portrait sidebar

- **Active slot** — full Three.js + VRM render via the `avatar` component (vocabulary spec §4.4). Skeletal animation, lip-sync, idle, expressions. Front-center, full-size.
- **Portrait sidebar** — static portrait images for queued recipients and recipients in attention state, rendered via `portrait` components.
- **Attention indicator** — CSS animation on the relevant portrait (subtle pulse for "calling," brighter glow for emergency).
- **Speech queue still single-voice** — only the active VRM speaks. Static portraits are visual presence, not voice.

The avatar surface is **reserved**. Aspect-authored manifests render in manifest panels; the avatar surface is owned by the bundled `avatar-default` manifest exclusively. This preserves the product identity (the avatar is *vessel*, not any single aspect) and prevents aspect manifests from hijacking the always-on-top surface.

### 7.2 Portrait sourcing

Each recipient needs a static portrait. Two ways:
1. **Auto-generate from VRM** — render the VRM in a neutral pose to a PNG at first run, cache locally.
2. **Per-recipient override** — if a hand-crafted portrait PNG is at the configured path, use it instead.

Default: auto-generate. Users can drop in better art later. Auto-generation uses fixed lighting setup so portraits are visually consistent across recipients.

### 7.3 Future visual upgrades (post-v1)

- **v2: two-VRM slots** — second avatar live-rendered in peripheral position. Wave-for-attention with full skeletal animation.
- **v3: full ensemble** — all configured recipients on screen, panel view, ambient presence.

Deferred until v1 ships and the product earns the investment.

## 8. Active-thread filtering

The avatar isn't a passive observer of all chat. It's tied to user attention — only messages in the user's currently-active thread drive speech.

### 8.1 v1 mechanism: client-side inference

Vessel tracks the user's last-addressed recipient / last-active thread. Outgoing messages from user establish the active thread; incoming messages on that thread drive avatar speech; messages on other threads are silently received (still visible in any backend UI for the user).

This requires no backend change. Cost: less precise (doesn't reflect "user clicked another thread elsewhere" until they speak again).

### 8.2 Future: backend-side state

For backends that support it (e.g. Nexus broker), a future enhancement: backend tracks `user.active_thread` as session state, multiple UIs subscribe via push events. Single source of truth. Defer to a later Vessel version + corresponding backend change. Not v1 scope.

### 8.3 Non-Nexus adapters

For OpenAI / Anthropic / others: there is no concept of "thread" beyond what the application maintains. Vessel's internal conversation state is the active thread; no ambiguity.

## 9. Attention mechanism

Recipients outside the user's active thread need a way to break in.

### 9.1 v1 patterns

- **Soft notification (default).** Recipient's portrait appears in sidebar with attention CSS animation (pulse). Optional soft chime. User engages by addressing the recipient (voice or text), queue then plays the recipient's pending message.
- **Direct break-in (declared emergency only).** Recipient speech interrupts current activity. Reserved for narrow emergency taxonomy; user-defined per deployment.

### 9.2 Protocol

**Nexus adapter.** Messages with the attention kind and an optional `urgency` field (`"normal"` or `"critical"`) carry the attention call. Backend rate-limits and allowlists are enforced server-side; the adapter consumes them as `BackendEvent { type: "attention", ... }` events.

**Routing decision: backend emits a distinct WS event type.** The Nexus broker filters attention messages and pushes them as a separate event, which the NexusAdapter forwards directly. Reasons: keeps NexusAdapter narrowly responsible for transport, not message-schema interpretation; avoids forcing every Vessel client to parse attention semantics; backend is the right place to enforce rate-limits and allowlists.

**Other adapters.** OpenAI/Anthropic don't natively support server-initiated messages (see §5.5 push fallback). The attention mechanism is unavailable on those backends unless a server-side wrapper emits `BackendEvent` of type `attention` via the SDK's optional `subscribe` method. Vessel's settings UI surfaces this as "Attention calls require a push-capable backend" when the user configures a non-push adapter.

### 9.3 Gating

For backends that support attention (Nexus today, others potentially via wrappers), gating is configured per-deployment:

```yaml
attention:
  allowlist:
    normal: ["*"]              # any recipient can call for normal attention (rate-limited)
    critical: ["<recipient>"]  # only configured recipients can declare critical
  rate_limit:
    normal_seconds: 300        # 1 per 5 min per recipient
    critical_seconds: 0        # unlimited; trust gating instead
```

Defaults conservative.

## 10. Configuration

### 10.1 Config file

Vessel config at `${app_config_dir}/vessel.config.yaml`:

```yaml
backend:
  adapter: "nexus"  # or "openai", "anthropic", or community adapter name
  config:
    # adapter-specific
    url: "wss://<your-broker>/connect"
    auth_strategy: "bearer-secret"   # see §10.4
    secret_ref: "vessel.nexus.token" # OS keystore reference, NOT the secret itself

stt:
  engine: "whisper-cpp"   # or "whisperkit-mac" (Phase 6+), "onnx-directml" (Phase 6+)
  model: "base.en"        # whisper.cpp model name; downloaded on first run if missing
  push_to_talk_hotkey: "Ctrl+Space"  # global hotkey; see §10.6
  cleanup_llm:
    enabled: true
    provider: "claude-haiku"   # or "openai-mini", "local-phi", "off"
    secret_ref: "vessel.cleanup.token"
    offline_fallback: "local-phi"  # used if cleanup provider unreachable; "off" = no cleanup offline

tts:
  engine: "edge-tts"        # "edge-tts" (cloud) | "kokoro" (local, high-quality) | "piper" (local, basic)
  fallback_engine: "kokoro" # commercial-build recommendation: engine: "kokoro", fallback_engine: "piper" (fully local, clean licence)
  voice_default: "en-US-DavisNeural"

queue:
  stale_seconds: 30
  max_entries: 5
  stop_hotkey: "Ctrl+Shift+Esc"

attention:
  allowlist:
    normal: ["*"]
    critical: []
  rate_limit:
    normal_seconds: 300
    critical_seconds: 0

recipients:
  - id: "recipient-a"
    avatar: "models/recipient-a.vrm"
    portrait: "portraits/recipient-a.png"  # optional override
    voice: "en-GB-RyanNeural"
  - id: "recipient-b"
    avatar: "models/recipient-b.vrm"
    voice: "en-US-DavisNeural"

defaults:
  fallback_recipient: "recipient-a"
  thinking_expression: "happy"  # VRM expression key
  offline_message: "{recipient} isn't online right now."

privacy:
  telemetry: false                # see §20.2
  crash_reports: "ask"            # "always" | "never" | "ask"
  retain_transcripts_seconds: 0   # 0 = never persist; >0 = local-only retention window
  retain_audio_seconds: 0

updates:
  channel: "stable"               # "stable" | "beta"
  auto_check: true
  auto_install: false             # always require user confirmation
```

### 10.2 Config loading and validation

- Vessel reads config at engine start. Missing fields fall back to documented defaults.
- Schema validation happens before any service starts. Validation errors abort startup with a clear message in the shell's error overlay.
- Edits via the settings UI write back to the same YAML, preserving comments and ordering where possible (round-trip YAML library).
- Hot-reload: changes to most fields take effect on next adapter init / next pipeline use. Hotkey changes take effect immediately. Backend changes restart the active connection.

### 10.3 Per-recipient overrides

The `recipients` array sets per-identity defaults. These can be augmented by:
- The Nexus adapter's roster (auto-populates when connected; YAML provides overrides).
- Manifest-level metadata (an aspect can express a preference for voice/avatar that vessel may honour or override per user setting).

Conflict precedence: user YAML > manifest hint > backend roster default.

### 10.4 Secrets and authentication

**Secrets never live in the config YAML.** YAML holds *references* (`secret_ref: "vessel.nexus.token"`); the actual secret lives in the OS-native keystore:

- macOS: Keychain (`Security` framework, service prefix `com.nexus-cw.vessel.`).
- Windows: Credential Manager (`CredWrite` API, target prefix `vessel:`).
- Linux: Secret Service API via `libsecret` (`org.freedesktop.secrets`); falls back to a file-based encrypted store (`age`-encrypted) if no keyring is available.

Auth strategies (per `auth_strategy` field):

| Strategy | Flow |
|---|---|
| `bearer-secret` | Static bearer token from keystore. Used for Nexus, simple API keys. |
| `oauth-pkce` | OAuth 2.0 + PKCE; vessel opens browser, captures redirect on a localhost ephemeral port, stores resulting tokens in keystore, refreshes on expiry. Used for backends with OAuth. |
| `api-key` | Static key in `Authorization: <prefix> <key>` header (custom prefix per backend). Used for Anthropic/OpenAI. |
| `manual` | User pastes a token through the settings UI when prompted. No automatic refresh. Used as a fallback. |

Token rotation is the adapter's job; on `auth.expired` (or 401) the adapter calls vessel's auth subsystem, which either refreshes silently (`oauth-pkce`) or prompts the user (`manual`).

**On uninstall.** Vessel's uninstaller MUST remove all `vessel.*` keystore entries. A "wipe credentials" button in settings does the same without uninstalling.

### 10.5 Privacy and data flow

What leaves the local machine and where it goes:

| Data | Travels to | Trigger | Local retention |
|---|---|---|---|
| Mic audio | STT engine (in-process) | Push-to-talk | Ephemeral (RAM only) unless `retain_audio_seconds > 0` |
| Raw transcript | Cleanup-LLM provider (cloud or local) | Each utterance | Ephemeral unless `retain_transcripts_seconds > 0` |
| Cleaned transcript | Configured backend (per adapter) | Each user turn | Backend-defined; vessel doesn't persist locally |
| Backend response text | TTS engine (Edge TTS = MS cloud, Piper = local) | Each sentence | Voice cache: hashed text → cached WAV, capped at 100MB, LRU eviction |
| Phoneme timing | Local rhubarb subprocess | Each sentence | Cached alongside voice WAV |
| UI manifests | Vessel runtime | Backend push | Active manifest only, unless `display.persistent` capability granted (then disk-cached) |
| Permission decisions | Vessel local store | First capability prompt | Persistent until user revokes |

Privacy-relevant defaults:
- **No telemetry by default** (§20.2). Opt-in only.
- **No transcript persistence by default.** Cleanup-LLM call is the only outbound trip with raw user audio's transcription, and it's against the configured cleanup provider — Claude API by default, local model if user prefers.
- **Voice cache is local-only.** Edge TTS cloud sees the *response text* (not the user's mic input) and the requested voice ID; the resulting WAV is cached locally only.
- Vessel never sends mic audio to a backend. STT happens locally; only text reaches the configured ChatSource backend. (Backends may route to cloud LLMs; that's the user's backend choice, not vessel's.)

### 10.6 Cross-platform global hotkeys

Push-to-talk and stop hotkeys are registered globally. Conventions and concerns per platform:

| Platform | API | Conflicts to watch |
|---|---|---|
| Windows | `RegisterHotKey` (Win32) | `Ctrl+Space` collides with some IMEs and Visual Studio; default is `Ctrl+Alt+Space`. |
| macOS | `RegisterEventHotKey` (Carbon) — requires Accessibility permission; vessel prompts on first launch. | `Ctrl+Space` is Spotlight on default Mac config; default is `Ctrl+Alt+Space`. |
| Linux | Wayland: `wlr-foreign-toplevel` + compositor hotkey extensions (varies). X11: `XGrabKey`. Wayland support is uneven. | Compositor-dependent; vessel falls back to "click to record" if no global hotkey API is available. |

Settings UI surfaces the active hotkey + a "test" button. If a hotkey is in use, vessel detects on registration failure and prompts re-bind.

A hotkey is *not* a substitute for a UI button: vessel always surfaces a click-to-record button on the avatar overlay for users who can't or don't want to use hotkeys.

### 10.7 Updates

Vessel ships an auto-updater. Channels:

- **Stable** — public releases. Default for end users.
- **Beta** — opt-in pre-releases. Surfaced in settings.

Mechanism:
- Shell checks for updates on launch + every 24h while running (when `updates.auto_check: true`).
- If a new version is available, shell shows a non-blocking notification ("Update available — click to install").
- Install requires explicit user confirmation by default (`updates.auto_install: false`). Auto-install is opt-in for users who want it.
- Update bundles are signed; signature verification fails the install (no override).
- Update channel signing keys are bundled in the binary at build time; key rotation requires a new build (channel hijack defence).

The engine container is updated as part of the same bundle. There is no out-of-band engine update (avoids drift between shell and engine).

Vocabulary updates (§5.1, vocabulary spec) ride along with vessel updates — the vocabulary registry is shipped with the binary, not downloaded at runtime. Aspects targeting a newer vocabulary on an older vessel see unknown components ignored (§2 design principle 6).

## 11. Build plan

**v0.2 phase order: chains-first.** Build the input and output chains as headless CLIs before the UI shell. Run a parallel Tauri/VRM render-proof spike to de-risk the only piece that can't be done headless (transparent overlay on macOS/Linux). Integrate at the end.

Rationale: chains are where the *unknowns* live (STT quality, TTS+lipsync timing, ChatSource adapter shape, end-to-end latency); the UI shell is where the *certainties* live (Tauri, Three.js, VRM are well-understood). The original v0.1 phase order built certainties first, which is backwards from a risk-management perspective. Each chain CLI also produces a usable artifact independently — the input chain is shippable as a standalone voice-to-text tool if vessel never went further.

### Phase 0 — Architecture spikes (decision unblockers)

**Goal:** Resolve open decisions. Throwaway code; outputs are decisions, not artifacts.

**Scope note.** Neither Phase 0 spike gates beta development. Beta builds run engine + shell as ordinary local-dev processes; the chains and SDK can be built and validated end-to-end without resolving either spike. Spike 0.1 informs *release-time distribution packaging*; Spike 0.2 informs *platform support* for the transparent overlay. Both can run in parallel with Phases 1–3.

**Spike 0.1 — Release distribution packaging (OCI viability).** Tests whether OCI/Docker is a viable *release distribution* shape for the engine on Win/Mac/Linux. This is not a question about whether the engine and shell are separate processes (they are, in any packaging) — it is a question about whether end users can run a Dockerised engine without unacceptable audio friction.

- Build a minimal engine image (Alpine + a Rust binary that captures mic and plays speakers).
- Test mic capture across the container boundary: Linux (PulseAudio/PipeWire socket mount), macOS (Docker Desktop — known to be problematic), Windows (Docker Desktop with WSL2 backend, also problematic).
- Measure: does mic capture work at all? Latency? Sample rate stable?
- Same for speaker playback.
- Decision criterion: if Mac or Windows mic capture fails or has >100ms latency or requires user-side daemon installation, OCI is out as a primary release shape and the self-contained sidecar bundle (§21.1) is the release default. OCI may still ship as a secondary path for self-hosted / advanced users.
- **Not a beta gate.** Beta runs the engine as a local subprocess regardless of this spike's outcome.

**Spike 0.2 — Tauri v2 transparent always-on-top on macOS and Linux.** Confirm the v0.1 §14.1 open question:

- Build a minimal Tauri v2 app with a transparent always-on-top window rendering Three.js + a CC0 VRM.
- Test on macOS (latest, both x86_64 and arm64), Linux (Ubuntu 24.04+ Wayland, Ubuntu 24.04+ X11, Fedora KDE).
- Look for: opacity bugs, click-through issues, focus-stealing, multi-monitor edge cases, full-screen exclusive issues.
- Decision criterion: if a target platform has unfixable issues, decide between platform-drop, alternative shell (Electron fallback for that platform), or workaround (e.g. non-transparent window, click-through-only-on-avatar-pixels).

**Acceptance:** Both spikes have a written outcome (one-page each, committed to repo) before Phase 1 begins. If Spike 0.1 forces sidecar bundle, the engine packaging design (§21) is updated. If Spike 0.2 forces a platform drop, the spec is amended.

### Phase 1 — Input chain CLI

**Goal:** Audio in, ready-to-send text out. No UI.

**Deliverables:**
- Push-to-talk binding (cross-platform global hotkey).
- WAV capture from key-press to key-release.
- `whisper.cpp` invocation via `whisper-rs`. Pluggable behind an `STTEngine` trait — Phase 6+ allows swapping in WhisperKit (macOS) or ONNX+DirectML (Win) accelerators.
- Cleanup-LLM pass (Claude Haiku or local small model). Removes filler words, inserts punctuation, fixes whisper homophone errors. Preserves intent (does NOT rewrite — see §15).
- CLI: `vessel-stt --hold-key=<key>` reads mic and emits cleaned text on stdout per utterance.

**Acceptance:** Hold key, speak, release → cleaned text appears on stdout within latency budget. Calibration test: same audio sample through Glaido and through this CLI; quality in the same league.

### Phase 2 — Output chain CLI

**Goal:** Text in, audio + phoneme timing out. No UI.

**Deliverables:**
- Edge TTS Node-side WebSocket client (token-rotation behaviour validated against Python `edge-tts` reference at spike time).
- Piper subprocess fallback.
- Rhubarb-lip-sync subprocess invocation, parses phoneme timing JSON.
- Phoneme → VRM blendshape mapping table (initial — refine at integration).
- CLI: `vessel-tts --voice=<id>` reads text on stdin, produces WAV file + phoneme timing JSON. Plays audio if `--play`.

**Acceptance:** Pipe text in, audio plays in selected voice. End-to-end latency (text-in to audio-out) measured and within budget. Phoneme JSON loads cleanly.

### Phase 3 — Glue: ChatSource SDK + reference Nexus adapter (CLI)

**Goal:** Full conversation, text-only. Validates SDK shape under real backend pressure.

**Deliverables:**
- `@nexus-cw/vessel-sdk` package — `ChatSource` interface, types (§5), including v0.2 `BackendEvent` UI extensions and `UIManifest` skeleton.
- `NexusAdapter` — WebSocket connection, bearer auth, push subscription, `send()` for outbound chat + UI events.
- CLI: `vessel-chat` chains Phase 1 and Phase 2 with `NexusAdapter` — speak, see backend response, hear it spoken. No UI.
- Wire in `turn.begin` / `turn.end` and `turn_id` plumbing.

**Acceptance:** Speak → adapter delivers to recipient → response streams back → audio plays. Multiple recipients work. UI manifest emission can be triggered by a test fixture and is logged (not yet rendered).

### Phase 4 — Tauri/VRM render-proof spike (parallel to 1–3)

**Goal:** Confirm transparent always-on-top window + VRM render works on macOS and Linux (open question §14.1). Throwaway-quality.

**Deliverables:**
- Tauri v2 minimal shell with transparent always-on-top.
- Three.js + `@pixiv/three-vrm` loading a CC0 VRM in the window.
- Smoke test on Win, Mac, Linux.

**Acceptance:** Window renders model with no opaque background on all three platforms. If a platform fails, document and decide (drop platform support, alternative shell, or workaround) before Phase 5.

### Phase 5 — Integrate: chains into container, default avatar UI in shell

**Goal:** Full v1 experience. Chains move into the container; the avatar default UI manifest renders in the Tauri shell driven by phoneme timing from Phase 2.

**Deliverables:**
- Container packaging (per §14 #6 outcome — OCI or self-contained bundle).
- Default `avatar` UI manifest implementation in the manifest renderer (Three.js + portrait sidebar + speech queue + attention indicator).
- Per-recipient config (§10) loaded into the container.
- Speech queue (§6) wiring.
- Attention manager (§9).
- Mic-active queue pause; stale message drop; queue cap; stop hotkey.
- Idle animations on active VRM (breath, blink); avatar swap with crossfade.

**Acceptance:** Full §11 v0.1 acceptance criteria across phases 3–5 of the original plan, now driven by integrated chains. Multi-recipient queue works; user interruption works; attention call shows portrait pulse.

### Phase 6+ (post-v1)

- **Two-VRM slots.** Live-render second avatar for richer attention/queue visual.
- **Full ensemble (N VRMs).** Panel view, all recipients on screen.
- **Spatial audio.** Voice pans with avatar position.
- **Voice activity detection.** Hands-free always-listening mode.
- **OpenAIAdapter, AnthropicAdapter integration testing rounds.**
- **Per-recipient commissioned VRMs.** Replace placeholders with custom art.
- **Per-platform STT accelerators.** WhisperKit on macOS via Tauri sidecar; ONNX+DirectML on Windows.
- **Bundled harness UIs.** Pre-tuned default manifests for Claude Code, Cursor, etc. — drop-in voice+presence for tools people already use.
- **Public commercial release.** SDK release licence, distribution, install runbook, cross-platform binary builds.

---

### Legacy v0.1 phase descriptions (superseded — kept for reference)

The original v0.1 plan ordered phases as: Tauri shell + VRM render → ChatSource SDK + adapter → TTS + lip sync → per-recipient config + avatar swap → speech queue + attention + STT. v0.2 reorders to chains-first. The acceptance criteria from the original phases are absorbed into the new Phase 3 and Phase 5. Original text below for traceability.

#### v0.1 Phase 1 — Tauri shell + VRM render proof

**Goal:** Validate transparent always-on-top window + VRM model loads + renders.

**Deliverables:**
- Repo scaffold (Tauri v2: `tauri.conf.json`, `src-tauri/`, `src/`).
- `src/main.tsx` — Preact entry, mounts Three.js canvas.
- `src/avatar/Avatar.tsx` — VRM loader using `@pixiv/three-vrm`.
- Hardcoded test VRM (CC0 sample model).
- Transparent always-on-top window enabled via Tauri v2 plugins.

**Acceptance:** App launches, renders model in transparent always-on-top window. Model visible, oriented correctly.

#### v0.1 Phase 2 — ChatSource SDK + reference Nexus adapter

**Goal:** SDK shape + first adapter end-to-end. Vessel can talk to a backend, see responses come back.

**Deliverables:**
- `@nexus-cw/vessel-sdk` package — `ChatSource` interface, types (§5).
- `src/adapters/NexusAdapter.ts` — implements `ChatSource`, connects via WebSocket, handles auth handshake, subscribes to messages, sends via REST.
- Test page with text input + response display. Validates the Vessel-meets-backend seam.

**Phase order rationale:** Doing comms before TTS surfaces the highest-risk integration first. Phase 3 TTS gets driven by real backend reply text, not hardcoded strings.

**Acceptance:** Type a message in Vessel test page → backend delivers to recipient → recipient's response renders as text in Vessel.

#### v0.1 Phase 3 — TTS + lip sync

**Goal:** Avatar speaks responses with mouth movement.

**Deliverables:**
- `src/tts/EdgeTTS.ts` — Node-side websocket client to MS Cognitive Services Edge TTS. Auth-token-rotation behaviour validated against the Python `edge-tts` reference at spike time.
- `src/tts/Piper.ts` — local Piper subprocess fallback.
- `src/lipsync/Rhubarb.ts` — rhubarb-lip-sync subprocess invocation, parses phoneme timing.
- Phoneme → VRM blendshape mapping (starting table, refine at spike):

| Rhubarb | VRM shape |
|---------|-----------|
| A | `aa` |
| B | `aa` at 0.1 |
| C | `ih` |
| D | `aa` |
| E | `oh` at 0.5 |
| F | `ou` |
| G | `ih` at 0.3 |
| H | `aa` at 0.7 |
| X | all at 0 |

- Timeline driver — synchronizes audio playback with blendshape interpolation.

**Acceptance:** Pipe text to TTS, audio plays in selected voice, avatar mouth syncs. Switch between 2-3 Edge TTS voices works.

#### v0.1 Phase 4 — Per-recipient config + avatar swap + idle animations + portrait sidebar

**Goal:** Multiple recipients, each with VRM + voice. Active VRM in main slot, static portraits in sidebar. Idle animations make active avatar feel alive.

**Deliverables:**
- `vessel.config.yaml` loader + schema validation.
- `src/avatar/RecipientAvatars.ts` — preload VRMs, swap active model on recipient change with crossfade.
- Voice config — per-recipient TTS voice ID.
- `src/avatar/PortraitSidebar.tsx` — static portrait row/sidebar UI, CSS animation hooks for attention indicator.
- `src/avatar/PortraitGen.ts` — auto-generate portrait PNG from VRM at first run (fixed lighting). Cache.
- Idle animations: subtle breathing, blink loop on active VRM.
- Avatar swap with crossfade between recipients (~200-300ms).

**Portrait lighting (fixed values):** Three-point setup. Key light at 45° upper-left, intensity 1.0, warm white `#FFF5E0`. Fill at 135° upper-right, intensity 0.4, neutral `#FFFFFF`. Back at 180° lower-back, intensity 0.6, cool `#E0F0FF`. Standard portrait photography lighting; works across VRM skin tones.

**Acceptance:** Address different recipients, different avatars appear with different voices. Active avatar idles (breath, blink). Queued recipients show as portraits in sidebar. Avatar swap is smooth.

#### v0.1 Phase 5 — Speech queue + attention model + STT mic input

**Goal:** Multi-message orchestration + voice input.

**Deliverables:**
- `src/queue/SpeechQueue.ts` — FIFO queue, FIFO with user-interrupt, stale-drop, cap. Stop hotkey integration.
- `src/attention/AttentionManager.ts` — handles `BackendEvent` of type `attention`, drives portrait sidebar CSS state, distinguishes normal vs critical.
- `src/stt/Whisper.ts` — Tauri command bridge to `whisper-rs` in Rust backend. Push-to-talk hotkey.
- Mic-active queue pause (per §6.3).
- "Thinking" expression while waiting for backend response.
- Offline-recipient fallback: configured `offline_message` template spoken if recipient doesn't reply within 30s (configurable).

**Acceptance:** Hold push-to-talk, speak, release → transcribed → routed → response queued → speaks. Multiple recipients respond → queue plays in order. User interruption works. Recipient attention call shows portrait pulse; addressing the calling recipient engages their queued message.

#### v0.1 Phase 6+ (post-v1)

(Superseded by v0.2 Phase 6+ above; original list retained: two-VRM slots, full ensemble, spatial audio, VAD, adapter testing rounds, commissioned VRMs, public commercial release.)

## 12. STT pipeline

**Two stages: STT engine + cleanup-LLM pass.** The cleanup pass is the felt-quality moat.

**Stage 1 — STT engine.** `whisper-rs` (binding to whisper.cpp) is the cross-platform default. Exposed behind an `STTEngine` trait so per-platform accelerators (WhisperKit on macOS via Tauri sidecar, ONNX+DirectML on Windows) can drop in as Phase 6+ optimisations. Cross-platform-as-default is a hard product constraint; Apple-Silicon-only paths are not viable as the primary engine.

Push-to-talk batches a complete WAV. Record from key-press to key-release into a single buffer, transcribe in one call on release. No streaming adapter needed at v1. VAD-driven hands-free mode (always-listening) does need streaming chunking — deferred to Phase 6+.

Model: `base.en` at v1 (~140MB, real-time-capable on modern CPUs). Configurable to larger models for accuracy tradeoff.

**Stage 2 — cleanup-LLM pass.** Raw Whisper transcripts are accurate but messy: filler words ("um", "uh"), missing punctuation, occasional homophone errors. A small LLM call (Claude Haiku, or a local small model like Llama 3.x small / Phi-mini for offline use) cleans the transcript while preserving intent. Prompt: "Clean this dictated text for sending. Preserve the user's intent and tone exactly. Fix punctuation, remove filler words, fix obvious whisper transcription errors. Do not rewrite, summarise, or change meaning." Output replaces the raw transcript before it reaches the ChatSource adapter.

This is the differentiator vs. tools like Glaido — Glaido's moat is the cleanup pass, not the underlying STT. Vessel matches by doing the same.

**Cleanup is allowed under §15.** Removing filler words and inserting punctuation preserves the user's intent — the resulting message is still "what the user said" in any reasonable sense. The §15 non-goal "Modifying recipient behavior or prompt context" forbids vessel adding system prompts, persona instructions, or surrounding context — *not* basic transcription cleanup. See §15 for the precise distinction.

## 13. TTS pipeline

Vessel supports **three TTS engines** spanning a cloud-quality / local-quality / local-basic spectrum. Per-deployment, one is `engine` (primary) and one is `fallback_engine`; the selection logic in §13.1 governs runtime choice.

**Edge TTS (cloud).** MS Cognitive Services Edge TTS is free, fast, ~30+ English voices with personality variation, via a Node websocket reimplementation from the Python `edge-tts` library reference (~200 LOC). Token-rotation behaviour (Python `edge-tts` refreshes tokens per-session) is an assumption to validate at spike time. **Highest voice variety, but a commercial-licensing grey area** (§13.2) and requires network.

**Kokoro-82M (local, high-quality).** Open-weight 82M-parameter TTS model (~300MB), **Apache-2.0** licensed. Topped the TTS Arena leaderboard in Jan 2026, ahead of XTTS-v2, at a fraction of the size. Runs **faster than real-time even on CPU** (well above real-time on any GPU), so it comfortably fits the §18 per-sentence TTS budget on both the high-end (RTX-class) and modest (laptop CPU / Apple Silicon) targets. Ships as **ONNX** and runs inside the engine via the `ort` (onnxruntime) crate — **no Python runtime dependency**, honouring §3 lock #1 (the Python `kokoro` reference impl is *not* used at runtime). Preset named voices only (no cloning); curated into the §13.3 catalog. This is the recommended **local default for commercial builds** — it gives near-Edge-TTS quality with a clean licence (§13.2).

**Piper (local, basic).** Lightweight local TTS, no internet dependency, smallest footprint. Lower quality than Kokoro or Edge TTS but extremely cheap and battle-tested. Retained as the **minimal offline fallback** and for the most constrained hardware. Runs as engine subprocess.

Per-recipient voice = config field. Voice IDs are drawn from the configured engine's catalogue (e.g. `en-GB-RyanNeural` / `en-US-DavisNeural` for Edge TTS; Kokoro's named voices such as `af_*` / `am_*` / `bf_*` / `bm_*`); users map per recipient to fit personality. Vessel's curated catalog (§13.3) maps a friendly display name onto the right per-engine ID so switching engines doesn't strand recipient config.

### 13.1 TTS engine selection logic

Decision tree, executed per sentence. The configured `engine` is the primary and `fallback_engine` is the backstop; the rules degrade from cloud → local-high-quality → local-basic:

1. If the primary engine is `edge-tts` and the user is **offline or Edge TTS is unreachable** → use the configured `fallback_engine` (Kokoro if configured, else Piper) for *this sentence only* (don't poison subsequent sentences); log the fallback for telemetry / status indicator.
2. If the primary engine is configured and available → use it (Edge TTS / Kokoro / Piper as configured).
3. If the primary engine errors or rate-limits → fall back to `fallback_engine` for *this sentence only*; log the fallback.
4. If the fallback is **also** unavailable (model file missing, subprocess crash, ONNX load failure) → engine emits a `tts.unavailable` IPC frame; shell renders text-only response with a "voice unavailable" indicator.

Because Kokoro is local and faster-than-real-time, an all-local deployment (`engine: kokoro`, `fallback_engine: piper`) has **no network dependency and no licensing exposure** while still delivering high-quality voice — the recommended posture for commercial builds (§13.2).

Voice cache is keyed by `(text, voice_id, engine_version)`. Synthesised responses are cached locally so repeated phrases (e.g. recipients' greetings) play instantly without re-synthesis. LRU eviction at 100MB.

### 13.2 Edge TTS licensing concerns

Edge TTS is a free Microsoft service. Microsoft's terms restrict commercial use to within Edge browser; using the service from a non-Edge client (which is what we'd be doing) is a grey area. Implications:

- **For personal / individual users:** low risk. The Python `edge-tts` library has been used widely for years without enforcement.
- **For commercial distribution of vessel:** higher risk. If vessel ships as a paid product or generates voiced content for downstream commercial use, Microsoft could change terms or revoke access.
- **Mitigation paths:**
  - **Make Kokoro-82M the default engine for commercial builds** and Edge TTS an enthusiast-tier, opt-in option. Kokoro is Apache-2.0 (clean for commercial distribution), local (no per-request terms to violate), and near-Edge-TTS quality — so this mitigation costs little perceptual quality, unlike falling back to Piper. This is the leading resolution to open question #11.
  - Make Edge TTS opt-in with a clear license-acknowledgement gate at first-use.
  - Add a paid alternative TTS provider option (ElevenLabs, Cartesia, Azure Cognitive Speech with proper licensing) for users who want cloud voices with explicit commercial terms.
  - Piper remains available as the minimal/most-constrained-hardware fallback, but is no longer the *only* clean-licensed local option.

This is an open product/legal question, not just a technical one, but Kokoro substantially de-risks it. See §14 open question #11.

### 13.3 Voice catalog management

Vessel ships with a curated default voice list (10–15 voices spanning accent / pitch / personality), each tagged with its per-engine upstream voice ID(s) and a vessel-friendly display name ("Warm British Female", "Calm American Male"). Where a display name has a close match across engines (e.g. an Edge TTS voice and a Kokoro voice of similar character), the catalog entry records both IDs so a recipient's chosen voice survives an engine switch. Users can override with any Edge TTS, Kokoro, or Piper voice ID via settings.

Voice catalog updates ride along with vessel version updates (§10.7) — the catalog is bundled, not fetched at runtime.

## 14. Open questions

These need resolution before the corresponding phase starts.

1. **Tauri v2 transparent always-on-top edge cases.** Verified working on Windows; need to confirm macOS and Linux at Phase 0 Spike 0.2.
2. **Edge TTS token rotation (assumption vs confirmed).** Validate at v0.2 Phase 2 spike by reading `edge-tts` Python source or testing live.
3. ~~`whisper-rs` audio chunking.~~ **Resolved:** Push-to-talk batches a complete WAV on key-release; no streaming adapter needed at v1.
4. **Voice perceptual confirmation.** The configured voices for each recipient should be heard during v0.2 Phase 2 and confirmed before being baked into config defaults.
5. ~~Default VRM portrait lighting.~~ **Resolved:** Three-point setup specified in §11 Phase 5 (was v0.1 Phase 4).
6. **Release distribution packaging — OCI vs self-contained bundle.** *Release packaging only* — not a question about the engine/shell process split, which is locked (§3 #4). Audio device passthrough on Win/Mac Docker is the deciding constraint. Phase 0 Spike 0.1 resolves this; beta development proceeds on a local-process engine in parallel and is unaffected by the outcome.
7. **UI manifest vocabulary package — `@nexus-cw/vessel-sdk` or `@nexus-cw/vessel-ui-vocab`?** Couples to SDK lifecycle vs independent versioning. Resolution before Phase 3 ships UI emission.
8. **Manifest capability gating UX — first-render approval flow.** Per-aspect sticky approvals (passkey-style)? Per-session like browser permissions? Hybrid? Resolution before Phase 5 wires manifest rendering.
9. **Cleanup-LLM provider when offline.** Claude Haiku requires net. Local fallback model (Llama 3.x small / Phi-mini) feasibility — does the quality bar hold without the cloud LLM? Resolution during Phase 1.
10. **Glaido cleanup-pass benchmark target.** What concrete latency / quality bar does vessel commit to before Phase 5 ships? Calibrated during Phase 1 acceptance.
11. **Edge TTS licensing for commercial distribution.** §13.2 — open product/legal question. Resolution before any paid release; not blocking dev. **Leading resolution (v0.2.1):** ship **Kokoro-82M** (Apache-2.0, local, high-quality) as the commercial-build default engine and make Edge TTS an opt-in enthusiast option; this removes the licensing exposure without the quality cliff of falling back to Piper. Remaining sub-question: confirm Kokoro voice quality clears the §13.3 catalog bar on the target hardware during Phase 2.
12. **VRM model sourcing pipeline for v1 release.** Bundled CC0 placeholders are fine for development; what does the production v1 ship with? Commission a small set of vessel-branded VRMs? Curate community CC-BY models? Allow users to bring their own only? See §17 for sourcing concerns.
13. **Manifest panel window management.** v1 spec says "one panel per manifest." What about overlap, z-order, focus stealing, multi-monitor placement? Phase 5 implementation question.
14. **Wayland global hotkey support.** §10.6 — Wayland support is uneven; some compositors expose hotkey APIs, others don't. Decision: declare X11-only on Linux for v1, or invest in compositor-specific support? Resolution before Linux ships.
15. **Multi-launch behaviour.** What happens if the user launches vessel a second time while an instance is running? Single-instance lock + raise existing window, or allow multiple? Single-instance is the convention; need explicit decision.
16. **Container update independent of shell.** §10.7 says updates are bundled. But if the engine container is OCI, separate-update is cheap. Worth making the engine independently updatable for hotfixes? Decision: no for v1 (drift risk), revisit post-v1.
17. **Telemetry scope and consent.** §20.2 sketches opt-in telemetry. What specific events? What aggregation? Privacy policy required before any telemetry ships.
18. **Manifest rate-limiting policy.** Default rate limits in vocabulary spec are placeholders. What's the actual right number? Tune in Phase 5 with real backends.
19. **Recipient name detector grammar.** §4.2 step 6 names "<recipient>:", "hey <recipient>", "<recipient>,". Edge cases: punctuation in recipient names, fuzzy matching (typos), homophones across recipients ("Mark" vs "Marc"). Resolution during Phase 1 implementation.
20. **STT model auto-download flow.** First-run downloads a ~140MB whisper model. Where from? CDN? GitHub release? User experience during the wait? Resolution during Phase 1 packaging.

## 15. Non-goals

- **Multi-tenant deployment.** Vessel binary is single-user. Multi-user is a downstream consumer concern.
- **VR / 3D world.** Avatar lives in desktop overlay, not immersive environment.
- **Video input / facial tracking.** No webcam, no user-face-mirroring.
- **Cross-recipient simultaneous voice.** Speech queue is strictly single-voice. Multi-voice harmony not a goal.
- **Recipient-initiated UI control.** Recipients can request attention; they cannot move windows, resize, or change config. The user owns app state.
- **Custom animation rigs.** Standard VRM blendshapes + bones only at v1.
- **Mobile.** v1 is desktop only (Win/Mac/Linux). A mobile companion app is a possible Phase 6+ stretch but not v1.
- **Multi-instance on the same machine.** Single-instance lock at v1 (§14 #15). Second launch raises the existing window.
- **Webcam-driven avatar (face-mocap).** Avatar expressions are TTS-driven and idle-driven only. No camera input.
- **Avatar marketplace / store.** Vessel does not host, sell, or rate VRM models. Users bring their own; the bundled CC0 placeholders ship for development only.
- **Backends without programmatic access.** Vessel adapts backends that expose a real API (HTTP/WS/SDK). It does not adapt CLI-only or TUI-only tools via PTY scraping. (§5.5 explicitly: backends without push lose flagship features but stay usable; backends without any API at all are out of scope.)
- **Modifying recipient behavior or prompt context.** Vessel is a pure presentation client. It never injects system prompts, persona instructions, or surrounding context into what the recipient receives. Trust model stays clean: vessel can be swapped for any other client and recipient behavior is unchanged.

  **Distinction (v0.2 clarification):** transcription cleanup of the user's spoken input — removing filler words ("um", "uh"), inserting punctuation, fixing obvious whisper homophone errors — is **allowed** and is part of the §12 STT pipeline. The user's intent is preserved; the resulting message is "what the user said" in any reasonable sense. What is **forbidden** is rewriting the message to change meaning, injecting persona/system context, or summarising. The line is intent-preservation: cleanup yes, rewriting no.

## 16. Glossary

- **Active speaker** — the recipient currently speaking; rendered as the active VRM, voice playing.
- **Attention call** — message with `kind: "attention"` (Nexus context) or `BackendEvent` of type `attention` (any adapter context). Drives portrait sidebar CSS state.
- **Backend** — the LLM source: Nexus broker, OpenAI, Anthropic, or community-adapted source.
- **Capability** (UI manifest context) — a declared, gated permission a manifest requests (mic, file picker, clipboard, etc.). See vocabulary spec §5.
- **ChatSource** — the SDK interface adapters implement.
- **Cleanup-LLM pass** — §12 Stage 2; the LLM call that turns raw whisper output into ready-to-send text without changing intent.
- **Default UI** — a vessel-bundled UI manifest (avatar-default, chat-default, harness-tuned). See vocabulary spec §9.
- **Engine** — the container hosting services + SDK runtime + manifest renderer. The non-shell process.
- **Manifest** (UI) — a JSON document describing a UI tree, declared capabilities, and metadata. Authored by a backend; rendered by vessel.
- **Recipient** — an addressable identity in the backend.
- **Shell** — the thin Tauri v2 process hosting windows + OS integration. The non-engine process.
- **Speech queue** — the FIFO of pending speech-tuples. User-interrupts, stale-drops, capped.
- **Surface** — a place vessel renders manifests: avatar surface, manifest panel, sidebar.
- **Vessel SDK** — `@nexus-cw/vessel-sdk` npm package, `ChatSource` interface + types.
- **Vocabulary** — the set of named component types vessel's renderer recognises (UI manifest context).

## 17. VRM model sourcing and licensing

VRM models are user-bring-your-own at v1. Sources and considerations:

- **Bundled CC0 placeholders** — vessel ships 2-3 CC0-licensed VRMs (sourced from VRoid Hub or similar) for development and "I just installed it" first-run experience. These are placeholders, not commitments.
- **VRoid Hub** — large catalog with per-model licenses; vessel does not redistribute these but provides docs on importing.
- **Commissioned models** — vessel's own brand identity (Forge, Maren, etc. for the nexus team's deployment) requires custom commissions for production identity. Not part of v1 vessel; downstream consumer concern.
- **User-uploaded** — users drop a `.vrm` file in `~/vessel/models/` (or via settings UI), referenced by recipient config. Validation: vessel checks the file is a valid VRM (header magic + spec compliance) but does not inspect the model's license — that's the user's responsibility.

**Vessel does not curate, host, or distribute VRM models beyond the bundled placeholders.** §15 non-goal "Avatar marketplace / store." The product is a renderer; the asset pipeline is upstream.

## 18. Performance budgets

Targets, not commitments. Measured during Phase 5 acceptance and tracked in regression tests.

| Path | Target | Rationale |
|---|---|---|
| End-to-end voice latency (mic release → first audio frame) | < 1500ms p50, < 3000ms p95 | Sub-2s feels conversational. Glaido baseline is ~600-1200ms for transcription alone; we have STT + cleanup-LLM + backend round-trip + TTS + lipsync to fit in. |
| STT (whisper-cpp `base.en`, 5s utterance, modern CPU) | < 500ms | Per Whisper benchmarks. |
| Cleanup-LLM pass (Claude Haiku) | < 800ms | API latency dominated. Local model would be ~200-400ms. |
| Backend round-trip | budget 0 — depends on backend | Vessel doesn't control this; just reports it for telemetry. |
| TTS (Edge TTS, 1 sentence) | < 600ms | Cloud round-trip; cached responses are instant. |
| TTS (Kokoro, 1 sentence) | < 400ms | Local, faster-than-real-time on CPU; well under budget on any GPU. No network jitter. |
| Rhubarb-lip-sync (1 sentence, ~5s of audio) | < 300ms | Per-sentence; runs in parallel with TTS-next-sentence. |
| Idle CPU | < 5% one core | App should not impact battery. |
| Idle RAM (engine + shell + active VRM) | < 600MB | VRM + Three.js is ~150-200MB; whisper model ~200MB; engine overhead ~150MB. |
| Voice cache size | 100MB cap with LRU | §13.1. |
| App launch (cold start) | < 4s to first paint, < 8s to ready | Includes engine container start. |

If a target is missed in Phase 5, decide: (a) fix, (b) accept and update target, (c) ship-and-tune. Tracked per-platform; Mac performance with whisper.cpp may exceed budgets and require WhisperKit sidecar earlier than planned.

## 19. Accessibility

Accessibility is not a Phase 6+ feature; the design respects it from v1.

**Inputs:**
- All actions accessible via hotkey (push-to-talk, stop, settings) AND on-screen click affordance — no hotkey-only paths.
- Click-to-record button always visible on the avatar overlay; users without hotkey access can still record.
- Settings UI is keyboard-navigable (Tab, Enter, Esc).
- Manifest renderer respects platform focus rings, ARIA labels on inputs, semantic headings.

**Outputs:**
- Voice is the primary output channel; vessel deliberately requires audio for full experience.
- **Captioning fallback:** when "show captions" is enabled (settings), the active speaker's text is rendered alongside audio in a high-contrast caption strip below the avatar. Required for users who can't use voice and recommended-default for first-run onboarding.
- **Visual-only mode** (settings): TTS disabled entirely; responses render in caption strip. Vessel becomes a voice-input-only chat client. Useful in quiet environments and for hearing-impaired users.
- High-contrast theme available for the manifest renderer (settings).
- Avatar swap and attention pulse animations respect `prefers-reduced-motion` (settings + OS-level signal).

**Vessel never relies solely on voice or color** to convey information. Attention calls have both audio (chime, optional) and visual (portrait pulse) channels.

## 20. Operational concerns

### 20.1 Logging

- **Shell logs** — written to platform-standard locations (`~/Library/Logs/vessel/` on Mac, `%LOCALAPPDATA%\vessel\logs\` on Windows, `~/.local/state/vessel/logs/` on Linux). Rolling, ~10MB cap.
- **Engine logs** — same convention but separate files (`engine.log`).
- **Adapter logs** — per-adapter sub-files (`adapter-nexus.log`).
- Log level configurable via env var `VESSEL_LOG=debug|info|warn|error`. Default `info`.
- **Sensitive data redaction:** secrets are never logged. Tokens in adapter requests are replaced with `<redacted>`. Mic audio and transcripts are never logged; cleanup-LLM prompts are logged at `debug` only.
- "Open logs folder" button in settings.

### 20.2 Telemetry

- **Off by default.** Privacy by default; opt-in only.
- If enabled (settings), vessel emits anonymised events to a vessel-team endpoint:
  - App version, platform, install ID (random, rotatable from settings)
  - Aggregated performance metrics (latency p50/p95 per pipeline stage)
  - Crash counts (no stack traces unless crash reports also enabled)
  - Feature usage flags (which adapters configured, push-vs-no-push)
- **Never sent:** message content, transcripts, audio, recipient identities, voice IDs (only voice provider class), capability decisions, file picker contents, any field a backend sees.
- A "preview telemetry payload" button shows the user exactly what would be sent.
- See §14 #17 — full schema design pending.

### 20.3 Crash reports

- Separate from telemetry, separate consent.
- Three settings: `always` (silent send), `never`, `ask` (default — prompt on each crash with payload preview).
- Payload: stack trace, vessel version, platform, last 100 log lines (sensitive-data-redacted), no user content.

### 20.4 Status indicators

The shell exposes a small status surface (system tray icon + click-through to a status panel) showing:
- Backend connection status (connected, reconnecting, error).
- STT engine status (ready, downloading model, error).
- TTS engine status (Edge TTS reachable, Piper available, current fallback).
- Active manifests (count + list, each clickable to focus).
- Permissions overview (one-click revocation).

This surface is the operator's ground-truth for "what's vessel doing." No mystery states.

## 21. Release distribution packaging detail

**Scope.** This section covers *release-time distribution packaging* of the engine — how the binaries reach end users. It does **not** describe the engine/shell process model (that's §4) and it does **not** apply to beta builds, which run the engine as a normal local-dev subprocess. Phase 0 Spike 0.1 selects between the two release-distribution forms below.

Two candidate release forms (Phase 0 Spike 0.1 decides):

### 21.1 Self-contained sidecar bundle (likely default)

- The "container" is conceptually a self-contained directory: a `vessel-engine` binary, supporting native libraries (whisper.cpp shared lib, rhubarb binary, optional Piper binary), and bundled assets (default voice models, default VRMs, default manifests).
- Shipped inside the Tauri app bundle (`/Resources/engine/` on Mac, alongside `vessel.exe` on Windows, in `/usr/lib/vessel/engine/` for Linux deb/rpm or `/opt/vessel/engine/` for AppImage).
- Engine launched as a subprocess by the shell; IPC over UDS / named pipe (§4.6).
- Pros: no Docker dependency, single-installer UX, audio I/O is straightforward.
- Cons: harder to ship platform-specific accelerators independently; binary size larger.

### 21.2 OCI image (alternative)

- Engine packaged as an OCI image, run via Docker / Podman / containerd on the user's machine.
- Shell uses Docker socket (or equivalent) to start/stop the engine.
- Audio I/O passed through (PulseAudio socket on Linux; problematic on Mac/Win — see Spike 0.1).
- Pros: independently updatable, isolation guarantees, familiar packaging for ops-heavy users.
- Cons: requires Docker on the user's machine (heavy install on Mac/Win), audio passthrough may be intractable, networking config friction.

**Default plan: §21.1 unless Spike 0.1 finds it broken.** OCI is a possible Phase 6+ deployment option for self-hosted / advanced users.

### 21.3 What's *inside* the engine bundle

- `vessel-engine` — main binary (Rust, statically-linked where possible).
- `whisper-cpp` shared library + `base.en` model file (downloaded on first run if missing, ~140MB).
- `rhubarb` binary (per-platform; ~20MB).
- Kokoro-82M ONNX model + voice pack (~300MB) for local high-quality TTS, run via the `ort` (onnxruntime) crate — no separate binary or Python. Candidate for first-run download rather than bundling if total size matters.
- `piper` binary + 1-2 default Piper voice models (~50MB total) for minimal/offline TTS fallback.
- `vocab-registry.json` — UI manifest vocabulary, version-stamped.
- `voices.json` — TTS voice catalog.
- `default-manifests/` — bundled UIs (avatar-default, chat-default).
- `assets/` — bundled CC0 VRMs, default portraits, idle animation rigs.

Total bundle size estimate: ~700-800MB with the Kokoro model included (~400-500MB without it). Larger than ideal; the model files (Whisper `base.en` ~140MB + Kokoro ~300MB) are the obvious split point — ship a lean "core install" and pull STT/TTS models on first run if download size matters for distribution.

## 22. Test strategy

### 22.1 Unit tests

- ChatSource adapter contract tests — each adapter passes the same suite (connect, send, receive, error, reconnect, push-fallback if applicable).
- Speech queue tests — interrupt rules, stale drop, cap behavior, mic-pause.
- Manifest validator tests — vocabulary check, capability resolution, patch op application.
- Cleanup-LLM prompt tests — golden inputs/outputs, intent preservation regressions.
- Hotkey conflict resolution.

### 22.2 Integration tests

- End-to-end voice loop — synthesised audio in (a TTS-generated WAV from a known phrase) → STT → cleanup-LLM (mocked Claude Haiku) → ChatSource (mock backend) → TTS → audio out → assertion on output WAV duration.
- Manifest round-trip — emit a manifest, render in a headless renderer, simulate a click event, assert the `UIEvent` payload.
- Reconnect storm — ChatSource adapter survives 100 random disconnect/reconnect cycles without leaks or duplicate events.

### 22.3 Platform tests

- Per-platform CI: Win11, macOS-latest x86_64, macOS-latest arm64, Ubuntu-LTS, Fedora-current.
- Tauri shell smoke test on each: launches, opens window, captures mic, plays speaker, registers global hotkey, exits cleanly.
- Container/sidecar bundle integrity (file presence, signatures).

### 22.4 Performance regression tests

Phase 5 records p50/p95 latencies for each pipeline stage; CI runs the same harness on each PR and fails if regression exceeds 20%.

### 22.5 Accessibility tests

- Manual: keyboard-only navigation through settings + manifest panels.
- Automated: ARIA-attribute presence on rendered manifests; high-contrast theme color-contrast ratios.

### 22.6 Manifest playground (developer tool)

A "vessel dev mode" runs the engine + a minimal harness that lets developers paste a manifest JSON and see it render. Massively accelerates vocabulary iteration. Phase 1.5 work; not in v1 release but in the repo as a dev tool.

## 23. Build and development workflow

### 23.1 Repo layout

```
vessel/
  shell/              # Tauri v2 app (Rust + TS/Preact renderer)
  engine/             # engine binary (Rust)
  sdk/                # @nexus-cw/vessel-sdk (TypeScript)
  vocab/              # @nexus-cw/vessel-ui-vocab (TypeScript, schema + types)
  adapters/           # @nexus-cw/vessel-adapter-* packages (TypeScript)
    nexus/
    openai/
    anthropic/
  default-manifests/  # bundled UIs as JSON manifests
  assets/             # bundled VRMs, portraits, voice models
  scripts/            # build, package, test orchestration
  docs/               # this spec, vocabulary spec, ADRs
  tests/              # cross-cutting integration tests
```

### 23.2 Build matrix

- Each package builds independently (npm workspaces for TS; Cargo workspace for Rust).
- A top-level `scripts/build-all` produces per-platform install bundles.
- CI builds all 5 platforms on each PR; release tags trigger signed-bundle production.

### 23.3 Local development

- `vessel dev` — launches the shell pointing at a local engine running from source. Hot-reload on TS changes; engine restart on Rust changes.
- `vessel dev --headless` — runs the engine without a shell, exposes IPC on a known port, useful for adapter dev.
- `vessel dev --manifest-playground` — engine + minimal manifest tester (§22.6).
- Mock backend included for testing without a real Nexus / OpenAI: emits canned responses, optionally with simulated push events.

### 23.4 Adapter development

- New adapters live in `@<author>/vessel-adapter-<backend>` (community) or `vessel/adapters/<name>` (core).
- Conformance test suite shared via `@nexus-cw/vessel-adapter-testkit`. Run against any new adapter to validate the contract.
- Adapter plays in the manifest playground for ad-hoc testing.

## 24. Trust model — full picture

Consolidating §5 (capability gating) and §10.5 (privacy) and the vocabulary spec §10 trust summary.

### 24.1 What vessel guarantees

- **No script execution from manifests.** Manifests are pure data; the renderer never `eval`s or imports remote code.
- **Constrained component vocabulary.** Components are vessel-shipped primitives. Aspects cannot define new components or inject HTML/CSS.
- **Capability gating.** Anything outside the rendered surface (mic, files, clipboard) requires a declared capability in the manifest header AND user approval.
- **Per-source approval.** Approvals are scoped to `(from, capability)` pairs, sticky until revoked from settings.
- **Surface chrome shows source.** The `from` field is always visible on the surface chrome; users always know who's rendering.
- **No mic data to backends.** STT happens locally; cleanup-LLM gets transcripts, not audio. Backends never see mic input.
- **Telemetry/crash-reports off by default.** Opt-in only.
- **Secrets in OS keystore.** Config YAML holds references; secrets live in Keychain / Credential Manager / libsecret.
- **Update bundles signed.** Signature failure aborts update; key rotation requires new build.

### 24.2 What vessel does NOT guarantee

- **Manifest content honesty.** A hostile aspect can lie inside its rendered panel (e.g. a button labelled "Cancel" that actually emits a `submit` event). This is a class of risk vessel cannot fully eliminate at the manifest layer — same as any browser tab. Mitigation: always-visible source chrome, per-source approval revocation.
- **Backend trustworthiness.** Vessel routes user messages to whatever backend the user configured. If the backend is hostile, vessel doesn't protect against that.
- **VRM model integrity.** Vessel does not scan VRMs for embedded data, malicious shaders, or NSFW content. User-bring-your-own.
- **Cloud TTS provider data handling.** Edge TTS sends response *text* to MS Cognitive Services. If the user's backend produces sensitive responses, those texts leave the machine for TTS synthesis. Mitigation: switch to Piper (local).
- **OS-level privilege.** Vessel does not sandbox itself beyond what the shell process gets from the OS. A compromised vessel binary has user-level privilege.

### 24.3 Threat model summary

| Threat | Mitigation |
|---|---|
| Hostile aspect renders phishing UI | Source chrome + per-source approvals + revocable + no script |
| Hostile aspect attempts mic capture | `audio.mic` capability gate, prompted per-source |
| Hostile aspect attempts file exfiltration | `file.read` capability gate; backend gets `content_ref` only on user pick |
| Adapter leaks bearer token | Adapter never logs raw secrets; secrets stay in keystore |
| Update channel hijack | Signed bundles, bundled signing keys, no override |
| Local-other-process tampers with IPC | UDS preferred (no port); TCP fallback uses per-launch secret |
| Unattended machine / shoulder surfing | OS-level concern; vessel respects screen-locker hide |
| Compromised cleanup-LLM provider | User can switch to local model; opt-out of cleanup entirely |

## 25. Internationalization

v1 ships English-only UI; the architecture supports broader i18n at modest cost.

### 25.1 What's translatable

- Vessel's own UI strings (settings, capability prompts, status indicators, error messages). Externalised in standard ICU MessageFormat catalogs (`en.json`, `de.json`, etc.).
- Default voice catalog descriptions ("Warm British Female"). Localisable.
- Bundled default manifests' static text (avatar speech queue indicators, chat-default placeholders). Localisable.

### 25.2 What's NOT translatable

- User content (transcripts, backend responses, manifest content from aspects). That's the user's choice via STT model + backend.
- Aspect-authored manifest text. The aspect is responsible for emitting locale-appropriate content; vessel does not translate.

### 25.3 STT and TTS language support

- **STT:** whisper.cpp supports ~99 languages depending on model. Default model is `base.en` (English-only, smaller). User can configure `base` (multilingual) or larger models for non-English use. Cleanup-LLM prompt should include locale hint when non-English STT model is used.
- **TTS:** Edge TTS has ~140 voices across ~50 languages. Voice catalog filtering by locale lives in settings UI.
- Recipient name detector grammar (§4.2 step 6) is currently English-pattern-based ("hey X", "X:", "X,"). Other languages need locale-specific patterns; deferred to post-v1.

### 25.4 RTL support

Manifest renderer respects CSS `dir="rtl"` when locale demands. Layout components (`stack`, `row`) flip horizontally. Avatar surface is fixed (avatar isn't directionally biased). Phase 6+; v1 is LTR-only.

### 25.5 v1 commitment

English-only UI strings; multilingual STT/TTS available via configuration; full i18n framework in place architecturally so adding locales is contribution-friendly. RTL deferred.

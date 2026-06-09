# Vessel

A desktop application that gives any LLM a face and a voice.

The user speaks (or types), the message is routed to the configured chat backend, and the response comes back as audio in a per-aspect voice, lip-syncing to a 3D VRM avatar.

Vessel is a standalone product. Bring your own backend: Nexus broker, any OpenAI-compatible API (OpenAI, Ollama, LM Studio, llama.cpp server, vLLM, Together, Groq, OpenRouter, Mistral, DeepSeek, ...), Anthropic Claude API, or community-built adapters against the Vessel SDK.

## Status

**Spec + prototype.** Spec v0.2 is finalised and lives at [`docs/spec.md`](docs/spec.md) (also tracked at [`CarriedWorldUniverse/nexus/docs/2026-04-29-avatar-interface-spec.md`](https://github.com/CarriedWorldUniverse/nexus/blob/main/docs/2026-04-29-avatar-interface-spec.md) for the spec-history record). The repo also contains an early Electron + Three.js stage prototype.

## Stack (planned)

- **Shell:** Tauri v2 (small binaries, transparent overlay, native APIs)
- **Renderer:** TypeScript + Preact
- **Avatar:** Three.js + `@pixiv/three-vrm`
- **STT:** `whisper-rs` via Tauri Rust backend (push-to-talk at v1)
- **TTS:** Microsoft Edge TTS (cloud) primary, Piper (local) fallback
- **Lip sync:** `rhubarb-lip-sync` (pre-playback phoneme timing)
- **SDK:** `@carriedworlduniverse/vessel-sdk` — `ChatSource` interface for any chat backend

## Build phases

1. Tauri shell + VRM render proof
2. ChatSource SDK + Nexus reference adapter
3. TTS + lip sync
4. Per-recipient config + avatar swap + portrait sidebar + idle animations
5. Speech queue + attention manager + STT mic input

OpenAI and Anthropic adapters bundle at v1 release; explicitly part of Phase 6 integration testing.

## macOS reference build

The current repo includes a runnable Electron + Three.js reference prototype for macOS. It is a focused app-window proof of the Vessel stage, not the final Apple-first architecture.

```bash
npm install
npm start
```

To build a local unsigned app bundle:

```bash
npm run build:mac
open dist/mac*/Vessel.app
```

See [`docs/mac-reference-build.md`](docs/mac-reference-build.md) for details.

The reference build supports natural aspect targeting for speech. Say `Hey shadow, can you get me the result for today?` and Vessel routes it through Nexus `aspect.say`, focuses Shadow, and speaks Shadow's response when Nexus delivers it. Background messages from other aspects are shown as notices rather than spoken over the active target. The visible stage defaults to `shadow`, `anvil`, and `plumb`; override with `VESSEL_VISIBLE_ASPECTS`. VoxCPM is the configured TTS path for the dmonextreme reference setup, with macOS `say` as the fallback.

## iOS companion

The iPhone path is a native SwiftUI companion client, not an Electron/Tauri port. It uses Apple Speech, `URLSessionWebSocketTask`, Keychain-backed settings, and the Nexus reference connector to provide the same "hey aspect" voice flow on mobile. See [`docs/2026-06-09-vessel-ios-mvp-spec.md`](docs/2026-06-09-vessel-ios-mvp-spec.md).

## Family

Sibling projects under `CarriedWorldUniverse`:
- [`casket-go`](https://github.com/CarriedWorldUniverse/casket-go), [`casket-ts`](https://github.com/CarriedWorldUniverse/casket-ts), [`casket-dotnet`](https://github.com/CarriedWorldUniverse/casket-dotnet) — crypto channel libraries.
- [`interchange`](https://github.com/CarriedWorldUniverse/interchange) — Frame-to-Frame relay server.
- [`nexus`](https://github.com/CarriedWorldUniverse/nexus) — multi-aspect coordination layer.

## License

Apache-2.0. See [LICENSE](LICENSE).

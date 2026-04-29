# Vessel

A desktop application that gives any LLM a face and a voice.

The user speaks (or types), the message is routed to the configured chat backend, and the response comes back as audio in a per-aspect voice, lip-syncing to a 3D VRM avatar in a transparent always-on-top window.

Vessel is a standalone product. Bring your own backend: Nexus broker, any OpenAI-compatible API (OpenAI, Ollama, LM Studio, llama.cpp server, vLLM, Together, Groq, OpenRouter, Mistral, DeepSeek, ...), Anthropic Claude API, or community-built adapters against the Vessel SDK.

## Status

**Pre-implementation.** Spec v0.1 is finalised and lives at [`docs/spec.md`](docs/spec.md) (also tracked at [`nexus-cw/nexus/docs/2026-04-29-avatar-interface-spec.md`](https://github.com/nexus-cw/nexus/blob/main/docs/2026-04-29-avatar-interface-spec.md) for the spec-history record). Build planned to start at Phase 1.

## Stack (planned)

- **Shell:** Tauri v2 (small binaries, transparent overlay, native APIs)
- **Renderer:** TypeScript + Preact
- **Avatar:** Three.js + `@pixiv/three-vrm`
- **STT:** `whisper-rs` via Tauri Rust backend (push-to-talk at v1)
- **TTS:** Microsoft Edge TTS (cloud) primary, Piper (local) fallback
- **Lip sync:** `rhubarb-lip-sync` (pre-playback phoneme timing)
- **SDK:** `@nexus-cw/vessel-sdk` — `ChatSource` interface for any chat backend

## Build phases

1. Tauri shell + VRM render proof
2. ChatSource SDK + Nexus reference adapter
3. TTS + lip sync
4. Per-recipient config + avatar swap + portrait sidebar + idle animations
5. Speech queue + attention manager + STT mic input

OpenAI and Anthropic adapters bundle at v1 release; explicitly part of Phase 6 integration testing.

## Family

Sibling projects under `nexus-cw`:
- [`casket-go`](https://github.com/nexus-cw/casket-go), [`casket-ts`](https://github.com/nexus-cw/casket-ts), [`casket-dotnet`](https://github.com/nexus-cw/casket-dotnet) — crypto channel libraries.
- [`interchange`](https://github.com/nexus-cw/interchange) — Frame-to-Frame relay server.
- [`nexus`](https://github.com/nexus-cw/nexus) — multi-aspect coordination layer.

## License

MIT. See [LICENSE](LICENSE).

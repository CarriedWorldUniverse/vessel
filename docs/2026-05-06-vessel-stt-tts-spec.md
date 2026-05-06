# Vessel — STT / TTS Pipeline Spec v0.1

**Date:** 2026-05-06  
**Status:** Draft  
**Repo:** `nexus-cw/vessel`

---

## 1. Pipeline Shape

```
mic → STT engine → [cleanup-LLM pass] → connector → backend
                                                        ↓
speaker ← TTS engine ← [lipsync extract] ← connector ←─┘
```

Vessel owns both ends. The connector delivers text in both directions. STT and TTS engines are pluggable — vessel ships a default for each tier, operator swaps in higher-quality implementations as needed.

---

## 2. STT (mic → text)

### Tier ladder

| Tier | Engine | Quality | Latency | Cost | Install |
|---|---|---|---|---|---|
| 0 | Web Speech API | Adequate | ~0ms (streaming) | Free | None |
| 1 | `@xenova/transformers` Whisper | Good | 0.5–2s/utterance | Free | npm |
| 2 | whisper.cpp server | Excellent | 0.3–1s/utterance | Free | binary sidecar |
| 3 | Deepgram / AssemblyAI | Excellent | ~300ms (streaming) | Paid | API key |

**v1 default: Tier 0 (Web Speech API).** Zero friction to ship. Runs in the Electron renderer process, no sidecar needed.

**Recommended upgrade: Tier 2 (whisper.cpp server).** whisper.cpp exposes an OpenAI-compatible HTTP server (`whisper-server`). Vessel calls it at `http://localhost:8080/inference` — same request shape as OpenAI's transcriptions endpoint. This is a thin HTTP call, not raw binary management. Matches the local-first philosophy established by gemma4 for knowledge classification.

**Why not Tier 1 as default:** `@xenova/transformers` ONNX Whisper runs in the renderer process on the main thread. For a 3D scene with a render loop, blocking the renderer thread for 500–2000ms is a problem. A sidecar avoids this.

### Integration pattern

All STT tiers implement the same `STTEngine` interface:

```typescript
export interface STTEngine {
  /** Start capturing. Calls onTranscript as words/segments arrive. */
  start(onTranscript: (text: string, final: boolean) => void): void;

  /** Stop capturing and flush any remaining audio. */
  stop(): void;
}
```

`final: false` = partial/streaming word. `final: true` = committed utterance, ready to send.

### STT cleanup pass (optional)

A fast cheap model pass after STT, before sending to the backend:
- Removes filler words ("um", "uh", "like")
- Adds punctuation
- Normalises "hey forge," addressing to clean `@forge:` prefix

Claude Haiku is the default when an Anthropic API key is configured. A local small model (e.g. gemma4 via the same local inference stack) is the alternative. Off by default — operator opts in.

---

## 3. TTS (text → speaker)

### Tier ladder

| Tier | Engine | Quality | Per-aspect voices | Lipsync | Cost | Install |
|---|---|---|---|---|---|---|
| 0 | Web Speech API `SpeechSynthesis` | Robotic | Limited | No phonemes | Free | None |
| 1 | `edge-tts` | Good | ~300 voices | No phonemes | Free | npm |
| 2 | Piper (local) | Good | One model per aspect | Phoneme output | Free | binary sidecar |
| 3 | ElevenLabs | Excellent | Cloned voice per aspect | Phoneme stream | Paid | API key |

**v1 default: Tier 1 (`edge-tts`).** High quality, npm install, no sidecar, no API key. ~300 Microsoft Neural voices — enough for distinct per-aspect voices. Downside: sends response text to Microsoft Cognitive Services; no offline mode.

**Recommended upgrade path:**
- **Privacy/offline:** Tier 2 (Piper) — runs entirely locally, per-aspect voice models (~50MB each). Also enables proper VRM lipsync via phoneme output.
- **Maximum expressiveness:** Tier 3 (ElevenLabs) — best voice quality, voice cloning so the operator can pick/create a voice per aspect from any sample. Phoneme streaming for lipsync.

**Voice tier ladder mirrors the avatar tier ladder:**

| Avatar tier | Voice tier |
|---|---|
| Sphere (default) | Web Speech API or edge-tts |
| Portrait / icon | Piper (distinct per-aspect voice) |
| VRM | ElevenLabs cloned voice + phoneme lipsync |

Same philosophy: every aspect always has *something*. Voice enriches as the operator invests.

### Integration pattern

```typescript
export interface TTSEngine {
  /**
   * Synthesise text. Returns an audio stream + optional phoneme/viseme stream.
   * Vessel plays audio and drives VRM lipsync from visemes if provided.
   */
  synthesise(
    text: string,
    aspectId: string,
    onAudio: (chunk: ArrayBuffer) => void,
    onViseme?: (viseme: VisemeEvent) => void,
  ): Promise<void>;

  /** True if this engine can produce viseme events (for VRM lipsync). */
  readonly supportsLipsync: boolean;
}

export interface VisemeEvent {
  visemeId: number;   // SSML viseme ID (0–21)
  audioOffset: number; // ms offset from audio start
}
```

The `onViseme` callback is only called if `supportsLipsync` is true. Vessel buffers audio and fires viseme events at the correct playback offset, driving VRM blendshapes.

---

## 4. Sidecar Process Management

whisper.cpp server and Piper both run as sidecar processes. Vessel manages them:

- **Spawn on first use.** Sidecar starts when the engine tier that needs it is first activated, not on vessel startup.
- **Health check.** Vessel pings the sidecar's HTTP endpoint before use; if unreachable, attempts restart.
- **Graceful shutdown.** Vessel sends SIGTERM on `vessel.bye` / window close.
- **Binary location.** Configured in `vessel.config.yaml` under `engines.stt.binary` / `engines.tts.binary`. Vessel does not bundle binaries — operator installs and points vessel at them.

---

## 5. Per-Aspect Voice Configuration

```yaml
# vessel.config.yaml
aspects:
  forge:
    voice: en-US-GuyNeural      # edge-tts voice name
    # or:
    voice_model: C:/voices/forge.onnx   # Piper model path
    # or:
    elevenlabs_voice_id: abc123         # ElevenLabs voice ID
  wren:
    voice: en-GB-SoniaNeural
```

Vessel resolves voice config to the active TTS engine. If the configured voice type doesn't match the active engine (e.g. `elevenlabs_voice_id` set but engine is Piper), vessel falls back to a default voice for that engine.

---

## 6. Audio I/O

- **Mic capture:** Web Audio API `getUserMedia` in the Electron renderer. Audio chunks passed to the active STT engine.
- **Speaker playback:** Web Audio API `AudioContext`. TTS audio chunks decoded and queued for playback. Per-aspect audio is serialised (one aspect speaks at a time); a new speaking turn cancels any in-progress playback from another aspect.
- **Push-to-talk:** configurable hotkey (default: space bar held). Continuous mode is an opt-in setting.

---

## 7. Open Questions

- **Streaming STT latency:** whisper.cpp server returns full segment results, not word-level streaming. `final: false` partial events from Web Speech API feel more responsive. Need to test whether whisper.cpp's segment latency (~300–500ms) is acceptable, or whether a hybrid (Web Speech for partials, whisper for final) is worth the complexity.
- **Piper streaming:** Piper generates audio from phoneme segments; it can stream chunks. Integration with the vessel audio queue needs testing to confirm chunk delivery is smooth enough for conversation.
- **Lipsync timing:** viseme offset timing from ElevenLabs is relative to the audio stream start. Vessel needs to align this with the actual audio playback position. Known solvable problem (AudioContext `currentTime`), implementation detail for Part 11.
- **Multi-aspect simultaneous TTS:** in the rare case where two aspects complete their response at the same time, vessel queues them. Queue policy (FIFO vs interrupt-on-new-speaker) to be decided.

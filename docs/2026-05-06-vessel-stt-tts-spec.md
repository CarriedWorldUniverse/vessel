# Vessel — STT / TTS Pipeline Spec v0.1

**Date:** 2026-05-06  
**Status:** Draft  
**Repo:** `CarriedWorldUniverse/vessel`

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

### Speech understanding pass (optional)

A fast cheap model pass after STT, before sending to the backend:
- Removes filler words ("um", "uh", "like")
- Adds punctuation
- Normalises attention phrases such as "hey forge" to clean routing metadata
- Corrects local domain terms without changing intent (`plum` → `plumb`, `bridal` → `bridle`, `next us` → `nexus`)
- Emits both the cleaned prompt and structured routing (`target`, `confidence`, optional `notes`)

This layer is **intent preservation**, not message rewriting. It may clean punctuation, filler words, obvious STT errors, and recipient targeting. It must not add facts, summarize the user's request, inject system context, or make the request more agreeable to the backend agent.

**Default: off in the reference build; configurable in the engine.** Recommended local deployment is an OpenAI-compatible endpoint hosted by the operator, for example Ollama or llama-server on `dmonextreme` running a Gemma-class model such as `gemma-4-12b` if that is the installed model name. Cloud options such as Claude Haiku or OpenAI mini models are valid when the operator prefers cloud cleanup quality.

Example configuration:

```yaml
stt:
  engine: "whisper-cpp"
  model: "base.en"
  understanding:
    enabled: true
    provider: "openai-compatible"
    base_url: "http://dmonextreme.tail41686e.ts.net:30434/v1"
    model: "gemma-4-12b"
    api_key_ref: ""      # empty when the local server does not require auth
    review_before_send: true
```

The same provider interface should support Ollama, llama-server, LM Studio, vLLM, OpenAI, Anthropic-compatible wrappers, or any other model serving stack that can accept a short transcript cleanup prompt.

---

## 3. TTS (text → speaker)

### Tier ladder

| Tier | Engine | Quality | Per-aspect voices | Lipsync | Cost | Install |
|---|---|---|---|---|---|---|
| 0 | Web Speech API `SpeechSynthesis` | Robotic | Limited | No phonemes | Free | None |
| 1 | `edge-tts` | Good | ~300 voices | No phonemes | Free | npm |
| 2 | Piper (local) | Good | One model per aspect | Phoneme output | Free | binary sidecar |
| 2 | VoxCPM (local sidecar) | Very good | Prompt-tuned per aspect | No phonemes yet | Free | Python/GPU sidecar |
| 3 | Inworld TTS | Excellent | 271+ voices, voice cloning | Timestamp stream | Paid ($35/1M chars) | API key |
| 3 | ElevenLabs | Excellent | Cloned voice per aspect | Phoneme stream | Paid | API key |

**v1 default: Tier 1 (`edge-tts`).** High quality, npm install, no sidecar, no API key. ~300 Microsoft Neural voices — enough for distinct per-aspect voices. Downside: sends response text to Microsoft Cognitive Services; no offline mode.

**Recommended upgrade path:**
- **Privacy/offline:** Tier 2 (Piper) — runs entirely locally, per-aspect voice models (~50MB each). Also enables proper VRM lipsync via phoneme output.
- **Local tunable voices:** Tier 2 (VoxCPM) — runs as a supervised sidecar or cluster service. Natural-language voice prompts allow distinct female and male agent voices without giving the backend agent direct control over the audio stack.
- **Cloud quality:** Tier 3 (Inworld TTS) — 271+ voices, voice cloning, sub-200ms median latency, OpenAI-compatible API shape, streaming NDJSON audio. Free tier: 40 min/month. Node.js HTTP client, no SDK needed. **Probe script at `tmp/inworld-tts-probe.js`** — run with `INWORLD_API_KEY=<key>` to validate latency and audio quality against `edge-tts` before deciding.
- **Maximum expressiveness:** Tier 3 (ElevenLabs) — best voice quality, voice cloning, phoneme streaming for lipsync.

**Voice tier ladder mirrors the avatar tier ladder:**

| Avatar tier | Voice tier |
|---|---|
| Sphere (default) | Web Speech API or edge-tts |
| Portrait / icon | Piper (distinct per-aspect voice) |
| VRM | Inworld / ElevenLabs cloned voice + lipsync |

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
  shadow:
    voice_profile:
      gender: female
      prompt: "composed female orchestrator, warm but precise, measured pace, clear New Zealand English"
  anvil:
    voice_profile:
      gender: male
      prompt: "grounded male builder, low confident voice, practical cadence, concise delivery"
```

Vessel resolves voice config to the active TTS engine. If the configured voice type doesn't match the active engine (e.g. `elevenlabs_voice_id` set but engine is Piper), vessel falls back to a default voice for that engine. For prompt-tunable engines such as VoxCPM, `voice_profile.prompt` is used as the synthesis style instruction; for preset catalog engines, the profile is resolved to the nearest available voice.

---

## 6. Voice Summary + Panel Split

TTS speaks a **summary** of the response. The full content appears in the right panel simultaneously. This keeps spoken output short and ambient while the panel carries complete detail.

```
backend response text
        │
        ├─→ [voice summary]  → TTS → speaker
        └─→ [full content]   → right panel
```

### Summary generation (priority order)

1. **Connector-provided `speech_text` field** (preferred): the connector includes an explicit spoken version in the message. The aspect generates this itself — it has context to summarise well. Vessel speaks `speech_text`; panel shows `content`.

2. **Heuristic fallback** (v1 default): if no `speech_text` is provided:
   - Content ≤ 200 chars → speak the whole thing
   - Content > 200 chars → speak the first sentence, then add "...see the panel for details"

3. **Local summariser pass** (optional, future): vessel runs a fast model pass to generate a spoken summary. Adds latency; only worth it if heuristic results are poor in practice.

### Right panel trigger

Panel appears when content length exceeds 200 chars (same threshold as current `panelContent` logic). Panel content is always the **full** `content`, never the summary.

### Connector protocol fields

The split is decided at the backend, not in vessel. The response frame arrives pre-divided:

```typescript
interface AspectMessage {
  display: string;   // full content — right panel, visual record, scrollback
  speech?: string;   // spoken form — TTS. Aspect provides this; vessel uses verbatim.
  // ...
}
```

**When `speech` is present:** vessel speaks it, shows `display` in panel. No processing inside vessel.

**When `speech` is absent (fallback):** vessel applies the length heuristic — ≤200 chars speak `display` in full, >200 chars speak the first sentence + "...see the panel for details."

The fallback exists for connectors and backends that don't provide `speech`. The primary model is backend-decided split: the aspect writes a natural spoken sentence and a complete response independently, then sends both. Vessel is just a router.

**Aspect authoring:** aspects learn to provide `speech` via their SOUL/instructions. No protocol changes needed — broker preserves the field through fanout unchanged.

---

## 7. Audio I/O

- **Mic capture:** Web Audio API `getUserMedia` in the Electron renderer. Audio chunks passed to the active STT engine.
- **Speaker playback:** Web Audio API `AudioContext`. TTS audio chunks decoded and queued for playback. Per-aspect audio is serialised (one aspect speaks at a time); a new speaking turn cancels any in-progress playback from another aspect.
- **Push-to-talk:** configurable hotkey (default: space bar held). Continuous mode is an opt-in setting.

---

## 7. Open Questions

- **Streaming STT latency:** whisper.cpp server returns full segment results, not word-level streaming. `final: false` partial events from Web Speech API feel more responsive. Need to test whether whisper.cpp's segment latency (~300–500ms) is acceptable, or whether a hybrid (Web Speech for partials, whisper for final) is worth the complexity.
- **Piper streaming:** Piper generates audio from phoneme segments; it can stream chunks. Integration with the vessel audio queue needs testing to confirm chunk delivery is smooth enough for conversation.
- **Lipsync timing:** viseme offset timing from ElevenLabs is relative to the audio stream start. Vessel needs to align this with the actual audio playback position. Known solvable problem (AudioContext `currentTime`), implementation detail for Part 11.
- **Multi-aspect simultaneous TTS:** in the rare case where two aspects complete their response at the same time, vessel queues them. Queue policy (FIFO vs interrupt-on-new-speaker) to be decided.

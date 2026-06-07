# Vessel macOS Reference Build

This is a local reference build for the current Electron + Three.js stage prototype. It is not the final Tauri/iPhone architecture; it exists so the Vessel interaction model can be run and evaluated on macOS now.

## Requirements

- macOS
- Node.js 22 or newer
- npm

## Run From Source

```bash
npm install
npm start
```

`npm start` builds the local Apple Speech helper before launching Electron.

For development with DevTools:

```bash
npm run dev
```

## Build The macOS App

Build an ad-hoc-signed local `.app` bundle:

```bash
npm run build:mac
open dist/mac*/Vessel.app
```

`build:mac` uses Electron Builder and then applies a local ad-hoc signature with `codesign --sign -`. This is enough for local testing on Apple Silicon, but it is not a notarized Developer ID build.

Build a fresh local app bundle through the distribution alias:

```bash
npm run dist:mac
open dist
```

The artifacts are intentionally local-only. macOS Gatekeeper assessment will reject the app because it is not notarized, even though the app opens locally from this checkout.

## Smoke Checks

```bash
npm run check
```

Expected result: all JavaScript files parse without output.

For a live Nexus response-path check, use Keel. Keel is the current always-on aspect; Shadow may accept queued `aspect.say` messages but will not reply until its comms pull runs.

```bash
npm run probe:nexus
```

The probe connects with the configured Nexus URL, sends `aspect.say` to `keel`, prints the returned `msg_id`, and exits non-zero if Keel does not reply before the timeout. Override the target only when another always-on aspect is available:

```bash
npm run probe:nexus -- --aspect=keel --timeout-ms=45000
```

## Nexus Connection

The reference build connects to Nexus as an operator over `/connect`.

```bash
export NEXUS_WS_URL=wss://nexus.tail41686e.ts.net:7888
export NEXUS_TOKEN=<operator-or-dev-token>
export NEXUS_INSECURE_TLS=1   # only for local self-signed certs
npm start
```

The app sends untargeted prompts with `chat.send`. When a prompt resolves to a specific aspect, Vessel uses Nexus `aspect.say` so the broker records it as the operator-facing "talk to this aspect" command and returns the created chat `msg_id`. Vessel receives `chat.deliver`, updates the active speaker, and speaks matching incoming aspect messages.

The stage currently shows only key online aspects by default: `shadow`, `anvil`, and `plumb`. The full Nexus roster is still used for speech targeting. Override the visible stage set with:

```bash
export VESSEL_VISIBLE_ASPECTS=shadow,anvil,plumb
```

### Targeting An Aspect

Vessel treats `hey` as an attention getter in dictated or typed prompts. The word after `hey` is matched against the live Nexus aspect roster and converted into the explicit Nexus mention before sending.

Examples:

```text
Hey shadow, can you get me the result for today?
```

is routed through `aspect.say` as:

```text
@shadow can you get me the result for today?
```

The UI focuses Shadow immediately and shows the returned `msg_id` in a pending strip. This is important for pull-based aspects: the prompt is queued at Nexus even if the aspect has not pulled comms yet. When Nexus later delivers Shadow's response, Vessel clears the pending entry and speaks it. Nexus may deliver unrelated background messages from other aspects while waiting; Vessel shows those as notices and does not speak them unless they match the currently addressed aspect. Explicit mentions still work:

```text
@shadow can you get me the result for today?
```

## Apple Speech

Click **Dictate**, speak, then click **Stop**. Vessel records a WAV locally and sends it to the native Apple Speech helper. The transcript is placed in the input field for review and editing; press **Send** or Enter to send it to Nexus.

The long-term input chain is STT plus an optional speech-understanding model. For the dmonextreme deployment, that can be a local OpenAI-compatible endpoint running a Gemma-class model through Ollama or llama-server:

```bash
export VESSEL_UNDERSTANDING_PROVIDER=openai-compatible
export VESSEL_UNDERSTANDING_BASE_URL=http://dmonextreme.tail41686e.ts.net:30434/v1
export VESSEL_UNDERSTANDING_MODEL=gemma-4-12b
```

That model is responsible for intent-preserving cleanup and routing, not raw transcription: fixing domain terms, adding punctuation, and turning "hey shadow" into structured targeting while leaving the prompt editable before send.

The reference build reads config in this order:

1. `vessel.config.json` in the repo root
2. `~/.vessel/config.json`
3. `VESSEL_CONFIG=/path/to/config.json`
4. Existing environment variable overrides such as `NEXUS_WS_URL`, `VESSEL_VOXCPM_BASE_URL`, and `VESSEL_UNDERSTANDING_MODEL`

Use [vessel.config.example.json](../vessel.config.example.json) as the starting point. The default reference config targets `nexus.tail41686e.ts.net` for Nexus, while Gemma speech understanding and VoxCPM TTS still run on dmonextreme.

## Speech Output

The reference config uses VoxCPM for TTS when the dmonextreme sidecar is available. macOS `say` remains the no-dependency fallback and supports a practical per-agent voice map through environment variables:

```bash
export VESSEL_VOICE_SHADOW=Samantha
export VESSEL_VOICE_ANVIL=Daniel
npm start
```

or:

```bash
export VESSEL_VOICES='{"shadow":"Samantha","anvil":"Daniel"}'
npm start
```

Available macOS voices can be listed with:

```bash
say -v '?'
```

When a Nexus message includes `speech`, `speech_text`, or `speechText`, Vessel speaks that short form and renders the full `content`, `display`, or `panelContent` in the right panel. If no spoken form is provided, Vessel speaks the full response when it is short, or a fast heuristic summary when it is long. Local model summarization can be enabled with `speechSummaryMode: "model"`, but the default is heuristic to avoid delaying speech.

### VoxCPM Sidecar

Vessel can supervise a local VoxCPM sidecar for higher-quality TTS while keeping Python/PyTorch out of the app shell.

Install the Carried World fork and sidecar dependencies in the Python environment you want Vessel to use:

```bash
git clone https://github.com/nexus-cw/VoxCPM ~/Source/VoxCPM
cd ~/Source/VoxCPM
pip install -e .
pip install fastapi uvicorn soundfile
```

Run Vessel with VoxCPM selected:

```bash
export VESSEL_TTS_ENGINE=voxcpm
export VESSEL_VOXCPM_SIDECAR=1
export VESSEL_VOXCPM_MODEL=openbmb/VoxCPM2
npm start
```

By default Vessel starts:

```bash
python3 sidecars/voxcpm/server.py --host 127.0.0.1 --port 8765
```

Override the sidecar process when using a venv, uv, or a custom server:

```bash
export VESSEL_VOXCPM_SIDECAR_COMMAND=/path/to/venv/bin/python
export VESSEL_VOXCPM_SIDECAR_ARGS='["sidecars/voxcpm/server.py","--host","127.0.0.1","--port","8765"]'
```

Per-agent voice design prompts are passed by prefixing the spoken text with VoxCPM's natural-language voice description syntax:

```bash
export VESSEL_VOXCPM_PROMPT_SHADOW="calm senior orchestrator, measured pace, clear New Zealand English"
export VESSEL_VOXCPM_PROMPT_ANVIL="direct builder voice, concise and practical"
```

Treat these prompts as each agent's first voice profile. The profile should describe the audible identity, not the agent's reasoning persona: gender or androgyny, age impression, pace, accent, warmth, authority, and emotional range. Keep it stable per agent so repeated turns sound like the same speaker.

Example starting profiles:

```bash
export VESSEL_VOXCPM_PROMPT_SHADOW="composed female orchestrator, warm but precise, measured pace, clear New Zealand English"
export VESSEL_VOXCPM_PROMPT_ANVIL="grounded male builder, low confident voice, practical cadence, concise delivery"
export VESSEL_VOXCPM_PROMPT_PLUMB="friendly male builder, lighter voice than Anvil, quick collaborative cadence"
```

The next tuning layer is optional reference audio per agent. Vessel should keep the current prompt-only route as the default because it is portable and easy to edit, then allow a local voice reference file when the operator wants a closer match.

The reference UI includes a compact **Voice** strip for fast tuning. Select `Shadow`, `Anvil`, or `Plumb`, then click **Play** to speak a fixed phrase through the active TTS engine. This is intended for quick prompt tuning: adjust the agent's `VESSEL_VOXCPM_PROMPT_*`, restart or reload the app, and replay the same line until the identity is close enough.

The console also shows a small activity pill for the current conversation phase:

- `Listening` while microphone capture is active
- `Transcribing` while Apple Speech is running
- `Understanding` while the Gemma cleanup/targeting pass is running
- `Review` when the cleaned prompt is ready in the editable input box
- `Sending` and `Waiting` after the prompt is sent to Nexus
- `Speaking` while the active agent's TTS is playing

If you already have VoxCPM or vLLM-Omni running elsewhere, skip supervision and point Vessel at the OpenAI-compatible TTS endpoint:

```bash
export VESSEL_TTS_ENGINE=voxcpm
export VESSEL_VOXCPM_BASE_URL=http://127.0.0.1:8000/v1
```

For the dmonextreme k3s sidecar:

```bash
export VESSEL_TTS_ENGINE=voxcpm
export VESSEL_VOXCPM_BASE_URL=http://dmonextreme.tail41686e.ts.net:30435/v1
```

The k3s deployment uses a baked local image so pod restarts do not reinstall Python dependencies:

```bash
ssh dmonextreme
cd /tmp/vessel/sidecars/voxcpm
podman build -t localhost/vessel-voxcpm:dev -f Containerfile .
podman save localhost/vessel-voxcpm:dev | sudo k3s ctr images import -
sudo kubectl apply -f /tmp/vessel/deploy/k3s/voxcpm.yaml
```

The k3s manifest enables `VESSEL_VOXCPM_PRELOAD=1`. On restart the pod loads VoxCPM and runs a short warm-up synthesis before becoming ready, so the NodePort should not be treated as available until `/health` returns:

```json
{"status":"ok","ready":true}
```

This moves the roughly two-minute cold start into deployment rollout instead of the first user voice turn. Warm post-ready synthesis should be around one to two seconds for short speech.

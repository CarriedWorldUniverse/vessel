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

## Nexus Connection

The reference build connects to Nexus as an operator over `/connect`.

```bash
export NEXUS_WS_URL=wss://localhost:7888
export NEXUS_TOKEN=<operator-or-dev-token>
export NEXUS_INSECURE_TLS=1   # only for local self-signed certs
npm start
```

The app sends `chat.send`, receives `chat.deliver`, updates the active speaker, and speaks incoming aspect messages with macOS `say`.

## Apple Speech

Click **Dictate**, speak, then click **Stop**. Vessel records a WAV locally, sends it to the native Apple Speech helper, and sends the transcript to Nexus.

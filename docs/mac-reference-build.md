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

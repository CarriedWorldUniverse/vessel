# Vessel Connector SDK Spec v0.1

**Date:** 2026-05-06  
**Status:** Draft — superseded at protocol level by [`agent-network/docs/2026-05-06-vessel-connector-spec.md`](https://github.com/CarriedWorldUniverse/nexus/blob/main/docs/2026-05-06-vessel-connector-spec.md) (keel, 2026-05-06). This document covers the **vessel-side TypeScript SDK** that wraps that protocol — the `VesselConnector` interface vessel builds against.

---

## Overview

Vessel is a desktop product with a pluggable backend. It renders avatars, handles voice I/O, and manages the user-facing stage — but it is deliberately agnostic about where the intelligence comes from.

A **connector** is an implementation of the `VesselConnector` interface that bridges vessel to a specific backend: a Nexus broker, an OpenAI-compatible API, an Anthropic endpoint, a local Ollama instance, or anything else. Vessel ships reference connectors for common backends; third parties can build and distribute their own.

This spec defines:
- The `VesselConnector` interface (TypeScript)
- The event and message types that flow across it
- The aspect roster contract (presence, identity)
- The lifecycle contract (connect, reconnect, teardown)
- What vessel guarantees to the connector
- What the connector must guarantee to vessel

---

## 1. Core Model

Vessel maintains a **stage** — a set of named aspects, each with a seat, an avatar, and a voice. The connector is responsible for:

1. Telling vessel which aspects exist and their current presence state
2. Delivering messages (text, with optional metadata) from aspects to vessel
3. Delivering user input from vessel to the appropriate backend

Everything else — rendering, audio, lip sync, camera, gaze — is vessel's concern.

A connector does **not** need to understand vessel's internals. It is a thin adapter between vessel's event model and whatever the backend actually does.

---

## 2. Interface Definition

```typescript
/** A single connector instance. Vessel calls connect() once on startup. */
export interface VesselConnector {
  /**
   * Called by vessel on startup. The connector should establish its backend
   * connection and begin emitting events via the provided sink.
   * Returns a teardown function vessel calls on shutdown.
   */
  connect(sink: VesselEventSink): Promise<() => void>;

  /**
   * Deliver a user message to the backend.
   * `to` is null when broadcasting to all aspects / no specific recipient.
   */
  send(message: UserMessage): Promise<void>;
}

/** Vessel calls these methods to receive events from the connector. */
export interface VesselEventSink {
  /** An aspect's presence state changed */
  onRosterChange(event: RosterEvent): void;

  /** An aspect produced a message (speaking turn began or content arrived) */
  onMessage(event: AspectMessage): void;

  /** The connector lost its backend connection (vessel will show reconnecting state) */
  onDisconnect(reason: string): void;

  /** The connector successfully reconnected */
  onReconnect(): void;
}
```

---

## 3. Types

### 3.1 Aspect identity

```typescript
export interface AspectIdentity {
  /** Unique stable identifier — used for seat assignment and config keys */
  id: string;

  /** Display name shown in vessel UI */
  name: string;

  /**
   * Identity hints vessel uses for rendering defaults.
   * Vessel overrides these with local user config if set.
   */
  hints?: {
    /** CSS hex color string, e.g. "#ff6b35" */
    color?: string;

    /** Absolute path to a .vrm file on the user's machine */
    vrmPath?: string;

    /** Label for the TTS voice to use (vessel resolves against its voice catalog) */
    voiceId?: string;
  };
}
```

### 3.2 Roster events

```typescript
export type RosterEvent =
  | { type: 'joined';  aspect: AspectIdentity }
  | { type: 'left';    aspectId: string }
  | { type: 'snapshot'; aspects: AspectIdentity[] };
```

- `snapshot` — emitted once immediately after `connect()` resolves, listing all currently-present aspects. Vessel uses this to populate the initial stage.
- `joined` — an aspect came online. Vessel brightens that seat.
- `left` — an aspect went offline. Vessel dims that seat; the seat ghost remains.

### 3.3 Aspect messages

```typescript
export interface AspectMessage {
  /** Which aspect is speaking */
  aspectId: string;

  /** Stable message id (for streaming continuations) */
  messageId: string;

  /** Text content — may arrive in chunks for streaming responses */
  text: string;

  /**
   * Optional spoken form. If present, vessel sends this to TTS while rendering
   * `text` or `meta.panelContent` as the full visual response.
   */
  speech?: string;

  /** true if this chunk completes the turn; false for streaming partials */
  done: boolean;

  /**
   * Optional structured metadata the connector may include.
   * Vessel uses well-known keys; unknown keys are preserved but ignored.
   */
  meta?: {
    /** If set, vessel renders this content in the right panel instead of deriving it from text */
    panelContent?: string;

    /**
     * Back-compat alias for `speech`. Connectors should prefer the top-level
     * `speech` field; vessel may still accept `speech_text` on provider-native
     * frames such as Nexus `chat.deliver`.
     */
    speech_text?: string;

    /** Aspect ID this message is addressing (drives gaze system) */
    addressingAspectId?: string;
  };
}
```

**Streaming convention:** A speaking turn is a sequence of `AspectMessage` events sharing the same `messageId`, with `done: false` for partials and `done: true` for the final chunk. Vessel derives speaking state from message arrival — the connector does not set a "is speaking" flag. Vessel's 3-second silence timer starts after the last `done: true` message.

### 3.4 User messages

```typescript
export interface UserMessage {
  /** Text of the user's input (post-STT and optional cleanup pass) */
  text: string;

  /**
   * Which aspect this is directed to, if determinable.
   * Null = connector decides routing (broadcast, last-speaker, etc.)
   */
  to: string | null;

  /** Origination mode */
  inputMode: 'voice' | 'text';
}
```

---

## 4. Lifecycle

```
vessel starts
    │
    ▼
connector.connect(sink) called
    │
    ▼
connector establishes backend connection
    │
    ▼
sink.onRosterChange({ type: 'snapshot', aspects: [...] })   ← required
    │
    ├── sink.onMessage(...)   ← as aspects speak
    ├── sink.onRosterChange({ type: 'joined' | 'left', ... })
    ├── sink.onDisconnect(reason) / sink.onReconnect()
    │
vessel shutdown
    │
    ▼
teardown function called (returned from connect())
    │
    ▼
connector closes backend connection cleanly
```

### Reconnect behaviour

The connector is responsible for reconnect logic. Vessel does not retry — it calls `connect()` once and trusts the connector to handle transient failures. When a reconnect succeeds, `sink.onReconnect()` followed by a fresh `sink.onRosterChange({ type: 'snapshot' })` restores vessel's state.

Vessel shows a "reconnecting" indicator in the stage while disconnected. It does not tear down the window.

---

## 5. What Vessel Guarantees

- `connect()` is called exactly once per vessel session.
- `send()` is called from the main thread only; connectors need not handle concurrent sends.
- The teardown function is called before the process exits — connectors can rely on clean shutdown.
- Vessel never calls `sink` methods after the teardown function returns.
- If `connect()` rejects, vessel surfaces an error and the connector is not used.

---

## 6. What the Connector Must Guarantee

- Emit `snapshot` before any other events (vessel rejects events before snapshot).
- `aspectId` in all events must match an `id` from the most recent snapshot or a `joined` event.
- Never emit events after the teardown function is called.
- `send()` must not throw; surface errors via `sink.onDisconnect()` if the backend is unreachable.
- Connectors must not call any vessel APIs other than the `VesselEventSink` provided at connect time.

---

## 7. Reference Connectors

Vessel ships three reference connectors:

### NexusConnector

Connects to a Nexus broker via WebSocket. Reads the roster from `GET /api/aspects`, subscribes to `chat.deliver` and roster-change frames. Registers vessel as a UI-aspect with a configured bearer token.

Config:
```yaml
connector: nexus
nexus:
  url: wss://your-broker:7888
  token: <vessel-bearer-token>
```

### OpenAIConnector

Connects to any OpenAI-compatible endpoint (OpenAI, Ollama, LM Studio, vLLM, Groq, etc.). Presents as a single-aspect roster — the model is the only "aspect" in the stage. Streaming responses map to chunked `AspectMessage` events.

Config:
```yaml
connector: openai
openai:
  baseUrl: https://api.openai.com/v1
  apiKey: <key>
  model: gpt-4o
  aspectName: assistant
  aspectColor: "#4ecdc4"
```

### AnthropicConnector

Connects to the Anthropic Claude API. Single-aspect roster, streaming via the Messages API SSE stream.

Config:
```yaml
connector: anthropic
anthropic:
  apiKey: <key>
  model: claude-sonnet-4-6
  aspectName: claude
  aspectColor: "#ff6b35"
```

---

## 8. Community Connectors

Third parties implement `VesselConnector` from `@carriedworlduniverse/vessel-sdk` and distribute as an npm package. Users configure vessel to load the connector by package name:

```yaml
connector:
  package: "@example/vessel-connector-mybackend"
  config:
    # connector-specific config, passed to the connector's factory function
    endpoint: https://my-backend.example.com
```

Vessel loads the connector package, calls the exported factory with the config object, and receives a `VesselConnector` instance.

### Community connector contract

- Must export a default factory function: `(config: unknown) => VesselConnector`
- Must declare `"vessel-connector": true` in `package.json` (vessel validates this before loading)
- No access to vessel internals — only the `VesselEventSink` interface
- Vessel does not sandbox community connectors; users take responsibility for connector packages they install

---

## 9. Multi-Aspect vs Single-Aspect Backends

Vessel's stage supports up to N aspects simultaneously. Connectors can present:

- **Multi-aspect roster** (e.g. NexusConnector) — multiple aspects appear in seats, camera orbits to whoever is speaking, gaze system is fully active
- **Single-aspect roster** (e.g. OpenAIConnector, AnthropicConnector) — one aspect in one seat, camera stays focused on them, constellation has a single occupied seat

The vessel stage adapts to roster size. A single-aspect backend renders one occupied seat; the rest ghost. There is no separate "single-aspect mode" — it is a degenerate case of the full stage.

---

## 10. Versioning

The connector interface is versioned via `@carriedworlduniverse/vessel-sdk`. Breaking changes bump the major version. Vessel ships with a declared minimum SDK version; connectors built against older SDK versions surface a compatibility warning.

Current version: `0.1.0` (pre-release, interface may change before `1.0.0`).

---

## 11. Open Questions

- **Connector sandboxing:** community connectors currently run in the same process as vessel. A future version may run connectors in a worker thread with a message-passing boundary. Connectors should not rely on shared-memory tricks.
- **Multi-connector:** vessel currently supports one active connector per session. Multi-connector (e.g. Nexus broker + a local Ollama model simultaneously) is a future feature.
- **Connector-provided TTS voices:** connector hints currently specify a `voiceId` label. A richer interface for connector-provided audio streams (pre-synthesised TTS from the backend) is deferred to v0.2.
- **Auth/credentials UI:** vessel has no built-in credential input UI yet. Connectors that need API keys currently read them from the config file. A secure credential prompt flow is planned.

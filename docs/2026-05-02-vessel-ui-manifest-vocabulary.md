# Vessel — UI Manifest Vocabulary Spec v0.1

**Date:** 2026-05-02
**Status:** Draft
**Companion to:** [`spec.md`](spec.md) §5.1 (`UIManifest`), §3 lock #9 (one SDK, not two)

This document defines the vocabulary, capability model, event protocol, and lifecycle for UI manifests carried over ChatSource. It is the load-bearing spec for the "AI builds the UI" pitch in vessel v0.2 — without a concrete vocabulary, manifest-as-payload-type is just a hand-wave.

## 1. Scope and non-scope

**In scope:**
- The shape of a `UIManifest` JSON document.
- The v1 component vocabulary — named primitives the renderer recognises.
- The capability declaration model — what a manifest can request and how it's gated.
- The event protocol — how user interactions on a rendered manifest flow back to the backend.
- The manifest lifecycle — load, update (patch), dispose.

**Not in scope (deferred):**
- Theming / visual customisation. v1 vocabulary is plain; theming is post-v1.
- Animation primitives beyond a small set of declarative state transitions.
- 3D / WebGL components beyond the bundled `avatar` primitive (which wraps the VRM renderer).
- Layout responsiveness rules beyond a basic stack/row/grid model.
- Cross-manifest composition — a manifest is a self-contained tree at v1; aspects don't import each other's components.

## 2. Design principles

These shape every decision in this spec. Stated up front so trade-offs are debatable.

1. **Declarative over imperative.** A manifest describes *what* to render, not *how* to render it. No script, no callbacks, no DOM manipulation. The renderer owns the *how*.
2. **Constrained vocabulary, not raw HTML.** Components are named primitives from a vessel-shipped registry. An aspect cannot inject `<script>`, raw HTML, or arbitrary CSS. The set is small and audited.
3. **Capabilities are declared, not assumed.** Anything that touches the user's machine outside the rendered surface (mic, clipboard, files, network) is requested in the manifest header and gated by the runtime.
4. **Events are typed and finite.** Components emit a fixed set of event types. Aspects don't define new events; they consume the ones the vocabulary provides.
5. **Same wire as chat.** Manifest carriage uses the existing ChatSource connection (§5.1 of the main spec). No second protocol, no second SDK.
6. **Forward-compat by ignore.** Unknown component types, unknown capabilities, and unknown event fields are logged and dropped. The renderer never errors on a manifest it partly understands; it renders what it knows.

## 3. Manifest envelope

```json
{
  "schema_version": "1.0",
  "manifest_id": "<ulid>",
  "from": "<aspect-id-or-backend-name>",
  "title": "string (optional, shown in window chrome / surface affordance)",
  "capabilities": ["audio.mic", "clipboard.write"],
  "root": <ComponentNode>,
  "metadata": { "free-form, ignored by renderer, for backend round-trip" }
}
```

- **`schema_version`** — semver string. Renderer matches major; minor differences ignored. v1 ships `"1.0"`.
- **`manifest_id`** — ULID, backend-assigned. Used to correlate `UIEvent`s and patches back to this manifest. Stable for the manifest's lifetime.
- **`from`** — the producing aspect or backend identity. Drives the user-facing approval prompt ("Forge wants to show you a UI…").
- **`title`** — optional human-readable label. May be shown in a tab strip or surface chrome.
- **`capabilities`** — array of capability strings (§5). Empty array = passive surface, no gating prompt. Non-empty = approval flow.
- **`root`** — the component tree (§4).
- **`metadata`** — free-form object the backend may use to track its own state. Renderer treats as opaque; preserved when echoing events back.

A manifest is self-contained. The renderer composes nothing across manifests.

## 4. Component vocabulary v1

A component node:

```json
{
  "type": "<component-name>",
  "id": "<string, optional, required for emitting events>",
  "props": { "type-specific" },
  "children": [<ComponentNode>, ...]   // present only on container types
}
```

**`id`** is required if the component emits events; otherwise optional. IDs must be unique within a manifest.

The v1 vocabulary is intentionally small. Each component is **pure presentation or input** — nothing in the vocabulary touches state outside the rendered surface without going through a declared capability.

### 4.1 Layout (containers)

| Type | Description | Key props |
|---|---|---|
| `stack` | Vertical column. Children stack top-to-bottom. | `gap` (px), `align` (`start`\|`center`\|`end`\|`stretch`) |
| `row` | Horizontal row. Children flow left-to-right. | `gap`, `align`, `wrap` (bool) |
| `grid` | Fixed-column grid. | `columns` (int), `gap` |
| `panel` | Bordered container with optional header. | `header` (string), `variant` (`default`\|`subtle`\|`emphasis`) |
| `divider` | Horizontal rule. | `label` (optional) |
| `spacer` | Empty space. | `size` (px) |

### 4.2 Content (display-only, no events)

| Type | Description | Key props |
|---|---|---|
| `text` | Single span of text. | `value` (string), `variant` (`body`\|`caption`\|`code`\|`mono`), `weight` (`normal`\|`bold`) |
| `heading` | Heading. | `value`, `level` (1–4) |
| `markdown` | Rendered Markdown subset. | `value`. Subset: bold, italic, code, code-blocks, lists, links (capability-gated), no images, no raw HTML. |
| `code` | Code block with optional syntax highlight. | `value`, `language` (string) |
| `image` | Static image from a vessel-trusted source (manifest-relative URL or data URI, size-capped). | `src`, `alt`, `width`, `height` |
| `badge` | Small status pill. | `value`, `variant` (`info`\|`success`\|`warning`\|`error`\|`neutral`) |
| `status` | Animated indicator (spinner / pulse). | `kind` (`thinking`\|`busy`\|`error`\|`idle`), `label` |

### 4.3 Input (event-emitting)

| Type | Description | Key props | Emits |
|---|---|---|---|
| `button` | Action button. | `label`, `variant` (`primary`\|`secondary`\|`ghost`\|`danger`), `disabled` | `click` |
| `text-input` | Single-line text input. | `label`, `placeholder`, `value` (initial), `disabled` | `change`, `submit` |
| `textarea` | Multi-line text input. | `label`, `placeholder`, `value`, `rows`, `disabled` | `change`, `submit` |
| `select` | Dropdown. | `label`, `options` ([{value, label}]), `value`, `disabled` | `change` |
| `checkbox` | Boolean. | `label`, `checked`, `disabled` | `change` |
| `radio-group` | Radio set. | `label`, `options`, `value`, `disabled` | `change` |
| `slider` | Numeric range. | `label`, `min`, `max`, `step`, `value`, `disabled` | `change` |
| `file-picker` | File selector. **Requires `file.read` capability.** | `label`, `accept` (mime list), `multiple` (bool) | `pick` (emits file metadata + content reference; see §5.2) |
| `mic-record` | Push-to-record button or held-key. **Requires `audio.mic` capability.** | `label`, `mode` (`hold`\|`toggle`), `max_duration_s` | `start`, `stop`, `audio` (emits transcript or audio reference per `output` prop) |

### 4.4 Specialized

| Type | Description | Key props | Emits |
|---|---|---|---|
| `avatar` | The VRM avatar slot — drives the active speaker rendering. **Reserved for default avatar UI; available to any manifest that imports it.** Visible only when capability `display.avatar` is granted. | `recipient` (which configured recipient to render), `expression` (override) | none (driven by speech queue, not user) |
| `portrait` | Static portrait image of a recipient (auto-generated or override). | `recipient`, `attention_state` (`idle`\|`calling`\|`urgent`) | `click` (optional) |
| `audio-player` | Audio playback control. | `src` (manifest-trusted), `autoplay` (bool, capped), `controls` (bool) | `play`, `pause`, `ended` |
| `transcription-display` | Live STT transcript view. **Requires `audio.mic` capability.** | `recipient`, `partial` (bool — show interim results) | `final` (emits the cleaned transcript at end-of-utterance) |

### 4.5 What's deliberately not in v1

- `iframe` / `webview` / arbitrary HTML embed. Bypasses the constrained-vocabulary principle.
- `script` / `code-eval` of any kind.
- Drawing primitives (`canvas`, `svg`). Post-v1; the avatar slot covers the only v1 use case.
- Deeply customisable styling. Theming is post-v1.
- Drag-and-drop. Adds complexity without v1 use case.
- Modal / dialog. Surface chrome handles modality; manifests don't open separate windows.
- Notification / toast. Goes through the `attention` event channel (main spec §9), not a manifest component.

## 5. Capability model

Capabilities are explicit, narrowly scoped, declared in the manifest header, and gated by the runtime. The runtime prompts the user on first render of a manifest from a given source with a given capability set; the approval is sticky per `(from, capability)` pair until revoked from vessel's settings UI.

### 5.1 v1 capability list

| Capability | What it grants | Granted to which components |
|---|---|---|
| `audio.mic` | Read from the user's microphone for the duration this manifest is active. | `mic-record`, `transcription-display` |
| `audio.speaker` | Play audio through the user's speakers. | `audio-player` (with autoplay) |
| `clipboard.read` | Read clipboard contents on user gesture. | future `paste-from-clipboard` button (post-v1) |
| `clipboard.write` | Write to clipboard on user gesture. | a `copy` action on `text` / `code` / `markdown` |
| `file.read` | Read files the user picks. | `file-picker` |
| `display.avatar` | Render the VRM avatar slot. | `avatar` |
| `display.persistent` | Manifest survives across vessel session boundaries (otherwise cleared on app close). | manifest-level, not component-level |
| `network.beacon` | Emit out-of-band telemetry events to the backend (analytics, error reports). Limited to typed beacon events; cannot exfiltrate manifest state. | manifest-level |

The list is intentionally short. New capabilities are spec-bumps, not aspect-additions.

### 5.2 Capability semantics

- **All capability access is component-mediated.** A capability does not unlock arbitrary use; it unlocks specific components in the vocabulary that already model the right shape (e.g. `audio.mic` is consumed only by `mic-record` and `transcription-display`, both of which gate on user gesture).
- **No silent acquisition.** Every capability is in the manifest header and surfaced in the approval prompt. A manifest cannot escalate at runtime.
- **Runtime can deny components mid-render.** If the user revokes a capability while a manifest is rendered, components depending on it switch to a `disabled` state with a "permission required" overlay. The manifest doesn't crash; the surface degrades gracefully.

### 5.3 Approval UX

On first render of a manifest from `from = X` requesting capabilities `[Y, Z]`:

```
┌────────────────────────────────────────────────────┐
│  Forge wants to show you a UI                       │
│                                                     │
│  This UI will request:                              │
│   • Microphone access                               │
│   • File picker (read-only)                         │
│                                                     │
│  Permissions are sticky for Forge until you revoke. │
│                                                     │
│   [ Allow once ]   [ Allow always ]   [ Deny ]     │
└────────────────────────────────────────────────────┘
```

- "Allow once" — capability granted for this manifest's lifetime only.
- "Allow always" — sticky for `(from, capability)`, recorded in vessel's permissions store, listed in settings under "Aspect permissions" with a revoke action.
- "Deny" — manifest renders without the requested capabilities; affected components show the "permission required" state.

A manifest with empty `capabilities` array bypasses this prompt entirely (passive surface).

## 6. Event protocol

User interactions on rendered components flow back to the backend via the existing ChatSource connection. They are *not* a separate channel.

### 6.1 UIEvent shape

Sent from vessel to backend via `ChatSource.send()`:

```json
{
  "type": "ui.event",
  "payload": {
    "manifest_id": "<ulid>",
    "component_id": "<string>",
    "event": "<event-type>",
    "value": <event-specific>,
    "ts": "<ISO-8601>"
  }
}
```

### 6.2 Event types

The event type emitted depends on the component (§4.3, §4.4 right column). Common shapes:

- `click` — value: `null`.
- `change` — value: the new component value (string for inputs, bool for checkbox, number for slider, etc.).
- `submit` — value: `{ form: { <id>: <value>, ... } }` for the manifest's input components at submission time. Fired by Enter on a `text-input` or by a `button` with `type: "submit"` in props.
- `pick` (file-picker) — value: `[{ name, mime, size, content_ref }]`. The `content_ref` is an opaque vessel-side handle the backend can request via a separate `file.read` round-trip; vessel does *not* push file content as part of the event payload (avoids huge frames; backends fetch on demand).
- `audio` (mic-record) — value depends on `output` prop: `{ transcript: string }` if `output: "transcript"` (uses vessel's STT pipeline) or `{ audio_ref: string }` if `output: "audio"`.
- `final` (transcription-display) — value: `{ transcript: string }` after end-of-utterance silence.

### 6.3 Backend responses to events

The backend may respond to a `ui.event` with:

- A `ui.manifest` patch (§7) — updating the same `manifest_id`'s rendered tree.
- A new `ui.manifest` — replacing the old one (the renderer disposes the old).
- A chat message — falls back through to the speech queue and avatar like any other backend reply.
- Nothing — silent acknowledgement is fine.

## 7. Manifest lifecycle

### 7.1 Load

Backend emits `ui.manifest` on the ChatSource subscribe channel. Vessel:

1. Validates schema_version compat (major match).
2. Runs the approval flow if capabilities are non-empty and not already approved for `(from, capabilities)`.
3. Validates the component tree (unknown types logged + dropped, props unknown to a known type ignored).
4. Renders into the manifest's surface (a tab, panel, or window — surface assignment is a vessel concern, see §8).

### 7.2 Update (patch)

Backend may emit a follow-up `ui.manifest` with the same `manifest_id` and a `patch` field instead of `root`:

```json
{
  "type": "ui.manifest",
  "payload": {
    "manifest_id": "<existing-ulid>",
    "patch": [
      { "op": "replace", "path": "/root/children/2/props/value", "value": "new" },
      { "op": "set-disabled", "target_id": "submit-btn", "value": true }
    ]
  }
}
```

Patch ops in v1:
- `replace` — JSON Pointer-shaped path replace within the tree.
- `set-disabled` — convenience: disable/enable a component by id.
- `set-value` — convenience: set value of an input by id (without forcing a `change` event echo).
- `append-children` — append nodes to a container by id.
- `remove` — remove a node by id.

Convenience ops avoid complex JSON Pointer math on the backend. Both styles coexist; renderer applies in order.

### 7.3 Dispose

Backend emits:

```json
{ "type": "ui.manifest.dispose", "payload": { "manifest_id": "<ulid>" } }
```

Renderer tears down the surface, releases capability handles, evicts manifest state. Subsequent events for that `manifest_id` are dropped.

If vessel closes (app exit) or the ChatSource connection drops without explicit dispose, all non-`display.persistent` manifests are disposed implicitly. Manifests with `display.persistent` are cached locally and re-rendered on next session start (subject to the original capability approvals still being valid).

## 8. Surface assignment

A manifest needs a place to render. Vessel manages a small set of surfaces:

- **Main avatar surface** — the transparent always-on-top window. Owned by vessel's bundled default avatar manifest. Aspect manifests do *not* render here (the avatar slot is sacred).
- **Manifest panel** — a regular (non-transparent) window vessel opens for AI-authored UIs. One panel per manifest at v1; tabs across panels are a post-v1 feature.
- **Sidebar attention strip** — passive portraits + status badges. Bundled, not aspect-authored.

Aspect-authored manifests render in a manifest panel by default. A manifest may *request* surface placement via `metadata.surface_hint` (`panel`\|`sidebar`\|`overlay`) but vessel makes the final call. Surface hints help vessel place the manifest sensibly when there's ambiguity (e.g. a small status manifest could go in the sidebar; a full chat-style UI wants a panel).

The avatar surface is never available to aspect-authored manifests. If an aspect's needs require the avatar, it's signalled via the existing speech queue / attention channels — not by emitting a manifest with an `avatar` component.

## 9. Default UIs (bundled, not aspect-authored)

Vessel ships several default UI manifests. They use the same vocabulary but are loaded from vessel's bundle, not over ChatSource. Replacing them requires a vessel update, not a backend change.

- **`avatar-default`** — the v1 main surface: active VRM + portrait sidebar + speech queue indicator + attention pulse. This is the spec.md §7 visual model expressed as a manifest.
- **`chat-default`** — a plain chat-only fallback for backends that don't speak voice/avatar. Useful for testing, headless backends, or accessibility.
- **`harness-claude-code`** — pre-tuned default for the Claude Code adapter, showing tool calls with appropriate iconography, file diffs in a code component, etc. (Phase 6+ but the vocabulary supports it now.)
- **`harness-cursor`**, **`harness-aider`** — analogous, post-v1.

Default UIs prove the vocabulary is sufficient. If the avatar default can't be expressed in the vocabulary, the vocabulary is missing something.

## 10. Trust model — summary

The complete safety story:

1. **No script.** Manifests are pure data; the renderer never executes code from them.
2. **Constrained vocabulary.** Components are vessel-shipped primitives; aspects cannot define new components.
3. **Declared capabilities.** Anything outside the rendered surface is in the manifest header and gated.
4. **User approval.** First render with non-empty capabilities prompts; sticky approval per `(from, capability)`, revocable from settings.
5. **Sandboxed events.** Components emit a typed, finite set of events. Aspects cannot synthesise events that didn't happen.
6. **No surface hijacking.** The avatar surface is reserved; manifest panels are bounded windows; nothing can take over the user's screen without a capability that doesn't exist in v1.

A hostile aspect can render a misleading UI inside its panel (lie about what a button does, request audio recording while pretending to be a status display, etc.). This is a class of risk vessel cannot fully eliminate at the manifest layer — same as any browser, any app. Mitigations:
- The `from` field is always visible in the surface chrome (you always know who's rendering).
- Capability prompts surface the source explicitly.
- Settings UI lists active manifests + their capabilities for review.
- Revocation is one click.

The trust model is: **a manifest is no more dangerous than a webpage from the same origin would be**, with a cleaner permission model. Vessel does not promise it's *safer* than that.

## 11. Open questions

1. **Vocabulary package — `@carriedworlduniverse/vessel-sdk` or `@carriedworlduniverse/vessel-ui-vocab`?** Coupling to SDK lifecycle vs independent versioning. Open question §14 #7 in main spec. Lean: independent package, so manifest schema can evolve independent of adapter SDK; SDK takes a peer dep.
2. **Patch op set scope.** v1 ops cover the cases we can name; will real-world manifest authors hit cases that need more? Defer expansion until empirical pressure.
3. **Form submission semantics.** Today `submit` collects all input values keyed by id. Does the form scope by container? What about multiple `submit` buttons in different panels of the same manifest? Probably scope by nearest enclosing `panel` with a declared `form_id`.
4. **Capability persistence across vessel updates.** If vessel ships a v2 vocabulary that splits or renames a capability, how do existing approvals migrate? Probably a one-time re-prompt on first encounter post-update.
5. **File content streaming.** `file.read` capability exposes `content_ref` handles for backend to fetch on demand. Should there be a streaming variant for very large files (video, multi-GB datasets)? Defer.
6. **Manifest rate limiting.** Without limits, an aspect could spam manifest emits. Vessel should rate-limit per source. Specific numbers TBD; start strict (e.g. 1 manifest/second per `from`) and loosen on need.
7. **Inter-manifest navigation.** v1 forbids cross-manifest references. Does an aspect ever need to chain user through multiple manifests? Probably yes; v2 question.
8. **Test harness.** A manifest playground (vessel runs in dev mode, you paste a manifest JSON, see it render) would massively accelerate vocabulary iteration. Phase 1.5 work.

## 12. Glossary

- **Manifest** — a JSON document describing a UI tree, declared capabilities, and metadata. Authored by a backend (typically an aspect); rendered by vessel.
- **Vocabulary** — the set of named component types vessel's renderer recognises.
- **Component** — a single named primitive in the vocabulary. Has a type, optional id, props, and (for containers) children.
- **Capability** — a declared, gated permission a manifest requests.
- **Surface** — a place in vessel where manifests render. Avatar surface, manifest panel, sidebar.
- **Patch** — an incremental update to an already-rendered manifest, applied without re-rendering from scratch.
- **`from`** — the producer identity on a manifest; drives approval flow and surface chrome.

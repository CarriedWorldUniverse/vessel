// Central reactive state for vessel. Scene and overlays read from here.

export const stageState = {
  // Per-aspect status: 'offline' | 'online' | 'speaking'
  aspects: {
    forge:  { status: 'online' },
    wren:   { status: 'online' },
    harrow: { status: 'online' },
    maren:  { status: 'offline' },
    verity: { status: 'online' },
    keel:   { status: 'online' },
    anvil:  { status: 'online' },
    plumb:  { status: 'offline' },
  },

  // Which aspect is currently speaking (null = nobody)
  activeSpeaker: null,

  // Which aspect the active speaker is addressing (null = operator/general)
  // Derived from message metadata by the connector layer
  addressingAspectId: null,

  // Right panel content for the active speaker
  panelContent: null,

  lastMessageId: 0,

  connection: {
    status: 'disconnected',
    detail: '',
  },

  transcript: '',
};

// Simple pub/sub for state changes
const listeners = [];

export function onStateChange(fn) {
  listeners.push(fn);
}

export function setState(patch) {
  Object.assign(stageState, patch);
  listeners.forEach(fn => fn(stageState));
}

export function patchAspect(name, patch) {
  if (!name) return;
  stageState.aspects[name] = {
    ...(stageState.aspects[name] || { status: 'online' }),
    ...patch,
  };
  listeners.forEach(fn => fn(stageState));
}

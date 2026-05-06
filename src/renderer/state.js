// Central reactive state for vessel. Scene and overlays read from here.
// In Part 4 this gets driven by the broker adapter; for now it's static mock data.

export const stageState = {
  // Per-aspect status: 'offline' | 'online' | 'speaking'
  aspects: {
    forge:  { status: 'online' },
    wren:   { status: 'online' },
    harrow: { status: 'online' },
    maren:  { status: 'offline' },
    verity: { status: 'online' },
    keel:   { status: 'online' },
    anvil:  { status: 'speaking' },
    plumb:  { status: 'offline' },
  },

  // Which aspect is currently speaking (null = nobody)
  activeSpeaker: 'anvil',

  // Right panel content for the active speaker
  panelContent: null,
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

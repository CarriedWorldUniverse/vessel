// Central reactive state for vessel. Scene and overlays read from here.

export const stageState = {
  // Per-aspect status: 'offline' | 'online' | 'speaking'
  aspects: {
    forge:  { status: 'offline' },
    wren:   { status: 'offline' },
    harrow: { status: 'offline' },
    maren:  { status: 'offline' },
    verity: { status: 'offline' },
    keel:   { status: 'offline' },
    anvil:  { status: 'offline' },
    plumb:  { status: 'offline' },
  },

  rosterLoaded: false,

  visibleAspects: [],
  excludedAspects: ['dispatch', 'dispatch-controller', 'dispatch_controller', 'controller', 'operator', 'observer'],
  mutedAspects: [],

  // Which aspect is currently speaking (null = nobody)
  activeSpeaker: null,

  // Which aspect the active speaker is addressing (null = operator/general)
  // Derived from message metadata by the connector layer
  addressingAspectId: null,

  // Right panel content for the active speaker
  panelContent: null,
  response: {
    speaker: '',
    spoken: '',
    detail: '',
  },

  lastMessageId: 0,

  pendingTurns: [],
  responseInbox: [],

  connection: {
    status: 'disconnected',
    detail: '',
  },

  transcript: '',

  inputMode: 'conversation',

  speechSummaryMode: 'heuristic',

  activity: {
    status: 'idle',
    label: 'Idle',
    detail: '',
  },
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

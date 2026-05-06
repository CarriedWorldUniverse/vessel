import * as THREE from '../../node_modules/three/build/three.module.js';
import { stageState, onStateChange } from './state.js';

// camera + spheres injected via init() to avoid circular imports
let camera = null;
let spheres = null;

export function initCamera(cam, sph) {
  camera = cam;
  spheres = sph;
}

// ── Camera rig ────────────────────────────────────────────────────────────────
//
// Two modes:
//   idle    — wide shot, elevated, slow drift. Shows the full table.
//   focused — orbits to face the active speaker. Slight dolly-in.
//
// Transitions are smooth cubic-ease interpolations (~500ms).
// Camera always looks at a point slightly above the table center (the "stage focus").

const STAGE_FOCUS   = new THREE.Vector3(0, 0.8, 0);
const IDLE_POSITION = new THREE.Vector3(0, 3.5, 7);
const FOCUS_RADIUS  = 5.5;   // orbit distance when focused on a speaker
const FOCUS_HEIGHT  = 2.0;   // camera height when focused
const TRANSITION_MS = 500;

// Internal state
let targetPosition = IDLE_POSITION.clone();
let currentSpeaker = null;
let transitionStart = null;
let transitionFrom  = null;
let transitioning   = false;

function speakerPosition(aspectName) {
  const s = spheres.find(s => s.aspect.name === aspectName);
  return s ? s.pos : null;
}

function focusedCameraPosition(seatPos) {
  // Orbit to the opposite side of the table from the speaker's seat,
  // so the camera faces the speaker head-on.
  const dir = new THREE.Vector3(-seatPos.x, 0, -seatPos.z).normalize();
  return new THREE.Vector3(
    dir.x * FOCUS_RADIUS,
    FOCUS_HEIGHT,
    dir.z * FOCUS_RADIUS,
  );
}

function startTransition(toPosition) {
  transitionFrom  = camera.position.clone();
  targetPosition  = toPosition.clone();
  transitionStart = performance.now();
  transitioning   = true;
}

function cubicEaseInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// React to state changes
onStateChange(state => {
  const speaker = state.activeSpeaker;

  if (speaker === currentSpeaker) return;
  currentSpeaker = speaker;

  if (!speaker) {
    // Nobody speaking — return to idle wide shot
    startTransition(IDLE_POSITION);
    return;
  }

  const seatPos = speakerPosition(speaker);
  if (!seatPos) return;

  startTransition(focusedCameraPosition(seatPos));
});

// Called every frame from scene render loop
export function updateCamera() {
  if (!transitioning) return;

  const elapsed = performance.now() - transitionStart;
  const t = Math.min(elapsed / TRANSITION_MS, 1);
  const ease = cubicEaseInOut(t);

  camera.position.lerpVectors(transitionFrom, targetPosition, ease);
  camera.lookAt(STAGE_FOCUS);

  if (t >= 1) transitioning = false;
}

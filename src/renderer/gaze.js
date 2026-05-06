import * as THREE from '../../node_modules/three/build/three.module.js';
import { stageState, onStateChange } from './state.js';

// ── Gaze system ───────────────────────────────────────────────────────────────
//
// For sphere-tier avatars, gaze is implemented as a subtle positional offset —
// the sphere drifts slightly toward whatever it's attending to.
//
// Gaze targets (priority order):
//   1. addressed — this sphere was directly addressed; brief snap toward camera
//   2. peer      — active speaker is addressing this sphere; it perks up
//   3. listening — non-speakers occasionally glance toward the active speaker
//   4. rest      — default; face toward camera (origin looking outward from seat)
//
// The VRM swap (Part 10) replaces the offset logic with bone rotation,
// using the same target-vector contract.

const GAZE_LERP_SPEED  = 3.5;   // how fast the offset interpolates
const GAZE_OFFSET_MAG  = 0.08;  // max offset distance in world units
const GLANCE_INTERVAL_MIN = 8000;   // ms
const GLANCE_INTERVAL_MAX = 20000;  // ms
const PERK_DURATION       = 2000;   // ms — how long a perk-up lasts

let spheres = null;
let camera  = null;

export function initGaze(sph, cam) {
  spheres = sph;
  camera  = cam;
  spheres.forEach(s => {
    s.gaze = {
      targetOffset: new THREE.Vector3(),
      currentOffset: new THREE.Vector3(),
      nextGlanceAt: Date.now() + randomInterval(),
      perkUntil: 0,
    };
  });
}

function randomInterval() {
  return GLANCE_INTERVAL_MIN + Math.random() * (GLANCE_INTERVAL_MAX - GLANCE_INTERVAL_MIN);
}

// Direction vector from seat to a world point, magnitude 1, projected onto XZ
function directionTo(fromPos, toPos) {
  const d = new THREE.Vector3().subVectors(toPos, fromPos);
  d.y = 0;
  return d.normalize();
}

// Direction from seat toward the camera (the operator — "rest" gaze)
function restDirection(seatPos) {
  return directionTo(seatPos, new THREE.Vector3(camera.position.x, seatPos.y, camera.position.z));
}

export function updateGaze(dt) {
  if (!spheres || !camera) return;

  const now = Date.now();
  const state = stageState;
  const activeSpeaker = state.activeSpeaker;
  const addressingId  = state.addressingAspectId ?? null;

  spheres.forEach(s => {
    const g = s.gaze;
    const name = s.aspect.name;
    const status = state.aspects[name]?.status ?? 'offline';

    if (status === 'offline') {
      g.targetOffset.set(0, 0, 0);
    } else if (name === activeSpeaker) {
      // Active speaker looks toward camera (operator) by default
      const dir = restDirection(s.pos);
      g.targetOffset.copy(dir.multiplyScalar(GAZE_OFFSET_MAG));

      // If addressing a peer, look toward their seat instead
      if (addressingId && addressingId !== name) {
        const peer = spheres.find(p => p.aspect.name === addressingId);
        if (peer) {
          const dir2 = directionTo(s.pos, peer.pos);
          g.targetOffset.copy(dir2.multiplyScalar(GAZE_OFFSET_MAG));
        }
      }
    } else if (name === addressingId && activeSpeaker) {
      // Being addressed — perk up toward the speaker
      g.perkUntil = now + PERK_DURATION;
      const speaker = spheres.find(p => p.aspect.name === activeSpeaker);
      if (speaker) {
        const dir = directionTo(s.pos, speaker.pos);
        g.targetOffset.copy(dir.multiplyScalar(GAZE_OFFSET_MAG * 0.7));
      }
    } else if (now < g.perkUntil && activeSpeaker) {
      // Still in perk-up window — maintain gaze toward speaker
      const speaker = spheres.find(p => p.aspect.name === activeSpeaker);
      if (speaker) {
        const dir = directionTo(s.pos, speaker.pos);
        g.targetOffset.copy(dir.multiplyScalar(GAZE_OFFSET_MAG * 0.5));
      }
    } else if (activeSpeaker && now >= g.nextGlanceAt) {
      // Ambient glance at the active speaker, then reset timer
      const speaker = spheres.find(p => p.aspect.name === activeSpeaker);
      if (speaker) {
        const dir = directionTo(s.pos, speaker.pos);
        g.targetOffset.copy(dir.multiplyScalar(GAZE_OFFSET_MAG * 0.4));
      }
      g.nextGlanceAt = now + randomInterval();
    } else if (now >= g.nextGlanceAt) {
      // No active speaker — drift gently back to rest and reset
      const dir = restDirection(s.pos);
      g.targetOffset.copy(dir.multiplyScalar(GAZE_OFFSET_MAG * 0.3));
      g.nextGlanceAt = now + randomInterval();
    } else {
      // Rest pose — face camera
      const dir = restDirection(s.pos);
      g.targetOffset.copy(dir.multiplyScalar(GAZE_OFFSET_MAG));
    }

    // Lerp current offset toward target
    g.currentOffset.lerp(g.targetOffset, dt * GAZE_LERP_SPEED);

    // Apply offset to mesh position (relative to seat position)
    s.mesh.position.set(
      s.pos.x + g.currentOffset.x,
      s.mesh.position.y,  // preserve breathing Y from scene.js
      s.pos.z + g.currentOffset.z,
    );
  });
}

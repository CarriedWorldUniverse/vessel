import * as THREE from '../../node_modules/three/build/three.module.js';
import { ASPECTS } from './aspects.js';
import { stageState, onStateChange } from './state.js';
import { updateCamera, initCamera } from './camera.js';
import { updateGaze, initGaze } from './gaze.js';

// ── Renderer ──────────────────────────────────────────────────────────────────

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  premultipliedAlpha: false,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x07070c, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

// ── Scene + camera ─────────────────────────────────────────────────────────

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
// Default wide-shot position: slightly above and back from table center
camera.position.set(0, 3.5, 7);
camera.lookAt(0, 0.8, 0);

// ── Lighting ──────────────────────────────────────────────────────────────────

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(3, 6, 4);
scene.add(keyLight);

const fillLight = new THREE.PointLight(0x8080ff, 0.3, 20);
fillLight.position.set(-4, 2, -2);
scene.add(fillLight);

// Subtle ground fog — void atmosphere
scene.fog = new THREE.FogExp2(0x050508, 0.07);

// ── Table ─────────────────────────────────────────────────────────────────────

const tableGeo = new THREE.CylinderGeometry(2.2, 2.2, 0.08, 64);
const tableMat = new THREE.MeshStandardMaterial({
  color: 0x1a1a2e,
  roughness: 0.6,
  metalness: 0.3,
  transparent: true,
  opacity: 0.85,
});
const table = new THREE.Mesh(tableGeo, tableMat);
table.position.y = 0;
scene.add(table);

// Table edge glow ring
const ringGeo = new THREE.TorusGeometry(2.2, 0.015, 8, 64);
const ringMat = new THREE.MeshBasicMaterial({ color: 0x3a3a5e, transparent: true, opacity: 0.6 });
const ring = new THREE.Mesh(ringGeo, ringMat);
ring.rotation.x = Math.PI / 2;
ring.position.y = 0.04;
scene.add(ring);

// ── Seat positions (clockwise from 12 o'clock) ───────────────────────────────

const TABLE_RADIUS = 2.8;  // distance from center to seat
const SEAT_Y = 0.9;        // height above floor
const RESERVED_CAMERA_ARC = Math.PI * 0.95;
const FAR_SIDE_CENTER = -Math.PI / 2;

const aspectDefaults = new Map(ASPECTS.map((aspect, index) => [aspect.name, { ...aspect, index }]));

function seatPosition(index, total) {
  // The camera/operator sits at +Z. Seats use the far-side arc centered
  // on -Z so the near end of the table stays empty as operator space.
  const usableArc = Math.PI * 2 - RESERVED_CAMERA_ARC;
  const angle = total <= 1
    ? FAR_SIDE_CENTER
    : FAR_SIDE_CENTER - usableArc / 2 + (index / (total - 1)) * usableArc;
  return new THREE.Vector3(
    Math.cos(angle) * TABLE_RADIUS,
    SEAT_Y,
    Math.sin(angle) * TABLE_RADIUS,
  );
}

// ── Audio-reactive sphere shader ─────────────────────────────────────────────

const sphereVert = /* glsl */`
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uFreq1;
  uniform float uFreq2;
  uniform float uFreq3;
  uniform float uSpeaking;
  uniform float uWave;

  varying vec3 vNormal;
  varying vec3 vPosition;

  // Simple hash for pseudo-random variation per vertex
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vNormal = normal;
    vPosition = position;

    float idle =
      sin(position.x * uFreq1 + uTime * 1.1) * 0.5 +
      sin(position.y * uFreq2 + uTime * 1.7) * 0.3 +
      sin(position.z * uFreq3 + uTime * 0.9) * 0.2;

    float angle = atan(position.z, position.x);
    float travelling = sin(angle * 10.0 + position.y * 18.0 - uTime * 16.0);
    float carrier = sin(position.y * 34.0 + uTime * 10.0);
    float wave = travelling * 0.6 + carrier * 0.4;
    float disp = idle * uAmplitude + wave * uWave * uSpeaking;

    vec3 displaced = position + normal * disp;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const sphereFrag = /* glsl */`
  uniform vec3 uColor;
  uniform float uAmplitude;
  uniform float uOnline;
  uniform float uSpeaking;

  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    // Fresnel rim glow
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.5);

    vec3 baseColor = uColor * (0.3 + uAmplitude * 2.0);
    vec3 rimColor  = uColor * (1.5 + uAmplitude * 3.0);
    float bands = pow(0.5 + 0.5 * sin(vPosition.y * 38.0 + uAmplitude * 80.0), 7.0);
    vec3 speechColor = mix(rimColor, vec3(1.0), 0.35) * (1.0 + bands * 1.1);
    vec3 finalColor = mix(baseColor, rimColor, fresnel);
    finalColor = mix(finalColor, speechColor, uSpeaking * (0.22 + bands * 0.36));

    float alpha = mix(0.25, 0.9, uOnline) + fresnel * (0.3 + uSpeaking * 0.45);
    gl_FragColor = vec4(finalColor, clamp(alpha, 0.0, 1.0));
  }
`;

// ── Sphere instances ──────────────────────────────────────────────────────────

function colorForAspect(name) {
  const known = aspectDefaults.get(name);
  if (known) return known.color;
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  const color = new THREE.Color();
  color.setHSL(hue / 360, 0.72, 0.58);
  return color.getHex();
}

function createSphere(aspect, i, total) {
  const pos = seatPosition(i, total);
  const geo = new THREE.SphereGeometry(0.28, 32, 32);
  const mat = new THREE.ShaderMaterial({
    vertexShader: sphereVert,
    fragmentShader: sphereFrag,
    transparent: true,
    uniforms: {
      uTime:      { value: 0 },
      uAmplitude: { value: 0.04 },   // idle default
      uFreq1:     { value: 3.0 + i * 0.4 },
      uFreq2:     { value: 4.2 + i * 0.3 },
      uFreq3:     { value: 2.8 + i * 0.5 },
      uColor:     { value: new THREE.Color(aspect.color) },
      uOnline:    { value: 0.0 },     // 0 = offline, 1 = online
      uSpeaking:  { value: 0.0 },
      uWave:      { value: 0.0 },
    },
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos);
  scene.add(mesh);

  // Nameplate: simple sprite-like plane with canvas texture
  const label = makeLabel(aspect.name, aspect.color);
  label.position.set(pos.x, pos.y - 0.5, pos.z);
  label.lookAt(0, pos.y - 0.5, 0);  // face table center
  scene.add(label);

  return {
    mesh,
    mat,
    label,
    aspect,
    pos,
    phase: Math.random() * Math.PI * 2,
    gaze: {
      targetOffset: new THREE.Vector3(),
      currentOffset: new THREE.Vector3(),
      nextGlanceAt: Date.now() + 8000 + Math.random() * 12000,
      perkUntil: 0,
    },
  };
}

function disposeSphere(s) {
  scene.remove(s.mesh);
  scene.remove(s.label);
  s.mesh.geometry.dispose();
  s.mat.dispose();
  s.label.geometry.dispose();
  s.label.material.map?.dispose();
  s.label.material.dispose();
}

const spheres = [];
const sphereByName = new Map();

function onlineAspectList() {
  if (!stageState.rosterLoaded) return [];
  const visible = new Set((stageState.visibleAspects || []).map(name => name.toLowerCase()));
  const excluded = new Set((stageState.excludedAspects || []).map(name => name.toLowerCase()));
  return Object.entries(stageState.aspects)
    .filter(([name, aspect]) => {
      const statusVisible = aspect?.status === 'online' || aspect?.status === 'speaking';
      const cleanName = name.toLowerCase();
      return statusVisible
        && !excluded.has(cleanName)
        && (visible.size === 0 || visible.has(cleanName));
    })
    .map(([name]) => ({
      name,
      color: colorForAspect(name),
      order: aspectDefaults.get(name)?.index ?? 1000,
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function syncSpheres() {
  const desired = onlineAspectList();
  const desiredNames = new Set(desired.map(aspect => aspect.name));

  for (const [name, sphere] of [...sphereByName.entries()]) {
    if (!desiredNames.has(name)) {
      disposeSphere(sphere);
      sphereByName.delete(name);
      const index = spheres.indexOf(sphere);
      if (index >= 0) spheres.splice(index, 1);
    }
  }

  desired.forEach((aspect, index) => {
    let sphere = sphereByName.get(aspect.name);
    if (!sphere) {
      sphere = createSphere(aspect, index, desired.length);
      sphereByName.set(aspect.name, sphere);
      spheres.push(sphere);
    }
    sphere.aspect = aspect;
    sphere.pos.copy(seatPosition(index, desired.length));
    sphere.label.position.set(sphere.pos.x, sphere.pos.y - 0.55, sphere.pos.z);
    sphere.label.lookAt(0, sphere.pos.y - 0.55, 0);
  });

  spheres.sort((a, b) => desired.findIndex(aspect => aspect.name === a.aspect.name)
    - desired.findIndex(aspect => aspect.name === b.aspect.name));
}

// ── Nameplate helper ──────────────────────────────────────────────────────────

function makeLabel(name, color) {
  const size = 384;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = 80;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, size, 80);

  const hex = '#' + color.toString(16).padStart(6, '0');
  ctx.font = 'bold 36px system-ui';
  ctx.textAlign = 'center';
  ctx.fillStyle = hex;
  ctx.globalAlpha = 1;
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 8;
  ctx.fillText(name, size / 2, 52);

  const tex = new THREE.CanvasTexture(cv);
  const geo = new THREE.PlaneGeometry(1.2, 0.25);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  return new THREE.Mesh(geo, mat);
}

// ── State → sphere parameters ─────────────────────────────────────────────────

// Target amplitudes per state
const AMP = { offline: 0.01, online: 0.035, speaking: 0.075 };

// Smoothly interpolate amplitude toward target
function updateSphereState(s, dt) {
  const aspect = stageState.aspects[s.aspect.name];
  const status = aspect?.status ?? 'offline';

  const targetAmp = AMP[status] ?? AMP.online;
  const targetOnline = status === 'offline' ? 0.0 : 1.0;
  const targetSpeaking = status === 'speaking' ? 1.0 : 0.0;
  const speechBeat = 0.55 + Math.sin(s.mat.uniforms.uTime.value * 9.0 + s.phase) * 0.28
    + Math.sin(s.mat.uniforms.uTime.value * 17.0 + s.phase * 1.7) * 0.17;
  const targetWave = status === 'speaking' ? 0.075 * speechBeat : 0.0;

  // Lerp amplitude and online flag
  s.mat.uniforms.uAmplitude.value += (targetAmp - s.mat.uniforms.uAmplitude.value) * dt * 4;
  s.mat.uniforms.uOnline.value    += (targetOnline - s.mat.uniforms.uOnline.value) * dt * 3;
  s.mat.uniforms.uSpeaking.value  += (targetSpeaking - s.mat.uniforms.uSpeaking.value) * dt * 6;
  s.mat.uniforms.uWave.value      += (targetWave - s.mat.uniforms.uWave.value) * dt * 10;

  // Idle breathing: gentle Y bob
  const breathAmp = status === 'offline' ? 0.005 : 0.02;
  const breathSpeed = status === 'speaking' ? 2.5 : 1.0;
  s.mesh.position.y = s.pos.y + Math.sin(s.mat.uniforms.uTime.value * breathSpeed + s.phase) * breathAmp;
  const scale = 1.0 + s.mat.uniforms.uSpeaking.value * (0.12 + speechBeat * 0.05);
  s.mesh.scale.setScalar(scale);
}

// ── Resize ────────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

onStateChange(() => {
  syncSpheres();
});

// ── Render loop ───────────────────────────────────────────────────────────────

const clock = new THREE.Clock();
let lastRenderAt = 0;
const FRAME_INTERVAL = 1000 / 30;

function animate() {
  requestAnimationFrame(animate);
  const nowMs = performance.now();
  if (nowMs - lastRenderAt < FRAME_INTERVAL) return;
  lastRenderAt = nowMs;
  const dt = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  spheres.forEach(s => {
    s.mat.uniforms.uTime.value = elapsed;
    updateSphereState(s, dt);
  });

  updateCamera();
  updateGaze(dt);
  renderer.render(scene, camera);
}

// Wire camera rig and gaze system after spheres are created
syncSpheres();
initCamera(camera, spheres);
initGaze(spheres, camera);

animate();

export { scene, camera, renderer, spheres, seatPosition };

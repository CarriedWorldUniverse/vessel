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

const rimLight = new THREE.DirectionalLight(0x7bdfff, 0.45);
rimLight.position.set(-3, 3, -4);
scene.add(rimLight);

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

const TABLE_RADIUS = 1.62; // distance from center to slime on tabletop
const TABLE_SURFACE_Y = 0.09;
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
    TABLE_SURFACE_Y,
    Math.sin(angle) * TABLE_RADIUS,
  );
}

// ── Audio-reactive slime shader ──────────────────────────────────────────────

const sphereVert = /* glsl */`
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uFreq1;
  uniform float uFreq2;
  uniform float uFreq3;
  uniform float uSpeaking;
  uniform float uWave;
  uniform float uSquash;

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
    float lowerBulge = smoothstep(0.45, -0.55, position.y);
    float crownTaper = smoothstep(-0.1, 0.72, position.y);
    float disp = idle * uAmplitude + wave * uWave * uSpeaking + lowerBulge * uSquash * 0.04 - crownTaper * uSquash * 0.018;

    vec3 displaced = position + normal * disp;
    displaced.y *= 1.0 - uSquash * 0.13;
    displaced.xz *= 1.0 + uSquash * 0.09;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const sphereFrag = /* glsl */`
  uniform vec3 uColor;
  uniform float uAmplitude;
  uniform float uOnline;
  uniform float uSpeaking;
  uniform float uMuted;

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
    finalColor = mix(finalColor, vec3(0.38, 0.40, 0.46), uMuted * 0.72);

    float alpha = mix(0.25, 0.86, uOnline) + fresnel * (0.3 + uSpeaking * 0.45);
    alpha *= mix(1.0, 0.58, uMuted);
    gl_FragColor = vec4(finalColor, clamp(alpha, 0.0, 1.0));
  }
`;

// ── Slime instances ───────────────────────────────────────────────────────────

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

function makeEyePair(color) {
  const group = new THREE.Group();
  const eyeGeo = new THREE.SphereGeometry(0.035, 12, 8);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xf7fbff });
  const pupilGeo = new THREE.SphereGeometry(0.017, 10, 6);
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x071019 });
  const glintGeo = new THREE.SphereGeometry(0.006, 6, 4);
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const glowMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glowGeo = new THREE.SphereGeometry(0.052, 12, 8);

  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    const glow = new THREE.Mesh(glowGeo, glowMat);
    const white = new THREE.Mesh(eyeGeo, eyeMat);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    const glint = new THREE.Mesh(glintGeo, glintMat);
    pupil.position.set(0, -0.002, 0.028);
    glint.position.set(-0.008, 0.012, 0.04);
    eye.add(glow, white, pupil, glint);
    eye.position.set(side * 0.105, 0.37, 0.235);
    eye.scale.set(1.04, 0.82, 0.9);
    group.add(eye);
  }
  return group;
}

function makeMouth() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.strokeStyle = 'rgba(7, 12, 18, 0.9)';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(36, 28);
  ctx.quadraticCurveTo(64, 44, 92, 28);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.09), mat);
  mesh.position.set(0, 0.245, 0.254);
  return mesh;
}

function makeCrest(color, kind) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.18,
    roughness: 0.48,
    metalness: kind === 'anvil' ? 0.45 : 0.04,
    transparent: true,
    opacity: 0.86,
  });
  if (kind === 'anvil') {
    const geo = new THREE.BoxGeometry(0.16, 0.055, 0.08);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 0.64, 0.01);
    mesh.rotation.z = Math.PI * 0.08;
    return mesh;
  }
  if (kind === 'plumb') {
    const geo = new THREE.TorusGeometry(0.095, 0.014, 8, 28, Math.PI * 1.45);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 0.63, 0.01);
    mesh.rotation.set(Math.PI * 0.15, 0, Math.PI * 0.12);
    return mesh;
  }
  if (kind === 'shadow') {
    const geo = new THREE.ConeGeometry(0.075, 0.18, 5);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 0.68, 0.005);
    mesh.rotation.z = Math.PI;
    return mesh;
  }
  const geo = new THREE.SphereGeometry(0.055, 12, 8);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0.65, 0.005);
  return mesh;
}

function createSphere(aspect, i, total) {
  const pos = seatPosition(i, total);
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.3, 36, 32);
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
      uSquash:    { value: 0.0 },
      uMuted:     { value: 0.0 },
    },
  });

  const body = new THREE.Mesh(geo, mat);
  body.scale.set(1.14, 1.0, 1.0);
  body.position.y = 0.31;
  group.add(body);

  const color = new THREE.Color(aspect.color);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 40), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.006;
  shadow.scale.set(1.18, 0.72, 1.0);
  group.add(shadow);

  const contactMat = new THREE.MeshBasicMaterial({
    color: aspect.color,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const contact = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.39, 48), contactMat);
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.009;
  contact.scale.set(1.08, 0.68, 1.0);
  group.add(contact);

  const eyes = makeEyePair(aspect.color);
  const mouth = makeMouth();
  const crest = makeCrest(aspect.color, aspect.name);
  group.add(eyes, mouth, crest);

  group.position.copy(pos);
  scene.add(group);

  // Nameplate: simple sprite-like plane with canvas texture
  const label = makeLabel(aspect.name, aspect.color);
  label.position.set(pos.x, pos.y - 0.08, pos.z);
  label.lookAt(camera.position);
  scene.add(label);

  return {
    mesh: group,
    body,
    mat,
    label,
    eyes,
    mouth,
    crest,
    shadow,
    contact,
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
  s.mesh.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      child.material.map?.dispose();
      child.material.dispose();
    }
  });
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
    sphere.label.position.set(sphere.pos.x, sphere.pos.y - 0.08, sphere.pos.z);
    sphere.label.lookAt(camera.position);
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
  ctx.font = 'bold 42px system-ui';
  ctx.textAlign = 'center';
  ctx.fillStyle = hex;
  ctx.globalAlpha = 1;
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 8;
  ctx.fillText(name, size / 2, 54);

  const tex = new THREE.CanvasTexture(cv);
  const geo = new THREE.PlaneGeometry(1.42, 0.3);
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
  const muted = (stageState.mutedAspects || []).includes(s.aspect.name.toLowerCase()) ? 1.0 : 0.0;

  const targetAmp = AMP[status] ?? AMP.online;
  const targetOnline = status === 'offline' ? 0.0 : 1.0;
  const targetSpeaking = status === 'speaking' ? 1.0 : 0.0;
  const speechBeat = 0.55 + Math.sin(s.mat.uniforms.uTime.value * 9.0 + s.phase) * 0.28
    + Math.sin(s.mat.uniforms.uTime.value * 17.0 + s.phase * 1.7) * 0.17;
  const targetWave = status === 'speaking' ? 0.075 * speechBeat : 0.0;
  const targetSquash = status === 'speaking'
    ? 0.38 + speechBeat * 0.18
    : 0.12 + Math.sin(s.mat.uniforms.uTime.value * 1.4 + s.phase) * 0.05;

  // Lerp amplitude and online flag
  s.mat.uniforms.uAmplitude.value += (targetAmp - s.mat.uniforms.uAmplitude.value) * dt * 4;
  s.mat.uniforms.uOnline.value    += (targetOnline - s.mat.uniforms.uOnline.value) * dt * 3;
  s.mat.uniforms.uSpeaking.value  += (targetSpeaking - s.mat.uniforms.uSpeaking.value) * dt * 6;
  s.mat.uniforms.uWave.value      += (targetWave - s.mat.uniforms.uWave.value) * dt * 10;
  s.mat.uniforms.uSquash.value    += (targetSquash - s.mat.uniforms.uSquash.value) * dt * 5;
  s.mat.uniforms.uMuted.value     += (muted - s.mat.uniforms.uMuted.value) * dt * 5;

  // Idle breathing: gentle Y bob
  const breathAmp = status === 'offline' ? 0.0015 : 0.006;
  const breathSpeed = status === 'speaking' ? 2.5 : 1.0;
  s.mesh.position.y = s.pos.y + Math.sin(s.mat.uniforms.uTime.value * breathSpeed + s.phase) * breathAmp;
  const speak = s.mat.uniforms.uSpeaking.value;
  const squash = s.mat.uniforms.uSquash.value;
  const scale = 1.0 + speak * (0.09 + speechBeat * 0.04);
  s.body.scale.set(1.14 + squash * 0.13, 1.0 - squash * 0.16, 1.0 + squash * 0.1);
  s.body.position.y = 0.31 + squash * -0.018;
  s.mesh.scale.set(scale * (1 + muted * -0.08), scale, scale * (1 + muted * -0.08));
  s.eyes.position.y = 0.02 + speak * 0.018;
  s.eyes.scale.y = 1.0 + speak * 0.16;
  s.mouth.scale.set(1.0 + speak * 0.42, 1.0 + speak * (0.9 + speechBeat * 0.5), 1.0);
  s.mouth.visible = muted < 0.7;
  s.crest.rotation.y += dt * (status === 'speaking' ? 0.9 : 0.25);
  s.shadow.scale.set(1.18 + squash * 0.32, 0.72 + squash * 0.18, 1.0);
  s.contact.scale.set(1.08 + squash * 0.2, 0.68 + squash * 0.1, 1.0);
  s.contact.material.opacity = 0.1 + speak * 0.1 - muted * 0.05;
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

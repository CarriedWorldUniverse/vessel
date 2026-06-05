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
  alpha: true,          // transparent background
  premultipliedAlpha: false,
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);  // fully transparent clear

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

function seatPosition(index, total) {
  // Start at -π/2 (12 o'clock) and go clockwise
  const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
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

    // Layered sine displacement to simulate audio-reactive surface
    float disp =
      sin(position.x * uFreq1 + uTime * 1.1) * 0.5 +
      sin(position.y * uFreq2 + uTime * 1.7) * 0.3 +
      sin(position.z * uFreq3 + uTime * 0.9) * 0.2;

    disp *= uAmplitude;

    vec3 displaced = position + normal * disp;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const sphereFrag = /* glsl */`
  uniform vec3 uColor;
  uniform float uAmplitude;
  uniform float uOnline;

  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    // Fresnel rim glow
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.5);

    vec3 baseColor = uColor * (0.3 + uAmplitude * 2.0);
    vec3 rimColor  = uColor * (1.5 + uAmplitude * 3.0);
    vec3 finalColor = mix(baseColor, rimColor, fresnel);

    float alpha = mix(0.25, 0.9, uOnline) + fresnel * 0.3;
    gl_FragColor = vec4(finalColor, clamp(alpha, 0.0, 1.0));
  }
`;

// ── Sphere instances ──────────────────────────────────────────────────────────

const spheres = ASPECTS.map((aspect, i) => {
  const pos = seatPosition(i, ASPECTS.length);

  const geo = new THREE.SphereGeometry(0.28, 48, 48);
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

  return { mesh, mat, label, aspect, pos, phase: Math.random() * Math.PI * 2 };
});

// ── Nameplate helper ──────────────────────────────────────────────────────────

function makeLabel(name, color) {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = 48;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, size, 48);

  const hex = '#' + color.toString(16).padStart(6, '0');
  ctx.font = 'bold 22px system-ui';
  ctx.textAlign = 'center';
  ctx.fillStyle = hex;
  ctx.globalAlpha = 0.9;
  ctx.fillText(name, size / 2, 32);

  const tex = new THREE.CanvasTexture(cv);
  const geo = new THREE.PlaneGeometry(0.8, 0.15);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  return new THREE.Mesh(geo, mat);
}

// ── State → sphere parameters ─────────────────────────────────────────────────

// Target amplitudes per state
const AMP = { offline: 0.01, online: 0.04, speaking: 0.14 };

// Smoothly interpolate amplitude toward target
function updateSphereState(s, dt) {
  const aspect = stageState.aspects[s.aspect.name];
  const status = aspect?.status ?? 'offline';

  const targetAmp = AMP[status] ?? AMP.online;
  const targetOnline = status === 'offline' ? 0.0 : 1.0;

  // Lerp amplitude and online flag
  s.mat.uniforms.uAmplitude.value += (targetAmp - s.mat.uniforms.uAmplitude.value) * dt * 4;
  s.mat.uniforms.uOnline.value    += (targetOnline - s.mat.uniforms.uOnline.value) * dt * 3;

  // Idle breathing: gentle Y bob
  const breathAmp = status === 'offline' ? 0.005 : 0.02;
  const breathSpeed = status === 'speaking' ? 2.5 : 1.0;
  s.mesh.position.y = s.pos.y + Math.sin(s.mat.uniforms.uTime.value * breathSpeed + s.phase) * breathAmp;
}

// ── Resize ────────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Render loop ───────────────────────────────────────────────────────────────

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
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
initCamera(camera, spheres);
initGaze(spheres, camera);

animate();

export { scene, camera, renderer, spheres, seatPosition };

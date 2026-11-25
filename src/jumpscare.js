// =====================================================================
//  ECHO — jumpscare.js
//  What happens when the Listener catches you:
//    1. STARE   – total silence, a sharp inhale, two white eyes staring
//    2. LUNGE   – shriek + boom + red flash, the face rushes at you
//    3. JAWS    – you are inside its mouth: rows of low-poly grey teeth
//    4. CHOMP   – the jaws bite down three times, each closer than the last
//    5. BLACK   – the final bite cuts to black, your ears ring
//  No blood or gore: just teeth, darkness and noise.
// =====================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildHead } from './creature.js';

const J = CONFIG.jumpscare;

// Timeline (seconds since being caught)
const STARE_END = 0.35;    // the silent stare ends, the lunge begins
const LUNGE_END = 0.62;    // the face fills the screen: switch to the jaws
const END_TIME = 2.6;      // show the Game Over screen

// Jaw keyframes: [time, spread (how far apart the jaws are), distance]
// A spread of about 0.1 or less means the teeth are interlocked (bitten shut).
const JAW_KEYS = [
  [0.62, 0.62, -1.6],
  [0.80, 0.62, -0.85],
  [0.87, 0.10, -0.70],   // CHOMP 1
  [0.95, 0.10, -0.70],
  [1.18, 0.52, -0.62],
  [1.25, 0.08, -0.52],   // CHOMP 2
  [1.32, 0.08, -0.52],
  [1.55, 0.52, -0.50],
  [1.61, 0.04, -0.38],   // CHOMP 3 (final)
  [99, 0.04, -0.38],
];
const CHOMP_TIMES = [0.87, 1.25, 1.61];

// ---------------------------------------------------------------------
// Flat-shaded grey material for teeth and gums (low-poly look).
// The face normal comes from screen-space derivatives, so every
// triangle gets one flat shade, like a low-poly sculpture.
// ---------------------------------------------------------------------
const toothFlash = { value: 0 }; // shared: red tint pulse on each bite

function toothMaterial(grey) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(grey, grey, grey * 1.03) }, uFlash: toothFlash },
    side: THREE.DoubleSide,
    transparent: true, // fully opaque, but drawn in the late stage (see buildRig)
    vertexShader: /* glsl */ `
      varying vec3 vViewPos;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uFlash;
      varying vec3 vViewPos;
      void main() {
        vec3 n = normalize(cross(dFdx(vViewPos), dFdy(vViewPos))); // flat face normal
        float light = abs(dot(n, normalize(vec3(0.25, 0.8, 0.55))));
        float depth = clamp(1.25 - (-vViewPos.z) * 0.7, 0.15, 1.0);  // deeper = darker
        vec3 col = uColor * (0.12 + 0.88 * light) * depth;
        gl_FragColor = vec4(col + uFlash * vec3(0.08, 0.0, 0.0), 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------
// Jaw building
// ---------------------------------------------------------------------

// One curved row of teeth. dir = -1 points them down (upper jaw), +1 up.
function addToothRow(jaw, mats, { radius, count, size, offset, dir }) {
  const span = 3.3; // radians: the row wraps around beside your head
  for (let i = 0; i < count; i++) {
    const a = -span / 2 + ((i + offset) / count) * span;
    const front = Math.cos(a);                       // 1 at the front, less at the sides
    const h = (0.12 + 0.16 * front + Math.random() * 0.07) * size; // front fangs longest
    const r = (0.028 + 0.016 * front + Math.random() * 0.01) * size;
    const cone = new THREE.ConeGeometry(r, h, 4 + (i % 2)); // 4-5 sides = low poly
    cone.translate(0, h / 2, 0);                     // base at 0, tip at +h
    if (dir < 0) cone.rotateX(Math.PI);              // upper teeth point down
    const holder = new THREE.Group();
    holder.position.set(Math.sin(a) * radius, 0, -Math.cos(a) * radius);
    holder.rotation.y = -a;                          // face the middle of the mouth
    const tooth = new THREE.Mesh(cone, mats.tooth);
    const lean = 0.25 + Math.random() * 0.25;        // tips lean inward, toward you
    tooth.rotation.set(dir > 0 ? lean : -lean, Math.random() * 1.5, (Math.random() - 0.5) * 0.3);
    holder.add(tooth);
    const gum = new THREE.Mesh(new THREE.BoxGeometry((span / count) * radius * 1.15, 0.08, 0.14), mats.gum);
    gum.position.y = -dir * 0.035;
    holder.add(gum);
    jaw.add(holder);
  }
}

// A jaw = two rows of teeth: big outer fangs, smaller inner teeth.
function buildJaw(upper, mats) {
  const jaw = new THREE.Group();
  const dir = upper ? -1 : 1;
  addToothRow(jaw, mats, { radius: 0.56, count: 15, size: 1.0, offset: upper ? 0 : 0.5, dir });
  addToothRow(jaw, mats, { radius: 0.44, count: 12, size: 0.6, offset: upper ? 0.5 : 0, dir });
  return jaw;
}

// ---------------------------------------------------------------------
// The jumpscare player
// ---------------------------------------------------------------------
export class Jumpscare {
  constructor({ camera, renderer, scene, audio, ui, fx, mats, voidMat }) {
    Object.assign(this, { camera, audio, ui, fx });
    this.baseFov = camera.fov;
    this.head = buildHead({ surface: voidMat, line: mats.scareLine }, mats.scareEye, 1);
    this.rig = this.buildRig();
    camera.add(this.head, this.rig);
    // compile the shaders now, so the scare doesn't stutter the first time
    renderer.compile(scene, camera);
    this.head.visible = this.rig.visible = false;
    this.active = false;
  }

  buildRig() {
    const mats = { tooth: toothMaterial(0.28), gum: toothMaterial(0.07) };
    const rig = new THREE.Group();
    this.upper = buildJaw(true, mats);
    this.lower = buildJaw(false, mats);
    // You are INSIDE its mouth: a black sphere around you is drawn after the
    // mine, always on top (depthFunc Always), wiping out everything behind
    // it. Then the teeth are drawn over that.
    // (cavity and teeth are drawn in the late "transparent" stage, after the
    //  flickering dust too, so nothing from the mine shows through)
    const cavityMat = new THREE.MeshBasicMaterial({
      color: 0x000000, side: THREE.BackSide, depthFunc: THREE.AlwaysDepth, transparent: true,
    });
    const cavity = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 8), cavityMat);
    cavity.renderOrder = 10;
    rig.add(this.upper, this.lower, cavity);
    rig.traverse((o) => {
      o.layers.set(1);                       // not part of the depth pre-pass
      if (o !== cavity && o.isMesh) o.renderOrder = 11;
    });
    return rig;
  }

  start() {
    this.active = true;
    this.t = 0;
    this.shake = 0;
    this.fovKick = 0;
    this.nextChomp = 0;
    this.shrieked = false;
    this.baseRot = this.camera.rotation.clone();
    this.head.visible = true;
    this.head.scale.setScalar(1);
    this.rig.visible = false;
    this.audio.silenceAmbience();   // the whole mine goes quiet...
    this.audio.sharpInhale();       // ...except a breath right next to you
    this.ui.setFear(0.6);
    this.ui.setHud(false);
    this.update(0);
  }

  // Returns true when the scare is over.
  update(dt) {
    const t = (this.t += dt);
    if (t < STARE_END) this.stare();
    else if (t < LUNGE_END) this.lunge(t);
    else this.chomping(t);
    this.applyCameraEffects(dt);
    if (t > END_TIME) { this.stop(); return true; }
    return false;
  }

  stare() {
    this.head.position.set(0, -0.3, -2.2);
    this.head.rotation.set(0.1, 0, 0.35); // head cocked, perfectly still
  }

  lunge(t) {
    if (!this.shrieked) {
      this.shrieked = true;
      this.audio.shriek();
      this.audio.boom();
      this.ui.flash('rgba(255,0,0,0.9)', 450); // the only bright flash
      this.ui.setFear(0.9);
      this.shake = 0.05;
    }
    const k = (t - STARE_END) / (LUNGE_END - STARE_END);
    this.head.position.set(0, -0.3, -2.2 + 1.9 * k * k);
    this.head.rotation.set(0.1, 0, 0.35 * (1 - k));
    this.head.scale.setScalar(1 + k * 0.6);
  }

  chomping(t) {
    if (!this.rig.visible) {
      this.head.visible = false;
      this.rig.visible = true;
      this.audio.growl(END_TIME - LUNGE_END);
    }
    const [spread, dist] = sampleKeys(t);
    this.upper.position.y = spread;
    this.lower.position.y = -spread;
    this.rig.position.set(0, 0, dist);
    // teeth quiver with rage
    this.rig.rotation.z = (Math.random() - 0.5) * 0.04;
    if (this.nextChomp < CHOMP_TIMES.length && t >= CHOMP_TIMES[this.nextChomp]) this.chomp();
  }

  chomp() {
    const n = this.nextChomp++;
    const final = n === CHOMP_TIMES.length - 1;
    this.audio.chomp(0.7 + n * 0.15);
    this.shake = 0.13 + n * 0.04;
    this.fovKick = 14;
    toothFlash.value = 1;
    this.fx.uniforms.uFear.value = 2.2;  // colours tear apart for a moment
    if (final) {
      this.ui.setBlack(true);          // bitten. black.
      this.audio.tinnitus();
    } else {
      this.ui.flash('rgba(0,0,0,0.55)', 200);
    }
  }

  // Camera shake, zoom punch and the colour-split effect, all fading out.
  applyCameraEffects(dt) {
    const s = this.shake * J.shake;
    const c = this.camera;
    c.rotation.set(
      this.baseRot.x + (Math.random() - 0.5) * s,
      this.baseRot.y + (Math.random() - 0.5) * s,
      this.baseRot.z + (Math.random() - 0.5) * s * 1.5, 'YXZ');
    this.shake = Math.max(0.012, this.shake * Math.exp(-dt * 5));
    this.fovKick *= Math.exp(-dt * 9);
    c.fov = this.baseFov - this.fovKick * J.shake;
    c.updateProjectionMatrix();
    toothFlash.value *= Math.exp(-dt * 8);
    this.fx.uniforms.uFear.value = Math.max(1, this.fx.uniforms.uFear.value * Math.exp(-dt * 10));
  }

  stop() {
    this.active = false;
    this.head.visible = this.rig.visible = false;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    toothFlash.value = 0;
  }
}

// Linear interpolation between the jaw keyframes.
function sampleKeys(t) {
  for (let i = 0; i < JAW_KEYS.length - 1; i++) {
    const [t0, s0, d0] = JAW_KEYS[i], [t1, s1, d1] = JAW_KEYS[i + 1];
    if (t <= t1) {
      const k = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
      return [s0 + (s1 - s0) * k, d0 + (d1 - d0) * k];
    }
  }
  return [JAW_KEYS[JAW_KEYS.length - 1][1], JAW_KEYS[JAW_KEYS.length - 1][2]];
}

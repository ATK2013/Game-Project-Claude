// =====================================================================
//  ECHO — jumpscare.js
//  What happens when the Listener catches you:
//    1. STARE  – total silence, a sharp inhale, two white eyes staring
//    2. LUNGE  – shriek + boom + one red flash, the face rushes at you
//    3. SHAKE  – the face thrashes violently across the screen: it snaps
//                to new spots, whips side to side, lurches at you, with
//                smeared after-images and a rattling, distorted scream
//    4. BLACK  – everything cuts to black, your ears ring
//  No blood or gore — just a face, darkness and noise.
// =====================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildHead } from './creature.js';
import { vibrate } from './touch.js';

const J = CONFIG.jumpscare;

// Timeline (seconds since being caught)
// (each part's length is set in CONFIG.jumpscare)
const STARE_END = J.stareTime;               // the silent stare ends, the lunge begins
const LUNGE_END = STARE_END + J.lungeTime;   // the face is in yours: the shaking begins
const SHAKE_END = LUNGE_END + J.shakeTime;   // cut to black
const END_TIME = SHAKE_END + J.blackTime;    // show the Game Over screen
const GHOSTS = 3;                     // after-images trailing behind the face
const rand = (size) => (Math.random() - 0.5) * size;

export class Jumpscare {
  constructor({ camera, renderer, scene, audio, ui, fx, mats, voidMat }) {
    Object.assign(this, { camera, audio, ui, fx, mats });
    this.baseFov = camera.fov;
    this.head = buildHead({ surface: voidMat, line: mats.scareLine }, mats.scareEye, 1);
    camera.add(this.head);
    // after-images: only their outline and eyes show (invisible surfaces)
    const see = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.ghosts = [];
    for (let i = 0; i < GHOSTS; i++) {
      const g = buildHead({ surface: see, line: mats.scareGhostLine }, mats.scareGhostEye, 1);
      g.traverse((o) => { if (o.isMesh) o.layers.set(1); }); // keep out of the depth pre-pass
      camera.add(g);
      this.ghosts.push(g);
    }
    // compile the shaders now, so the scare doesn't stutter the first time
    renderer.compile(scene, camera);
    this.hideAll();
    this.active = false;
  }

  hideAll() {
    this.head.visible = false;
    for (const g of this.ghosts) g.visible = false;
  }

  start() {
    this.active = true;
    this.t = 0;
    this.shake = 0;
    this.fovKick = 0;
    this.phase = 'stare';
    this.jerkTimer = 0;
    this.history = [];               // recent face poses, for the after-images
    this.baseRot = this.camera.rotation.clone();
    this.head.visible = true;
    this.head.scale.setScalar(1);
    this.audio.silenceAmbience();    // the whole mine goes quiet...
    this.audio.sharpInhale();        // ...except a breath right next to you
    this.ui.setFear(0.6);
    this.ui.setHud(false);
    this.update(0);
  }

  // Returns true when the scare is over.
  update(dt) {
    const t = (this.t += dt);
    if (t < STARE_END) this.stare();
    else if (t < LUNGE_END) this.lunge(t);
    else if (t < SHAKE_END) this.shakeFace(t, dt);
    else this.blackout();
    this.updateGhosts();
    this.applyCameraEffects(dt);
    if (t > END_TIME) { this.stop(); return true; }
    return false;
  }

  stare() {
    this.head.position.set(0, -0.3, -2.2);
    this.head.rotation.set(0.1, 0, 0.35); // head cocked, perfectly still
  }

  lunge(t) {
    if (this.phase === 'stare') {
      this.phase = 'lunge';
      this.audio.scareBoost(true);
      this.audio.shriek(SHAKE_END - STARE_END); // lasts until the screen goes black
      this.audio.boom();
      this.ui.flash('rgba(255,0,0,0.9)', 450); // the only bright flash
      this.ui.setFear(0.9);
      this.shake = 0.06;
    }
    const k = (t - STARE_END) / (LUNGE_END - STARE_END);
    this.head.position.set(rand(0.03), -0.3, -2.2 + 1.2 * k * k);
    this.head.rotation.set(0.1, rand(0.2), 0.35 * (1 - k));
    this.head.scale.setScalar(1 + k * 0.5);
  }

  // The face thrashes around the screen.
  shakeFace(t, dt) {
    const k = Math.max(0.3, J.faceShake);
    if (this.phase !== 'shake') {
      this.phase = 'shake';
      this.audio.violentScream(SHAKE_END - LUNGE_END);
      vibrate(Math.round(J.shakeTime * 1000));
      this.ui.setFear(1);
    }
    // every 40-110 ms it SNAPS to a new spot across the screen
    // (staying about a metre away so you see the whole face, with the odd lurch closer)
    if ((this.jerkTimer -= dt) <= 0) {
      this.jerkTimer = 0.04 + Math.random() * 0.07;
      const lurch = Math.random() < 0.2;
      this.pose = {
        x: rand(0.7) * k, y: rand(0.32) * k, z: lurch ? -0.7 : -1.15 + Math.random() * 0.3,
        roll: rand(1.0) * k, nod: rand(0.4) * k, scale: 1.0 + Math.random() * 0.3,
      };
      this.shake = Math.max(this.shake, 0.07);
      this.fovKick = 5;
      this.fx.uniforms.uFear.value = 1.5 + Math.random() * 1.5; // colours tear apart
      this.mats.scareLine.uniforms.uForceLit.value = 0.05 + Math.random() * 0.35; // outline flickers
    }
    // ...and on top of that it whips its head side to side, impossibly fast
    const whip = Math.sin(t * Math.PI * 2 * 19);
    const p = this.pose;
    this.head.position.set(p.x + whip * 0.04 * k, -0.3 + p.y, p.z);
    this.head.rotation.set(0.1 + p.nod, whip * 0.6 * k, p.roll);
    this.head.scale.setScalar(p.scale);
  }

  blackout() {
    if (this.phase === 'black') return;
    this.phase = 'black';
    this.hideAll();
    this.ui.setBlack(true);          // gone. black.
    this.audio.tinnitus();
    this.audio.scareBoost(false);
  }

  // Each after-image copies where the face was a few frames ago.
  updateGhosts() {
    const h = this.head;
    this.history.push({ pos: h.position.clone(), rot: h.rotation.clone(), scale: h.scale.x });
    if (this.history.length > 16) this.history.shift();
    this.ghosts.forEach((g, i) => {
      const old = this.history[this.history.length - 1 - (i + 1) * 3];
      g.visible = this.phase === 'shake' && !!old;
      if (!old) return;
      g.position.copy(old.pos);
      g.rotation.copy(old.rot);
      g.scale.setScalar(old.scale);
    });
  }

  // Camera shake, zoom punch and the colour-split effect, all fading out.
  applyCameraEffects(dt) {
    const s = this.shake * J.shake;
    const c = this.camera;
    c.rotation.set(this.baseRot.x + rand(s), this.baseRot.y + rand(s), this.baseRot.z + rand(s * 1.5), 'YXZ');
    this.shake = Math.max(0.012, this.shake * Math.exp(-dt * 5));
    this.fovKick *= Math.exp(-dt * 9);
    c.fov = this.baseFov - this.fovKick * J.shake;
    c.updateProjectionMatrix();
    this.fx.uniforms.uFear.value = Math.max(1, this.fx.uniforms.uFear.value * Math.exp(-dt * 10));
  }

  stop() {
    this.active = false;
    this.hideAll();
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.mats.scareLine.uniforms.uForceLit.value = 0.07;
    this.audio.scareBoost(false);
  }
}

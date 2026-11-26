// =====================================================================
//  ECHO — player.js
//  First-person movement: mouse look, WASD, running, creeping,
//  collisions and footsteps.
// =====================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';

const P = CONFIG.player;

export class Player {
  constructor(camera, level) {
    this.camera = camera;
    this.level = level;
    const start = level.toWorld(level.start[0], level.start[1]);
    this.position = new THREE.Vector3(start.x, 0, start.z); // feet position
    this.velocity = new THREE.Vector3();
    this.yaw = this.faceOpenDirection();
    this.pitch = 0;
    this.mode = 'walk';        // 'walk' | 'run' | 'creep'
    this.strideLeft = P.strideWalk; // metres until the next footstep
    this.bobPhase = 0;
    this.onFootstep = null;    // set by main.js: called with the current mode
    this.applyCamera();
  }

  // Look down a tunnel at the start instead of at a wall.
  faceOpenDirection() {
    const [x, z] = this.level.start;
    if (this.level.isOpen(x + 1, z)) return -Math.PI / 2; // face +x
    if (this.level.isOpen(x, z + 1)) return Math.PI;      // face +z
    return 0;
  }

  // Mouse movement -> turn the head.
  look(dx, dy) {
    this.yaw -= dx * P.mouseSensitivity;
    this.pitch -= dy * P.mouseSensitivity;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }

  // Unit vectors pointing forward and right (flat on the floor).
  forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right() { return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }

  // Which way the keys say we want to go (length 0 or 1).
  wishDirection(input) {
    const dir = new THREE.Vector3();
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) dir.add(this.forward());
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) dir.sub(this.forward());
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) dir.add(this.right());
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) dir.sub(this.right());
    return dir.lengthSq() > 0 ? dir.normalize() : dir;
  }

  pickMode(input) {
    if (input.isDown('KeyC')) return 'creep';
    if (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) return 'run';
    return 'walk';
  }

  update(dt, input) {
    this.mode = this.pickMode(input);
    const speed = { walk: P.walkSpeed, run: P.runSpeed, creep: P.creepSpeed }[this.mode];
    const target = this.wishDirection(input).multiplyScalar(speed);
    // ease the velocity toward the target (smooth starts and stops)
    this.velocity.lerp(target, Math.min(1, P.acceleration * dt));
    const before = this.position.clone();
    this.position.addScaledVector(this.velocity, dt);
    this.level.collide(this.position, P.radius);
    const moved = Math.hypot(this.position.x - before.x, this.position.z - before.z);
    this.advanceStride(moved);
    this.applyCamera(dt, moved);
  }

  // Count distance walked and trigger a footstep every stride.
  advanceStride(moved) {
    if (moved < 1e-4) return;
    this.strideLeft -= moved;
    if (this.strideLeft > 0) return;
    this.strideLeft = { walk: P.strideWalk, run: P.strideRun, creep: P.strideCreep }[this.mode];
    if (this.onFootstep) this.onFootstep(this.mode);
  }

  // Move the camera to the player's eyes, with a little head-bob.
  applyCamera(dt = 0, moved = 0) {
    if (dt > 0) this.bobPhase += moved * 4.2;
    const bobScale = this.mode === 'creep' ? 0.4 : this.mode === 'run' ? 1.5 : 1;
    const bob = Math.sin(this.bobPhase) * P.headBob * bobScale * Math.min(1, this.velocity.length());
    // crouch down a little while creeping (smoothly)
    const targetEye = this.mode === 'creep' ? P.eyeHeight - 0.35 : P.eyeHeight;
    this.eyeY = this.eyeY ?? targetEye;
    this.eyeY += (targetEye - this.eyeY) * Math.min(1, dt * 8);
    this.camera.position.set(this.position.x, this.eyeY + bob, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}

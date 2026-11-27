// =====================================================================
//  ECHO — player.js
//  First-person movement: mouse look, WASD, running, creeping,
//  jumping, falling into pits, collisions and footsteps.
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
    this.y = 0;                // feet height (0 = floor; goes up when jumping)
    this.vy = 0;               // vertical speed
    this.grounded = true;      // standing on something?
    this.falling = false;      // fell into a pit and is climbing out
    this.fallTimer = 0;
    this.safePos = this.position.clone(); // last safe spot (to climb back out to)
    this.onFootstep = null;    // set by main.js: called with the current mode
    this.onLand = null;        // set by main.js: called with how hard you landed
    this.onFall = null;        // set by main.js: called when you fall into a pit
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

  // Which way the keys (or the mobile joystick) say we want to go (length 0 or 1).
  wishDirection(input) {
    const dir = new THREE.Vector3();
    if (input.stick && input.stick.mag > 0.12) {
      dir.addScaledVector(this.forward(), input.stick.y).addScaledVector(this.right(), input.stick.x);
      return dir.normalize();
    }
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) dir.add(this.forward());
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) dir.sub(this.forward());
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) dir.add(this.right());
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) dir.sub(this.right());
    return dir.lengthSq() > 0 ? dir.normalize() : dir;
  }

  pickMode(input) {
    const stick = input.stick;
    if (stick && stick.mag > 0.12) {
      // mobile: how far you push the joystick picks the speed
      if (stick.mag < CONFIG.mobile.creepZone) return 'creep';
      return stick.mag > CONFIG.mobile.runZone ? 'run' : 'walk';
    }
    if (input.isDown('KeyC')) return 'creep';
    if (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) return 'run';
    return 'walk';
  }

  // Jump if standing on something. Returns true if a jump started.
  jump() {
    if (!this.grounded || this.falling) return false;
    this.vy = P.jumpSpeed;
    this.grounded = false;
    return true;
  }

  update(dt, input) {
    if (this.falling) { this.updateFall(dt); return; }
    this.mode = this.pickMode(input);
    const speed = { walk: P.walkSpeed, run: P.runSpeed, creep: P.creepSpeed }[this.mode];
    const target = this.wishDirection(input).multiplyScalar(speed);
    // ease the velocity toward the target (smooth starts and stops)
    this.velocity.lerp(target, Math.min(1, P.acceleration * dt));
    const before = this.position.clone();
    this.position.addScaledVector(this.velocity, dt);
    this.level.collide(this.position, P.radius, this.y);
    const moved = Math.hypot(this.position.x - before.x, this.position.z - before.z);
    this.updateVertical(dt);
    if (this.grounded) this.advanceStride(moved); // no footsteps in mid-air
    this.applyCamera(dt, this.grounded ? moved : 0);
  }

  // Gravity, landing, and walking off edges.
  updateVertical(dt) {
    const ground = this.level.groundAt(this.position.x, this.position.z);
    if (this.grounded && ground < this.y - 0.05) this.grounded = false; // walked off an edge
    if (!this.grounded) {
      this.vy -= P.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) {
        const impact = -this.vy;
        this.y = ground;
        this.vy = 0;
        this.grounded = true;
        if (this.onLand && ground >= 0) this.onLand(impact);
      }
    }
    this.position.y = this.y;
    if (this.grounded && this.y >= 0 && this.onSafeGround()) this.safePos.copy(this.position);
    if (this.y < -0.9) this.startFall();
  }

  // Not right next to a pit (so climbing back out doesn't drop you in again).
  onSafeGround() {
    const { x, z } = this.position, r = 0.7;
    return [[r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dz]) => this.level.groundAt(x + dx, z + dz) >= 0);
  }

  // Fell into a pit: drop to the bottom, then climb back out to safety.
  startFall() {
    this.falling = true;
    this.fallTimer = CONFIG.features.fallTime;
    this.velocity.set(0, 0, 0);
    if (this.onFall) this.onFall();
  }

  updateFall(dt) {
    const bottom = this.level.groundAt(this.position.x, this.position.z);
    this.vy -= P.gravity * dt;
    this.y = Math.max(bottom, this.y + this.vy * dt);
    this.position.y = this.y;
    this.applyCamera(dt, 0);
    if ((this.fallTimer -= dt) > 0) return;
    this.position.copy(this.safePos).setY(0);
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.falling = false;
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
    this.camera.position.set(this.position.x, this.y + this.eyeY + bob, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}

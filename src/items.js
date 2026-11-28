// =====================================================================
//  ECHO — items.js
//  Everything you can interact with: tuning forks (the goal), tin cans
//  (noisy traps), pebbles (distractions), tranquilizer darts (stun the
//  creature) and the elevator (the exit).
// =====================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeEchoObject } from './pulse.js';
import { makeRng } from './level.js';
import { Mechanisms } from './mechanisms.js';

const G = CONFIG.goal;
const ACT = CONFIG.actions;
const D = CONFIG.darts;
const FORK_NOTES = [392, 440, 494, 587, 659, 740]; // hum pitch of each fork (Hz)
const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class Items {
  constructor(game) {
    this.game = game;
    this.level = game.level;
    // seeded randomness: in multiplayer every player gets identical item spots
    this.rng = makeRng(this.level.seed + 99);
    this.forks = this.level.forks.map((cell, i) => this.makeFork(cell, i));
    this.cans = this.level.cans.map((cell) => this.makeCan(cell));
    this.piles = this.level.pebblePiles.map((cell) => this.makePile(cell));
    this.darts = this.level.darts.map((cell) => this.makeDartPickup(cell));
    this.dartCooldown = 0;
    this.thrown = [];
    this.collected = 0;
    this.throwCooldown = 0;
    this.lastHumCaption = -999;
    this.lastElevatorHint = -999;
    this.muffleTimer = 0;
    this.powerTimer = -1; // counts down to the elevator powering up (-1 = not yet)
    this.makeElevator();
    this.mech = new Mechanisms(game); // levers, gates and bells
  }

  // Helper: an echo object added to the world.
  add(geom, mats, edgeAngle = 25) {
    const obj = makeEchoObject(geom, mats.surface, mats.line, edgeAngle);
    this.game.world.add(obj);
    return obj;
  }

  // A random spot inside a cell, away from its edges.
  spotIn([x, z], spread) {
    const p = this.level.toWorld(x, z);
    p.x += (this.rng() - 0.5) * spread;
    p.z += (this.rng() - 0.5) * spread;
    return p;
  }

  // ------------------------------------------------------------------
  // Claims: asking to pick something up. Alone it happens at once; in
  // multiplayer the host decides, so two players can't grab the same fork.
  // ------------------------------------------------------------------
  tryClaim(kind, i, thing, extra = {}) {
    if (thing.pendingUntil > this.game.time) return; // already asked, waiting for the answer
    thing.pendingUntil = this.game.time + 1;
    this.game.claim(kind, i, extra);
  }

  canClaim(kind, i) {
    if (kind === 'fork') return !this.forks[i].taken;
    if (kind === 'pile') return !this.piles[i].taken;
    if (kind === 'can') return this.cans[i].cooldown <= 0;
    if (kind === 'lever') return this.mech.canClaim(i);
    if (kind === 'dart') return !this.darts[i].taken;
    if (kind === 'stun') return !!this.game.creature && this.game.creature.state !== 'STUNNED';
    return false;
  }

  // Do it (on every player's machine). 'by' = who did it.
  applyClaim(kind, i, by, data = {}) {
    if (kind === 'fork') this.takeFork(this.forks[i], by);
    else if (kind === 'pile') this.takePile(this.piles[i], by);
    else if (kind === 'can') this.kickCan(this.cans[i], data.v, data.creep, by);
    else if (kind === 'lever') this.mech.pull(i, by);
    else if (kind === 'dart') this.takeDart(this.darts[i], by);
    else if (kind === 'stun') this.stunCreature(by, data.from);
  }

  // ------------------------------------------------------------------
  // Tuning forks
  // ------------------------------------------------------------------
  makeFork(cell, i) {
    const pos = this.spotIn(cell, 1.0);
    const m = this.game.mats;
    // a little stone pedestal so the fork sits at waist height
    const pedestal = new THREE.BoxGeometry(0.36, 0.8, 0.36).translate(pos.x, 0.4, pos.z);
    this.add(pedestal, { surface: m.surface, line: m.line });
    this.level.obstacles.push({ minX: pos.x - 0.18, maxX: pos.x + 0.18, minZ: pos.z - 0.18, maxZ: pos.z + 0.18 });
    const fork = this.add(buildForkGeometry(), { surface: m.forkSurface, line: m.forkLine }, 20);
    fork.position.set(pos.x, 0.8, pos.z);
    const top = new THREE.Vector3(pos.x, 1.1, pos.z);
    return {
      pos, top, mesh: fork, taken: false, freq: FORK_NOTES[i % FORK_NOTES.length],
      timer: Math.random() * G.forkPulseInterval,
      hum: this.game.audio.startHum(top, FORK_NOTES[i % FORK_NOTES.length], 0.05),
    };
  }

  updateForks(dt) {
    const player = this.game.player.position;
    for (const [i, f] of this.forks.entries()) {
      if (f.taken) continue;
      f.mesh.rotation.y += dt * 0.8;
      if ((f.timer -= dt) <= 0) {
        f.timer = G.forkPulseInterval;
        this.game.pulses.emit({ origin: f.top, radius: G.forkPulseRadius, color: CONFIG.pulse.forkColor, strength: 0.7, fade: 1.3 });
      }
      if (!this.game.localOut && flatDist(player, f.pos) < G.forkPickupDistance) this.tryClaim('fork', i, f);
    }
    this.captionNearestHum();
  }

  takeFork(f, by) {
    if (f.taken) return;
    f.taken = true;
    f.hum.stop();
    this.game.world.remove(f.mesh);
    this.collected++;
    const g = this.game, mine = by === g.myId;
    g.audio.forkRing(f.top, f.freq);
    g.pulses.emit({ origin: f.top, radius: G.forkRingRadius, color: CONFIG.pulse.forkColor, strength: 1.2 });
    g.emitSound({ pos: f.top, loudness: G.forkRingLoudness, fromPlayer: true, mine });
    const who = mine ? 'a tuning fork rings out' : `${g.nameOf(by)} found a tuning fork`;
    g.caption(`[${who} — ${this.collected}/${G.forkCount}]`, null, true);
    g.ui.setForks(this.collected, G.forkCount);
    if (this.collected >= G.forkCount) this.powerTimer = 1.5; // power up after a short pause
  }

  // Every so often, tell the player (by caption) where the nearest hum is.
  captionNearestHum() {
    if (this.game.time - this.lastHumCaption < 14) return;
    const player = this.game.player.position;
    const left = this.forks.filter((f) => !f.taken);
    if (!left.length) return;
    const nearest = left.reduce((a, b) => (flatDist(player, a.pos) < flatDist(player, b.pos) ? a : b));
    if (flatDist(player, nearest.pos) > 15) return;
    this.lastHumCaption = this.game.time;
    this.game.caption('[a soft metallic hum — {dir}, {dist}]', nearest.top);
  }

  // ------------------------------------------------------------------
  // Tin cans
  // ------------------------------------------------------------------
  makeCan(cell) {
    const pos = this.spotIn(cell, 2.0);
    const geom = new THREE.CylinderGeometry(0.06, 0.06, 0.14, 9);
    const mesh = this.add(geom, { surface: this.game.mats.surface, line: this.game.mats.objectLine }, 30);
    pos.y = 0.07;
    mesh.position.copy(pos);
    return { pos, mesh, vel: new THREE.Vector3(), cooldown: 0 };
  }

  updateCans(dt) {
    const player = this.game.player;
    for (const [i, c] of this.cans.entries()) {
      c.cooldown -= dt;
      const touching = !this.game.localOut && flatDist(player.position, c.pos) < CONFIG.player.radius + 0.12;
      if (touching && c.cooldown <= 0 && player.velocity.length() > 0.3) this.requestKick(i, c, player);
      // slide and tumble after being kicked
      if (c.vel.lengthSq() > 0.001) {
        c.pos.addScaledVector(c.vel, dt);
        this.level.collide(c.pos, 0.08);
        c.pos.y = this.level.groundAt(c.pos.x, c.pos.z) + 0.07; // drops in if it slides into a pit
        c.vel.multiplyScalar(Math.max(0, 1 - dt * 2.5));
        c.mesh.rotation.z += c.vel.length() * dt * 6;
        c.mesh.position.copy(c.pos);
      }
    }
  }

  // You walked into a can: work out how it flies, then claim the kick.
  requestKick(i, c, player) {
    const creep = player.mode === 'creep';
    const k = creep ? 0.6 : 1.6;
    const v = [player.velocity.x * k + (Math.random() - 0.5), player.velocity.z * k + (Math.random() - 0.5)];
    this.tryClaim('can', i, c, { v, creep });
  }

  kickCan(c, v, creeping, by) {
    const g = this.game, mine = by === g.myId;
    c.cooldown = 1.5;
    c.vel.set(v[0], 0, v[1]);
    if (creeping) {
      // creeping: you nudge it gently — only a soft clink
      g.audio.pebble(c.pos, 0.4);
      g.pulses.emit({ origin: c.pos, radius: 2, color: CONFIG.pulse.objectColor, strength: 0.6 });
      g.emitSound({ pos: c.pos, loudness: 5, fromPlayer: true, mine });
      return;
    }
    c.mesh.rotation.x = Math.PI / 2; // knocked over
    g.audio.can(c.pos);
    g.pulses.emit({ origin: c.pos, radius: ACT.canRadius, color: CONFIG.pulse.objectColor, strength: 1 });
    g.emitSound({ pos: c.pos, loudness: ACT.canLoudness, fromPlayer: true, mine });
    g.caption('[CLANG — a tin can clatters across the floor]', mine ? null : c.pos, true);
  }

  // ------------------------------------------------------------------
  // Pebbles: piles to pick up, and thrown pebbles with simple physics
  // ------------------------------------------------------------------
  makePile(cell) {
    const pos = this.spotIn(cell, 1.6);
    const geoms = [0, 1, 2].map((i) =>
      new THREE.IcosahedronGeometry(0.05 + this.rng() * 0.02, 0)
        .translate(pos.x + Math.cos(i * 2.1) * 0.09, 0.04, pos.z + Math.sin(i * 2.1) * 0.09));
    const meshes = geoms.map((geo) => this.add(geo, { surface: this.game.mats.surface, line: this.game.mats.objectLine }, 20));
    return { pos, meshes, taken: false };
  }

  updatePiles() {
    const g = this.game;
    if (g.localOut || g.pebbles >= CONFIG.player.maxPebbles) return;
    for (const [i, p] of this.piles.entries()) {
      if (!p.taken && flatDist(g.player.position, p.pos) < 0.8) this.tryClaim('pile', i, p);
    }
  }

  takePile(p, by) {
    const g = this.game;
    if (p.taken) return;
    p.taken = true;
    p.meshes.forEach((m) => g.world.remove(m));
    if (by !== g.myId) return; // a friend took them
    g.pebbles = Math.min(CONFIG.player.maxPebbles, g.pebbles + 2);
    g.ui.setPebbles(g.pebbles);
    g.audio.pickup();
    g.caption('[you pick up some pebbles]');
  }

  // ------------------------------------------------------------------
  // Tranquilizer darts
  // ------------------------------------------------------------------
  makeDartPickup(cell) {
    const pos = this.spotIn(cell, 1.4);
    const m = this.game.mats;
    const geom = mergeAll([
      new THREE.CylinderGeometry(0.012, 0.012, 0.2, 6).rotateZ(Math.PI / 2),                  // body
      new THREE.ConeGeometry(0.012, 0.07, 5).rotateZ(-Math.PI / 2).translate(0.135, 0, 0),    // needle
      new THREE.BoxGeometry(0.05, 0.05, 0.004).translate(-0.09, 0, 0),                        // fins
      new THREE.BoxGeometry(0.05, 0.004, 0.05).translate(-0.09, 0, 0),
    ]);
    const mesh = this.add(geom, { surface: m.dartSurface, line: m.dartLine }, 20);
    mesh.position.set(pos.x, 0.03, pos.z);
    mesh.rotation.y = this.rng() * Math.PI * 2;
    return { pos, mesh, taken: false };
  }

  updateDarts(dt) {
    const g = this.game;
    this.dartCooldown -= dt;
    if (g.localOut || g.darts >= D.max) return;
    for (const [i, d] of this.darts.entries()) {
      if (!d.taken && flatDist(g.player.position, d.pos) < 0.9) this.tryClaim('dart', i, d);
    }
  }

  takeDart(d, by) {
    const g = this.game;
    if (d.taken) return;
    d.taken = true;
    g.world.remove(d.mesh);
    if (by !== g.myId) return; // a friend took it
    g.darts = Math.min(D.max, g.darts + 1);
    g.ui.setDarts(g.darts);
    g.audio.pickup();
    g.caption(`[you pick up a tranquilizer dart — ${g.dartHint}]`);
  }

  // Called when the player presses R / DART.
  fireDart() {
    const g = this.game;
    if (g.darts <= 0) { g.caption('[no tranquilizer darts — look for one]'); return; }
    if (this.dartCooldown > 0) return;
    this.dartCooldown = D.cooldown;
    g.darts--;
    g.ui.setDarts(g.darts);
    const origin = g.camera.position.clone();
    const dir = new THREE.Vector3();
    g.camera.getWorldDirection(dir);
    const wall = this.dartImpact(origin, dir);           // where it would hit the rock
    const hitAt = this.dartHitsCreature(origin, dir);    // distance to the creature, or -1
    const hit = hitAt >= 0 && hitAt < origin.distanceTo(wall);
    // the hit lands first, so a stunned creature never hears the shot; a miss it may hear
    if (hit) {
      g.stats.stuns = (g.stats.stuns || 0) + 1;
      g.claim('stun', 0, { from: [origin.x, origin.z] });
    }
    g.playerFx('dart', origin);
    if (!hit) g.playerFx('dartMiss', wall);
  }

  // Does a dart fired from o in direction d hit the creature's body?
  // The body is treated as a vertical pole. Returns the distance, or -1.
  dartHitsCreature(o, d) {
    const c = this.game.creature;
    if (!c) return -1;
    const flat = d.x * d.x + d.z * d.z;
    if (flat < 1e-6) return -1;                           // aiming straight up or down
    const s = ((c.position.x - o.x) * d.x + (c.position.z - o.z) * d.z) / flat;
    if (s <= 0) return -1;                                // it's behind you
    const missX = o.x + d.x * s - c.position.x, missZ = o.z + d.z * s - c.position.z;
    const y = o.y + d.y * s;
    const along = s * Math.sqrt(flat + d.y * d.y);
    const ok = Math.hypot(missX, missZ) < D.aimForgiveness && y > 0.2 && y < CONFIG.creature.height + 0.1 && along < D.range;
    return ok ? along : -1;
  }

  // Follow the dart until it hits rock, the floor or the ceiling (or runs out of range).
  dartImpact(o, d) {
    const lv = this.level, p = o.clone(), step = d.clone().multiplyScalar(0.2);
    for (let t = 0; t < D.range; t += 0.2) {
      const next = p.clone().add(step);
      const solid = !lv.isOpen(...lv.toCell(next.x, next.z)) || next.y < lv.groundAt(next.x, next.z) || next.y > lv.height;
      if (solid) return p;
      p.copy(next);
    }
    return p;
  }

  stunCreature(by, from) {
    const c = this.game.creature;
    if (!c) return;
    const fromPos = from ? new THREE.Vector3(from[0], 0, from[1]) : null;
    c.stun(fromPos);
    if (by !== this.game.myId && this.game.net) this.game.caption(`[${this.game.nameOf(by)}'s dart hits the creature]`, null, true);
  }

  // Called when the player presses E.
  throwPebble() {
    const g = this.game;
    if (g.pebbles <= 0) { g.caption('[no pebbles left]'); return; }
    if (this.throwCooldown > 0) return;
    this.throwCooldown = ACT.throwCooldown;
    g.pebbles--;
    g.ui.setPebbles(g.pebbles);
    const dir = new THREE.Vector3();
    g.camera.getWorldDirection(dir);
    const pos = g.camera.position.clone().addScaledVector(dir, 0.4);
    const vel = dir.multiplyScalar(ACT.throwSpeed).add(new THREE.Vector3(0, 2, 0));
    const mesh = this.add(new THREE.IcosahedronGeometry(0.05, 0), { surface: g.mats.surface, line: g.mats.objectLine });
    this.thrown.push({ pos, vel, mesh, bounces: 0, resting: false });
    g.audio.throwWhoosh();
  }

  updateThrown(dt) {
    this.throwCooldown -= dt;
    for (const p of this.thrown) {
      if (p.resting) continue;
      p.vel.y -= 9.8 * dt;
      const prev = p.pos.clone();
      p.pos.addScaledVector(p.vel, dt);
      this.bounceOffWalls(p, prev);
      if (p.pos.y > this.level.height - 0.05) { p.pos.y = this.level.height - 0.05; p.vel.y *= -0.4; }
      if (p.pos.y < this.level.groundAt(p.pos.x, p.pos.z) + 0.05) this.hitFloor(p);
      p.mesh.position.copy(p.pos);
    }
  }

  // If the pebble entered rock, bounce it back along that axis.
  bounceOffWalls(p, prev) {
    const lv = this.level;
    const cellAt = (x, z) => lv.isOpen(...lv.toCell(x, z));
    if (cellAt(p.pos.x, p.pos.z)) return;
    if (!cellAt(p.pos.x, prev.z)) { p.pos.x = prev.x; p.vel.x *= -0.5; }
    if (!cellAt(prev.x, p.pos.z)) { p.pos.z = prev.z; p.vel.z *= -0.5; }
    if (!cellAt(p.pos.x, p.pos.z)) { p.pos.x = prev.x; p.pos.z = prev.z; }
    this.landNoise(p, 0.5);
  }

  hitFloor(p) {
    p.pos.y = this.level.groundAt(p.pos.x, p.pos.z) + 0.05;
    if (Math.abs(p.vel.y) < 1.2 || p.bounces > 3) { p.resting = true; return; }
    this.landNoise(p, p.bounces === 0 ? 1 : 0.4);
    p.vel.y *= -0.35;
    p.vel.x *= 0.6; p.vel.z *= 0.6;
    p.bounces++;
  }

  // Sound + pulse where a pebble hits something (shared with friends).
  landNoise(p, strength) {
    this.game.playerFx('land', p.pos.clone(), strength);
  }

  // ------------------------------------------------------------------
  // The elevator (exit)
  // ------------------------------------------------------------------
  makeElevator() {
    const [x, z] = this.level.elevator;
    this.elevatorPos = this.level.toWorld(x, z);
    const door = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dz]) => this.level.isOpen(x + dx, z + dz)) || [1, 0];
    const geom = buildElevatorGeometry(this.elevatorPos, this.level.cell, this.level.height, door);
    this.add(geom, { surface: this.game.mats.surface, line: this.game.mats.elevatorLine }, 25);
    this.beaconTimer = 0;
    this.humSoundTimer = 0;
    this.elevatorHum = null;
  }

  powerElevator() {
    const g = this.game;
    if (g.elevatorPowered || this.disposed) return;
    g.elevatorPowered = true;
    const pos = this.elevatorPos.clone().setY(1.5);
    g.audio.elevatorClank(pos);
    this.elevatorHum = g.audio.startHum(pos, 55, 0.12, 'sawtooth');
    g.pulses.emit({ origin: pos, radius: G.elevatorPulseRadius, color: CONFIG.pulse.elevatorColor, strength: 1.4 });
    g.emitSound({ pos, loudness: 999, fromPlayer: false }); // heard everywhere
    g.mats.elevatorLine.uniforms.uSelfGlow.value = 0.05;
    g.caption('[a heavy CLANK echoes — the old elevator has power. GET TO IT]', pos, true);
  }

  updateElevator(dt) {
    const g = this.game;
    const dist = flatDist(g.player.position, this.elevatorPos);
    if (this.powerTimer > 0 && (this.powerTimer -= dt) <= 0) this.powerElevator();
    if (!g.elevatorPowered) {
      if (!g.localOut && dist < 2 && g.time - this.lastElevatorHint > 8) {
        this.lastElevatorHint = g.time;
        g.caption(`[the elevator is dead — it needs all ${G.forkCount} tuning forks]`);
      }
      return;
    }
    const pos = this.elevatorPos.clone().setY(1.5);
    if ((this.beaconTimer -= dt) <= 0) {
      this.beaconTimer = G.elevatorBeaconInterval;
      g.pulses.emit({ origin: pos, radius: 9, color: CONFIG.pulse.elevatorColor, strength: 0.8, fade: 1.5 });
    }
    if ((this.humSoundTimer -= dt) <= 0) {
      this.humSoundTimer = 7;
      g.emitSound({ pos, loudness: G.elevatorHumLoudness, fromPlayer: false });
      g.caption('[machinery humming — {dir}, {dist}]', pos);
    }
    if (!g.localOut && dist < G.elevatorReachDistance) g.reachedElevator();
  }

  // ------------------------------------------------------------------
  update(dt) {
    this.updateForks(dt);
    this.updateCans(dt);
    this.updatePiles();
    this.updateDarts(dt);
    this.updateThrown(dt);
    this.updateElevator(dt);
    this.mech.update(dt);
    if ((this.muffleTimer -= dt) <= 0) {
      this.muffleTimer = 0.25;
      this.forks.forEach((f) => !f.taken && f.hum.updateMuffle());
      if (this.elevatorHum) this.elevatorHum.updateMuffle();
    }
  }

  // Stop all looping sounds (game over / restart).
  dispose() {
    this.disposed = true;
    this.forks.forEach((f) => !f.taken && f.hum.stop());
    if (this.elevatorHum) this.elevatorHum.stop();
  }
}

// ---------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------

// A tuning fork: handle + U-shaped prongs.
function buildForkGeometry() {
  const parts = [
    new THREE.CylinderGeometry(0.018, 0.018, 0.16, 6).translate(0, 0.08, 0),
    new THREE.BoxGeometry(0.13, 0.03, 0.03).translate(0, 0.17, 0),
    new THREE.BoxGeometry(0.025, 0.3, 0.025).translate(-0.052, 0.33, 0),
    new THREE.BoxGeometry(0.025, 0.3, 0.025).translate(0.052, 0.33, 0),
  ];
  return mergeAll(parts);
}

// A rusty cage: platform, corner posts, roof frame, bars on 3 sides, pulley.
function buildElevatorGeometry(c, C, H, door) {
  const parts = [];
  const s = C / 2 - 0.25;           // half-width of the cage
  const box = (w, h, d, x, y, z) => parts.push(new THREE.BoxGeometry(w, h, d).translate(c.x + x, y, c.z + z));
  box(s * 2, 0.15, s * 2, 0, 0.075, 0);                  // platform
  for (const [px, pz] of [[-s, -s], [s, -s], [-s, s], [s, s]]) box(0.12, H - 0.4, 0.12, px, (H - 0.4) / 2, pz);
  box(s * 2, 0.12, 0.12, 0, H - 0.4, -s); box(s * 2, 0.12, 0.12, 0, H - 0.4, s);
  box(0.12, 0.12, s * 2, -s, H - 0.4, 0); box(0.12, 0.12, s * 2, s, H - 0.4, 0);
  // vertical bars on every side except the door side
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (dx === door[0] && dz === door[1]) continue;
    for (let t = -s + 0.3; t < s; t += 0.3) {
      if (dx) box(0.03, H - 0.55, 0.03, dx * s, (H - 0.4) / 2, t);
      else box(0.03, H - 0.55, 0.03, t, (H - 0.4) / 2, dz * s);
    }
  }
  const wheel = new THREE.TorusGeometry(0.35, 0.05, 5, 10).translate(c.x, H - 0.15, c.z);
  parts.push(wheel);
  box(0.03, 0.4, 0.03, 0.3, H - 0.2, 0); box(0.03, 0.4, 0.03, -0.3, H - 0.2, 0); // cables
  return mergeAll(parts);
}

// Merge geometries (convert to non-indexed so different shapes combine).
function mergeAll(parts) {
  const pos = [], nor = [];
  for (const g of parts) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...ng.attributes.position.array);
    nor.push(...ng.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

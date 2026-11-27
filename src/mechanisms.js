// =====================================================================
//  ECHO — mechanisms.js
//  Levers you can pull (press E next to one; on mobile, the PULL button):
//    • gate levers — open or close an iron gate somewhere nearby.
//                    The creature can't get through a closed gate!
//    • bell levers — ring an old mine bell far away: a loud distraction
//                    that draws the creature there.
//  The positions come from features.js (part of the generated level).
// =====================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeEchoObject } from './pulse.js';
import { cellKey } from './features.js';

const F = CONFIG.features;
const ACT = CONFIG.actions;
const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class Mechanisms {
  constructor(game) {
    this.game = game;
    this.level = game.level;
    this.levers = [];
    this.gates = this.level.gates.map((g) => this.makeGate(g));
    this.level.gates.forEach((g, i) => this.levers.push(this.makeLever(g.lever, 'gate', this.gates[i])));
    this.level.decoys.forEach((d) => this.levers.push(this.makeLever(d.lever, 'bell', this.makeBell(d.bell))));
    this.near = -1; // index of the lever you're standing next to (-1 = none)
  }

  add(geom, surface, line) {
    const obj = makeEchoObject(geom, surface, line, 25);
    this.game.world.add(obj);
    return obj;
  }

  // ------------------------------------------------------------------
  // Building the objects
  // ------------------------------------------------------------------

  // Iron bars across the tunnel. Closed at the start.
  makeGate(g) {
    const lv = this.level, C = lv.cell, H = lv.height, m = this.game.mats;
    const c = lv.toWorld(...g.cell);
    const bars = [];
    for (let t = -C / 2 + 0.15; t < C / 2; t += 0.22) bars.push(new THREE.BoxGeometry(0.05, H, 0.05).translate(t, H / 2, 0));
    for (const y of [0.35, H / 2, H - 0.35]) bars.push(new THREE.BoxGeometry(C, 0.08, 0.06).translate(0, y, 0));
    const mesh = this.add(mergeBoxes(bars), m.surface, m.objectLine);
    mesh.position.copy(c);
    if (g.axis === 'z') mesh.rotation.y = 0;          // bars run across x, blocking travel along z
    else mesh.rotation.y = Math.PI / 2;               // bars run across z, blocking travel along x
    const t = 0.1;
    const obstacle = g.axis === 'x'
      ? { minX: c.x - t, maxX: c.x + t, minZ: c.z - C / 2, maxZ: c.z + C / 2 }
      : { minX: c.x - C / 2, maxX: c.x + C / 2, minZ: c.z - t, maxZ: c.z + t };
    lv.obstacles.push(obstacle);
    return { def: g, mesh, obstacle, open: false, lift: 0, pos: c.clone().setY(1.5) };
  }

  // A lever on the wall: a plate and a handle that swings up or down.
  makeLever(spot, kind, target) {
    const m = this.game.mats;
    const holder = new THREE.Group();
    holder.position.copy(spot.pos);
    holder.rotation.y = Math.atan2(-spot.wall[0], -spot.wall[1]); // face away from the wall
    holder.add(makeEchoObject(new THREE.BoxGeometry(0.28, 0.42, 0.06), m.leverSurface, m.leverLine, 25));
    const pivot = new THREE.Group();
    pivot.position.z = 0.05;
    const handle = new THREE.BoxGeometry(0.05, 0.36, 0.05).translate(0, 0.18, 0);
    const knob = new THREE.IcosahedronGeometry(0.06, 0).translate(0, 0.38, 0);
    pivot.add(makeEchoObject(mergeBoxes([handle, knob]), m.leverSurface, m.leverLine, 25));
    pivot.rotation.x = 0.7; // "off": handle tilted up and out
    holder.add(pivot);
    this.game.world.add(holder);
    return { kind, target, pos: spot.pos.clone(), pivot, on: false, readyAt: 0 };
  }

  // A heavy bell hanging from the ceiling.
  makeBell(b) {
    const m = this.game.mats;
    const geom = mergeBoxes([
      new THREE.CylinderGeometry(0.12, 0.32, 0.42, 8).translate(0, 0, 0),
      new THREE.BoxGeometry(0.06, 0.4, 0.06).translate(0, 0.4, 0),
      new THREE.BoxGeometry(0.6, 0.06, 0.06).translate(0, 0.6, 0),
    ]);
    const mesh = this.add(geom, m.surface, m.objectLine);
    mesh.position.copy(b.pos);
    return { mesh, pos: b.pos.clone(), swing: 0 };
  }

  // ------------------------------------------------------------------
  // Every frame
  // ------------------------------------------------------------------
  update(dt) {
    for (const g of this.gates) {
      const goal = g.open ? this.level.height - 0.35 : 0;   // open gates rise into the ceiling
      g.lift += Math.sign(goal - g.lift) * Math.min(Math.abs(goal - g.lift), F.gateSpeed * dt);
      g.mesh.position.y = g.lift;
    }
    for (const l of this.levers) {
      const goal = l.on ? -0.7 : 0.7;
      l.pivot.rotation.x += (goal - l.pivot.rotation.x) * Math.min(1, dt * 10);
      if (l.kind === 'bell' && l.target.swing > 0) {
        l.target.swing = Math.max(0, l.target.swing - dt * 0.5);
        l.target.mesh.rotation.z = Math.sin(this.game.time * 9) * 0.35 * l.target.swing;
      }
    }
    this.findNearLever();
  }

  findNearLever() {
    const g = this.game;
    this.near = -1;
    if (g.localOut) return;
    let best = F.leverReach;
    this.levers.forEach((l, i) => {
      const d = flatDist(g.player.position, l.pos);
      if (d < best) { best = d; this.near = i; }
    });
  }

  // ------------------------------------------------------------------
  // Pulling levers (through Items' claim system, so multiplayer agrees)
  // ------------------------------------------------------------------
  canClaim(i) { return this.game.time >= this.levers[i].readyAt; }

  // Called when you press E / PULL next to a lever.
  tryPull(items) {
    const i = this.near;
    if (i < 0) return;
    if (!this.canClaim(i)) { this.game.caption('[the lever won\'t budge yet]'); return; }
    items.tryClaim('lever', i, this.levers[i]);
  }

  // The pull itself: runs on every player's machine.
  pull(i, by) {
    const g = this.game, l = this.levers[i];
    l.on = !l.on;
    l.readyAt = g.time + (l.kind === 'bell' ? F.decoyCooldown : 1);
    l.pendingUntil = 0;
    g.audio.leverClunk(l.pos);
    g.pulses.emit({ origin: l.pos, radius: 3, color: CONFIG.pulse.objectColor, strength: 0.7, fade: 1.2 });
    g.emitSound({ pos: l.pos, loudness: ACT.leverLoudness, fromPlayer: true, mine: by === g.myId });
    if (l.kind === 'gate') this.toggleGate(l.target);
    else this.ringBell(l.target);
  }

  toggleGate(gate) {
    const g = this.game, lv = this.level, key = cellKey(...gate.def.cell);
    gate.open = !gate.open;
    const i = lv.obstacles.indexOf(gate.obstacle);
    if (gate.open) {
      if (i >= 0) lv.obstacles.splice(i, 1);
      lv.blocked.delete(key);
    } else {
      if (i < 0) lv.obstacles.push(gate.obstacle);
      lv.blocked.add(key);
    }
    g.audio.gateGrind(gate.pos);
    g.pulses.emit({ origin: gate.pos, radius: 6, color: CONFIG.pulse.objectColor, strength: 0.8 });
    g.emitSound({ pos: gate.pos, loudness: ACT.gateLoudness, fromPlayer: false });
    if (g.creature && g.creature.replan) g.creature.replan(); // the way may have opened or closed
    g.caption(`[an iron gate grinds ${gate.open ? 'open' : 'shut'} — {dir}, {dist}]`, gate.pos, true);
  }

  ringBell(bell) {
    const g = this.game;
    bell.swing = 1;
    g.audio.bell(bell.pos);
    g.pulses.emit({ origin: bell.pos, radius: 14, color: CONFIG.pulse.forkColor, strength: 1.0 });
    g.emitSound({ pos: bell.pos, loudness: ACT.bellLoudness, fromPlayer: false });
    g.caption('[a bell clangs in the distance — {dir}, {dist}]', bell.pos, true);
  }
}

// Merge simple geometries into one (non-indexed so they combine).
function mergeBoxes(parts) {
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

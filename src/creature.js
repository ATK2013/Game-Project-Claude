// =====================================================================
//  ECHO — creature.js
//  The Listener: tall, thin, eyeless. Invisible unless an echo pulse
//  washes over it. It hunts purely by sound and clicks to echolocate.
//
//  AI states:
//    WANDER      – roams to random places
//    INVESTIGATE – walks to where it heard a sound, listens, gives up
//    HUNT        – heard YOU close by; chases your last heard position
// =====================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeEchoObject } from './pulse.js';

const C = CONFIG.creature;
export const WANDER = 'WANDER', INVESTIGATE = 'INVESTIGATE', HUNT = 'HUNT';

const rand = ([min, max]) => min + Math.random() * (max - min);
const VOID = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }); // pitch black

// ---------------------------------------------------------------------
// Body: built from simple boxes and a stretched sphere
// ---------------------------------------------------------------------

// A box whose pivot is at its top (so it swings like a limb) or bottom.
function limb(w, h, d, hangDown = true) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, hangDown ? -h / 2 : h / 2, 0);
  return g;
}

function part(geom, mats, x = 0, y = 0, z = 0) {
  const obj = makeEchoObject(geom, mats.surface, mats.line, 20);
  obj.position.set(x, y, z);
  return obj;
}

// Build the head separately: the jumpscare re-uses it.
export function buildHead(mats, mouthOpen = 0) {
  const head = new THREE.Group();
  const skull = new THREE.SphereGeometry(1, 7, 6);
  skull.scale(0.17, 0.3, 0.2);
  skull.translate(0, 0.24, 0);
  head.add(part(skull, mats));
  // a thin mouth slit (opens into a black void for the jumpscare)
  const jawH = 0.012 + mouthOpen * 0.16;
  const mouthMats = mouthOpen > 0 ? { surface: VOID, line: mats.line } : mats;
  head.add(part(new THREE.BoxGeometry(0.13, jawH, 0.03), mouthMats, 0, 0.1 - jawH / 2, 0.17));
  if (mouthOpen > 0) {
    // jagged teeth lines around the open mouth
    for (let i = 0; i < 7; i++) {
      const tooth = new THREE.ConeGeometry(0.008, 0.04, 3);
      const x = -0.055 + i * 0.018;
      head.add(part(tooth.clone().rotateX(Math.PI), mats, x, 0.09, 0.185));
      head.add(part(tooth, mats, x, 0.1 - jawH + 0.015, 0.185));
    }
  }
  return head;
}

export function buildCreatureBody(mats) {
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 1.35;
  root.add(hips);
  const legL = part(limb(0.07, 1.35, 0.07), mats, -0.1, 0, 0);
  const legR = part(limb(0.07, 1.35, 0.07), mats, 0.1, 0, 0);
  hips.add(legL, legR);
  const torso = new THREE.Group();
  torso.rotation.x = 0.25; // hunched forward
  hips.add(torso);
  torso.add(part(limb(0.28, 0.85, 0.12, false), mats));
  for (let i = 0; i < 4; i++) torso.add(part(new THREE.BoxGeometry(0.31, 0.018, 0.15), mats, 0, 0.35 + i * 0.1, 0));
  const armL = part(limb(0.045, 1.25, 0.045), mats, -0.2, 0.8, 0);
  const armR = part(limb(0.045, 1.25, 0.045), mats, 0.2, 0.8, 0);
  for (const arm of [armL, armR]) {
    for (let f = -1; f <= 1; f++) arm.add(part(limb(0.014, 0.28, 0.014), mats, f * 0.025, -1.25, 0));
  }
  torso.add(armL, armR);
  torso.add(part(limb(0.05, 0.22, 0.05, false), mats, 0, 0.84, 0));
  const head = buildHead(mats);
  head.position.y = 1.02;
  torso.add(head);
  root.scale.setScalar(C.height / 2.95);
  return { root, legL, legR, armL, armR, torso, head };
}

// ---------------------------------------------------------------------
// The Creature
// ---------------------------------------------------------------------
export class Creature {
  constructor(game) {
    this.game = game;
    this.level = game.level;
    const [sx, sz] = this.level.creatureSpawn;
    this.position = this.level.toWorld(sx, sz);
    this.body = buildCreatureBody({ surface: game.mats.creatureSurface, line: game.mats.creatureLine });
    game.world.add(this.body.root);
    this.state = WANDER;
    this.path = [];
    this.target = null;          // where it is walking to (world position)
    this.lastHeard = -999;       // game time when it last heard the player (HUNT)
    this.linger = 0;             // seconds left listening at a spot
    this.clickTimer = rand(C.clickWander);
    this.stepLeft = C.stepLength;
    this.yaw = 0;
    this.walkPhase = 0;
    this.twitch = 0;
    this.lastStepCaption = -999;
    this.syncBody();
  }

  get diff() { return this.game.difficulty; }
  cell() { return this.level.toCell(this.position.x, this.position.z); }
  headPosition() { return new THREE.Vector3(this.position.x, C.height * 0.88, this.position.z); }

  // ------------------------------------------------------------------
  // Hearing — called by main.js for every sound in the world.
  // ev = { pos, loudness, fromPlayer }
  // ------------------------------------------------------------------
  hear(ev) {
    const dist = Math.hypot(ev.pos.x - this.position.x, ev.pos.z - this.position.z);
    const walls = this.level.rockBetween(this.position, ev.pos);
    const effective = dist + walls * C.wallMuffle;     // walls make sounds "farther"
    if (effective > ev.loudness * this.diff.hearing) return false;

    const closePlayer = ev.fromPlayer && effective < C.huntDistance * this.diff.hearing;
    if (closePlayer || (this.state === HUNT && ev.fromPlayer)) {
      this.startHunt(ev.pos);
    } else if (this.state !== HUNT || this.game.time - this.lastHeard > 1.5) {
      // a distraction (pebble, can...) can even pull it off a hunt
      this.investigate(ev.pos);
    }
    return true;
  }

  startHunt(pos) {
    if (this.state !== HUNT) {
      this.game.stats.hunted++;
      this.game.audio.creatureScreech(this.headPosition());
      this.game.caption('[a piercing shriek — it is HUNTING you]', this.position, true);
      this.clickTimer = 0.3;
    }
    this.state = HUNT;
    this.lastHeard = this.game.time;
    this.goTo(pos);
  }

  investigate(pos) {
    this.state = INVESTIGATE;
    this.linger = C.investigateLinger;
    this.goTo(pos);
  }

  loseTrack() {
    this.state = WANDER;
    this.path = [];
    this.game.caption('[the clicking slows... it has lost you]', this.position);
  }

  // Plan a route (BFS on the grid) to a world position.
  goTo(pos) {
    const goal = this.level.toCell(pos.x, pos.z);
    const path = this.level.findPath(this.cell(), goal);
    if (!path) return;
    this.path = path;
    this.target = pos.clone();
  }

  // A random destination; once the elevator runs, it tends to stay near it.
  pickWanderTarget() {
    const lv = this.level;
    let cell;
    if (this.game.elevatorPowered && Math.random() < 0.5) {
      const [ex, ez] = lv.elevator;
      const near = lv.openCells().filter(([x, z]) => Math.abs(x - ex) + Math.abs(z - ez) < 6);
      cell = near[Math.floor(Math.random() * near.length)];
    } else {
      const [cx, cz] = this.cell();
      const near = lv.openCells().filter(([x, z]) => Math.abs(x - cx) + Math.abs(z - cz) < 12);
      cell = near[Math.floor(Math.random() * near.length)];
    }
    if (cell) this.goTo(lv.toWorld(cell[0], cell[1]));
  }

  // ------------------------------------------------------------------
  // Per-frame update
  // ------------------------------------------------------------------
  update(dt) {
    this.think(dt);
    const speed = { WANDER: C.wanderSpeed, INVESTIGATE: C.investigateSpeed, HUNT: C.huntSpeed }[this.state];
    const moved = this.followPath(dt, speed * this.diff.creatureSpeed);
    this.updateSteps(moved);
    this.updateClicks(dt);
    this.animate(dt, moved);
    this.syncBody();
  }

  // Decide what to do next based on the current state.
  think(dt) {
    const arrived = this.path.length === 0;
    if (this.state === HUNT) {
      if (this.game.time - this.lastHeard > C.loseTrackTime) this.loseTrack();
    } else if (this.state === INVESTIGATE) {
      if (arrived && (this.linger -= dt) <= 0) this.state = WANDER;
    } else if (arrived) {
      this.pickWanderTarget();
    }
  }

  // Walk along the path, cell centre by cell centre. Returns metres moved.
  followPath(dt, speed) {
    if (!this.path.length) return 0;
    const [cx, cz] = this.path[0];
    const last = this.path.length === 1;
    const goal = last && this.target ? this.target : this.level.toWorld(cx, cz);
    const dx = goal.x - this.position.x, dz = goal.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) { this.path.shift(); return 0; }
    const step = Math.min(d, speed * dt);
    this.position.x += (dx / d) * step;
    this.position.z += (dz / d) * step;
    this.turnToward(Math.atan2(dx, dz), dt);
    return step;
  }

  turnToward(angle, dt) {
    let diff = angle - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, dt * 6);
  }

  // Dragging footsteps (sound + a tiny red ripple at its feet).
  updateSteps(moved) {
    this.stepLeft -= moved;
    if (this.stepLeft > 0) return;
    this.stepLeft = C.stepLength;
    const feet = new THREE.Vector3(this.position.x, 0.1, this.position.z);
    this.game.audio.creatureStep(feet);
    this.game.pulses.emit({ origin: feet, radius: 1.6, color: CONFIG.pulse.creatureColor, strength: 0.5, fade: 0.8 });
    const dist = this.game.player.position.distanceTo(new THREE.Vector3(feet.x, 0, feet.z));
    if (dist < CONFIG.ui.closeDistance + 2 && this.game.time - this.lastStepCaption > 4) {
      this.lastStepCaption = this.game.time;
      this.game.caption('[dragging footsteps — {dir}, {dist}]', feet);
    }
  }

  // Every few seconds: click, sending out a RED echolocation pulse.
  updateClicks(dt) {
    this.clickTimer -= dt;
    if (this.clickTimer > 0) return;
    const range = { WANDER: C.clickWander, INVESTIGATE: C.clickInvestigate, HUNT: C.clickHunt }[this.state];
    this.clickTimer = rand(range);
    const head = this.headPosition();
    this.game.pulses.emit({ origin: head, radius: C.clickRadius, color: CONFIG.pulse.creatureColor, strength: 0.9 });
    this.game.audio.creatureClick(head);
    this.game.caption('[clicking — {dir}, {dist}]', head);
  }

  // Swing limbs while walking and twitch the head now and then.
  animate(dt, moved) {
    const b = this.body;
    this.walkPhase += moved * 2.2;
    const s = Math.sin(this.walkPhase);
    b.legL.rotation.x = s * 0.45;
    b.legR.rotation.x = -s * 0.45;
    b.armL.rotation.x = -s * 0.3 + 0.1;
    b.armR.rotation.x = s * 0.3 + 0.1;
    b.armL.rotation.z = -0.06 + Math.sin(this.game.time * 1.3) * 0.04;
    b.armR.rotation.z = 0.06 - Math.sin(this.game.time * 1.1) * 0.04;
    b.torso.rotation.x = this.state === HUNT ? 0.5 : 0.25;
    b.torso.rotation.z = Math.sin(this.walkPhase * 0.5) * 0.06;
    if ((this.twitch -= dt) <= 0) {
      // creepy sudden head jerk
      this.twitch = 0.6 + Math.random() * 2.5;
      b.head.rotation.set((Math.random() - 0.4) * 0.6, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.7);
    }
  }

  syncBody() {
    this.body.root.position.set(this.position.x, 0, this.position.z);
    this.body.root.rotation.y = this.yaw;
  }
}

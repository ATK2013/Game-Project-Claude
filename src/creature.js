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
// Body: pitch black, no outline. You only ever see its silhouette
// blotting out the glowing walls behind it... and its white eyes.
// ---------------------------------------------------------------------

// A box whose pivot is at its top (so it swings like a limb) or bottom.
function limb(w, h, d, hangDown = true) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, hangDown ? -h / 2 : h / 2, 0);
  return g;
}

// mats = { surface, line }. line can be null (no outline).
function part(geom, mats, x = 0, y = 0, z = 0) {
  const obj = makeEchoObject(geom, mats.surface, mats.line, 20);
  obj.position.set(x, y, z);
  return obj;
}

// Two glowing points, one per eye (see the 'eye' shader in pulse.js).
function buildEyes(eyeMat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.062, 0.29, 0.21, 0.062, 0.29, 0.21], 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute([-1, 1], 1));
  const eyes = new THREE.Points(g, eyeMat);
  eyes.layers.set(1);            // skipped by the depth pre-pass (see main.js)
  eyes.frustumCulled = false;    // tiny object: never let it pop out of view
  return eyes;
}

// Build the head separately: the jumpscare re-uses it.
export function buildHead(mats, eyeMat, mouthOpen = 0) {
  const head = new THREE.Group();
  const skull = new THREE.SphereGeometry(1, 7, 6);
  skull.scale(0.16, 0.31, 0.2);
  skull.translate(0, 0.24, 0);
  head.add(part(skull, mats));
  // a thin mouth slit (opens into a gaping black void for the jumpscare)
  const jawH = 0.012 + mouthOpen * 0.2;
  head.add(part(new THREE.BoxGeometry(0.12, jawH, 0.03), { surface: VOID, line: mats.line }, 0, 0.1 - jawH / 2, 0.17));
  if (mouthOpen > 0) {
    // rows of thin needle teeth around the open mouth
    for (let i = 0; i < 9; i++) {
      const tooth = new THREE.ConeGeometry(0.006, 0.05, 3);
      const x = -0.052 + i * 0.013;
      head.add(part(tooth.clone().rotateX(Math.PI), mats, x, 0.085, 0.185));
      head.add(part(tooth, mats, x, 0.1 - jawH + 0.02, 0.185));
    }
  }
  head.add(buildEyes(eyeMat));
  return head;
}

// A leg that bends backwards at the knee, like an animal's hind leg.
function buildLeg(mats, x) {
  const thigh = part(limb(0.075, 0.72, 0.075), mats, x, 0, 0);
  thigh.rotation.x = -0.35;
  const shin = part(limb(0.055, 0.78, 0.055), mats, 0, -0.72, 0);
  shin.rotation.x = 0.7;            // knee bends the "wrong" way
  shin.add(part(new THREE.BoxGeometry(0.06, 0.04, 0.22), mats, 0, -0.78, 0.07)); // long foot
  thigh.add(shin);
  return thigh;
}

// A long arm with a bent elbow and long, thin fingers.
function buildArm(mats, x) {
  const upper = part(limb(0.045, 0.7, 0.045), mats, x, 0.8, 0);
  const fore = part(limb(0.035, 0.72, 0.035), mats, 0, -0.7, 0);
  fore.rotation.x = -0.3;
  for (let f = -1.5; f <= 1.5; f++) {
    const finger = part(limb(0.012, 0.34, 0.012), mats, f * 0.018, -0.72, 0);
    finger.rotation.x = -0.15 - Math.abs(f) * 0.05;
    fore.add(finger);
  }
  upper.add(fore);
  return upper;
}

export function buildCreatureBody(mats, eyeMat) {
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 1.32;
  root.add(hips);
  const legL = buildLeg(mats, -0.1);
  const legR = buildLeg(mats, 0.1);
  hips.add(legL, legR);
  const torso = new THREE.Group();
  torso.rotation.x = 0.25; // hunched forward
  hips.add(torso);
  // tapered chest: wide shoulders, starved thin waist
  const chest = new THREE.CylinderGeometry(0.19, 0.07, 0.85, 4).rotateY(Math.PI / 4).scale(1, 1, 0.45).translate(0, 0.42, 0);
  torso.add(part(chest, mats));
  const armL = buildArm(mats, -0.2);
  const armR = buildArm(mats, 0.2);
  torso.add(armL, armR);
  torso.add(part(limb(0.045, 0.32, 0.045, false), mats, 0, 0.82, 0)); // long neck
  const head = buildHead(mats, eyeMat);
  head.position.y = 1.12;
  torso.add(head);
  root.scale.setScalar(C.height / 3.0);
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
    this.eyeMat = game.mats.creatureEye;
    this.body = buildCreatureBody({ surface: VOID, line: null }, this.eyeMat);
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
    this.flare = 0;              // extra eye glow right after it clicks
    this.blinkTimer = rand(C.blinkEvery);
    this.blinkLeft = 0;          // seconds left in the current blink
    this.breathTimer = 1;
    this.lastBreathCaption = -999;
    this.feeding = 0;            // seconds left standing still after a catch
    // multiplayer friends don't run the AI: they copy the host's creature
    this.remote = !!(game.net && !game.net.isHost);
    this.netTarget = null;
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
      this.fx('screech', this.headPosition());
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
    this.fx('lost', this.position);
  }

  // Multiplayer: after catching someone it stands still for a while.
  feed(seconds) {
    this.feeding = seconds;
    this.state = WANDER;
    this.path = [];
  }

  // ------------------------------------------------------------------
  // Effects (sound + light + caption). In multiplayer the host's creature
  // also sends each effect to the friends, who play it with applyFx().
  // ------------------------------------------------------------------
  fx(kind, pos) {
    this.applyFx(kind, pos);
    if (this.game.net) this.game.net.sendCreatureFx(kind, pos);
  }

  applyFx(kind, pos) {
    const g = this.game, red = CONFIG.pulse.creatureColor;
    if (kind === 'click') {
      g.pulses.emit({ origin: pos, radius: C.clickRadius, color: red, strength: 0.9 });
      g.audio.creatureClick(pos);
      this.flare = 0.5; // its eyes flare as it clicks
      g.caption('[clicking — {dir}, {dist}]', pos);
    } else if (kind === 'step') {
      g.audio.creatureStep(pos);
      g.pulses.emit({ origin: pos, radius: 1.6, color: red, strength: 0.5, fade: 0.8 });
      const dist = Math.hypot(g.player.position.x - pos.x, g.player.position.z - pos.z);
      if (dist < CONFIG.ui.closeDistance + 2 && g.time - this.lastStepCaption > 4) {
        this.lastStepCaption = g.time;
        g.caption('[dragging footsteps — {dir}, {dist}]', pos);
      }
    } else if (kind === 'screech') {
      g.audio.creatureScreech(pos);
      g.caption(`[a piercing shriek — it is HUNTING${g.net ? '' : ' you'}]`, pos, true);
    } else if (kind === 'lost') {
      g.caption(`[the clicking slows... it has lost ${g.net ? 'its prey' : 'you'}]`, pos);
    }
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
    const moved = this.remote ? this.followNetwork(dt) : this.updateBrain(dt);
    this.updateBreathing(dt);
    this.animate(dt, moved);
    this.updateEyes(dt);
    this.syncBody();
  }

  // The thinking part: only runs alone or on the multiplayer host.
  updateBrain(dt) {
    if (this.feeding > 0) { this.feeding -= dt; return 0; }
    this.think(dt);
    const speed = { WANDER: C.wanderSpeed, INVESTIGATE: C.investigateSpeed, HUNT: C.huntSpeed }[this.state];
    const moved = this.followPath(dt, speed * this.diff.creatureSpeed);
    this.updateSteps(moved);
    this.updateClicks(dt);
    return moved;
  }

  // Multiplayer friends: the host tells us where the creature is.
  setNetState(x, z, yaw, state) {
    this.netTarget = { x, z, yaw };
    this.state = state;
  }

  // Glide toward the host's position. Returns metres moved (for the walk animation).
  followNetwork(dt) {
    const t = this.netTarget;
    if (!t) return 0;
    const dx = t.x - this.position.x, dz = t.z - this.position.z;
    const d = Math.hypot(dx, dz);
    const k = d > 5 ? 1 : Math.min(1, dt * CONFIG.multiplayer.smoothing);
    this.position.x += dx * k;
    this.position.z += dz * k;
    this.turnToward(t.yaw, dt);
    return d * k;
  }

  distanceToPlayer() {
    const p = this.game.player.position;
    return Math.hypot(p.x - this.position.x, p.z - this.position.z);
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
    this.fx('step', new THREE.Vector3(this.position.x, 0.1, this.position.z));
  }

  // Every few seconds: click, sending out a RED echolocation pulse.
  updateClicks(dt) {
    this.clickTimer -= dt;
    if (this.clickTimer > 0) return;
    const range = { WANDER: C.clickWander, INVESTIGATE: C.clickInvestigate, HUNT: C.clickHunt }[this.state];
    this.clickTimer = rand(range);
    this.fx('click', this.headPosition());
  }

  // Swing limbs while walking; stare at you, or twitch the head.
  animate(dt, moved) {
    const b = this.body;
    this.walkPhase += moved * 2.2;
    const s = Math.sin(this.walkPhase);
    b.legL.rotation.x = -0.35 + s * 0.4;
    b.legR.rotation.x = -0.35 - s * 0.4;
    b.armL.rotation.x = -s * 0.3 + 0.1;
    b.armR.rotation.x = s * 0.3 + 0.1;
    b.armL.rotation.z = -0.06 + Math.sin(this.game.time * 1.3) * 0.04;
    b.armR.rotation.z = 0.06 - Math.sin(this.game.time * 1.1) * 0.04;
    b.torso.rotation.x = this.state === HUNT ? 0.5 : 0.25;
    b.torso.rotation.z = Math.sin(this.walkPhase * 0.5) * 0.06;
    if (this.shouldStare()) this.stareAtPlayer(dt);
    else this.twitchHead(dt);
  }

  // It turns its head toward you when it is close and paying attention.
  shouldStare() {
    const d = this.distanceToPlayer();
    return d < C.stareDistance && (this.state !== WANDER || d < C.stareDistance / 3);
  }

  stareAtPlayer(dt) {
    const head = this.body.head, p = this.game.player.position;
    let rel = Math.atan2(p.x - this.position.x, p.z - this.position.z) - this.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    rel = Math.max(-1.4, Math.min(1.4, rel));
    // look down at your eyes (its head is far above yours), minus the hunch
    const down = Math.atan2(C.height - CONFIG.player.eyeHeight, this.distanceToPlayer()) - this.body.torso.rotation.x;
    const k = Math.min(1, dt * 5);
    head.rotation.y += (rel - head.rotation.y) * k;
    head.rotation.x += (down - head.rotation.x) * k;
    head.rotation.z += (0.3 - head.rotation.z) * k * 0.3; // slowly cocks its head
  }

  twitchHead(dt) {
    if ((this.twitch -= dt) > 0) return;
    // creepy sudden head jerk
    this.twitch = 0.6 + Math.random() * 2.5;
    this.body.head.rotation.set((Math.random() - 0.4) * 0.6, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.7);
  }

  // Eyes: faint glow when near you (stronger when hunting), a flare after
  // each click, and blinks — except while hunting: then it never blinks.
  updateEyes(dt) {
    const d = this.distanceToPlayer();
    let stare = 0;
    if (d < C.eyeGlowDistance) {
      const near = Math.min(1, (1 - d / C.eyeGlowDistance) * 1.6);
      stare = (this.state === HUNT ? C.eyeGlowHunting : C.eyeGlow) * near;
    }
    this.flare = Math.max(0, this.flare - dt * 1.5);
    if (this.state !== HUNT && (this.blinkTimer -= dt) <= 0) {
      this.blinkTimer = rand(C.blinkEvery);
      this.blinkLeft = 0.15;
    }
    this.blinkLeft -= dt;
    this.eyeMat.uniforms.uStare.value = stare + this.flare;
    this.eyeMat.uniforms.uOpen.value = this.blinkLeft > 0 ? 0 : 1;
  }

  // Close by, you can hear it breathe. Slow, wet, rattling breaths.
  updateBreathing(dt) {
    const d = this.distanceToPlayer();
    if (d > C.breathDistance || (this.breathTimer -= dt) > 0) return;
    this.breathTimer = this.state === HUNT ? 1.5 : 2.6 + Math.random();
    this.game.audio.creatureBreath(this.headPosition(), 1 - d / C.breathDistance);
    if (this.game.time - this.lastBreathCaption > 8) {
      this.lastBreathCaption = this.game.time;
      this.game.caption('[slow, rattling breaths — {dir}, very close]', this.position, true);
    }
  }

  syncBody() {
    this.body.root.position.set(this.position.x, 0, this.position.z);
    this.body.root.rotation.y = this.yaw;
  }
}

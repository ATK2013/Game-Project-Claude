// =====================================================================
//  ECHO — multiplayer.js
//  Keeps everyone's game in sync during a room session.
//
//  Who decides what?
//    • Every player moves themselves and tells the host where they are.
//    • The HOST runs the creature, decides who picks up what (so two
//      players can't grab the same fork), who gets caught, and when the
//      game ends. It sends everyone a snapshot ~15 times per second.
//    • Noises (claps, footsteps, pebbles) are shared, so you see your
//      friends' pulses in their colour, and the creature hears everyone.
//
//  Message types (msg.t):
//    lobby:   players, info, start, lobby
//    in game: state, snap, fx, claim, claimed, cfx, caught, escaped, end
// =====================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeEchoObject } from './pulse.js';

const M = CONFIG.multiplayer;
const CREATURE_STATES = ['WANDER', 'INVESTIGATE', 'HUNT', 'STUNNED'];
const round = (v) => Math.round(v * 100) / 100;       // smaller messages
const toVec = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const toArr = (v) => [round(v.x), round(v.y), round(v.z)];

// Where each player starts inside the first cell, so nobody overlaps.
export function spawnOffset(index) {
  return [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]][index % 4];
}

export class Multiplayer {
  // hooks: functions in main.js / lobby.js that react to room events
  constructor(game, room, hooks) {
    this.game = game;
    this.room = room;
    this.hooks = hooks;
    this.remotes = new Map();  // friendId -> { name, avatar, pos, target, yaw, pitch, creep, out }
    this.status = new Map();   // host only: playerId -> 'alive' | 'caught' | 'escaped'
    this.inGame = false;
    this.sendTimer = 0;
    this.spectateIndex = 0;
    // one tinted body material per player colour
    this.avatarMats = M.colors.map((c) => ({
      surface: game.pulses.makeMaterial('surface', { tint: c, tintMix: 0.85 }),
      line: game.pulses.makeMaterial('line', { tint: c, tintMix: 0.85, lineBoost: 2.2 }),
    }));
    room.on('message', (msg, from) => this.onMessage(msg, from));
    room.on('players', (list) => hooks.players(list));
    room.on('left', (id) => this.onLeft(id));
    room.on('closed', (reason) => hooks.closed(reason));
  }

  get isHost() { return this.room.isHost; }
  get myId() { return this.room.myId; }
  get myIndex() { return Math.max(0, this.room.players.findIndex((p) => p.id === this.myId)); }
  nameOf(id) {
    const p = this.room.playerById(id);
    return p ? p.name : (this.remotes.get(id) || {}).name || 'Someone';
  }
  colorOf(id) {
    const p = this.room.playerById(id);
    return M.colors[p ? p.color : 0];
  }

  // ------------------------------------------------------------------
  // Incoming messages
  // ------------------------------------------------------------------
  onMessage(msg, from) {
    switch (msg.t) {
      case 'players': this.onPlayerList(); break;
      case 'info': this.hooks.lobbyInfo(msg); break;
      case 'start': this.hooks.start(msg.seed, msg.difficulty); break;
      case 'lobby': this.hooks.backToLobby(); break;
      case 'end': if (this.inGame) this.hooks.end(msg); break;
      default: if (this.inGame) this.onGameMessage(msg, from);
    }
  }

  onGameMessage(msg, from) {
    switch (msg.t) {
      case 'state': if (this.isHost) this.setTarget(this.remotes.get(from), msg.s); break;
      case 'snap': this.applySnapshot(msg); break;
      case 'fx': this.onFx(msg, from); break;
      case 'claim': if (this.isHost) this.handleClaim(from, msg); break;
      case 'claimed': this.game.items.applyClaim(msg.kind, msg.i, msg.by, msg); break;
      case 'cfx': this.game.creature.applyFx(msg.kind, toVec(msg.pos)); break;
      case 'caught': this.onCaught(msg.id); break;
      case 'escaped': this.onEscaped(msg.id); break;
      default: break;
    }
  }

  // Friend side: the host sent a new player list (someone joined or left).
  onPlayerList() {
    this.hooks.players(this.room.players);
    if (!this.inGame) return;
    for (const id of [...this.remotes.keys()]) {
      if (!this.room.playerById(id)) this.removeRemote(id, true);
    }
  }

  // ------------------------------------------------------------------
  // Lobby (host)
  // ------------------------------------------------------------------
  sendInfo(info) { if (this.isHost) this.room.send({ t: 'info', ...info }); }

  hostStart(difficulty) {
    const seed = Math.floor(Math.random() * 1e9);
    this.room.locked = true;   // nobody can join a running game
    this.room.send({ t: 'start', seed, difficulty });
    this.hooks.start(seed, difficulty);
  }

  hostBackToLobby() {
    this.room.locked = false;
    this.room.send({ t: 'lobby' });
    this.hooks.backToLobby();
  }

  // ------------------------------------------------------------------
  // Game start / end (called by main.js on every player's machine)
  // ------------------------------------------------------------------
  beginGame() {
    this.endGame();
    this.inGame = true;
    this.spectateIndex = 0;
    this.room.players.forEach((p, index) => {
      this.status.set(p.id, 'alive');
      if (p.id !== this.myId) this.addRemote(p, index);
    });
  }

  endGame() {
    this.inGame = false;
    for (const id of [...this.remotes.keys()]) this.removeRemote(id, false);
    this.status.clear();
  }

  // A friend's body: a simple low-poly figure in their colour. Like
  // everything else, you only see it when a pulse washes over it.
  addRemote(p, index) {
    const mats = this.avatarMats[p.color];
    const avatar = new THREE.Group();
    avatar.add(makeEchoObject(new THREE.CylinderGeometry(0.2, 0.15, 1.15, 6).translate(0, 0.62, 0), mats.surface, mats.line));
    avatar.add(makeEchoObject(new THREE.IcosahedronGeometry(0.15, 0).translate(0, 1.42, 0), mats.surface, mats.line));
    avatar.add(makeEchoObject(new THREE.BoxGeometry(0.14, 0.05, 0.1).translate(0, 1.45, -0.14), mats.surface, mats.line)); // "nose" shows facing
    const start = this.game.level.toWorld(...this.game.level.start);
    const [ox, oz] = spawnOffset(index);
    const pos = new THREE.Vector3(start.x + ox, 0, start.z + oz);
    avatar.position.copy(pos);
    this.game.world.add(avatar);
    this.remotes.set(p.id, { name: p.name, avatar, pos, target: pos.clone(), yaw: 0, pitch: 0, creep: false, out: false, state: null });
  }

  removeRemote(id, announce) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.game.world.remove(r.avatar);
    this.remotes.delete(id);
    if (announce) this.game.caption(`[${r.name} left the room]`, null, true);
  }

  // ------------------------------------------------------------------
  // Per-frame update (called from main.js while a game runs)
  // ------------------------------------------------------------------
  update(dt) {
    this.smoothRemotes(dt);
    if ((this.sendTimer -= dt) <= 0) {
      this.sendTimer = 1 / M.sendRate;
      if (this.isHost) this.sendSnapshot();
      else this.room.send({ t: 'state', s: this.myState() });
    }
    if (this.isHost) this.checkCatches();
  }

  // [x, z, yaw, pitch, creeping?, feet height]
  myState() {
    const p = this.game.player;
    return [round(p.position.x), round(p.position.z), round(p.yaw), round(p.pitch), p.mode === 'creep' ? 1 : 0, round(p.y)];
  }

  // Host: everyone's position + the creature, sent to all friends.
  sendSnapshot() {
    const players = { [this.myId]: this.myState() };
    for (const [id, r] of this.remotes) if (r.state) players[id] = r.state;
    const c = this.game.creature;
    const creature = [round(c.position.x), round(c.position.z), round(c.yaw), CREATURE_STATES.indexOf(c.state)];
    this.room.send({ t: 'snap', players, creature, hunted: this.game.stats.hunted });
  }

  // Friend: apply the host's snapshot.
  applySnapshot(msg) {
    for (const [id, s] of Object.entries(msg.players)) {
      if (id !== this.myId) this.setTarget(this.remotes.get(id), s);
    }
    const [x, z, yaw, state] = msg.creature;
    this.game.creature.setNetState(x, z, yaw, CREATURE_STATES[state]);
    this.game.stats.hunted = msg.hunted;
  }

  setTarget(r, s) {
    if (!r || !s) return;
    r.state = s;
    r.target.set(s[0], s[5] || 0, s[1]);
    r.yaw = s[2];
    r.pitch = s[3];
    r.creep = !!s[4];
  }

  // Glide friends' bodies toward their latest known position.
  smoothRemotes(dt) {
    const k = Math.min(1, dt * M.smoothing);
    for (const r of this.remotes.values()) {
      if (r.pos.distanceTo(r.target) > 6) r.pos.copy(r.target); // too far behind: jump
      else r.pos.lerp(r.target, k);
      r.avatar.position.copy(r.pos);
      r.avatar.rotation.y = r.yaw;
      r.avatar.scale.y = r.creep ? 0.75 : 1;
      r.avatar.visible = !r.out;
    }
  }

  // ------------------------------------------------------------------
  // Noises made by players
  // ------------------------------------------------------------------
  sendFx(kind, pos, s) {
    this.room.send({ t: 'fx', id: this.myId, kind, pos: toArr(pos), s });
  }

  onFx(msg, from) {
    if (this.isHost) {
      msg.id = from;               // trust the connection, not the message
      this.room.send(msg, from);   // pass it on to everyone else
    }
    this.game.playerFx(msg.kind, toVec(msg.pos), msg.s, msg.id);
  }

  // Host: the creature clicked / stepped / shrieked — show it to everyone.
  sendCreatureFx(kind, pos) {
    if (this.isHost && this.inGame) this.room.send({ t: 'cfx', kind, pos: toArr(pos) });
  }

  // ------------------------------------------------------------------
  // Claims: picking things up and escaping. The host has the final word.
  // ------------------------------------------------------------------
  claim(kind, i, extra = {}) {
    if (this.isHost) this.handleClaim(this.myId, { kind, i, ...extra });
    else this.room.send({ t: 'claim', kind, i, ...extra });
  }

  handleClaim(from, msg) {
    if (this.status.get(from) !== 'alive') return;
    if (msg.kind === 'escape') return this.escape(from);
    if (!this.game.items.canClaim(msg.kind, msg.i)) return; // someone was faster
    const out = { t: 'claimed', kind: msg.kind, i: msg.i, by: from, v: msg.v, creep: msg.creep };
    this.room.send(out);
    this.game.items.applyClaim(out.kind, out.i, out.by, out);
  }

  escape(id) {
    if (!this.game.elevatorPowered) return;
    this.status.set(id, 'escaped');
    this.room.send({ t: 'escaped', id });
    this.onEscaped(id);
    this.checkEnd();
  }

  // ------------------------------------------------------------------
  // Getting caught (host decides) and the end of the game
  // ------------------------------------------------------------------
  checkCatches() {
    const c = this.game.creature;
    if (!c || c.feeding > 0 || c.state === 'STUNNED') return;
    for (const [id, st] of this.status) {
      if (st !== 'alive') continue;
      const pos = id === this.myId ? this.game.player.position : (this.remotes.get(id) || {}).target;
      if (pos && Math.hypot(pos.x - c.position.x, pos.z - c.position.z) < CONFIG.creature.catchRadius) {
        this.status.set(id, 'caught');
        c.feed(M.feedTime);        // it stops to "feed" — a chance for the others
        this.room.send({ t: 'caught', id });
        this.onCaught(id);
        this.checkEnd();
        return;
      }
    }
  }

  onCaught(id) {
    const r = this.remotes.get(id);
    if (r) r.out = true;
    if (id === this.myId) this.hooks.caughtMe();
    else this.game.caption(`[${this.nameOf(id)} was caught]`, null, true);
  }

  onEscaped(id) {
    const r = this.remotes.get(id);
    if (r) r.out = true;
    if (id === this.myId) this.hooks.escapedMe();
    else this.game.caption(`[${this.nameOf(id)} escaped in the elevator]`, null, true);
  }

  // Host: a friend disconnected.
  onLeft(id) {
    if (!this.inGame) return;
    this.removeRemote(id, true);
    this.status.delete(id);
    this.checkEnd();
  }

  // Host: when nobody is left in the mine, the game is over for everyone.
  checkEnd() {
    if (!this.inGame || [...this.status.values()].includes('alive')) return;
    const names = (want) => [...this.status].filter(([, s]) => s === want).map(([id]) => this.nameOf(id));
    const msg = { t: 'end', escaped: names('escaped'), caught: names('caught'), hunted: this.game.stats.hunted };
    this.room.send(msg);
    this.hooks.end(msg);
  }

  // ------------------------------------------------------------------
  // Spectating: after you're out, watch through a friend's eyes
  // ------------------------------------------------------------------
  nextSpectateTarget() { this.spectateIndex++; }

  // Moves your camera to a friend who is still in the mine.
  // Returns their name, or null if nobody is left.
  followCamera() {
    const alive = [...this.remotes.values()].filter((r) => !r.out);
    if (!alive.length) return null;
    const r = alive[this.spectateIndex % alive.length];
    const p = this.game.player;
    p.position.set(r.pos.x, r.pos.y, r.pos.z);
    p.y = r.pos.y;
    p.yaw += ((r.yaw - p.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) * 0.3; // smooth turning
    p.pitch = r.pitch;
    p.mode = r.creep ? 'creep' : 'walk';
    p.applyCamera(1 / 60, 0);
    return r.name;
  }

  leave() {
    this.endGame();
    this.room.leave();
  }
}

// =====================================================================
//  ECHO — net.js
//  Rooms and connections for multiplayer.
//
//  It uses PeerJS (WebRTC): players' browsers connect DIRECTLY to each
//  other. The free public PeerJS server is only used to introduce them,
//  like a phone book. The player who creates a room is the "host";
//  everyone else connects to the host, and the host passes messages on.
//
//  Testing on ONE computer: add ?net=local to the address
//  (http://localhost:8000/?net=local). Rooms then work between browser
//  tabs using a BroadcastChannel — no internet needed.
// =====================================================================
import { CONFIG } from './config.js';

const M = CONFIG.multiplayer;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L mix-ups
const ID_PREFIX = 'echo-salt-mine-room-';             // keeps our rooms apart from other PeerJS apps

export function isLocalMode() {
  return new URLSearchParams(location.search).get('net') === 'local';
}

function makeRoomCode() {
  let code = '';
  for (let i = 0; i < M.codeLength; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function cleanName(name) {
  const n = String(name || '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 14);
  return n || 'Stranger';
}

// Create our connection point ("peer"). Resolves once it is ready.
function openPeer(id) {
  return new Promise((resolve, reject) => {
    let peer;
    if (isLocalMode()) peer = new LocalPeer(id);
    else if (window.Peer) peer = new window.Peer(id, { debug: 1, ...M.peerOptions });
    else return reject(new Error('The multiplayer library did not load. Check your internet connection and reload.'));
    let ready = false;
    peer.on('open', () => { ready = true; resolve(peer); });
    peer.on('error', (err) => { if (!ready) reject(err); });
  });
}

// Turn PeerJS error types into friendly sentences.
function friendlyError(err) {
  const messages = {
    'peer-unavailable': 'No room with that code was found.',
    'network': 'Could not reach the connection server. Check your internet connection.',
    'server-error': 'The connection server is not responding. Try again in a minute.',
    'browser-incompatible': 'This browser does not support multiplayer (WebRTC). Try Chrome, Edge or Firefox.',
  };
  return new Error(messages[err && err.type] || (err && err.message) || 'Connection failed.');
}

// ---------------------------------------------------------------------
// Room: a host plus up to (maxPlayers - 1) friends.
// Events (room.on): 'message' (msg, fromId), 'players' (list),
//                   'left' (id), 'closed' (reason)
// ---------------------------------------------------------------------
export class Room {
  constructor(peer, isHost, code) {
    this.peer = peer;
    this.isHost = isHost;
    this.code = code;
    this.myId = 'host';
    this.players = [];        // [{ id, name, color }] — host first
    this.conns = new Map();   // host: friendId -> connection. friend: 'host' -> connection
    this.handlers = {};
    this.locked = false;      // host: true while a game runs (no joining mid-game)
    this.left = false;
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); }
  emit(type, ...args) { for (const fn of this.handlers[type] || []) fn(...args); }

  // ---------------- creating and joining ----------------
  static async create(name) {
    for (let tries = 0; tries < 5; tries++) {
      const code = makeRoomCode();
      try {
        const peer = await openPeer(ID_PREFIX + code);
        const room = new Room(peer, true, code);
        room.setupHost(cleanName(name));
        return room;
      } catch (err) {
        if (!err || err.type !== 'unavailable-id') throw friendlyError(err); // code taken? try another
      }
    }
    throw new Error('Could not create a room. Please try again.');
  }

  static async join(code, name) {
    let peer;
    try { peer = await openPeer(undefined); } catch (err) { throw friendlyError(err); }
    const room = new Room(peer, false, code.toUpperCase());
    try {
      await room.connectToHost(cleanName(name));
    } catch (err) {
      peer.destroy();
      throw err;
    }
    return room;
  }

  // ---------------- host side ----------------
  setupHost(name) {
    this.players = [{ id: 'host', name, color: 0 }];
    this.peer.on('connection', (conn) => conn.on('open', () => this.onFriendConnected(conn)));
    this.peer.on('error', (err) => console.warn('[ECHO net]', err.type || err));
  }

  onFriendConnected(conn) {
    if (this.locked) return this.refuse(conn, 'That game has already started. Ask the host to go back to the lobby.');
    if (this.players.length >= M.maxPlayers) return this.refuse(conn, 'That room is full.');
    const id = conn.peer;
    const used = this.players.map((p) => p.color);
    const color = [0, 1, 2, 3].find((c) => !used.includes(c));
    this.conns.set(id, conn);
    this.players.push({ id, name: cleanName(conn.metadata && conn.metadata.name), color });
    conn.on('data', (msg) => this.emit('message', msg, id));
    conn.on('close', () => this.onFriendLeft(id));
    conn.send({ t: 'welcome', id, players: this.players });
    this.broadcast({ t: 'players', players: this.players }, id);
    this.emit('players', this.players);
  }

  refuse(conn, reason) {
    conn.send({ t: 'refused', reason });
    setTimeout(() => conn.close(), 500);
  }

  onFriendLeft(id) {
    if (!this.conns.delete(id)) return;
    this.players = this.players.filter((p) => p.id !== id);
    this.broadcast({ t: 'players', players: this.players });
    this.emit('left', id);
    this.emit('players', this.players);
  }

  // ---------------- friend side ----------------
  connectToHost(name) {
    return new Promise((resolve, reject) => {
      const fail = (err) => { clearTimeout(timer); reject(err); };
      const timer = setTimeout(() => fail(new Error('No room with that code was found.')), M.joinTimeout * 1000);
      this.peer.on('error', (err) => fail(friendlyError(err)));
      const conn = this.peer.connect(ID_PREFIX + this.code, { metadata: { name }, reliable: true, serialization: 'json' });
      this.conns.set('host', conn);
      conn.on('data', (msg) => {
        if (msg.t === 'welcome') {
          clearTimeout(timer);
          this.myId = msg.id;
          this.players = msg.players;
          resolve();
        } else if (msg.t === 'refused') {
          fail(new Error(msg.reason));
        } else {
          if (msg.t === 'players') this.players = msg.players;
          this.emit('message', msg, 'host');
        }
      });
      conn.on('close', () => { if (!this.left) this.emit('closed', 'The host left the room.'); });
    });
  }

  // ---------------- sending ----------------
  // Friend: send to the host. Host: send to every friend (except one, optionally).
  send(msg, exceptId) {
    if (this.isHost) this.broadcast(msg, exceptId);
    else this.sendTo('host', msg);
  }

  broadcast(msg, exceptId) {
    for (const [id, conn] of this.conns) if (id !== exceptId && conn.open) conn.send(msg);
  }

  sendTo(id, msg) {
    const conn = this.conns.get(id);
    if (conn && conn.open) conn.send(msg);
  }

  playerById(id) { return this.players.find((p) => p.id === id); }

  leave() {
    this.left = true;
    for (const conn of this.conns.values()) conn.close();
    this.conns.clear();
    setTimeout(() => this.peer.destroy(), 300); // give the goodbye a moment to arrive
  }
}

// =====================================================================
// LocalPeer: a pretend PeerJS peer that talks between tabs of the same
// browser (for testing with ?net=local). Same methods as PeerJS uses.
// =====================================================================
class Emitter {
  on(type, fn) { ((this._h ||= {})[type] ||= []).push(fn); return this; }
  emit(type, ...args) { for (const fn of (this._h && this._h[type]) || []) fn(...args); }
}

class LocalPeer extends Emitter {
  constructor(id) {
    super();
    this.id = id || `local-${Math.random().toString(36).slice(2, 10)}`;
    this.conns = new Map();
    this.bc = new BroadcastChannel('echo-local-net');
    this.bc.onmessage = (e) => this.receive(e.data);
    window.addEventListener('beforeunload', () => this.destroy());
    setTimeout(() => this.emit('open', this.id), 50);
  }

  post(to, kind, extra = {}) {
    if (!this.destroyed) this.bc.postMessage({ to, from: this.id, kind, ...extra });
  }

  receive(m) {
    if (m.to !== this.id || this.destroyed) return;
    const conn = this.conns.get(m.from);
    if (m.kind === 'connect') {
      const c = new LocalConn(this, m.from, m.metadata);
      this.conns.set(m.from, c);
      this.emit('connection', c);
      this.post(m.from, 'accept');
      c.markOpen();
    } else if (m.kind === 'accept' && conn) conn.markOpen();
    else if (m.kind === 'data' && conn) conn.emit('data', m.data);
    else if (m.kind === 'close' && conn) {
      this.conns.delete(m.from);
      conn.open = false;
      conn.emit('close');
    }
  }

  connect(id, { metadata } = {}) {
    const c = new LocalConn(this, id, metadata);
    this.conns.set(id, c);
    this.post(id, 'connect', { metadata });
    setTimeout(() => { if (!c.open && !this.destroyed) this.emit('error', { type: 'peer-unavailable' }); }, 1500);
    return c;
  }

  destroy() {
    if (this.destroyed) return;
    for (const id of this.conns.keys()) this.post(id, 'close');
    this.conns.clear();
    this.destroyed = true;
    this.bc.close();
  }
}

class LocalConn extends Emitter {
  constructor(owner, remoteId, metadata) {
    super();
    this.owner = owner;
    this.peer = remoteId;   // PeerJS calls the other side's id "peer"
    this.metadata = metadata;
    this.open = false;
  }
  markOpen() {
    if (this.open) return;
    this.open = true;
    setTimeout(() => this.emit('open'), 0);
  }
  send(data) { if (this.open) this.owner.post(this.peer, 'data', { data }); }
  close() {
    if (!this.open) return;
    this.open = false;
    this.owner.post(this.peer, 'close');
    this.owner.conns.delete(this.peer);
  }
}

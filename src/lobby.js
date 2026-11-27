// =====================================================================
//  ECHO — lobby.js
//  The "Play with friends" menu: choose a name, create a room or join
//  one with a code, then wait in the lobby until the host starts.
// =====================================================================
import { CONFIG } from './config.js';
import { Room, isLocalMode } from './net.js';

const $ = (id) => document.getElementById(id);
const NAME_KEY = 'echo-player-name';

export class Lobby {
  // handlers: enterRoom(room), start(), leave(), back()
  constructor(ui, handlers) {
    this.ui = ui;
    this.handlers = handlers;
    this.busy = false;
    $('mpName').value = loadName();
    $('createBtn').addEventListener('click', () => this.create());
    $('joinBtn').addEventListener('click', () => this.join());
    $('joinCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.join(); });
    $('mpBackBtn').addEventListener('click', () => handlers.back());
    $('copyCodeBtn').addEventListener('click', () => this.copyCode());
    $('lobbyStartBtn').addEventListener('click', () => handlers.start());
    $('lobbyLeaveBtn').addEventListener('click', () => handlers.leave());
    $('joinCode').maxLength = CONFIG.multiplayer.codeLength;
    $('localNote').classList.toggle('hidden', !isLocalMode());
  }

  openMenu() {
    this.setStatus('');
    this.ui.show('mpmenu');
  }

  setStatus(text, isError = false) {
    $('mpStatus').textContent = text;
    $('mpStatus').classList.toggle('error', isError);
  }

  playerName() {
    const name = $('mpName').value.trim();
    saveName(name);
    return name;
  }

  async create() {
    if (this.busy) return;
    this.busy = true;
    this.setStatus('Creating a room…');
    try {
      const room = await Room.create(this.playerName());
      this.handlers.enterRoom(room);
    } catch (err) {
      this.setStatus(err.message, true);
    }
    this.busy = false;
  }

  async join() {
    const code = $('joinCode').value.trim();
    if (this.busy) return;
    if (code.length !== CONFIG.multiplayer.codeLength) {
      this.setStatus(`Room codes have ${CONFIG.multiplayer.codeLength} letters.`, true);
      return;
    }
    this.busy = true;
    this.setStatus(`Looking for room ${code}…`);
    try {
      const room = await Room.join(code, this.playerName());
      this.handlers.enterRoom(room);
    } catch (err) {
      this.setStatus(err.message, true);
    }
    this.busy = false;
  }

  // The waiting room.
  showRoom(room) {
    this.room = room;
    $('roomCode').textContent = room.code;
    this.renderPlayers(room.players, room.myId);
    this.ui.show('lobby');
  }

  renderPlayers(players, myId) {
    const M = CONFIG.multiplayer;
    $('playerList').innerHTML = '';
    for (const p of players) {
      const li = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = rgb(M.colors[p.color]);
      li.appendChild(swatch);
      const tags = [p.id === 'host' ? 'host' : '', p.id === myId ? 'you' : ''].filter(Boolean).join(', ');
      li.appendChild(document.createTextNode(`${p.name}${tags ? `  (${tags})` : ''}`));
      $('playerList').appendChild(li);
    }
    $('playerCount').textContent = `${players.length}/${M.maxPlayers} players`;
  }

  setDifficulty(name) { $('lobbyDifficulty').textContent = name.toUpperCase(); }

  copyCode() {
    const code = $('roomCode').textContent;
    const done = () => { $('copyCodeBtn').textContent = 'COPIED!'; setTimeout(() => { $('copyCodeBtn').textContent = 'COPY CODE'; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, () => {});
  }

  // A message on the title screen (e.g. "The host left the room.").
  notice(text) {
    $('titleNotice').textContent = text || '';
  }
}

function rgb([r, g, b]) {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

// Remember the player's name between visits (if the browser allows it).
function loadName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
}
function saveName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* not important */ }
}

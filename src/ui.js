// =====================================================================
//  ECHO — ui.js
//  HUD (cooldown ring, forks, pebbles, noise meter), captions,
//  screen overlays and red flash / fear vignette effects.
//  All the HTML lives in index.html; this file just updates it.
// =====================================================================
import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['title', 'pause', 'gameover', 'win', 'mpmenu', 'lobby'];
const SOLO_TITLES = { win: 'YOU ESCAPED', gameover: 'IT HEARD YOU' };
const RING_LENGTH = 2 * Math.PI * 16; // circumference of the cooldown circle (r = 16)

export class UI {
  constructor() {
    this.captionsOn = CONFIG.ui.captions;
    this.captionBox = $('captions');
    this.arc = $('cooldownArc');
    this.arc.style.strokeDasharray = RING_LENGTH;
    $('optCaptions').checked = this.captionsOn;
    $('optCaptions2').checked = this.captionsOn;
    for (const id of ['optCaptions', 'optCaptions2']) {
      $(id).addEventListener('change', (e) => this.setCaptions(e.target.checked));
    }
  }

  setCaptions(on) {
    this.captionsOn = on;
    $('optCaptions').checked = on;
    $('optCaptions2').checked = on;
    if (!on) this.captionBox.innerHTML = '';
  }

  // Show one screen (or null for none = in-game HUD).
  show(name) {
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== name);
    $('hud').classList.toggle('hidden', name !== null);
    $('spectate').classList.add('hidden');
    if (name !== null) this.captionBox.innerHTML = '';
  }

  // fraction: 0 = just used, 1 = ready
  setCooldown(fraction) {
    this.arc.style.strokeDashoffset = RING_LENGTH * (1 - fraction);
    $('cooldown').classList.toggle('ready', fraction >= 1);
  }

  setForks(n, total) { $('forks').textContent = `TUNING FORKS  ${n}/${total}`; }
  setPebbles(n) { $('pebbles').textContent = `PEBBLES  ${n}`; }

  // level: 0..1
  setNoise(level) {
    $('noiseFill').style.width = `${Math.round(level * 100)}%`;
    $('noiseFill').style.background = level > 0.66 ? '#ff4433' : level > 0.33 ? '#ffbb44' : '#9fe8ff';
  }

  // Show a caption line for a few seconds.
  caption(text, important = false) {
    if (!this.captionsOn) return;
    const line = document.createElement('div');
    line.className = important ? 'caption important' : 'caption';
    line.textContent = text;
    this.captionBox.appendChild(line);
    while (this.captionBox.children.length > 4) this.captionBox.firstChild.remove();
    setTimeout(() => line.classList.add('fade'), CONFIG.ui.captionTime * 1000);
    setTimeout(() => line.remove(), CONFIG.ui.captionTime * 1000 + 600);
  }

  // A quick full-screen colour flash.
  flash(color = 'rgba(255,0,0,0.85)', ms = 600) {
    const f = $('flash');
    f.style.transition = 'none';
    f.style.background = color;
    f.style.opacity = 1;
    requestAnimationFrame(() => {
      f.style.transition = `opacity ${ms}ms ease-out`;
      f.style.opacity = 0;
    });
  }

  // Multiplayer: the line at the top while you watch a friend.
  setSpectate(why, name) {
    const head = why === 'caught' ? 'YOU WERE CAUGHT' : 'YOU ESCAPED';
    const who = name ? `watching ${name}` : 'waiting for the others…';
    const html = `${head} — ${who}<small>SPACE: next player · ESC: menu</small>`;
    if ($('spectate').innerHTML !== html) $('spectate').innerHTML = html;
    $('spectate').classList.remove('hidden');
  }

  // Multiplayer end screens list who escaped and who was caught.
  // result = null puts back the single-player text.
  setTeamResult(screen, result) {
    const title = document.querySelector(`#${screen} h2`);
    if (!result) {
      title.textContent = SOLO_TITLES[screen];
      $(`${screen}Team`).innerHTML = '';
      return;
    }
    const total = result.escaped.length + result.caught.length;
    title.textContent = result.escaped.length ? `${result.escaped.length} OF ${total} ESCAPED` : 'NOBODY ESCAPED';
    const line = (label, names) => (names.length ? `<div><span>${label}:</span> ${names.map(escapeHtml).join(', ')}</div>` : '');
    $(`${screen}Team`).innerHTML = line('Escaped', result.escaped) + line('Caught', result.caught);
  }

  // Hide or show the in-game HUD and captions.
  setHud(on) {
    $('hud').classList.toggle('hidden', !on);
    if (!on) this.captionBox.innerHTML = '';
  }

  // Instantly cover the screen in black (true), or fade the black away (false).
  setBlack(on) {
    const f = $('flash');
    f.style.transition = on ? 'none' : 'opacity 900ms ease-out';
    if (on) f.style.background = '#000';
    f.style.opacity = on ? 1 : 0;
  }

  // Make a screen's title shudder (restarts the CSS animation).
  shudder(screen) {
    const h = document.querySelector(`#${screen} h2`);
    h.classList.remove('shudder');
    void h.offsetWidth; // forces the browser to restart the animation
    h.classList.add('shudder');
  }

  // Red vignette that creeps in as the creature gets closer. amount 0..1
  setFear(amount) { $('vignette').style.opacity = amount.toFixed(3); }

  setStats(screen, stats) {
    const m = Math.floor(stats.time / 60), s = Math.floor(stats.time % 60);
    const time = `${m}:${String(s).padStart(2, '0')}`;
    $(`${screen}Stats`).innerHTML =
      `<div><span>Time</span><b>${time}</b></div>` +
      `<div><span>Claps used</span><b>${stats.claps}</b></div>` +
      `<div><span>Times hunted</span><b>${stats.hunted}</b></div>` +
      `<div><span>Tuning forks</span><b>${stats.forks}/${CONFIG.goal.forkCount}</b></div>`;
  }
}

// Describe where a sound is compared to where the player is looking.
// Returns { dir: 'behind you', dist: 'close' } etc.
export function describeDirection(player, pos) {
  const tx = pos.x - player.position.x, tz = pos.z - player.position.z;
  const f = player.forward(), r = player.right();
  const ahead = tx * f.x + tz * f.z, side = tx * r.x + tz * r.z;
  const angle = Math.atan2(side, ahead) * 180 / Math.PI;
  let dir = 'behind you';
  if (Math.abs(angle) < 45) dir = 'ahead';
  else if (angle >= 45 && angle <= 135) dir = 'to your right';
  else if (angle <= -45 && angle >= -135) dir = 'to your left';
  const d = Math.hypot(tx, tz);
  const dist = d < CONFIG.ui.closeDistance ? 'close' : d < CONFIG.ui.nearDistance ? 'nearby' : 'distant';
  return { dir, dist };
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

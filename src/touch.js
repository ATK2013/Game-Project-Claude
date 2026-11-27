// =====================================================================
//  ECHO — touch.js
//  Mobile mode: detecting phones/tablets and the on-screen touch controls.
//    • left thumb  — a joystick that appears where you touch.
//                    Small push = creep (silent), normal = walk, full = run.
//    • right thumb — drag to look around.
//    • buttons     — CLAP, SNAP, PEBBLE and pause.
//  The controls feed the same Input object the keyboard and mouse use.
// =====================================================================
import { CONFIG } from './config.js';

const MC = CONFIG.mobile;
const $ = (id) => document.getElementById(id);

// Is this a phone or tablet? (?mobile=1 / ?mobile=0 in the address forces it.)
export function detectMobile() {
  const forced = new URLSearchParams(location.search).get('mobile');
  if (forced === '1') return true;
  if (forced === '0') return false;
  const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches; // finger, not mouse
  const phoneName = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1; // iPads pretend to be Macs
  return touch && (coarse || phoneName || iPadOS);
}

// A short buzz (Android phones; iPhones ignore this).
export function vibrate(pattern) {
  if (MC.vibrate && document.body.classList.contains('mobile') && navigator.vibrate) navigator.vibrate(pattern);
}

// Go fullscreen and sideways where the browser allows it (must be called from a tap).
export function enterFullscreen() {
  const el = document.documentElement;
  if (!el.requestFullscreen || document.fullscreenElement) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
    .catch(() => { /* not allowed here (e.g. iPhone) — that's fine */ });
}

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.stickId = null;     // which finger is on the joystick
    this.lookId = null;      // which finger is looking around
    this.mode = null;        // 'play' | 'spectate' | null (hidden)
    this.wire();
  }

  // Show the controls for playing, spectating (fewer buttons), or hide them.
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    $('touch').classList.toggle('hidden', !mode);
    $('touch').classList.toggle('spectate', mode === 'spectate');
    $('tClap').textContent = mode === 'spectate' ? 'NEXT' : 'CLAP';
    if (!mode) this.releaseAll();
  }

  wire() {
    const opts = { passive: false };
    const zone = $('touch');
    zone.addEventListener('touchstart', (e) => this.onStart(e), opts);
    zone.addEventListener('touchmove', (e) => this.onMove(e), opts);
    zone.addEventListener('touchend', (e) => this.onEnd(e), opts);
    zone.addEventListener('touchcancel', (e) => this.onEnd(e), opts);
    this.button('tClap', 'clap');
    this.button('tSnap', 'snap');
    this.button('tThrow', 'throw');
    this.button('tPause', 'pause');
  }

  // A button fires its action the moment your finger touches it.
  button(id, action) {
    $(id).addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      $(id).classList.add('down');
      this.input.fire(action);
    }, { passive: false });
    const up = () => $(id).classList.remove('down');
    $(id).addEventListener('touchend', up);
    $(id).addEventListener('touchcancel', up);
  }

  onStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const leftSide = t.clientX < window.innerWidth * 0.45;
      if (leftSide && this.stickId === null && this.mode === 'play') this.startStick(t);
      else if (!leftSide && this.lookId === null) this.startLook(t);
    }
  }

  onMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) this.moveStick(t);
      else if (t.identifier === this.lookId) this.moveLook(t);
    }
  }

  onEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) this.endStick();
      else if (t.identifier === this.lookId) this.lookId = null;
    }
  }

  // ---------------- joystick (left thumb) ----------------
  startStick(t) {
    this.stickId = t.identifier;
    this.origin = { x: t.clientX, y: t.clientY };
    const s = $('stick');
    s.style.left = `${t.clientX}px`;
    s.style.top = `${t.clientY}px`;
    s.classList.remove('hidden');
    this.moveStick(t);
  }

  moveStick(t) {
    const r = MC.stickRadius;
    let dx = (t.clientX - this.origin.x) / r, dy = (t.clientY - this.origin.y) / r;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    const mag = Math.min(1, len);
    // screen up = walk forward
    this.input.stick = { x: dx, y: -dy, mag };
    $('stickKnob').style.transform = `translate(${dx * r}px, ${dy * r}px)`;
    const mode = mag < 0.12 ? '' : mag < MC.creepZone ? 'CREEP' : mag > MC.runZone ? 'RUN' : 'WALK';
    $('stickLabel').textContent = mode;
    $('stick').dataset.mode = mode.toLowerCase();
  }

  endStick() {
    this.stickId = null;
    this.input.stick = null;
    $('stick').classList.add('hidden');
  }

  // ---------------- looking (right thumb) ----------------
  startLook(t) {
    this.lookId = t.identifier;
    this.last = { x: t.clientX, y: t.clientY };
  }

  moveLook(t) {
    // add to the same "mouse movement" the desktop uses
    this.input.mouseDX += (t.clientX - this.last.x) * MC.lookSensitivity;
    this.input.mouseDY += (t.clientY - this.last.y) * MC.lookSensitivity;
    this.last = { x: t.clientX, y: t.clientY };
  }

  releaseAll() {
    this.endStick();
    this.lookId = null;
  }
}

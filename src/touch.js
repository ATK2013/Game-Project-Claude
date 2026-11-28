// =====================================================================
//  ECHO — touch.js
//  Mobile mode: detecting phones/tablets and the on-screen touch controls.
//    • left thumb  — a joystick that appears where you touch.
//                    Small push = creep (silent), normal = walk, full = run.
//    • right thumb — drag to look around.
//    • buttons     — CLAP, SNAP, JUMP, PEBBLE (says PULL next to a lever),
//                    DART (when you have one) and pause.
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
    // A lifted finger is reported to the element it started on, but iPads can
    // also lose a finger to a system swipe without saying so. Listen everywhere,
    // and let go of everything when the page loses focus.
    window.addEventListener('touchend', (e) => this.reconcile(e));
    window.addEventListener('touchcancel', (e) => this.reconcile(e));
    window.addEventListener('blur', () => this.releaseAll());
    window.addEventListener('pagehide', () => this.releaseAll());
    window.addEventListener('orientationchange', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => this.releaseAll());
    this.button('tClap', 'clap');
    this.button('tSnap', 'snap');
    this.button('tThrow', 'throw');
    this.button('tJump', 'jump');
    this.button('tDart', 'dart');
    this.button('tPause', 'pause');
  }

  // The DART button only appears while you're carrying darts.
  setDarts(n) {
    if (this.darts === n) return;
    this.darts = n;
    $('tDart').classList.toggle('hidden', n <= 0);
    $('tDart').textContent = n > 1 ? `DART ×${n}` : 'DART';
  }

  // The PEBBLE button turns into PULL when you stand next to a lever.
  setThrowLabel(text) {
    if ($('tThrow').textContent !== text) $('tThrow').textContent = text;
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

  // Every touch event lists ALL fingers that are still on the screen.
  // If we think a finger is on the joystick (or looking) but it isn't in
  // that list, it was lifted without us being told: let go of it.
  reconcile(e) {
    const down = new Set(Array.from(e.touches, (t) => t.identifier));
    if (this.stickId !== null && !down.has(this.stickId)) this.endStick();
    if (this.lookId !== null && !down.has(this.lookId)) this.lookId = null;
  }

  onStart(e) {
    e.preventDefault();
    this.reconcile(e);
    for (const t of e.changedTouches) {
      const leftSide = t.clientX < window.innerWidth * 0.45;
      if (leftSide && this.stickId === null && this.mode === 'play') this.startStick(t);
      else if (!leftSide && this.lookId === null) this.startLook(t);
    }
  }

  onMove(e) {
    e.preventDefault();
    this.reconcile(e);
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) this.moveStick(t);
      else if (t.identifier === this.lookId) this.moveLook(t);
    }
  }

  onEnd(e) {
    e.preventDefault(); // stops the iPad turning the tap into a mouse click
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) this.endStick();
      else if (t.identifier === this.lookId) this.lookId = null;
    }
    this.reconcile(e);
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

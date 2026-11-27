// =====================================================================
//  ECHO — input.js
//  Keyboard, mouse and pointer-lock handling.
//  Other code asks "is this key down?" or listens for named actions
//  like 'clap', 'snap', 'throw', 'jump' and 'pause'.
// =====================================================================

import { CONFIG } from './config.js';

// Which key triggers which one-shot action (set in CONFIG.keys).
const KEY_ACTIONS = {};
for (const [action, codes] of Object.entries(CONFIG.keys)) {
  for (const code of codes) KEY_ACTIONS[code] = action;
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();     // keys currently held down
    this.mouseDX = 0;          // mouse movement since last frame
    this.mouseDY = 0;
    this.locked = false;       // is the mouse captured?
    this.stick = null;         // mobile joystick: { x, y, mag } while a thumb is on it
    this.mobile = false;       // mobile mode: no mouse capture
    this.handlers = {};        // action name -> list of functions
    this.addListeners();
  }

  // Register a function to run when an action happens.
  on(action, fn) {
    (this.handlers[action] ||= []).push(fn);
  }

  fire(action, data) {
    for (const fn of this.handlers[action] || []) fn(data);
  }

  isDown(code) {
    return this.keys.has(code);
  }

  // Read and reset the mouse movement collected since last frame.
  consumeMouse() {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = this.mouseDY = 0;
    return d;
  }

  requestLock() {
    if (this.mobile) return; // touch screens look with a thumb instead
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {}); // browsers may refuse; that's OK
    } catch (e) { /* ignore */ }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  addListeners() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.fire('lockchange', this.locked);
    });
  }

  onKeyDown(e) {
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    this.keys.add(e.code);
    if (e.repeat) return;
    const action = KEY_ACTIONS[e.code];
    if (action) this.fire(action);
  }

  onMouseDown(e) {
    // Touch screens turn taps into fake mouse clicks: ignore those, and only
    // clap with a real mouse while it is captured.
    if (this.mobile || (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents)) return;
    if (!this.locked) {
      this.fire('canvasclick');
      return;
    }
    if (e.button === 0) this.fire('clap');
    if (e.button === 2) this.fire('snap');
  }
}

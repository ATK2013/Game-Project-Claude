// =====================================================================
//  ECHO — audio.js
//  Every sound in the game is synthesised here with the Web Audio API.
//  No audio files! Sounds placed in the world use a PannerNode with
//  HRTF, so with headphones you can hear which direction they come from.
// =====================================================================
import { CONFIG } from './config.js';

const A = CONFIG.audio;

export class AudioEngine {
  // light = true on phones/tablets: cheaper 3D sound that doesn't crackle
  constructor({ light = false } = {}) {
    this.light = light;
    this.ctx = null;           // created on the first click (browser rule)
    this.voiceEnds = [];       // when each recently started sound finishes (for the limit)
    this.wallsTo = () => 0;    // set by main.js: rock cells between listener and a point
  }

  // ------------------------------------------------------------------
  // Setup
  // ------------------------------------------------------------------
  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    let ctx;
    try {
      // 'playback' = bigger sound buffers: a little more delay, but no crackling
      ctx = new Ctx({ latencyHint: this.light ? 'playback' : 'interactive' });
    } catch (e) {
      ctx = new Ctx();
    }
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = A.masterVolume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    // cave reverb: a convolver with a generated "impulse response"
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(this.light ? Math.min(1.8, A.reverbSeconds) : A.reverbSeconds, 2.6);
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = A.reverbWet;
    this.reverbIn.connect(this.reverb).connect(this.master);
    this.noise = this.makeNoise(2);
    this.distortCurve = this.makeDistortion(60);
  }

  // ('interrupted' is what iPhones/iPads say after a call or switching apps)
  resume() { if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  get now() { return this.ctx.currentTime; }

  // Random noise that fades out = the "sound" of a big cave.
  makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // A curve for the WaveShaper that makes sounds harsh and distorted.
  makeDistortion(amount) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / n) * 2 - 1;
      curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  // ------------------------------------------------------------------
  // Listener (your ears) follows the camera
  // ------------------------------------------------------------------
  setListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener, p = camera.position;
    const f = camera.getWorldDirection(this._tmpF || (this._tmpF = p.clone()));
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }

  // ------------------------------------------------------------------
  // Building blocks
  // ------------------------------------------------------------------

  // Where a sound goes. pos = world position (or null for "in your head").
  // Returns the node you should connect your sound into.
  output(pos, { gain = 1, reverb = 0.5 } = {}) {
    const ctx = this.ctx;
    // world sounds can be skipped when too many play at once; your own
    // sounds and the jumpscare (no position) always play
    if (pos && this.tooManySounds()) return ctx.createGain(); // not connected = silent
    const g = ctx.createGain();
    g.gain.value = gain;
    let last = g;
    if (pos) {
      // muffle sounds that come through rock (fewer high frequencies)
      const walls = this.wallsTo(pos);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = walls === 0 ? 20000 : Math.max(450, 2600 / walls);
      g.gain.value = gain * (walls === 0 ? 1 : 0.6 / walls + 0.15);
      last = g.connect(lp).connect(this.makePanner(pos));
    }
    last.connect(this.master);
    const send = ctx.createGain();
    send.gain.value = reverb;
    last.connect(send).connect(this.reverbIn);
    return g;
  }

  // Too many sounds at once overloads small devices (crackling, clicking).
  tooManySounds() {
    const now = this.now;
    this.voiceEnds = this.voiceEnds.filter((t) => t > now);
    const max = this.light ? CONFIG.mobile.maxSounds : 64;
    if (this.voiceEnds.length >= max) return true;
    this.voiceEnds.push(now + 1.2); // most one-shot sounds are over within ~1 s
    return false;
  }

  makePanner(pos) {
    const p = this.ctx.createPanner();
    // HRTF = realistic 3D sound for headphones, but heavy. Phones use the
    // simpler 'equalpower' (still left/right) so the sound never breaks up.
    p.panningModel = this.light ? 'equalpower' : 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1.5;
    p.maxDistance = 100;
    p.rolloffFactor = 1.1;
    setPannerPos(p, pos);
    return p;
  }

  // Play a burst of filtered noise. type = filter type, f = frequency.
  noiseBurst(dest, { t = this.now, dur = 0.1, type = 'bandpass', f = 1000, q = 1, gain = 1, attack = 0.002 }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true; // long bursts may run past the end of the buffer
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = f;
    filt.Q.value = q;
    const g = this.envelope(t, attack, gain, dur);
    src.connect(filt).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + dur + 0.05);
    return filt;
  }

  // Play a short tone. f0 -> f1 = pitch slide.
  tone(dest, { t = this.now, type = 'sine', f0 = 440, f1 = f0, dur = 0.2, gain = 0.5, attack = 0.003 }) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = this.envelope(t, attack, gain, dur);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + attack + dur + 0.05);
    return osc;
  }

  // A gain node that rises quickly then fades out exponentially.
  envelope(t, attack, peak, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  // ------------------------------------------------------------------
  // Player sounds
  // ------------------------------------------------------------------
  // Player sounds: pos = null means "you" (in your head); a position
  // places a friend's sound in the world, so you hear where they are.
  clap(pos = null) {
    const out = this.output(pos, { gain: 0.9, reverb: 1.0 });
    this.noiseBurst(out, { f: 1900, q: 0.9, dur: 0.11, gain: 1.0 });
    this.noiseBurst(out, { f: 900, q: 1.2, dur: 0.07, gain: 0.6 });
  }

  snap(pos = null) {
    const out = this.output(pos, { gain: 0.5, reverb: 0.55 });
    this.noiseBurst(out, { f: 3800, q: 2.5, dur: 0.035, gain: 1 });
    this.tone(out, { f0: 2400, f1: 1800, dur: 0.02, gain: 0.3 });
  }

  footstep(mode, pos = null) {
    const loud = mode === 'run' ? 0.5 : mode === 'creep' ? 0.06 : 0.25;
    const out = this.output(pos, { gain: loud, reverb: 0.25 });
    this.noiseBurst(out, { type: 'lowpass', f: 350 + Math.random() * 200, q: 1, dur: 0.09, gain: 1 });
    this.noiseBurst(out, { type: 'highpass', f: 3500, q: 0.5, dur: 0.04, gain: 0.12 }); // salt crunch
  }

  throwWhoosh() {
    const out = this.output(null, { gain: 0.15, reverb: 0.1 });
    const f = this.noiseBurst(out, { f: 600, q: 2, dur: 0.25, attack: 0.08, gain: 1 });
    f.frequency.exponentialRampToValueAtTime(2000, this.now + 0.3);
  }

  pickup() {
    const out = this.output(null, { gain: 0.25, reverb: 0.3 });
    this.noiseBurst(out, { f: 2200, q: 4, dur: 0.03, gain: 1 });
    this.noiseBurst(out, { t: this.now + 0.06, f: 2600, q: 4, dur: 0.03, gain: 0.7 });
  }

  // ------------------------------------------------------------------
  // World sounds (positioned in 3D)
  // ------------------------------------------------------------------
  drip(pos) {
    const out = this.output(pos, { gain: 0.35, reverb: 0.9 });
    const f = 900 + Math.random() * 900;
    this.tone(out, { f0: f, f1: f * 0.45, dur: 0.09, gain: 0.5 });
  }

  pebble(pos, strength = 1) {
    const out = this.output(pos, { gain: 0.7 * strength, reverb: 0.6 });
    [0, 0.11, 0.19].forEach((dt, i) =>
      this.noiseBurst(out, { t: this.now + dt, f: 1300 + i * 300, q: 3, dur: 0.025, gain: 1 / (i + 1) }));
  }

  can(pos) {
    const out = this.output(pos, { gain: 0.8, reverb: 0.7 });
    for (let i = 0; i < 5; i++) {
      const t = this.now + i * (0.09 + Math.random() * 0.08) + i * i * 0.02;
      const base = 1100 + Math.random() * 900, g = 0.5 / (i + 1);
      for (const ratio of [1, 2.76, 5.4]) this.tone(out, { t, f0: base * ratio, dur: 0.12, gain: g / ratio });
      this.noiseBurst(out, { t, f: 4500, q: 2, dur: 0.03, gain: g });
    }
  }

  // Landing from a jump. strength 0..1
  thud(pos, strength = 1) {
    const out = this.output(pos, { gain: 0.35 + strength * 0.4, reverb: 0.35 });
    this.tone(out, { f0: 110, f1: 45, dur: 0.12, gain: 1 });
    this.noiseBurst(out, { type: 'lowpass', f: 500, dur: 0.1, gain: 0.8 });
    this.noiseBurst(out, { type: 'highpass', f: 3000, dur: 0.05, gain: 0.15 }); // gravel
  }

  // Falling into a crevice: a body hitting rock, then pebbles trickling down.
  crash(pos) {
    const out = this.output(pos, { gain: 1.0, reverb: 0.9 });
    this.tone(out, { f0: 90, f1: 30, dur: 0.35, gain: 1.2 });
    this.noiseBurst(out, { type: 'lowpass', f: 700, dur: 0.4, gain: 1 });
    for (let i = 0; i < 7; i++) {
      this.noiseBurst(out, { t: this.now + 0.15 + Math.random() * 0.9, f: 1500 + Math.random() * 2000, q: 4, dur: 0.03, gain: 0.4 });
    }
  }

  // A heavy iron lever being thrown.
  leverClunk(pos) {
    const out = this.output(pos, { gain: 0.7, reverb: 0.5 });
    const f = this.noiseBurst(out, { f: 900, q: 3, dur: 0.18, attack: 0.04, gain: 0.5 }); // rusty creak
    f.frequency.exponentialRampToValueAtTime(400, this.now + 0.2);
    this.tone(out, { t: this.now + 0.2, f0: 160, f1: 70, dur: 0.15, gain: 0.9 });       // clunk
    this.tone(out, { t: this.now + 0.2, type: 'square', f0: 620, f1: 500, dur: 0.06, gain: 0.12 });
  }

  // An iron gate grinding up or down.
  gateGrind(pos) {
    const out = this.output(pos, { gain: 0.8, reverb: 0.8 });
    const f = this.noiseBurst(out, { f: 300, q: 6, dur: 2.0, attack: 0.2, gain: 0.8 });
    f.frequency.linearRampToValueAtTime(520, this.now + 2.2);
    this.tone(out, { type: 'sawtooth', f0: 58, f1: 64, dur: 2.0, gain: 0.25, attack: 0.2 });
    this.tone(out, { t: this.now + 2.1, f0: 140, f1: 60, dur: 0.3, gain: 0.8 });       // final clank
  }

  // A big old mine bell: loud, long, metallic.
  bell(pos) {
    const out = this.output(pos, { gain: 1.0, reverb: 1.0 });
    for (const [ratio, g, d] of [[1, 0.6, 4], [2.76, 0.3, 2.5], [5.4, 0.2, 1.2], [8.9, 0.1, 0.5]]) {
      this.tone(out, { f0: 260 * ratio, dur: d, gain: g });
    }
    this.noiseBurst(out, { f: 3000, q: 2, dur: 0.05, gain: 0.5 });
  }

  creatureClick(pos) {
    const out = this.output(pos, { gain: 1.1, reverb: 0.7 });
    for (let i = 0; i < 3; i++) {
      const t = this.now + i * 0.075;
      this.noiseBurst(out, { t, f: 2800 + Math.random() * 600, q: 9, dur: 0.03, gain: 1.4 });
      this.tone(out, { t, type: 'square', f0: 900, f1: 500, dur: 0.012, gain: 0.15 });
    }
  }

  // Slow scraping footstep of the creature.
  creatureStep(pos) {
    const out = this.output(pos, { gain: 0.7, reverb: 0.4 });
    const f = this.noiseBurst(out, { f: 320, q: 1.2, dur: 0.45, attack: 0.06, gain: 1 });
    f.frequency.exponentialRampToValueAtTime(140, this.now + 0.5);
    this.tone(out, { f0: 90, f1: 50, dur: 0.08, gain: 0.5 });
  }

  // Short screech when the creature starts hunting.
  creatureScreech(pos) {
    const out = this.output(pos, { gain: 0.45, reverb: 0.8 });
    this.screech(out, 0.7, 500, 1300);
  }

  // A slow, rattling breath: a hissing inhale, then a wet, croaking exhale.
  // closeness 0..1 makes it louder.
  creatureBreath(pos, closeness) {
    const out = this.output(pos, { gain: 0.25 + closeness * 0.5, reverb: 0.35 });
    const t = this.now;
    const inhale = this.noiseBurst(out, { t, f: 700, q: 1.5, dur: 0.7, attack: 0.5, gain: 0.5 });
    inhale.frequency.exponentialRampToValueAtTime(1400, t + 1.1);
    const exhale = this.noiseBurst(out, { t: t + 1.25, f: 520, q: 1.2, dur: 0.9, attack: 0.15, gain: 0.7 });
    exhale.frequency.exponentialRampToValueAtTime(260, t + 2.3);
    // the "rattle": a very low buzzing growl under the exhale
    const rattle = this.ctx.createOscillator();
    rattle.type = 'sawtooth';
    rattle.frequency.setValueAtTime(34, t + 1.25);
    rattle.frequency.linearRampToValueAtTime(26, t + 2.2);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = this.envelope(t + 1.25, 0.12, 0.35, 0.9);
    rattle.connect(lp).connect(g).connect(out);
    rattle.start(t + 1.25);
    rattle.stop(t + 2.4);
  }

  // Shared screech recipe: distorted sawtooth with a wobbling pitch.
  screech(dest, dur, f0, f1) {
    const ctx = this.ctx, t = this.now;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.3);
    osc.frequency.exponentialRampToValueAtTime(f1 * 0.6, t + dur);
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.frequency.value = 28;
    lfoGain.gain.value = f0 * 0.12;
    lfo.connect(lfoGain).connect(osc.frequency);
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.distortCurve;
    const g = this.envelope(t, 0.02, 0.8, dur);
    osc.connect(shaper).connect(g).connect(dest);
    osc.start(t); lfo.start(t);
    osc.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
    this.noiseBurst(dest, { type: 'highpass', f: 2500, dur: dur * 0.8, gain: 0.5, attack: 0.01 });
  }

  // ------------------------------------------------------------------
  // Jumpscare sounds (CONFIG.jumpscare.volume scales them all)
  // ------------------------------------------------------------------
  scareOut(gain, reverb) {
    return this.output(null, { gain: gain * CONFIG.jumpscare.volume, reverb });
  }

  // Cut the background drone to dead silence (the jumpscare's first beat).
  silenceAmbience() {
    if (this.droneOut) this.droneOut.gain.setTargetAtTime(0, this.now, 0.02);
  }

  // Fade the drone back in (new game / main menu).
  restoreAmbience() {
    if (this.droneOut) this.droneOut.gain.setTargetAtTime(A.droneVolume, this.now, 0.8);
  }

  // A sudden, sharp breath drawn in right beside your ear.
  sharpInhale() {
    const out = this.scareOut(0.9, 0.1);
    const f = this.noiseBurst(out, { f: 900, q: 1.3, dur: 0.28, attack: 0.07, gain: 1 });
    f.frequency.exponentialRampToValueAtTime(2600, this.now + 0.33);
  }

  // A deep sub-bass hit you feel in your chest.
  boom() {
    const out = this.scareOut(1.3, 0.6);
    this.tone(out, { f0: 75, f1: 24, dur: 1.4, gain: 1, attack: 0.005 });
    this.noiseBurst(out, { type: 'lowpass', f: 160, dur: 0.8, gain: 1 });
  }

  // The scream for the shaking face: several distorted, wobbling voices,
  // chopped up ~20 times a second so it rattles along with the shaking.
  violentScream(dur) {
    const ctx = this.ctx, t = this.now;
    const out = this.scareOut(1.3, 0.7);
    // the "chopper": a gain that a square wave flips up and down very fast
    const chop = ctx.createGain();
    chop.gain.value = 0.6;
    const lfo = ctx.createOscillator(), lfoAmount = ctx.createGain();
    lfo.type = 'square';
    lfo.frequency.setValueAtTime(17, t);
    lfo.frequency.linearRampToValueAtTime(29, t + dur);  // speeding up
    lfoAmount.gain.value = 0.45;
    lfo.connect(lfoAmount).connect(chop.gain);
    // loud for the whole time, then a hard cut
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(1, t + 0.02);
    env.gain.setValueAtTime(1, t + dur - 0.06);
    env.gain.linearRampToValueAtTime(0.0001, t + dur);
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.heavyCurve || (this.heavyCurve = this.makeDistortion(160));
    shaper.connect(env).connect(chop).connect(out);
    const voices = [[430, 1900, 'sawtooth'], [640, 2700, 'sawtooth'], [190, 720, 'sawtooth'], [92, 150, 'square']];
    const nodes = voices.map(([f0, f1, type]) => this.screamVoice(shaper, t, dur, f0, f1, type));
    this.noiseBurst(chop, { t, type: 'highpass', f: 1800, dur, gain: 0.5, attack: 0.01 });
    lfo.start(t);
    for (const n of [lfo, ...nodes.flat()]) n.stop(t + dur + 0.1);
  }

  // One voice of the scream: a pitch that shoots up then sags, with a fast wobble.
  screamVoice(dest, t, dur, f0, f1, type) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + 0.35);
    osc.frequency.exponentialRampToValueAtTime(f1 * 0.7, t + dur);
    const wobble = ctx.createOscillator(), depth = ctx.createGain();
    wobble.frequency.value = 33 + Math.random() * 12;
    depth.gain.value = f1 * 0.14;
    wobble.connect(depth).connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.5;
    osc.connect(g).connect(dest);
    osc.start(t);
    wobble.start(t);
    return [osc, wobble];
  }

  // Turn the overall volume up for the jumpscare (and back down after).
  scareBoost(on) {
    if (!this.master) return;
    const v = on ? Math.min(1, A.masterVolume * 1.3) : A.masterVolume;
    this.master.gain.setTargetAtTime(v, this.now, 0.05);
  }

  // The high ringing in your ears after everything goes black.
  tinnitus() {
    const out = this.scareOut(0.09, 0.2);
    this.tone(out, { f0: 4100, dur: 3.5, gain: 1, attack: 0.25 });
    this.tone(out, { f0: 4113, dur: 3.0, gain: 0.5, attack: 0.4 });
  }

  // The jumpscare shriek, right in your face.
  shriek() {
    const out = this.scareOut(1.3, 0.8);
    this.screech(out, 1.4, 350, 1700);
    this.screech(out, 1.2, 520, 2300);
    this.screech(out, 1.0, 260, 1100);
    this.tone(out, { f0: 120, f1: 40, dur: 1.0, gain: 0.9, type: 'square' });
  }

  forkRing(pos, freq) {
    const out = this.output(pos, { gain: 0.6, reverb: 0.9 });
    this.tone(out, { f0: freq, dur: 4.0, gain: 0.7, attack: 0.005 });
    this.tone(out, { f0: freq * 2.003, dur: 2.0, gain: 0.2 });
    this.tone(out, { f0: freq * 6.27, dur: 0.4, gain: 0.25 }); // metallic "ting"
  }

  elevatorClank(pos) {
    const out = this.output(pos, { gain: 1.0, reverb: 1.0 });
    for (const dt of [0, 0.45]) {
      const t = this.now + dt;
      this.noiseBurst(out, { t, type: 'lowpass', f: 220, dur: 1.4, gain: 1.2 });
      for (const f of [118, 231, 409, 690]) this.tone(out, { t, f0: f, dur: 1.2, gain: 0.25 });
    }
  }

  elevatorDoors() {
    const out = this.output(null, { gain: 0.6, reverb: 0.8 });
    const f = this.noiseBurst(out, { f: 400, q: 3, dur: 1.5, attack: 0.3, gain: 1 });
    f.frequency.exponentialRampToValueAtTime(150, this.now + 1.6);
    this.tone(out, { t: this.now + 1.6, f0: 880, dur: 1.5, gain: 0.3 });
  }

  // Two low thumps: "lub-dub". volume 0..1
  heartbeat(volume) {
    const out = this.output(null, { gain: volume, reverb: 0.05 });
    this.tone(out, { f0: 95, f1: 45, dur: 0.14, gain: 1 });
    this.tone(out, { t: this.now + 0.2, f0: 85, f1: 40, dur: 0.14, gain: 0.7 });
  }

  // ------------------------------------------------------------------
  // Looping sounds — these return a handle with a stop() function
  // ------------------------------------------------------------------

  // Low rumbling drone + eerie wind that plays the whole game.
  startDrone() {
    const ctx = this.ctx, out = ctx.createGain();
    out.gain.value = A.droneVolume;
    out.connect(this.master);
    this.droneOut = out; // so the jumpscare can silence it
    const nodes = [];
    for (const [f, type, g] of [[41.2, 'sine', 0.6], [41.7, 'sine', 0.6], [82.6, 'triangle', 0.15]]) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = type; o.frequency.value = f; og.gain.value = g;
      o.connect(og).connect(out); o.start(); nodes.push(o);
    }
    nodes.push(this.loopNoise(out, 'lowpass', 140, 0.8, 1.0, 0.05));
    nodes.push(this.loopNoise(out, 'bandpass', 650, 6, 0.25, 0.03)); // wind
    return { stop: () => { nodes.forEach((n) => n.stop()); out.disconnect(); } };
  }

  // Endless filtered noise with a slow wobble on the filter.
  loopNoise(dest, type, f, q, gain, lfoRate) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = type; filt.frequency.value = f; filt.Q.value = q;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = lfoRate; lg.gain.value = f * 0.4;
    lfo.connect(lg).connect(filt.frequency);
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(filt).connect(g).connect(dest);
    src.start(); lfo.start();
    return { stop: () => { src.stop(); lfo.stop(); } };
  }

  // A steady hum placed in the world (tuning forks, elevator motor).
  startHum(pos, freq, gain = 0.06, type = 'sine') {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = gain;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const panner = this.makePanner(pos);
    out.connect(lp).connect(panner).connect(this.master);
    const oscs = [freq, freq * 1.004].map((f) => {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = f;
      o.connect(out); o.start();
      return o;
    });
    const handle = {
      // muffle through walls; called now and then by main.js
      updateMuffle: () => {
        const walls = this.wallsTo(pos);
        lp.frequency.value = walls === 0 ? 20000 : Math.max(300, 2000 / walls);
        out.gain.value = gain * (walls === 0 ? 1 : 0.5 / walls);
      },
      stop: () => { oscs.forEach((o) => o.stop()); panner.disconnect(); },
    };
    handle.updateMuffle();
    return handle;
  }
}

function setPannerPos(p, v) {
  if (p.positionX) {
    p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z;
  } else {
    p.setPosition(v.x, v.y, v.z);
  }
}

// =====================================================================
//  ECHO — main.js
//  Sets up Three.js, wires all the modules together and runs the game
//  loop. Game states: 'title' → 'playing' ⇄ 'paused' → 'jumpscare' →
//  'dead', or → 'won'. Multiplayer adds 'lobby' and 'spectating'.
// =====================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONFIG } from './config.js';
import { Level } from './level.js';
import { PulseSystem } from './pulse.js';
import { Player } from './player.js';
import { Creature, HUNT } from './creature.js';
import { Jumpscare } from './jumpscare.js';
import { Items } from './items.js';
import { AudioEngine } from './audio.js';
import { UI, describeDirection } from './ui.js';
import { Input } from './input.js';
import { Lobby } from './lobby.js';
import { Multiplayer, spawnOffset } from './multiplayer.js';
import { detectMobile, TouchControls, vibrate, enterFullscreen } from './touch.js';
import { initAuth, login, logout, onUser, loginErrorText } from './auth.js';

const ACT = CONFIG.actions;
const PC = CONFIG.pulse;

// ---------------------------------------------------------------------
// Mobile mode: on phones/tablets, use touch controls and lighter graphics
// ---------------------------------------------------------------------
const MOBILE = detectMobile();
document.body.classList.toggle('mobile', MOBILE);
if (MOBILE) {
  CONFIG.graphics.maxPixelRatio = CONFIG.mobile.maxPixelRatio;
  CONFIG.graphics.bloom = CONFIG.mobile.bloom;
  CONFIG.graphics.dustPerCell = CONFIG.mobile.dustPerCell;
}

// ---------------------------------------------------------------------
// Rendering setup
// ---------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.graphics.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.graphics.fov, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera); // so the jumpscare face (a child of the camera) is drawn

// Final screen effect: film grain, vignette and a colour split when afraid.
const FxShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: CONFIG.graphics.grain }, uFear: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uFear; varying vec2 vUv;
    void main() {
      float ca = uFear * 0.006;
      vec3 col = vec3(texture2D(tDiffuse, vUv + vec2(ca, 0.0)).r,
                      texture2D(tDiffuse, vUv).g,
                      texture2D(tDiffuse, vUv - vec2(ca, 0.0)).b);
      float n = fract(sin(dot(vUv * vec2(12.9898, 78.233) + fract(uTime * 7.31), vec2(1.0))) * 43758.5453);
      col += (n - 0.5) * uGrain;
      col *= mix(0.55, 1.0, smoothstep(0.95, 0.3, length(vUv - 0.5)));
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

// Depth pre-pass: first draw only the depth of everything (very cheap),
// then draw the real colours. The expensive echo shader then runs only
// once per visible pixel instead of also for walls hidden behind walls.
// It uses the same vertex maths as the echo shaders, pushed back a tiny bit
// further (polygonOffsetUnits 4 vs 1) so visible surfaces always pass the test.
// Lines and dust dots live on layer 1, so they are skipped in the depth step.
const depthOnly = new THREE.ShaderMaterial({
  vertexShader: 'void main() { vec4 wp = modelMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * viewMatrix * wp; }',
  fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
  colorWrite: false,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 4,
});
camera.layers.enable(1);

class PrepassRenderPass extends RenderPass {
  render(renderer, writeBuffer, readBuffer) {
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.scene.overrideMaterial = depthOnly;
    this.camera.layers.set(0);                 // solid meshes only
    renderer.render(this.scene, this.camera);  // 1) depth only
    this.scene.overrideMaterial = null;
    this.camera.layers.enable(1);              // + lines and dust
    renderer.render(this.scene, this.camera);  // 2) colour
    renderer.autoClear = autoClear;
  }
}

const composer = new EffectComposer(renderer);
composer.addPass(new PrepassRenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2),
  CONFIG.graphics.bloomStrength, CONFIG.graphics.bloomRadius, CONFIG.graphics.bloomThreshold);
bloom.enabled = CONFIG.graphics.bloom;
composer.addPass(bloom);
composer.addPass(new OutputPass());
const fx = new ShaderPass(FxShader);
composer.addPass(fx);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------
// Shared systems and materials
// ---------------------------------------------------------------------
const pulses = new PulseSystem();
const audio = new AudioEngine({ light: MOBILE && CONFIG.mobile.lightAudio });
const ui = new UI();
const input = new Input(renderer.domElement);
input.mobile = MOBILE;
const touch = MOBILE ? new TouchControls(input) : null;

const mats = {
  surface: pulses.makeMaterial('surface'),
  line: pulses.makeMaterial('line'),
  points: pulses.makeMaterial('points'),
  objectLine: pulses.makeMaterial('line', { lineBoost: 1.8 }),
  forkSurface: pulses.makeMaterial('surface', { tint: PC.forkColor, tintMix: 0.7 }),
  forkLine: pulses.makeMaterial('line', { tint: PC.forkColor, tintMix: 0.7, selfGlow: 0.035, lineBoost: 2 }),
  elevatorLine: pulses.makeMaterial('line', { tint: PC.elevatorColor, tintMix: 0.5 }),
  // levers: rusty orange, with a very faint glow so you can spot them up close
  leverSurface: pulses.makeMaterial('surface', { tint: [1, 0.45, 0.2], tintMix: 0.7 }),
  leverLine: pulses.makeMaterial('line', { tint: [1, 0.45, 0.2], tintMix: 0.7, selfGlow: 0.03, lineBoost: 2 }),
  // tranquilizer darts: acid yellow-green, faintly glowing
  dartSurface: pulses.makeMaterial('surface', { tint: [0.8, 1, 0.25], tintMix: 0.7 }),
  dartLine: pulses.makeMaterial('line', { tint: [0.8, 1, 0.25], tintMix: 0.7, selfGlow: 0.04, lineBoost: 2.2 }),
  creatureEye: pulses.makeMaterial('eye'), // its body is pitch black: only the eyes glow
  // jumpscare face: black, a barely-there grey outline, blazing white eyes
  scareLine: pulses.makeMaterial('line', { tint: [0.6, 0.65, 0.7], tintMix: 1, forceLit: 0.07 }),
  scareEye: pulses.makeMaterial('eye', { forceLit: 1.0, eyeSize: 75 }),
  // after-images trailing behind the shaking face: dimmer lines and eyes
  scareGhostLine: pulses.makeMaterial('line', { tint: [0.6, 0.65, 0.7], tintMix: 1, forceLit: 0.035 }),
  scareGhostEye: pulses.makeMaterial('eye', { forceLit: 0.4, eyeSize: 75 }),
};
const VOID = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }); // pitch black
const jumpscare = new Jumpscare({ camera, renderer, scene, audio, ui, fx, mats, voidMat: VOID });

// ---------------------------------------------------------------------
// The game object: everything the modules need to talk to each other.
// (Open the browser console and type ECHO to inspect it while playing.)
// ---------------------------------------------------------------------
const game = {
  state: 'title',
  time: 0,
  scene, camera, pulses, audio, ui, mats, input, jumpscare,
  level: null, world: null, player: null, items: null,
  creature: null,     // the Listener (always there)
  creatures: [],      // every creature in this run: the Listener first, then any others
  CONFIG,             // (handy for trying settings live from the browser console)
  difficultyName: CONFIG.defaultDifficulty,
  difficulty: CONFIG.difficulty[CONFIG.defaultDifficulty],
  stats: null,
  pebbles: 0,
  elevatorPowered: false,
  noise: 0,
  timers: {},
  net: null,          // multiplayer session (null when playing alone)
  localOut: false,    // multiplayer: you were caught or escaped and are now watching

  get myId() { return this.net ? this.net.myId : 'me'; },
  get myColor() { return this.net ? this.net.colorOf(this.myId) : PC.playerColor; },
  dartHint: MOBILE ? 'tap DART to fire' : 'press R to fire',
  nameOf(id) { return this.net ? this.net.nameOf(id) : 'You'; },

  // A sound happened somewhere: the creature may hear it.
  // Only the "thinking" creature listens (alone, or on the multiplayer host).
  emitSound(ev) {
    if (ev.fromPlayer && ev.mine) this.noise = Math.max(this.noise, Math.min(1, ev.loudness / 30));
    const thinking = this.net ? this.net.isHost && this.net.inGame : this.state === 'playing';
    if (thinking) for (const c of this.creatures) c.hear(ev);
  },

  playerFx(kind, pos, s, who) { playerFx(kind, pos, s, who); },

  // Where the players still in the mine are (for the Mimic's lunge).
  livePlayers() {
    if (this.net) return this.net.alivePositions();
    return this.localOut || this.state !== 'playing' ? [] : [this.player.position];
  },

  // Ask to pick something up (see Items.tryClaim).
  claim(kind, i, extra) {
    if (this.net) this.net.claim(kind, i, extra);
    else if (this.items.canClaim(kind, i)) this.items.applyClaim(kind, i, this.myId, extra);
  },

  // You walked into the running elevator.
  reachedElevator() {
    if (!this.net) return winGame();
    if (this.time < (this.timers.escapeAsk || 0)) return; // already asked the host
    this.timers.escapeAsk = this.time + 1;
    this.net.claim('escape', 0);
  },

  // Show a caption. "{dir}" and "{dist}" are filled in from pos.
  caption(text, pos = null, important = false) {
    if (pos && this.player) {
      const { dir, dist } = describeDirection(this.player, pos);
      text = text.replace('{dir}', dir).replace('{dist}', dist);
    }
    ui.caption(text, important);
  },

  win() { winGame(); },
  step(dt) { update(dt); }, // advance the game by dt seconds (used by automated tests)
};
window.ECHO = game;

// ---------------------------------------------------------------------
// Building / clearing a level
// ---------------------------------------------------------------------
function buildWorld(level) {
  if (game.world) {
    scene.remove(game.world);
    game.world.traverse((o) => o.geometry && o.geometry.dispose());
  }
  game.level = level;
  game.world = new THREE.Group();
  game.world.add(level.buildMeshes(mats));
  scene.add(game.world);
  pulses.setLevel(level);
  pulses.clear();
  console.log(`[ECHO] level seed ${level.seed}`);
}

// Menu background: a slowly turning view with silent pulses.
// screen = 'title' or 'lobby' (the multiplayer waiting room).
function startAttract(screen = 'title') {
  if (game.items) game.items.dispose();
  game.items = null;
  game.creature = null;
  game.creatures = [];
  game.localOut = false;
  buildWorld(new Level());
  game.player = new Player(camera, game.level);
  game.state = screen;
  audio.restoreAmbience(); // in case we came here straight after the jumpscare
  game.timers.attract = 0.5;
  ui.setFear(0);
  fx.uniforms.uFear.value = 0;
  ui.show(screen === 'title' ? menuScreen() : screen);
}

// ---------------------------------------------------------------------
// Sign-in (Google, through Firebase — see auth.js)
// ---------------------------------------------------------------------
const account = { user: null, guest: false, available: false };

// The main menu is the sign-in screen until you sign in (or choose guest).
function menuScreen() {
  return CONFIG.login.enabled && !account.user && !account.guest ? 'login' : 'title';
}

function setLoginStatus(text, isError = false) {
  const el = document.getElementById('loginStatus');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

async function setupLogin() {
  document.getElementById('guestBtn').classList.toggle('hidden', !CONFIG.login.allowGuest);
  if (!CONFIG.login.enabled) return;
  account.available = await initAuth();
  const google = document.getElementById('googleBtn');
  if (!account.available) {
    setLoginStatus(CONFIG.login.allowGuest
      ? 'Google sign-in could not load (offline or blocked). You can still play as a guest.'
      : 'Google sign-in could not load. Check your internet connection and reload.', true);
    return;
  }
  google.disabled = false;
  setLoginStatus('');
  onUser((user) => {
    account.user = user;
    if (user) useNameFrom(user);
    updateAccountBar();
    // signing in (or out) while a menu is open: switch between sign-in and title screens
    if (game.state === 'title') ui.show(menuScreen());
  });
}

async function signIn() {
  setLoginStatus('Opening Google sign-in…');
  try {
    await login();
    setLoginStatus('');
  } catch (err) {
    const text = loginErrorText(err);
    setLoginStatus(text, !!text);
  }
}

async function signOutNow() {
  account.guest = false;
  if (account.user) await logout().catch(() => {});
  account.user = null;
  updateAccountBar();
  if (game.state === 'title') ui.show(menuScreen());
}

// Use your Google first name for multiplayer, unless you've typed one.
function useNameFrom(user) {
  const box = document.getElementById('mpName');
  if (!box.value && user.displayName) box.value = user.displayName.split(' ')[0].slice(0, 14);
}

// "Signed in as Alex · SIGN OUT" (or "Playing as guest · SIGN IN") on the title screen.
function updateAccountBar() {
  const bar = document.getElementById('account');
  bar.innerHTML = '';
  if (!CONFIG.login.enabled) return;
  const btn = document.createElement('button');
  if (account.user) {
    if (account.user.photoURL) {
      const img = document.createElement('img');
      img.src = account.user.photoURL;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      bar.appendChild(img);
    }
    const who = document.createElement('span');
    who.append('Signed in as ', Object.assign(document.createElement('b'), { textContent: account.user.displayName || account.user.email || 'player' }));
    bar.appendChild(who);
    btn.textContent = 'SIGN OUT';
  } else {
    bar.appendChild(document.createTextNode('Playing as guest'));
    btn.textContent = 'SIGN IN';
  }
  btn.addEventListener('click', signOutNow);
  bar.appendChild(btn);
}

function updateAttract(dt) {
  game.player.yaw += dt * 0.12;
  game.player.applyCamera(dt, 0);
  if ((game.timers.attract -= dt) <= 0) {
    game.timers.attract = 3.2;
    pulses.emit({ origin: camera.position.clone(), radius: 16, color: game.myColor, strength: 0.9 });
  }
}

// Start a run. seed = the maze layout (multiplayer: the same for everyone).
function newGame(seed) {
  audio.init();
  audio.resume();
  if (game.items) game.items.dispose();
  buildWorld(new Level(seed));
  game.difficulty = CONFIG.difficulty[game.difficultyName];
  game.stats = { time: 0, claps: 0, hunted: 0, forks: 0 };
  game.pebbles = CONFIG.player.startPebbles;
  game.darts = CONFIG.darts.startWith;
  game.elevatorPowered = false;
  game.noise = 0;
  game.localOut = false;
  game.pendingEnd = null;
  game.player = new Player(camera, game.level);
  game.player.onFootstep = onFootstep;
  game.player.onLand = onLand;
  game.player.onFall = onFall;
  if (game.net) placeForMultiplayer();
  audio.wallsTo = (pos) => game.level.rockBetween(camera.position, pos);
  game.items = new Items(game);
  // the Listener, plus any other creatures this mine rolled (see CONFIG.species)
  game.creature = new Creature(game);
  game.creatures = [game.creature, ...game.level.extraCreatures.map((e, i) =>
    new Creature(game, { type: e.type, cell: e.cell, index: i + 1 }))];
  if (game.creatures.length > 1) console.log('[ECHO] also in the mine:', game.level.extraCreatures.map((e) => e.type).join(', '));
  game.timers = { clapReady: 0, clapLength: 1, snapReady: 0, drip: 2, heartbeat: 0, hint: 9 };
  if (!game.drone) game.drone = audio.startDrone();
  audio.restoreAmbience();
  ui.setForks(0, CONFIG.goal.forkCount);
  ui.setPebbles(game.pebbles);
  ui.setDarts(game.darts);
  ui.setFear(0);
  const hint = document.getElementById('hint');
  hint.textContent = MOBILE ? 'Tap CLAP to see. Every clap tells it where you are.'
    : 'Clap (F or click) to see. Every clap tells it where you are.';
  hint.style.opacity = 1;
  ui.show(null);
  game.state = 'playing';
  input.requestLock();
  // a soft first glimpse of your surroundings (the creature can't hear it)
  pulses.emit({ origin: camera.position.clone(), radius: 7, color: game.myColor, strength: 0.7 });
}

// Multiplayer: everyone starts in the first cell, side by side.
function placeForMultiplayer() {
  const [ox, oz] = spawnOffset(game.net.myIndex);
  game.player.position.x += ox;
  game.player.position.z += oz;
  game.player.applyCamera();
  game.net.beginGame();
}

// ---------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------
function playerSoundOrigin() {
  return new THREE.Vector3(camera.position.x, camera.position.y - 0.2, camera.position.z);
}

function clap() {
  if (game.state === 'spectating') { game.net.nextSpectateTarget(); return; }
  if (game.state !== 'playing' || game.time < game.timers.clapReady) return;
  game.timers.clapLength = game.difficulty.clapCooldown;
  game.timers.clapReady = game.time + game.timers.clapLength;
  game.stats.claps++;
  vibrate(15);
  playerFx('clap', playerSoundOrigin());
}

function snap() {
  if (game.state !== 'playing' || game.time < game.timers.snapReady) return;
  game.timers.snapReady = game.time + ACT.snapCooldown;
  playerFx('snap', playerSoundOrigin());
}

// Called by the player every stride.
function onFootstep(mode) {
  if (mode === 'creep') { audio.footstep('creep'); return; } // silent: no light, nothing to hear
  playerFx(mode, feetPosition());
}

function feetPosition() {
  const p = game.player;
  return new THREE.Vector3(p.position.x, p.y + 0.1, p.position.z);
}

function jump() {
  if (game.state === 'spectating') { game.net.nextSpectateTarget(); return; }
  if (game.state === 'playing') game.player.jump();
}

// Landed after a jump or a drop: the harder, the louder.
function onLand(impact) {
  if (impact < 2) return;
  playerFx('thud', feetPosition(), Math.min(1, impact / 6));
  vibrate(20);
}

// Fell into a crevice: a loud crash, then you climb back out.
function onFall() {
  playerFx('fall', feetPosition());
  ui.flash('rgba(0,0,0,0.85)', 1200);
  vibrate([60, 40, 120]);
}

// E / PULL: pull a lever if you're next to one, otherwise throw a pebble.
function throwOrPull() {
  if (game.state !== 'playing') return;
  if (game.items.mech.near >= 0) game.items.mech.tryPull(game.items);
  else game.items.throwPebble();
}

// A noise made by a player — you or a friend: a pulse of light in their
// colour, a sound, and the creature may hear it. Your own noises are
// also sent to your friends. kind = clap | snap | walk | run | land
function playerFx(kind, pos, s = 1, who = game.myId) {
  const mine = who === game.myId;
  const color = mine ? game.myColor : game.net.colorOf(who);
  const at = mine ? null : pos; // your own sounds play "in your head"
  const far = !mine && pos.distanceTo(camera.position) > ACT.clapRadius + 25; // too far to ever see
  const light = (opts) => { if (!far) pulses.emit({ origin: pos, color, ...opts }); };
  const hear = (loudness, fromPlayer = true) => game.emitSound({ pos, loudness, fromPlayer, mine });
  if (kind === 'clap') {
    light({ radius: ACT.clapRadius, strength: 1.25 });
    audio.clap(at);
    hear(ACT.clapLoudness);
  } else if (kind === 'snap') {
    light({ radius: ACT.snapRadius, strength: 1.0, fade: 1.5 });
    audio.snap(at);
    hear(ACT.snapLoudness);
  } else if (kind === 'walk' || kind === 'run') {
    const run = kind === 'run';
    light({ radius: run ? ACT.stepRadiusRun : ACT.stepRadiusWalk, strength: 0.75, fade: 1.2 });
    audio.footstep(kind, at);
    hear(run ? ACT.stepLoudnessRun : ACT.stepLoudnessWalk);
  } else if (kind === 'thud') {
    light({ radius: ACT.landRadius * (0.5 + s * 0.5), strength: 0.8, fade: 1.2 });
    audio.thud(at, s);
    hear(ACT.landLoudness * (0.5 + s * 0.5));
  } else if (kind === 'fall') {
    light({ radius: 8, strength: 1.0, color: PC.objectColor });
    audio.crash(pos);
    hear(ACT.fallLoudness);
    game.caption(mine ? '[you slip into a crevice — CRASH]' : `[${game.nameOf(who)} fell into a crevice — {dir}]`, mine ? null : pos, true);
  } else if (kind === 'dart') {
    audio.dartFire(at);
    hear(CONFIG.darts.fireLoudness);
  } else if (kind === 'dartMiss') {
    light({ radius: 1.8, strength: 0.8, color: PC.objectColor });
    audio.dartHit(pos);
    if (mine) game.caption('[the dart snaps against the rock — missed]');
  } else if (kind === 'land') {
    light({ radius: ACT.pebbleRadius * s, strength: 0.9, color: PC.objectColor });
    audio.pebble(pos, s);
    hear(ACT.pebbleLoudness * s, false);
    if (s >= 1) game.caption('[a pebble clatters — {dir}, {dist}]', pos);
  }
  if (mine && game.net && game.net.inGame) game.net.sendFx(kind, pos, s);
}

// ---------------------------------------------------------------------
// Ambient: water drips and the heartbeat
// ---------------------------------------------------------------------
function updateDrips(dt) {
  if ((game.timers.drip -= dt) > 0) return;
  const A = CONFIG.audio;
  game.timers.drip = A.dripMin + Math.random() * (A.dripMax - A.dripMin);
  const p = game.player.position;
  const pos = new THREE.Vector3(p.x + (Math.random() - 0.5) * 20, 0.05, p.z + (Math.random() - 0.5) * 20);
  if (!game.level.isOpen(...game.level.toCell(pos.x, pos.z))) return;
  audio.drip(pos);
  pulses.emit({ origin: pos, radius: 0.9, color: PC.playerColor, strength: 0.5, fade: 1.0, speed: 3 });
}

// The closest creature that's awake (or null).
function nearestCreature() {
  const p = game.player.position;
  let best = null, bestD = Infinity;
  for (const c of game.creatures) {
    if (c.state === 'STUNNED') continue;
    const d = Math.hypot(c.position.x - p.x, c.position.z - p.z);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// Heartbeat + red vignette get stronger the closer the creature is.
function updateFear(dt) {
  const c = nearestCreature(), A = CONFIG.audio;
  if (!c) { ui.setFear(0); fx.uniforms.uFear.value = 0; return; }
  const d = Math.hypot(c.position.x - game.player.position.x, c.position.z - game.player.position.z);
  const near = Math.max(0, 1 - d / A.heartbeatDistance);
  const hunted = c.state === HUNT ? 0.25 : 0;
  ui.setFear(Math.min(0.9, near * near * 0.9 + hunted * near));
  fx.uniforms.uFear.value = near * near;
  if (near <= 0) return;
  if ((game.timers.heartbeat -= dt) <= 0) {
    const bpm = A.heartbeatSlowBPM + (A.heartbeatFastBPM - A.heartbeatSlowBPM) * near;
    game.timers.heartbeat = 60 / bpm;
    audio.heartbeat(0.15 + 0.6 * near);
  }
}

// ---------------------------------------------------------------------
// Losing: jumpscare, then Game Over (alone) or spectating (multiplayer)
// ---------------------------------------------------------------------
// catcher = the creature that caught you
function startJumpscare(catcher = game.creature) {
  game.caughtBy = catcher.sp.name;
  if (game.state === 'paused') ui.show(null);
  game.state = 'jumpscare';
  game.stats.forks = game.items.collected;
  if (!game.net) game.items.dispose(); // alone the world stops; with friends it goes on
  catcher.body.root.visible = false; // its body would block the view of the face
  jumpscare.start(); // the whole sequence lives in jumpscare.js
}

function afterJumpscare() {
  if (!game.net) return gameOver();
  for (const c of game.creatures) c.body.root.visible = true;
  ui.setBlack(false);
  if (game.pendingEnd) showTeamResult(game.pendingEnd);
  else startSpectating('caught');
}

function gameOver() {
  game.state = 'dead';
  ui.setBlack(false); // fade up from black
  ui.setFear(0);
  fx.uniforms.uFear.value = 0;
  ui.setStats('gameover', game.stats);
  ui.setTeamResult('gameover', null);
  ui.setCaughtBy(game.caughtBy || 'the Listener');
  ui.show('gameover');
  ui.shudder('gameover');
  input.exitLock();
}

function winGame() {
  if (game.state !== 'playing') return;
  game.state = 'won';
  game.stats.forks = game.items.collected;
  game.items.dispose();
  audio.elevatorDoors();
  ui.flash('rgba(190,255,190,0.8)', 1500);
  ui.setFear(0);
  fx.uniforms.uFear.value = 0;
  ui.setStats('win', game.stats);
  ui.setTeamResult('win', null);
  input.exitLock();
  setTimeout(() => ui.show('win'), 1200);
}

// ---------------------------------------------------------------------
// Multiplayer: escaping, spectating, team results, rooms
// ---------------------------------------------------------------------
function escapedMultiplayer() {
  game.localOut = true;
  game.stats.forks = game.items.collected;
  audio.elevatorDoors();
  ui.flash('rgba(190,255,190,0.8)', 1500);
  startSpectating('escaped');
}

function startSpectating(why) {
  game.state = 'spectating';
  game.spectateWhy = why;
  audio.restoreAmbience();
  ui.show(null);
  ui.setHud(false);
  ui.setSpectate(why, null);
}

function updateSpectating(dt) {
  updateWorld(dt);
  if (game.state === 'spectating') ui.setSpectate(game.spectateWhy, game.net.followCamera());
}

// The host says the game is over: show everyone the same result.
function showTeamResult(result) {
  const escaped = result.escaped.length > 0;
  const screen = escaped ? 'win' : 'gameover';
  game.state = escaped ? 'won' : 'dead';
  game.stats.hunted = result.hunted;
  game.stats.forks = game.items.collected;
  game.items.dispose();
  ui.setFear(0);
  fx.uniforms.uFear.value = 0;
  ui.setStats(screen, game.stats);
  ui.setTeamResult(screen, result);
  input.exitLock();
  setTimeout(() => {
    if (game.state !== 'won' && game.state !== 'dead') return; // already back in the lobby
    ui.show(screen);
    if (!escaped) ui.shudder('gameover');
  }, 1200);
}

// Things the multiplayer module tells us about.
const mpHooks = {
  players(list) {
    lobby.renderPlayers(list, game.net.myId);
    if (game.net.isHost) game.net.sendInfo({ difficulty: game.difficultyName });
  },
  lobbyInfo(info) { lobby.setDifficulty(info.difficulty); },
  start(seed, difficulty) {
    game.difficultyName = difficulty;
    newGame(seed);
  },
  backToLobby() { showLobby(); },
  end(result) {
    if (game.state === 'jumpscare') game.pendingEnd = result; // show it after the scare
    else showTeamResult(result);
  },
  caughtMe(index = 0) {
    game.localOut = true;
    startJumpscare(game.creatures[index] || game.creature);
  },
  escapedMe() { escapedMultiplayer(); },
  closed(reason) { leaveRoom(reason); },
};

function enterRoom(room) {
  game.net = new Multiplayer(game, room, mpHooks);
  document.body.classList.add('mp');
  document.body.classList.toggle('host', room.isHost);
  showLobby();
}

function showLobby() {
  if (!game.net) return;
  game.net.endGame();
  input.exitLock();
  startAttract('lobby');
  lobby.showRoom(game.net.room);
  if (game.net.isHost) game.net.sendInfo({ difficulty: game.difficultyName });
}

function leaveRoom(reason) {
  if (game.net) game.net.leave();
  game.net = null;
  document.body.classList.remove('mp', 'host');
  input.exitLock();
  startAttract('title');
  lobby.notice(reason);
}

// ---------------------------------------------------------------------
// Pause / resume (multiplayer can't pause: the world keeps going)
// ---------------------------------------------------------------------
function pause() {
  if (game.state !== 'playing' && game.state !== 'spectating') return;
  game.pausedFrom = game.state;
  game.state = 'paused';
  game.pausedAt = performance.now();
  if (!game.net) audio.suspend();
  ui.show('pause');
}

function resume() {
  if (game.state !== 'paused') return;
  audio.resume();
  if (game.pausedFrom === 'spectating') startSpectating(game.spectateWhy);
  else {
    game.state = 'playing';
    ui.show(null);
  }
  input.requestLock();
}

// ---------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------
function updatePlaying(dt) {
  const { dx, dy } = input.consumeMouse();
  game.player.look(dx, dy);
  game.player.update(dt, input);
  updateWorld(dt);
  if (game.state === 'playing') updateHud(dt);
}

// Everything that keeps going even while you can't move
// (in multiplayer: while paused, being eaten, or spectating).
function updateWorld(dt) {
  game.time += dt;
  game.stats.time += dt;
  game.items.update(dt);
  if (!game.net && game.state !== 'playing') return; // alone: we may have just won
  for (const c of game.creatures) c.update(dt);
  if (game.net) game.net.update(dt);
  else checkCaught();
  if (game.state === 'won' || game.state === 'dead') return;
  audio.setListener(camera);
  updateDrips(dt);
  updateFear(dt);
}

function checkCaught() {
  const p = game.player.position;
  for (const c of game.creatures) {
    if (c.state === 'STUNNED' || c.feeding > 0) continue; // out cold: it can't grab anyone
    if (Math.hypot(p.x - c.position.x, p.z - c.position.z) < CONFIG.creature.catchRadius) return startJumpscare(c);
  }
}

function updateHud(dt) {
  const t = game.timers;
  // next to a lever: show "E — PULL LEVER" (mobile: the PEBBLE button says PULL)
  const nearLever = game.items.mech.near >= 0;
  ui.setPrompt(nearLever ? (MOBILE ? 'PULL THE LEVER' : 'E — PULL THE LEVER') : '');
  if (touch) {
    touch.setThrowLabel(nearLever ? 'PULL' : 'PEBBLE');
    touch.setDarts(game.darts); // the DART button only shows when you have one
  }
  ui.setCooldown(Math.min(1, 1 - (t.clapReady - game.time) / t.clapLength));
  game.noise = Math.max(0, game.noise - CONFIG.ui.noiseDecay * dt);
  ui.setNoise(game.noise);
  if (t.hint > 0 && (t.hint -= dt) <= 0) document.getElementById('hint').style.opacity = 0;
}

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  update(Math.min(clock.getDelta(), 0.05)); // limit dt: avoid huge jumps after lag
  if (touch) touch.setMode(game.state === 'playing' ? 'play' : game.state === 'spectating' ? 'spectate' : null);
  pulses.update(game.time);
  fx.uniforms.uTime.value = game.time;
  composer.render();
}

// Advance the game by dt seconds, whatever state it is in.
function update(dt) {
  const s = game.state;
  if (s === 'playing') updatePlaying(dt);
  else if (s === 'title' || s === 'lobby') { game.time += dt; updateAttract(dt); }
  else if (s === 'jumpscare') {
    if (game.net) updateWorld(dt); else game.time += dt;
    if (jumpscare.update(dt)) afterJumpscare();
  } else if (s === 'spectating') updateSpectating(dt);
  else if (s === 'paused' && game.net) {
    updateWorld(dt);
    if (game.pausedFrom === 'spectating' && game.net) game.net.followCamera();
  } else if (s === 'won' || s === 'dead') game.time += dt;
}

// ---------------------------------------------------------------------
// Menu buttons and input wiring
// ---------------------------------------------------------------------
const DIFF_HELP = {
  easy: 'slower creature, weaker hearing, faster clap',
  normal: 'the intended experience',
  hard: 'faster creature, sharp hearing, slow clap',
};

function selectDifficulty(name) {
  game.difficultyName = name;
  document.querySelectorAll('[data-diff]').forEach((b) => b.classList.toggle('selected', b.dataset.diff === name));
  document.getElementById('diffHelp').textContent = DIFF_HELP[name];
  if (game.net && game.net.isHost) game.net.sendInfo({ difficulty: name });
}

const lobby = new Lobby(ui, {
  enterRoom,
  start: () => game.net.hostStart(game.difficultyName),
  leave: () => leaveRoom(),
  back: () => ui.show(menuScreen()),
});

function wireButtons() {
  const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
  document.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => selectDifficulty(b.dataset.diff)));
  selectDifficulty(game.difficultyName);
  on('startBtn', () => { lobby.notice(''); if (MOBILE) enterFullscreen(); newGame(); });
  on('retryBtn', () => newGame());
  on('againBtn', () => newGame());
  on('resumeBtn', resume);
  for (const id of ['quitBtn', 'menuBtn1', 'menuBtn2']) on(id, () => { audio.resume(); startAttract(); });
  on('mpBtn', () => { audio.init(); if (MOBILE) enterFullscreen(); lobby.notice(''); lobby.openMenu(); });
  on('googleBtn', signIn);
  on('guestBtn', () => { account.guest = true; updateAccountBar(); ui.show('title'); });
  setupModeToggle();
  for (const id of ['lobbyBtn1', 'lobbyBtn2']) on(id, () => game.net && game.net.hostBackToLobby());
  for (const id of ['leaveBtn1', 'leaveBtn2', 'leaveBtn3']) on(id, () => leaveRoom());
}

// Small link on the title screen to switch between touch and keyboard controls.
function setupModeToggle() {
  const btn = document.getElementById('modeToggle');
  const canTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  if (!MOBILE && !canTouch) { btn.classList.add('hidden'); return; }
  btn.textContent = MOBILE ? 'Using touch controls — switch to keyboard & mouse' : 'Switch to touch controls';
  btn.addEventListener('click', () => {
    const params = new URLSearchParams(location.search);
    params.set('mobile', MOBILE ? '0' : '1');
    location.search = params.toString();
  });
}

input.on('clap', clap);
input.on('snap', snap);
input.on('throw', throwOrPull);
input.on('jump', jump);
input.on('dart', () => { if (game.state === 'playing') game.items.fireDart(); });
input.on('pause', () => {
  if (game.state === 'playing' || game.state === 'spectating') pause();
  // ignore the same Esc press that just released the mouse (some browsers send both)
  else if (game.state === 'paused' && performance.now() - game.pausedAt > 400) resume();
});
input.on('lockchange', (locked) => { if (!locked) pause(); });
// switching apps / tabs (or locking the phone) pauses the game
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
  else if (game.state !== 'paused') audio.resume(); // iPads stop the sound after switching apps
});
input.on('canvasclick', () => { if (game.state === 'playing' || game.state === 'spectating') input.requestLock(); });

wireButtons();
startAttract();
setupLogin();
frame();

// =====================================================================
//  ECHO — main.js
//  Sets up Three.js, wires all the modules together and runs the game
//  loop. Game states: 'title' → 'playing' ⇄ 'paused' → 'jumpscare' →
//  'dead', or → 'won'.
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

const ACT = CONFIG.actions;
const PC = CONFIG.pulse;

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
const audio = new AudioEngine();
const ui = new UI();
const input = new Input(renderer.domElement);

const mats = {
  surface: pulses.makeMaterial('surface'),
  line: pulses.makeMaterial('line'),
  points: pulses.makeMaterial('points'),
  objectLine: pulses.makeMaterial('line', { lineBoost: 1.8 }),
  forkSurface: pulses.makeMaterial('surface', { tint: PC.forkColor, tintMix: 0.7 }),
  forkLine: pulses.makeMaterial('line', { tint: PC.forkColor, tintMix: 0.7, selfGlow: 0.035, lineBoost: 2 }),
  elevatorLine: pulses.makeMaterial('line', { tint: PC.elevatorColor, tintMix: 0.5 }),
  creatureEye: pulses.makeMaterial('eye'), // its body is pitch black: only the eyes glow
  // jumpscare face: black, a barely-there grey outline, blazing white eyes
  scareLine: pulses.makeMaterial('line', { tint: [0.6, 0.65, 0.7], tintMix: 1, forceLit: 0.07 }),
  scareEye: pulses.makeMaterial('eye', { forceLit: 1.0, eyeSize: 75 }),
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
  level: null, world: null, player: null, creature: null, items: null,
  difficultyName: CONFIG.defaultDifficulty,
  difficulty: CONFIG.difficulty[CONFIG.defaultDifficulty],
  stats: null,
  pebbles: 0,
  elevatorPowered: false,
  noise: 0,
  timers: {},

  // A sound happened somewhere: the creature may hear it.
  emitSound(ev) {
    if (ev.fromPlayer) this.noise = Math.max(this.noise, Math.min(1, ev.loudness / 30));
    if (this.creature && this.state === 'playing') this.creature.hear(ev);
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
  step(dt) { updatePlaying(dt); }, // advance the game by dt seconds (used by automated tests)
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

// Title screen background: a slowly turning view with silent pulses.
function startAttract() {
  if (game.items) game.items.dispose();
  game.items = null;
  game.creature = null;
  buildWorld(new Level());
  game.player = new Player(camera, game.level);
  game.state = 'title';
  audio.restoreAmbience(); // in case we came here straight after the jumpscare
  game.timers.attract = 0.5;
  ui.show('title');
}

function updateAttract(dt) {
  game.player.yaw += dt * 0.12;
  game.player.applyCamera(dt, 0);
  if ((game.timers.attract -= dt) <= 0) {
    game.timers.attract = 3.2;
    pulses.emit({ origin: camera.position.clone(), radius: 16, color: PC.playerColor, strength: 0.9 });
  }
}

function newGame() {
  audio.init();
  audio.resume();
  if (game.items) game.items.dispose();
  buildWorld(new Level());
  game.difficulty = CONFIG.difficulty[game.difficultyName];
  game.stats = { time: 0, claps: 0, hunted: 0, forks: 0 };
  game.pebbles = CONFIG.player.startPebbles;
  game.elevatorPowered = false;
  game.noise = 0;
  game.player = new Player(camera, game.level);
  game.player.onFootstep = onFootstep;
  audio.wallsTo = (pos) => game.level.rockBetween(camera.position, pos);
  game.items = new Items(game);
  game.creature = new Creature(game);
  game.timers = { clapReady: 0, clapLength: 1, snapReady: 0, drip: 2, heartbeat: 0, hint: 9 };
  if (!game.drone) game.drone = audio.startDrone();
  audio.restoreAmbience();
  ui.setForks(0, CONFIG.goal.forkCount);
  ui.setPebbles(game.pebbles);
  ui.setFear(0);
  document.getElementById('hint').style.opacity = 1;
  ui.show(null);
  game.state = 'playing';
  input.requestLock();
  // a soft first glimpse of your surroundings (the creature can't hear it)
  pulses.emit({ origin: camera.position.clone(), radius: 7, color: PC.playerColor, strength: 0.7 });
}

// ---------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------
function playerSoundOrigin() {
  return new THREE.Vector3(camera.position.x, camera.position.y - 0.2, camera.position.z);
}

function clap() {
  if (game.state !== 'playing' || game.time < game.timers.clapReady) return;
  game.timers.clapLength = game.difficulty.clapCooldown;
  game.timers.clapReady = game.time + game.timers.clapLength;
  game.stats.claps++;
  const origin = playerSoundOrigin();
  pulses.emit({ origin, radius: ACT.clapRadius, color: PC.playerColor, strength: 1.25 });
  audio.clap();
  game.emitSound({ pos: origin, loudness: ACT.clapLoudness, fromPlayer: true });
}

function snap() {
  if (game.state !== 'playing' || game.time < game.timers.snapReady) return;
  game.timers.snapReady = game.time + ACT.snapCooldown;
  const origin = playerSoundOrigin();
  pulses.emit({ origin, radius: ACT.snapRadius, color: PC.playerColor, strength: 1.0, fade: 1.5 });
  audio.snap();
  game.emitSound({ pos: origin, loudness: ACT.snapLoudness, fromPlayer: true });
}

// Called by the player every stride.
function onFootstep(mode) {
  audio.footstep(mode);
  if (mode === 'creep') return; // creeping: no light, no noise the creature can hear
  const p = game.player.position;
  const feet = new THREE.Vector3(p.x, 0.1, p.z);
  const run = mode === 'run';
  pulses.emit({ origin: feet, radius: run ? ACT.stepRadiusRun : ACT.stepRadiusWalk, color: PC.playerColor, strength: 0.75, fade: 1.2 });
  game.emitSound({ pos: feet, loudness: run ? ACT.stepLoudnessRun : ACT.stepLoudnessWalk, fromPlayer: true });
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

// Heartbeat + red vignette get stronger the closer the creature is.
function updateFear(dt) {
  const c = game.creature, A = CONFIG.audio;
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
// Losing: jumpscare, then the Game Over screen
// ---------------------------------------------------------------------
function startJumpscare() {
  game.state = 'jumpscare';
  game.stats.forks = game.items.collected;
  game.items.dispose();
  game.creature.body.root.visible = false; // its body would block the view of the face
  jumpscare.start(); // the whole sequence lives in jumpscare.js
}

function gameOver() {
  game.state = 'dead';
  ui.setBlack(false); // fade up from black
  ui.setFear(0);
  fx.uniforms.uFear.value = 0;
  ui.setStats('gameover', game.stats);
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
  input.exitLock();
  setTimeout(() => ui.show('win'), 1200);
}

// ---------------------------------------------------------------------
// Pause / resume
// ---------------------------------------------------------------------
function pause() {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  game.pausedAt = performance.now();
  audio.suspend();
  ui.show('pause');
}

function resume() {
  if (game.state !== 'paused') return;
  game.state = 'playing';
  audio.resume();
  ui.show(null);
  input.requestLock();
}

// ---------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------
function updatePlaying(dt) {
  game.time += dt;
  game.stats.time += dt;
  const { dx, dy } = input.consumeMouse();
  game.player.look(dx, dy);
  game.player.update(dt, input);
  game.items.update(dt);
  if (game.state !== 'playing') return; // we may have just won
  game.creature.update(dt);
  const p = game.player.position, c = game.creature.position;
  if (Math.hypot(p.x - c.x, p.z - c.z) < CONFIG.creature.catchRadius) { startJumpscare(); return; }
  audio.setListener(camera);
  updateDrips(dt);
  updateFear(dt);
  updateHud(dt);
}

function updateHud(dt) {
  const t = game.timers;
  ui.setCooldown(Math.min(1, 1 - (t.clapReady - game.time) / t.clapLength));
  game.noise = Math.max(0, game.noise - CONFIG.ui.noiseDecay * dt);
  ui.setNoise(game.noise);
  if (t.hint > 0 && (t.hint -= dt) <= 0) document.getElementById('hint').style.opacity = 0;
}

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05); // avoid huge jumps after lag
  if (game.state === 'playing') updatePlaying(dt);
  else if (game.state === 'title') { game.time += dt; updateAttract(dt); }
  else if (game.state === 'jumpscare') { game.time += dt; if (jumpscare.update(dt)) gameOver(); }
  else if (game.state === 'won' || game.state === 'dead') game.time += dt;
  pulses.update(game.time);
  fx.uniforms.uTime.value = game.time;
  composer.render();
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
  document.querySelectorAll('#difficulty button').forEach((b) => b.classList.toggle('selected', b.dataset.diff === name));
  document.getElementById('diffHelp').textContent = DIFF_HELP[name];
}

function wireButtons() {
  const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
  document.querySelectorAll('#difficulty button').forEach((b) => b.addEventListener('click', () => selectDifficulty(b.dataset.diff)));
  selectDifficulty(game.difficultyName);
  on('startBtn', newGame);
  on('retryBtn', newGame);
  on('againBtn', newGame);
  on('resumeBtn', resume);
  for (const id of ['quitBtn', 'menuBtn1', 'menuBtn2']) on(id, () => { audio.resume(); startAttract(); });
}

input.on('clap', clap);
input.on('snap', snap);
input.on('throw', () => game.state === 'playing' && game.items.throwPebble());
input.on('pause', () => {
  if (game.state === 'playing') pause();
  // ignore the same Esc press that just released the mouse (some browsers send both)
  else if (game.state === 'paused' && performance.now() - game.pausedAt > 400) resume();
});
input.on('lockchange', (locked) => { if (!locked) pause(); });
input.on('canvasclick', () => { if (game.state === 'playing') input.requestLock(); });

wireButtons();
startAttract();
frame();

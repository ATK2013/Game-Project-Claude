// =====================================================================
//  ECHO — pulse.js
//  The echolocation system. Every pulse is a ring of "sound light" that
//  spreads out from a point. A custom shader on every object checks all
//  active pulses each frame and lights the surface when the ring reaches it.
//
//  Pulse data is sent to the GPU as three uniform arrays:
//    uPulseA[i] = (origin.x, origin.y, origin.z, startTime)
//    uPulseB[i] = (maxRadius, speed, strength, fadeTime)
//    uPulseC[i] = (red, green, blue)
// =====================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';

const MAX = CONFIG.pulse.maxPulses;

// ---------------------------------------------------------------------
// GLSL shared by every echo material
// ---------------------------------------------------------------------
const COMMON_GLSL = /* glsl */ `
#define MAX_PULSES ${MAX}
uniform float uTime;
uniform vec4 uPulseA[MAX_PULSES];
uniform vec4 uPulseB[MAX_PULSES];
uniform vec3 uPulseC[MAX_PULSES];
uniform sampler2D uWallMap;   // 1 pixel per grid cell, white = solid rock
uniform vec2 uGridSize;
uniform float uCellSize;
uniform float uFrontWidth;
uniform float uFalloff;
uniform float uFadeScale;     // per material: <1 means it fades faster
uniform vec3 uTint;           // per material: recolour the light
uniform float uTintMix;       // 0 = keep pulse colour, 1 = fully tinted
uniform float uSelfGlow;      // constant faint glow (in tint colour)
uniform float uForceLit;      // 1 = fully lit no matter what (jumpscare)

// Cheap pseudo-random number from a 3D position.
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// Smooth "value noise" used for the salt-rock texture.
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(hash13(i), hash13(i + vec3(1,0,0)), f.x);
  float b = mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x);
  float c = mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x);
  float d = mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x);
  return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}

bool isRock(ivec2 c) {
  if (c.x < 0 || c.y < 0 || c.x >= int(uGridSize.x) || c.y >= int(uGridSize.y)) return true;
  return texelFetch(uWallMap, c, 0).r > 0.5;
}

// Walk through the grid cells on a straight line from 'from' to 'to'
// (top-down, x/z only). Returns true if any solid rock cell is in the way.
// This is what makes walls block pulses.
bool isBlocked(vec2 from, vec2 to) {
  vec2 a = from / uCellSize;
  vec2 b = to / uCellSize;
  ivec2 cell = ivec2(floor(a));
  ivec2 goal = ivec2(floor(b));
  vec2 dir = b - a;
  ivec2 stepDir = ivec2(dir.x > 0.0 ? 1 : -1, dir.y > 0.0 ? 1 : -1);
  vec2 invAbs = 1.0 / max(abs(dir), vec2(1e-6));
  vec2 boundary = vec2(cell) + vec2(stepDir.x > 0 ? 1.0 : 0.0, stepDir.y > 0 ? 1.0 : 0.0);
  vec2 tMax = abs(boundary - a) * invAbs;
  for (int i = 0; i < 32; i++) {
    if (cell == goal) return false;
    if (tMax.x < tMax.y) { cell.x += stepDir.x; tMax.x += invAbs.x; }
    else                 { cell.y += stepDir.y; tMax.y += invAbs.y; }
    if (isRock(cell)) return true;
  }
  return false;
}

// Add up the light from every active pulse at world position wp.
// 'front' returns how strongly the bright wavefront is passing right now.
vec3 echoLight(vec3 wp, vec3 n, out float front) {
  vec3 sum = vec3(0.0);
  front = 0.0;
  for (int i = 0; i < MAX_PULSES; i++) {
    vec4 A = uPulseA[i];
    vec4 B = uPulseB[i];
    float age = uTime - A.w;
    float fade = B.w * uFadeScale;
    if (age < 0.0 || age > B.x / B.y + fade) continue;     // pulse not active
    vec3 toOrigin = A.xyz - wp;
    float d = length(toOrigin);
    if (d > B.x) continue;                                  // outside max radius
    float since = age - d / B.y;                            // time since ring passed
    if (since < 0.0 || since > fade) continue;              // not reached / faded
    float distAtt = pow(1.0 - d / B.x, uFalloff);           // weaker far away
    float after = 1.0 - since / fade; after *= after;       // slow afterglow
    float wave = exp(-(since * since) / (uFrontWidth * uFrontWidth)); // bright ring
    float k = B.z * distAtt * (0.45 * after + wave);
    if (k < 0.004) continue;
    // nudge the test point off the surface so walls don't block themselves
    vec3 p = wp + n * 0.08 + toOrigin / max(d, 0.001) * 0.04;
    if (isBlocked(p.xz, A.xz)) continue;
    sum += uPulseC[i] * k;
    front += wave * distAtt * B.z;
  }
  return sum;
}

vec3 applyTint(vec3 col) {
  float lum = dot(col, vec3(0.3, 0.5, 0.2));
  col = mix(col, uTint * lum * 1.6, uTintMix);
  return col + uTint * (uSelfGlow + uForceLit);
}
`;

// ---------------------------------------------------------------------
// Surfaces (walls, floors, props): dark with glowing texture details
// ---------------------------------------------------------------------
const SURFACE_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SURFACE_FRAG = /* glsl */ `
uniform float uFill;
varying vec3 vWorldPos;
varying vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  float front;
  vec3 light = echoLight(vWorldPos, n, front);
  if (dot(light, light) < 1e-6 && uForceLit + uSelfGlow < 0.001) { gl_FragColor = vec4(0,0,0,1); return; }

  float grain = noise3(vWorldPos * 3.0);
  float detail;
  if (abs(n.y) < 0.5) {
    // walls: wavy horizontal salt layers
    float s = sin(vWorldPos.y * 6.0 + noise3(vWorldPos * 0.6) * 5.0);
    detail = smoothstep(0.975, 1.0, s) * 0.22;
  } else {
    // floor / ceiling: thin cracks
    float c = abs(noise3(vWorldPos * 1.2) - 0.5);
    detail = smoothstep(0.015, 0.0, c) * 0.16;
  }
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float rim = pow(1.0 - abs(dot(viewDir, n)), 4.0);  // grazing angles glow (outline feel)
  float pattern = uFill * (0.3 + 0.7 * grain) + detail + rim * 0.05;
  vec3 col = light * pattern + light * front * 0.06;
  gl_FragColor = vec4(applyTint(col), 1.0);
}
`;

// ---------------------------------------------------------------------
// Edge lines: the bright "sketch" outlines
// ---------------------------------------------------------------------
const LINE_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const LINE_FRAG = /* glsl */ `
uniform float uLineBoost;
varying vec3 vWorldPos;
void main() {
  float front;
  vec3 light = echoLight(vWorldPos, vec3(0.0), front);
  vec3 col = light * uLineBoost + light * front * 0.8;
  gl_FragColor = vec4(applyTint(col), 1.0);
}
`;

// ---------------------------------------------------------------------
// Dust points: faint flickering dots scattered on surfaces
// ---------------------------------------------------------------------
const POINT_VERT = /* glsl */ `
attribute float aSeed;
attribute vec3 aNormal;
varying vec3 vWorldPos;
varying vec3 vN;
varying float vFlicker;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vN = aNormal;
  // each dot blinks on and off at its own random rhythm
  float t = floor(uTime * (3.0 + aSeed * 6.0) + aSeed * 100.0);
  vFlicker = step(0.45, fract(sin(t * 12.9898 + aSeed * 78.233) * 43758.5453));
  vec4 mv = viewMatrix * wp;
  gl_PointSize = clamp(40.0 / -mv.z, 1.0, 4.0);
  gl_Position = projectionMatrix * mv;
}
`;

const POINT_FRAG = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vN;
varying float vFlicker;
void main() {
  if (vFlicker < 0.5) discard;
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  float front;
  vec3 light = echoLight(vWorldPos, vN, front);
  gl_FragColor = vec4(applyTint(light * 0.9 + light * front), 1.0);
}
`;

// ---------------------------------------------------------------------
// PulseSystem: stores pulses and builds the materials that read them
// ---------------------------------------------------------------------
export class PulseSystem {
  constructor() {
    // These uniform objects are SHARED by every echo material, so updating
    // them once per frame updates the whole world.
    this.shared = {
      uTime: { value: 0 },
      uPulseA: { value: makeArray(() => new THREE.Vector4(0, -999, 0, -1000)) },
      uPulseB: { value: makeArray(() => new THREE.Vector4(1, 1, 0, 1)) },
      uPulseC: { value: makeArray(() => new THREE.Vector3()) },
      uWallMap: { value: null },
      uGridSize: { value: new THREE.Vector2(1, 1) },
      uCellSize: { value: CONFIG.level.cellSize },
      uFrontWidth: { value: CONFIG.pulse.frontWidth },
      uFalloff: { value: CONFIG.pulse.falloff },
    };
    this.time = 0;
    this.endTimes = new Array(MAX).fill(-1000); // when each slot is free again
  }

  // Remove every pulse (used when a new game starts).
  clear() {
    for (let i = 0; i < MAX; i++) {
      this.shared.uPulseA.value[i].w = -1000;
      this.endTimes[i] = -1000;
    }
  }

  // Upload the level's rock layout so the shader knows where walls are.
  setLevel(level) {
    if (this.shared.uWallMap.value) this.shared.uWallMap.value.dispose();
    this.shared.uWallMap.value = level.makeWallTexture();
    this.shared.uGridSize.value.set(level.size, level.size);
  }

  // Start a new pulse. Options: origin (Vector3), radius, color [r,g,b],
  // strength (brightness), fade (seconds), speed (m/s).
  emit({ origin, radius, color, strength = 1, fade = CONFIG.pulse.fadeTime, speed = CONFIG.pulse.speed }) {
    const slot = this.freeSlot();
    this.shared.uPulseA.value[slot].set(origin.x, origin.y, origin.z, this.time);
    this.shared.uPulseB.value[slot].set(radius, speed, strength, fade);
    this.shared.uPulseC.value[slot].set(color[0], color[1], color[2]);
    this.endTimes[slot] = this.time + radius / speed + fade;
  }

  // Pick the slot whose pulse finishes soonest (or is already finished).
  freeSlot() {
    let best = 0;
    for (let i = 1; i < MAX; i++) {
      if (this.endTimes[i] < this.endTimes[best]) best = i;
    }
    return best;
  }

  update(time) {
    this.time = time;
    this.shared.uTime.value = time;
  }

  // Build a material. kind = 'surface' | 'line' | 'points'.
  // opts: tint [r,g,b], tintMix, selfGlow, fadeScale, forceLit, lineBoost
  makeMaterial(kind, opts = {}) {
    const own = {
      uTint: { value: new THREE.Color(...(opts.tint || [1, 1, 1])) },
      uTintMix: { value: opts.tintMix ?? 0 },
      uSelfGlow: { value: opts.selfGlow ?? 0 },
      uFadeScale: { value: opts.fadeScale ?? 1 },
      uForceLit: { value: opts.forceLit ?? 0 },
      uFill: { value: opts.fill ?? CONFIG.pulse.surfaceFill },
      uLineBoost: { value: opts.lineBoost ?? 1.8 },
    };
    const uniforms = { ...this.shared, ...own }; // shared refs + own values
    const shaders = {
      surface: [SURFACE_VERT, SURFACE_FRAG],
      line: [LINE_VERT, LINE_FRAG],
      points: [POINT_VERT, POINT_FRAG],
    }[kind];
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: COMMON_GLSL + shaders[0],
      fragmentShader: COMMON_GLSL + shaders[1],
      side: THREE.DoubleSide,
    });
    if (kind === 'surface') {
      // push faces slightly back so edge lines draw cleanly on top
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = 1;
      mat.polygonOffsetUnits = 1;
    }
    if (kind === 'points') {
      mat.transparent = true;
      mat.depthWrite = false;
      mat.blending = THREE.AdditiveBlending;
    }
    return mat;
  }
}

function makeArray(fn) {
  return Array.from({ length: MAX }, fn);
}

// Helper used everywhere: turn a geometry into a "glowing sketch" object
// (dark faces + bright edge lines) using the given materials.
export function makeEchoObject(geometry, surfaceMat, lineMat, edgeAngle = 25) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, surfaceMat));
  const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, edgeAngle), lineMat);
  lines.layers.set(1); // layer 1 = skipped by the depth pre-pass (see main.js)
  group.add(lines);
  return group;
}

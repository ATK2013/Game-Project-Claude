// =====================================================================
//  ECHO — level.js
//  Generates a new salt-mine maze every run and builds its 3D meshes.
//  The mine is a square grid. Each cell is either ROCK (solid) or OPEN.
//  Also provides collision, line-of-sight and path-finding helpers.
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { makeEchoObject } from './pulse.js';

export const ROCK = 1;
export const OPEN = 0;

const L = CONFIG.level;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Small seeded random number generator, so a layout can be repeated.
export function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Level {
  constructor(seed = Math.floor(Math.random() * 1e9)) {
    this.seed = seed;
    this.rng = makeRng(seed);
    this.size = L.gridSize;
    this.cell = L.cellSize;
    this.height = L.wallHeight;
    this.grid = new Uint8Array(this.size * this.size).fill(ROCK);
    this.obstacles = []; // solid boxes (crates, posts): {minX, maxX, minZ, maxZ}
    this.generate();
  }

  // ------------------------------------------------------------------
  // Basic grid helpers
  // ------------------------------------------------------------------
  get(x, z) {
    if (x < 0 || z < 0 || x >= this.size || z >= this.size) return ROCK;
    return this.grid[x + z * this.size];
  }
  set(x, z, v) { this.grid[x + z * this.size] = v; }
  isOpen(x, z) { return this.get(x, z) === OPEN; }

  // Convert between world metres and grid cells.
  toCell(wx, wz) { return [Math.floor(wx / this.cell), Math.floor(wz / this.cell)]; }
  toWorld(cx, cz, y = 0) {
    return new THREE.Vector3((cx + 0.5) * this.cell, y, (cz + 0.5) * this.cell);
  }
  randInt(n) { return Math.floor(this.rng() * n); }
  pick(list) { return list[this.randInt(list.length)]; }

  // ------------------------------------------------------------------
  // Generation
  // ------------------------------------------------------------------
  generate() {
    this.carveMaze();
    this.addLoops();
    this.addChambers();
    this.start = [1, 1];
    const dist = this.distancesFrom(this.start);
    this.elevator = this.farthestCell(dist);
    this.forks = this.placeForks(dist);
    this.creatureSpawn = this.placeCreature(dist);
    this.cans = this.scatter(L.tinCans, dist, 3);
    this.pebblePiles = this.scatter(L.pebblePiles, dist, 1);
  }

  // Classic "recursive backtracker": a random walk that carves tunnels.
  carveMaze() {
    const stack = [[1, 1]];
    this.set(1, 1, OPEN);
    while (stack.length) {
      const [x, z] = stack[stack.length - 1];
      const options = DIRS.filter(([dx, dz]) => {
        const nx = x + dx * 2, nz = z + dz * 2;
        return nx > 0 && nz > 0 && nx < this.size - 1 && nz < this.size - 1 && !this.isOpen(nx, nz);
      });
      if (!options.length) { stack.pop(); continue; }
      const [dx, dz] = this.pick(options);
      this.set(x + dx, z + dz, OPEN);
      this.set(x + dx * 2, z + dz * 2, OPEN);
      stack.push([x + dx * 2, z + dz * 2]);
    }
  }

  // Knock out some extra walls so there are loops to escape around.
  addLoops() {
    for (let z = 1; z < this.size - 1; z++) {
      for (let x = 1; x < this.size - 1; x++) {
        if (this.isOpen(x, z) || this.rng() > L.loopChance) continue;
        const horiz = this.isOpen(x - 1, z) && this.isOpen(x + 1, z) && !this.isOpen(x, z - 1) && !this.isOpen(x, z + 1);
        const vert = this.isOpen(x, z - 1) && this.isOpen(x, z + 1) && !this.isOpen(x - 1, z) && !this.isOpen(x + 1, z);
        if (horiz || vert) this.set(x, z, OPEN);
      }
    }
  }

  // Open a few small rectangular chambers.
  addChambers() {
    for (let i = 0; i < L.chambers; i++) {
      const w = 2 + this.randInt(2), h = 2 + this.randInt(2);
      const x0 = 1 + this.randInt(this.size - 2 - w);
      const z0 = 1 + this.randInt(this.size - 2 - h);
      for (let z = z0; z <= z0 + h; z++) {
        for (let x = x0; x <= x0 + w; x++) {
          if (x < this.size - 1 && z < this.size - 1) this.set(x, z, OPEN);
        }
      }
    }
  }

  // Breadth-first search: path distance (in cells) from one cell to all others.
  distancesFrom([sx, sz]) {
    const dist = new Int32Array(this.size * this.size).fill(-1);
    const queue = [[sx, sz]];
    dist[sx + sz * this.size] = 0;
    for (let i = 0; i < queue.length; i++) {
      const [x, z] = queue[i];
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz, k = nx + nz * this.size;
        if (this.isOpen(nx, nz) && dist[k] < 0) {
          dist[k] = dist[x + z * this.size] + 1;
          queue.push([nx, nz]);
        }
      }
    }
    return dist;
  }

  openCells() {
    const cells = [];
    for (let z = 0; z < this.size; z++) {
      for (let x = 0; x < this.size; x++) if (this.isOpen(x, z)) cells.push([x, z]);
    }
    return cells;
  }

  farthestCell(dist) {
    let best = this.start;
    for (const c of this.openCells()) {
      if (dist[c[0] + c[1] * this.size] > dist[best[0] + best[1] * this.size]) best = c;
    }
    return best;
  }

  countOpenNeighbours(x, z) {
    return DIRS.filter(([dx, dz]) => this.isOpen(x + dx, z + dz)).length;
  }

  // Spread the forks out: each new fork is placed far from the others.
  placeForks(dist) {
    const taken = [this.start, this.elevator];
    const minPath = 6;
    let cands = this.openCells().filter(([x, z]) =>
      dist[x + z * this.size] >= minPath && !(x === this.elevator[0] && z === this.elevator[1]));
    const forks = [];
    for (let i = 0; i < CONFIG.goal.forkCount; i++) {
      // score = distance to the nearest already-taken cell (+ bonus for dead ends)
      const scored = cands.map((c) => {
        const near = Math.min(...taken.map((t) => Math.hypot(t[0] - c[0], t[1] - c[1])));
        const deadEnd = this.countOpenNeighbours(c[0], c[1]) === 1 ? 2 : 0;
        return { c, s: near + deadEnd + this.rng() * 2 };
      }).sort((a, b) => b.s - a.s);
      const chosen = scored[this.randInt(Math.min(4, scored.length))].c;
      forks.push(chosen);
      taken.push(chosen);
      cands = cands.filter((c) => c !== chosen);
    }
    return forks;
  }

  placeCreature(dist) {
    const minCells = CONFIG.creature.spawnMinDistance / this.cell;
    const far = this.openCells().filter(([x, z]) => dist[x + z * this.size] >= minCells);
    return far.length ? this.pick(far) : this.farthestCell(dist);
  }

  // Random open cells at least 'minDist' cells (path) from the start.
  scatter(count, dist, minDist) {
    const cands = this.openCells().filter(([x, z]) => dist[x + z * this.size] >= minDist &&
      !(x === this.elevator[0] && z === this.elevator[1]));
    const out = [];
    for (let i = 0; i < count && cands.length; i++) {
      const idx = this.randInt(cands.length);
      out.push(cands.splice(idx, 1)[0]);
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Path-finding (BFS) — returns a list of [x, z] cells, start excluded
  // ------------------------------------------------------------------
  findPath(from, to) {
    const N = this.size;
    if (!this.isOpen(to[0], to[1])) return null;
    const prev = new Int32Array(N * N).fill(-1);
    const startK = from[0] + from[1] * N, goalK = to[0] + to[1] * N;
    prev[startK] = startK;
    const queue = [startK];
    for (let i = 0; i < queue.length && prev[goalK] < 0; i++) {
      const k = queue[i], x = k % N, z = Math.floor(k / N);
      for (const [dx, dz] of DIRS) {
        const nk = (x + dx) + (z + dz) * N;
        if (this.isOpen(x + dx, z + dz) && prev[nk] < 0) { prev[nk] = k; queue.push(nk); }
      }
    }
    if (prev[goalK] < 0) return null;
    const path = [];
    for (let k = goalK; k !== startK; k = prev[k]) path.push([k % N, Math.floor(k / N)]);
    return path.reverse();
  }

  // ------------------------------------------------------------------
  // How many rock cells lie on the straight line between two world points?
  // Used to muffle sounds through walls.
  // ------------------------------------------------------------------
  rockBetween(a, b) {
    let [cx, cz] = this.toCell(a.x, a.z);
    const [gx, gz] = this.toCell(b.x, b.z);
    const dx = (b.x - a.x) / this.cell, dz = (b.z - a.z) / this.cell;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const ix = 1 / Math.max(Math.abs(dx), 1e-6), iz = 1 / Math.max(Math.abs(dz), 1e-6);
    let tx = Math.abs((cx + (sx > 0 ? 1 : 0)) - a.x / this.cell) * ix;
    let tz = Math.abs((cz + (sz > 0 ? 1 : 0)) - a.z / this.cell) * iz;
    let count = 0;
    for (let i = 0; i < 64 && !(cx === gx && cz === gz); i++) {
      if (tx < tz) { cx += sx; tx += ix; } else { cz += sz; tz += iz; }
      if (!(cx === gx && cz === gz) && this.get(cx, cz) === ROCK) count++;
    }
    return count;
  }

  // ------------------------------------------------------------------
  // Collision: push a circle (x/z) out of rock cells and obstacles.
  // Modifies 'pos' in place.
  // ------------------------------------------------------------------
  collide(pos, radius) {
    const [cx, cz] = this.toCell(pos.x, pos.z);
    for (let z = cz - 1; z <= cz + 1; z++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        if (this.get(x, z) !== ROCK) continue;
        pushOutOfBox(pos, radius, x * this.cell, (x + 1) * this.cell, z * this.cell, (z + 1) * this.cell);
      }
    }
    for (const o of this.obstacles) pushOutOfBox(pos, radius, o.minX, o.maxX, o.minZ, o.maxZ);
  }

  // A data texture with one pixel per cell: white = rock. Read by the shader.
  makeWallTexture() {
    const data = new Uint8Array(this.size * this.size);
    for (let i = 0; i < data.length; i++) data[i] = this.grid[i] === ROCK ? 255 : 0;
    const tex = new THREE.DataTexture(data, this.size, this.size, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }

  // ------------------------------------------------------------------
  // Mesh building
  // ------------------------------------------------------------------
  buildMeshes(mats) {
    const group = new THREE.Group();
    group.add(makeEchoObject(this.buildTunnelGeometry(), mats.surface, mats.line, 20));
    const props = this.buildPropGeometry();
    if (props) group.add(makeEchoObject(props, mats.surface, mats.line, 25));
    const dust = new THREE.Points(this.buildDustGeometry(), mats.points);
    dust.layers.set(1); // skipped by the depth pre-pass (see main.js)
    group.add(dust);
    return group;
  }

  // Deterministic wobble for a corner point, so walls look hand-carved.
  // The same corner always gets the same wobble, so pieces still join up.
  jitter(x, y, z) {
    const h = (a) => {
      const s = Math.sin(a) * 43758.5453;
      return s - Math.floor(s) - 0.5;
    };
    const j = L.wallJitter * 2;
    return [x + h(x * 12.9 + y * 4.1 + z * 78.2) * j, y, z + h(x * 39.3 + y * 7.7 + z * 11.1) * j];
  }

  // Floors, ceilings and wall faces for every open cell.
  buildTunnelGeometry() {
    const pos = [], nor = [];
    const C = this.cell, H = this.height;
    const quad = (pts, n) => {
      const v = pts.map((p) => this.jitter(...p));
      for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...v[i]); nor.push(...n); }
    };
    for (const [x, z] of this.openCells()) {
      const x0 = x * C, x1 = x0 + C, z0 = z * C, z1 = z0 + C;
      quad([[x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0]], [0, 1, 0]);
      quad([[x0, H, z0], [x1, H, z0], [x1, H, z1], [x0, H, z1]], [0, -1, 0]);
      if (!this.isOpen(x - 1, z)) quad([[x0, 0, z0], [x0, H, z0], [x0, H, z1], [x0, 0, z1]], [1, 0, 0]);
      if (!this.isOpen(x + 1, z)) quad([[x1, 0, z0], [x1, 0, z1], [x1, H, z1], [x1, H, z0]], [-1, 0, 0]);
      if (!this.isOpen(x, z - 1)) quad([[x0, 0, z0], [x1, 0, z0], [x1, H, z0], [x0, H, z0]], [0, 0, 1]);
      if (!this.isOpen(x, z + 1)) quad([[x0, 0, z1], [x0, H, z1], [x1, H, z1], [x1, 0, z1]], [0, 0, -1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return g;
  }

  // Wooden support frames in straight tunnels and crates in corners.
  buildPropGeometry() {
    const parts = [];
    const special = [this.start, this.elevator, ...this.forks].map(([x, z]) => `${x},${z}`);
    for (const [x, z] of this.openCells()) {
      if (special.includes(`${x},${z}`)) continue;
      const wallsX = !this.isOpen(x - 1, z) && !this.isOpen(x + 1, z);
      const wallsZ = !this.isOpen(x, z - 1) && !this.isOpen(x, z + 1);
      if ((wallsX !== wallsZ) && this.rng() < L.supportChance) this.addSupport(parts, x, z, wallsX);
      else if (this.countOpenNeighbours(x, z) <= 2 && this.rng() < L.crateChance) this.addCrates(parts, x, z);
    }
    return parts.length ? mergeGeometries(parts) : null;
  }

  // Helper: a box geometry placed in the world (optionally solid).
  box(parts, w, h, d, x, y, z, rotY = 0, solid = false) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z));
    parts.push(g);
    if (solid) this.obstacles.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  }

  // Two posts against the walls plus a beam across the ceiling.
  addSupport(parts, x, z, wallsOnX) {
    const c = this.toWorld(x, z), C = this.cell, H = this.height, t = 0.22;
    const off = C / 2 - t / 2 - 0.02;
    if (wallsOnX) {
      this.box(parts, t, H, t, c.x - off, H / 2, c.z, 0, true);
      this.box(parts, t, H, t, c.x + off, H / 2, c.z, 0, true);
      this.box(parts, C, 0.28, t + 0.04, c.x, H - 0.14, c.z);
    } else {
      this.box(parts, t, H, t, c.x, H / 2, c.z - off, 0, true);
      this.box(parts, t, H, t, c.x, H / 2, c.z + off, 0, true);
      this.box(parts, t + 0.04, 0.28, C, c.x, H - 0.14, c.z);
    }
  }

  // One or two crates pushed into a corner of the cell.
  addCrates(parts, x, z) {
    const c = this.toWorld(x, z), C = this.cell;
    const s = 0.7 + this.rng() * 0.35;
    const sx = this.isOpen(x - 1, z) ? 1 : -1;
    const sz = this.isOpen(x, z - 1) ? 1 : -1;
    const px = c.x + sx * (C / 2 - s / 2 - 0.05);
    const pz = c.z + sz * (C / 2 - s / 2 - 0.05);
    this.box(parts, s, s, s, px, s / 2, pz, 0, true);
    if (this.rng() < 0.5) this.box(parts, s * 0.6, s * 0.6, s * 0.6, px, s + s * 0.3, pz, this.rng() - 0.5);
  }

  // Random dots on floors, walls and ceilings for the flickering texture.
  buildDustGeometry() {
    const pos = [], nor = [], seed = [];
    const C = this.cell, H = this.height;
    for (const [x, z] of this.openCells()) {
      for (let i = 0; i < CONFIG.graphics.dustPerCell; i++) {
        const r = this.rng();
        let p, n;
        const u = (x + this.rng()) * C, v = (z + this.rng()) * C;
        if (r < 0.6) { p = [u, 0.02, v]; n = [0, 1, 0]; }
        else if (r < 0.75) { p = [u, H - 0.02, v]; n = [0, -1, 0]; }
        else { [p, n] = this.wallDot(x, z, this.rng() * H); }
        if (!p) continue;
        pos.push(...p); nor.push(...n); seed.push(this.rng());
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aNormal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    return g;
  }

  // A dot on a random wall of this cell (if it has one).
  wallDot(x, z, y) {
    const C = this.cell, walls = [];
    const t = this.rng() * C, e = 0.03;
    if (!this.isOpen(x - 1, z)) walls.push([[x * C + e, y, z * C + t], [1, 0, 0]]);
    if (!this.isOpen(x + 1, z)) walls.push([[(x + 1) * C - e, y, z * C + t], [-1, 0, 0]]);
    if (!this.isOpen(x, z - 1)) walls.push([[x * C + t, y, z * C + e], [0, 0, 1]]);
    if (!this.isOpen(x, z + 1)) walls.push([[x * C + t, y, (z + 1) * C - e], [0, 0, -1]]);
    return walls.length ? this.pick(walls) : [null, null];
  }
}

// Push a circle at pos (x/z) with radius r out of an axis-aligned box.
function pushOutOfBox(pos, r, minX, maxX, minZ, maxZ) {
  const nx = Math.max(minX, Math.min(pos.x, maxX));
  const nz = Math.max(minZ, Math.min(pos.z, maxZ));
  const dx = pos.x - nx, dz = pos.z - nz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2), push = (r - d) / d;
    pos.x += dx * push;
    pos.z += dz * push;
  } else {
    // centre is inside the box: push out along the shortest axis
    const opts = [[minX - r - pos.x, 0], [maxX + r - pos.x, 0], [0, minZ - r - pos.z], [0, maxZ + r - pos.z]];
    opts.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
    pos.x += opts[0][0];
    pos.z += opts[0][1];
  }
}

// =====================================================================
//  ECHO — features.js
//  Places the interactive parts of each generated mine:
//    • pits     — crevices across a tunnel that you must jump over
//    • hurdles  — fallen beams across a tunnel that you must jump over
//    • gates    — iron gates opened by a lever (the creature can't pass them)
//    • decoys   — levers that ring a bell far away (a loud distraction)
//
//  Always solvable: every gate's lever is placed somewhere you can reach
//  from the start WITH all gates (so far) closed. So you can always open
//  the gates one by one.
// =====================================================================
import { CONFIG } from './config.js';

const F = CONFIG.features;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const cellKey = (x, z) => `${x},${z}`;

// Which way does a straight tunnel cell run? 'x', 'z', or null if it isn't one.
// (Rock on both sides, open at both ends.)
export function corridorAxis(level, x, z) {
  const open = (dx, dz) => level.isOpen(x + dx, z + dz);
  if (open(1, 0) && open(-1, 0) && !open(0, 1) && !open(0, -1)) return 'x';
  if (open(0, 1) && open(0, -1) && !open(1, 0) && !open(-1, 0)) return 'z';
  return null;
}

// A wall next to this cell to hang a lever on, as [dx, dz], or null.
function wallDir(level, x, z) {
  return DIRS.find(([dx, dz]) => !level.isOpen(x + dx, z + dz)) || null;
}

export function placeFeatures(level, dist) {
  Object.assign(level, { pits: [], hurdles: [], gates: [], decoys: [], blocked: new Set(), cellFeature: new Map() });
  const used = new Set([cellKey(...level.start), cellKey(...level.elevator)]);
  const [ex, ez] = level.elevator;
  for (const [dx, dz] of DIRS) used.add(cellKey(ex + dx, ez + dz)); // keep the way to the exit clear
  const mark = (x, z, feature) => { used.add(cellKey(x, z)); level.cellFeature.set(cellKey(x, z), feature); };
  // features need a free cell with no other feature right next to it
  const free = (x, z) => !used.has(cellKey(x, z)) &&
    DIRS.every(([dx, dz]) => !level.cellFeature.has(cellKey(x + dx, z + dz)));
  const tunnels = shuffle(level, level.openCells().filter(([x, z]) =>
    corridorAxis(level, x, z) && dist[x + z * level.size] >= 4));

  for (const [x, z] of tunnels) {
    if (level.pits.length >= F.pits) break;
    if (free(x, z)) { const pit = makePit(level, x, z); level.pits.push(pit); mark(x, z, pit); }
  }
  for (const [x, z] of tunnels) {
    if (level.hurdles.length >= F.hurdles) break;
    if (free(x, z)) { const h = makeHurdle(level, x, z); level.hurdles.push(h); mark(x, z, h); }
  }
  for (const [x, z] of tunnels) {
    if (level.gates.length >= F.gates) break;
    if (free(x, z)) tryGate(level, x, z, used, mark);
  }
  for (let i = 0; i < F.decoyLevers; i++) placeDecoy(level, used, mark);
  level.featureCells = used;
}

function shuffle(level, list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = level.randInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// A box across the tunnel, 'along' metres long in the tunnel's direction.
function acrossRect(level, x, z, axis, from, to) {
  const C = level.cell;
  return axis === 'x'
    ? { minX: from, maxX: to, minZ: z * C, maxZ: (z + 1) * C }
    : { minX: x * C, maxX: (x + 1) * C, minZ: from, maxZ: to };
}

function makePit(level, x, z) {
  const axis = corridorAxis(level, x, z);
  const c = level.toWorld(x, z);
  const width = F.pitWidth[0] + level.rng() * (F.pitWidth[1] - F.pitWidth[0]);
  const a = (axis === 'x' ? c.x : c.z) - width / 2, b = a + width;
  return { type: 'pit', cell: [x, z], axis, a, b, depth: F.pitDepth, ...acrossRect(level, x, z, axis, a, b) };
}

function makeHurdle(level, x, z) {
  const axis = corridorAxis(level, x, z);
  const c = level.toWorld(x, z);
  const mid = axis === 'x' ? c.x : c.z;
  const h = { type: 'hurdle', cell: [x, z], axis, top: F.hurdleHeight, ...acrossRect(level, x, z, axis, mid - 0.2, mid + 0.2) };
  level.obstacles.push(h); // blocks you unless you jump over it (it has a 'top')
  return h;
}

function leverSpot(level, x, z) {
  const [dx, dz] = wallDir(level, x, z);
  const pos = level.toWorld(x, z, 1.15);
  pos.x += dx * (level.cell / 2 - 0.08);
  pos.z += dz * (level.cell / 2 - 0.08);
  return { cell: [x, z], pos, wall: [dx, dz] };
}

// Close a gate here, then hang its lever on our side of every closed gate.
function tryGate(level, x, z, used, mark) {
  const key = cellKey(x, z);
  level.blocked.add(key);
  const reach = level.distancesFrom(level.start, true);
  const spots = level.openCells().filter(([lx, lz]) => {
    const d = Math.hypot(lx - x, lz - z);
    return reach[lx + lz * level.size] >= 0 && !used.has(cellKey(lx, lz)) && wallDir(level, lx, lz) && d >= 2 && d <= 7;
  });
  if (!spots.length) { level.blocked.delete(key); return; }
  const [lx, lz] = level.pick(spots);
  const gate = { type: 'gate', cell: [x, z], axis: corridorAxis(level, x, z), lever: leverSpot(level, lx, lz) };
  level.gates.push(gate);
  mark(x, z, gate);
  mark(lx, lz, { type: 'lever' });
}

// A lever you can reach, and a bell 7-14 cells away from it.
function placeDecoy(level, used, mark) {
  const reach = level.distancesFrom(level.start, true);
  const levers = level.openCells().filter(([x, z]) =>
    reach[x + z * level.size] >= 3 && !used.has(cellKey(x, z)) && wallDir(level, x, z));
  if (!levers.length) return;
  const [lx, lz] = level.pick(levers);
  const fromLever = level.distancesFrom([lx, lz]);
  const bells = level.openCells().filter(([x, z]) => {
    const d = fromLever[x + z * level.size];
    return d >= 7 && d <= 14 && !used.has(cellKey(x, z));
  });
  if (!bells.length) return;
  const [bx, bz] = level.pick(bells);
  level.decoys.push({ lever: leverSpot(level, lx, lz), bell: { cell: [bx, bz], pos: level.toWorld(bx, bz, level.height - 0.6) } });
  mark(lx, lz, { type: 'lever' });
  mark(bx, bz, { type: 'bell' });
}

// ---------------------------------------------------------------------
// Pit geometry: the tunnel floor gets a hole with walls and a bottom.
// 'q' is an object of helpers from Level.buildTunnelGeometry.
// ---------------------------------------------------------------------
export function addPitCell(q, pit, x0, x1, z0, z1, H) {
  const { a, b } = pit, D = -pit.depth;
  if (pit.axis === 'x') {
    q.floor(x0, a, z0, z1, 0); q.floor(b, x1, z0, z1, 0); q.floor(a, b, z0, z1, D);
    for (const wall of [q.wallZmin, q.wallZmax]) {
      wall(x0, a, 0, H); wall(a, b, 0, H); wall(a, b, D, 0); wall(b, x1, 0, H);
    }
    q.quad([[a, D, z0], [a, 0, z0], [a, 0, z1], [a, D, z1]], [1, 0, 0]);   // near edge of the hole
    q.quad([[b, D, z0], [b, D, z1], [b, 0, z1], [b, 0, z0]], [-1, 0, 0]);  // far edge
  } else {
    q.floor(x0, x1, z0, a, 0); q.floor(x0, x1, b, z1, 0); q.floor(x0, x1, a, b, D);
    for (const wall of [q.wallXmin, q.wallXmax]) {
      wall(z0, a, 0, H); wall(a, b, 0, H); wall(a, b, D, 0); wall(b, z1, 0, H);
    }
    q.quad([[x0, D, a], [x1, D, a], [x1, 0, a], [x0, 0, a]], [0, 0, 1]);
    q.quad([[x0, D, b], [x0, 0, b], [x1, 0, b], [x1, D, b]], [0, 0, -1]);
  }
}

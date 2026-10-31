import * as THREE from 'three';
import { hash01 } from '../sim/geometry';
import { type Terrain, WATER_LEVEL } from '../sim/terrain';

/**
 * The shore, drawn finer than the rest of the ground. The land meets the water in a sharp step that the 20 m
 * ground grid turned into a staircase; here the cells the waterline crosses are split into 4 m pieces, the
 * true waterline is found between samples, and the ground is shaped by its distance from it: a beach sloping
 * gently under the water, so the sea's edge follows the real curve of the coast. Rocky stretches of sea coast
 * get reefs of boulders, half drowned, along the waterline.
 */

/** Size of the ground's cells (as in terrainMesh), and of the pieces shore cells are split into. */
export const CELL_STEP = 20;
export const FINE = 5;
export const SUB = CELL_STEP / FINE;
/** How far from the waterline the ground is reshaped, on land and under the water. */
const REACH = 20;
/** Land higher than this at the water stays as it is: a cliff, not a beach. */
const CLIFF = 6;
/** Width of the sand (or bare rock) above the waterline. */
export const BEACH = 9;

export interface Coast {
  /** cells (by their index from the terrain's min corner) split finely */
  readonly cells: Set<number>;
  /** pieces per side a ground cell is split into: SUB on the shore, 2 around it, 1 elsewhere */
  level(i: number, j: number): number;
  /** the distance to the waterline found by the last height() (signed as distance()) */
  readonly last: { d: number };
  /** ground height for drawing: the terrain's, with the shore smoothed */
  height(x: number, y: number): number;
  /** 0 on a sandy beach .. 1 on a rocky coast */
  rocky(x: number, y: number): number;
  /** points on the waterline, a few meters apart */
  readonly line: { x: number; y: number }[];
  /** signed distance to the waterline: positive on land, negative in the water */
  distance(x: number, y: number): number;
}

export const cellKey = (i: number, j: number) => i * 65536 + j;

/** Smooth value noise from the hash, 0..1. */
function smoothNoise(x: number, y: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash01(i, j);
  const b = hash01(i + 1, j);
  const c = hash01(i, j + 1);
  const d = hash01(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const coasts = new WeakMap<Terrain, Coast>();

export function coastOf(terrain: Terrain, corner: (x: number, y: number) => number): Coast {
  const known = coasts.get(terrain);
  if (known) return known;
  const b = terrain.bounds;
  const wet = (x: number, y: number) => terrain.height(x, y) < WATER_LEVEL;
  const cells = new Set<number>();
  const line: { x: number; y: number }[] = [];
  const buckets = new Map<number, { x: number; y: number }[]>();
  const bucket = (x: number, y: number) => cellKey(Math.floor((x - b.minX) / CELL_STEP) + 1, Math.floor((y - b.minY) / CELL_STEP) + 1);
  const crossing = (x0: number, y0: number, x1: number, y1: number, w0: boolean) => {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 7; k++) {
      const m = (lo + hi) / 2;
      if (wet(x0 + (x1 - x0) * m, y0 + (y1 - y0) * m) === w0) lo = m;
      else hi = m;
    }
    const t = (lo + hi) / 2;
    const p = { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
    line.push(p);
    const k = bucket(p.x, p.y);
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(p);
  };
  for (let y = b.minY, j = 0; y < b.maxY - 1e-6; y += CELL_STEP, j++) {
    for (let x = b.minX, i = 0; x < b.maxX - 1e-6; x += CELL_STEP, i++) {
      const below = +(corner(x, y) < WATER_LEVEL) + +(corner(x + CELL_STEP, y) < WATER_LEVEL) + +(corner(x, y + CELL_STEP) < WATER_LEVEL) + +(corner(x + CELL_STEP, y + CELL_STEP) < WATER_LEVEL);
      if (below === 0 || below === 4) continue;
      if (terrain.region(x + CELL_STEP / 2, y + CELL_STEP / 2) === null) continue;
      cells.add(cellKey(i, j));
      // The waterline between neighbouring samples on the fine grid
      const w: boolean[] = [];
      for (let b2 = 0; b2 <= SUB; b2++) for (let a = 0; a <= SUB; a++) w.push(wet(x + a * FINE, y + b2 * FINE));
      for (let b2 = 0; b2 <= SUB; b2++) {
        for (let a = 0; a <= SUB; a++) {
          const here = w[b2 * (SUB + 1) + a];
          const px = x + a * FINE;
          const py = y + b2 * FINE;
          if (a < SUB && w[b2 * (SUB + 1) + a + 1] !== here) crossing(px, py, px + FINE, py, here);
          if (b2 < SUB && w[(b2 + 1) * (SUB + 1) + a] !== here) crossing(px, py, px, py + FINE, here);
        }
      }
    }
  }
  // The shore cells take in all land within a beach's width of the waterline, so the sand's edge is drawn fine too
  const ci0 = (x: number) => Math.floor((x - b.minX) / CELL_STEP);
  const cj0 = (y: number) => Math.floor((y - b.minY) / CELL_STEP);
  for (const p of line) {
    for (let i = ci0(p.x - BEACH); i <= ci0(p.x + BEACH); i++) for (let j = cj0(p.y - BEACH); j <= cj0(p.y + BEACH); j++) cells.add(cellKey(i, j));
  }
  const ring = new Set<number>();
  for (const k of cells) {
    const i = Math.floor(k / 65536);
    const j = k % 65536;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (!cells.has(cellKey(i + di, j + dj))) ring.add(cellKey(i + di, j + dj));
  }
  const level = (i: number, j: number) => (cells.has(cellKey(i, j)) ? SUB : ring.has(cellKey(i, j)) ? 2 : 1);
  const reach = (x: number, y: number) => {
    let best = REACH * REACH;
    const ci = Math.floor((x - b.minX) / CELL_STEP) + 1;
    const cj = Math.floor((y - b.minY) / CELL_STEP) + 1;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const pts = buckets.get(cellKey(ci + di, cj + dj));
        if (!pts) continue;
        for (const p of pts) {
          const d = (p.x - x) ** 2 + (p.y - y) ** 2;
          if (d < best) best = d;
        }
      }
    }
    return Math.sqrt(best);
  };
  const distance = (x: number, y: number) => (wet(x, y) ? -reach(x, y) : reach(x, y));
  const rocky = (x: number, y: number) => smoothstep(0.42, 0.62, smoothNoise(x / 260 + 3.1, y / 260 + 7.7) * 0.75 + smoothNoise(x / 70, y / 70) * 0.25);
  const last = { d: REACH };
  const height = (x: number, y: number) => {
    const h = terrain.height(x, y);
    const d = h < WATER_LEVEL ? -reach(x, y) : reach(x, y);
    last.d = d;
    if (d >= REACH || d <= -REACH) return h;
    // Both sides slope through the waterline (not flatten into it), so the water's edge follows the line cleanly
    if (d >= 0) {
      if (h > CLIFF) return h;
      const r = rocky(x, y);
      // A rocky shore climbs steeper and rougher than a beach
      const rise = WATER_LEVEL + d * (0.1 + 0.25 * r) + r * 0.4 * (hash01(Math.round(x * 0.5), Math.round(y * 0.5)) - 0.3) * Math.min(1, d / 2);
      return Math.min(h, rise);
    }
    return Math.max(h, WATER_LEVEL + d * 0.15);
  };
  const coast: Coast = { cells, level, last, height, rocky, line, distance };
  coasts.set(terrain, coast);
  return coast;
}

export interface RockSpot {
  x: number;
  y: number;
  /** ground height under the rock */
  h: number;
  /** width and height (m) */
  s: number;
  sy: number;
  turn: number;
  tilt: number;
  color: THREE.Color;
}

/** Boulders along the rocky stretches of the sea coast: a reef just off the waterline, a few up on the shore. */
export function coastRocks(terrain: Terrain, coast: Coast): RockSpot[] {
  const rocks: RockSpot[] = [];
  const line = coast.line;
  for (let k = 0; k < line.length; k += 2) {
    const p = line[k];
    const r = coast.rocky(p.x, p.y);
    if (r < 0.15 || hash01(p.x * 1.3, p.y * 0.7) > r) continue;
    // Out to sea: the direction in which the ground gets wetter
    const e = 2;
    let nx = coast.distance(p.x - e, p.y) - coast.distance(p.x + e, p.y);
    let ny = coast.distance(p.x, p.y - e) - coast.distance(p.x, p.y + e);
    const len = Math.hypot(nx, ny);
    if (len < 1e-3) continue;
    nx /= len;
    ny /= len;
    if (!terrain.sea(p.x + nx * 25, p.y + ny * 25)) continue;
    const count = 1 + Math.floor(hash01(p.y, p.x) * 5 * r);
    for (let c = 0; c < count; c++) {
      const h1 = hash01(p.x + c * 17.1, p.y - c * 3.7);
      const h2 = hash01(p.y + c * 5.3, p.x + c * 11.9);
      const h3 = hash01(p.x * 0.31 + c, p.y * 0.29 - c);
      // Mostly in the water within a dozen meters of the line; the odd one on the beach
      const out = -1 + Math.pow(h1, 1.5) * 22;
      const side = (h2 - 0.5) * 6;
      const x = p.x + nx * out - ny * side;
      const y = p.y + ny * out + nx * side;
      const ground = coast.height(x, y);
      const s = (1.2 + h3 * (2.2 + 2.5 * r)) * (out > 12 ? 0.75 : 1);
      // Tops stand a little out of the water
      const top = WATER_LEVEL + 0.2 + h2 * (out > 12 ? 0.6 : 1.8) + s * 0.15;
      const sy = Math.min(6, Math.max(s * 0.5, (top - ground) / 0.8));
      const grey = 0.27 + h1 * 0.12;
      const color = new THREE.Color().setHSL(0.08 + h3 * 0.05, 0.08 + h2 * 0.07, grey);
      rocks.push({ x, y, h: ground, s, sy, turn: h2 * Math.PI * 2, tilt: (h3 - 0.5) * 0.4, color });
    }
  }
  return rocks;
}

/** A lumpy low-poly boulder, 1 m wide and high, base at 0; darker and greener low down where the sea wets it. */
export function rockGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.5, 1);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Same jitter for the same corner, so faces stay joined
    const k = 0.78 + 0.4 * hash01(Math.round(v.x * 100), Math.round(v.y * 100) + Math.round(v.z * 37));
    v.multiplyScalar(k);
    v.y = v.y < 0 ? v.y * 0.6 : v.y * 0.95;
    pos.setXYZ(i, v.x, v.y + 0.3, v.z);
  }
  const flat = g;
  flat.computeVertexNormals();
  const p = flat.attributes.position;
  const colors: number[] = [];
  const top = new THREE.Color(0xd8d2c4);
  const wetBase = new THREE.Color(0x4a5242);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    c.copy(wetBase).lerp(top, smoothstep(0.05, 0.55, y));
    for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
  }
  flat.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return flat;
}

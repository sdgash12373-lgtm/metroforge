import * as THREE from 'three';
import { hash01 } from '../sim/geometry';
import { BEACH, CELL_STEP, coastOf } from './coast';
import { HALF_MAP, type RegionName, type Terrain, WATER_LEVEL, buildable } from '../sim/terrain';

/** Ground triangles are this many meters across. */
const STEP = CELL_STEP;
/** trees in the lowland woods, and on hills and mountains, and across the land beyond the old square */
export const LOWLAND_TREES = 6000;
export const HILL_TREES = 6000;
export const OUTER_TREES = 5000;
const TREE_AREA = 1400;

const GRASS = new THREE.Color(0x9cbf74);
const SAND = new THREE.Color(0xd9c894);
const SEABED = new THREE.Color(0x8f9478);
const HILL = new THREE.Color(0x76a052);
const FOREST = new THREE.Color(0x4d7a3c);
const ROCK = new THREE.Color(0x8d8b7c);
const PEAK = new THREE.Color(0xc4c0b2);
const SHORE_ROCK = new THREE.Color(0x8a8272);

function landColor(h: number, out: THREE.Color): THREE.Color {
  if (h < -2.5) return out.copy(SEABED);
  if (h < 0) return out.copy(SAND);
  if (h < 0.05) return out.copy(GRASS);
  if (h < 50) return out.copy(GRASS).lerp(HILL, h / 50);
  if (h < 180) return out.copy(HILL).lerp(FOREST, (h - 50) / 130);
  if (h < 330) return out.copy(FOREST).lerp(ROCK, (h - 180) / 150);
  return out.copy(ROCK).lerp(PEAK, Math.min(1, (h - 330) / 120));
}

/** Ground heights at the cell corners, kept per terrain: the ground, the water and the veil all ask for them. */
const corners = new WeakMap<Terrain, (x: number, y: number) => number>();

export function cornerHeights(terrain: Terrain): (x: number, y: number) => number {
  let h = corners.get(terrain);
  if (h) return h;
  const b = terrain.bounds;
  const cols = Math.ceil((b.maxX - b.minX) / STEP) + 1;
  const rows = Math.ceil((b.maxY - b.minY) / STEP) + 1;
  const grid = new Float32Array(cols * rows).fill(NaN);
  h = (x: number, y: number) => {
    const i = Math.round((x - b.minX) / STEP);
    const j = Math.round((y - b.minY) / STEP);
    if (i < 0 || j < 0 || i >= cols || j >= rows) return terrain.height(x, y);
    let v = grid[j * cols + i];
    if (Number.isNaN(v)) grid[j * cols + i] = v = terrain.height(x, y);
    return v;
  };
  corners.set(terrain, h);
  return h;
}

/** Calls `cell` for every ground cell on the map (its corner x, y), row by row. */
function eachCell(terrain: Terrain, cell: (x: number, y: number) => void, keep?: (r: RegionName) => boolean): void {
  const b = terrain.bounds;
  for (let y = b.minY; y < b.maxY - 1e-6; y += STEP) {
    for (let x = b.minX; x < b.maxX - 1e-6; x += STEP) {
      const r = terrain.region(x + STEP / 2, y + STEP / 2);
      if (r !== null && (!keep || keep(r))) cell(x, y);
    }
  }
}

/** Two triangles per cell, as a plane would split it, with heights from `h`. */
function cellTriangles(x: number, y: number, h: (x: number, y: number) => number, out: number[]): void {
  const x1 = x + STEP;
  const y1 = y + STEP;
  out.push(x, h(x, y), y, x, h(x, y1), y1, x1, h(x1, y), y);
  out.push(x, h(x, y1), y1, x1, h(x1, y1), y1, x1, h(x1, y), y);
}

/**
 * The ground as flat-coloured low-poly triangles over every cell on the map; each triangle is coloured by
 * its lowest corner, so coasts get a sandy rim.
 */
export function buildGroundGeometry(terrain: Terrain): THREE.BufferGeometry {
  const pos: number[] = [];
  const colors: number[] = [];
  const h = cornerHeights(terrain);
  const coast = coastOf(terrain, h);
  const b = terrain.bounds;
  const c = new THREE.Color();
  const flatColour = (start: number) => {
    const ys = [pos[start + 1], pos[start + 4], pos[start + 7]];
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    landColor(lo < 0 ? lo : (lo + hi) / 2, c);
    const v = hash01(pos[start] + pos[start + 3], pos[start + 2] + pos[start + 8]);
    c.offsetHSL((v - 0.5) * 0.02, 0, (v - 0.5) * 0.03);
    for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
  };
  eachCell(terrain, (x, y) => {
    const i = Math.round((x - b.minX) / STEP);
    const j = Math.round((y - b.minY) / STEP);
    const n = coast.level(i, j);
    if (n === 1) {
      const at = pos.length;
      cellTriangles(x, y, h, pos);
      flatColour(at);
      flatColour(at + 9);
      return;
    }
    // Near the shore: split finer, heights from the smoothed coast and colours blended by the distance to the
    // waterline. Where a neighbour is split differently, the shared edge stays the straight line between the
    // corners, so no gap opens
    const step = STEP / n;
    const other = (di: number, dj: number) => coast.level(i + di, j + dj) !== n;
    const vh: number[] = [];
    const vc: number[] = [];
    for (let cc = 0; cc <= n; cc++) {
      for (let a = 0; a <= n; a++) {
        const px = x + a * step;
        const py = y + cc * step;
        const left = a === 0 && other(-1, 0);
        const right = a === n && other(1, 0);
        const down = cc === 0 && other(0, -1);
        const up = cc === n && other(0, 1);
        const corner = (a === 0 || a === n) && (cc === 0 || cc === n);
        let height: number;
        let d = 99;
        if (corner && (left || right || down || up || other(a ? 1 : -1, cc ? 1 : -1))) height = h(px, py);
        else if (left || right) height = THREE.MathUtils.lerp(h(px, y), h(px, y + STEP), cc / n);
        else if (down || up) height = THREE.MathUtils.lerp(h(x, py), h(x + STEP, py), a / n);
        else {
          height = coast.height(px, py);
          d = coast.last.d;
        }
        if (d === 99) d = coast.distance(px, py);
        vh.push(height);
        shoreColour(px, py, height, d, coast.rocky(px, py), c);
        vc.push(c.r, c.g, c.b);
      }
    }
    const V = (a: number, cc: number) => cc * (n + 1) + a;
    const put = (k: number, a: number, cc: number) => {
      pos.push(x + a * step, vh[k], y + cc * step);
      colors.push(vc[k * 3], vc[k * 3 + 1], vc[k * 3 + 2]);
    };
    for (let cc = 0; cc < n; cc++) {
      for (let a = 0; a < n; a++) {
        put(V(a, cc), a, cc);
        put(V(a, cc + 1), a, cc + 1);
        put(V(a + 1, cc), a + 1, cc);
        put(V(a, cc + 1), a, cc + 1);
        put(V(a + 1, cc + 1), a + 1, cc + 1);
        put(V(a + 1, cc), a + 1, cc);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

const WET_SAND = new THREE.Color(0xb3a57a);
const shoreTmp = new THREE.Color();

/**
 * The ground's colour near the water, blended smoothly: grass down to a strip of sand (or bare rock on a rocky
 * stretch) along the waterline, wet darker sand just under it, seabed further out.
 */
function shoreColour(x: number, y: number, h: number, d: number, rocky: number, out: THREE.Color): void {
  const wobble = (hash01(Math.floor(x / 7), Math.floor(y / 7)) - 0.5) * 3;
  if (h >= WATER_LEVEL) {
    landColor(Math.max(h, 0.05), out);
    if (d < 90) {
      const shore = shoreTmp.copy(SAND).lerp(SHORE_ROCK, rocky);
      out.lerp(shore, 1 - smoothstepN(BEACH - 4, BEACH, d + wobble));
    }
  } else {
    const shore = shoreTmp.copy(WET_SAND).lerp(SHORE_ROCK, rocky).multiplyScalar(rocky > 0.5 ? 0.8 : 1);
    out.copy(SEABED).lerp(shore, 1 - smoothstepN(-1.2, -3.2, h));
  }
  const v = hash01(x * 0.37, y * 0.41);
  out.offsetHSL((v - 0.5) * 0.015, 0, (v - 0.5) * (0.025 + rocky * 0.06));
}

function smoothstepN(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The water surface: only over cells with some ground below it. */
export function buildWaterGeometry(terrain: Terrain): THREE.BufferGeometry {
  const pos: number[] = [];
  const h = cornerHeights(terrain);
  eachCell(terrain, (x, y) => {
    const wet = h(x, y) < 0 || h(x + STEP, y) < 0 || h(x, y + STEP) < 0 || h(x + STEP, y + STEP) < 0;
    if (wet) cellTriangles(x, y, () => WATER_LEVEL, pos);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** A veil over the regions not opened yet, just above the ground. */
export function buildLockedGeometry(terrain: Terrain, open: ReadonlySet<RegionName>): THREE.BufferGeometry {
  const pos: number[] = [];
  const ground = cornerHeights(terrain);
  const h = (x: number, y: number) => Math.max(WATER_LEVEL, ground(x, y)) + 1.2;
  eachCell(terrain, (x, y) => cellTriangles(x, y, h, pos), (r) => !open.has(r));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export interface TreeSpot {
  x: number;
  y: number;
  /** ground height */
  h: number;
  s: number;
  color: THREE.Color;
  /** on land nothing can be built on, so roads and zoning never clear it */
  wild: boolean;
}

/** Clumped woods on the plain, and forest over the hills and mountains. */
export function treeSpots(terrain: Terrain): TreeSpot[] {
  const spots: TreeSpot[] = [];
  let i = 0;
  while (spots.length < LOWLAND_TREES && i < LOWLAND_TREES * 4) {
    i++;
    const x = (hash01(i, 1) - 0.5) * TREE_AREA * 2;
    const y = (hash01(1, i) - 0.5) * TREE_AREA * 2;
    if (hash01(Math.floor(x / 120), Math.floor(y / 120)) < 0.45) continue;
    if (terrain.water(x, y)) continue;
    const s = 1.1 + hash01(x, y) * 1.1;
    const color = new THREE.Color().setHSL(0.27 + (s - 1.6) * 0.04, 0.42, 0.32 + hash01(y, x) * 0.1);
    const h = terrain.height(x, y);
    spots.push({ x, y, h, s, color, wild: !buildable(terrain, { x, y }) });
  }
  const start = spots.length;
  for (let k = 0; spots.length - start < HILL_TREES && k < HILL_TREES * 12; k++) {
    const x = (hash01(k, 7) - 0.5) * HALF_MAP * 2;
    const y = (hash01(7, k) - 0.5) * HALF_MAP * 2;
    const h = terrain.height(x, y);
    // Thick on the hills and lower slopes, thinning out to bare rock near the peaks
    if (h < 3 || h > 360 || hash01(x * 0.7, y * 0.7) > 0.9 - h / 450) continue;
    const s = 1.5 + hash01(x, y) * 1.3;
    const color = new THREE.Color().setHSL(0.3 + hash01(y, x) * 0.05, 0.38, 0.24 + hash01(x, x) * 0.08);
    spots.push({ x, y, h, s, color, wild: true });
  }
  // Beyond the old square (Pingtung's far side): groves on the plain, forest on the hills and the range
  const b = terrain.bounds;
  const outer = spots.length;
  for (let k = 0; spots.length - outer < OUTER_TREES && k < OUTER_TREES * 12; k++) {
    const x = b.minX + hash01(k, 11) * (b.maxX - b.minX);
    const y = b.minY + hash01(11, k) * (b.maxY - b.minY);
    if (Math.abs(x) <= HALF_MAP && Math.abs(y) <= HALF_MAP) continue;
    if (terrain.region(x, y) === null || terrain.water(x, y)) continue;
    const h = terrain.height(x, y);
    if (h < 3 ? hash01(Math.floor(x / 120), Math.floor(y / 120)) < 0.6 : h > 360 || hash01(x * 0.7, y * 0.7) > 0.9 - h / 450) continue;
    const s = 1.2 + hash01(x, y) * 1.3;
    const color = new THREE.Color().setHSL(0.29 + hash01(y, x) * 0.05, 0.4, 0.25 + hash01(x, x) * 0.09);
    spots.push({ x, y, h, s, color, wild: !buildable(terrain, { x, y }) });
  }
  return spots;
}

import * as THREE from 'three';
import { hash01 } from '../sim/geometry';
import { type Terrain, buildable } from '../sim/terrain';

export const MAP_SIZE = 4000;
const GRID = 200;
/** trees in the lowland woods, and on hills and mountains */
export const LOWLAND_TREES = 6000;
export const HILL_TREES = 6000;
const TREE_AREA = 1400;

const GRASS = new THREE.Color(0x9cbf74);
const SAND = new THREE.Color(0xd9c894);
const SEABED = new THREE.Color(0x8f9478);
const HILL = new THREE.Color(0x76a052);
const FOREST = new THREE.Color(0x4d7a3c);
const ROCK = new THREE.Color(0x8d8b7c);
const PEAK = new THREE.Color(0xc4c0b2);

function landColor(h: number, out: THREE.Color): THREE.Color {
  if (h < -2.5) return out.copy(SEABED);
  if (h < 0) return out.copy(SAND);
  if (h < 0.05) return out.copy(GRASS);
  if (h < 50) return out.copy(GRASS).lerp(HILL, h / 50);
  if (h < 180) return out.copy(HILL).lerp(FOREST, (h - 50) / 130);
  if (h < 330) return out.copy(FOREST).lerp(ROCK, (h - 180) / 150);
  return out.copy(ROCK).lerp(PEAK, Math.min(1, (h - 330) / 120));
}

/** The ground as flat-coloured low-poly triangles; each triangle is coloured by its lowest corner, so coasts get a sandy rim. */
export function buildGroundGeometry(terrain: Terrain): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, GRID, GRID).rotateX(-Math.PI / 2).toNonIndexed();
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrain.height(pos.getX(i), pos.getZ(i)));
  const colors: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    const lo = Math.min(pos.getY(i), pos.getY(i + 1), pos.getY(i + 2));
    const hi = Math.max(pos.getY(i), pos.getY(i + 1), pos.getY(i + 2));
    landColor(lo < 0 ? lo : (lo + hi) / 2, c);
    const v = hash01(pos.getX(i) + pos.getX(i + 1), pos.getZ(i) + pos.getZ(i + 2));
    c.offsetHSL((v - 0.5) * 0.02, 0, (v - 0.5) * 0.03);
    for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
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
    const x = (hash01(k, 7) - 0.5) * MAP_SIZE;
    const y = (hash01(7, k) - 0.5) * MAP_SIZE;
    const h = terrain.height(x, y);
    // Thick on the hills and lower slopes, thinning out to bare rock near the peaks
    if (h < 3 || h > 360 || hash01(x * 0.7, y * 0.7) > 0.9 - h / 450) continue;
    const s = 1.5 + hash01(x, y) * 1.3;
    const color = new THREE.Color().setHSL(0.3 + hash01(y, x) * 0.05, 0.38, 0.24 + hash01(x, x) * 0.08);
    spots.push({ x, y, h, s, color, wild: true });
  }
  return spots;
}

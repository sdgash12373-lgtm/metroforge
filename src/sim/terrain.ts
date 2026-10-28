import type { Vec2 } from './geometry';

/** Water surface height; land below this is sea, river or lake bed. */
export const WATER_LEVEL = -0.8;

/**
 * The land a city stands on. Streets, zoning and airports need flat dry land (height 0); viaducts
 * may cross water and low ground, and tunnels go anywhere.
 */
export interface Terrain {
  readonly name: TerrainName;
  /** ground height in meters at a point: 0 on the plain, negative under water */
  height(x: number, y: number): number;
  water(x: number, y: number): boolean;
  /** open sea and lagoons, not rivers: ports stand on its shore */
  sea(x: number, y: number): boolean;
  /** which part of the map a point is in, or null off the map */
  region(x: number, y: number): RegionName | null;
  /** the map's extent, for the ground, the trees and the camera */
  readonly bounds: Bounds;
}

export type TerrainName = 'flat' | 'kaohsiung';

/** Parts of the map a city opens one at a time: Kaohsiung, and Pingtung across the Gaoping River. */
export type RegionName = 'kaohsiung' | 'pingtung';

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Half the width of the original square map. */
export const HALF_MAP = 2000;

const SQUARE: Bounds = { minX: -HALF_MAP, maxX: HALF_MAP, minY: -HALF_MAP, maxY: HALF_MAP };
const inSquare = (x: number, y: number) => Math.abs(x) <= HALF_MAP && Math.abs(y) <= HALF_MAP;

export const FLAT: Terrain = {
  name: 'flat',
  height: () => 0,
  water: () => false,
  sea: () => false,
  region: (x, y) => (inSquare(x, y) ? 'kaohsiung' : null),
  bounds: SQUARE,
};

/** Flat dry land, where streets and buildings can go. */
export function buildable(t: Terrain, p: Vec2): boolean {
  return !t.water(p.x, p.y) && t.height(p.x, p.y) <= 0.05;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise in 0..1. */
function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number): number {
  return noise(x, y) * 0.55 + noise(x * 2.1 + 5.2, y * 2.1 + 1.3) * 0.3 + noise(x * 4.3 + 9.1, y * 4.3 + 7.7) * 0.15;
}

/** A hill shaped like an ellipse turned along the coast (axes in u, v). */
function hill(u: number, v: number, cu: number, cv: number, ru: number, rv: number, peak: number): number {
  const d = ((u - cu) / ru) ** 2 + ((v - cv) / rv) ** 2;
  return d >= 1 ? 0 : peak * (1 - d) ** 1.5;
}

const S = Math.SQRT1_2;

/** Pingtung reaches this far along the coast (v) and up and down the plain (u). */
const PINGTUNG = { v: 3900, u: 2400 };

/**
 * Southern Taiwan in turned axes: u runs south-west → north-east (inland, roughly real north), v runs
 * north-west → south-east (along the coast, roughly real east).
 *
 * Kaohsiung (the original square, up to the Gaoping River) is a long strip from the Taiwan Strait up to
 * high mountains: the city starts on the coastal plain; a coastal hill like Shoushan and a ridge like
 * Banping Mountain rise out of it, low hills climb towards the mountains, and the Gaoping River runs down
 * its south-east side to the sea.
 *
 * Pingtung lies across the river, modelled on the real county: the wide flat Pingtung Plain reaching far
 * inland along the river, the Central Range with Dawu Mountain walling it in on the east and running
 * down to the sea in the south, the Donggang and Linbian rivers, Dapeng Bay's lagoon beside Donggang, a
 * coast that bends away south-east, and Xiaoliuqiu out at sea.
 */
export const KAOHSIUNG: Terrain = {
  name: 'kaohsiung',
  height(x, y) {
    const u = (x - y) * S;
    const v = (x + y) * S;
    return v < riverCentre(u) ? kaohsiungHeight(x, y, u, v) : pingtungHeight(x, y, u, v);
  },
  water(x, y) {
    const u = (x - y) * S;
    const v = (x + y) * S;
    if (v < riverCentre(u)) return seaDepth(u, v) > 0 || riverDepth(u, v) > 0;
    return pingtungSea(u, v) || riverDepth(u, v) > 0 || pingtungRivers(u, v) > 0;
  },
  sea(x, y) {
    const u = (x - y) * S;
    const v = (x + y) * S;
    return v < riverCentre(u) ? seaDepth(u, v) > 0 : pingtungSea(u, v);
  },
  region(x, y) {
    const u = (x - y) * S;
    const v = (x + y) * S;
    if (v < riverCentre(u)) return inSquare(x, y) ? 'kaohsiung' : null;
    return inSquare(x, y) || (v <= PINGTUNG.v && Math.abs(u) <= PINGTUNG.u) ? 'pingtung' : null;
  },
  // The square plus the Pingtung band to its south-east
  bounds: { minX: -HALF_MAP, minY: -HALF_MAP, maxX: (PINGTUNG.u + PINGTUNG.v) * S, maxY: (PINGTUNG.u + PINGTUNG.v) * S },
};

function kaohsiungHeight(x: number, y: number, u: number, v: number): number {
  const sea = seaDepth(u, v);
  if (sea > 0) return -Math.min(7, 1 + sea * 0.12);
  const river = riverDepth(u, v);
  if (river > 0) return -Math.min(5, 1 + river * 0.15);
  let h = 0;
  // Low hills, then mountains climbing steeply inland
  const hills = 380 + 80 * (noise(v / 420, 3.7) - 0.5);
  if (u > hills) h += smooth(hills, hills + 160, u) * (14 + 36 * fbm(x / 170, y / 170));
  const mountains = 760 + 120 * (noise(v / 500, 8.1) - 0.5);
  if (u > mountains) {
    const k = (u - mountains) / 1200;
    const ridges = 0.55 + 0.45 * fbm(x / 240, y / 240) + 0.25 * Math.abs(Math.sin(v / 140 + fbm(x / 400, y / 400) * 4));
    h += 640 * k ** 1.15 * ridges;
  }
  // Coastal hill and a lone ridge on the plain
  h += hill(u, v, -1010, -520, 130, 340, 62) * (0.8 + 0.4 * noise(x / 60, y / 60));
  h += hill(u, v, -420, -1080, 55, 230, 34) * (0.85 + 0.3 * noise(x / 50, y / 50));
  return h < 0.4 ? 0 : h;
}

/** How far into the sea a point lies (≤ 0 on land). */
function seaDepth(u: number, v: number): number {
  const coast = -1180 + 90 * Math.sin(v / 260) + 55 * Math.sin(v / 97 + 1) + 40 * (noise(v / 180, 1.5) - 0.5);
  return coast - u;
}

/** The Gaoping River's middle line: the border between Kaohsiung and Pingtung. */
function riverCentre(u: number): number {
  return 1080 + 75 * Math.sin(u / 230) + 35 * Math.sin(u / 87 + 2);
}

/** How far inside the Gaoping River a point lies (≤ 0 off it). */
function riverDepth(u: number, v: number): number {
  const half = 30 + 14 * smooth(400, -1200, u);
  return half - Math.abs(v - riverCentre(u));
}

/** Pingtung's coast: past the river mouth it bends away to the south-east, towards Fangliao. */
function pingtungCoast(v: number): number {
  return seaDepth(0, v) - 0.35 * Math.max(0, v - 1150) - 25 * smooth(2300, 2700, v);
}

/** Xiaoliuqiu: a small coral island out at sea off Donggang. */
const LIUQIU = { u: -2180, v: 2260, ru: 75, rv: 130 };
/** Dapeng Bay: a lagoon just south-east of Donggang, open to the sea by a narrow mouth. */
const DAPENG = { u: -1390, v: 2470, ru: 105, rv: 190 };

const ellipse = (u: number, v: number, e: { u: number; v: number; ru: number; rv: number }) => ((u - e.u) / e.ru) ** 2 + ((v - e.v) / e.rv) ** 2;

function pingtungSea(u: number, v: number): boolean {
  if (ellipse(u, v, LIUQIU) < 1) return false;
  if (ellipse(u, v, DAPENG) < 1) return true;
  // Mouth of the lagoon
  if (Math.abs(v - (DAPENG.v - 120)) < 14 && u < DAPENG.u && u > pingtungCoast(v) - 5) return true;
  return u < pingtungCoast(v);
}

/** Donggang River: down the middle of the plain to the sea at Donggang. */
function donggangCentre(u: number): number {
  return 2190 + 70 * Math.sin(u / 300) + 0.17 * (u + 1500);
}

/** Linbian River: straight out of the mountains in the east (along v), down to the sea at Linbian. */
function linbianCentre(v: number): number {
  return -1750 + (v - 2900) / 2.5 + 30 * Math.sin(v / 120);
}

/** How far inside the Donggang or Linbian river a point lies (≤ 0 off both). */
function pingtungRivers(u: number, v: number): number {
  const dong = (16 + 10 * smooth(0, -1500, u)) * smooth(1700, 1300, u) - Math.abs(v - donggangCentre(u));
  const lin = (14 + 12 * smooth(3100, 2850, v)) * smooth(3600, 3300, v) - Math.abs(u - linbianCentre(v));
  return Math.max(dong, lin);
}

/** Where the Central Range rises out of the plain, nearer the sea in the south. */
function rangeFront(u: number): number {
  return 3020 - 0.12 * u + 90 * (noise(u / 500, 4.4) - 0.5);
}

function pingtungHeight(x: number, y: number, u: number, v: number): number {
  const island = ellipse(u, v, LIUQIU);
  if (island < 1) return Math.max(0.6, 22 * (1 - island) ** 0.7 * (0.8 + 0.3 * noise(x / 40, y / 40)));
  if (pingtungSea(u, v)) {
    if (ellipse(u, v, DAPENG) < 1.2) return -2.5;
    return -Math.min(7, 1 + (pingtungCoast(v) - u) * 0.12);
  }
  const river = Math.max(riverDepth(u, v), pingtungRivers(u, v));
  if (river > 0) return -Math.min(5, 1 + river * 0.15);
  let h = 0;
  // Foothills, then the Central Range climbing steeply eastwards, Dawu Mountain highest
  const front = rangeFront(u);
  if (v > front - 140) h += smooth(front - 140, front, v) * (10 + 30 * fbm(x / 160, y / 160));
  if (v > front) {
    const k = (v - front) / 900;
    const ridges = 0.55 + 0.45 * fbm(x / 230, y / 230) + 0.25 * Math.abs(Math.sin(u / 150 + fbm(x / 400, y / 400) * 4));
    h += 820 * k ** 1.1 * ridges;
    h += hill(u, v, 250, 3750, 520, 360, 260);
  }
  // Up the river the plain closes in between hills and the mountains
  const hills = 1500 + 100 * (noise(v / 400, 6.2) - 0.5);
  if (u > hills) h += smooth(hills, hills + 200, u) * (16 + 40 * fbm(x / 170, y / 170));
  const mountains = 1950 + 120 * (noise(v / 500, 2.9) - 0.5);
  if (u > mountains) h += 640 * ((u - mountains) / 1200) ** 1.15 * (0.55 + 0.45 * fbm(x / 240, y / 240));
  return h < 0.4 ? 0 : h;
}

export const TERRAINS: Record<TerrainName, Terrain> = { flat: FLAT, kaohsiung: KAOHSIUNG };

/** Display names of the regions. */
export const REGION_NAMES: Record<RegionName, string> = { kaohsiung: '高雄區', pingtung: '屏東區' };

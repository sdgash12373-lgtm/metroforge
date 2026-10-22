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
}

export type TerrainName = 'flat' | 'kaohsiung';

export const FLAT: Terrain = { name: 'flat', height: () => 0, water: () => false };

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

/**
 * Modelled on Kaohsiung: a long strip running from the Taiwan Strait in the south-west up to high
 * mountains in the north-east. The city starts on the coastal plain; a coastal hill like Shoushan
 * and a ridge like Banping Mountain rise out of it, low hills climb towards the mountains, and a
 * river like the Gaoping runs down the south-east side to the sea.
 *
 * Works in turned axes: u runs south-west → north-east (inland), v runs north-west → south-east.
 */
export const KAOHSIUNG: Terrain = {
  name: 'kaohsiung',
  height(x, y) {
    const u = (x - y) * S;
    const v = (x + y) * S;
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
  },
  water(x, y) {
    const u = (x - y) * S;
    const v = (x + y) * S;
    return seaDepth(u, v) > 0 || riverDepth(u, v) > 0;
  },
};

/** How far into the sea a point lies (≤ 0 on land). */
function seaDepth(u: number, v: number): number {
  const coast = -1180 + 90 * Math.sin(v / 260) + 55 * Math.sin(v / 97 + 1) + 40 * (noise(v / 180, 1.5) - 0.5);
  return coast - u;
}

/** How far inside the river a point lies (≤ 0 off it). */
function riverDepth(u: number, v: number): number {
  const centre = 1080 + 75 * Math.sin(u / 230) + 35 * Math.sin(u / 87 + 2);
  const half = 30 + 14 * smooth(400, -1200, u);
  return half - Math.abs(v - centre);
}

export const TERRAINS: Record<TerrainName, Terrain> = { flat: FLAT, kaohsiung: KAOHSIUNG };

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
  /** the regions this land has */
  readonly regions: RegionName[];
}

export type TerrainName = 'flat' | 'plain' | 'kaohsiung' | 'flat-classic' | 'kaohsiung-classic';

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
  regions: ['kaohsiung'],
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
/** The Hengchun Peninsula's part of the map: south (u) to past Eluanbi, along v from the west sea to the Pacific. */
const HENGCHUN = { u: -5300, minV: 2400, maxV: 4400 };

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
    if (inSquare(x, y) || (v <= PINGTUNG.v && Math.abs(u) <= PINGTUNG.u)) return 'pingtung';
    // The Hengchun Peninsula, reaching south to Eluanbi with the Pacific on its east
    return u >= HENGCHUN.u && u < -PINGTUNG.u + 800 && v >= HENGCHUN.minV && v <= HENGCHUN.maxV ? 'pingtung' : null;
  },
  // The square, the Pingtung band to its south-east and the Hengchun Peninsula to the south
  bounds: {
    minX: (HENGCHUN.u + HENGCHUN.minV) * S,
    minY: -HALF_MAP,
    maxX: (PINGTUNG.u + PINGTUNG.v) * S,
    maxY: (HENGCHUN.maxV - HENGCHUN.u) * S,
  },
  regions: ['kaohsiung', 'pingtung'],
};

function kaohsiungHeight(x: number, y: number, u: number, v: number): number {
  const sea = seaDepth(u, v);
  if (sea > 0) return -Math.min(7, 1 + sea * 0.12);
  const river = riverDepth(u, v);
  if (river > 0) return -Math.min(5, 1 + river * 0.15);
  const h = kaohsiungLand(x, y, u, v);
  return h < 0.4 ? 0 : h;
}

/** Kaohsiung's hills and mountains, before the sea and river are cut in. */
function kaohsiungLand(x: number, y: number, u: number, v: number): number {
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
  return h;
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

/**
 * The Hengchun Peninsula: from Fangliao the west coast runs south past Fenggang, Checheng and Haikou to
 * Maobitou; Nanwan bay curves between Maobitou and Eluanbi at the tip; the Pacific coast runs back north
 * past Jialeshui, Manzhou, Jiupeng and Xuhai.
 */
function peninsulaWest(u: number): number {
  const t = Math.max(0, -1850 - u);
  return (
    2760 + 0.08 * t + 25 * Math.sin(t / 170) + 30 * (noise(u / 160, 7.3) - 0.5) +
    45 * Math.exp(-(((u + 3350) / 200) ** 2)) -
    80 * Math.exp(-(((u + 4250) / 380) ** 2)) -
    45 * Math.exp(-(((u + 4900) / 130) ** 2))
  );
}

function peninsulaEast(u: number): number {
  return 3860 + 0.1 * Math.min(3200, Math.max(0, u + 5050)) + 30 * Math.sin(u / 210) + 25 * (noise(u / 180, 2.6) - 0.5);
}

/** The south coast: Maobitou, round Nanwan bay to Eluanbi. */
function peninsulaSouth(v: number): number {
  const t = Math.max(0, Math.min(1, (v - 2930) / (3820 - 2930)));
  return -4960 + 300 * Math.sin(Math.PI * t) ** 1.4 - 70 * Math.exp(-(((v - 3820) / 90) ** 2)) + 15 * Math.sin(v / 60);
}

/** How far out to sea from the peninsula a point lies (≤ 0 on it). */
function peninsulaOut(u: number, v: number): number {
  return Math.max(peninsulaWest(u) - v, v - peninsulaEast(u), peninsulaSouth(v) - u);
}

/** How far out to sea a point in Pingtung lies (≤ 0 on land). */
function pingtungSeaDepth(u: number, v: number): number {
  // The Pacific, east of the peninsula and of the range to its north
  const pacific = v - peninsulaEast(u);
  if (pacific > 0) return pacific;
  const west = pingtungCoast(v) - u;
  return west > 0 ? Math.min(west, peninsulaOut(u, v)) : west;
}

function pingtungSea(u: number, v: number): boolean {
  if (ellipse(u, v, LIUQIU) < 1) return false;
  if (ellipse(u, v, DAPENG) < 1) return true;
  // Mouth of the lagoon
  if (Math.abs(v - (DAPENG.v - 120)) < 14 && u < DAPENG.u && u > pingtungCoast(v) - 5) return true;
  return pingtungSeaDepth(u, v) > 0;
}

/** Longluan Lake: a freshwater lake on the Hengchun plain. */
const LONGLUAN = { u: -4380, v: 3020, ru: 95, rv: 60 };

/** Donggang River: down the middle of the plain to the sea at Donggang. */
function donggangCentre(u: number): number {
  return 2190 + 70 * Math.sin(u / 300) + 0.17 * (u + 1500);
}

/** Linbian River: straight out of the mountains in the east (along v), down to the sea at Linbian. */
function linbianCentre(v: number): number {
  return -1750 + (v - 2900) / 2.5 + 30 * Math.sin(v / 120);
}

/** How far inside one of Pingtung's rivers or Longluan Lake a point lies (≤ 0 off them). */
function pingtungRivers(u: number, v: number): number {
  const dong = (16 + 10 * smooth(0, -1500, u)) * smooth(1700, 1300, u) - Math.abs(v - donggangCentre(u));
  const lin = (14 + 12 * smooth(3100, 2850, v)) * smooth(3600, 3300, v) - Math.abs(u - linbianCentre(v));
  // Sichong River out of the hills to the sea at Checheng, and the Gangkou River down to the Pacific
  const sichong = 11 * smooth(3450, 3300, v) - Math.abs(u - (-3350 + 25 * Math.sin(v / 90)));
  const gangkou = 10 * smooth(3650, 3780, v) - Math.abs(u - (-4150 + 20 * Math.sin(v / 70) + 0.2 * (v - 3800)));
  const lake = 40 * (1 - ellipse(u, v, LONGLUAN));
  return Math.max(dong, lin, sichong, gangkou, lake);
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
    return -Math.min(7, 1 + Math.max(0, pingtungSeaDepth(u, v)) * 0.12);
  }
  const river = Math.max(riverDepth(u, v), pingtungRivers(u, v));
  if (river > 0) return -Math.min(5, 1 + river * 0.15);
  // Near the Gaoping River the hills and mountains carry on from the Kaohsiung bank, then give way
  // to Pingtung's own; in the south the Central Range runs on down the peninsula
  const fromKaohsiung = 1 - smooth(riverCentre(u), riverCentre(u) + 650, v);
  const south = smooth(-1750, -2500, u);
  let h = (1 - south) * plainHeight(x, y, u, v) + south * peninsulaHeight(x, y, u, v);
  if (fromKaohsiung > 0) h = fromKaohsiung * kaohsiungLand(x, y, u, v) + (1 - fromKaohsiung) * h;
  return h < 0.4 ? 0 : h;
}

/** The Hengchun Peninsula's hills: the range's tail down its east side, the Hengchun plain, Kenting. */
function peninsulaHeight(x: number, y: number, u: number, v: number): number {
  // The spine drifts east and sinks southwards, leaving the Hengchun plain open on the west
  const spine = 3420 + 280 * smooth(-3500, -4300, u);
  const half = 620 - 230 * smooth(-3500, -4300, u);
  const peak = 520 * smooth(-4300, -2000, u) ** 1.3 + 45;
  const across = 1 - ((v - spine) / half) ** 2;
  let h = 0;
  if (across > 0) {
    const ridges = 0.55 + 0.45 * fbm(x / 210, y / 210) + 0.25 * Math.abs(Math.sin(u / 140 + fbm(x / 380, y / 380) * 4));
    h += peak * across ** 1.2 * ridges;
  }
  // Dajianshan above Kenting, the Sheding plateau, a low hill at Maobitou
  h += hill(u, v, -4600, 3480, 140, 120, 58) * (0.85 + 0.3 * noise(x / 40, y / 40));
  h += hill(u, v, -4760, 3660, 200, 170, 32) * (0.8 + 0.4 * noise(x / 60, y / 60));
  h += hill(u, v, -4880, 2990, 80, 60, 18);
  return h;
}

/** The Pingtung Plain with the Central Range on its east and hills up the river. */
function plainHeight(x: number, y: number, u: number, v: number): number {
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
  return h;
}

/**
 * Before v3.0.0 the map had no edge for building, only for the camera (its middle stayed within the
 * square), so old saves can reach a little past the square. The classic terrains below keep that land.
 */
const LEGACY_REACH = HALF_MAP + 600;
const nearSquare = (x: number, y: number) => Math.abs(x) <= LEGACY_REACH && Math.abs(y) <= LEGACY_REACH;

/**
 * The 平地 map since v3.1.0: still mostly open plain around where the city starts, with mountains rising
 * in the north and north-east, a river running down from them to the sea, a lake, two lone hills, and
 * the sea along the west and south. Saves from before keep the all-flat FLAT map.
 */
export const PLAIN: Terrain = {
  name: 'plain',
  height: (x, y) => plainMapHeight(x, y),
  water: (x, y) => plainSea(x, y) > 0 || plainRiver(x, y) > 0 || plainLake(x, y) > 0,
  sea: (x, y) => plainSea(x, y) > 0,
  region: (x, y) => (inSquare(x, y) ? 'kaohsiung' : null),
  bounds: SQUARE,
  regions: ['kaohsiung'],
};

/** How far out to sea a point on the 平地 map lies (≤ 0 on land): the west coast, the south coast and a bay between. */
function plainSea(x: number, y: number): number {
  const west = -1480 + 85 * Math.sin(y / 310) + 45 * Math.sin(y / 113 + 2) + 50 * (noise(y / 200, 4.4) - 0.5);
  const south = 1560 + 70 * Math.sin(x / 290 + 1) + 40 * Math.sin(x / 97) + 45 * (noise(x / 210, 6.2) - 0.5);
  // A sheltered bay biting into the south coast, a good spot for a harbour
  const bay = 1 - Math.hypot((x + 250) / 260, (y - 1560) / 300);
  return Math.max(west - x, y - south, bay * 120);
}

/** The river's middle line: from the mountains in the north-east, south-west across the plain to the south coast. */
function plainRiverCentre(y: number): number {
  // A wide bend east around the plain south of town, where old flat cities put their airports
  const bend = 300 * smooth(450, 650, y) * (1 - smooth(980, 1150, y));
  return 1300 - 0.42 * (y + HALF_MAP) + 95 * Math.sin(y / 240) + 40 * Math.sin(y / 97 + 1) + bend;
}

/** How far inside the river a point lies (≤ 0 off it). */
function plainRiver(x: number, y: number): number {
  const half = 16 + 22 * smooth(-1200, 1400, y);
  return half - Math.abs(x - plainRiverCentre(y));
}

/** A lake on the plain south-west of town. */
const PLAIN_LAKE = { x: -1020, y: 980, rx: 170, ry: 110 };

function plainLake(x: number, y: number): number {
  const d = Math.hypot((x - PLAIN_LAKE.x) / PLAIN_LAKE.rx, (y - PLAIN_LAKE.y) / PLAIN_LAKE.ry) * (0.92 + 0.16 * noise(x / 60, y / 60));
  return (1 - d) * Math.min(PLAIN_LAKE.rx, PLAIN_LAKE.ry);
}

function plainMapHeight(x: number, y: number): number {
  const sea = plainSea(x, y);
  if (sea > 0) return -Math.min(7, 1 + sea * 0.12);
  const river = plainRiver(x, y);
  if (river > 0) return -Math.min(5, 1 + river * 0.15);
  const lake = plainLake(x, y);
  if (lake > 0) return -Math.min(4, 1 + lake * 0.1);
  // How far towards the mountains (north and north-east; north is -y)
  const m = -0.8 * y + 0.6 * x;
  let h = 0;
  const hills = 950 + 120 * (noise(x / 450, 2.9) - 0.5);
  if (m > hills) h += smooth(hills, hills + 220, m) * (12 + 34 * fbm(x / 170, y / 170));
  const mountains = 1350 + 150 * (noise(x / 520, 7.4) - 0.5);
  if (m > mountains) {
    const k = (m - mountains) / 1100;
    const ridges = 0.55 + 0.45 * fbm(x / 240, y / 240) + 0.25 * Math.abs(Math.sin(x / 150 + fbm(x / 400, y / 400) * 4));
    h += 560 * k ** 1.15 * ridges;
  }
  // The river cuts a valley down through the hills and mountains
  h *= smooth(20, 170, Math.abs(x - plainRiverCentre(y)));
  // A coastal hill in the north-west and a lone hill east of town
  h += hill(x, y, -1250, -900, 150, 260, 58) * (0.8 + 0.4 * noise(x / 60, y / 60));
  h += hill(x, y, 980, 560, 200, 150, 42) * (0.85 + 0.3 * noise(x / 50, y / 50));
  return h < 0.4 ? 0 : h;
}

/** The flat map as it was before v3.0.0: no edge to build up to. Old saves that built past the square load onto it. */
export const FLAT_CLASSIC: Terrain = { ...FLAT, name: 'flat-classic', region: () => 'kaohsiung' };

/**
 * Kaohsiung as it was before v3.0.0 near the original square (the old ground carries on past the
 * Gaoping River and a little past the square's edge), with the new Pingtung only beyond it. Saves from
 * then that built across the river or past the edge load onto this, so the rivers and coast of the new
 * Pingtung or the map's edge don't take away what they built.
 */
export const KAOHSIUNG_CLASSIC: Terrain = {
  ...KAOHSIUNG,
  name: 'kaohsiung-classic',
  height(x, y) {
    if (!nearSquare(x, y)) return KAOHSIUNG.height(x, y);
    return kaohsiungHeight(x, y, (x - y) * S, (x + y) * S);
  },
  water(x, y) {
    if (!nearSquare(x, y)) return KAOHSIUNG.water(x, y);
    const u = (x - y) * S;
    const v = (x + y) * S;
    return seaDepth(u, v) > 0 || riverDepth(u, v) > 0;
  },
  sea(x, y) {
    if (!nearSquare(x, y)) return KAOHSIUNG.sea(x, y);
    return seaDepth((x - y) * S, (x + y) * S) > 0;
  },
  region(x, y) {
    const r = KAOHSIUNG.region(x, y);
    if (r || !nearSquare(x, y)) return r;
    return (x + y) * S < riverCentre((x - y) * S) ? 'kaohsiung' : 'pingtung';
  },
};

export const TERRAINS: Record<TerrainName, Terrain> = {
  flat: FLAT,
  plain: PLAIN,
  kaohsiung: KAOHSIUNG,
  'flat-classic': FLAT_CLASSIC,
  'kaohsiung-classic': KAOHSIUNG_CLASSIC,
};

/** Display names of the regions. */
export const REGION_NAMES: Record<RegionName, string> = { kaohsiung: '高雄區', pingtung: '屏東區' };

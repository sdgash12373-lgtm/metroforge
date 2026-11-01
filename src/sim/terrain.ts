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

/** Parts of the map a city opens one at a time: Kaohsiung, Pingtung across the Gaoping River, Tainan and Chiayi up the coast, Penghu out at sea. */
export type RegionName = 'kaohsiung' | 'pingtung' | 'tainan' | 'chiayi' | 'penghu';

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
/** Answers per terrain, by x then y: the same lot and tree spots are asked about every time land is recounted. */
const buildableCache = new WeakMap<Terrain, Map<number, Map<number, boolean>>>();
const BUILDABLE_CACHE_MAX = 400_000;
let buildableCached = 0;

export function buildable(t: Terrain, p: Vec2): boolean {
  let byX = buildableCache.get(t);
  if (!byX) buildableCache.set(t, (byX = new Map()));
  let byY = byX.get(p.x);
  const hit = byY?.get(p.y);
  if (hit !== undefined) return hit;
  const ok = !t.water(p.x, p.y) && t.height(p.x, p.y) <= 0.05;
  // Lots and trees sit at fixed spots; other callers (the cursor, a road being drawn) ask once, so cap the cache
  if (buildableCached < BUILDABLE_CACHE_MAX) {
    if (!byY) byX.set(p.x, (byY = new Map()));
    byY.set(p.y, ok);
    buildableCached++;
  }
  return ok;
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
 * The Hengchun Peninsula's part of the map, in its own frame (see `hengchunFrame`): south (u) to past Eluanbi,
 * along v from the west sea to the Pacific; from `rootU` north it overlaps the Pingtung band it hangs from.
 */
const HENGCHUN = { u: -5300, minV: 2400, maxV: 4400, rootU: -1250 };
/**
 * The peninsula is drawn in a frame of its own (the u, v it was first laid out in, running straight out along -u)
 * and turned to where it really lies: hung from the coast past Fangliao (`at`), heading down the coast `turn`
 * radians seaward of it (real Taiwan's coast turns from running south-south-east past Kaohsiung to due south
 * down the peninsula) rather than straight out to sea.
 */
const HENGCHUN_TURN = { root: { u: -1850, v: 2760 }, at: { u: -2010, v: 3450 }, turn: (30 * Math.PI) / 180 };
const H_SIN = Math.sin(HENGCHUN_TURN.turn);
const H_COS = Math.cos(HENGCHUN_TURN.turn);

/** A map point (u, v) in the peninsula's frame; `along` is how far past its root down the peninsula. */
function hengchunFrame(u: number, v: number): { u: number; v: number; along: number } {
  const du = u - HENGCHUN_TURN.at.u;
  const dv = v - HENGCHUN_TURN.at.v;
  const along = -du * H_SIN + dv * H_COS;
  const across = du * H_COS + dv * H_SIN;
  return { u: HENGCHUN_TURN.root.u - along, v: HENGCHUN_TURN.root.v + across, along };
}

/** The map point at (u, v) of the peninsula's own frame. */
export function hengchunPoint(pu: number, pv: number): Vec2 {
  const along = HENGCHUN_TURN.root.u - pu;
  const across = pv - HENGCHUN_TURN.root.v;
  const u = HENGCHUN_TURN.at.u - along * H_SIN + across * H_COS;
  const v = HENGCHUN_TURN.at.v + along * H_COS + across * H_SIN;
  return { x: (u + v) * S + 0, y: (v - u) * S + 0 };
}

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
    if (v >= riverCentre(u)) return pingtungHeight(x, y, u, v);
    if (!inSquare(x, y)) {
      const f = northFrame(u, v);
      if (northward(f.s)) return northHeight(x, y, f.s, f.w, u, v);
    }
    return kaohsiungHeight(x, y, u, v);
  },
  water(x, y) {
    const u = (x - y) * S;
    const v = (x + y) * S;
    if (v >= riverCentre(u)) return pingtungSea(u, v) || riverDepth(u, v) > 0 || pingtungRivers(u, v) > 0;
    if (!inSquare(x, y)) {
      const f = northFrame(u, v);
      if (northward(f.s)) return northSea(x, y, f.s, f.w) || (penghuAt(x, y).d >= 1 && ovalAt(WAISANDING, x, y) >= 1 && northFresh(x, y) > 0);
    }
    return kaohsiungSea(u, v) || riverDepth(u, v) > 0;
  },
  sea(x, y) {
    const u = (x - y) * S;
    const v = (x + y) * S;
    if (v >= riverCentre(u)) return pingtungSea(u, v);
    if (!inSquare(x, y)) {
      const f = northFrame(u, v);
      if (northward(f.s)) return northSea(x, y, f.s, f.w);
    }
    return kaohsiungSea(u, v);
  },
  region(x, y) {
    const u = (x - y) * S;
    const v = (x + y) * S;
    if (v < riverCentre(u)) {
      if (inSquare(x, y)) return 'kaohsiung';
      const f = northFrame(u, v);
      return northRegion(x, y, f.s, f.w, v);
    }
    if (inSquare(x, y) || (v <= PINGTUNG.v && Math.abs(u) <= PINGTUNG.u)) return 'pingtung';
    // The Hengchun Peninsula, reaching south to Eluanbi with the Pacific on its east
    const h = hengchunFrame(u, v);
    return h.u >= HENGCHUN.u && h.u < HENGCHUN.rootU && h.v >= HENGCHUN.minV && h.v <= HENGCHUN.maxV ? 'pingtung' : null;
  },
  // The square, the Pingtung band to its south-east and the Hengchun Peninsula to the south, Tainan and Chiayi up
  // the coast to the north-west and Penghu out at sea
  get bounds() {
    return mapBounds();
  },
  regions: ['kaohsiung', 'pingtung', 'tainan', 'chiayi', 'penghu'],
};

let boundsCache: Bounds | null = null;
function mapBounds(): Bounds {
  if (boundsCache) return boundsCache;
  const b: Bounds = { minX: -HALF_MAP, minY: -HALF_MAP, maxX: (PINGTUNG.u + PINGTUNG.v) * S, maxY: HALF_MAP };
  const take = (p: Vec2) => {
    b.minX = Math.min(b.minX, p.x);
    b.maxX = Math.max(b.maxX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxY = Math.max(b.maxY, p.y);
  };
  // Round the Pingtung band, the Hengchun Peninsula, the north's strip, and Penghu's islands with the sea round them
  for (const [u, v] of [[-PINGTUNG.u, PINGTUNG.v], [PINGTUNG.u, PINGTUNG.v]]) take({ x: (u + v) * S, y: (v - u) * S });
  for (const pu of [HENGCHUN.u, HENGCHUN.rootU]) for (const pv of [HENGCHUN.minV, HENGCHUN.maxV]) take(hengchunPoint(pu, pv));
  for (let s = NORTH.s0; s <= NORTH_END; s += 50) {
    take(northPoint(s, NORTH_SEA));
    take(northPoint(s, table(NORTH_LAND, s)));
  }
  for (let w = NORTH_SEA; w <= 3400; w += 50) take(northPoint(NORTH_END, w));
  const pad = PENGHU_SEA / KM;
  for (const i of PENGHU_ISLES) {
    const r = Math.max(i.re, i.rn) + pad;
    for (const [e, n] of [[-r, -r], [r, -r], [-r, r], [r, r]]) take(penghuPoint(i.e + e, i.n + n));
  }
  b.minX = Math.floor(b.minX / 20) * 20;
  b.minY = Math.floor(b.minY / 20) * 20;
  b.maxX = Math.ceil(b.maxX / 20) * 20;
  b.maxY = Math.ceil(b.maxY / 20) * 20;
  boundsCache = b;
  return b;
}

function kaohsiungHeight(x: number, y: number, u: number, v: number): number {
  const sea = seaDepth(u, v);
  if (sea > 0) {
    const sand = cijin(u, v);
    if (sand > 0) return 1.2 + Math.min(1.6, sand * 0.05);
    return -Math.min(7, 1 + sea * 0.12);
  }
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

/**
 * Cijin (旗津): the long, narrow sand island off the city, from just south of the coastal hill (Xiziwan, where
 * the first harbour mouth is) down the coast to the second harbour mouth, with Kaohsiung Harbour between it and
 * the shore. How far inside it a point lies (≤ 0 off it).
 */
const CIJIN = { from: -230, to: 830, north: -1375, south: -1270, width: 80 };
function cijin(u: number, v: number): number {
  if (v <= CIJIN.from || v >= CIJIN.to) return 0;
  // Nearly straight, just off the headland at its north end, the harbour widening behind it as the shore bends in
  const t = (v - CIJIN.from) / (CIJIN.to - CIJIN.from);
  const mid = CIJIN.north + (CIJIN.south - CIJIN.north) * t + 6 * Math.sin(v / 150);
  const half = (CIJIN.width / 2) * (0.7 + 0.3 * Math.sin(Math.PI * t) ** 0.4) + 4 * (noise(v / 70, 9.2) - 0.5);
  const ends = Math.min(v - CIJIN.from, CIJIN.to - v);
  return Math.min(half - Math.abs(u - mid), ends);
}

/** Kaohsiung's sea, Cijin left out of it. */
function kaohsiungSea(u: number, v: number): boolean {
  return seaDepth(u, v) > 0 && cijin(u, v) <= 0;
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
  // The band down the plain: the strait on the west, the Pacific east of the range
  const band = Math.max(pingtungCoast(v) - u, v - peninsulaEast(Math.max(u, HENGCHUN_TURN.root.u)));
  // The peninsula hanging from its south end (its strip cut off a little way back into the band)
  const h = hengchunFrame(u, v);
  const cape = Math.max(peninsulaOut(h.u, h.v), -h.along - 400);
  return Math.min(band, cape);
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
  // Sichong River out of the hills to the sea at Checheng, and the Gangkou River down to the Pacific (in the
  // peninsula's frame)
  ({ u, v } = hengchunFrame(u, v));
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
  const cape = hengchunFrame(u, v);
  const south = smooth(-1750, -2500, cape.u);
  let h = (1 - south) * plainHeight(x, y, u, v) + south * peninsulaHeight(x, y, cape.u, cape.v);
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

/* ───────────── Up the coast: Tainan and Chiayi, and Penghu out in the strait ───────────── */

/**
 * North of the old square the coast bends round, as Taiwan's west coast does, from running north-west past
 * Kaohsiung to running (nearly) north past Tainan and Chiayi. Up there points are told by `s`, metres along the
 * coast northwards (going on from -v), and `w`, metres inland from the line the coast keeps to (about 120.15°E);
 * the strip bends round a centre inland, `r` away.
 */
const NORTH = { s0: 1650, uRef: -1180, r: 11000 };
const NORTH_CENTRE = { u: NORTH.uRef + NORTH.r, v: -NORTH.s0 };
/** How far out to sea and inland the two regions reach, and where Chiayi ends (just past the Beigang River). */
const NORTH_SEA = -800;
const NORTH_END = 6790;

function northFrame(u: number, v: number): { s: number; w: number } {
  if (v >= -NORTH.s0) return { s: -v, w: u - NORTH.uRef };
  const du = u - NORTH_CENTRE.u;
  const dv = v - NORTH_CENTRE.v;
  return { s: NORTH.s0 + NORTH.r * Math.atan2(-dv, -du), w: NORTH.r - Math.hypot(du, dv) };
}

/** The map point `s` along the northern coast and `w` inland of it. */
export function northPoint(s: number, w: number): Vec2 {
  let u = w + NORTH.uRef;
  let v = -s;
  if (s > NORTH.s0) {
    const phi = (s - NORTH.s0) / NORTH.r;
    const r = NORTH.r - w;
    u = NORTH_CENTRE.u - r * Math.cos(phi);
    v = NORTH_CENTRE.v - r * Math.sin(phi);
  }
  return { x: (u + v) * S + 0, y: (v - u) * S + 0 };
}

/** Unit vectors on the map pointing up the coast (north) and inland (east) at `s`. */
function northAxes(s: number): { n: Vec2; e: Vec2 } {
  const phi = Math.max(0, s - NORTH.s0) / NORTH.r;
  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  return { n: { x: (sn - c) * S, y: (-c - sn) * S }, e: { x: (c + sn) * S, y: (sn - c) * S } };
}

/** A place by latitude and longitude, at the map's scale (about 1:14.8, so 1 km is 67.6 m). */
export function geoPoint(lat: number, lon: number): Vec2 {
  return northPoint(1700 + (lat - 22.9) * 7500, (lon - 120.15) * 6925);
}

/** Linear through (x, y) pairs, flat beyond the ends. */
function table(pts: readonly (readonly [number, number])[], x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (x <= x1) {
      const [x0, y0] = pts[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

/**
 * Where the coast runs (w) along the north: from 茄萣 past 安平 to the bulge of 七股's sandbars and salt pans out
 * west, back in at 將軍 and 北門, then nearly straight up past 布袋 and 東石 to the 北港溪.
 */
const NORTH_COAST: [number, number][] = [
  [1650, 0], [2000, 30], [2400, 0], [2700, -60], [2900, -250], [3100, -420], [3300, -460], [3600, -390],
  [3900, -300], [4400, -260], [4900, -150], [5350, -60], [5900, -80], [6300, -60], [6900, -40],
];

/** Where the plain meets the hills (w): 新化's hills come in close behind Tainan, then the foothills draw back to 竹崎. */
const HILL_FRONT: [number, number][] = [
  [1650, 1560], [2000, 1560], [2400, 1400], [2750, 1400], [3500, 1500], [4000, 1650], [4600, 1850], [5000, 1950],
  [5600, 2400], [6100, 2500], [6900, 2650],
];
/** How far behind the hills the mountains rise, and how high: low in Tainan, the Alishan range in Chiayi. */
const MOUNTAIN_GAP: [number, number][] = [[1650, 400], [2600, 750], [4400, 700], [5300, 380]];
const MOUNTAIN_PEAK: [number, number][] = [[1650, 640], [2600, 520], [4400, 600], [5300, 1050]];
/** How far inland each part of the map goes. */
const NORTH_LAND: [number, number][] = [[1650, 3100], [5000, 3100], [5600, 3300]];

function northCoast(s: number): number {
  // The Kaohsiung coast's bays carry on a little way, then the sandy coast runs smoother
  const k = 0.35 + 0.65 * smooth(NORTH.s0 + 600, NORTH.s0, s);
  const v = -s;
  const bays = 90 * Math.sin(v / 260) + 55 * Math.sin(v / 97 + 1) + 40 * (noise(v / 180, 1.5) - 0.5);
  return table(NORTH_COAST, s) + k * bays;
}

/** A river: its line on the map, and how wide it is along it (half-widths at each point). */
interface River {
  pts: Vec2[];
  half: number[];
  /** hills and mountains are cut down into a valley this wide either side */
  valley: number;
  box: Bounds;
}

function river(pts: Vec2[], half: number[], valley = 170): River {
  const pad = Math.max(...half) + valley + 10;
  return {
    pts,
    half,
    valley,
    box: {
      minX: Math.min(...pts.map((p) => p.x)) - pad,
      maxX: Math.max(...pts.map((p) => p.x)) + pad,
      minY: Math.min(...pts.map((p) => p.y)) - pad,
      maxY: Math.max(...pts.map((p) => p.y)) + pad,
    },
  };
}

/** A river laid out by (s, w) points up north, with half-widths from the mouth to the last point. */
function northRiver(sw: [number, number][], mouth: number, source: number, valley = 170): River {
  const pts = sw.map(([s, w]) => northPoint(s, w));
  return river(pts, pts.map((_, i) => mouth + ((source - mouth) * i) / Math.max(1, pts.length - 1)), valley);
}

/** How far inside a river a point lies (≤ 0 off it), and how far from its middle line. */
function riverAt(r: River, x: number, y: number): { depth: number; d: number } {
  if (x < r.box.minX || x > r.box.maxX || y < r.box.minY || y > r.box.maxY) return { depth: -1e9, d: 1e9 };
  let best = 1e9;
  let half = 0;
  for (let i = 1; i < r.pts.length; i++) {
    const a = r.pts[i - 1];
    const b = r.pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
    if (d < best) {
      best = d;
      half = r.half[i - 1] + (r.half[i] - r.half[i - 1]) * t;
    }
  }
  // A gentle meander, so the banks aren't ruled lines
  const h = half * (0.85 + 0.3 * noise(x / 70, y / 70));
  return { depth: h - best, d: best - h };
}

/**
 * The rivers of the north, from the sea up: 二仁溪's mouth at Kaohsiung's edge, 鹽水溪 past 安平, 曾文溪 from the
 * 曾文 reservoir down past 玉井 and 西港 to the sea at 七股, 將軍溪, 急水溪, 八掌溪 between Tainan and Chiayi,
 * 朴子溪 past 嘉義 to 東石, and 北港溪 at the north edge.
 */
const ERREN = river([{ x: -2120, y: -120 }, { x: -2075, y: -700 }, { x: -2058, y: -1100 }, { x: -2050, y: -1250 }], [14, 12, 9, 4], 120);
const BAZHANG: [number, number][] = [[4960, -260], [5000, 100], [5150, 600], [5350, 1300], [5550, 1850], [5700, 2300], [5900, 2800], [6050, 3200], [6150, 3500]];
const NORTH_RIVERS: River[] = [
  ERREN,
  northRiver([[2470, -100], [2500, 250], [2560, 700], [2620, 1050], [2690, 1350]], 15, 7, 120),
  northRiver([[2900, -420], [3000, 0], [3150, 500], [3300, 1000], [3380, 1450], [3420, 2150], [3700, 2400], [4000, 2550], [4250, 2640]], 30, 13, 220),
  northRiver([[3870, -380], [3920, 0], [3980, 450]], 11, 6, 80),
  northRiver([[4470, -330], [4520, 100], [4600, 700], [4700, 1300], [4800, 1800], [4860, 2150]], 16, 8, 160),
  northRiver(BAZHANG, 20, 11, 200),
  northRiver([[5870, -150], [5900, 200], [5930, 700], [6050, 1400], [6200, 2050], [6400, 2700], [6550, 3200]], 15, 9, 180),
  northRiver([[6650, -120], [6680, 500], [6700, 1300], [6720, 2100], [6760, 2800], [6780, 3400]], 22, 12, 180),
];

/** An ellipse on the map, turned to the coast's lie where it is (radii along the coast and inland). */
interface Oval {
  c: Vec2;
  n: Vec2;
  e: Vec2;
  rn: number;
  re: number;
}

function northOval(s: number, w: number, rn: number, re: number): Oval {
  const { n, e } = northAxes(s);
  return { c: northPoint(s, w), n, e, rn, re };
}

/** 0 at the middle, 1 on the edge. */
function ovalAt(o: Oval, x: number, y: number): number {
  const dx = x - o.c.x;
  const dy = y - o.c.y;
  return ((dx * o.n.x + dy * o.n.y) / o.rn) ** 2 + ((dx * o.e.x + dy * o.e.y) / o.re) ** 2;
}

/** Reservoirs and ponds: 烏山頭 (珊瑚潭) at the foot of the hills, 曾文 up in the mountains, 蘭潭 and 仁義潭 by 嘉義, the 鰲鼓 wetland. */
const NORTH_LAKES: Oval[] = [
  northOval(3950, 1720, 120, 85),
  northOval(4060, 1790, 80, 55),
  northOval(3880, 1810, 70, 45),
  northOval(4300, 2650, 170, 65),
  northOval(4450, 2700, 120, 50),
  northOval(5990, 2420, 85, 55),
  northOval(5870, 2480, 90, 45),
  northOval(6250, 110, 95, 60),
];
/** 七股潟湖 behind its sandbars, and 四草's lagoon by 安平: sea water inside the coast. */
const NORTH_LAGOONS: Oval[] = [northOval(3330, -330, 270, 105), northOval(2610, 15, 60, 40)];
/** Gaps through 七股's sandbars, where the lagoon opens to the sea. */
const LAGOON_MOUTHS = [3150, 3480];
/** 外傘頂洲, the long shifting sandbar off 東石 and 布袋. */
const WAISANDING = northOval(5800, -600, 420, 32);

/** How far out to sea a point up north lies (≤ 0 on land). */
function northSeaDepth(s: number, w: number): number {
  return northCoast(s) - w;
}

function northSea(x: number, y: number, s: number, w: number): boolean {
  if (ovalAt(WAISANDING, x, y) < 1 || penghuAt(x, y).d < 1) return false;
  const depth = northSeaDepth(s, w);
  if (depth > 0) return true;
  for (const o of NORTH_LAGOONS) {
    if (ovalAt(o, x, y) < 1) return true;
  }
  // The lagoon's mouths through the bar
  if (s > 3000 && s < 3600 && w < northCoast(s) + 140 && LAGOON_MOUTHS.some((m) => Math.abs(s - m) < 12)) return true;
  return false;
}

/** How far inside a river or lake up north a point lies (≤ 0 off them). */
function northFresh(x: number, y: number): number {
  let best = -1e9;
  for (const r of NORTH_RIVERS) best = Math.max(best, riverAt(r, x, y).depth);
  for (const o of NORTH_LAKES) best = Math.max(best, 40 * (1 - ovalAt(o, x, y) * (0.9 + 0.2 * noise(x / 50, y / 50))));
  return best;
}

/** Tainan's and Chiayi's land: the 嘉南 plain, 新化's low hills and the badlands of 左鎮, the mountains behind, highest towards 阿里山. */
function northLand(x: number, y: number, s: number, w: number): number {
  let h = 0;
  const front = table(HILL_FRONT, s) + 80 * (noise(s / 420, 5.3) - 0.5);
  if (w > front) h += smooth(front, front + 180, w) * (12 + 34 * fbm(x / 170, y / 170));
  // 月世界: bare, gullied mudstone hills behind Tainan
  if (s > 1900 && s < 2900 && w > front + 150) h += 18 * smooth(1900, 2200, s) * smooth(2900, 2600, s) * Math.abs(Math.sin(x / 45 + 3 * fbm(x / 120, y / 120)));
  const mountains = front + table(MOUNTAIN_GAP, s) + 100 * (noise(s / 500, 9.4) - 0.5);
  if (w > mountains) {
    const k = (w - mountains) / (s > 5000 ? 800 : 1200);
    const ridges = 0.55 + 0.45 * fbm(x / 240, y / 240) + 0.25 * Math.abs(Math.sin(s / 140 + fbm(x / 400, y / 400) * 4));
    h += table(MOUNTAIN_PEAK, s) * k ** 1.15 * ridges;
  }
  // Valleys cut down to the rivers and round the reservoirs
  let cut = 1;
  for (const r of NORTH_RIVERS) {
    const at = riverAt(r, x, y);
    if (at.d < r.valley) cut = Math.min(cut, smooth(10, r.valley, at.d));
  }
  for (const o of NORTH_LAKES) {
    const d = ovalAt(o, x, y);
    if (d < 6) cut = Math.min(cut, smooth(1, 4.5, d));
  }
  return h * cut;
}

/* Penghu: the islands in the strait west of Chiayi, by their real shapes and places. */

/** Magong, the middle of Penghu: about 58 km off the coast, level with the 北港溪. */
const MAGONG = geoPoint(23.565, 119.57);
const PENGHU_AXES = northAxes(1700 + (23.565 - 22.9) * 7500);
/** Model metres per real km. */
const KM = 1000 / 14.8;

/** One island or part of one: centre east and north of Magong (km), half-lengths (km), turned (degrees). */
const PENGHU_ISLES: { e: number; n: number; re: number; rn: number; turn: number; name: string; mesa?: number }[] = [
  // 澎湖本島: the main body with 湖西 to the east and 嵵裡 to the south; Magong on its peninsula west into the bay,
  // 風櫃 at the tip; 北寮 along the north shore
  { e: 6.0, n: 0.0, re: 6.0, rn: 4.0, turn: 10, name: '本島' },
  { e: 11.5, n: 1.5, re: 1.6, rn: 2.5, turn: 0, name: '湖西' },
  { e: 2.8, n: -3.6, re: 2.0, rn: 1.4, turn: 0, name: '嵵裡' },
  { e: 0.2, n: 0.0, re: 2.6, rn: 1.0, turn: 30, name: '馬公' },
  { e: -2.0, n: -2.2, re: 1.6, rn: 0.6, turn: 55, name: '風櫃' },
  { e: 4.5, n: 3.8, re: 2.5, rn: 1.0, turn: 15, name: '北寮' },
  // 中屯 between it and 白沙, a short bridge either side
  { e: 2.5, n: 5.6, re: 0.9, rn: 0.5, turn: 0, name: '中屯' },
  // 白沙, with 通樑 at its west end
  { e: 3.0, n: 8.8, re: 3.8, rn: 1.6, turn: 5, name: '白沙' },
  { e: 1.5, n: 11.2, re: 1.8, rn: 1.2, turn: 0, name: '赤崁' },
  { e: 4.8, n: 10.4, re: 1.4, rn: 0.9, turn: 0, name: '後寮' },
  { e: -1.5, n: 8.6, re: 1.1, rn: 0.8, turn: 0, name: '通樑' },
  // 西嶼, long north-north-east across the bay from 外垵 to 小門; 跨海大橋 crosses from it to 通樑
  { e: -7.8, n: 4.0, re: 1.3, rn: 5.0, turn: -25, name: '西嶼' },
  { e: -9.9, n: -0.3, re: 1.4, rn: 1.2, turn: 0, name: '外垵' },
  { e: -5.4, n: 8.4, re: 1.2, rn: 1.0, turn: 0, name: '小門' },
  // Out islands
  { e: 2.5, n: 18.0, re: 1.6, rn: 1.1, turn: 0, name: '吉貝' },
  { e: 9.2, n: 10.5, re: 0.7, rn: 0.55, turn: 0, name: '鳥嶼' },
  { e: 8.2, n: 7.2, re: 0.6, rn: 0.5, turn: 0, name: '員貝' },
  { e: -5.1, n: -8.3, re: 1.3, rn: 0.6, turn: -10, name: '虎井', mesa: 8 },
  { e: -6.3, n: -6.6, re: 0.6, rn: 0.6, turn: 0, name: '桶盤', mesa: 12 },
  { e: -7.0, n: -22.7, re: 2.2, rn: 1.6, turn: 30, name: '望安' },
  { e: -4.3, n: -22.9, re: 0.9, rn: 0.6, turn: 0, name: '將軍澳' },
  { e: -14.0, n: -39.0, re: 2.0, rn: 1.4, turn: 10, name: '七美' },
];
/** The region takes in the sea this far (model metres) round the islands. */
const PENGHU_SEA = 200;

/** Magong-relative real km east and north of a map point. */
function penghuLocal(x: number, y: number): { e: number; n: number } {
  const dx = x - MAGONG.x;
  const dy = y - MAGONG.y;
  return { e: (dx * PENGHU_AXES.e.x + dy * PENGHU_AXES.e.y) / KM, n: (dx * PENGHU_AXES.n.x + dy * PENGHU_AXES.n.y) / KM };
}

/** The map point `e` km east and `n` km north of Magong. */
export function penghuPoint(e: number, n: number): Vec2 {
  return { x: MAGONG.x + (PENGHU_AXES.e.x * e + PENGHU_AXES.n.x * n) * KM, y: MAGONG.y + (PENGHU_AXES.e.y * e + PENGHU_AXES.n.y * n) * KM };
}

const PENGHU_BOX = (() => {
  let minE = Infinity;
  let maxE = -Infinity;
  let minN = Infinity;
  let maxN = -Infinity;
  const pad = PENGHU_SEA / KM;
  for (const i of PENGHU_ISLES) {
    const r = Math.max(i.re, i.rn) + pad;
    minE = Math.min(minE, i.e - r);
    maxE = Math.max(maxE, i.e + r);
    minN = Math.min(minN, i.n - r);
    maxN = Math.max(maxN, i.n + r);
  }
  return { minE, maxE, minN, maxN };
})();

/**
 * Nearest island and how far into it a point lies: `d` < 1 on land, by the islands' outlines with ragged
 * basalt shores; `out` is about how many metres off its shore.
 */
function penghuAt(x: number, y: number): { d: number; out: number; isle: (typeof PENGHU_ISLES)[number] | null } {
  const { e, n } = penghuLocal(x, y);
  const pad = PENGHU_SEA / KM;
  if (e < PENGHU_BOX.minE || e > PENGHU_BOX.maxE || n < PENGHU_BOX.minN || n > PENGHU_BOX.maxN) return { d: 99, out: 1e9, isle: null };
  let best = 99;
  let out = 1e9;
  let isle: (typeof PENGHU_ISLES)[number] | null = null;
  const rag = 0.82 + 0.3 * noise(x / 60, y / 60) + 0.12 * noise(x / 17, y / 17);
  for (const i of PENGHU_ISLES) {
    const de = e - i.e;
    const dn = n - i.n;
    const reach = Math.max(i.re, i.rn) + pad;
    if (Math.abs(de) > reach || Math.abs(dn) > reach) continue;
    const a = (i.turn * Math.PI) / 180;
    const pe = de * Math.cos(a) + dn * Math.sin(a);
    const pn = -de * Math.sin(a) + dn * Math.cos(a);
    const r = Math.sqrt((pe / i.re) ** 2 + (pn / i.rn) ** 2);
    const d = r * rag;
    if (d < best) {
      best = d;
      isle = i;
    }
    out = Math.min(out, (r - 1) * Math.min(i.re, i.rn) * KM);
  }
  return { d: best, out, isle };
}

/** The bay inside the main islands, between Magong, 白沙 and 西嶼 (km east and north of Magong, radii). */
const PENGHU_BAY = { e: -2.5, n: 4.5, re: 8, rn: 7.5 };

function penghuRegion(x: number, y: number): boolean {
  const at = penghuAt(x, y);
  if (at.out < PENGHU_SEA) return true;
  if (at.d === 99) return false;
  const { e, n } = penghuLocal(x, y);
  return ((e - PENGHU_BAY.e) / PENGHU_BAY.re) ** 2 + ((n - PENGHU_BAY.n) / PENGHU_BAY.rn) ** 2 < 1;
}

/** Low flat islands, buildable all over, with a few small heights: 拱北山, 大城北 on 望安, the mesas of 桶盤 and 虎井, 七美's south cliffs. */
function penghuHeight(x: number, y: number): number {
  const { e, n } = penghuLocal(x, y);
  const at = penghuAt(x, y);
  if (at.isle?.mesa) {
    const top = Math.min(1, (1 - at.d) * 4);
    return top > 0 ? Math.max(0, at.isle.mesa * top) : 0;
  }
  let h = 0;
  h += hill(e, n, 8.6, 2.6, 1.0, 0.9, 9);
  h += hill(e, n, -7.4, -22.4, 0.8, 0.7, 8);
  h += hill(e, n, -14.0, -39.9, 1.6, 0.7, 10);
  return h < 0.4 ? 0 : h;
}

/** Height up north and out in the strait (outside the old square, past where the coast starts to bend). */
function northHeight(x: number, y: number, s: number, w: number, u: number, v: number): number {
  const isle = penghuAt(x, y);
  if (isle.d < 1) return penghuHeight(x, y);
  if (ovalAt(WAISANDING, x, y) < 1) return 0.9;
  if (northSea(x, y, s, w)) {
    const depth = Math.min(Math.max(0, northSeaDepth(s, w)), isle.out);
    if (NORTH_LAGOONS.some((o) => ovalAt(o, x, y) < 1.3)) return -2.2;
    return -Math.min(7, 1 + depth * 0.12);
  }
  const fresh = northFresh(x, y);
  if (fresh > 0) return -Math.min(5, 1 + fresh * 0.15);
  // Near the old square the land carries on from Kaohsiung's, then gives way to the north's own
  const outside = Math.max(-HALF_MAP - x, -HALF_MAP - y, 0);
  const fromKaohsiung = 1 - smooth(0, 500, outside);
  let h = northLand(x, y, s, w);
  if (fromKaohsiung > 0) h = fromKaohsiung * kaohsiungLand(x, y, u, v) + (1 - fromKaohsiung) * h;
  return h < 0.4 ? 0 : h;
}

/** Which northern region a point is in, or null. */
function northRegion(x: number, y: number, s: number, w: number, v: number): RegionName | null {
  if (penghuRegion(x, y)) return 'penghu';
  if (v >= 0 || s < NORTH.s0 || s > NORTH_END || w < NORTH_SEA || w > table(NORTH_LAND, s)) return null;
  // 八掌溪 is the border
  return s < table(BAZHANG.map(([bs, bw]) => [bw, bs] as [number, number]), w) ? 'tainan' : 'chiayi';
}

/** Whether a point outside the old square is in the north's part of the map: past where the coast bends, or out at Penghu. */
const northward = (s: number) => s >= NORTH.s0;

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
    return kaohsiungSea(u, v) || riverDepth(u, v) > 0;
  },
  sea(x, y) {
    if (!nearSquare(x, y)) return KAOHSIUNG.sea(x, y);
    return kaohsiungSea((x - y) * S, (x + y) * S);
  },
  region(x, y) {
    // Near the square the old ground keeps its old regions, even where Tainan's now begins
    if (!nearSquare(x, y)) return KAOHSIUNG.region(x, y);
    const r = KAOHSIUNG.region(x, y);
    if (r === 'kaohsiung' || r === 'pingtung') return r;
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
export const REGION_NAMES: Record<RegionName, string> = { kaohsiung: '高雄區', pingtung: '屏東區', tainan: '台南區', chiayi: '嘉義區', penghu: '澎湖區' };
/** Short place names, for the weather and the like. */
export const REGION_PLACES: Record<RegionName, string> = { kaohsiung: '高雄', pingtung: '屏東', tainan: '台南', chiayi: '嘉義', penghu: '澎湖' };

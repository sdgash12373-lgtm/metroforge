import type { Kit } from './facilities';
import type { SignSpec } from './civic';
import { banyan, hip, shrub } from './civic';

/**
 * YouBike stations and the 夜市. Frame as in facilities.ts: u along the street, v back from it
 * (front at -d/2), z up. Their lettered signs are listed in MARKET_LABELS and MARKET_SIGNS.
 */

const YOUBIKE = 0xf2a900;

/** One YouBike 2.0 bike, parked along v at u: two black wheels, a yellow-orange frame and basket. */
function bike(k: Kit, u: number, v: number): void {
  for (const dv of [0.1, 1.15]) k.box(u - 0.04, v + dv - 0.32, u + 0.04, v + dv + 0.32, 0.05, 0.7, 0x26282c);
  k.box(u - 0.05, v + 0.1, u + 0.05, v + 1.15, 0.38, 0.5, YOUBIKE);
  k.box(u - 0.05, v + 0.55, u + 0.05, v + 0.65, 0.4, 0.95, YOUBIKE);
  k.box(u - 0.12, v + 0.45, u + 0.12, v + 0.75, 0.95, 1.02, 0x2a2a2e);
  k.box(u - 0.3, v + 0.02, u + 0.3, v + 0.12, 1, 1.06, 0x3a3d42);
  k.box(u - 0.18, v - 0.3, u + 0.18, v + 0.05, 0.75, 0.98, 0xd9d9d9);
}

/** YouBike 站: a row of slim docks with bikes in them on a paved strip, and the kiosk with its sign. */
export function youbike(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.12, 0xc9c2b2);
  k.rect(-w / 2, -d / 2, w / 2, -d / 2 + 0.25, 0.14, YOUBIKE);
  for (let i = 0; i < 12; i++) {
    const u = -5 + i * 0.8;
    k.box(u - 0.08, 1.2, u + 0.08, 1.45, 0, 1.05, 0xf2f2f2);
    k.box(u - 0.09, 1.18, u + 0.09, 1.47, 0.8, 0.9, YOUBIKE);
    if (i % 5 !== 3) bike(k, u, -0.3);
  }
  // Kiosk at the end: slim pillar with a screen
  k.box(4.9, 0.6, 5.6, 1.6, 0, 2.1, 0xf2f2f2);
  k.box(4.85, 0.55, 5.65, 0.62, 1.1, 1.8, 0x2c3a46);
  k.box(4.8, 0.5, 5.7, 1.7, 2.1, 2.3, YOUBIKE);
}

/** Night market stalls lean into three aisles running back from the gate. */
const AISLES = [-19, 0, 19];
const ROWS = 8;
const ROW_V0 = -14;
const ROW_STEP = 4.2;
/** Stall canopies: red-and-white stripes, blue tarp, green, orange. */
const CANOPIES = [0xd9343a, 0x2f6fb8, 0xf2f2f2, 0x3f8f5a, 0xe8902a, 0xd9343a, 0xf2c230];

/** 夜市: a red gateway, three aisles of stalls under striped canopies with lit food signs, crowds, game stalls and tables at the back. */
export function nightMarket(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.12, 0x6b6e70);
  for (const u of AISLES) k.rect(u - 2.4, -20, u + 2.4, 20, 0.14, 0x86898b);
  // Gateway arch over the middle aisle
  const red = 0xc8231e;
  for (const s of [-1, 1]) {
    k.box(s * 4.2 - 0.5, -21.5, s * 4.2 + 0.5, -20.5, 0, 6.5, red);
    k.box(s * 4.2 - 0.7, -21.7, s * 4.2 + 0.7, -20.3, 0, 0.6, 0xd8cdb4);
  }
  k.box(-5.6, -21.6, 5.6, -20.4, 6.5, 8.6, red);
  hip(k, -6.2, -22, 6.2, -20, 8.6, 1.2, 0xe6b33a);
  // Stalls: a stainless counter, a cart roof or striped canopy, gas tanks and stools
  let n = 0;
  for (const au of AISLES) {
    for (const side of [-1, 1]) {
      for (let r = 0; r < ROWS; r++) {
        const v = ROW_V0 + r * ROW_STEP;
        const u0 = au + side * 2.4;
        const u1 = au + side * 5.6;
        const lo = Math.min(u0, u1);
        const hi = Math.max(u0, u1);
        const c = CANOPIES[(n * 3 + r) % CANOPIES.length];
        k.box(lo, v, hi, v + 3.6, 0, 1, 0xc9cdd0);
        k.box(lo + 0.1, v + 0.1, hi - 0.1, v + 3.5, 1, 1.1, 0x9a9d9f);
        k.box(hi - side * 0 - (side > 0 ? 0.3 : 0), v + 0.2, hi - (side > 0 ? 0 : 3), v + 0.6, 0, 2.6, 0x8a8d8f);
        // Canopy sloping down toward the aisle
        const outer = side > 0 ? hi + 0.2 : lo - 0.2;
        const inner = side > 0 ? lo - 0.6 : hi + 0.6;
        k.color(c).quad([outer, v - 0.1, 3.2], [outer, v + 3.7, 3.2], [inner, v - 0.1, 2.6], [inner, v + 3.7, 2.6]);
        if (c === 0xd9343a) {
          for (let t = 0.6; t < 3.6; t += 1.2) k.color(0xf2f2f2).quad([outer, v + t, 3.21], [outer, v + t + 0.5, 3.21], [inner, v + t, 2.61], [inner, v + t + 0.5, 2.61]);
        }
        k.prism(outer - side * 0.5, v + 3.2, 0.2, 0.2, 0, 0.7, 0x5f86a0, 6);
        // Bulbs hanging at the canopy's edge
        for (let t = 0.4; t < 3.6; t += 1) k.box(inner - 0.08, v + t, inner + 0.08, v + t + 0.16, 2.3, 2.5, 0xffe08a);
        n++;
      }
    }
  }
  // The crowd: people strolling down every aisle
  const shirts = [0xd9343a, 0x2f6fb8, 0xf2f2f2, 0x3f8f5a, 0xf2c230, 0x8a6fd1, 0x2a2a2e, 0xe8902a];
  for (let i = 0; i < 66; i++) {
    const au = AISLES[i % 3];
    const u = au + (((i * 37) % 30) / 10 - 1.5);
    const v = -19 + ((i * 53) % 380) / 10;
    k.prism(u, v, 0.22, 0.2, 0, 1.05, 0x3a3d42, 5);
    k.prism(u, v, 0.28, 0.24, 1.05, 1.55, shirts[i % shirts.length], 5);
    k.prism(u, v, 0.15, 0.15, 1.55, 1.78, 0xe8c4a0, 5);
  }
  // Back: game stalls (balloon darts, goldfish scooping) and tables with plastic stools
  for (let i = 0; i < 4; i++) {
    const u = -28 + i * 7;
    k.box(u, 17.5, u + 5.5, 21.5, 0, 2.8, 0xf2efe6);
    for (let j = 0; j < 5; j++) for (let z = 0; z < 2; z++) k.prism(u + 0.7 + j, 17.4, 0.3, 0.3, 1.3 + z * 0.7, 1.6 + z * 0.7, CANOPIES[(i + j + z) % CANOPIES.length], 6);
    hip(k, u - 0.2, 17.3, u + 5.7, 21.7, 2.8, 0.8, i % 2 ? 0xd9343a : 0x2f6fb8);
  }
  for (let i = 0; i < 2; i++) {
    const u = 7 + i * 7;
    k.box(u, 17.8, u + 5, 21, 0, 0.8, 0x2f6fb8);
    k.box(u + 0.3, 18.1, u + 4.7, 20.7, 0.75, 0.82, 0x5aa7d6);
  }
  for (let i = 0; i < 6; i++) {
    const u = 23 + (i % 2) * 4;
    const v = 8 + Math.floor(i / 2) * 4;
    k.box(u - 0.8, v - 0.8, u + 0.8, v + 0.8, 0.7, 0.78, 0xe9e5dc);
    k.box(u - 0.1, v - 0.1, u + 0.1, v + 0.1, 0, 0.7, 0xc9cdd0);
    for (const [du, dv] of [
      [-1.2, 0],
      [1.2, 0],
      [0, -1.2],
      [0, 1.2],
    ] as const) {
      k.box(u + du - 0.22, v + dv - 0.22, u + du + 0.22, v + dv + 0.22, 0, 0.45, i % 2 ? 0xd9343a : 0x2f6fb8);
    }
  }
  for (const u of [-30, 30]) banyan(k, u, -19, 0.8);
  shrub(k, -9, -21, 0.7);
  shrub(k, 9, -21, 0.7);
}

/** What the stalls sell, on their lit signs. */
const FOODS: [string, string, string][] = [
  ['雞排', '#f2c230', '#b3261e'],
  ['珍珠奶茶', '#ffffff', '#6b3a1e'],
  ['蚵仔煎', '#d7261e', '#ffffff'],
  ['臭豆腐', '#ffe14d', '#1f3f8f'],
  ['大腸包小腸', '#1f5fae', '#ffffff'],
  ['烤玉米', '#e8902a', '#ffffff'],
  ['鹽酥雞', '#ffffff', '#d7261e'],
  ['胡椒餅', '#b3261e', '#ffe14d'],
  ['木瓜牛奶', '#3f9a4a', '#ffffff'],
  ['滷味', '#2a2a2e', '#ffe14d'],
  ['車輪餅', '#f7a8c0', '#7a1f3a'],
  ['地瓜球', '#ffd27a', '#8a3b12'],
];

export const MARKET_LABELS: Record<string, { text: string; bg: string; fg: string; vertical?: boolean }> = {
  youbike: { text: 'YouBike', bg: '#f2a900', fg: '#ffffff' },
  nightGate: { text: '觀光夜市', bg: '#c8231e', fg: '#ffe14d' },
  ...Object.fromEntries(FOODS.map(([text, bg, fg], i) => [`food${i}`, { text, bg, fg }])),
};

/** Each stall's sign faces down its aisle, toward the gate; the gate carries the market's name. */
const stallSigns: SignSpec[] = [];
{
  let n = 0;
  for (const au of AISLES) {
    for (const side of [-1, 1]) {
      for (let r = 0; r < ROWS; r++) {
        const v = ROW_V0 + r * ROW_STEP;
        const mid = au + side * 4;
        stallSigns.push({ label: `food${(n * 5 + r) % FOODS.length}`, u0: mid - 1.4, u1: mid + 1.4, z0: 3.3, z1: 4.2, v: v - 0.15 });
        n++;
      }
    }
  }
}

export const MARKET_SIGNS: Record<string, SignSpec[]> = {
  youbike: [{ label: 'youbike', u0: 4.8, u1: 5.7, z0: 2.3, z1: 2.55, v: 0.45 }],
  nightMarket: [{ label: 'nightGate', u0: -5.3, u1: 5.3, z0: 6.7, z1: 8.4, v: -21.7 }, ...stallSigns],
};

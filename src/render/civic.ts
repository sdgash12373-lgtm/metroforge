import type { Kit } from './facilities';

/**
 * Public services in a Taiwanese style: a 國小 with tiled classroom blocks, open corridors and a
 * PU track; a neighbourhood park with a 涼亭, koi pond, banyans and royal palms; a 派出所 in white
 * tile with a blue band; a 消防分隊 with red bays and a hose tower; and a 醫院 with ward towers,
 * a drop-off canopy and its own 急診 entrance. Frame as in facilities.ts: u along the street,
 * v back from it (front at -d/2), z up. The lettered signs are listed in SIGNS and drawn separately.
 */

const CREAM = 0xf3e9d2;
const TILE = 0xb5523b;
const CAP = 0x8c3b2a;
const ROOF = 0xb8462e;
const GLASS = 0x5f86a0;
const WHITE = 0xeceae4;
const STONE = 0xb9b0a0;
const GRASS = 0x86c062;
const BRICK = 0xc98d6a;
const STEEL = 0xd5d8da;
const TYRE = 0x2a2a2e;

/** Roof with its ridge along the longer side, sloping down on all four sides. */
export function hip(k: Kit, u0: number, v0: number, u1: number, v1: number, z: number, h: number, c: number): void {
  k.color(c);
  if (u1 - u0 >= v1 - v0) {
    const vm = (v0 + v1) / 2;
    const ua = Math.min(u0 + (v1 - v0) / 2, (u0 + u1) / 2);
    const ub = Math.max(u1 - (v1 - v0) / 2, (u0 + u1) / 2);
    k.quad([u0, v0, z], [u1, v0, z], [ua, vm, z + h], [ub, vm, z + h]);
    k.quad([u0, v1, z], [u1, v1, z], [ua, vm, z + h], [ub, vm, z + h]);
    k.quad([u0, v0, z], [u0, v1, z], [ua, vm, z + h], [ua, vm, z + h]);
    k.quad([u1, v0, z], [u1, v1, z], [ub, vm, z + h], [ub, vm, z + h]);
  } else {
    const um = (u0 + u1) / 2;
    const va = Math.min(v0 + (u1 - u0) / 2, (v0 + v1) / 2);
    const vb = Math.max(v1 - (u1 - u0) / 2, (v0 + v1) / 2);
    k.quad([u0, v0, z], [u0, v1, z], [um, va, z + h], [um, vb, z + h]);
    k.quad([u1, v0, z], [u1, v1, z], [um, va, z + h], [um, vb, z + h]);
    k.quad([u0, v0, z], [u1, v0, z], [um, va, z + h], [um, va, z + h]);
    k.quad([u0, v1, z], [u1, v1, z], [um, vb, z + h], [um, vb, z + h]);
  }
}

/** A band round the top of a block, leaving its roof showing: a parapet, or a stripe round the walls. */
export function band(k: Kit, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, c: number, t = 0.3): void {
  k.box(u0, v0, u1, v0 + t, z0, z1, c);
  k.box(u0, v1 - t, u1, v1, z0, z1, c);
  k.box(u0, v0, u0 + t, v1, z0, z1, c);
  k.box(u1 - t, v0, u1, v1, z0, z1, c);
}

const ROOF_SLAB = 0xa9aba7;

/** 榕樹: a short thick trunk under a wide, flat, layered canopy. */
export function banyan(k: Kit, u: number, v: number, s = 1): void {
  k.prism(u, v, 0.55 * s, 0.4 * s, 0, 2.6 * s, 0x6b5440, 6);
  k.prism(u, v, 3.2 * s, 4.4 * s, 2.2 * s, 3.6 * s, 0x3f7f3c, 8);
  k.prism(u, v, 4.4 * s, 3.4 * s, 3.6 * s, 5.2 * s, 0x4a8f45, 8, 0.3);
  k.prism(u + 0.6 * s, v - 0.4 * s, 3.2 * s, 1.4 * s, 5.2 * s, 6.4 * s, 0x58a04f, 7);
}

/** 大王椰子: a tall pale trunk and a burst of fronds. */
export function palm(k: Kit, u: number, v: number, s = 1): void {
  k.prism(u, v, 0.32 * s, 0.24 * s, 0, 9 * s, 0xc9c2b2, 6);
  k.prism(u, v, 0.42 * s, 0.42 * s, 8.4 * s, 9.6 * s, 0x6f9a4a, 6);
  // Fronds hang down and out from the crown
  k.prism(u, v, 3.6 * s, 0.5 * s, 8 * s, 10.4 * s, 0x4f8f45, 6);
  k.prism(u, v, 1.6 * s, 0, 10.2 * s, 11.4 * s, 0x5a9e4c, 5, 0.6);
}

export function shrub(k: Kit, u: number, v: number, r = 1): void {
  k.prism(u, v, r, r * 0.6, 0, r * 1.2, 0x4f8f45, 6);
}

interface Livery {
  body: number;
  stripe?: number;
  roof?: number;
  /** light bar colours, left and right */
  lights?: [number, number];
}

/** A car or van parked nose to the street: centred on u, its nose at v, `len` long going back. */
function parked(k: Kit, u: number, v: number, len: number, wid: number, high: number, l: Livery): void {
  const u0 = u - wid / 2;
  const u1 = u + wid / 2;
  for (const t of [0.18, 0.78]) {
    k.box(u0 - 0.05, v + len * t, u0 + 0.25, v + len * t + 0.7, 0, 0.7, TYRE);
    k.box(u1 - 0.25, v + len * t, u1 + 0.05, v + len * t + 0.7, 0, 0.7, TYRE);
  }
  k.box(u0, v, u1, v + len, 0.35, high * 0.55, l.body);
  if (l.stripe) k.box(u0 - 0.03, v - 0.03, u1 + 0.03, v + len + 0.03, high * 0.3, high * 0.42, l.stripe);
  const cabin = high < 2 ? [v + len * 0.28, v + len * 0.8] : [v + 0.2, v + len];
  k.box(u0 + 0.12, cabin[0], u1 - 0.12, cabin[1], high * 0.55, high, l.roof ?? l.body);
  k.box(u0 + 0.16, cabin[0] - 0.05, u1 - 0.16, cabin[0] + 0.4, high * 0.6, high * 0.92, 0x2c3a46);
  if (l.lights) {
    const v0 = cabin[0] + 0.5;
    k.box(u0 + 0.25, v0, u, v0 + 0.5, high, high + 0.22, l.lights[0]);
    k.box(u, v0, u1 - 0.25, v0 + 0.5, high, high + 0.22, l.lights[1]);
  }
}

/** A fire engine nose to the street: red cab, white stripe, ladder on top. */
function fireEngine(k: Kit, u: number, v: number): void {
  const u0 = u - 1.25;
  const u1 = u + 1.25;
  for (const t of [1.2, 5.2, 6.6]) {
    k.box(u0 - 0.06, v + t, u0 + 0.3, v + t + 1, 0, 1, TYRE);
    k.box(u1 - 0.3, v + t, u1 + 0.06, v + t + 1, 0, 1, TYRE);
  }
  k.box(u0, v, u1, v + 8.2, 0.6, 2.9, 0xc8231e);
  k.box(u0 - 0.04, v - 0.04, u1 + 0.04, v + 8.24, 1.5, 1.8, 0xf2f2f2);
  k.box(u0, v, u1, v + 2.3, 2.9, 3.3, 0xc8231e);
  k.box(u0 + 0.15, v - 0.05, u1 - 0.15, v + 0.3, 1.9, 2.8, 0x2c3a46);
  k.box(u0 + 0.3, v + 0.6, u, v + 1.2, 3.3, 3.55, 0xe03c31);
  k.box(u, v + 0.6, u1 - 0.3, v + 1.2, 3.3, 3.55, 0x2f6fe0);
  // Ladder: two rails and rungs, and lockers down the side
  k.box(u0 + 0.35, v + 2.6, u0 + 0.55, v + 8.6, 3.0, 3.4, STEEL);
  k.box(u1 - 0.55, v + 2.6, u1 - 0.35, v + 8.6, 3.0, 3.4, STEEL);
  for (let t = 3; t < 8.4; t += 0.9) k.box(u0 + 0.55, v + t, u1 - 0.55, v + t + 0.15, 3.2, 3.3, STEEL);
  for (let t = 2.6; t < 7.8; t += 1.3) {
    k.box(u0 - 0.06, v + t, u0, v + t + 1.1, 1.9, 2.7, 0xb01d19);
    k.box(u1, v + t, u1 + 0.06, v + t + 1.1, 1.9, 2.7, 0xb01d19);
  }
}

/** Storeys of windows on the -v face at `vf`: one pane per bay. */
function windows(k: Kit, u0: number, u1: number, vf: number, z0: number, floors: number, fh: number, bay: number, c = GLASS): void {
  for (let f = 0; f < floors; f++) {
    const z = z0 + f * fh;
    for (let u = u0; u + bay * 0.7 <= u1 + 0.01; u += bay) k.box(u, vf - 0.12, u + bay * 0.66, vf, z + fh * 0.28, z + fh * 0.78, c);
  }
}

/** The same on a ±u face at `uf`, panes along v; `side` -1 for the -u face. */
function sideWindows(k: Kit, uf: number, side: number, v0: number, v1: number, z0: number, floors: number, fh: number, bay: number, c = GLASS): void {
  for (let f = 0; f < floors; f++) {
    const z = z0 + f * fh;
    for (let v = v0; v + bay * 0.7 <= v1 + 0.01; v += bay) {
      const a = side < 0 ? uf - 0.12 : uf;
      k.box(a, v, a + 0.12, v + bay * 0.66, z + fh * 0.28, z + fh * 0.78, c);
    }
  }
}

/** 國小: an L of tiled classroom blocks with open corridors onto the field, red hip roofs, a PU track, 司令台 and flagpoles. */
export function school(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0xcfcabc);
  const fh = 3.6;
  // Main block along the back: classrooms behind an open corridor facing the field
  const top = fh * 4;
  k.box(-31, 12, 31, 21, 0, top, CREAM);
  k.box(-31.05, 12.5, 31.05, 21.05, 0, 0.9, TILE);
  for (let f = 1; f <= 4; f++) k.box(-31, 9, 31, 12, f * fh - 0.35, f * fh, CREAM);
  for (let f = 1; f < 4; f++) {
    k.box(-31, 9, 31, 9.35, f * fh, f * fh + 1.1, CREAM);
    k.box(-31, 8.95, 31, 9.4, f * fh + 1.1, f * fh + 1.28, CAP);
  }
  for (let u = -27; u <= 27; u += 6.75) k.box(u - 0.35, 9, u + 0.35, 9.7, 0, top, 0xe9dcc0);
  for (let f = 0; f < 4; f++) {
    for (let u = -26; u < 26; u += 6.75) {
      k.box(u, 11.88, u + 3.4, 12, f * fh + 1, f * fh + 2.8, GLASS);
      k.box(u + 4.2, 11.88, u + 5.4, 12, f * fh, f * fh + 2.6, 0x8a6a4a);
    }
  }
  // Brick-tiled stair towers at both ends, then the red tiled hip roofs
  for (const s of [-1, 1]) {
    const a = s < 0 ? -31 : 27;
    k.box(a, 9, a + 4, 21, 0, top + 2.2, TILE);
    for (let z = 2; z < top; z += fh) k.box(a + 1.2, 8.88, a + 2.8, 9, z, z + 1.6, GLASS);
    hip(k, a - 0.4, 8.6, a + 4.4, 21.4, top + 2.2, 1.8, ROOF);
  }
  hip(k, -27, 8.4, 27, 21.6, top, 3.2, ROOF);
  // Side wing on the left, its corridor facing the field
  const wing = fh * 3;
  k.box(-31, -14, -24, 9, 0, wing, CREAM);
  for (let f = 1; f <= 3; f++) k.box(-24, -14, -21, 9, f * fh - 0.35, f * fh, CREAM);
  for (let f = 1; f < 3; f++) {
    k.box(-21.35, -14, -21, 9, f * fh, f * fh + 1.1, CREAM);
    k.box(-21.4, -14, -20.95, 9, f * fh + 1.1, f * fh + 1.28, CAP);
  }
  for (const v of [-14, -6.5, 1]) k.box(-21.7, v, -21, v + 0.7, 0, wing, 0xe9dcc0);
  for (let f = 0; f < 3; f++) for (let v = -13; v < 8; v += 5.5) k.box(-24, v, -23.88, v + 3, f * fh + 1, f * fh + 2.8, GLASS);
  k.box(-31.05, -14.05, -23.95, 9, 0, 0.9, TILE);
  hip(k, -31.5, -14.5, -20.6, 8.6, wing, 2.8, ROOF);
  // PU track and the grass field inside it
  const pu = 0xc8664a;
  k.prism(-8, -5, 9, 9, 0.1, 0.16, pu, 16);
  k.prism(14, -5, 9, 9, 0.1, 0.16, pu, 16);
  k.rect(-8, -14, 14, 4, 0.16, pu);
  k.prism(-8, -5, 6.4, 6.4, 0.1, 0.2, 0x6fb556, 16);
  k.prism(14, -5, 6.4, 6.4, 0.1, 0.2, 0x6fb556, 16);
  k.rect(-8, -11.4, 14, 1.4, 0.2, 0x6fb556);
  k.rect(3, -14, 3.25, -11.4, 0.18, 0xf2f2f2);
  k.rect(-8, -7.65, 14, -7.5, 0.18, 0xf2f2f2);
  // 司令台 facing the field, flagpoles by the gate
  k.box(24, -11, 30, -1, 0, 1.2, 0xd8cdb4);
  k.box(29.3, -11, 30, -1, 1.2, 5, CREAM);
  for (const v of [-10.8, -1.6]) k.box(24.2, v, 24.6, v + 0.4, 1.2, 5, CREAM);
  hip(k, 23.6, -11.4, 30.4, -0.6, 5, 1.1, ROOF);
  k.box(22.8, -7, 24, -5, 0, 0.6, 0xd8cdb4);
  k.box(24.5, -18, 31.5, -15.5, 0, 0.4, STONE);
  for (const [u, h, c] of [
    [26, 9, 0x2f9a5a],
    [28, 10.5, 0xd9343a],
    [30, 9, 0x2f6fb8],
  ] as const) {
    k.prism(u, -16.8, 0.1, 0.08, 0.4, h, 0xdddddd, 4);
    k.box(u + 0.1, -16.85, u + 2, -16.75, h - 1.3, h - 0.1, c);
  }
  k.box(28.1, -16.9, 29, -16.7, 9.8, 10.4, 0x1f3f8f);
  // Basketball court behind the 司令台
  k.rect(22.5, 1, 31.5, 8.5, 0.14, 0x3f7f6a);
  k.rect(26.9, 1, 27.1, 8.5, 0.16, 0xf2f2f2);
  for (const u of [23, 31]) {
    k.prism(u, 4.75, 0.08, 0.08, 0, 3.2, STEEL, 4);
    k.box(u - 0.05, 4, u + 0.05, 5.5, 2.8, 3.8, 0xf2f2f2);
  }
  // Wall with railings, a gate between brick pillars, the name wall and the guard house
  const wall = (u0: number, v0: number, u1: number, v1: number) => {
    k.box(u0, v0, u1, v1, 0, 0.9, CREAM);
    k.box(u0 - 0.05, v0 - 0.05, u1 + 0.05, v1 + 0.05, 0.9, 1.05, CAP);
    k.box(u0, v0 + (v1 - v0) * 0.35, u1, v0 + (v1 - v0) * 0.65, 1.75, 1.85, 0x3f6f55);
    const along = u1 - u0 > v1 - v0;
    const len = along ? u1 - u0 : v1 - v0;
    for (let t = 0; t <= len; t += 2) {
      if (along) k.box(u0 + t - 0.05, v0 + 0.1, u0 + t + 0.05, v1 - 0.1, 1.05, 1.8, 0x3f6f55);
      else k.box(u0 + 0.1, v0 + t - 0.05, u1 - 0.1, v0 + t + 0.05, 1.05, 1.8, 0x3f6f55);
    }
  };
  wall(-31.6, -22, -8.6, -21.6);
  wall(2.6, -22, 32, -21.6);
  wall(31.6, -21.6, 32, 9);
  for (const u of [-8.6, 1.4]) k.box(u, -22.4, u + 1.2, -21.2, 0, 3.6, TILE);
  k.box(-8.8, -22.5, 2.8, -21.1, 3.6, 4.3, CAP);
  k.box(-20.5, -21.4, -9.5, -20.6, 0, 3.2, TILE);
  k.box(-20.7, -21.6, -9.3, -20.4, 3.2, 3.5, CAP);
  k.box(3.4, -20.8, 7, -17.6, 0, 2.8, CREAM);
  k.box(3.35, -20.85, 7.05, -20.7, 1, 2.2, GLASS);
  hip(k, 3, -21.2, 7.4, -17.2, 2.8, 1, ROOF);
  for (const [u, v, s] of [
    [-27, -18, 1],
    [-17, -17.5, 0.85],
    [12, -18.5, 0.9],
    [20, -18.5, 0.8],
    [-17, 5, 0.75],
  ] as const) {
    banyan(k, u, v, s);
  }
  for (let u = -30; u < -22; u += 2.5) shrub(k, u, -20.6, 0.7);
}

/** 公園: a brick ring path round a koi pond with a red bridge, a 涼亭, playground, exercise corner, banyans and royal palms. */
export function park(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.12, GRASS);
  k.box(-w / 2, -d / 2, w / 2, -d / 2 + 0.4, 0, 0.35, STONE);
  k.box(-w / 2, d / 2 - 0.4, w / 2, d / 2, 0, 0.35, STONE);
  k.box(-w / 2, -d / 2, -w / 2 + 0.4, d / 2, 0, 0.35, STONE);
  k.box(w / 2 - 0.4, -d / 2, w / 2, d / 2, 0, 0.35, STONE);
  // Brick entrance and the ring path round the pond
  k.rect(-4, -19.6, 4, -14, 0.16, BRICK);
  k.rect(-1.5, -14, 1.5, -11, 0.15, BRICK);
  k.prism(1, 1, 13.2, 13.2, 0.12, 0.15, BRICK, 22);
  k.prism(1, 1, 11.2, 11.2, 0.12, 0.17, GRASS, 22);
  k.prism(-11, 11, 2, 2, 0.12, 0.15, BRICK, 8);
  // Koi pond with a stone rim, fish and a red arched bridge
  k.prism(2, 3, 7, 7, 0.12, 0.3, 0xa9a294, 16);
  k.prism(2, 3, 6.3, 6.3, 0.12, 0.34, 0x4f97bf, 16);
  for (const [u, v] of [
    [0, 1],
    [4.5, 5],
    [3, -1],
    [-1.5, 6],
  ] as const) {
    k.box(u, v, u + 0.6, v + 0.25, 0.34, 0.42, 0xf08a2e);
  }
  const red = 0xc0392b;
  k.box(-5.6, 2.3, -3, 3.7, 0.3, 0.75, red);
  k.box(-3, 2.3, 7, 3.7, 0.75, 1.25, red);
  k.box(7, 2.3, 9.6, 3.7, 0.3, 0.75, red);
  for (const v of [2.3, 3.6]) {
    for (let u = -3; u <= 7; u += 1.25) k.box(u - 0.06, v, u + 0.06, v + 0.1, 1.25, 1.95, red);
    k.box(-3, v - 0.03, 7, v + 0.13, 1.85, 1.98, 0xe6b33a);
  }
  // 涼亭: red columns on a stone base under a green glazed roof with a golden finial
  const pu = -11;
  const pv = 11;
  k.prism(pu, pv, 4.2, 4.2, 0, 0.5, STONE, 6);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.prism(pu + Math.cos(a) * 3.2, pv + Math.sin(a) * 3.2, 0.2, 0.2, 0.5, 3.5, 0xb3261e, 4);
  }
  k.prism(pu, pv, 3.5, 3.5, 3.4, 3.8, 0xb3261e, 6);
  k.prism(pu, pv, 5, 4.2, 3.6, 4, 0x2e7d5a, 6);
  k.prism(pu, pv, 4.2, 0.4, 4, 6.4, 0x2e7d5a, 6);
  k.prism(pu, pv, 0.35, 0, 6.4, 7.4, 0xe0b040, 6);
  // Playground on a blue rubber mat: slide tower, slide and swings
  k.rect(8, -18, 18.6, -8, 0.18, 0x3f7fbf);
  k.box(9.5, -16, 12, -13.5, 0, 2.4, 0xf2c230);
  k.box(9.3, -16.2, 12.2, -13.3, 2.2, 2.45, 0xe08a2e);
  hip(k, 9.3, -16.2, 12.2, -13.3, 3.6, 1.2, 0xd9343a);
  for (const [u, v] of [
    [9.4, -16.1],
    [11.8, -16.1],
    [9.4, -13.6],
    [11.8, -13.6],
  ] as const) {
    k.box(u, v, u + 0.3, v + 0.3, 2.4, 3.6, 0xd9343a);
  }
  k.color(0x2f9ad6).quad([12, -15.4, 2.3], [12, -14.2, 2.3], [16.6, -15.4, 0.3], [16.6, -14.2, 0.3]);
  for (const u of [13, 17.6]) k.box(u, -10.2, u + 0.25, -9.95, 0.18, 2.8, 0xd9343a);
  k.box(13, -10.2, 17.85, -9.95, 2.6, 2.85, 0xd9343a);
  for (const u of [14.2, 16]) k.box(u, -10.4, u + 0.8, -9.75, 0.7, 0.85, 0xf2c230);
  // Exercise corner: the yellow and blue machines every Taiwanese park has
  k.rect(12, 9, 18.6, 17.6, 0.16, 0xd8cdb4);
  for (const [u, v, c] of [
    [13.5, 11, 0xf2c230],
    [16.5, 11, 0x2f6fb8],
    [13.5, 15, 0x2f6fb8],
    [16.5, 15, 0xf2c230],
  ] as const) {
    k.box(u - 0.15, v - 0.15, u + 0.15, v + 0.15, 0, 1.8, c);
    k.box(u - 0.7, v - 0.1, u + 0.7, v + 0.1, 1.6, 1.8, c);
    k.box(u - 0.5, v - 0.3, u - 0.2, v + 0.3, 0.4, 0.6, 0x555a5e);
  }
  // Benches round the ring
  for (const a of [0.4, 1.4, 2.6, 3.6, 5.2]) {
    const u = 1 + Math.cos(a) * 14;
    const v = 1 + Math.sin(a) * 14;
    k.box(u - 0.8, v - 0.3, u + 0.8, v + 0.3, 0.4, 0.55, 0x8a6a4a);
  }
  // Stone with the park's name at the gate
  k.box(-8.6, -19.3, -4.6, -18.3, 0, 1.5, 0x6d6a62);
  banyan(k, -14, -12, 1.25);
  banyan(k, 16.5, 3, 1);
  banyan(k, -16.5, 1, 0.9);
  for (const u of [-17.5, -6, 6, 17.5]) palm(k, u, 18, 1);
  palm(k, 18, -18.5, 0.9);
  palm(k, -18, -18, 0.9);
  for (const v of [-5, -1, 6]) shrub(k, -18.5, v, 0.8);
  for (const u of [-6, -10]) shrub(k, u, -16.5, 0.8);
}

/** 派出所: four storeys of white tile with a blue band and corner piers, an arcade, its sign and warning lamps, patrol cars and scooters. */
export function police(k: Kit, w: number, d: number): void {
  const blue = 0x1f4e9c;
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0x9ea3a6);
  k.rect(-w / 2, -d / 2, w / 2, -d / 2 + 2.4, 0.13, 0xc9c2b5);
  const fh = 3.4;
  const top = fh * 4;
  // Arcade at street level, white tile above
  k.box(-12, -1, 12, 13, 0, fh, 0xd8d6d0);
  k.box(-6, -1.12, 6, -1, 0.1, 2.9, GLASS);
  k.box(-0.9, -1.16, 0.9, -1.04, 0, 2.6, 0x3a4a58);
  k.box(-12, -3, 12, 13, fh, top, WHITE);
  for (const u of [-12, -6.4, 6, 11.6]) k.box(u, -3, u + 0.4, -2.6, 0, fh, WHITE);
  k.box(-12.1, -3.1, 12.1, 13.1, fh, fh + 0.9, blue);
  band(k, -12.1, -3.1, 12.1, 13.1, top - 0.3, top + 0.7, blue);
  k.rect(-12, -3, 12, 13, top + 0.05, ROOF_SLAB);
  for (const u of [-12.25, 10.75]) k.box(u, -3.25, u + 1.5, -1.75, fh, top, blue);
  windows(k, -10, 10, -3, fh + 0.4, 3, fh, 3.4);
  sideWindows(k, 12, 1, -1, 12, fh + 0.4, 3, fh, 3.4);
  sideWindows(k, -12, -1, -1, 12, fh + 0.4, 3, fh, 3.4);
  // Sign over the door, red and blue lamps beside it
  k.box(-5, -3.45, 5, -3.1, fh + 1.1, fh + 3.7, blue);
  k.box(-7.2, -3.6, -6.5, -3.0, 2.2, 3.0, 0xf2f2f2);
  k.box(-7.15, -3.65, -6.55, -3.55, 2.3, 2.9, 0xe03c31);
  k.box(6.5, -3.6, 7.2, -3.0, 2.2, 3.0, 0xf2f2f2);
  k.box(6.55, -3.65, 7.15, -3.55, 2.3, 2.9, 0x2f6fe0);
  // Roof: stair house, stainless water tanks, radio mast
  k.box(-10, 6, -4, 12, top, top + 3, WHITE);
  band(k, -10.1, 5.9, -3.9, 12.1, top + 2.4, top + 3.1, blue);
  for (const u of [3, 6]) {
    k.box(u - 1.2, 8, u + 1.2, 11, top, top + 0.6, 0x8f9396);
    k.prism(u, 9.5, 1, 1, top + 0.6, top + 2.4, 0xd8dcdf, 10);
  }
  k.prism(9, 3, 0.12, 0.06, top, top + 7, 0xcccccc, 4);
  k.box(8.4, 2.9, 9.6, 3.1, top + 5, top + 5.2, 0xcccccc);
  // Flag
  k.prism(-14.4, -12.6, 0.1, 0.08, 0, 9, 0xdddddd, 4);
  k.box(-14.3, -12.65, -12.2, -12.55, 7.6, 8.9, 0xd9343a);
  k.box(-14.3, -12.7, -13.3, -12.5, 8.25, 8.9, 0x1f3f8f);
  // Patrol cars nose out, police scooters in a row
  for (const u of [5.2, 8.6, 12]) k.rect(u - 1.7, -14, u - 1.6, -8.5, 0.13, 0xf2f2f2);
  for (const u of [6.9, 10.3]) parked(k, u, -13.6, 4.6, 1.85, 1.55, { body: 0xf5f5f5, stripe: blue, lights: [0xe03c31, 0x2f6fe0] });
  for (let u = -13; u < -5; u += 1.4) {
    k.box(u, -8.6, u + 0.55, -7, 0.3, 0.95, 0xf5f5f5);
    k.box(u + 0.05, -8.2, u + 0.5, -7.3, 0.95, 1.15, 0x222428);
    k.box(u + 0.1, -8.75, u + 0.45, -8.6, 0.5, 1.3, blue);
  }
  for (const u of [-15, 15]) shrub(k, u, -14, 0.8);
}

/** 消防分隊: red and white with three tall bays (one shutter down), a hose tower with its vertical sign, fire engines and an ambulance. */
export function fire(k: Kit, w: number, d: number): void {
  const red = 0xc8231e;
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0xa3a6a8);
  // Keep-clear hatching in front of the bays
  for (let u = -15; u < 3; u += 1.6) k.color(0xe6c13a).quad([u, -14.5, 0.13], [u + 0.5, -14.5, 0.13], [u + 2.2, -6.5, 0.13], [u + 2.7, -6.5, 0.13]);
  k.rect(-15, -15, 2.5, -14.6, 0.14, 0xe6c13a);
  const bay = 5;
  k.box(-15, -6, 8, 12, 0, bay, 0xf1efe9);
  for (const [i, u] of [-14, -8, -2].entries()) {
    k.box(u, -6.12, u + 5.2, -6, 0, 4.4, 0x2a2a2e);
    k.box(u, -6.16, u + 5.2, -6.04, i === 2 ? 0 : 3.6, 4.4, 0xb8bcc0);
    k.box(u - 0.6, -6.3, u, -6, 0, bay, red);
  }
  k.box(3.2, -6.3, 8, -6, 0, bay, red);
  k.box(4.5, -6.12, 7, -6, 0, 2.6, GLASS);
  // Upper floors: white with red bands and window rows
  k.box(-15, -6, 8, 12, bay, bay + 9, 0xf1efe9);
  k.box(-15.1, -6.1, 8.1, 12.1, bay, bay + 0.8, red);
  band(k, -15.1, -6.1, 8.1, 12.1, bay + 8.6, bay + 9.6, red);
  k.rect(-15, -6, 8, 12, bay + 9.05, ROOF_SLAB);
  windows(k, -14, 3, -6, bay + 0.6, 3, 2.8, 3.2);
  windows(k, 4.2, 7.6, -6, bay + 0.6, 3, 2.8, 3.2);
  sideWindows(k, -15, -1, -5, 11, bay + 0.6, 3, 2.8, 3.2);
  k.box(-10, -6.35, 3, -6.05, bay + 0.9, bay + 3.4, red);
  // Hose tower with its vertical sign
  k.box(9, 0, 15, 8, 0, 24, 0xe9e5dc);
  band(k, 8.8, -0.2, 15.2, 8.2, 22, 24.6, red);
  k.rect(9, 0, 15, 8, 24.05, ROOF_SLAB);
  for (let z = 3; z < 21; z += 3.5) k.box(9.8, -0.12, 11.6, 0, z, z + 1.6, GLASS);
  k.box(12.1, -0.3, 14.7, 0, 6.6, 17.4, red);
  k.box(10, 2, 14, 6, 24.6, 26, 0xe9e5dc);
  k.prism(12, 4, 0.1, 0.06, 26, 30, 0xcccccc, 4);
  // Rooftop tanks
  for (const u of [-11, -8]) k.prism(u, 6, 1, 1, bay + 9, bay + 10.8, 0xd8dcdf, 10);
  // A fire engine out on the apron, another in its bay; an ambulance by the tower
  fireEngine(k, -11.4, -13.6);
  fireEngine(k, -5.4, -8.8);
  parked(k, 12, -13.4, 5.4, 2, 2.5, { body: 0xf7f7f5, stripe: red, lights: [0xe03c31, 0xe03c31] });
  k.prism(15.6, -14, 0.3, 0.25, 0, 0.8, red, 8);
}

/** 醫院: a three-storey podium, two ward towers with ribbon windows, a drop-off canopy, a separate 急診 entrance with ambulances, and a helipad. */
export function hospital(k: Kit, w: number, d: number): void {
  const white = 0xf2f4f5;
  const red = 0xd0242b;
  const teal = 0x5f9fb3;
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0xb7bcbf);
  // Driveway loop round a planted island
  k.rect(-17, -20, 6, -6, 0.12, 0x6f7378);
  k.rect(-12, -16.5, 1, -11, 0.18, GRASS);
  k.rect(8, -20, 25, -6, 0.12, 0x6f7378);
  k.rect(8, -20, 25, -19.6, 0.14, 0xf2f2f2);
  // Podium
  const fh = 4;
  k.box(-25, -6, 25, 17, 0, fh * 3, white);
  k.box(-14, -6.12, 4, -6, 0.1, 3.4, teal);
  for (let f = 1; f < 3; f++) {
    k.box(-25.1, -6.1, 25.1, 17.1, f * fh + 1, f * fh + 2.8, teal);
  }
  k.box(-25.15, -6.15, 25.15, 17.15, fh * 3 - 0.4, fh * 3 + 0.3, 0xdfe3e6);
  // Drop-off canopy over the main door
  k.box(-15.4, -15.4, 5.4, -5.8, 4.4, 5, white);
  k.box(-15.5, -15.5, 5.5, -15.2, 4.2, 5.1, teal);
  for (const [u, v] of [
    [-15, -15],
    [4.4, -15],
  ] as const) {
    k.box(u, v, u + 0.6, v + 0.6, 0, 4.4, 0xdfe3e6);
  }
  // Ward towers
  const lo = fh * 3;
  k.box(-23, -1, -3, 15, lo, 44, white);
  for (let z = lo + 0.8; z < 37; z += 3.6) k.box(-23.12, -1.12, -2.88, 15.12, z, z + 1.7, teal);
  k.box(-14, -1.3, -12, 15.3, lo, 37.6, 0xdfe3e6);
  k.box(3, 1, 23, 15, lo, 34, 0xe9eef0);
  for (let z = lo + 0.8; z < 32; z += 3.6) k.box(2.88, 0.88, 23.12, 15.12, z, z + 1.7, teal);
  k.box(17, 6, 21, 12, 34, 36.5, 0xc9ced2);
  // Red cross on the lower tower, helipad on the high one
  k.box(17.3, 0.6, 20.3, 0.9, 29.7, 30.7, red);
  k.box(18.3, 0.6, 19.3, 0.9, 28.7, 31.7, red);
  k.prism(-13, 7, 7, 7, 44, 44.3, 0xe6c13a, 20);
  k.prism(-13, 7, 6.4, 6.4, 44, 44.45, 0x4a4e52, 20);
  k.box(-14.8, 5, -14, 9, 44.45, 44.55, 0xf2f2f2);
  k.box(-12, 5, -11.2, 9, 44.45, 44.55, 0xf2f2f2);
  k.box(-14, 6.6, -12, 7.4, 44.45, 44.55, 0xf2f2f2);
  // 急診: its own canopy and red sign, ambulances waiting under it
  k.box(8, -14, 24, -6, 4.2, 4.8, white);
  k.box(7.9, -14.3, 24.1, -14, 4, 4.9, red);
  for (const u of [8.2, 23.4]) k.box(u, -13.9, u + 0.5, -13.4, 0, 4.2, 0xdfe3e6);
  k.box(12.5, -14.4, 19.5, -14.1, 4.9, 7.5, red);
  k.box(13, -6.12, 19, -6, 0.1, 3, teal);
  for (const u of [11.5, 15, 20.5]) parked(k, u, -13.2, 5.4, 2, 2.5, { body: 0xf7f7f5, stripe: red, lights: [0xe03c31, 0xe03c31] });
  for (const [u, v, s] of [
    [-22, -16, 0.9],
    [-9, -13.8, 0.7],
    [-2, -13.8, 0.7],
    [24, 18, 0.8],
  ] as const) {
    banyan(k, u, v, s);
  }
}

/** 公有停車場: three open decks of cars over a ground floor, a ramp up the side, a pay booth and barrier, and the blue P sign. */
export function parking(k: Kit, w: number, d: number): void {
  const blue = 0x1f5fae;
  const deck = 0xbfc2c4;
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0x9ea3a6);
  k.rect(-6, -15, 6, -10, 0.12, 0x6f7378);
  const levels = [0.1, 3.2, 6.3, 9.4];
  const paints = [0xd9343a, 0xf2f2f2, 0x2f5fa8, 0x3a3d42, 0xc9ced2, 0xe6c13a, 0x3f8f5a, 0xf2f2f2, 0x8a6a4a];
  levels.forEach((z, i) => {
    if (i) {
      k.box(-18, -10, 18, 14, z - 0.35, z, deck);
      band(k, -18, -10, 18, 14, z, z + 1.1, 0xd9dbdc);
      band(k, -18.05, -10.05, 18.05, 14.05, z + 1.1, z + 1.35, blue);
    }
    // Two rows of parked cars on every level, a few spaces empty
    for (const [v0, flip] of [
      [-9.4, false],
      [9.2, true],
    ] as const) {
      for (let j = 0; j < 12; j++) {
        if ((i * 7 + j * 5 + (flip ? 3 : 0)) % 9 === 4) continue;
        const u = -15.4 + j * 2.6;
        const c = paints[(i * 5 + j * 3 + (flip ? 1 : 0)) % paints.length];
        const a = v0;
        k.box(u - 0.9, a, u + 0.9, a + 4.2, z + 0.25, z + 0.95, c);
        k.box(u - 0.8, a + 1, u + 0.8, a + 3.2, z + 0.95, z + 1.45, 0x2c3a46);
        k.box(u - 0.75, a + 1.2, u + 0.75, a + 3, z + 1.45, z + 1.52, c);
      }
    }
  });
  for (const u of [-17.7, -9, 0, 9, 17.7]) for (const v of [-9.7, 2, 13.7]) k.box(u - 0.3, v - 0.3, u + 0.3, v + 0.3, 0, 9.4, 0xc9cbcc);
  // Stair and lift core, the ramp up the side
  k.box(-18, 8, -13, 14, 0, 11.6, 0xe6e3dc);
  band(k, -18.05, 7.95, -12.95, 14.05, 11.2, 11.8, blue);
  k.box(-15.5, 7.88, -14, 8, 9.6, 11, GLASS);
  k.color(0x8f9396).quad([18.2, -13, 0.14], [20, -13, 0.14], [18.2, 8, 3.2], [20, 8, 3.2]);
  k.color(0xd9dbdc).quad([20, -13, 0.14], [20, 8, 3.2], [20, -13, 1.1], [20, 8, 4.3]);
  // Pay booth and barrier at the way in
  k.box(-3.2, -13.4, -1, -11, 0, 2.6, 0xf2f2f2);
  k.box(-3.25, -13.45, -0.95, -13.3, 1.1, 2.2, GLASS);
  hip(k, -3.5, -13.7, -0.7, -10.7, 2.6, 0.6, blue);
  for (let s = 0; s < 4; s++) k.box(-0.8 + s * 1.2, -12.1, 0.4 + s * 1.2, -11.9, 1, 1.15, s % 2 ? 0xf2f2f2 : 0xd9343a);
  // Blue P on a pole at the corner, the name over the roof's front
  k.box(15, -14, 15.35, -13.65, 0, 6.2, STEEL);
  k.box(14.1, -14.25, 16.9, -13.95, 6, 8.8, blue);
  k.box(-8.2, -10.3, 4.2, -10, 10.4, 12.8, blue);
  for (const u of [-6, 2]) k.box(u, -10, u + 0.2, -9.8, 9.4, 10.4, STEEL);
  for (const u of [-18, 18]) shrub(k, u + (u < 0 ? 1 : -1), -14, 0.8);
}

/** One lettered sign: its label and where it hangs on the -v face (or a ±u face) of a facility. */
/**
 * 大學, gathering what Taiwan's campuses are loved for: a low name wall and gate opening onto a
 * 椰林大道 of royal palms over beds of pink azaleas, a 傅鐘-style bell pavilion, tan-tiled
 * 帝大-era halls with long arched arcades and dark tiled hip roofs, a library closing the avenue with
 * a colonnaded front and a central tower, a lake with an island pavilion and a red bridge under
 * willows, a 榕園 lawn round a great banyan, a track, a glass research block and bicycles everywhere.
 */
/** A tall slim royal palm for the 椰林大道: a pale ringed trunk, a green crown shaft and a tight head of fronds. */
function royalPalm(k: Kit, u: number, v: number, h: number): void {
  k.prism(u, v, 0.38, 0.26, 0, h, 0xd7d0c0, 7);
  k.prism(u, v, 0.42, 0.42, h * 0.45, h * 0.47, 0xb9b2a2, 7);
  k.prism(u, v, 0.3, 0.3, h, h + 1.6, 0x6f9a4a, 6);
  k.prism(u, v, 2.6, 0.4, h + 0.6, h + 2.4, 0x4f8f45, 7, u + v);
  k.prism(u, v, 1.3, 0, h + 2.2, h + 3.4, 0x5aa04c, 6, u - v);
}

export function university(k: Kit, w: number, d: number): void {
  const TAN = 0xd4b27e;
  const TAN_DARK = 0xa98552;
  const IVORY = 0xefe6d2;
  const SHADE = 0x4a3f36;
  const SLATE = 0x56524c;
  const RED_TILE = 0x8f4535;
  const LAWN = 0x8cc068;
  const PATH = 0xddd2bf;
  const AZALEA = 0xf08cb4;
  const WATER = 0x4d8fae;
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.08, LAWN);

  /** An arcade on a face at u = uf, facing `dir` (±1 along u), from v0 to v1: piers, arches stepped round, shade behind. */
  const arcadeU = (uf: number, dir: number, v0: number, v1: number, z0: number, h: number, bay: number, c: number) => {
    const t = 0.5;
    const back = uf - dir * 2.4;
    k.box(Math.min(uf, back), v0, Math.max(uf, back), v1, z0, z0 + 0.1, PATH);
    k.box(Math.min(back, back - dir * 0.1), v0, Math.max(back, back - dir * 0.1), v1, z0, z0 + h, SHADE);
    const a = Math.min(uf, uf - dir * t);
    const b = Math.max(uf, uf - dir * t);
    for (let v = v0; v <= v1 + 0.01; v += bay) k.box(a, v - 0.35, b, v + 0.35, z0, z0 + h, c);
    for (let v = v0; v + bay <= v1 + 0.01; v += bay) {
      const w2 = bay - 0.7;
      // Arch: spandrels stepping in towards the crown
      k.box(a, v + 0.35, b, v + bay - 0.35, z0 + h * 0.82, z0 + h, c);
      k.box(a, v + 0.35, b, v + 0.35 + w2 * 0.18, z0 + h * 0.66, z0 + h * 0.82, c);
      k.box(a, v + bay - 0.35 - w2 * 0.18, b, v + bay - 0.35, z0 + h * 0.66, z0 + h * 0.82, c);
      k.box(a, v + 0.35, b, v + 0.35 + w2 * 0.06, z0 + h * 0.56, z0 + h * 0.66, c);
      k.box(a, v + bay - 0.35 - w2 * 0.06, b, v + bay - 0.35, z0 + h * 0.56, z0 + h * 0.66, c);
    }
    k.box(a - 0.1, v0 - 0.4, b + 0.1, v1 + 0.4, z0 + h, z0 + h + 0.35, IVORY);
  };
  /** Tall arched windows on a face at u = uf (dir ±1 outwards). */
  const archWinU = (uf: number, dir: number, v0: number, v1: number, z: number, h: number, bay: number) => {
    const a = dir > 0 ? uf : uf - 0.12;
    for (let v = v0; v + bay * 0.6 <= v1; v += bay) {
      k.box(a, v, a + 0.12, v + bay * 0.5, z, z + h, GLASS);
      k.box(a - 0.02, v - 0.15, a + 0.14, v + bay * 0.5 + 0.15, z + h, z + h + 0.4, IVORY);
    }
  };
  const archWinV = (vf: number, u0: number, u1: number, z: number, h: number, bay: number) => {
    for (let u = u0; u + bay * 0.6 <= u1; u += bay) {
      k.box(u, vf - 0.12, u + bay * 0.5, vf, z, z + h, GLASS);
      k.box(u - 0.15, vf - 0.14, u + bay * 0.5 + 0.15, vf + 0.02, z + h, z + h + 0.4, IVORY);
    }
  };

  // Gate: a low tan wall with the name, square gate piers with lamps, and the guard booth
  k.rect(-7, -45, 7, -38, 0.1, PATH);
  for (const u of [-9, 7]) {
    k.box(u, -45, u + 2, -43, 0, 3.6, TAN_DARK);
    k.box(u - 0.25, -45.25, u + 2.25, -42.75, 3.6, 4, IVORY);
    k.prism(u + 1, -44, 0.45, 0.3, 4, 4.9, 0xf6e9b8, 8);
  }
  k.box(-30, -44.8, -11, -43.2, 0, 2.7, TAN);
  k.box(-30.2, -45, -10.8, -43, 2.7, 3, IVORY);
  k.box(11, -44.8, 26, -43.2, 0, 1.2, TAN);
  for (let u = 11; u <= 26; u += 1.5) k.box(u, -44.1, u + 0.1, -43.9, 1.2, 2.4, 0x2f2f2f);
  k.box(-30, -44.8, -60, -44.4, 0, 0.8, TAN);
  k.box(26, -44.8, 60, -44.4, 0, 0.8, TAN);
  for (const [u0, u1] of [
    [-60, -30],
    [26, 60],
  ] as const) {
    for (let u = u0; u <= u1; u += 2) k.box(u, -44.7, u + 0.1, -44.5, 0.8, 1.9, 0x2f2f2f);
    k.box(u0, -44.7, u1, -44.5, 1.8, 1.9, 0x2f2f2f);
  }

  // 椰林大道: a wide avenue to the library, palms in pairs either side over azalea beds, bicycles along the kerb
  k.rect(-6, -43, 6, 18, 0.12, PATH);
  k.rect(-0.25, -43, 0.25, 18, 0.13, 0xc9bda6);
  for (const s of [-1, 1]) {
    k.rect(s * 6, -42, s * 11, 14, 0.11, 0x7cb35a);
    for (let v = -40; v <= 12; v += 5) {
      royalPalm(k, s * 7.4, v, 13);
      royalPalm(k, s * 10, v + 2.5, 11.5);
    }
    for (let v = -41; v < 14; v += 2.2) {
      k.prism(s * 8.8, v, 0.9, 0.6, 0.1, 0.9, AZALEA, 6, v);
      k.prism(s * 8.8 + 0.5, v + 1, 0.5, 0.3, 0.6, 1.1, 0xf6b6d0, 5);
    }
    // Bicycles parked in short rows outside the halls
    for (const v0 of [-28, -6, 4]) {
      for (let i = 0; i < 7; i++) {
        const v = v0 + i * 0.8;
        k.box(s * 5.6 - 0.8, v, s * 5.6 + 0.8, v + 0.08, 0.35, 0.95, [0x2f2f2f, 0x3f6fae, 0x2f2f2f, 0xc8c8c8][i % 4]);
        k.prism(s * 5.6 - 0.55, v + 0.04, 0.35, 0.35, 0.05, 0.4, 0x222222, 6);
        k.prism(s * 5.6 + 0.55, v + 0.04, 0.35, 0.35, 0.05, 0.4, 0x222222, 6);
      }
    }
  }

  // 傅鐘-style bell pavilion on a stepped base beside the avenue
  const bu = -15;
  const bv = -36;
  k.box(bu - 3, bv - 3, bu + 3, bv + 3, 0, 0.4, 0xb9b0a0);
  k.box(bu - 2.4, bv - 2.4, bu + 2.4, bv + 2.4, 0.4, 0.8, 0xc9c0b0);
  for (const [du, dv] of [
    [-1.8, -1.8],
    [1.8, -1.8],
    [-1.8, 1.8],
    [1.8, 1.8],
  ] as const) {
    k.box(bu + du - 0.3, bv + dv - 0.3, bu + du + 0.3, bv + dv + 0.3, 0.8, 5.2, IVORY);
  }
  k.box(bu - 2.4, bv - 2.4, bu + 2.4, bv + 2.4, 5.2, 5.8, IVORY);
  k.prism(bu, bv, 0.9, 0.6, 3.2, 4.6, 0x3d5a4a, 10);
  k.prism(bu, bv, 0.15, 0.15, 4.6, 5.2, 0x3d5a4a, 4);
  hip(k, bu - 2.9, bv - 2.9, bu + 2.9, bv + 2.9, 5.8, 1.6, SLATE);

  // 帝大-era halls along the avenue: tan tile, two floors over a ground-floor arcade, a stepped entrance bay and dark hip roofs
  const hall = (side: number, v0: number, v1: number) => {
    const inner = side * 14;
    const outer = side * 42;
    const ua = Math.min(inner, outer);
    const ub = Math.max(inner, outer);
    const fh = 4.2;
    const top = fh * 3;
    k.box(ua, v0, ub, v1, 0, top, TAN);
    k.box(ua - 0.05, v0 - 0.05, ub + 0.05, v1 + 0.05, 0, 0.8, TAN_DARK);
    for (let f = 1; f <= 3; f++) k.box(ua - 0.08, v0 - 0.08, ub + 0.08, v1 + 0.08, f * fh - 0.25, f * fh, IVORY);
    // The avenue face: an arcade on the ground floor, arched windows above
    arcadeU(inner, -side, v0 + 1, v1 - 1, 0, fh, 3, TAN);
    archWinU(inner - side * 2.5, -side, v0 + 1.6, v1 - 1, fh + 0.7, 2.6, 3);
    archWinU(inner - side * 2.5, -side, v0 + 1.6, v1 - 1, fh * 2 + 0.7, 2.6, 3);
    for (const vf of [v0, v1]) {
      const sgn = vf === v0 ? -1 : 1;
      for (let f = 0; f < 3; f++) {
        for (let u = ua + 1.5; u < ub - 2; u += 3) k.box(u, sgn < 0 ? vf - 0.12 : vf, u + 1.5, sgn < 0 ? vf : vf + 0.12, f * fh + 1.2, f * fh + 3.2, GLASS);
      }
    }
    // Entrance bay standing proud with a gable-like crown
    const vm = (v0 + v1) / 2;
    const ea = side < 0 ? inner - 0.5 : inner - 1.5;
    k.box(ea, vm - 3.5, ea + 2, vm + 3.5, 0, top + 2.2, IVORY);
    k.box(ea - 0.1, vm - 1.4, ea + 2.1, vm + 1.4, 0, 3.4, SHADE);
    k.box(ea - 0.15, vm - 3.7, ea + 2.15, vm + 3.7, top + 2.2, top + 2.6, TAN_DARK);
    hip(k, ea - 0.4, vm - 4, ea + 2.4, vm + 4, top + 2.6, 2, SLATE);
    hip(k, ua - 0.8, v0 - 0.8, ub + 0.8, v1 + 0.8, top, 3.6, SLATE);
  };
  hall(-1, -34, -15);
  hall(-1, -8, 12);
  hall(1, -34, -15);

  // Library closing the avenue: tan with ivory columns, a central tower and red tiled roofs
  {
    const fh = 4.5;
    const v0 = 22;
    const v1 = 42;
    k.rect(-26, 17, 26, 22, 0.12, PATH);
    k.box(-26, v0, 26, v1, 0, fh * 3, TAN);
    k.box(-26.05, v0 - 0.05, 26.05, v1 + 0.05, 0, 0.9, TAN_DARK);
    for (let f = 1; f <= 3; f++) k.box(-26.1, v0 - 0.1, 26.1, v1 + 0.1, f * fh - 0.25, f * fh, IVORY);
    archWinV(v0, -24, -9, 1.2, 2.8, 2.6);
    archWinV(v0, 9.5, 25, 1.2, 2.8, 2.6);
    archWinV(v0, -24, -9, fh + 1, 2.8, 2.6);
    archWinV(v0, 9.5, 25, fh + 1, 2.8, 2.6);
    archWinV(v0, -24, -9, fh * 2 + 1, 2.8, 2.6);
    archWinV(v0, 9.5, 25, fh * 2 + 1, 2.8, 2.6);
    // Colonnaded front: six ivory columns before a recessed glass hall, steps and a pediment
    k.box(-9, 18.5, 9, v0, 0, 0.6, 0xc9c0b0);
    k.box(-8, 17.6, 8, 18.5, 0, 0.3, 0xc9c0b0);
    k.box(-8, v0 - 0.2, 8, v0, 0.6, fh * 2, 0x6f8fa3);
    for (let i = 0; i < 6; i++) k.prism(-7.5 + i * 3, 19.4, 0.55, 0.5, 0.6, fh * 2, IVORY, 10);
    k.box(-9, 18.4, 9, v0, fh * 2, fh * 2 + 1, IVORY);
    k.quad([-9, 18.4, fh * 2 + 1], [9, 18.4, fh * 2 + 1], [0, 18.4, fh * 2 + 3.2], [0, 18.4, fh * 2 + 3.2]);
    k.box(-9, 18.4, 9, v0, fh * 2 + 1, fh * 3, TAN);
    // Central tower with a clock and a pyramid roof
    k.box(-4.5, 24, 4.5, 33, 0, fh * 3 + 9, TAN);
    for (let z = fh * 3; z < fh * 3 + 8; z += 2.6) k.box(-2, 23.88, 2, 24, z + 0.4, z + 2, GLASS);
    k.prism(0, 23.9, 1.6, 1.6, fh * 3 + 6, fh * 3 + 6.1, IVORY, 16);
    k.box(-4.8, 23.7, 4.8, 33.3, fh * 3 + 9, fh * 3 + 9.6, IVORY);
    k.prism(0, 28.5, 6.4, 0, fh * 3 + 9.6, fh * 3 + 13.6, RED_TILE, 4, Math.PI / 4);
    hip(k, -27, v0 - 1, 27, v1 + 1, fh * 3, 4, RED_TILE);
  }

  // Lake with an island pavilion, a red arched bridge and willows on the right
  {
    const lu = 34;
    const lv = 2;
    for (const [du, dv, r] of [
      [0, 0, 10],
      [9, 3, 8],
      [-7, 5, 6.5],
      [6, -6, 6.5],
      [15, -2, 5],
    ] as const) {
      k.prism(lu + du, lv + dv, r + 0.9, r + 0.9, 0.08, 0.13, 0xb9b0a0, 16);
      k.prism(lu + du, lv + dv, r, r, 0.08, 0.16, WATER, 16);
    }
    // Island pavilion (湖心亭): hexagonal, red columns, curved dark roof
    k.prism(lu + 2, lv, 2.8, 2.8, 0.16, 0.6, 0xb9b0a0, 6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      k.prism(lu + 2 + Math.cos(a) * 2, lv + Math.sin(a) * 2, 0.15, 0.15, 0.6, 3.4, 0xb8312a, 5);
    }
    k.prism(lu + 2, lv, 3.4, 2.4, 3.4, 3.8, SLATE, 6);
    k.prism(lu + 2, lv, 2.4, 0, 3.8, 5.4, SLATE, 6);
    k.prism(lu + 2, lv, 0.2, 0, 5.4, 6.2, 0xd4a93a, 6);
    // Red bridge from the near shore to the pavilion, humped in the middle
    const bv0 = lv - 2.6;
    for (let i = 0; i < 6; i++) {
      const z = 0.3 + Math.sin(((i + 0.5) / 6) * Math.PI) * 0.9;
      const u0 = lu + 2 - 0.9;
      const v = bv0 - 9 + i * 1.5;
      k.box(u0, v, u0 + 1.8, v + 1.5, z, z + 0.2, 0xb8312a);
      k.box(u0, v, u0 + 0.12, v + 1.5, z + 0.2, z + 0.9, 0xb8312a);
      k.box(u0 + 1.68, v, u0 + 1.8, v + 1.5, z + 0.2, z + 0.9, 0xb8312a);
    }
    // Willows round the shore
    for (const [du, dv] of [
      [-14, -4],
      [-10, 10],
      [4, 12],
      [18, 8],
      [22, -6],
      [-6, -10],
    ] as const) {
      k.prism(lu + du, lv + dv, 0.3, 0.25, 0, 3.6, 0x6b5440, 5);
      k.prism(lu + du, lv + dv, 1.2, 2.8, 2, 5.6, 0x8fbf5a, 7);
      k.prism(lu + du, lv + dv, 2.8, 1.2, 5.6, 6.6, 0x9ccb64, 7);
    }
  }

  // 榕園: a round lawn with one great banyan, ringed by a path and benches
  k.prism(-52, -32, 9, 9, 0.08, 0.11, PATH, 20);
  k.prism(-52, -32, 7.8, 7.8, 0.08, 0.14, 0x7fb860, 20);
  banyan(k, -52, -32, 1.9);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.box(-52 + Math.cos(a) * 8.3 - 0.6, -32 + Math.sin(a) * 8.3 - 0.2, -52 + Math.cos(a) * 8.3 + 0.6, -32 + Math.sin(a) * 8.3 + 0.2, 0, 0.45, 0x8a6a4a);
  }

  // Track and field at the back left, with a small stand
  {
    const pu = 0xc8664a;
    const cu = -44;
    const cv = 30;
    k.prism(cu - 6, cv, 9, 9, 0.1, 0.16, pu, 16);
    k.prism(cu + 6, cv, 9, 9, 0.1, 0.16, pu, 16);
    k.rect(cu - 6, cv - 9, cu + 6, cv + 9, 0.16, pu);
    k.prism(cu - 6, cv, 6.4, 6.4, 0.1, 0.2, 0x6fb556, 16);
    k.prism(cu + 6, cv, 6.4, 6.4, 0.1, 0.2, 0x6fb556, 16);
    k.rect(cu - 6, cv - 6.4, cu + 6, cv + 6.4, 0.2, 0x6fb556);
    k.rect(cu - 0.1, cv - 6.4, cu + 0.1, cv + 6.4, 0.22, 0xf2f2f2);
    for (let i = 0; i < 3; i++) k.box(cu - 8, cv - 10 - i * 0.8, cu + 8, cv - 9.2 - i * 0.8, 0, 0.5 + i * 0.5, 0xc9c6bf);
    k.box(cu - 8.4, cv - 12.6, cu + 8.4, cv - 9, 3, 3.25, 0x2f6fb8);
    for (const u of [cu - 8, cu + 8]) k.box(u - 0.1, cv - 12.4, u + 0.1, cv - 12.2, 0, 3, STEEL);
  }

  // Glass research block on a tan base at the back right
  {
    const u0 = 34;
    const u1 = 58;
    const v0 = 20;
    const v1 = 42;
    k.box(u0, v0, u1, v1, 0, 4.4, TAN);
    k.box(u0 + 1, v0 + 1, u1 - 1, v1 - 1, 4.4, 26, 0x6f98b3);
    for (let z = 4.4; z < 26; z += 3.6) k.box(u0 + 0.9, v0 + 0.9, u1 - 0.9, v1 - 0.9, z, z + 0.35, 0xdfe6ea);
    for (let u = u0 + 1; u <= u1 - 1; u += 3) k.box(u - 0.12, v0 + 0.85, u + 0.12, v0 + 1, 4.4, 26, 0xdfe6ea);
    band(k, u0 + 1, v0 + 1, u1 - 1, v1 - 1, 26, 27, 0xdfe6ea, 0.3);
    k.rect(u0 + 1, v0 + 1, u1 - 1, v1 - 1, 26.05, ROOF_SLAB);
    k.rect(u0 + 3, v0 + 3, u0 + 12, v0 + 10, 26.1, 0x7cb35a);
  }

  // Paths, more trees and bicycle racks between the buildings
  k.rect(-56, -12, -14, -10, 0.12, PATH);
  k.rect(11, -12, 24, -10, 0.12, PATH);
  k.rect(-30, 14, -11, 17, 0.12, PATH);
  for (const [u, v, s] of [
    [-50, -4, 0.8],
    [-52, 8, 0.9],
    [-28, -41, 0.6],
    [50, -36, 0.9],
    [54, -22, 0.7],
    [-14, 18, 0.6],
    [14, 16, 0.6],
  ] as const) {
    banyan(k, u, v, s);
  }
  for (let v = -40; v < -36; v += 0.7) k.box(46, v, 48.2, v + 0.12, 0, 0.9, 0x2f2f2f);
}

export interface SignSpec {
  label: string;
  u0: number;
  u1: number;
  z0: number;
  z1: number;
  /** the plane it sits on: v for a front face */
  v: number;
}

export type SignLabel = 'school' | 'park' | 'police' | 'fire' | 'fireTower' | 'hospital' | 'er' | 'parking' | 'parkingP' | 'cityHall' | 'university';

/** Text and colours of each sign; `vertical` signs read top to bottom, Taiwanese style. */
export const SIGN_LABELS: Record<SignLabel, { text: string; bg: string; fg: string; vertical?: boolean }> = {
  school: { text: '市立國民小學', bg: '#efe3c6', fg: '#7a2318' },
  park: { text: '公園', bg: '#6d6a62', fg: '#f4efe2' },
  police: { text: '警察局', bg: '#1f4e9c', fg: '#ffffff' },
  fire: { text: '消防局', bg: '#c8231e', fg: '#ffffff' },
  fireTower: { text: '消防分隊', bg: '#c8231e', fg: '#ffffff', vertical: true },
  hospital: { text: '市立醫院', bg: '#f2f4f5', fg: '#c8102e' },
  er: { text: '急診', bg: '#d0242b', fg: '#ffffff' },
  parking: { text: '公有停車場', bg: '#1f5fae', fg: '#ffffff' },
  parkingP: { text: 'P', bg: '#1f5fae', fg: '#ffffff' },
  cityHall: { text: '市政府', bg: '#d2c6ab', fg: '#5a3a1a' },
  university: { text: '大學', bg: '#ece2cc', fg: '#7a2318' },
};

/** Where each service's signs hang, matching the models above. */
export const SIGNS: Partial<Record<string, SignSpec[]>> = {
  school: [{ label: 'school', u0: -19.9, u1: -10.1, z0: 0.9, z1: 2.95, v: -21.45 }],
  park: [{ label: 'park', u0: -8.4, u1: -4.8, z0: 0.3, z1: 1.35, v: -19.35 }],
  police: [{ label: 'police', u0: -4.7, u1: 4.7, z0: 4.65, z1: 6.95, v: -3.5 }],
  fire: [
    { label: 'fire', u0: -9.6, u1: 2.6, z0: 6.05, z1: 8.25, v: -6.4 },
    { label: 'fireTower', u0: 12.4, u1: 14.4, z0: 7, z1: 17, v: -0.35 },
  ],
  hospital: [
    { label: 'hospital', u0: -21.5, u1: -4.5, z0: 38.6, z1: 42.6, v: -1.2 },
    { label: 'er', u0: 13, u1: 19, z0: 5.05, z1: 7.35, v: -14.45 },
  ],
  university: [{ label: 'university', u0: -27, u1: -14, z0: 0.6, z1: 2.4, v: -44.85 }],
  cityHall: [{ label: 'cityHall', u0: -4.5, u1: 4.5, z0: 9.1, z1: 10.5, v: -13.8 }],
  parking: [
    { label: 'parking', u0: -8, u1: 4, z0: 10.5, z1: 12.7, v: -10.35 },
    { label: 'parkingP', u0: 14.25, u1: 16.75, z0: 6.15, z1: 8.65, v: -14.3 },
  ],
};

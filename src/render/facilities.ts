import * as THREE from 'three';
import { type Facility, dims, toWorld } from '../sim/facilities';
import { hash01 } from '../sim/geometry';
import { Builder } from './roadMesh';
import { arena, cityHall, dragonTiger, ferrisWheel, tower85 } from './landmarks';
import { SIGNS, SIGN_LABELS, type SignLabel, fire, hospital, park, parking, police, school } from './civic';

type P3 = [number, number, number];

/** Low-poly shapes in a facility's own frame: u along the street, v back from it (front at -d/2), z up. */
export class Kit {
  constructor(
    private b: Builder,
    private f: Facility,
  ) {}

  private w(p: P3): number[] {
    const q = toWorld(this.f, p[0], p[1]);
    return [q.x, q.y, p[2]];
  }

  color(c: number): this {
    this.b.color = new THREE.Color(c);
    return this;
  }

  quad(a: P3, b: P3, c: P3, d: P3): void {
    this.b.quad(this.w(a), this.w(b), this.w(c), this.w(d));
  }

  rect(u0: number, v0: number, u1: number, v1: number, z: number, c: number): void {
    this.color(c).quad([u0, v0, z], [u1, v0, z], [u0, v1, z], [u1, v1, z]);
  }

  box(u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, c: number): void {
    this.color(c);
    const k: [number, number][] = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
    for (let i = 0; i < 4; i++) {
      const [pu, pv] = k[i];
      const [qu, qv] = k[(i + 1) % 4];
      this.quad([pu, pv, z1], [pu, pv, z0], [qu, qv, z1], [qu, qv, z0]);
    }
    this.quad([u0, v0, z1], [u1, v0, z1], [u0, v1, z1], [u1, v1, z1]);
  }

  /** Upright frustum (or cone when r1 is 0) with `sides` faces, capped on top. */
  prism(cu: number, cv: number, r0: number, r1: number, z0: number, z1: number, c: number, sides = 8, turn = 0): void {
    this.color(c);
    const at = (r: number, k: number, z: number): P3 => {
      const a = turn + (k / sides) * Math.PI * 2;
      return [cu + Math.cos(a) * r, cv + Math.sin(a) * r, z];
    };
    for (let k = 0; k < sides; k++) {
      this.quad(at(r1, k, z1), at(r0, k, z0), at(r1, k + 1, z1), at(r0, k + 1, z0));
      if (r1 > 0) this.quad([cu, cv, z1], [cu, cv, z1], at(r1, k, z1), at(r1, k + 1, z1));
    }
  }

  tree(u: number, v: number, s = 1): void {
    this.prism(u, v, 0.3 * s, 0.3 * s, 0, 2 * s, 0x7a5a3c, 5);
    this.prism(u, v, 2.2 * s, 0, 1.6 * s, 6.5 * s, 0x4f8f45, 6);
  }
}

/** Glass offices stepping back in green terraces, with a garden on the roof. */
function greenBuilding(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0xa7c49a);
  const glass = 0x7fb0c6;
  const steps = [
    [-14, -10, 14, 12, 0, 14],
    [-12, -6, 12, 12, 14, 28],
    [-10, -2, 10, 12, 28, 42],
  ];
  for (const [u0, v0, u1, v1, z0, z1] of steps) {
    k.box(u0, v0, u1, v1, z0, z1, glass);
    for (let z = z0 + 3.5; z < z1; z += 3.5) k.box(u0 - 0.1, v0 - 0.1, u1 + 0.1, v1 + 0.1, z, z + 0.6, 0xe8efe9);
    // Planted terrace in front of the next step up
    k.box(u0 - 0.4, v0 - 0.4, u1 + 0.4, v0 + 4, z1, z1 + 1, 0x5aa04e);
  }
  // Green wall up one side
  k.box(14, -10, 14.6, 12, 0, 14, 0x4f8f45);
  for (const [u, v] of [[-6, 6], [5, 8], [0, 3]]) k.tree(u, v, 0.55);
  k.box(-6, 6, 6, 9, 42, 43, 0x5aa04e);
  for (const u of [-13, -6, 6, 13]) k.tree(u, -14, 0.7);
}

/** Paved square with lawns, a fountain and shade trees. */
function plaza(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.12, 0xd9cfbd);
  for (const [su, sv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.rect(su * 4, sv * 4, su * 16, sv * 16, 0.16, 0x86c062);
  k.prism(0, 0, 4.5, 4.5, 0.1, 0.9, 0xbfb7a6, 12);
  k.prism(0, 0, 3.8, 3.8, 0.9, 1, 0x6fb7e0, 12);
  k.prism(0, 0, 0.5, 0.2, 1, 3.4, 0xe6f4fb, 6);
  for (const [u, v] of [[-12, -12], [12, -12], [-12, 12], [12, 12], [-16, 0], [16, 0], [0, 16]]) k.tree(u, v, 0.9);
}

/** Wetland, ponds and woods with a boardwalk through them. */
function ecoPark(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.12, 0x7fb860);
  k.prism(-12, 6, 18, 18, 0.1, 0.24, 0x4f97bf, 14, 0.3);
  k.prism(20, -8, 10, 10, 0.1, 0.24, 0x4f97bf, 10);
  k.box(-36, -2, 36, 1, 0.3, 0.7, 0xa47c55);
  k.box(-2, -d / 2, 1, -2, 0.3, 0.7, 0xa47c55);
  // Reeds at the water's edge, a bird hide on the pond
  for (let a = 0; a < 12; a++) k.prism(-12 + Math.cos(a) * 17, 6 + Math.sin(a) * 17, 0.6, 0.1, 0, 1.6, 0x9abf5a, 4);
  k.box(-14, 4, -9, 8, 0.6, 3.5, 0x8a6a48);
  const trees: [number, number, number][] = [];
  for (let i = 0; i < 40; i++) {
    const u = ((i * 37) % 76) - 38;
    const v = ((i * 53) % 66) - 33;
    if (Math.hypot(u + 12, v - 6) < 20 || Math.hypot(u - 20, v + 8) < 12 || Math.abs(v) < 4) continue;
    trees.push([u, v, 0.8 + ((i * 7) % 5) * 0.12]);
  }
  for (const [u, v, sc] of trees) k.tree(u, v, sc);
}

/** A walkway over the road on two piers, with stairs down to each kerb. */
function footbridge(k: Kit, w: number, d: number): void {
  const deck = 5.6;
  const end = d / 2 - 2.2;
  k.box(-w / 2, -end, w / 2, end, deck, deck + 0.7, 0xc9c4ba);
  for (const side of [-1, 1]) {
    k.box(-w / 2, -end, -w / 2 + 0.2, end, deck + 0.7, deck + 1.9, 0x5e8fa8);
    k.box(w / 2 - 0.2, -end, w / 2, end, deck + 0.7, deck + 1.9, 0x5e8fa8);
    const v0 = side * end;
    const v1 = side * (d / 2);
    const [lo, hi] = side > 0 ? [v0, v1] : [v1, v0];
    k.box(-w / 2, lo, w / 2, hi, deck - 0.4, deck + 0.7, 0xc9c4ba);
    k.box(-1, side * (end - 1) - 0.8, 1, side * (end - 1) + 0.8, 0, deck, 0xa9a49a);
    // Stairs run down along the kerb
    k.color(0xb5b0a6).quad([-w / 2, lo, deck + 0.7], [-w / 2 - 11, lo, 0.1], [-w / 2, hi, deck + 0.7], [-w / 2 - 11, hi, 0.1]);
  }
}

/** Castle, roller coaster, carousel and a drop tower among paths and trees. */
function themePark(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0x9ccc74);
  k.rect(-4, -d / 2, 4, d / 2 - 10, 0.14, 0xe2cfa6);
  k.rect(-w / 2 + 8, -6, w / 2 - 8, 2, 0.14, 0xe2cfa6);
  // Gate
  k.box(-14, -d / 2 + 2, -6, -d / 2 + 6, 0, 10, 0xff7eb6);
  k.box(6, -d / 2 + 2, 14, -d / 2 + 6, 0, 10, 0xff7eb6);
  k.box(-14, -d / 2 + 2, 14, -d / 2 + 6, 10, 13, 0xffd166);
  // Castle at the end of the main street
  k.box(-14, 30, 14, 52, 0, 18, 0xf3e9f7);
  for (const [u, v] of [[-14, 30], [14, 30], [-14, 52], [14, 52]]) {
    k.prism(u, v, 3.5, 3.5, 0, 26, 0xf3e9f7, 8);
    k.prism(u, v, 4.2, 0, 26, 36, 0x6a5acd, 8);
  }
  k.prism(0, 41, 6, 6, 18, 38, 0xf3e9f7, 8);
  k.prism(0, 41, 7, 0, 38, 54, 0x6a5acd, 8);
  // Roller coaster: a looping track on posts
  const n = 48;
  const track = (i: number): P3 => {
    const a = (i / n) * Math.PI * 2;
    return [-40 + Math.cos(a) * 28, 18 + Math.sin(a) * 20, 6 + 12 * (0.5 + 0.5 * Math.sin(a * 3))];
  };
  for (let i = 0; i < n; i++) {
    const p = track(i);
    const q = track(i + 1);
    k.color(0xe4572e).quad([p[0], p[1] - 0.9, p[2]], [p[0], p[1] + 0.9, p[2]], [q[0], q[1] - 0.9, q[2]], [q[0], q[1] + 0.9, q[2]]);
    if (i % 4 === 0) k.prism(p[0], p[1], 0.35, 0.35, 0, p[2], 0xdddddd, 4);
  }
  // Carousel and drop tower
  k.prism(40, 22, 10, 10, 0, 1, 0xffd166, 12);
  k.prism(40, 22, 0.8, 0.8, 1, 8, 0xf2f2f2, 8);
  k.prism(40, 22, 11, 0, 8, 13, 0xe63946, 12);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.box(40 + Math.cos(a) * 7 - 0.8, 22 + Math.sin(a) * 7 - 0.8, 40 + Math.cos(a) * 7 + 0.8, 22 + Math.sin(a) * 7 + 0.8, 1, 3, 0xf4f1de);
  }
  k.box(44, -36, 50, -30, 0, 62, 0xd9d9d9);
  k.box(43, -37, 51, -29, 40, 44, 0x2e86ab);
  for (const [u, v] of [[-60, -40], [-50, -46], [-20, -40], [20, -40], [60, -10], [62, 40], [-62, 46], [24, 48]]) k.tree(u, v, 1);
}

/** A big shopping mall: glass atrium between two blocks, signage and a car park. */
function mall(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0x8f959a);
  for (let u = -w / 2 + 4; u < w / 2 - 4; u += 6) k.rect(u, -d / 2 + 2, u + 0.3, -d / 2 + 16, 0.14, 0xf2f2f2);
  k.box(-50, -18, -10, 38, 0, 26, 0xe8e2d6);
  k.box(10, -18, 50, 38, 0, 26, 0xe8e2d6);
  k.box(-10, -14, 10, 34, 0, 30, 0x8fc7dd);
  k.prism(0, 10, 9, 4, 30, 36, 0xbfe3ef, 8);
  for (const s of [-1, 1]) {
    k.box(s * 50, -18.2, s * 10, -18, 18, 22, 0x7ec8e3);
    k.box(s * 50, -18.3, s * 10, 38.3, 26, 27.4, 0xd0c8b8);
  }
  k.box(-12, -19, 12, -18, 24, 29, 0xe63946);
  for (const u of [-40, -28, 28, 40]) k.tree(u, -22, 0.7);
}

const MODELS: Record<Facility['kind'], (k: Kit, w: number, d: number) => void> = {
  park,
  school,
  police,
  fire,
  hospital,
  tower85,
  cityHall,
  dragonTiger,
  ferrisWheel,
  arena,
  themePark,
  mall,
  greenBuilding,
  plaza,
  ecoPark,
  footbridge,
  parking,
  cargoPort,
  cruisePort,
};

/** Container colours: the shipping lines' reds, blues, greens, oranges and greys. */
const BOXES = [0xc8442f, 0x2f5fa8, 0x3f8f5a, 0xe08a2e, 0x8d8a85, 0xe9ecee, 0x1f7f8f, 0xb5523b, 0xd9b23a];
const box = (i: number, j: number) => BOXES[Math.floor(hash01(i * 1.7 + 3, j * 2.3 + 1) * BOXES.length)];

/** One STS gantry crane on the quay, legs on rails at v0 and v1, its boom reaching out over the berth. */
function gantry(k: Kit, u: number, v0: number, v1: number, reach: number): void {
  const red = 0xd9343a;
  const white = 0xf2f3f4;
  for (const v of [v0, v1]) {
    for (const du of [-6, 6]) k.box(u + du - 0.6, v - 0.6, u + du + 0.6, v + 0.6, 0.3, 30, red);
    k.box(u - 6.6, v - 0.8, u + 6.6, v + 0.8, 0.3, 1.6, 0x5f6366);
  }
  // Cross beams, the girder out over the water and the machinery house at the back
  for (const z of [12, 29]) for (const du of [-6, 6]) k.box(u + du - 0.4, v0, u + du + 0.4, v1, z, z + 1, white);
  for (const du of [-2.2, 2.2]) k.box(u + du - 0.7, v0 - 14, u + du + 0.7, reach, 30, 32.4, du < 0 ? red : white);
  k.box(u - 4, v0 - 14, u + 4, v0 - 4, 32.4, 36, white);
  k.box(u - 1.2, v1 - 2, u + 1.2, v1 + 2, 26, 29, 0x2f3f5a);
  // Stays from the apex to the boom
  k.box(u - 0.5, v1 - 1, u + 0.5, v1 + 1, 32.4, 42, red);
  k.box(u - 0.3, v1, u + 0.3, reach - 6, 40, 40.6, white);
}

/** A container ship (or one moored), bow along +u, its hull from v0 to v1. */
function containerShip(k: Kit, u0: number, u1: number, v0: number, v1: number): void {
  k.box(u0 + 6, v0, u1 - 8, v1, -4, 3.5, 0x23324a);
  k.box(u0 + 6, v0 - 0.05, u1 - 8, v1 + 0.05, -4, -1.6, 0xa8322a);
  // Bow tapers
  k.box(u1 - 8, v0 + 2, u1 - 2, v1 - 2, -3, 3.5, 0x23324a);
  k.box(u1 - 2, v0 + 5, u1, v1 - 5, -2, 3.5, 0x23324a);
  k.box(u0 + 2, v0 + 1, u0 + 6, v1 - 1, -3, 3.5, 0x23324a);
  // Bridge and funnel at the stern
  k.box(u0 + 4, v0 + 1.5, u0 + 13, v1 - 1.5, 3.5, 17, 0xf2f3f4);
  k.box(u0 + 4, v0 + 1, u0 + 13, v1 - 1, 15.2, 16.2, 0x2f3f5a);
  k.box(u0 + 2, v0 + 5, u0 + 6, v1 - 5, 14, 21, 0xd9343a);
  // Rows of containers, two to four high
  let i = 0;
  for (let u = u0 + 15; u < u1 - 12; u += 6.4) {
    const tiers = 2 + Math.floor(hash01(u, v0) * 3);
    for (let t = 0; t < tiers; t++) {
      for (let v = v0 + 1; v < v1 - 2; v += 2.5) k.box(u, v, u + 6.1, v + 2.4, 3.5 + t * 2.6, 6 + t * 2.6, box(i++, t));
    }
  }
}

/**
 * 貨櫃港, after Kaohsiung's container terminals: a quay deck standing in the sea, red-and-white
 * ship-to-shore gantry cranes along the berth, stacks of containers in the yard, a gate by the road,
 * a warehouse, and a container ship at the berth (the back 30% of the depth is open water).
 */
function cargoPort(k: Kit, w: number, d: number): void {
  const berth = d / 2 - d * 0.3;
  k.box(-w / 2, -d / 2, w / 2, berth, -7, 0.3, 0xa9a59c);
  k.rect(-w / 2, -d / 2, w / 2, berth, 0.32, 0x8f8c86);
  // Quay edge: yellow line, fenders and bollards
  k.rect(-w / 2, berth - 1.2, w / 2, berth - 0.8, 0.36, 0xf2c12e);
  for (let u = -w / 2 + 6; u < w / 2; u += 12) {
    k.prism(u, berth - 2, 0.4, 0.35, 0.3, 1.1, 0x2a2a2a, 6);
    k.box(u - 1, berth, u + 1, berth + 0.6, -2.5, 0.2, 0x2a2a2a);
  }
  // Crane rails
  for (const v of [berth - 18, berth - 6]) k.rect(-w / 2, v - 0.3, w / 2, v + 0.3, 0.36, 0x5f6366);
  for (const u of [-52, -10, 32]) gantry(k, u, berth - 18, berth - 6, berth + 34);
  // Container yard in blocks, lanes between them
  let i = 0;
  for (let v = -d / 2 + 16; v < berth - 24; v += 3) {
    if (Math.abs(v - (-d / 2 + 30)) < 2) continue;
    for (let u = -w / 2 + 8; u < w / 2 - 44; u += 13) {
      const tiers = 1 + Math.floor(hash01(u * 0.3, v * 0.7) * 4);
      for (let t = 0; t < tiers; t++) k.box(u, v, u + 12.2, v + 2.5, 0.3 + t * 2.6, 2.9 + t * 2.6, box(i++, t));
    }
  }
  // Rubber-tyred gantries over the yard
  for (const u of [-w / 2 + 34, -w / 2 + 73]) {
    for (const v of [-d / 2 + 14, berth - 23]) k.box(u - 0.5, v - 0.5, u + 0.5, v + 0.5, 0.3, 14, 0xf2c12e);
    k.box(u - 0.6, -d / 2 + 14, u + 0.6, berth - 23, 13, 15, 0xf2c12e);
  }
  // Warehouse with a blue roof, and the gate with its booths and barriers by the road
  k.box(w / 2 - 40, -d / 2 + 14, w / 2 - 6, berth - 26, 0.3, 11, 0xdfe3e6);
  k.box(w / 2 - 40.5, -d / 2 + 13.5, w / 2 - 5.5, berth - 25.5, 11, 12.2, 0x2f6fb0);
  for (let u = w / 2 - 37; u < w / 2 - 8; u += 7) k.box(u, -d / 2 + 13.9, u + 4.5, -d / 2 + 14, 0.3, 5, 0x7c8287);
  k.box(-w / 2 + 2, -d / 2 + 2, -w / 2 + 26, -d / 2 + 4, 6, 7, 0xd9343a);
  for (const u of [-w / 2 + 6, -w / 2 + 14, -w / 2 + 22]) {
    k.box(u - 1, -d / 2 + 4, u + 1, -d / 2 + 6, 0.3, 3, 0xf2f3f4);
    k.box(u + 1, -d / 2 + 4.8, u + 4, -d / 2 + 5.2, 1.2, 1.4, 0xf2c12e);
  }
  // A container ship at the berth
  containerShip(k, -w / 2 + 6, w / 2 - 6, berth + 3, berth + 3 + d * 0.3 - 6);
}

/** A ferry to Xiaoliuqiu: white hull with a blue stripe, a two-deck cabin with dark windows. */
function ferry(k: Kit, u0: number, u1: number, v0: number, v1: number): void {
  k.box(u0 + 1.5, v0, u1 - 3, v1, -1.6, 1.4, 0xf5f5f5);
  k.box(u1 - 3, v0 + 1, u1, v1 - 1, -1.2, 1.4, 0xf5f5f5);
  k.box(u0 + 1.5, v0 - 0.05, u1 - 3, v1 + 0.05, -0.2, 0.5, 0x1f5fa8);
  k.box(u0 + 3, v0 + 0.6, u1 - 6, v1 - 0.6, 1.4, 4, 0xf2f3f4);
  k.box(u0 + 3, v0 + 0.55, u1 - 6, v1 - 0.55, 2.3, 3.3, 0x2a3a4a);
  k.box(u0 + 6, v0 + 1, u1 - 9, v1 - 1, 4, 6, 0xf2f3f4);
  k.box(u0 + 6, v0 + 0.95, u1 - 9, v1 - 0.95, 4.6, 5.4, 0x2a3a4a);
  k.box(u0 + 4, v0 + 2, u0 + 6, v1 - 2, 4, 7, 0x3fa7d6);
}

/**
 * 旅遊港, after the Donggang ferry pier (東港渡船頭) for Xiaoliuqiu: a red gate arch by the road, a white
 * terminal under a blue-green roof with a big red name board, a covered walkway out to floating
 * pontoons, and white-and-blue ferries tied up alongside.
 */
function cruisePort(k: Kit, w: number, d: number): void {
  const berth = d / 2 - d * 0.3;
  k.box(-w / 2, -d / 2, w / 2, berth, -7, 0.3, 0xb9b3a6);
  k.rect(-w / 2, -d / 2, w / 2, berth, 0.32, 0xd6cdb8);
  k.rect(-w / 2, berth - 1, w / 2, berth - 0.5, 0.36, 0xf2c12e);
  // Gate arch at the road
  for (const u of [-9, 9]) k.box(u - 0.8, -d / 2 + 1, u + 0.8, -d / 2 + 2.6, 0.3, 7, 0xc8302a);
  k.box(-11, -d / 2 + 0.8, 11, -d / 2 + 2.8, 7, 8.6, 0xc8302a);
  k.box(-11.8, -d / 2 + 0.4, 11.8, -d / 2 + 3.2, 8.6, 9.2, 0x2f7f6f);
  // Terminal: white walls, ticket hall glazing, a blue-green hipped roof and the big name board
  const t0 = -d / 2 + 8;
  const t1 = t0 + 18;
  k.box(-36, t0, 8, t1, 0.3, 9, 0xf4f4f2);
  k.box(-35.9, t0 - 0.05, 7.9, t1 + 0.05, 1.5, 4, 0x6f93ad);
  k.box(-35.9, t0 - 0.05, 7.9, t1 + 0.05, 5.5, 7.6, 0x6f93ad);
  k.box(-37.5, t0 - 1.5, 9.5, t1 + 1.5, 9, 10, 0x2f7f6f);
  k.box(-33, t0 + 1.5, 5, t1 - 1.5, 10, 11.6, 0x2f7f6f);
  k.box(-28, t0 + 4, -2, t1 - 4, 11.6, 12.6, 0x2f7f6f);
  k.box(-26, t0 - 1.7, -6, t0 - 1.2, 10.5, 15, 0xc8302a);
  k.box(-25.4, t0 - 1.8, -6.6, t0 - 1.7, 11.2, 14.3, 0xf2c12e);
  // Covered walkway from the terminal out over the water to the pontoons
  for (let v = t1; v < berth + 14; v += 6) for (const u of [-1.5, 4.5]) k.box(u - 0.3, v - 0.3, u + 0.3, v + 0.3, -0.5, 3.6, 0xf2f3f4);
  k.box(-2.3, t1, 5.3, berth + 14, 3.6, 4.2, 0x2f7f6f);
  k.box(-1.2, berth, 4.2, berth + 14, -0.2, 0.25, 0xb9b6ae);
  // Floating pontoons
  k.box(-24, berth + 14, 30, berth + 19, -1.1, -0.35, 0xd9d4c7);
  for (let u = -22; u < 30; u += 6) k.prism(u, berth + 16.5, 0.25, 0.25, -0.35, 0.5, 0x2a2a2a, 6);
  // Ferries tied up either side of the walkway
  ferry(k, -30, -4, berth + 19.5, berth + 25.5);
  ferry(k, 8, 32, berth + 19.5, berth + 25);
  ferry(k, 10, 34, berth + 4, berth + 10);
  // Benches and palms on the forecourt
  for (const u of [-30, 20, 34]) {
    k.prism(u, -d / 2 + 5, 0.25, 0.2, 0.3, 6, 0x8a6a4a, 5);
    k.prism(u, -d / 2 + 5, 2.6, 0, 5.4, 7, 0x4f8f45, 6);
  }
}

/** Every park, school, station, hospital and landmark as one coloured mesh. */
export function buildFacilityGeometry(facilities: Iterable<Facility>): THREE.BufferGeometry {
  const b = new Builder(0);
  for (const f of facilities) {
    const { w, d } = dims(f);
    MODELS[f.kind](new Kit(b, f), w, d);
  }
  return b.geometry();
}

const ATLAS = 1024;
/** Pixel height of a horizontal sign in the atlas; vertical signs are this wide. */
const SIGN_PX = 128;

/** Where each sign's lettering sits in the atlas, as uv corners. */
let atlasRects: Record<SignLabel, { x0: number; y0: number; x1: number; y1: number; vertical: boolean }> | null = null;

function signAspect(label: SignLabel): number {
  for (const list of Object.values(SIGNS)) {
    for (const s of list ?? []) if (s.label === label) return (s.u1 - s.u0) / (s.z1 - s.z0);
  }
  return 3;
}

/**
 * The lettered signs of the public services drawn once into a canvas: each label filled with its
 * colour and its characters spaced across it (stacked top to bottom on a vertical sign).
 */
export function signAtlas(): THREE.CanvasTexture {
  // Lay the labels out in rows first, then size the canvas to fit them
  const labels = Object.entries(SIGN_LABELS) as [SignLabel, (typeof SIGN_LABELS)[SignLabel]][];
  const cells: { label: SignLabel; x: number; y: number; w: number; h: number }[] = [];
  let x = 0;
  let y = 0;
  let row = 0;
  for (const [label, spec] of labels) {
    const a = signAspect(label);
    const w = Math.round(spec.vertical ? SIGN_PX : Math.min(ATLAS, SIGN_PX * a));
    const h = Math.round(spec.vertical ? Math.min(ATLAS, SIGN_PX / a) : SIGN_PX);
    if (x + w > ATLAS) {
      x = 0;
      y += row + 4;
      row = 0;
    }
    cells.push({ label, x, y, w, h });
    x += w + 4;
    row = Math.max(row, h);
  }
  const height = 2 ** Math.ceil(Math.log2(y + row));
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  const rects = {} as NonNullable<typeof atlasRects>;
  for (const { label, x, y, w, h } of cells) {
    const spec = SIGN_LABELS[label];
    const vertical = !!spec.vertical;
    g.fillStyle = spec.bg;
    g.fillRect(x, y, w, h);
    g.strokeStyle = spec.fg;
    g.globalAlpha = 0.35;
    g.lineWidth = 4;
    g.strokeRect(x + 6, y + 6, w - 12, h - 12);
    g.globalAlpha = 1;
    g.fillStyle = spec.fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const chars = [...spec.text];
    const along = vertical ? h : w;
    const across = vertical ? w : h;
    const size = Math.min(across * 0.66, (along * 0.84) / chars.length);
    g.font = `700 ${Math.round(size)}px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", sans-serif`;
    const step = (along - size * 0.6) / chars.length;
    chars.forEach((c, i) => {
      const t = size * 0.3 + step * (i + 0.5);
      g.fillText(c, vertical ? x + w / 2 : x + t, vertical ? y + t : y + h / 2 + size * 0.04);
    });
    rects[label] = { x0: x / ATLAS, y0: 1 - y / height, x1: (x + w) / ATLAS, y1: 1 - (y + h) / height, vertical };
  }
  atlasRects = rects;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Every service's lettered signs, as textured quads on its facade facing the street. Call signAtlas() first. */
export function buildFacilitySigns(facilities: Iterable<Facility>): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const f of facilities) {
    for (const s of SIGNS[f.kind] ?? []) {
      const r = atlasRects?.[s.label];
      if (!r) continue;
      const i = pos.length / 3;
      // Seen from the street (looking along +v), +u is on the viewer's left
      for (const [u, z, tu, tv] of [
        [s.u1, s.z1, r.x0, r.y0],
        [s.u0, s.z1, r.x1, r.y0],
        [s.u1, s.z0, r.x0, r.y1],
        [s.u0, s.z0, r.x1, r.y1],
      ]) {
        const q = toWorld(f, u, s.v);
        pos.push(q.x, z, q.y);
        uv.push(tu, tv);
      }
      idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

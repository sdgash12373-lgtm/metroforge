import * as THREE from 'three';
import { type Facility, dims, toWorld } from '../sim/facilities';
import { hash01 } from '../sim/geometry';
import { Builder } from './roadMesh';

type P3 = [number, number, number];

/** Low-poly shapes in a facility's own frame: u along the street, v back from it (front at -d/2), z up. */
class Kit {
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

function park(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.12, 0x8cc56a);
  k.rect(-1.5, -d / 2, 1.5, d / 2, 0.16, 0xd9c9a3);
  k.rect(-w / 2, -1.5, w / 2, 1.5, 0.16, 0xd9c9a3);
  k.prism(9, 9, 6, 6, 0.1, 0.22, 0x5aa7d6, 12);
  k.prism(0, 0, 3.5, 3.5, 0.16, 0.6, 0xbfb7a6, 10);
  for (const [u, v, s] of [
    [-12, -12, 1.1],
    [-15, -5, 0.9],
    [-7, -15, 1],
    [-13, 12, 1.2],
    [-6, 15, 0.9],
    [14, -13, 1],
    [16, -6, 0.8],
    [8, -15, 1.1],
    [16, 16, 0.9],
  ]) {
    k.tree(u, v, s);
  }
}

function school(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0xd8d3c4);
  // L-shaped classroom block with a red roof edge
  k.box(-30, -18, 6, -6, 0, 12, 0xf1e6c8);
  k.box(-30, -6, -18, 20, 0, 12, 0xf1e6c8);
  k.box(-30.5, -18.5, 6.5, -5.5, 12, 13.2, 0xc0533a);
  k.box(-30.5, -6, -17.5, 20.5, 12, 13.2, 0xc0533a);
  for (let u = -27; u < 4; u += 4) k.box(u, -18.15, u + 2.4, -18.05, 3, 5, 0x6f93ad);
  for (let u = -27; u < 4; u += 4) k.box(u, -18.15, u + 2.4, -18.05, 7.5, 9.5, 0x6f93ad);
  // Sports field with a running track
  k.rect(-12, -2, 30, 21, 0.14, 0xc8664a);
  k.rect(-8, 2, 26, 17, 0.18, 0x6fb556);
  k.prism(-14, -20, 0.15, 0.15, 0, 10, 0xdddddd, 4);
  k.box(-14, -20.1, -11, -20, 8, 10, 0xd9343a);
}

function police(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0x9ea3a6);
  k.box(-13, -6, 13, 12, 0, 10, 0xf2f3f4);
  k.box(-13.2, -6.2, 13.2, 12.2, 6.5, 8, 0x2f5fa8);
  k.box(-4, -9, 4, -6, 0, 4, 0x2f5fa8);
  k.box(-2, 0, 2, 4, 10, 13, 0xf2f3f4);
  // Patrol cars out front
  for (const u of [-9, 7]) {
    k.box(u, -14, u + 4.4, -12.2, 0, 1.1, 0xf5f5f5);
    k.box(u + 1, -13.8, u + 3.2, -12.4, 1.1, 1.8, 0x223355);
    k.box(u + 1.8, -13.4, u + 2.6, -12.8, 1.8, 2.1, 0xe03c31);
  }
}

function fire(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0x9ea3a6);
  k.box(-15, -6, 8, 12, 0, 11, 0xc8442f);
  for (const u of [-13, -6, 1]) k.box(u, -6.15, u + 5.5, -6.05, 0, 6, 0xdedede);
  k.box(9, -2, 14, 6, 0, 20, 0xb33a28);
  k.box(8.6, -2.4, 14.4, 6.4, 20, 21, 0xf2f3f4);
  // Fire engine on the apron
  k.box(-12, -14, -3.5, -11.5, 0, 2.6, 0xd9302a);
  k.box(-12, -14, -9.5, -11.5, 2.6, 3.4, 0xf2f2f2);
}

function hospital(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0xb7bcbf);
  k.box(-25, -10, 25, 14, 0, 10, 0xe9eef0);
  k.box(-14, -4, 14, 12, 10, 32, 0xf7fafb);
  for (let z = 13; z < 31; z += 4) k.box(-14.1, -4.1, 14.1, 12.1, z, z + 1.6, 0x7fa9c4);
  // Red cross on the roof and a helipad
  k.box(-1.2, -1, 1.2, 9, 32, 32.6, 0xd9343a);
  k.box(-5, 2.8, 5, 5.2, 32, 32.6, 0xd9343a);
  k.prism(17, 2, 6, 6, 10, 10.4, 0x5f6366, 12);
  k.box(16.2, -0.5, 16.8, 4.5, 10.4, 10.6, 0xf2f2f2);
  k.box(17.2, -0.5, 17.8, 4.5, 10.4, 10.6, 0xf2f2f2);
  k.box(16.2, 1.7, 17.8, 2.3, 10.4, 10.6, 0xf2f2f2);
  k.box(-6, -15, 6, -10, 4.5, 5.2, 0xd9343a);
}

/** 85 Sky Tower: two legs joined high up into one tower, then a stepped top and a mast. */
function tower85(k: Kit, w: number, d: number): void {
  const glass = 0x6f8ea6;
  const band = 0xa9c2d4;
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0xc9c4ba);
  for (const s of [-1, 1]) {
    k.box(s * 6, -9, s * 18, 9, 0, 132, glass);
    for (let z = 20; z < 130; z += 22) k.box(s * 5.9, -9.1, s * 18.1, 9.1, z, z + 1.2, band);
  }
  // The open arch between the legs, then the shared tower above it
  k.box(-18, -9, 18, 9, 132, 150, glass);
  k.box(-18.2, -9.2, 18.2, 9.2, 150, 151.5, band);
  k.box(-10, -8, 10, 8, 151.5, 205, glass);
  k.box(-10.2, -8.2, 10.2, 8.2, 178, 179.2, band);
  k.box(-7.5, -6, 7.5, 6, 205, 232, glass);
  k.box(-5, -4, 5, 4, 232, 252, band);
  k.prism(0, 0, 0.9, 0.2, 252, 285, 0xdfe5ea, 6);
}

function cityHall(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0xcfc8b8);
  k.box(-33, -6, 33, 16, 0, 18, 0xe8e0cc);
  for (let z = 4; z < 17; z += 4.5) k.box(-33.1, -6.1, 33.1, 16.1, z, z + 1.4, 0x8aa5b5);
  k.box(-11, -12, 11, 16, 0, 34, 0xf2ecdc);
  k.box(-11.1, -12.1, 11.1, 16.1, 8, 30, 0x7f9fb3);
  k.box(-12, -13, 12, 17, 34, 36, 0xd8cfb8);
  for (const u of [-20, -16, 16, 20]) {
    k.prism(u, -19, 0.15, 0.15, 0, 12, 0xdddddd, 4);
  }
  k.box(-20, -19.1, -17, -19, 10, 12, 0xd9343a);
}

/** Two seven-storey pagodas on a lotus pond, reached by a zigzag bridge. */
function dragonTiger(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0xbfb7a6);
  k.rect(-w / 2 + 2, -d / 2 + 6, w / 2 - 2, d / 2 - 2, 0.16, 0x4f97bf);
  for (const [s, wall] of [
    [-1, 0xf2c94c],
    [1, 0xf2a93c],
  ] as const) {
    const cu = s * 10;
    const cv = 8;
    k.prism(cu, cv, 7, 7, 0, 2, 0xc0533a, 8, Math.PI / 8);
    let z = 2;
    for (let i = 0; i < 7; i++) {
      const r = 5.2 - i * 0.5;
      k.prism(cu, cv, r, r, z, z + 3.2, wall, 8, Math.PI / 8);
      k.prism(cu, cv, r + 1.8, r * 0.75, z + 3.2, z + 4.2, 0xc0533a, 8, Math.PI / 8);
      z += 4.2;
    }
    k.prism(cu, cv, 0.6, 0, z, z + 4, 0xf2c94c, 6);
  }
  // Zigzag bridge from the shore, and the dragon and tiger at the doors
  k.box(-2, -22, 2, -12, 0.2, 1, 0xd9343a);
  k.box(-2, -12, 8, -9, 0.2, 1, 0xd9343a);
  k.box(-10, -9, 2, -6, 0.2, 1, 0xd9343a);
  k.box(-10, -6, -7, 2, 0.2, 1, 0xd9343a);
  k.box(7, -9, 10, 2, 0.2, 1, 0xd9343a);
  k.box(-13, 1, -7, 3, 0.2, 4, 0x3f9a4a);
  k.box(7, 1, 13, 3, 0.2, 4, 0xe08a2a);
}

/** A shopping mall with a big wheel on its roof. */
function ferrisWheel(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0xbfb9ad);
  k.box(-26, -18, 26, 20, 0, 22, 0xe9e1d3);
  k.box(-26.1, -18.1, 26.1, 20.1, 5, 12, 0x8fb8cc);
  const hz = 22 + 34;
  const R = 30;
  const n = 32;
  const rim = (a: number, r: number, v: number): P3 => [Math.cos(a) * r, v, hz + Math.sin(a) * r];
  k.color(0xe4572e);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    for (const v of [-1.2, 1.2]) k.quad(rim(a0, R, v), rim(a0, R - 1.2, v), rim(a1, R, v), rim(a1, R - 1.2, v));
    k.quad(rim(a0, R, -1.2), rim(a0, R, 1.2), rim(a1, R, -1.2), rim(a1, R, 1.2));
  }
  // Spokes and the A-frame legs to the hub
  k.color(0xf2f2f2);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    k.quad(rim(a, 0, -0.3), rim(a, 0, 0.3), rim(a, R - 1, -0.3), rim(a, R - 1, 0.3));
  }
  k.color(0xd9d9d9);
  for (const v of [-6, 6]) {
    for (const u of [-14, 14]) k.quad([u - 0.8, v, 22], [u + 0.8, v, 22], [-0.5, v * 0.25, hz], [0.5, v * 0.25, hz]);
  }
  k.prism(0, 0, 2, 2, hz - 2, hz + 2, 0xd9d9d9, 8);
  const colors = [0xf4d35e, 0x2e86ab, 0x6a994e, 0xa23b72];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const [u, , z] = rim(a, R, 0);
    k.box(u - 1.3, -1.3, u + 1.3, 1.3, z - 3.2, z - 0.6, colors[i % colors.length]);
  }
}

/** A white dome on a ring of stands. */
function arena(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0xc9c6bf);
  k.prism(0, 0, 40, 40, 0, 12, 0x9aa5b1, 24);
  k.prism(0, 0, 40.5, 40.5, 12, 13, 0xe4e7ea, 24);
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * (Math.PI / 2);
    const a1 = ((i + 1) / steps) * (Math.PI / 2);
    k.prism(0, 0, 40 * Math.cos(a0), 40 * Math.cos(a1), 13 + 24 * Math.sin(a0), 13 + 24 * Math.sin(a1), i % 2 ? 0xeef1f3 : 0xdfe4e8, 24);
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

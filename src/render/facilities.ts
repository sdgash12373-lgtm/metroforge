import * as THREE from 'three';
import { FACILITIES, type Facility, toWorld } from '../sim/facilities';
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
};

/** Every park, school, station, hospital and landmark as one coloured mesh. */
export function buildFacilityGeometry(facilities: Iterable<Facility>): THREE.BufferGeometry {
  const b = new Builder(0);
  for (const f of facilities) {
    const { w, d } = FACILITIES[f.kind];
    MODELS[f.kind](new Kit(b, f), w, d);
  }
  return b.geometry();
}

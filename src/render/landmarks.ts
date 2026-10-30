import type { Kit } from './facilities';
import { band, banyan, palm, shrub } from './civic';

/**
 * Kaohsiung's landmarks, modelled after the real ones: 85 Sky Tower's 高-shaped legs and stepped
 * crown, the 四維行政中心 city hall with its portico and fountain plaza, the oval Kaohsiung Arena,
 * the mall with its big wheel, and the Dragon and Tiger Pagodas on Lotus Pond. Frame as in
 * facilities.ts: u along the street, v back from it (front at -d/2), z up.
 */

type P3 = [number, number, number];

/**
 * A band between two horizontal ellipses (rx0, ry0 at z0 up to rx1, ry1 at z1) round (cu, cv);
 * `color` picks each sector's colour, for ribbed roofs. An ellipse of 0 radius closes it.
 */
function ellipseBand(
  k: Kit,
  cu: number,
  cv: number,
  rx0: number,
  ry0: number,
  z0: number,
  rx1: number,
  ry1: number,
  z1: number,
  color: (i: number) => number,
  sides = 32,
): void {
  const at = (rx: number, ry: number, i: number, z: number): P3 => {
    const a = (i / sides) * Math.PI * 2;
    return [cu + Math.cos(a) * rx, cv + Math.sin(a) * ry, z];
  };
  for (let i = 0; i < sides; i++) {
    k.color(color(i)).quad(at(rx1, ry1, i, z1), at(rx0, ry0, i, z0), at(rx1, ry1, i + 1, z1), at(rx0, ry0, i + 1, z0));
  }
}

const PLAZA = 0xd6cfbf;
const LAWN = 0x7fb85a;

/** 85 大樓: two dark glass legs with a tall void between them (the 高), joined at the 35th floor, then a central tower stepping in to a lit crown and spire. */
export function tower85(k: Kit, w: number, d: number): void {
  const glass = 0x35596b;
  const rib = 0x7ea3b6;
  const trim = 0xb9d0dc;
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, PLAZA);
  k.rect(-6, -d / 2, 6, -12, 0.13, 0xbfb6a4);
  // Podium with a glass lobby under the void
  k.box(-21, -13, 21, 13, 0, 14, 0xdcd6c8);
  k.box(-5.4, -13.12, 5.4, -13, 0.2, 12, 0x5f86a0);
  band(k, -21.1, -13.1, 21.1, 13.1, 13, 14.2, trim);
  // The legs, ribbed in light mullions, with bands at the mechanical floors
  for (const s of [-1, 1]) {
    const u0 = s < 0 ? -19 : 5.5;
    const u1 = s < 0 ? -5.5 : 19;
    k.box(u0, -11, u1, 11, 14, 138, glass);
    for (let u = u0 + 1.1; u < u1 - 0.5; u += 2.25) {
      k.box(u - 0.15, -11.12, u + 0.15, -11, 14, 138, rib);
      k.box(u - 0.15, 11, u + 0.15, 11.12, 14, 138, rib);
    }
    for (let v = -10; v < 10.5; v += 2.5) {
      const uf = s < 0 ? u0 : u1;
      k.box(uf - 0.06, v - 0.15, uf + 0.06, v + 0.15, 14, 138, rib);
    }
    for (const z of [44, 76, 108]) band(k, u0 - 0.1, -11.1, u1 + 0.1, 11.1, z, z + 1.4, trim, 0.4);
    // Sloped shoulders on the outer side, as the wings lean in to the shaft
    const o = s < 0 ? u0 : u1;
    const i = s < 0 ? -13 : 13;
    k.color(glass).quad([o, -11, 138], [o, 11, 138], [i, -11, 152], [i, 11, 152]);
    k.color(glass).quad([o, -11, 138], [i, -11, 152], [o, -11, 138], [i, -11, 138]);
    k.color(glass).quad([o, 11, 138], [i, 11, 152], [o, 11, 138], [i, 11, 138]);
  }
  // The bridge floors over the void, then the shaft's setbacks
  k.box(-13, -11, 13, 11, 138, 152, glass);
  band(k, -19.1, -11.1, 19.1, 11.1, 136.6, 138.2, trim, 0.4);
  const steps: [number, number, number, number][] = [
    [11, 10, 152, 196],
    [9, 8.5, 196, 232],
    [7, 6.5, 232, 258],
  ];
  for (const [hu, hv, z0, z1] of steps) {
    k.box(-hu, -hv, hu, hv, z0, z1, glass);
    for (let u = -hu + 1.1; u < hu - 0.5; u += 2.2) {
      k.box(u - 0.15, -hv - 0.12, u + 0.15, -hv, z0, z1, rib);
      k.box(u - 0.15, hv, u + 0.15, hv + 0.12, z0, z1, rib);
    }
    band(k, -hu - 0.15, -hv - 0.15, hu + 0.15, hv + 0.15, z1 - 1.2, z1 + 0.15, trim, 0.4);
  }
  // The pyramid crown, three storeys high (floors 83–85), then the antenna spire
  k.prism(0, 0, 9.4, 1.4, 258, 270, 0x6f93a8, 4, Math.PI / 4);
  k.prism(0, 0, 9.6, 9.6, 257.4, 258.4, trim, 4, Math.PI / 4);
  k.prism(0, 0, 1.4, 0.9, 270, 274, 0xd8e4ea, 8);
  k.prism(0, 0, 0.8, 0.12, 274, 318, 0xeef2f4, 6);
  for (const u of [-16, 16]) palm(k, u, -17.5, 0.9);
  for (const u of [-20, 20]) shrub(k, u, -16, 1);
}

/** 高雄市政府四維行政中心: a long beige block with a grid of windows, a taller glass centre under a crown, a columned portico, and a fountain plaza with lawns and flags. */
export function cityHall(k: Kit, w: number, d: number): void {
  const stone = 0xe6dcc6;
  const pier = 0xd2c6ab;
  const glass = 0x5f86a0;
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, PLAZA);
  for (const s of [-1, 1]) k.rect(s * 6, -21.5, s * 32, -8, 0.14, LAWN);
  // Fountain on the axis
  k.prism(0, -15, 5.2, 5.2, 0.1, 0.7, 0xbfb6a4, 20);
  k.prism(0, -15, 4.5, 4.5, 0.1, 0.8, 0x5aa7d6, 20);
  k.prism(0, -15, 0.8, 0.5, 0.8, 2.6, 0xe6e3dc, 8);
  k.prism(0, -15, 1.4, 1.4, 2.6, 2.8, 0x8fc8e6, 10);
  // Wings: piers and window bands
  const top = 25;
  k.box(-33, -4, 33, 17, 0, top, stone);
  for (let z = 4; z < top - 1; z += 3.6) k.box(-33.1, -4.1, 33.1, 17.1, z, z + 1.8, glass);
  for (let u = -32; u <= 32; u += 3) k.box(u - 0.35, -4.3, u + 0.35, -4, 3, top, pier);
  band(k, -33.2, -4.2, 33.2, 17.2, top - 0.6, top + 1, pier, 0.5);
  k.rect(-33, -4, 33, 17, top + 0.1, 0xa9aba7);
  // The taller centre: glass framed in stone, a crown of fins on top
  k.box(-12, -8, 12, 17.15, 0, 40, 0xefe7d4);
  k.box(-9, -8.14, 9, -8, 10, 37, glass);
  for (let u = -8; u <= 8; u += 2) k.box(u - 0.12, -8.22, u + 0.12, -8.08, 10, 37, 0xdcd3bf);
  for (let z = 13; z < 37; z += 3.6) k.box(-9, -8.22, 9, -8.08, z, z + 0.25, 0xdcd3bf);
  band(k, -12.3, -8.3, 12.3, 17.3, 39, 41.5, pier, 0.5);
  k.rect(-12, -8, 12, 17, 40.5, 0xa9aba7);
  for (let u = -10; u <= 10; u += 2.5) k.box(u - 0.2, -6, u + 0.2, 10, 41.5, 46, 0xf2ecdc);
  k.box(-10.4, -6.4, 10.4, 10.4, 46, 47, 0xf2ecdc);
  // Portico: six columns and a deep canopy carrying the name
  k.box(-11, -13.5, 11, -8, 0, 0.6, 0xd8cfb8);
  for (let u = -10; u <= 10; u += 4) k.prism(u, -12.6, 0.55, 0.55, 0.6, 9, 0xf2ecdc, 8);
  k.box(-11.5, -13.6, 11.5, -8, 9, 10.6, 0xf2ecdc);
  k.box(-11.6, -13.75, 11.6, -13.55, 9, 10.65, pier);
  // Flags and trees
  // Flags beside the plaza, clear of the name on the portico
  for (const [u, c] of [
    [-24, 0x2f6fb8],
    [-20, 0xd9343a],
    [20, 0x2f9a5a],
  ] as const) {
    k.prism(u, -6.5, 0.12, 0.08, 0, 13, 0xdddddd, 4);
    k.box(u + 0.12, -6.55, u + 2.5, -6.45, 11.2, 12.8, c);
  }
  k.box(-19.88, -6.6, -18.8, -6.4, 12, 12.8, 0x1f3f8f);
  for (const u of [-28, -18, 18, 28]) banyan(k, u, -18.5, 0.9);
  for (const u of [-34, 34]) palm(k, u, 19, 0.9);
}

/** 龍虎塔: two seven-storey pagodas with red columns, white balconies and orange glazed eaves on Lotus Pond, a zigzag bridge, and the dragon and tiger whose mouths are the doors. */
export function dragonTiger(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0xbfb7a6);
  k.rect(-w / 2 + 2, -d / 2 + 6, w / 2 - 2, d / 2 - 2, 0.16, 0x4f8fa8);
  // Lotus leaves and flowers on the pond
  for (let i = 0; i < 26; i++) {
    const u = -22 + ((i * 7.3) % 44);
    const v = -14 + ((i * 5.7) % 34);
    if (Math.abs(Math.abs(u) - 10) < 6.5 && v > 1) continue;
    if (Math.abs(u) < 4 || (v < -5 && v > -10)) continue;
    k.prism(u, v, 0.9, 0.9, 0.12, 0.22, i % 3 ? 0x4f9a45 : 0x5fae50, 7);
    if (i % 4 === 0) k.prism(u + 0.3, v + 0.2, 0.25, 0.35, 0.22, 0.7, 0xf28fb0, 5);
  }
  const eave = 0xe58a2b;
  const wall = 0xf5e3b0;
  const red = 0xc0392b;
  for (const s of [-1, 1]) {
    const cu = s * 10;
    const cv = 8;
    k.prism(cu, cv, 7, 7, 0, 1.6, 0xd8cdb4, 8, Math.PI / 8);
    k.prism(cu, cv, 7.2, 7.2, 1.6, 2, 0xf2efe6, 8, Math.PI / 8);
    let z = 2;
    for (let i = 0; i < 7; i++) {
      const r = 5 - i * 0.45;
      const h = i ? 3 : 3.6;
      k.prism(cu, cv, r, r, z, z + h, wall, 8, Math.PI / 8);
      for (let c = 0; c < 8; c++) {
        const a = Math.PI / 8 + (c / 8) * Math.PI * 2;
        k.prism(cu + Math.cos(a) * (r + 0.15), cv + Math.sin(a) * (r + 0.15), 0.22, 0.22, z, z + h, red, 4);
      }
      // White balcony, then the eave sweeping out
      k.prism(cu, cv, r + 0.9, r + 0.9, z, z + 0.7, 0xf2efe6, 8, Math.PI / 8);
      k.prism(cu, cv, r + 2, r + 0.4, z + h, z + h + 0.5, eave, 8, Math.PI / 8);
      k.prism(cu, cv, r + 0.4, r * 0.7, z + h + 0.5, z + h + 1.2, 0xd9761f, 8, Math.PI / 8);
      z += h + 1.2;
    }
    k.prism(cu, cv, 1.6, 0, z, z + 2.4, eave, 8, Math.PI / 8);
    k.prism(cu, cv, 0.5, 0.5, z + 2.2, z + 3, 0xf2c94c, 6);
    k.prism(cu, cv, 0.7, 0, z + 3, z + 5, 0xf2c94c, 6);
  }
  // Zigzag bridge (九曲橋) from the shore to both mouths
  const deck = 0xe9dcc0;
  const rail = 0xc0392b;
  const span = (u0: number, v0: number, u1: number, v1: number) => {
    k.box(u0, v0, u1, v1, 0.2, 0.9, deck);
    const along = u1 - u0 > v1 - v0;
    if (along) {
      k.box(u0, v0, u1, v0 + 0.15, 0.9, 1.7, rail);
      k.box(u0, v1 - 0.15, u1, v1, 0.9, 1.7, rail);
    } else {
      k.box(u0, v0, u0 + 0.15, v1, 0.9, 1.7, rail);
      k.box(u1 - 0.15, v0, u1, v1, 0.9, 1.7, rail);
    }
  };
  span(-1.6, -22, 1.6, -12);
  span(-8, -12, 8, -9);
  span(-11.6, -12, -8, -6);
  span(8, -12, 11.6, -6);
  // Dragon: a green body coiling from the bridge up to the left tower's door, head with open red mouth
  const green = 0x2f8f4a;
  const du = 10;
  for (let i = 0; i < 7; i++) {
    const v = -6 + i * 1.3;
    const zz = 1 + Math.sin(i * 0.9) * 0.8 + i * 0.25;
    const ww = 1.5 - i * 0.05;
    k.box(du - ww, v, du + ww, v + 1.4, zz, zz + 2.2, i % 2 ? green : 0x3aa35a);
    k.box(du - 0.3, v + 0.2, du + 0.3, v + 1.2, zz + 2.2, zz + 2.9, 0xf2c94c);
  }
  k.box(du - 2, -7.6, du + 2, -5, 1, 4.6, green);
  k.box(du - 1.6, -7.7, du + 1.6, -7.55, 1.8, 3.4, 0xd9343a);
  k.box(du - 2.1, -7.8, du + 2.1, -6.6, 3.6, 4.2, 0xf2c94c);
  for (const s of [-1, 1]) k.prism(du + s * 1.4, -5.6, 0.25, 0.08, 4.6, 6.4, 0xf2c94c, 4);
  // Tiger: an orange striped body and head at the right tower's door
  const orange = 0xe8902a;
  const tu = -10;
  k.box(tu - 1.8, -5, tu + 1.8, 2, 1, 3.8, orange);
  for (let v = -4.4; v < 2; v += 1.3) k.box(tu - 1.85, v, tu + 1.85, v + 0.35, 1.2, 3.85, 0x2a2a2e);
  k.box(tu - 2.2, -7.6, tu + 2.2, -5, 1, 5, orange);
  k.box(tu - 1.7, -7.7, tu + 1.7, -7.55, 1.8, 3.6, 0xd9343a);
  k.box(tu - 2.25, -7.75, tu + 2.25, -7.6, 3.9, 4.3, 0xf2efe6);
  for (const s of [-1, 1]) k.prism(tu + s * 1.6, -6, 0.6, 0.3, 5, 5.8, orange, 5);
  // Shore trees
  for (const u of [-22, -14, 14, 22]) banyan(k, u, -19.5, 0.7);
}

/** 摩天輪: a department store with a curved glass atrium and, on its roof, a white wheel with a trussed double rim and pastel cabins. */
export function ferrisWheel(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0xbfb9ad);
  const top = 48;
  k.box(-26, -14, 26, 20, 0, top, 0xece4d6);
  for (let z = 5; z < top - 1; z += 4) k.box(-26.1, -14.1, 26.1, 20.1, z, z + 1.6, 0x8fb8cc);
  band(k, -26.2, -14.2, 26.2, 20.2, top - 0.6, top + 1, 0xd8cdb8, 0.5);
  k.rect(-26, -14, 26, 20, top + 0.05, 0xa9aba7);
  // Curved glass atrium at the entrance, and its canopy
  k.prism(0, -14, 9, 9, 0, 30, 0x6f9fb8, 16);
  k.prism(0, -14, 9.4, 8.6, 30, 31, 0xf2f2f2, 16);
  k.box(-8, -20, 8, -16, 5, 5.6, 0xf2f2f2);
  // The wheel stands on the roof behind the atrium
  const hv = 6;
  const R = 25;
  const hz = 102.5 - R - 0.5;
  const n = 32;
  const rim = (a: number, r: number, v: number): P3 => [Math.cos(a) * r, hv + v, hz + Math.sin(a) * r];
  for (const [r0, r1] of [
    [R, R - 0.8],
    [R - 2.4, R - 3],
  ]) {
    k.color(0xf4f4f2);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      for (const v of [-1.4, 1.4]) k.quad(rim(a0, r0, v), rim(a0, r1, v), rim(a1, r0, v), rim(a1, r1, v));
      k.quad(rim(a0, r0, -1.4), rim(a0, r0, 1.4), rim(a1, r0, -1.4), rim(a1, r0, 1.4));
    }
  }
  // Truss between the two rims, spokes in pairs to the hub
  k.color(0xdfe3e6);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    for (const v of [-1.4, 1.4]) k.quad(rim(a0, R - 0.8, v - 0.15), rim(a0, R - 0.8, v + 0.15), rim(a1, R - 2.4, v - 0.15), rim(a1, R - 2.4, v + 0.15));
  }
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    for (const v of [-1.4, 1.4]) k.quad(rim(a, 1.5, v * 0.6 - 0.2), rim(a, 1.5, v * 0.6 + 0.2), rim(a, R - 2.8, v - 0.2), rim(a, R - 2.8, v + 0.2));
  }
  k.color(0xc9ced2);
  for (const v of [-7, 7]) {
    for (const u of [-12, 12]) k.quad([u - 1, hv + v, top], [u + 1, hv + v, top], [-0.6, hv + v * 0.3, hz], [0.6, hv + v * 0.3, hz]);
  }
  k.prism(0, hv, 2.4, 2.4, hz - 2.4, hz + 2.4, 0xe6e9eb, 10);
  k.prism(0, hv, 1.2, 1.2, hz - 1.2, hz + 1.2, 0xe58a9f, 8);
  // Pastel cabins hanging under the rim
  const cabins = [0xf4a6c0, 0x9ad8c8, 0x9ac4ef, 0xf6dc7a, 0xc9a8e8, 0xf7b38a];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const [u, , z] = rim(a, R + 0.4, 0);
    k.box(u - 0.15, hv - 0.15, u + 0.15, hv + 0.15, z - 1.2, z, 0xdfe3e6);
    k.box(u - 1.1, hv - 1.1, u + 1.1, hv + 1.1, z - 3.4, z - 1.2, cabins[i % cabins.length]);
    k.box(u - 1.15, hv - 1.15, u + 1.15, hv + 1.15, z - 2.8, z - 1.8, 0x3c5566);
  }
  for (const u of [-24, -16, 16, 24]) palm(k, u, -19.5, 0.9);
}

/** 高雄巨蛋: an oval arena whose glass wall leans out under a white ribbed roof, with entrance canopies and a stepped plaza. */
export function arena(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, PLAZA);
  const rx = 40;
  const ry = 34;
  ellipseBand(k, 0, 0, rx + 3, ry + 3, 0.1, rx + 2, ry + 2, 1.2, () => 0xc9c2b2, 40);
  ellipseBand(k, 0, 0, rx + 2, ry + 2, 1.2, 0, 0, 1.2, () => 0xc9c2b2, 40);
  // Concrete base, then the glass wall leaning outward
  ellipseBand(k, 0, 0, rx - 3, ry - 3, 1.2, rx - 3, ry - 3, 5, () => 0xd9d4c8, 40);
  ellipseBand(k, 0, 0, rx - 3, ry - 3, 5, rx, ry, 16, (i) => (i % 2 ? 0x5f8fa8 : 0x6f9fb8), 40);
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    k.color(0xe8ecee).quad(
      [c * (rx - 3), s * (ry - 3), 5],
      [c * (rx - 3) + 0.3, s * (ry - 3), 5],
      [c * rx, s * ry, 16],
      [c * rx + 0.3, s * ry, 16],
    );
  }
  // White roof ring and the ribbed shell over it
  ellipseBand(k, 0, 0, rx, ry, 16, rx + 1, ry + 1, 17.5, () => 0xf4f6f7, 40);
  const rings = 7;
  for (let j = 0; j < rings; j++) {
    const t0 = j / rings;
    const t1 = (j + 1) / rings;
    const s0 = Math.cos((t0 * Math.PI) / 2);
    const s1 = Math.cos((t1 * Math.PI) / 2);
    const z0 = 17.5 + 23 * Math.sin((t0 * Math.PI) / 2);
    const z1 = 17.5 + 23 * Math.sin((t1 * Math.PI) / 2);
    ellipseBand(k, 0, 0, (rx + 1) * s0, (ry + 1) * s0, z0, (rx + 1) * s1, (ry + 1) * s1, z1, (i) => (i % 2 ? 0xeef1f3 : 0xdde3e8), 40);
  }
  ellipseBand(k, 0, 0, 7, 6, 40.4, 0, 0, 41.8, () => 0xc9d6de, 20);
  // Entrance canopies round the bowl, the main one facing the street with steps up to it
  for (const a of [-Math.PI / 2, 0, Math.PI / 2, Math.PI]) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const pu = c * (rx + 4);
    const pv = s * (ry + 4);
    k.box(pu - 6, pv - 6, pu + 6, pv + 6, 7, 7.8, 0xf4f6f7);
    for (const [du, dv] of [
      [-5.5, -5.5],
      [5, -5.5],
      [-5.5, 5],
      [5, 5],
    ] as const) {
      k.box(pu + du, pv + dv, pu + du + 0.5, pv + dv + 0.5, 0, 7, 0xdfe3e6);
    }
  }
  for (let i = 0; i < 4; i++) k.box(-12, -44 + i * 1.2, 12, -42.8 + i * 1.2, 0, 0.3 + i * 0.3, 0xd2cab8);
  for (const [u, v] of [
    [-38, -40],
    [38, -40],
    [-42, 30],
    [42, 30],
  ] as const) {
    banyan(k, u, v, 0.9);
  }
}

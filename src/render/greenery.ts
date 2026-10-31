import type { Kit } from './facilities';

/**
 * 綠化建設, each after a real place: the 綠建築 is a twisting 陶朱隱園-style tower with planted balconies;
 * the 綠地廣場 a city-block park round a big lawn under a curved white canopy; the 生態公園 a wetland
 * of green ponds ringed by 落羽松 and boardwalks, with two pavilions on a walled mound and woods round it.
 * Frame as in facilities.ts: u along the street, v back from it (front at -d/2), z up.
 */

type Pt = [number, number];

const WHITE = 0xf1f0ea;
const LAWN = 0x7dbb4f;
const LAWN_BRIGHT = 0x8fcb52;
const PAVING = 0xd8d8d2;
const PAVING_LIGHT = 0xe9e9e4;
const LEAF = [0x3f7f3a, 0x4a8f40, 0x568f3c, 0x3a7034];
const TRUNK = 0x6b5440;

/** A convex polygon laid flat at height z. */
function flat(k: Kit, pts: Pt[], z: number, c: number): void {
  k.color(c);
  const [cu, cv] = centre(pts);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    k.quad([cu, cv, z], [cu, cv, z], [a[0], a[1], z], [b[0], b[1], z]);
  }
}

/** A polygon (star-shaped about its centre) raised from z0 to z1, its top capped. */
function extrude(k: Kit, pts: Pt[], z0: number, z1: number, c: number): void {
  k.color(c);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    k.quad([a[0], a[1], z1], [a[0], a[1], z0], [b[0], b[1], z1], [b[0], b[1], z0]);
  }
  flat(k, pts, z1, c);
}

/** A band between two matching outlines, from z0 up to z1: a planter or kerb along an edge. */
function ring(k: Kit, outer: Pt[], inner: Pt[], z0: number, z1: number, c: number): void {
  k.color(c);
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length;
    const [a, b, p, q] = [outer[i], outer[j], inner[i], inner[j]];
    k.quad([a[0], a[1], z1], [a[0], a[1], z0], [b[0], b[1], z1], [b[0], b[1], z0]);
    k.quad([p[0], p[1], z1], [p[0], p[1], z0], [q[0], q[1], z1], [q[0], q[1], z0]);
    k.quad([a[0], a[1], z1], [b[0], b[1], z1], [p[0], p[1], z1], [q[0], q[1], z1]);
  }
}

function centre(pts: Pt[]): Pt {
  let u = 0;
  let v = 0;
  for (const [a, b] of pts) {
    u += a;
    v += b;
  }
  return [u / pts.length, v / pts.length];
}

/** A soft, irregular outline round (cu, cv): ponds, lawns and islands. */
function blob(cu: number, cv: number, ru: number, rv: number, wobble = 0.18, seed = 0, n = 28, turn = 0): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 1 + wobble * (Math.sin(2 * a + seed) * 0.6 + Math.sin(3 * a + seed * 1.7) * 0.4);
    const x = Math.cos(a) * ru * r;
    const y = Math.sin(a) * rv * r;
    pts.push([cu + x * Math.cos(turn) - y * Math.sin(turn), cv + x * Math.sin(turn) + y * Math.cos(turn)]);
  }
  return pts;
}

/** A stadium (a rectangle with round ends) `len` × `wid`, turned by `turn` about (cu, cv). */
function stadium(cu: number, cv: number, len: number, wid: number, turn: number, n = 9): Pt[] {
  const r = wid / 2;
  const half = len / 2 - r;
  const pts: Pt[] = [];
  for (const end of [1, -1]) {
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI + (end < 0 ? Math.PI : 0);
      pts.push([end * half + Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return pts.map(([x, y]) => [cu + x * c - y * s, cv + x * s + y * c]);
}

/** A broadleaf street or park tree: trunk and a rounded crown, `s` its scale. */
function roundTree(k: Kit, u: number, v: number, s = 1, c = LEAF[0]): void {
  k.prism(u, v, 0.28 * s, 0.22 * s, 0, 2.4 * s, TRUNK, 5);
  k.prism(u, v, 1.6 * s, 2.6 * s, 2 * s, 3.6 * s, c, 7);
  k.prism(u, v, 2.6 * s, 1.9 * s, 3.6 * s, 5.2 * s, c, 7, 0.4);
  k.prism(u, v, 1.9 * s, 0.4 * s, 5.2 * s, 6.2 * s, c, 7);
}

/** 落羽松: a slim spire of russet needles, as they turn in winter. */
function cypress(k: Kit, u: number, v: number, s = 1, c = 0xb8642f): void {
  k.prism(u, v, 0.22 * s, 0.16 * s, 0, 2 * s, 0x6e5440, 5);
  k.prism(u, v, 1.25 * s, 0.75 * s, 1.4 * s, 5.4 * s, c, 6);
  k.prism(u, v, 0.85 * s, 0, 5.4 * s, 9 * s, c, 6, 0.5);
}

/** A palm with drooping fronds. */
function palm(k: Kit, u: number, v: number, s = 1): void {
  k.prism(u, v, 0.25 * s, 0.2 * s, 0, 7 * s, 0x9a8a70, 5);
  k.prism(u, v, 3 * s, 0.4 * s, 6.2 * s, 8 * s, 0x4f8f45, 6);
  k.prism(u, v, 1.2 * s, 0, 7.8 * s, 8.8 * s, 0x5a9e4c, 5, 0.5);
}

/** A slim park lamp. */
function lamp(k: Kit, u: number, v: number): void {
  k.prism(u, v, 0.08, 0.08, 0, 4.6, 0x5a6066, 4);
  k.box(u - 0.35, v - 0.12, u + 0.35, v + 0.12, 4.5, 4.7, 0xf4f1e6);
}

const ri = (i: number, j: number) => {
  const x = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * 綠建築, after 陶朱隱園: 21 floors of white balcony slabs with round ends, each turned 4.5° on the one
 * below so the tower twists a quarter turn like a double helix. Every balcony edge is thick with shrubs and
 * small trees, glass sits back behind them round a blue-glass core, and two dark flat caps crown the top. A
 * planted ring wraps the base among the trees.
 */
export function greenBuilding(k: Kit, w: number, d: number): void {
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, LAWN);
  const cu = 0;
  const cv = 1;
  // Paths to the door and round the base
  k.rect(-2.5, -d / 2, 2.5, -8, 0.14, PAVING_LIGHT);
  flat(k, blob(cu, cv, 16.5, 13.5, 0.04, 1, 32), 0.13, PAVING);
  // The planted ring round the foot, a white kerb on its edge, and the glass lobby inside
  const footOut = stadium(cu, cv, 34, 21, 0, 10);
  const footIn = stadium(cu, cv, 30, 17, 0, 10);
  ring(k, footOut, footIn, 0.1, 2.2, WHITE);
  ring(k, stadium(cu, cv, 33.4, 20.4, 0, 10), footIn, 2.2, 3, 0x5f9a45);
  extrude(k, stadium(cu, cv, 26, 12, 0, 10), 0.1, 5.7, 0x8fb3c2);
  // Blue-glass core running the full height
  k.box(cu - 3.6, cv - 2.6, cu + 3.6, cv + 2.6, 0, 95, 0x2f5f7a);
  const floors = 21;
  const base = 6.6;
  const fh = 4.1;
  const len = 32;
  const wid = 18;
  const green = [0x4f9a3f, 0x5fa548, 0x3f8a38, 0x6aae4f];
  for (let i = 0; i < floors; i++) {
    const turn = (i * 4.5 * Math.PI) / 180;
    const z = base + i * fh;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const at = (x: number, y: number, h: number): [number, number, number] => [cu + x * c - y * s, cv + x * s + y * c, h];
    // The thick white slab with its rounded white parapet, the glass set back behind the balcony
    extrude(k, stadium(cu, cv, len, wid, turn), z - 0.9, z, WHITE);
    ring(k, stadium(cu, cv, len, wid, turn), stadium(cu, cv, len - 0.5, wid - 0.5, turn), z, z + 1.1, 0xf8f8f4);
    const glass = i >= floors - 3 ? 0x4f7e98 : 0xa3c3cc;
    const gl = len - 6;
    const gw = wid - 5;
    extrude(k, stadium(cu, cv, gl, gw, turn), z, z + fh - 0.9, glass);
    // White diagonal braces crossing the glass on the long faces, as on the real tower's frame
    k.color(WHITE);
    const half = gl / 2 - gw / 2;
    for (const side of [1, -1]) {
      const y = side * (gw / 2 + 0.06);
      for (const dir of [1, -1]) {
        const x0 = -dir * half;
        const x1 = dir * half;
        k.quad(at(x0 - 0.35, y, z), at(x0 + 0.35, y, z), at(x1 - 0.35, y, z + fh - 0.9), at(x1 + 0.35, y, z + fh - 0.9));
      }
    }
    // Clumps of shrubs and small trees spilling over the balcony edge, thicker at the round ends
    const edge = stadium(cu, cv, len - 1.4, wid - 1.4, turn, 9);
    for (let j = 0; j < edge.length; j++) {
      const end = j % 10 > 1 && j % 10 < 8;
      if (ri(i, j) < (end ? 0.12 : 0.35)) continue;
      const [pu, pv] = edge[j];
      const h = 0.8 + ri(j, i) * (end ? 2.2 : 1.2);
      k.prism(pu, pv, 0.8 + ri(j + 3, i) * 0.7, 0.45, z + 0.4, z + 0.4 + h, green[(i + j) % 4], 6);
    }
    // Slim white columns at the round ends
    for (const j of [3, 6, 13, 16]) {
      const [pu, pv] = stadium(cu, cv, len - 2, wid - 2, turn, 9)[j];
      k.prism(pu, pv, 0.22, 0.22, z, z + fh - 0.9, WHITE, 4);
    }
  }
  // The roof: two dark caps overhanging the top, one higher on the far end, with gardens between
  const top = base + floors * fh;
  const lastTurn = ((floors - 1) * 4.5 * Math.PI) / 180;
  extrude(k, stadium(cu, cv, len + 1, wid + 1, lastTurn), top - 0.9, top, WHITE);
  ring(k, stadium(cu, cv, len + 0.5, wid + 0.5, lastTurn), stadium(cu, cv, len - 1.5, wid - 1.5, lastTurn), top, top + 1, 0x5fa548);
  const cos = Math.cos(lastTurn);
  const sin = Math.sin(lastTurn);
  for (const [off, h, cap] of [[-7, 4, 17], [7.5, 6.2, 15]] as const) {
    const pu = cu + off * cos;
    const pv = cv + off * sin;
    extrude(k, stadium(pu, pv, cap - 3, 11, lastTurn), top, top + h - 0.7, 0x3d6a82);
    extrude(k, stadium(pu, pv, cap + 1, 15, lastTurn), top + h - 0.7, top + h, 0x3a3f45);
  }
  // Trees round the site
  for (const [u, v, s] of [[-15, -13, 0.85], [-8, -14, 0.75], [8, -14, 0.75], [15, -13, 0.85], [-16, 12, 0.8], [16, 13, 0.8], [-16, -2, 0.7], [16, 0, 0.7]] as const) {
    roundTree(k, u, v, s, LEAF[(u + v + 40) % 4]);
  }
}

/**
 * 綠地廣場, after a city-block park plan: a big lawn in the middle, a curved white canopy sweeping along its
 * side over the main walk, pale oval squares and little grass islands with dark hedges, a thick grove with palms
 * on one side, and rows of street trees with lamps along the pavement.
 */
export function plaza(street: Kit, w: number, d: number): void {
  const k = street.fromStreet();
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.11, PAVING);
  // Green verges with a kerb along the front and right-hand streets
  k.rect(-w / 2, -d / 2, w / 2, -d / 2 + 1.4, 0.13, LAWN);
  k.rect(w / 2 - 1.4, -d / 2, w / 2, d / 2, 0.13, LAWN);
  // The grove filling the left side: deep shade over grass, palms on its outer edge
  flat(k, blob(-11.5, 4, 6.5, 13.5, 0.1, 2, 26), 0.14, 0x5a9443);
  // The great lawn in the middle, a little right and back
  flat(k, blob(3.5, 5, 8.6, 9, 0.14, 0.7, 32, 0.2), 0.15, LAWN_BRIGHT);
  // Light oval pads on the right and at the back
  flat(k, blob(12, -1.5, 3.4, 2.5, 0.04, 1, 22, 0.4), 0.14, PAVING_LIGHT);
  flat(k, blob(11, -10.5, 4, 2.6, 0.04, 2, 22, -0.1), 0.14, PAVING_LIGHT);
  flat(k, blob(9.5, 15, 3.6, 1.7, 0.04, 3, 22), 0.14, PAVING_LIGHT);
  // Grass islands edged with dark hedges, and a long one by the lawn
  for (const [u, v, ru, rv, t] of [[-4.5, -6.5, 2.4, 1.2, 0.2], [-8.5, -9.5, 1.6, 1, 0], [-1, -10.5, 1.2, 0.8, 0], [-4, 2, 0.9, 2.4, 0.15]] as const) {
    flat(k, blob(u, v, ru + 0.35, rv + 0.35, 0.04, u, 18, t), 0.16, 0x2f6a2c);
    flat(k, blob(u, v, ru, rv, 0.04, u, 18, t), 0.2, LAWN);
  }
  // The thin white canopy ribbon: from the back it sweeps down the lawn's left side, then curls right
  const path: Pt[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const a = Math.PI * (0.35 + 1.05 * t);
    path.push([3.5 + Math.cos(a) * (9.6 + 2 * t), 5 + Math.sin(a) * (11 - 3 * t)]);
  }
  k.color(WHITE);
  for (let i = 0; i < path.length - 1; i++) {
    const [p0, p1] = [path[i], path[i + 1]];
    const du = p1[0] - p0[0];
    const dv = p1[1] - p0[1];
    const l = Math.hypot(du, dv);
    const [nu, nv] = [(-dv / l) * 0.7, (du / l) * 0.7];
    const h0 = 4.4 + Math.sin((i / 24) * Math.PI) * 0.8;
    const h1 = 4.4 + Math.sin(((i + 1) / 24) * Math.PI) * 0.8;
    k.quad([p0[0] - nu, p0[1] - nv, h0], [p1[0] - nu, p1[1] - nv, h1], [p0[0] + nu, p0[1] + nv, h0], [p1[0] + nu, p1[1] + nv, h1]);
    k.quad([p0[0] - nu, p0[1] - nv, h0 - 0.25], [p1[0] - nu, p1[1] - nv, h1 - 0.25], [p0[0] + nu, p0[1] + nv, h0 - 0.25], [p1[0] + nu, p1[1] + nv, h1 - 0.25]);
    k.color(WHITE);
    k.quad([p0[0] + nu, p0[1] + nv, h0], [p0[0] + nu, p0[1] + nv, h0 - 0.25], [p1[0] + nu, p1[1] + nv, h1], [p1[0] + nu, p1[1] + nv, h1 - 0.25]);
    if (i % 4 === 2) k.prism(p0[0], p0[1], 0.1, 0.1, 0, h0, 0xd8dadc, 4);
    k.color(WHITE);
  }
  // Benches along the paths
  for (const [u, v, t] of [[-2.5, 9, 1], [-5, -2, 1], [7, -6.5, 0], [12, 3, 1]] as const) {
    if (t) k.box(u - 0.3, v - 0.9, u + 0.3, v + 0.9, 0, 0.45, 0x8a6a4a);
    else k.box(u - 0.9, v - 0.3, u + 0.9, v + 0.3, 0, 0.45, 0x8a6a4a);
  }
  // Trees: the dense grove, palms at its edge, clumps round the lawn and rows along the streets
  const grove: [number, number, number][] = [];
  for (let i = 0; i < 26; i++) {
    const u = -16 + ri(i, 1) * 10;
    const v = -8 + ri(i, 2) * 25;
    if (grove.some(([a, b]) => Math.hypot(a - u, b - v) < 3.1)) continue;
    grove.push([u, v, 0.8 + ri(i, 3) * 0.35]);
  }
  grove.forEach(([u, v, sc], i) => roundTree(k, u, v, sc, LEAF[i % 4]));
  for (const [u, v] of [[-17, -7], [-17.2, -2], [-16.8, 2.5], [-17.2, 7], [-17, 11.5], [-15.6, -4.5]]) palm(k, u, v, 0.8);
  const clumps: [number, number, number][] = [
    [-1.5, 15.5, 0.8], [3, 16.5, 0.75], [-4.5, 13, 0.7], [11.5, 7, 0.85], [12.5, 11, 0.8], [10, 9.5, 0.7],
    [1, -4, 0.75], [4.5, -5.5, 0.8], [7.5, -3, 0.7], [2, 1, 0.65], [-2, -3, 0.6],
  ];
  clumps.forEach(([u, v, sc], i) => roundTree(k, u, v, sc, LEAF[(i + 1) % 4]));
  for (let u = -9; u <= 13; u += 3.2) roundTree(k, u, -13, 0.6, LEAF[(Math.round(u) + 20) % 4]);
  for (let u = -16; u <= 15; u += 3.6) roundTree(k, u, -d / 2 + 0.7, 0.62, LEAF[1]);
  for (let v = -15; v <= 16; v += 3.4) roundTree(k, w / 2 - 0.7, v, 0.62, LEAF[2]);
  for (let v = -12; v <= 14; v += 3.4) roundTree(k, w / 2 - 3.6, v + 1.7, 0.58, LEAF[0]);
  for (const [u, v] of [[-6, -12], [6, -12.5], [15.5, -6], [15.5, 6], [-1, 8], [8, 1]]) lamp(k, u, v);
}

/**
 * 生態公園, after a wetland park in the paddy fields: two big green ponds and a little one, an island of
 * 落羽松 in the main pond, russet cypresses round the shores, wooden boardwalks along and between them, two
 * hexagonal pavilions on a walled mound, a white stepped bridge, open lawns at the back with an avenue of
 * tall trees, and thick woods down one side. A hedge and a path run round the edge.
 */
export function ecoPark(street: Kit, w: number, d: number): void {
  const k = street.fromStreet();
  k.rect(-w / 2, -d / 2, w / 2, d / 2, 0.1, 0x8fa860);
  // Paths round the edge, a hedge inside them
  k.rect(-w / 2, -d / 2, w / 2, -d / 2 + 2.4, 0.13, 0xc9c3b4);
  k.rect(-w / 2, -d / 2, -w / 2 + 2.4, d / 2, 0.13, 0xc9c3b4);
  k.box(-w / 2 + 2.6, -d / 2 + 2.6, w / 2 - 9, -d / 2 + 3.6, 0.1, 1.4, 0x3f7f3a);
  // Open lawns at the back: some dry, some green
  flat(k, blob(-14, 24, 16, 8, 0.08, 1, 20), 0.12, 0xa9a966);
  flat(k, blob(6, 25, 10, 7, 0.08, 2, 20), 0.12, 0x95b05e);
  // Woods down the right side and along the front corner
  flat(k, blob(30, -5, 9, 27, 0.1, 3, 26), 0.12, 0x3f6e33);
  flat(k, blob(10, -26, 13, 5.5, 0.12, 4, 22), 0.12, 0x3f6e33);
  // The ponds: muddy rims, green water
  const ponds: [Pt[], Pt[]][] = [
    [blob(-12, -6, 19, 11, 0.2, 0.5, 34, -0.1), blob(-12, -6, 17.6, 9.8, 0.2, 0.5, 34, -0.1)],
    [blob(14, 4, 10.5, 9, 0.18, 2.2, 28, 0.3), blob(14, 4, 9.4, 8, 0.18, 2.2, 28, 0.3)],
    [blob(3, -9, 4.6, 3.4, 0.12, 4, 20), blob(3, -9, 3.8, 2.7, 0.12, 4, 20)],
  ];
  for (const [rim, water] of ponds) {
    flat(k, rim, 0.14, 0x9a8f6a);
    flat(k, water, 0.17, 0x5f8f5c);
  }
  // Island in the main pond with its own cypresses, and stepping stones
  flat(k, blob(-13, -4, 4, 3, 0.15, 1.3, 18), 0.22, 0x8a9a58);
  for (const [u, v] of [[-14, -3], [-12, -5], [-15, -5]]) cypress(k, u, v, 0.85, 0xa9542a);
  for (const [u, v] of [[-4, -12], [-3, -13.5], [-6, -13]]) k.prism(u, v, 0.6, 0.5, 0.15, 0.35, 0x9c9a92, 6);
  // Boardwalks: along the front shore, round the back, across between the ponds and over the little one
  const walk = (pts: Pt[]) => {
    k.color(0x8a5a3c);
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nu = (-(b[1] - a[1]) / len) * 1;
      const nv = ((b[0] - a[0]) / len) * 1;
      k.quad([a[0] - nu, a[1] - nv, 0.45], [a[0] + nu, a[1] + nv, 0.45], [b[0] - nu, b[1] - nv, 0.45], [b[0] + nu, b[1] + nv, 0.45]);
    }
    for (const [u, v] of pts) k.prism(u, v, 0.15, 0.15, 0, 0.45, 0x6a4a30, 4);
  };
  walk([[-36, -16], [-28, -19], [-18, -19.5], [-8, -18.5], [0, -15], [6, -13], [12, -12]]);
  walk([[-36, 8], [-28, 7.5], [-20, 7], [-10, 6.5], [-3, 5], [2, 2], [5, -3]]);
  walk([[-1, -9], [7, -9]]);
  walk([[4, 11], [8, 12], [14, 14], [20, 13]]);
  // The walled mound between the ponds with two hexagonal pavilions on it
  k.prism(-4, 13, 8, 8, 0.1, 1.6, 0x9c968a, 18);
  k.prism(-4, 13, 7.5, 7.5, 1.6, 1.8, 0x8fa860, 18);
  roundTree(k, -2, 15.5, 1.2, LEAF[0]);
  roundTree(k, -7, 16, 1, LEAF[3]);
  for (const pu of [-7, -1]) {
    const pv = 11;
    for (let a = 0; a < 6; a++) k.prism(pu + Math.cos(a * 1.047) * 1.9, pv + Math.sin(a * 1.047) * 1.9, 0.12, 0.12, 1.8, 4.4, 0xe6e2d8, 4);
    k.prism(pu, pv, 2.2, 2.2, 1.8, 2.1, 0xd9d4c8, 6);
    k.prism(pu, pv, 2.9, 0.2, 4.3, 6.1, 0x8e8f8c, 6);
  }
  // The white stepped bridge running up from the far pond
  for (let i = 0; i < 6; i++) {
    const u = 14 + i * 1.8;
    const v = 13 + i * 2.2;
    k.box(u - 1.6, v - 0.6, u + 1.6, v + 0.6, 0.3, 0.9 + (i % 2) * 0.3, WHITE);
    k.box(u - 1.6, v - 0.6, u - 1.4, v + 0.6, 0.9, 1.9, WHITE);
    k.box(u + 1.4, v - 0.6, u + 1.6, v + 0.6, 0.9, 1.9, WHITE);
  }
  // 落羽松 round the shores, russet and orange
  const russet = [0xb8642f, 0xc7783a, 0x9c5530, 0xd08a44];
  const shore: Pt[] = [];
  for (const [rim] of ponds.slice(0, 2)) for (let i = 0; i < rim.length; i += 3) shore.push(rim[i]);
  shore.forEach(([u, v], i) => {
    if (v < -18 || v > 17 || u > 24) return;
    const o = 1.6 + ri(i, 3) * 1.4;
    const [cu, cv] = u < 0 ? [-12, -6] : [14, 4];
    const len = Math.hypot(u - cu, v - cv) || 1;
    cypress(k, u + ((u - cu) / len) * o, v + ((v - cv) / len) * o, 0.85 + ri(i, 7) * 0.4, russet[i % 4]);
  });
  // The woods: dense round trees over the dark ground
  for (let i = 0; i < 70; i++) {
    const u = 21 + ri(i, 1) * 17;
    const v = -31 + ri(i, 2) * 49;
    if (u < 26 && v > -2) continue;
    roundTree(k, u, v, 0.9 + ri(i, 4) * 0.5, LEAF[i % 4]);
  }
  for (let i = 0; i < 20; i++) roundTree(k, -2 + ri(i, 5) * 22, -32 + ri(i, 6) * 9, 0.9 + ri(i, 8) * 0.4, LEAF[i % 4]);
  // An avenue of tall, thin trees along the back, and a few on the lawns
  for (let u = -36; u <= 14; u += 4) {
    k.prism(u, 31, 0.2, 0.14, 0, 6, 0x8a7a66, 5);
    k.prism(u, 31, 1.4, 0.3, 4.5, 9.5, 0x8c8a5a, 5);
  }
  for (const [u, v] of [[-26, 20], [-6, 24], [10, 22]]) roundTree(k, u, v, 1, LEAF[2]);
  // A little blue-roofed shed in the front corner
  k.box(w / 2 - 7, -d / 2 + 3, w / 2 - 3, -d / 2 + 6, 0, 2.6, 0xe9e6dc);
  k.box(w / 2 - 7.3, -d / 2 + 2.7, w / 2 - 2.7, -d / 2 + 6.3, 2.6, 2.9, 0x4f7fb8);
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ACCESS_Y, type Airport, Aviation, GATE_Y, RANK_X, RUNWAY_LENGTH, RUNWAY_WIDTH, TAXI_CYCLE, TAXI_Y, TERMINAL_DEPTH, TERMINAL_Y } from '../sim/airport';
import { AIRPORT_ROAD_LANES } from '../sim/city';
import { asphaltWidth } from '../sim/roads';
import { type Vec2, clamp } from '../sim/geometry';
import { HEADLIGHT, TAILLIGHT } from './kit';
import { Builder } from './roadMesh';
import { taxiGeometry } from './vehicles';

const GRASS = 0xb4cf8a;
const ASPHALT = 0x4f545b;
const APRON = 0xa9aca6;
const MARK = 0xf4f4f0;
const CONCRETE = 0xd9d6cf;
const GLASS = 0x8fb8cc;
const ROOF = 0xf4f4f0;
const WALL = 0xc9c6bd;
const MAX_PLANES = 120;

/** Night glow colours, added on top of the lit colour as the sun goes down. */
const WARM: Glow = [1.0, 0.84, 0.58];
const WHITE: Glow = [1.0, 0.97, 0.88];
const NONE: Glow = [0, 0, 0];
type Glow = [number, number, number];
const dim = (g: Glow, k: number): Glow => [g[0] * k, g[1] * k, g[2] * k];

/** Where the airside fence meets the terminal's ends; landside lies beyond it. */
const FENCE_Y = TERMINAL_Y + 8;
/** Landside: the kerb road under the canopy, then the taxi rank lane. */
const KERB_Y0 = TERMINAL_Y + TERMINAL_DEPTH + 1;
const KERB_Y1 = KERB_Y0 + 7;
const RANK_Y0 = KERB_Y1 + 0.6;
const RANK_Y1 = RANK_Y0 + 6;
const RANK_Y = (RANK_Y0 + RANK_Y1) / 2;
/** Cabs queue this far apart behind the head of the rank. */
const TAXI_GAP = 7;
/** Half the width of the access road's asphalt, where it meets the landside road at x = 0. */
const ACCESS_HALF = asphaltWidth({ lanes: AIRPORT_ROAD_LANES }) / 2;
const MAX_TAXIS = 200;

/** Half the length of the terminal and its apron. */
function terminalHalf(a: Airport): number {
  return (Aviation.gates(a) * 34) / 2 + 20;
}

/** Cabs waiting at an airport's rank. */
function rankSize(a: Airport): number {
  return Math.max(4, Math.min(16, Math.floor((terminalHalf(a) - RANK_X - 10) / TAXI_GAP)));
}

/**
 * The airport's mesh shader: Lambert with vertex colours, plus a per-vertex `glow` colour that lights up at night
 * (terminal glass, floodlit apron, runway and taxiway lights, the tower cab, taxi lamps).
 */
export function airportMaterial(night: { value: number }): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 glow;\nvarying vec3 vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying vec3 vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow * uNight;');
  };
  mat.customProgramCacheKey = () => 'airport-glow';
  return mat;
}

/** Flat quads and boxes in an airport's own frame (x along the runways), each with a night glow. */
class Field {
  readonly b = new Builder(0);
  private glows: number[] = [];
  a!: Airport;
  /** glow of the parts that follow */
  glow: Glow = NONE;

  private w(x: number, y: number): Vec2 {
    return Aviation.toWorld(this.a, { x, y });
  }

  /** A quad from local points [x, y, height]; a–b and c–d are opposite edges. */
  quad(a: number[], b: number[], c: number[], d: number[], color: number): void {
    this.b.color = new THREE.Color(color);
    const p = [a, b, c, d].map((q) => {
      const v = this.w(q[0], q[1]);
      return [v.x, v.y, q[2]];
    });
    this.b.quad(p[0], p[1], p[2], p[3]);
    for (let k = 0; k < 4; k++) this.glows.push(...this.glow);
  }

  rect(x0: number, y0: number, x1: number, y1: number, h: number, color: number): void {
    this.quad([x0, y0, h], [x1, y0, h], [x0, y1, h], [x1, y1, h], color);
  }

  box(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, color: number): void {
    const c = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    for (let k = 0; k < 4; k++) {
      const p = c[k];
      const q = c[(k + 1) % 4];
      this.quad([p[0], p[1], z1], [p[0], p[1], z0], [q[0], q[1], z1], [q[0], q[1], z0], color);
    }
    this.rect(x0, y0, x1, y1, z1, color);
  }

  /** A small lamp: a bright block that glows hard at night. */
  lamp(x: number, y: number, s: number, h: number, color: number, glow: Glow): void {
    const keep = this.glow;
    this.glow = glow;
    this.box(x - s, y - s, x + s, y + s, h - s, h + s * 0.6, color);
    this.glow = keep;
  }

  /** A pole with a lamp head on top. */
  pole(x: number, y: number, h: number, head: number, glow: Glow): void {
    this.glow = NONE;
    this.box(x - 0.25, y - 0.25, x + 0.25, y + 0.25, 0, h, 0x8a8f94);
    this.lamp(x, y, head, h + head * 0.4, 0xfdf6e3, glow);
  }

  geometry(): THREE.BufferGeometry {
    const g = this.b.geometry();
    g.setAttribute('glow', new THREE.Float32BufferAttribute(this.glows, 3));
    return g;
  }
}

/**
 * Runways, taxiways and apron with their lights; a terminal after Taoyuan's, with a white wave roof over a glass
 * hall and the kerb; its control tower, a perimeter wall around the airside, a taxi rank and car parks.
 */
export function buildAirportGeometry(airports: Iterable<Airport>): THREE.BufferGeometry {
  const f = new Field();
  for (const a of airports) {
    f.a = a;
    f.glow = NONE;
    const e = Aviation.extent(a.runways);
    const L = RUNWAY_LENGTH / 2;
    f.rect(e.minX, e.minY, e.maxX, e.maxY, 0.03, GRASS);
    for (let k = 0; k < a.runways; k++) runway(f, Aviation.runwayY(k));
    // Taxiway with blue edge lights
    f.rect(-L - 29, TAXI_Y - 9, L + 29, TAXI_Y + 9, 0.07, ASPHALT);
    for (let x = -L - 20; x < L + 20; x += 12) f.rect(x, TAXI_Y - 0.25, x + 6, TAXI_Y + 0.25, 0.11, 0xf2c230);
    for (let x = -L - 24; x <= L + 24; x += 24) for (const y of [TAXI_Y - 9.6, TAXI_Y + 9.6]) f.lamp(x, y, 0.65, 0.55, 0x3d7bff, [0.25, 0.5, 1.6]);
    apron(f, a);
    terminal(f, a);
    tower(f, terminalHalf(a) + 45, TERMINAL_Y - 16);
    landside(f, a);
    fence(f, a);
  }
  return f.geometry();
}

function runway(f: Field, y: number): void {
  const L = RUNWAY_LENGTH / 2;
  const W = RUNWAY_WIDTH / 2;
  f.glow = NONE;
  f.rect(-L, y - W, L, y + W, 0.08, ASPHALT);
  // Centre line dashes, threshold bars at both ends and touchdown marks
  for (let x = -L + 40; x < L - 40; x += 30) f.rect(x, y - 0.5, x + 15, y + 0.5, 0.12, MARK);
  for (const end of [-1, 1]) {
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      const yy = y + i * 3;
      const x0 = end * (L - 6);
      f.rect(Math.min(x0, x0 - end * 22), yy - 0.8, Math.max(x0, x0 - end * 22), yy + 0.8, 0.12, MARK);
    }
    for (const s of [-1, 1]) {
      const x0 = end * (L - 70);
      f.rect(Math.min(x0, x0 - end * 26), y + s * 7 - 1.6, Math.max(x0, x0 - end * 26), y + s * 7 + 1.6, 0.12, MARK);
    }
  }
  // Links from the runway ends to the taxiway
  for (const x of [-L - 20, L + 20]) f.rect(x - 9, y - 9, x + 9, TAXI_Y + 9, 0.07, ASPHALT);
  for (const x of [-L - 20, L + 20]) f.rect(Math.min(x, x < 0 ? -L : L), y - 9, Math.max(x, x < 0 ? -L : L), y + 9, 0.07, ASPHALT);
  // Edge lights, green at the landing threshold, red at the far end
  for (let x = -L + 10; x <= L - 10; x += 30) for (const s of [-1, 1]) f.lamp(x, y + s * (W + 0.8), 0.75, 0.6, 0xfff3cf, [1.6, 1.5, 1.1]);
  for (let yy = -W + 1.5; yy <= W - 1.5; yy += 3) {
    f.lamp(-L + 0.8, y + yy, 0.45, 0.45, 0x5ce07a, [0.3, 1.6, 0.5]);
    f.lamp(L - 0.8, y + yy, 0.45, 0.45, 0xff5040, [1.6, 0.25, 0.2]);
  }
  // Approach lights: a row of bars leading in to the landing end
  for (let x = -L - 33; x >= -L - 48; x -= 7.5) {
    f.lamp(x, y, 0.6, 1.2, 0xfffbe8, [1.8, 1.8, 1.6]);
    for (let s = 2; s <= 6; s += 2) for (const side of [-1, 1]) f.lamp(x, y + side * s, 0.45, 1.2, 0xfffbe8, [1.8, 1.8, 1.6]);
  }
}

/** Floodlit apron with a stand and jet bridge at every gate, and high-mast lights between the stands. */
function apron(f: Field, a: Airport): void {
  const half = terminalHalf(a);
  f.glow = [0.6, 0.54, 0.42];
  f.rect(-half, TAXI_Y + 9, half, TERMINAL_Y, 0.06, APRON);
  f.glow = NONE;
  for (let g = 0; g < Aviation.gates(a); g++) {
    const x = Aviation.gateX(a, g);
    f.rect(x - 0.3, TAXI_Y, x + 0.3, GATE_Y + 8, 0.1, 0xf2c230);
    f.rect(x - 9, GATE_Y + 7.6, x + 9, GATE_Y + 8.2, 0.1, 0xf2c230);
    // Jet bridge on a leg, its cab lit at night
    f.glow = NONE;
    f.box(x + 4, GATE_Y + 10, x + 7, TERMINAL_Y, 4, 6.5, 0xdfe3e6);
    f.box(x + 5, GATE_Y + 13, x + 6, GATE_Y + 14, 0, 4, 0x8a8f94);
    f.glow = dim(WARM, 0.6);
    f.box(x + 3.6, GATE_Y + 9, x + 7.4, GATE_Y + 11, 4.2, 6.2, 0xc8d6de);
    f.glow = NONE;
  }
  for (let g = 0; g <= Aviation.gates(a); g++) {
    const x = g === 0 ? -half + 4 : g === Aviation.gates(a) ? half - 4 : (Aviation.gateX(a, g - 1) + Aviation.gateX(a, g)) / 2;
    f.pole(x, TAXI_Y + 15, 24, 1.3, [2, 1.9, 1.6]);
  }
}

/**
 * The terminal, after Taoyuan's Terminal 2 and 3: a long glass hall under a white roof that rolls in waves along
 * its length and runs out over the departures kerb as a canopy on slender columns.
 */
function terminal(f: Field, a: Airport): void {
  const half = terminalHalf(a);
  const x0 = -half + 6;
  const x1 = half - 6;
  const y0 = TERMINAL_Y;
  const y1 = TERMINAL_Y + TERMINAL_DEPTH;
  f.glow = NONE;
  f.box(x0, y0, x1, y1, 0, 3, CONCRETE);
  f.glow = dim(WARM, 1.15);
  f.box(x0 + 1, y0 + 0.6, x1 - 1, y1 - 0.6, 3, 16, GLASS);
  // Mullions on both long faces
  f.glow = NONE;
  for (let x = x0 + 4; x < x1 - 2; x += 6) {
    f.box(x - 0.25, y0 + 0.3, x + 0.25, y0 + 0.7, 3, 16, 0xe3e6e8);
    f.box(x - 0.25, y1 - 0.7, x + 0.25, y1 - 0.3, 3, 16, 0xe3e6e8);
  }
  f.box(x0 + 1, y0 + 0.2, x1 - 1, y0 + 0.7, 9.2, 9.8, 0xe3e6e8);
  f.box(x0 + 1, y1 - 0.7, x1 - 1, y1 - 0.2, 9.2, 9.8, 0xe3e6e8);
  // Illuminated name board over the main doors
  f.glow = [0.25, 0.55, 1.4];
  f.box(-16, y1 - 0.2, 16, y1 + 0.3, 11, 13.4, 0x1f4e8c);
  f.glow = [1.6, 1.6, 1.6];
  for (let x = -13; x <= 13; x += 4.4) f.box(x - 1.4, y1 + 0.3, x + 1.4, y1 + 0.45, 11.6, 12.8, 0xf4f4f0);
  // Wave roof: the top rolls along x and bows gently across y; the underside follows it a metre lower
  const ry0 = y0 - 5;
  const ry1 = KERB_Y1 + 0.5;
  const wave = (x: number) => 18 + 2.8 * Math.sin((2 * Math.PI * x) / 58);
  const bow = (y: number) => 1.8 * Math.sin((Math.PI * (y - ry0)) / (ry1 - ry0));
  const top = (x: number, y: number) => wave(x) + bow(y);
  const rx0 = x0 - 3;
  const rx1 = x1 + 3;
  const xs: number[] = [];
  for (let x = rx0; x < rx1; x += 4) xs.push(x);
  xs.push(rx1);
  const ys = [ry0, ry0 + (ry1 - ry0) * 0.25, ry0 + (ry1 - ry0) * 0.5, ry0 + (ry1 - ry0) * 0.75, ry1];
  for (let i = 1; i < xs.length; i++) {
    const xa = xs[i - 1];
    const xb = xs[i];
    for (let j = 1; j < ys.length; j++) {
      const ya = ys[j - 1];
      const yb = ys[j];
      // Floodlights wash the roof at night
      f.glow = [0.16, 0.18, 0.22];
      f.quad([xa, ya, top(xa, ya)], [xa, yb, top(xa, yb)], [xb, ya, top(xb, ya)], [xb, yb, top(xb, yb)], ROOF);
      f.glow = dim(WARM, 0.45);
      f.quad([xa, ya, top(xa, ya) - 1], [xa, yb, top(xa, yb) - 1], [xb, ya, top(xb, ya) - 1], [xb, yb, top(xb, yb) - 1], 0xe6e1d6);
    }
    // Roof edges: a white fascia front and back, lit along its length
    f.glow = dim(WHITE, 0.7);
    for (const y of [ry0, ry1]) f.quad([xa, y, top(xa, y)], [xa, y, top(xa, y) - 1], [xb, y, top(xb, y)], [xb, y, top(xb, y) - 1], ROOF);
    // Skylight strip along the ridge
    f.glow = dim(WHITE, 0.8);
    const ym = ys[2];
    f.quad([xa, ym - 1.5, top(xa, ym - 1.5) + 0.05], [xa, ym + 1.5, top(xa, ym + 1.5) + 0.05], [xb, ym - 1.5, top(xb, ym - 1.5) + 0.05], [xb, ym + 1.5, top(xb, ym + 1.5) + 0.05], 0xb9d4e0);
  }
  f.glow = NONE;
  for (const x of [rx0, rx1]) for (let j = 1; j < ys.length; j++) {
    f.quad([x, ys[j - 1], top(x, ys[j - 1])], [x, ys[j - 1], top(x, ys[j - 1]) - 1], [x, ys[j], top(x, ys[j])], [x, ys[j], top(x, ys[j]) - 1], ROOF);
  }
  // Columns holding the canopy over the kerb, a lamp under each
  for (let x = x0 + 8; x < x1 - 4; x += 29) {
    f.glow = NONE;
    f.box(x - 0.45, KERB_Y1 - 0.9, x + 0.45, KERB_Y1, 0, top(x, KERB_Y1) - 1, 0xf0f0ee);
  }
}

/** A slender white control tower with a flared, glazed cab, after Taoyuan's. */
function tower(f: Field, x: number, y: number): void {
  f.glow = NONE;
  f.box(x - 6, y - 6, x + 6, y + 6, 0, 5, CONCRETE);
  f.glow = dim(WARM, 0.8);
  f.box(x - 5.6, y - 5.6, x + 5.6, y + 5.6, 1, 4.2, GLASS);
  f.glow = NONE;
  const levels = 6;
  for (let i = 0; i < levels; i++) {
    const r0 = 3.4 - i * 0.18;
    const r1 = 3.4 - (i + 1) * 0.18;
    const z0 = 5 + i * 9;
    f.box(x - r0, y - r0, x + r0, y + r0, z0, z0 + 9, 0xeeece6);
    f.box(x - r1 - 0.2, y - r1 - 0.2, x + r1 + 0.2, y + r1 + 0.2, z0 + 8.6, z0 + 9, 0xd5d2ca);
  }
  const zc = 5 + levels * 9;
  // Flared underside, glazed cab, roof and mast with a red beacon
  f.box(x - 5, y - 5, x + 5, y + 5, zc, zc + 2, 0xe6e3dc);
  f.box(x - 6.5, y - 6.5, x + 6.5, y + 6.5, zc + 2, zc + 3, 0xd5d2ca);
  f.glow = [0.5, 0.95, 1.2];
  f.box(x - 6.2, y - 6.2, x + 6.2, y + 6.2, zc + 3, zc + 7.5, 0x4f7f96);
  f.glow = NONE;
  f.box(x - 7, y - 7, x + 7, y + 7, zc + 7.5, zc + 8.5, 0xf2f2ef);
  f.box(x - 0.3, y - 0.3, x + 0.3, y + 0.3, zc + 8.5, zc + 15, 0xb7bcc0);
  f.lamp(x, y, 0.6, zc + 15.5, 0xff3b30, [2, 0.2, 0.15]);
}

/** Departures kerb, the taxi rank lane, street lamps and the car parks beyond the terminal's ends. */
function landside(f: Field, a: Airport): void {
  const e = Aviation.extent(a.runways);
  const half = terminalHalf(a);
  f.glow = dim(WARM, 0.28);
  f.rect(-half + 4, TERMINAL_Y + TERMINAL_DEPTH, half - 4, KERB_Y0, 0.12, 0xc9c6bd);
  f.rect(e.minX + 2, KERB_Y0, e.maxX - 2, KERB_Y1, 0.07, ASPHALT);
  f.rect(e.minX + 2, KERB_Y1, e.maxX - 2, RANK_Y0, 0.12, 0xc9c6bd);
  f.rect(e.minX + 2, RANK_Y0, e.maxX - 2, RANK_Y1, 0.07, ASPHALT);
  // The access road comes in across the rank lane and the island to the kerb road
  f.rect(-ACCESS_HALF, KERB_Y1 - 0.5, ACCESS_HALF, ACCESS_Y, 0.13, ASPHALT);
  f.glow = NONE;
  for (let x = e.minX + 6; x < e.maxX - 6; x += 12) f.rect(x, (KERB_Y0 + KERB_Y1) / 2 - 0.15, x + 6, (KERB_Y0 + KERB_Y1) / 2 + 0.15, 0.1, MARK);
  // The rank: a yellow-edged bay with a sign at its head
  const n = rankSize(a);
  const bx0 = RANK_X - 4;
  const bx1 = RANK_X + n * TAXI_GAP;
  for (const y of [RANK_Y0 + 0.4, RANK_Y1 - 0.4]) f.rect(bx0, y - 0.15, bx1, y + 0.15, 0.1, 0xf2c230);
  for (let x = bx0; x <= bx1 + 0.1; x += TAXI_GAP) f.rect(x - 0.15, RANK_Y0 + 0.4, x + 0.15, RANK_Y1 - 0.4, 0.1, 0xf2c230);
  f.box(bx0 - 0.15, KERB_Y1 + 0.2, bx0 + 0.15, KERB_Y1 + 0.4, 0, 3, 0x8a8f94);
  f.glow = [1.6, 1.3, 0.2];
  f.box(bx0 - 1.2, KERB_Y1 + 0.15, bx0 + 1.2, KERB_Y1 + 0.45, 3, 4.2, 0xf6c700);
  // Street lamps along the outer edge of the landside road
  for (let x = e.minX + 10; x < e.maxX - 6; x += 22) if (Math.abs(x) > ACCESS_HALF + 1) f.pole(x, RANK_Y1 + 0.8, 8, 0.6, [1.8, 1.5, 1.0]);
  // Car parks past each end of the terminal: a parking garage and an open lot
  const py0 = FENCE_Y + 3;
  const py1 = KERB_Y0 - 1.5;
  const gx0 = half + 4;
  const gx1 = Math.min(half + 80, e.maxX - 6);
  f.glow = NONE;
  for (let k = 0; k < 4; k++) {
    f.box(gx0, py0, gx1, py1, k * 3.2, k * 3.2 + 0.6, 0xbfbcb4);
    if (k < 3) {
      f.glow = dim(WHITE, 0.55);
      f.box(gx0 + 0.6, py0 + 0.6, gx1 - 0.6, py1 - 0.6, k * 3.2 + 0.6, k * 3.2 + 3.2, 0x5d6268);
      f.glow = NONE;
    }
  }
  f.glow = [0.25, 0.55, 1.4];
  f.box(gx0 + 2, py1 - 0.1, gx0 + 8, py1 + 0.2, 7, 9.6, 0x1f6fd0);
  f.glow = NONE;
  const lx1 = -half - 4;
  const lx0 = Math.max(-half - 80, e.minX + 6);
  f.rect(lx0, py0, lx1, py1, 0.07, 0x6a6f75);
  const colors = [0xf2f2f0, 0xbfc4c9, 0x2b2d31, 0x6c7178, 0x23395d, 0xa3222a];
  let c = 0;
  for (let x = lx0 + 3; x < lx1 - 3; x += 3.2) {
    for (const y of [py0 + 3, py1 - 3]) {
      f.rect(x - 0.08, y - 2.6, x + 0.08, y + 2.6, 0.1, MARK);
      if ((c * 7) % 5 < 3) f.box(x + 0.45, y - 2.1, x + 2.35, y + 2.1, 0.3, 1.45, colors[c % colors.length]);
      c++;
    }
  }
  for (let x = lx0 + 10; x < lx1; x += 24) f.pole(x, (py0 + py1) / 2, 9, 0.6, [1.8, 1.5, 1.0]);
}

/**
 * The airside wall: grey concrete topped with razor wire, round the runways and apron, meeting the terminal's
 * ends so that the only way airside is through the building.
 */
function fence(f: Field, a: Airport): void {
  const e = Aviation.extent(a.runways);
  const half = terminalHalf(a);
  const fx0 = e.minX + 3;
  const fx1 = e.maxX - 3;
  const fy0 = e.minY + 3;
  const t = 0.25;
  const wall = (x0: number, y0: number, x1: number, y1: number) => {
    f.glow = NONE;
    f.box(Math.min(x0, x1) - t, Math.min(y0, y1) - t, Math.max(x0, x1) + t, Math.max(y0, y1) + t, 0, 2.6, WALL);
    f.box(Math.min(x0, x1) - t - 0.1, Math.min(y0, y1) - t - 0.1, Math.max(x0, x1) + t + 0.1, Math.max(y0, y1) + t + 0.1, 2.6, 2.8, 0xb0ada4);
    f.box(Math.min(x0, x1) - 0.3, Math.min(y0, y1) - 0.3, Math.max(x0, x1) + 0.3, Math.max(y0, y1) + 0.3, 2.8, 3.4, 0x5a5f64);
    // Posts for the wire every 10 m
    const len = Math.hypot(x1 - x0, y1 - y0);
    for (let d = 0; d <= len; d += 10) {
      const x = x0 + ((x1 - x0) * d) / len;
      const y = y0 + ((y1 - y0) * d) / len;
      f.box(x - 0.12, y - 0.12, x + 0.12, y + 0.12, 2.6, 3.8, 0x3e4246);
    }
  };
  wall(-half + 6, FENCE_Y, fx0, FENCE_Y);
  wall(fx0, FENCE_Y, fx0, fy0);
  wall(fx0, fy0, fx1, fy0);
  wall(fx1, fy0, fx1, FENCE_Y);
  wall(fx1, FENCE_Y, half - 6, FENCE_Y);
}

/** Lamps on a taxi: its roof sign and head and tail lights glow at night. */
function withLamps(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const col = g.getAttribute('color');
  const pos = g.getAttribute('position');
  const head = new THREE.Color(HEADLIGHT);
  const tail = new THREE.Color(TAILLIGHT);
  const c = new THREE.Color();
  const glow = new Float32Array(col.count * 3);
  for (let i = 0; i < col.count; i++) {
    c.fromBufferAttribute(col as THREE.BufferAttribute, i);
    // Lamps glow; the rest catches a little of the rank's floodlights
    const lit = c.equals(head) ? [1.4, 1.35, 1.1] : c.equals(tail) ? [1.4, 0.15, 0.1] : c.r > 0.99 && c.g > 0.99 && pos.getY(i) > 1.45 ? [1.5, 1.3, 0.7] : [c.r * 0.4, c.g * 0.4, c.b * 0.4];
    glow.set(lit, i * 3);
  }
  g.setAttribute('glow', new THREE.BufferAttribute(glow, 3));
  return g;
}

/**
 * Yellow cabs queueing at each airport's rank. Every few seconds the cab at the head pulls away and turns into the
 * access road (where the simulation puts it on the streets into town), the queue creeps up one place and a new cab
 * drives in to the back.
 */
export class TaxiRank {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private minX = 0;
  private maxX = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  constructor(material: THREE.Material, shadows: boolean) {
    this.mesh = new THREE.InstancedMesh(withLamps(taxiGeometry()), material, MAX_TAXIS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadows;
  }

  update(aviation: Aviation): void {
    const t = aviation.taxiTime;
    const creep = smooth(clamp((t / TAXI_CYCLE - 0.15) / 0.3, 0, 1));
    this.n = 0;
    for (const a of aviation.airports.values()) {
      const e = Aviation.extent(a.runways);
      this.minX = e.minX + 6;
      this.maxX = e.maxX - 6;
      const size = rankSize(a);
      const back = RANK_X + (size - 1) * TAXI_GAP;
      // Cabs face -x, out towards the exit
      this.q.setFromAxisAngle(this.up, Math.PI - a.angle);
      // The head of the queue pulls away; those that left in the last cycles are still driving off
      const leaving = RANK_X - driven(t);
      if (leaving > ACCESS_HALF / 2) this.put(a, leaving);
      for (let i = 1; i < size; i++) this.put(a, RANK_X + (i - creep) * TAXI_GAP);
      // New cabs slow down into the back of the queue, arriving three quarters of the way through a cycle
      for (let k = 0; k < 3; k++) this.put(a, back + driven(TAXI_CYCLE * (0.75 + k) - t));
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** A cab at airport-local x in the rank lane, unless it is off the airport's land. */
  private put(a: Airport, x: number): void {
    if (this.n >= MAX_TAXIS || x < this.minX || x > this.maxX) return;
    const w = Aviation.toWorld(a, { x, y: RANK_Y });
    this.p.set(w.x, 0.07, w.y);
    this.m.compose(this.p, this.q, this.one);
    this.mesh.setMatrixAt(this.n++, this.m);
  }
}

const smooth = (v: number) => v * v * (3 - 2 * v);

/** Metres a cab covers in s seconds from a standstill: 2 m/s² up to 14 m/s (50 km/h), then steady. */
function driven(s: number): number {
  if (s <= 0) return 0;
  return s < 7 ? s * s : 49 + 14 * (s - 7);
}

/** Planes: fuselage and tail in the flight's colour, white wings. */
export class PlaneLayer {
  readonly group = new THREE.Group();
  private bodies: THREE.InstancedMesh;
  private wings: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private c = new THREE.Color();

  constructor(shadows: boolean) {
    const fuselage = new THREE.CylinderGeometry(2, 2, 36, 8).rotateZ(Math.PI / 2).translate(0, 3.2, 0);
    const nose = new THREE.ConeGeometry(2, 5, 8).rotateZ(-Math.PI / 2).translate(20.5, 3.2, 0);
    const tailCone = new THREE.ConeGeometry(2, 7, 8).rotateZ(Math.PI / 2).translate(-21.5, 3.6, 0);
    const fin = new THREE.BoxGeometry(6, 7, 0.5).translate(-20, 8, 0);
    this.bodies = new THREE.InstancedMesh(mergeGeometries([fuselage, nose, tailCone, fin])!, new THREE.MeshLambertMaterial({ flatShading: true }), MAX_PLANES);
    const wing = new THREE.BoxGeometry(7, 0.5, 36).translate(1, 2.4, 0);
    const stab = new THREE.BoxGeometry(3.5, 0.4, 13).translate(-21, 4.4, 0);
    const engines = [-8, 8].map((z) => new THREE.CylinderGeometry(1, 1, 4.5, 8).rotateZ(Math.PI / 2).translate(3, 1.4, z));
    this.wings = new THREE.InstancedMesh(mergeGeometries([wing, stab, ...engines])!, new THREE.MeshLambertMaterial({ color: 0xe9ecef, flatShading: true }), MAX_PLANES);
    for (const m of [this.bodies, this.wings]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = shadows;
      this.group.add(m);
    }
  }

  update(aviation: Aviation): void {
    let n = 0;
    for (const f of aviation.flights.values()) {
      const pose = aviation.pose(f);
      if (!pose || n >= MAX_PLANES) continue;
      const pitch = f.state === 'climb' ? 0.16 : f.state === 'approach' ? -0.05 : 0;
      this.e.set(0, Math.atan2(-pose.heading.y, pose.heading.x), pitch);
      this.q.setFromEuler(this.e);
      this.p.set(pose.p.x, pose.h + 0.1, pose.p.y);
      this.m.compose(this.p, this.q, this.one);
      this.bodies.setMatrixAt(n, this.m);
      this.wings.setMatrixAt(n, this.m);
      this.bodies.setColorAt(n, this.c.setHex(f.color));
      n++;
    }
    this.bodies.count = n;
    this.wings.count = n;
    for (const m of [this.bodies, this.wings]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

import * as THREE from 'three';
import { closestOnSamples, quadPoint, quadTangent, tAtLength } from '../sim/geometry';
import type { RailSystem } from '../sim/rail';
import { type RoadNetwork, asphaltWidth, roadWidth } from '../sim/roads';
import { Zone } from '../sim/zoning';
import { Builder } from './roadMesh';

const GLASS = 0x9ec9dc;
const CONCRETE = 0xd2d4cf;
const PLATFORM = 0xb9bbb5;
/** Kaohsiung MRT: white steel, blue-green glass, and the orange of its logo */
const KMRT_ORANGE = 0xf28c28;
const KMRT_GLASS = 0x86bfd6;
const STEEL_WHITE = 0xf1f2ef;
const GRANITE = 0x8d8f8c;
/** Taiwan Railway: red brick and pale stone, green-tiled roofs, TR blue on the signs */
const BRICK = 0xa9533c;
const STONE = 0xe8e0cc;
const TILE = 0x4f6b5e;
const TR_BLUE = 0x1c4f9c;
const METAL_ROOF = 0x5d7d96;

/** Boxes and panels turned to follow the track (or a street), in local coordinates (u along, v across). */
class Frame {
  constructor(
    private b: Builder,
    private x: number,
    private z: number,
    private dx: number,
    private dz: number,
  ) {}

  /** A point at (u, v) and height y. */
  private at(u: number, v: number, y: number): number[] {
    return [this.x + this.dx * u - this.dz * v, this.z + this.dz * u + this.dx * v, y];
  }

  /** Box centred at (u, v), `len` along and `wid` across, from height y0 to y1. */
  box(u: number, v: number, len: number, wid: number, y0: number, y1: number, color: number): void {
    this.b.color = new THREE.Color(color);
    const l = len / 2;
    const w = wid / 2;
    const c = [
      [u - l, v - w],
      [u + l, v - w],
      [u + l, v + w],
      [u - l, v + w],
    ];
    for (let k = 0; k < 4; k++) {
      const [pu, pv] = c[k];
      const [qu, qv] = c[(k + 1) % 4];
      this.b.quad(this.at(pu, pv, y1), this.at(pu, pv, y0), this.at(qu, qv, y1), this.at(qu, qv, y0));
    }
    const [k0, k1, k2, k3] = c.map(([cu, cv]) => [cu, cv]);
    this.b.quad(this.at(k0[0], k0[1], y1), this.at(k1[0], k1[1], y1), this.at(k3[0], k3[1], y1), this.at(k2[0], k2[1], y1));
    this.b.quad(this.at(k0[0], k0[1], y0), this.at(k3[0], k3[1], y0), this.at(k1[0], k1[1], y0), this.at(k2[0], k2[1], y0));
  }

  /** A flat panel `len` long along u, its cross-section running from (v0, y0) to (v1, y1). */
  panel(u: number, len: number, v0: number, y0: number, v1: number, y1: number, color: number): void {
    this.b.color = new THREE.Color(color);
    const l = len / 2;
    this.b.quad(this.at(u - l, v0, y0), this.at(u + l, v0, y0), this.at(u - l, v1, y1), this.at(u + l, v1, y1));
  }

  /** An upright triangle across the frame at u: base from v0 to v1 at y0, apex at (v, y1). */
  triangle(u: number, v0: number, v1: number, y0: number, v: number, y1: number, color: number): void {
    this.b.color = new THREE.Color(color);
    this.b.quad(this.at(u, v0, y0), this.at(u, v1, y0), this.at(u, v, y1), this.at(u, v, y1));
  }

  /** Pitched roof with its ridge along u, eaves `wid` apart at y0, ridge at y1, closed at both ends. */
  gable(u: number, v: number, len: number, wid: number, y0: number, y1: number, color: number, ends = color): void {
    this.panel(u, len, v - wid / 2, y0, v, y1, color);
    this.panel(u, len, v + wid / 2, y0, v, y1, color);
    for (const e of [-1, 1]) this.triangle(u + (e * len) / 2, v - wid / 2, v + wid / 2, y0, v, y1, ends);
  }

  /** Curved roof along u: an arch `wid` across rising `rise` above y0, in `n` flat panels. */
  vault(u: number, v: number, len: number, wid: number, y0: number, rise: number, color: number, n = 8): void {
    const pt = (k: number) => {
      const a = Math.PI * (k / n);
      return [v - (Math.cos(a) * wid) / 2, y0 + Math.sin(a) * rise];
    };
    for (let k = 0; k < n; k++) {
      const [v0, y0k] = pt(k);
      const [v1, y1k] = pt(k + 1);
      this.panel(u, len, v0, y0k, v1, y1k, color);
    }
  }
}

/**
 * Station buildings for one kind of train. Metro stations underground are a hall at track level with two
 * entrances beside the streets above, in the style of Kaohsiung's MRT; train stations are Taiwan Railway stations
 * of brick and stone with a clock tower and a footbridge over the tracks; high-speed stations have a long roof and
 * a glass concourse.
 */
export class StationLayer {
  readonly mesh: THREE.Mesh;

  constructor(shadows: boolean) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = true;
  }

  /** `streets` is the road network above, which underground metro entrances must stand beside, not on. */
  rebuild(sys: RailSystem, streets: RoadNetwork): void {
    const b = new Builder(0);
    const colorOf = new Map<number, number>();
    for (const l of sys.transit.lines.values()) for (const id of l.stops) if (!colorOf.has(id)) colorOf.set(id, l.color);
    for (const stop of sys.transit.stops.values()) {
      const seg = stop.at && sys.net.segments.get(stop.at.seg);
      if (!seg || !stop.at) continue;
      const q = sys.net.quad(seg);
      const t = tAtLength(seg.samples, stop.at.s);
      const p = quadPoint(q, t);
      const d = quadTangent(q, t);
      const h = sys.net.heightAt(seg, t);
      const f = new Frame(b, p.x, p.y, d.x, d.y);
      const color = colorOf.get(stop.id) ?? 0x9aa5b1;
      if (sys.kind === 'metro') {
        metroStation(f, h, color);
        if (h < 0) {
          const taken: { x: number; y: number }[] = [];
          for (const end of [-1, 1]) {
            const want = { x: p.x + d.x * end * 15 - d.y * end * 11, y: p.y + d.y * end * 15 + d.x * end * 11 };
            const spot = entranceSpot(streets, want, taken) ?? { x: want.x, y: want.y, dx: d.x, dy: d.y };
            taken.push(spot);
            metroEntrance(new Frame(b, spot.x, spot.y, spot.dx, spot.dy), h, color);
          }
        }
      } else {
        // The station building stands on the side of the tracks facing the town: turn the frame round if the
        // streets are on the other side
        const side = townSide(streets, p, d, sys.kind === 'train' ? 22 : 30);
        const g = side > 0 ? f : new Frame(b, p.x, p.y, -d.x, -d.y);
        if (sys.kind === 'train') trainStation(g, h, color);
        else hsrStation(g, h, color);
      }
    }
    this.mesh.geometry.dispose();
    this.mesh.geometry = b.geometry();
  }
}

/**
 * Which side of a track at `p`, heading `d`, has streets nearer: +1 for the side the station frame's +v points to,
 * -1 for the other. `reach` is how far out the station building stands.
 */
export function townSide(net: RoadNetwork, p: { x: number; y: number }, d: { x: number; y: number }, reach: number): 1 | -1 {
  const near = (side: number) => {
    const q = { x: p.x - d.y * side * reach, y: p.y + d.x * side * reach };
    let best = Infinity;
    for (const seg of net.segments.values()) if (net.isStreet(seg)) best = Math.min(best, closestOnSamples(seg.samples, q).d);
    return best;
  };
  return near(-1) < near(1) ? -1 : 1;
}

/** How far around its default spot an entrance looks for a street to stand beside. */
const ENTRANCE_REACH = 70;

/**
 * A spot for a metro entrance near `want`, facing along the nearest street: on a wide sidewalk, or at the front of
 * an empty, unzoned lot, and never on a road. Null when no street is near.
 */
export function entranceSpot(
  net: RoadNetwork,
  want: { x: number; y: number },
  taken: { x: number; y: number }[] = [],
): { x: number; y: number; dx: number; dy: number } | null {
  // Only streets near enough to matter, to keep this quick in big cities
  const segs = [...net.segments.values()].filter((s) => net.isStreet(s) && closestOnSamples(s.samples, want).d < ENTRANCE_REACH + 30);
  const clear = (x: number, y: number) =>
    segs.every((s) => closestOnSamples(s.samples, { x, y }).d > asphaltWidth(s) / 2 + 1.8) &&
    taken.every((o) => Math.hypot(o.x - x, o.y - y) > 12);
  let best: { x: number; y: number; dx: number; dy: number } | null = null;
  let bestCost = Infinity;
  for (const seg of segs) {
    if (closestOnSamples(seg.samples, want).d > ENTRANCE_REACH) continue;
    const q = net.quad(seg);
    for (const lot of seg.lots) {
      if (lot.depth !== 1) continue;
      const n = { x: -lot.dir.y * lot.side, y: lot.dir.x * lot.side };
      // On the sidewalk where it is wide enough, else just inside an empty lot
      // Blocked lots have a facility or track on them
      const free = lot.zone === Zone.None && lot.level === 0 && !lot.blocked;
      const inLot = { x: lot.x - n.x * 1.8, y: lot.y - n.y * 1.8 };
      const options: { x: number; y: number; cost: number }[] = [];
      if (seg.walk) {
        const tq = closestOnSamples(seg.samples, lot).t;
        const c = quadPoint(q, tq);
        const off = asphaltWidth(seg) / 2 + 2;
        options.push({ x: c.x + n.x * off, y: c.y + n.y * off, cost: 0 });
      }
      if (free) options.push({ ...inLot, cost: 4 });
      for (const o of options) {
        const cost = Math.hypot(o.x - want.x, o.y - want.y) + o.cost;
        if (cost >= bestCost || !clear(o.x, o.y)) continue;
        bestCost = cost;
        best = { x: o.x, y: o.y, dx: lot.dir.x, dy: lot.dir.y };
      }
    }
  }
  // Nothing free nearby: the front of the nearest lot, still off the roads
  if (!best) {
    for (const seg of segs) {
      if (closestOnSamples(seg.samples, want).d > ENTRANCE_REACH) continue;
      for (const lot of seg.lots) {
        if (lot.depth !== 1 || lot.blocked) continue;
        const n = { x: -lot.dir.y * lot.side, y: lot.dir.x * lot.side };
        // From the lot's middle back to just off the asphalt, over the sidewalk
        const back = roadWidth(seg) / 2 + 4 - (asphaltWidth(seg) / 2 + 2.2);
        const x = lot.x - n.x * back;
        const y = lot.y - n.y * back;
        const cost = Math.hypot(x - want.x, y - want.y);
        if (cost >= bestCost || !clear(x, y)) continue;
        bestCost = cost;
        best = { x, y, dx: lot.dir.x, dy: lot.dir.y };
      }
    }
  }
  return best;
}

/** Side platforms on both sides of the double track. */
function platforms(f: Frame, h: number, len: number): void {
  for (const side of [-1, 1]) f.box(0, side * 5.6, len, 3, h - 0.2, h + 1.1, PLATFORM);
}

function metroStation(f: Frame, h: number, color: number): void {
  platforms(f, h, 44);
  if (h < 0) {
    // Hall around the platforms, open on top so the trains show in the see-through view
    for (const side of [-1, 1]) {
      f.box(0, side * 7.6, 48, 0.6, h - 0.4, h + 5.6, CONCRETE);
      f.box(0, side * 7.25, 48, 0.1, h + 3.2, h + 3.9, color);
    }
    for (const end of [-1, 1]) f.box(end * 24, 0, 0.6, 15.8, h - 0.4, h + 5.6, CONCRETE);
    return;
  }
  // Above ground: Kaohsiung's elevated stations, a white curved roof on slim columns with glass along the sides
  for (const u of [-16, 0, 16]) for (const side of [-1, 1]) f.box(u, side * 7.6, 0.5, 0.5, h + 1.1, h + 5.4, STEEL_WHITE);
  f.vault(0, 0, 44, 17, h + 5.4, 3.2, STEEL_WHITE);
  for (const side of [-1, 1]) {
    f.box(0, side * 8.5, 44.4, 0.5, h + 5.0, h + 5.6, color);
    f.box(0, side * 7.4, 40, 0.1, h + 2.6, h + 5.0, KMRT_GLASS);
  }
  // Elevated stations get a stair and lift tower down to the street, with the orange sign on top
  if (h > 2) {
    f.box(0, 10.5, 7, 4.2, 0, h + 5.4, KMRT_GLASS);
    f.box(0, 10.5, 7.4, 4.6, h + 5.4, h + 5.9, STEEL_WHITE);
    f.box(3.9, 12.9, 1.1, 1.1, 0, 4.2, STEEL_WHITE);
    f.box(3.9, 12.9, 1.3, 1.3, 4.2, 5.4, KMRT_ORANGE);
  }
}

/**
 * A Kaohsiung MRT entrance beside a street: a glass roof that rises to a ridge like hands pressed together, on a
 * white steel frame, open at the front to the stairs, with the orange MRT sign on a white post. Frame u runs along
 * the street.
 */
function metroEntrance(f: Frame, h: number, color: number): void {
  const len = 5.6;
  const half = 1.8;
  const ridge = 4.2;
  f.box(0, 0, len + 0.6, half * 2 + 0.6, 0, 0.18, GRANITE);
  // Stairs going down, seen through the glass
  f.box(0.4, 0, len - 1.4, half * 2 - 0.8, 0.18, 0.22, 0x3a3f45);
  // Glass sides leaning in to the ridge, and the back closed
  for (const side of [-1, 1]) f.panel(0, len, side * half, 0.18, 0, ridge, KMRT_GLASS);
  f.triangle(-len / 2, -half, half, 0.18, 0, ridge, KMRT_GLASS);
  // White steel ribs over the glass and along the ridge
  for (const u of [-len / 2, 0, len / 2]) {
    for (const side of [-1, 1]) f.panel(u, 0.22, side * (half + 0.05), 0.18, 0, ridge + 0.06, STEEL_WHITE);
  }
  f.box(0, 0, len + 0.3, 0.3, ridge - 0.1, ridge + 0.2, STEEL_WHITE);
  // A band in the line's colour over the opening
  f.box(len / 2 + 0.05, 0, 0.12, 1.6, ridge - 1.6, ridge - 1.1, color);
  // Sign post: white, the orange MRT sign on top, the line's colour beneath
  f.box(len / 2 + 1.2, half + 0.4, 0.3, 0.3, 0.18, 3.2, STEEL_WHITE);
  f.box(len / 2 + 1.2, half + 0.4, 0.5, 0.9, 3.2, 3.9, KMRT_ORANGE);
  f.box(len / 2 + 1.2, half + 0.4, 0.52, 0.92, 2.9, 3.2, color);
  // Stair shaft down to the hall, seen in the see-through view
  f.box(0, 0, len - 1.4, half * 2 - 0.8, h + 3.9, -0.2, CONCRETE);
}

function trainStation(f: Frame, h: number, color: number): void {
  platforms(f, h, 84);
  // Canopies over each platform: grey-blue pitched metal roofs on posts
  for (const side of [-1, 1]) {
    for (let u = -36; u <= 36; u += 12) f.box(u, side * 5.6, 0.3, 0.3, h + 1.1, h + 4.0, 0x6e757c);
    f.box(0, side * 5.6, 80, 3.6, h + 3.9, h + 4.1, color);
    f.gable(0, side * 5.6, 80, 4.4, h + 4.1, h + 4.9, METAL_ROOF);
  }
  const base = Math.max(0, Math.min(h, 0));
  // Station building on one side, at street level: red brick with stone bands, its front facing away from the track
  const v = 16;
  const front = v + 6;
  f.box(0, v, 34, 12, base, base + 8, BRICK);
  for (const y of [0, 3.6, 7.4]) f.box(0, v, 34.3, 12.3, base + y, base + y + 0.6, STONE);
  f.gable(0, v, 34.6, 12.6, base + 8, base + 11, TILE, STONE);
  // Windows along the front: tall arches suggested by dark panes framed in stone
  for (let u = -14; u <= 14; u += 4) {
    if (Math.abs(u) < 4) continue;
    f.box(u, front + 0.05, 1.6, 0.1, base + 1.0, base + 3.2, 0x2d3a46);
    f.box(u, front + 0.05, 1.6, 0.1, base + 4.6, base + 6.8, 0x2d3a46);
  }
  // Entrance under a long canopy, the station's name board above it in white with a TR-blue band
  f.box(0, front + 0.05, 7, 0.1, base, base + 3.4, GLASS);
  f.box(0, front + 1.4, 22, 2.8, base + 3.5, base + 3.9, STONE);
  f.box(0, front + 0.2, 10, 0.3, base + 4.4, base + 5.8, 0xf7f7f4);
  f.box(0, front + 0.36, 10, 0.05, base + 4.4, base + 4.7, TR_BLUE);
  // Clock tower over the entrance with a green pyramid roof
  f.box(0, front - 2.5, 6, 5, base + 8, base + 15, STONE);
  for (const cu of [-2.8, 2.8]) f.box(cu, front - 2.5, 0.6, 5.2, base + 8, base + 15, BRICK);
  f.box(0, front + 0.02, 2.4, 0.1, base + 11.6, base + 14, 0xf7f7f4);
  f.box(0, front + 0.08, 0.3, 0.06, base + 12.2, base + 13.4, 0x22262b);
  f.gable(0, front - 2.5, 6.6, 5.6, base + 15, base + 18, TILE);
  // Footbridge over the tracks from the station building, with stair towers down to each platform
  f.box(20, (v - 6 - 5.6) / 2, 4, v - 6 + 5.6 + 2, h + 6.8, h + 9.6, STONE);
  f.box(20, (v - 6 - 5.6) / 2, 4.1, v - 6 + 5.6 + 2.1, h + 8.0, h + 8.9, GLASS);
  for (const side of [-1, 1]) f.box(20, side * 5.6, 3.4, 2.6, h + 1.1, h + 6.8, STONE);
  if (h < 0) {
    for (const side of [-1, 1]) f.box(0, side * 7.6, 88, 0.6, h - 0.4, h + 5.6, CONCRETE);
  }
}

function hsrStation(f: Frame, h: number, color: number): void {
  platforms(f, h, 124);
  // Long roof over the tracks on slim columns
  for (let u = -54; u <= 54; u += 18) for (const side of [-1, 1]) f.box(u, side * 10, 0.6, 0.6, h + 1.1, h + 9, 0x8a9096);
  f.box(0, 0, 130, 22, h + 9, h + 9.6, 0xeef0f2);
  for (const side of [-1, 1]) f.box(0, side * 11, 130, 0.5, h + 8.4, h + 9.8, color);
  // Glass concourse beside the line
  const base = Math.max(0, Math.min(h, 0));
  f.box(0, 24, 60, 20, base, base + 12, GLASS);
  f.box(0, 24, 64, 23, base + 12, base + 13, 0xeef0f2);
  f.box(0, 24, 64.4, 23.4, base + 13, base + 13.4, color);
  if (h > 2) f.box(0, 13, 10, 6, base, h + 1, CONCRETE);
}

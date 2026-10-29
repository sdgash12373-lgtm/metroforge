import * as THREE from 'three';
import { closestOnSamples, quadPoint } from '../sim/geometry';
import type { RailSystem } from '../sim/rail';
import { KAOHSIUNG_STATION, stationPose, stationSide } from '../sim/stations';
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
const GRANITE_LIGHT = 0xc9c6bd;
const PAVING = 0xd8cdb8;

/** 0 below a, 1 above b, eased between. */
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Taiwan Railway: red brick and pale stone, green-tiled roofs, TR blue on the signs */
const BRICK = 0xa9533c;
const STONE = 0xe8e0cc;
const TILE = 0x4f6b5e;
const TR_BLUE = 0x1c4f9c;
const METAL_ROOF = 0x5d7d96;
/** Kaohsiung main station: the cream walls and dark tiles of the old 帝冠式 hall under a white roof with gardens on it */
const CREAM = 0xf0ead8;
const DARK_TILE = 0x3f4446;
const ROOF_GREEN = 0x6f9a52;
const SKYLIGHT = 0xbfe0ec;
const WINDOW = 0x2d3a46;
const PALM = 0x4e8a3c;
const TRUNK = 0x8a7458;

/** Boxes and panels turned to follow the track (or a street), in local coordinates (u along, v across). */
class Frame {
  constructor(
    private b: Builder,
    private x: number,
    private z: number,
    private dx: number,
    private dz: number,
    private mask: Builder | null = null,
  ) {}

  /** A slanted beam `w` thick from (u0, v0, y0) to (u1, v1, y1), as two crossed strips. */
  beam(u0: number, v0: number, y0: number, u1: number, v1: number, y1: number, w: number, color: number): void {
    this.b.color = new THREE.Color(color);
    const len = Math.hypot(u1 - u0, v1 - v0) || 1;
    const su = (-(v1 - v0) / len) * (w / 2);
    const sv = ((u1 - u0) / len) * (w / 2);
    this.b.quad(this.at(u0 - su, v0 - sv, y0), this.at(u0 + su, v0 + sv, y0), this.at(u1 - su, v1 - sv, y1), this.at(u1 + su, v1 + sv, y1));
    this.b.quad(this.at(u0, v0, y0 - w / 2), this.at(u0, v0, y0 + w / 2), this.at(u1, v1, y1 - w / 2), this.at(u1, v1, y1 + w / 2));
  }

  /** A square cell `size` across at (u, v), its corners at heights y(du, dv). */
  cell(u: number, v: number, size: number, y: (du: number, dv: number) => number, color: number): void {
    this.b.color = new THREE.Color(color);
    this.b.quad(this.at(u, v, y(0, 0)), this.at(u + size, v, y(size, 0)), this.at(u, v + size, y(0, size)), this.at(u + size, v + size, y(size, size)));
  }

  /** An upright strip from (u0, v0) to (u1, v1), from height lo(u, v) up to hi(u, v). */
  wall(u0: number, v0: number, u1: number, v1: number, lo: (u: number, v: number) => number, hi: (u: number, v: number) => number, color: number): void {
    this.b.color = new THREE.Color(color);
    this.b.quad(this.at(u0, v0, hi(u0, v0)), this.at(u0, v0, lo(u0, v0)), this.at(u1, v1, hi(u1, v1)), this.at(u1, v1, lo(u1, v1)));
  }

  /** An upright round prism of radius r, in n sides, from y0 to y1. */
  prism(u: number, v: number, r: number, y0: number, y1: number, color: number, n = 16): void {
    this.b.color = new THREE.Color(color);
    const pt = (k: number) => [u + r * Math.cos((2 * Math.PI * k) / n), v + r * Math.sin((2 * Math.PI * k) / n)];
    for (let k = 0; k < n; k++) {
      const [au, av] = pt(k);
      const [bu, bv] = pt(k + 1);
      this.b.quad(this.at(au, av, y1), this.at(au, av, y0), this.at(bu, bv, y1), this.at(bu, bv, y0));
      this.b.quad(this.at(u, v, y1), this.at(u, v, y1), this.at(au, av, y1), this.at(bu, bv, y1));
    }
  }

  /** Cut the ground away over u0..u1, v0..v1, so what is built below street level there shows from above. */
  opening(u0: number, u1: number, v0: number, v1: number): void {
    this.mask?.quad(this.at(u0, v0, 0), this.at(u1, v0, 0), this.at(u0, v1, 0), this.at(u1, v1, 0));
  }

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

  /**
   * A curved sheet over u0..u1 and v0..v1 in nu × nv cells, its height y(u, v). `color` picks each cell's colour,
   * or null to leave a hole.
   */
  sheet(u0: number, u1: number, v0: number, v1: number, nu: number, nv: number, y: (u: number, v: number) => number, color: (i: number, j: number) => number | null): void {
    const at = (i: number, j: number) => {
      const u = u0 + ((u1 - u0) * i) / nu;
      const v = v0 + ((v1 - v0) * j) / nv;
      return this.at(u, v, y(u, v));
    };
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const c = color(i, j);
        if (c === null) continue;
        this.b.color = new THREE.Color(c);
        this.b.quad(at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j + 1));
      }
    }
  }

  /** Hipped roof: eaves `len` × `wid` at y0 sloping up on all four sides to a ridge along u at y1. */
  hip(u: number, v: number, len: number, wid: number, y0: number, y1: number, color: number): void {
    this.b.color = new THREE.Color(color);
    const l = len / 2;
    const w = wid / 2;
    const r = Math.max(l - w, 0);
    const ridge = [this.at(u - r, v, y1), this.at(u + r, v, y1)];
    const eave = (su: number, sv: number) => this.at(u + su * l, v + sv * w, y0);
    for (const sv of [-1, 1]) this.b.quad(eave(-1, sv), eave(1, sv), ridge[0], ridge[1]);
    for (const su of [-1, 1]) {
      const top = ridge[su < 0 ? 0 : 1];
      this.b.quad(eave(su, -1), eave(su, 1), top, top);
    }
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
  readonly mesh = new THREE.Group();
  private body: THREE.Mesh;
  /**
   * Openings in the ground over sunken plazas: drawn after the stations and before the ground, writing depth only,
   * so the ground is hidden there and the plaza below shows.
   */
  private mask: THREE.Mesh;

  constructor(shadows: boolean) {
    this.body = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
    this.body.castShadow = shadows;
    this.body.receiveShadow = true;
    this.body.renderOrder = -2;
    this.mask = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    );
    this.mask.renderOrder = -1;
    this.mesh.add(this.body, this.mask);
  }

  /** `streets` is the road network above, which underground metro entrances must stand beside, not on. */
  rebuild(sys: RailSystem, streets: RoadNetwork): void {
    const b = new Builder(0);
    const m = new Builder(0);
    const colorOf = new Map<number, number>();
    for (const l of sys.transit.lines.values()) for (const id of l.stops) if (!colorOf.has(id)) colorOf.set(id, l.color);
    for (const stop of sys.transit.stops.values()) {
      const pose = stationPose(sys, stop);
      if (!pose) continue;
      const { p, d, h } = pose;
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
        // The station building stands on the side of the tracks facing the town, off the roads: turn the frame
        // round if that is the other side
        const side = stop.face ?? stationSide(streets, sys.kind, pose);
        const g = side > 0 ? new Frame(b, p.x, p.y, d.x, d.y, m) : new Frame(b, p.x, p.y, -d.x, -d.y, m);
        if (sys.kind === 'train') {
          // A region's own station where the player built one; every other station in the standard style
          if (stop.style === 'kaohsiung') kaohsiungStation(g, h, color);
          else if (stop.style === 'pingtung') pingtungStation(g, h, color);
          else trainStation(g, h, color);
        } else hsrStation(g, h, color);
      }
    }
    this.body.geometry.dispose();
    this.body.geometry = b.geometry();
    this.mask.geometry.dispose();
    this.mask.geometry = m.geometry();
  }
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
  footbridge(f, h, STONE);
  trench(f, h);
}

/** Footbridge over the tracks from the station building, with stair towers down to each platform. */
function footbridge(f: Frame, h: number, color: number): void {
  f.box(20, 2.2, 4, 17.6, h + 6.8, h + 9.6, color);
  f.box(20, 2.2, 4.1, 17.7, h + 8.0, h + 8.9, GLASS);
  for (const side of [-1, 1]) f.box(20, side * 5.6, 3.4, 2.6, h + 1.1, h + 6.8, color);
}

/** Walls down the sides of tracks below ground. */
function trench(f: Frame, h: number): void {
  if (h < 0) for (const side of [-1, 1]) f.box(0, side * 7.6, 88, 0.6, h - 0.4, h + 5.6, CONCRETE);
}

/**
 * Kaohsiung station. The real one is underground: with the tracks below the street it gets the whole of it, the
 * great roof over a sunken plaza that leads down to the trains; on track at street level, a smaller version.
 */
function kaohsiungStation(f: Frame, h: number, color: number): void {
  if (h < 0) kaohsiungUnderground(f, h, color);
  else kaohsiungAtGrade(f, h, color);
}

/**
 * Kaohsiung station on track at street level, in the style of the real one: a great white roof that rolls in waves over the tracks and the
 * hall, with gardens and round skylights on it, held up on slim white columns; in front of it the old 帝冠式
 * station of 1941, cream walls under dark-tiled hipped roofs, its tall middle block crowned with a roof of its own.
 */
function kaohsiungAtGrade(f: Frame, h: number, color: number): void {
  platforms(f, h, 84);
  const base = Math.max(0, Math.min(h, 0));
  const top = Math.max(h, 0) + 10;
  const wave = (u: number, v: number) => top + 1.6 * Math.sin(u / 9) + 0.8 * Math.sin(v / 5);
  // Columns on the platforms and through the hall, and a slim band in the line's colour under the roof's edge
  for (let u = -32; u <= 32; u += 16) for (const side of [-1, 1]) f.box(u, side * 6.6, 0.45, 0.45, h + 1.1, wave(u, side * 6.6), STEEL_WHITE);
  for (const u of [-12, 0, 12]) f.box(u, 13.5, 0.5, 0.5, base, wave(u, 13.5), STEEL_WHITE);
  f.sheet(-40, 40, -7.8, -7.4, 40, 1, (u, v) => wave(u, v) - 0.5, () => color);
  // The roof: white, with gardens in long drifts and round skylights, over the tracks and the hall
  const skylights = [[-26, 2], [-9, -3], [8, 4], [25, -2], [-4, 13], [11, 13]];
  const cell = (u: number, v: number) => {
    if (skylights.some(([su, sv]) => Math.hypot(u - su, v - sv) < 2.4)) return SKYLIGHT;
    return Math.sin(u / 6.5 + 1) * Math.cos(v / 3.4 - 0.6) + 0.35 * Math.sin(u / 2.3 + v) > 0.62 ? ROOF_GREEN : STEEL_WHITE;
  };
  f.sheet(-40, 40, -7.8, 9.7, 80, 14, wave, (i, j) => cell(-39.5 + i, -7.8 + (j + 0.5) * 1.25));
  f.sheet(-17.3, 17.3, 9.7, 17.4, 34, 6, wave, (i, j) => cell(-16.8 + i * 1.018, 9.7 + (j + 0.5) * 1.28));
  // Glass hall under the roof behind the old station
  f.box(0, 13.6, 33, 7, base, base + 6.5, GLASS);
  f.box(0, 13.6, 33.4, 7.4, base + 6.5, base + 7, STEEL_WHITE);
  oldKaohsiungStation(f, base);
  footbridge(f, h, STEEL_WHITE);
  trench(f, h);
}

/** The old 帝冠式 Kaohsiung station of 1941: a long cream hall with wings, a taller block in the middle under a two-tier roof. */
function oldKaohsiungStation(f: Frame, base: number): void {
  const v = 21.1;
  const front = v + 3.5;
  for (const side of [-1, 1]) {
    f.box(side * 11, v, 10, 6.4, base, base + 5.6, CREAM);
    f.box(side * 11, v, 10.3, 6.7, base + 5.6, base + 6, STONE);
    f.hip(side * 11, v, 10.8, 7.2, base + 6, base + 8, DARK_TILE);
    for (const wu of [-3, 0, 3]) f.box(side * 11 + wu, front + 0.05, 1.2, 0.1, base + 1.4, base + 4.4, WINDOW);
  }
  f.box(0, v, 12, 7, base, base + 8, CREAM);
  f.box(0, v, 12.4, 7.4, base + 8, base + 8.4, STONE);
  f.hip(0, v, 13.4, 8.2, base + 8.4, base + 10.4, DARK_TILE);
  // Tower: a smaller block rising out of the middle roof, crowned with its own hipped roof
  f.box(0, v, 5.2, 4.4, base + 10, base + 12.8, CREAM);
  f.hip(0, v, 6.6, 5.6, base + 12.8, base + 15.2, DARK_TILE);
  f.box(0, v + 2.25, 2.2, 0.1, base + 10.8, base + 12.2, WINDOW);
  // Tall windows of the middle block, and the entrance with the name board above it
  for (const wu of [-4.5, 4.5]) f.box(wu, front + 0.05, 1.4, 0.1, base + 1.2, base + 6.6, WINDOW);
  f.box(0, front + 0.05, 5, 0.1, base, base + 3.6, GLASS);
  f.box(0, front + 0.6, 7, 1.2, base + 3.7, base + 4.0, STONE);
  f.box(0, front + 0.1, 6, 0.2, base + 4.8, base + 6, 0xf7f7f4);
  f.box(0, front + 0.22, 6, 0.05, base + 4.8, base + 5.1, TR_BLUE);
}

/**
 * Kaohsiung station on track underground, after Mecanoo's design for the real one. Over the tracks lies a park
 * roof: lawns in flowing lobes edged in white bands, cut through by round skylights, sloping down towards the front.
 * In the middle of the front a sunken plaza opens in a long oval and steps down from the street, with the old
 * 帝冠式 station standing on its floor among palms and a glass wall at the back into the concourse. Two rounded
 * towers banded floor by floor rise through the roof either side, two round towers behind, and the park runs on
 * along the line in green ribbons.
 */
function kaohsiungUnderground(f: Frame, h: number, color: number): void {
  platforms(f, h, 84);
  trench(f, h);
  const [u0, u1, v0, v1] = KAOHSIUNG_STATION;
  const floor = -5;
  const ellipse = (u: number, v: number, cu: number, cv: number, ru: number, rv: number) => ((u - cu) / ru) ** 2 + ((v - cv) / rv) ** 2;
  // The sunken plaza, and the towers that stand up through the roof
  const inPit = (u: number, v: number) => ellipse(u, v, 0, 23, 20, 14) < 1;
  const towers = [-30, 30].map((tu) => ({ u: tu, v: 2, r: 9, half: 7 }));
  const rounds = [-13, 13].map((ru) => ({ u: ru, v: -19, r: 7.5 }));
  const inTower = (u: number, v: number, pad: number) =>
    towers.some((t) => Math.abs(u - t.u) < t.r + pad && Math.abs(v - t.v) < t.half + (t.r + pad) * Math.sqrt(Math.max(0, 1 - ((u - t.u) / (t.r + pad)) ** 2))) ||
    rounds.some((t) => Math.hypot(u - t.u, v - t.v) < t.r + pad);
  const skylights = [
    [-30, 20, 3.5], [31, 23, 4.2], [-44, 27, 2.4], [45, 17, 2.6], [-9, 2, 5], [9, 5, 3.4], [0, -6, 2.4],
    [-48, 6, 2.2], [48, 8, 2.2], [-28, -19, 2.6], [28, -20, 3], [0, -16, 3.2],
  ];
  const inHole = (u: number, v: number) => skylights.some(([su, sv, r]) => Math.hypot(u - su, v - sv) < r);
  const inRoof = (u: number, v: number) => {
    if (u < u0 || u > u1 || v < v0 || v > v1) return false;
    if (ellipse(u, v, 0, 23, 21.5, 15.5) < 1 || inHole(u, v) || inTower(u, v, 0.8)) return false;
    return (
      ellipse(u, v, -35, 21, 23, 14) < 1 ||
      ellipse(u, v, 35, 21, 23, 14) < 1 ||
      ellipse(u, v, 0, 0, 34, 13) < 1 ||
      ellipse(u, v, 0, -16, 28, 10) < 1 ||
      (Math.abs(v) < 5.5 && Math.abs(u) < 60)
    );
  };
  // The roof's height: rolling gently, sloping down to the front and to the ends of the green ribbons
  const roofY = (u: number, v: number) =>
    7.5 + 0.9 * Math.sin(u / 9) + 0.6 * Math.sin(v / 6 + 1) - 4 * smooth(26, 36, v) - 4.5 * smooth(44, 60, Math.abs(u)) * smooth(-6, 0, -Math.abs(v) + 6);
  const step = 0.8;
  const grass = [ROOF_GREEN, 0x7aa65a, 0x678f4b];
  for (let u = u0; u < u1; u += step) {
    for (let v = v0; v < v1; v += step) {
      const cu = u + step / 2;
      const cv = v + step / 2;
      if (inPit(cu, cv)) {
        // Plaza floor, stepping up to the street at the front in broad stairs; white walls round it, glass at the back
        f.opening(u, u + step, v, v + step);
        const y = cv > 30 ? Math.min(0, floor + Math.floor(((cv - 30) / 7) * 10) * (-floor / 10)) : floor;
        f.box(cu, cv, step, step, floor - 0.3, y, cv > 30 ? GRANITE_LIGHT : PAVING);
        const edge = [[step, 0], [-step, 0], [0, step], [0, -step]].some(([du, dv]) => !inPit(cu + du, cv + dv));
        if (edge && cv < 31) f.box(cu, cv, step, step, y, 0.6, cv < 16 ? GLASS : STEEL_WHITE);
        continue;
      }
      if (!inRoof(cu, cv)) {
        // Paving under the open sky between the lobes, warm light pooling under the skylights
        if (!inTower(cu, cv, 0)) f.box(cu, cv, step, step, -0.02, 0.03, inHole(cu, cv) ? 0xf0d9a0 : PAVING);
        continue;
      }
      f.box(cu, cv, step, step, -0.02, 0.03, PAVING);
      const y = (du: number, dv: number) => roofY(u + du, v + dv);
      const out = [[step, 0], [-step, 0], [0, step], [0, -step]].filter(([du, dv]) => !inRoof(cu + du, cv + dv));
      // Lawn on top, the white band along every edge, a pale soffit below
      const patch = Math.abs(Math.floor(cu / 4) * 7 + Math.floor(cv / 4) * 13 + Math.floor((cu + cv) / 9) * 5) % 3;
      f.cell(u, v, step, y, out.length ? STEEL_WHITE : grass[patch]);
      f.cell(u, v, step, (du, dv) => y(du, dv) - 1.1, 0xe7e3da);
      for (const [du, dv] of out) {
        const a = du > 0 ? [step, 0, step, step] : du < 0 ? [0, 0, 0, step] : dv > 0 ? [0, step, step, step] : [0, 0, step, 0];
        f.wall(u + a[0], v + a[1], u + a[2], v + a[3], (pu, pv) => roofY(pu, pv) - 1.1, (pu, pv) => roofY(pu, pv) + 0.15, STEEL_WHITE);
      }
    }
  }
  // Slim white columns under the roof
  for (let u = -54; u <= 54; u += 12) {
    for (let v = -24; v <= 34; v += 10) {
      if (inRoof(u, v) && inRoof(u + 2, v) && inRoof(u - 2, v) && inRoof(u, v + 2) && inRoof(u, v - 2)) f.box(u, v, 0.5, 0.5, 0, roofY(u, v) - 1.1, STEEL_WHITE);
    }
  }
  // The rounded towers, banded floor by floor in white slabs over glass, and the round towers behind
  const bands = (draw: (pad: number, y0: number, y1: number, c: number) => void, floors: number) => {
    for (let k = 0; k < floors; k++) {
      draw(0.5, k * 3.6, k * 3.6 + 1.1, 0xeee9df);
      draw(0, k * 3.6 + 1.1, (k + 1) * 3.6, k === 0 ? GLASS : 0x8fb0c0);
    }
    draw(0.5, floors * 3.6, floors * 3.6 + 0.9, 0xeee9df);
  };
  for (const t of towers) {
    bands((pad, y0, y1, c) => {
      f.box(t.u, t.v, (t.r + pad) * 2, t.half * 2, y0, y1, c);
      for (const e of [-1, 1]) f.prism(t.u, t.v + e * t.half, t.r + pad, y0, y1, c);
    }, 10);
  }
  for (const t of rounds) bands((pad, y0, y1, c) => f.prism(t.u, t.v, t.r + pad, y0, y1, c, 20), 9);
  // Palms on the plaza floor, and the old station standing on it
  for (const [pu, pv] of [[-15, 27], [15, 27], [-11, 31], [11, 31], [-17, 21], [17, 21], [-6, 29], [6, 29]]) palm(f, pu, pv, pv > 30 ? floor + ((Math.floor(((pv - 30) / 7) * 10) * -floor) / 10) : floor);
  oldKaohsiungStation(f, floor);
  // The line's colour on a band round the plaza's rim
  f.box(0, 9.3, 30, 0.3, 0.2, 0.7, color);
}

/** A palm: a slim trunk and a crown of fronds. */
function palm(f: Frame, u: number, v: number, y: number): void {
  f.box(u, v, 0.35, 0.35, y, y + 6, TRUNK);
  f.box(u, v, 3.2, 0.7, y + 5.8, y + 6.3, PALM);
  f.box(u, v, 0.7, 3.2, y + 5.8, y + 6.3, PALM);
  f.box(u, v, 1.4, 1.4, y + 6.1, y + 6.8, PALM);
}

/**
 * Pingtung station on raised track, like the real one: the platforms on the upper floor under a long white roof
 * arched over the tracks, a glass hall on the ground floor beneath them, and a front of glass and white fins two
 * storeys high facing a plaza with palms and a canopy over the way in.
 */
function pingtungElevated(f: Frame, h: number, color: number): void {
  platforms(f, h, 84);
  // Upper floor: the arched roof over the platforms on slim columns
  for (let u = -36; u <= 36; u += 12) for (const side of [-1, 1]) f.box(u, side * 7.3, 0.45, 0.45, h + 1.1, h + 6.4, STEEL_WHITE);
  f.vault(0, 0, 84, 16, h + 6.4, 4, STEEL_WHITE, 12);
  for (const e of [-1, 1]) f.box(e * 42, 0, 0.3, 16, h + 6, h + 6.6, color);
  f.box(0, -7.4, 80, 0.1, h + 1.1, h + 6.2, GLASS);
  // Ground floor: the hall under the platforms, glass between white piers
  f.box(0, 0, 66, 14, 0, 0.2, GRANITE_LIGHT);
  f.box(0, 0, 64, 12, 0.2, h - 1.4, GLASS);
  for (let u = -30; u <= 30; u += 6) for (const side of [-1, 1]) f.box(u, side * 6.2, 0.8, 0.8, 0, h - 1.2, STEEL_WHITE);
  f.box(0, 0, 66, 14, h - 1.4, h - 0.6, STEEL_WHITE);
  // The front: glass two storeys high behind white fins, from the plaza up to the roof's edge
  const front = 8.4;
  f.box(0, front, 40, 0.15, 0.2, h + 7, GLASS);
  for (let u = -19.5; u <= 19.5; u += 1.5) f.box(u, front + 0.4, 0.22, 0.7, 0, h + 7.4, STEEL_WHITE);
  f.box(0, front + 0.2, 41, 1.2, h + 7.2, h + 8, STEEL_WHITE);
  f.box(0, front + 0.85, 12, 0.15, h + 3, h + 4.6, TR_BLUE);
  f.box(0, front + 0.95, 10.5, 0.05, h + 3.4, h + 4.2, 0xf7f7f4);
  // Plaza in front: paving, a canopy over the way in, palms in rows and a band of lawn
  f.box(0, 17.2, 34.6, 15, 0, 0.06, GRANITE_LIGHT);
  f.box(0, 12.4, 16, 4.6, 3.8, 4.1, STEEL_WHITE);
  for (const cu of [-7.6, 7.6]) f.box(cu, 14.4, 0.3, 0.3, 0, 3.8, STEEL_WHITE);
  for (const lu of [-12, 12]) f.box(lu, 20, 9, 6, 0.06, 0.2, ROOF_GREEN);
  for (const pu of [-15, -11, -7, 7, 11, 15]) {
    for (const pv of [17.5, 22.5]) {
      if (Math.abs(pu) < 8 && pv > 20) continue;
      palm(f, pu, pv, 0);
    }
  }
  // Stair and lift up to the platforms at one end
  f.box(20, 10.5, 4, 3, 0, h + 1.1, STEEL_WHITE);
}

/**
 * Pingtung station. The real one is elevated, a plaza and hall on the ground floor and the platforms above: on
 * raised track it gets all of that; on track at street level or below, a smaller version.
 */
function pingtungStation(f: Frame, h: number, color: number): void {
  if (h > 2) pingtungElevated(f, h, color);
  else pingtungAtGrade(f, h, color);
}

/**
 * Pingtung station on track at street level, in the style of the real one: a long white roof arched over the tracks on slim columns, and
 * beside it a white hall with a glass front behind thin white fins, under a roof that swells up in the middle, a
 * canopy over the entrance and palm trees in front.
 */
function pingtungAtGrade(f: Frame, h: number, color: number): void {
  platforms(f, h, 84);
  const base = Math.max(0, Math.min(h, 0));
  // The arched roof over the tracks, glass along its sides and a band in the line's colour
  for (let u = -36; u <= 36; u += 12) for (const side of [-1, 1]) f.box(u, side * 7.3, 0.45, 0.45, h + 1.1, h + 5.8, STEEL_WHITE);
  f.vault(0, 0, 80, 15.4, h + 5.8, 3.4, STEEL_WHITE, 10);
  for (const side of [-1, 1]) {
    f.box(0, side * 7.4, 76, 0.1, h + 3.6, h + 5.6, GLASS);
    f.box(0, side * 7.6, 80.4, 0.4, h + 5.4, h + 5.9, color);
  }
  // The hall: white walls, a glass front behind fins, and the roof rising to a crown over the middle
  f.box(0, 16.5, 32, 11, base, base + 9, STEEL_WHITE);
  const front = 22;
  f.box(0, front + 0.05, 28, 0.1, base + 0.2, base + 8.4, GLASS);
  for (let u = -14; u <= 14; u += 2) f.box(u, front + 0.35, 0.25, 0.6, base, base + 9, STEEL_WHITE);
  const crown = (u: number, v: number) => base + 9.4 + 3.6 * Math.cos((u / 17.3) * (Math.PI / 2)) * (0.75 + 0.25 * Math.sin(((v - 9.7) / 15.1) * Math.PI));
  f.sheet(-17.3, 17.3, 9.7, 24.8, 20, 6, crown, () => STEEL_WHITE);
  f.sheet(-17.3, 17.3, 24.6, 24.8, 20, 1, (u, v) => crown(u, v) - 0.6, () => color);
  // Canopy over the entrance with the station's name in white on TR blue
  f.box(0, front + 1.4, 14, 2.8, base + 3.6, base + 3.9, STEEL_WHITE);
  for (const cu of [-6.6, 6.6]) f.box(cu, front + 2.6, 0.3, 0.3, base, base + 3.6, STEEL_WHITE);
  f.box(0, front + 0.6, 9, 0.15, base + 6.2, base + 7.4, TR_BLUE);
  f.box(0, front + 0.7, 8, 0.05, base + 6.5, base + 7.1, 0xf7f7f4);
  // Palm trees in front
  for (const pu of [-14, -10, 10, 14]) {
    f.box(pu, 24, 0.35, 0.35, base, base + 6, TRUNK);
    f.box(pu, 24, 3.2, 0.7, base + 5.8, base + 6.3, PALM);
    f.box(pu, 24, 0.7, 3.2, base + 5.8, base + 6.3, PALM);
    f.box(pu, 24, 1.4, 1.4, base + 6.1, base + 6.8, PALM);
  }
  footbridge(f, h, STEEL_WHITE);
  trench(f, h);
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

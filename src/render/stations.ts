import * as THREE from 'three';
import { closestOnSamples, quadPoint } from '../sim/geometry';
import type { RailSystem } from '../sim/rail';
import { stationPose, stationSide } from '../sim/stations';
import type { RegionName } from '../sim/terrain';
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
  /** `region` says which region a point is in, for the train stations each region builds in its own style. */
  rebuild(sys: RailSystem, streets: RoadNetwork, region: (x: number, y: number) => RegionName | null = () => null): void {
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
        const side = stationSide(streets, sys.kind, pose);
        const g = side > 0 ? new Frame(b, p.x, p.y, d.x, d.y, m) : new Frame(b, p.x, p.y, -d.x, -d.y, m);
        if (sys.kind === 'train') {
          const r = region(p.x, p.y);
          if (r === 'kaohsiung') kaohsiungStation(g, h, color);
          else if (r === 'pingtung') pingtungStation(g, h, color);
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
 * Kaohsiung station on track underground, like the real one since 2018. Over the tracks and the plaza beside them,
 * the 城市之心: a white roof rolling in waves, open in round skylights and planted in drifts, held up on white
 * columns that branch at the top like trees. Under it a sunken plaza steps down in terraces with trees, past
 * escalators in the middle, to a glass wall into the concourse beside the platforms. The old station stands in front.
 */
function kaohsiungUnderground(f: Frame, h: number, color: number): void {
  platforms(f, h, 84);
  trench(f, h);
  const floor = Math.max(h + 2.4, -5.6);
  const pit = { u: 30, v0: 8.2, v1: 16.4 };
  // Street-level plaza over the tracks
  f.box(0, 0.2, 84, 16, -0.05, 0.03, GRANITE_LIGHT);
  // The sunken plaza: floor, end walls, glass into the concourse on the track side
  f.opening(-pit.u, pit.u, pit.v0, pit.v1);
  f.box(0, (pit.v0 + pit.v1) / 2, pit.u * 2, pit.v1 - pit.v0, floor - 0.3, floor, GRANITE_LIGHT);
  for (const e of [-1, 1]) f.box(e * (pit.u + 0.3), (pit.v0 + pit.v1) / 2, 0.6, pit.v1 - pit.v0, floor, 0.1, GRANITE);
  f.box(0, pit.v0 - 0.3, pit.u * 2, 0.6, floor, 0.1, GRANITE);
  f.box(0, pit.v0 + 0.05, pit.u * 2 - 2, 0.1, floor, -0.4, GLASS);
  for (let u = -27; u <= 27; u += 3) f.box(u, pit.v0 + 0.15, 0.15, 0.2, floor, -0.4, STEEL_WHITE);
  // Terraces down from the street on the town side, planted with trees, either side of the escalators
  const steps = 6;
  const tread = 1.15;
  for (const e of [-1, 1]) {
    const u0 = e * 7;
    const u1 = e * pit.u;
    const um = (u0 + u1) / 2;
    const ul = Math.abs(u1 - u0);
    for (let k = 0; k < steps; k++) {
      const v = pit.v1 - tread * (k + 0.5);
      const top = -((k + 1) / steps) * -floor;
      f.box(um, v, ul, tread, floor, top, k % 2 ? GRANITE : GRANITE_LIGHT);
    }
    for (const tu of [10, 17, 24]) {
      const k = tu % 3;
      const v = pit.v1 - tread * (k + 1.5);
      const y = -((k + 2) / steps) * -floor;
      f.box(e * tu, v, 1.6, 1.6, y, y + 0.5, ROOF_GREEN);
      f.box(e * tu, v, 0.25, 0.25, y + 0.5, y + 2.6, TRUNK);
      f.box(e * tu, v, 2.2, 2.2, y + 2.4, y + 3.6, PALM);
      f.box(e * tu, v, 1.4, 1.4, y + 3.6, y + 4.3, PALM);
    }
  }
  // Escalators and a stair in the middle, running down from the street to the plaza floor
  const run = pit.v1 - pit.v0 - 2;
  for (const eu of [-4.5, -2.8, 2.8, 4.5]) {
    f.panel(eu, 1.2, pit.v1, 0.05, pit.v1 - run, floor + 0.05, 0x3a3f45);
    for (const s of [-0.7, 0.7]) f.panel(eu + s, 0.12, pit.v1, 1.0, pit.v1 - run, floor + 1.0, GLASS);
  }
  for (let k = 0; k < 8; k++) f.box(0, pit.v1 - (run * (k + 0.5)) / 8, 4, run / 8, floor, -((k + 1) / 8) * -floor, GRANITE_LIGHT);
  // The roof
  const top = 11;
  const wave = (u: number, v: number) => top + 1.8 * Math.sin(u / 10 + 0.4) + 0.9 * Math.sin(v / 5 + 1);
  const skylights = [[-31, -1, 3], [-15, 3, 2.6], [1, -3, 2.4], [17, 2, 3], [33, -2, 2.4], [-20, 12.5, 4.5], [0, 12, 3.2], [20, 12.5, 4.5]];
  const cell = (u: number, v: number) => {
    if (skylights.some(([su, sv, r]) => Math.hypot(u - su, v - sv) < r)) return null;
    if (skylights.some(([su, sv, r]) => Math.hypot(u - su, v - sv) < r + 0.8)) return STEEL_WHITE;
    return Math.sin(u / 6.5 + 1) * Math.cos(v / 3.4 - 0.6) + 0.35 * Math.sin(u / 2.3 + v) > 0.55 ? ROOF_GREEN : STEEL_WHITE;
  };
  const nu = 84;
  const nv = 24;
  f.sheet(-42, 42, -7.8, 17, nu, nv, wave, (i, j) => cell(-42 + i + 0.5, -7.8 + ((j + 0.5) * 24.8) / nv));
  // Underside in a warm grey so the roof reads as a shell from the street, and a band in the line's colour round it
  f.sheet(-42, 42, -7.8, 17, nu / 2, nv / 2, (u, v) => wave(u, v) - 0.6, (i, j) => (cell(-42 + 2 * i + 1, -7.8 + ((j + 0.5) * 24.8) / (nv / 2)) === null ? null : 0xdcdad3));
  f.sheet(-42, 42, 16.8, 17, nu, 1, (u, v) => wave(u, v) - 0.3, () => color);
  // Tree columns: a trunk splitting into four branches under the roof
  const tree = (u: number, v: number, y0: number) => {
    const fork = wave(u, v) - 4;
    f.box(u, v, 0.6, 0.6, y0, fork, STEEL_WHITE);
    for (const [bu, bv] of [[-2.6, -2], [2.6, -2], [-2.6, 2], [2.6, 2]]) f.beam(u, v, fork, u + bu, v + bv, wave(u + bu, v + bv) - 0.6, 0.35, STEEL_WHITE);
  };
  for (const u of [-34, -22, -8, 8, 22, 34]) tree(u, -1, 0);
  for (const u of [-24, -12, 12, 24]) tree(u, 12.4, floor);
  oldKaohsiungStation(f, 0);
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
      f.box(pu, pv, 0.35, 0.35, 0, 6.5, TRUNK);
      f.box(pu, pv, 3.2, 0.7, 6.3, 6.8, PALM);
      f.box(pu, pv, 0.7, 3.2, 6.3, 6.8, PALM);
      f.box(pu, pv, 1.4, 1.4, 6.6, 7.3, PALM);
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

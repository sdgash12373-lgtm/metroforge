import * as THREE from 'three';
import type { RailSystem } from '../sim/rail';
import { HUBS, KAOHSIUNG_STATION, PINGTUNG_STATION, stationPose, stationSide } from '../sim/stations';
import { isShared } from '../sim/transit';
import type { MetroExit } from '../sim/city';
import type { RoadNetwork } from '../sim/roads';
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
const STONE_DARK = 0x56595b;

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
/** Lamp heads, and the posts they stand on */
const LAMP = 0xfff2cc;
const LAMP_POST = 0x596068;

/**
 * Colours that light up at night: glass and windows, skylights, name boards, the MRT sign, lamps and the
 * fountain pool. Faces in them are drawn into a second mesh that glows after dark.
 */
const GLOWING = new Set([GLASS, KMRT_GLASS, SKYLIGHT, WINDOW, KMRT_ORANGE, LAMP, 0x8fb4c4, 0x8fb0c0, 0xa9c4cf, 0xf7f7f4, 0xf0d9a0, 0x5fb8b5]);

/** Soft discs of lamplight on the ground, bright in the middle and fading to nothing at the rim. */
class Pools {
  pos: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  disc(x: number, z: number, y: number, r: number, strength = 1): void {
    const sides = 14;
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.col.push(1 * strength, 0.8 * strength, 0.5 * strength);
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      this.pos.push(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
      this.col.push(0, 0, 0);
    }
    for (let k = 0; k < sides; k++) this.idx.push(i, i + 1 + ((k + 1) % sides), i + 1 + k);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

/** Where a station's pieces are drawn: the body, the faces that glow at night, the pools of lamplight, and the ground openings. */
interface Out {
  body: Builder;
  glow: Builder;
  pools: Pools;
  mask?: Builder;
}

/** Boxes and panels turned to follow the track (or a street), in local coordinates (u along, v across). */
class Frame {
  /** the builder the next faces go to: the body, or the glowing mesh for lit colours */
  private b: Builder;
  private mask: Builder | null;

  constructor(
    private out: Out,
    private x: number,
    private z: number,
    private dx: number,
    private dz: number,
  ) {
    this.b = out.body;
    this.mask = out.mask ?? null;
  }

  private paint(color: number): void {
    this.b = GLOWING.has(color) ? this.out.glow : this.out.body;
    this.b.color = new THREE.Color(color);
  }

  /** A pool of lamplight `r` across on the ground at (u, v), height y. */
  pool(u: number, v: number, y: number, r: number, strength = 1): void {
    const [x, z] = this.at(u, v, y);
    this.out.pools.disc(x, z, y + 0.08, r, strength);
  }

  /** A lamp post `tall` high at (u, v) standing on y, with its pool of light. */
  lamp(u: number, v: number, y: number, tall = 4.5, reach = tall * 1.5): void {
    this.box(u, v, 0.18, 0.18, y, y + tall, LAMP_POST);
    this.box(u, v, 0.5, 0.5, y + tall, y + tall + 0.35, LAMP);
    this.pool(u, v, y, reach);
  }

  /** A slanted beam `w` thick from (u0, v0, y0) to (u1, v1, y1), as two crossed strips. */
  beam(u0: number, v0: number, y0: number, u1: number, v1: number, y1: number, w: number, color: number): void {
    this.paint(color);
    const len = Math.hypot(u1 - u0, v1 - v0) || 1;
    const su = (-(v1 - v0) / len) * (w / 2);
    const sv = ((u1 - u0) / len) * (w / 2);
    this.b.quad(this.at(u0 - su, v0 - sv, y0), this.at(u0 + su, v0 + sv, y0), this.at(u1 - su, v1 - sv, y1), this.at(u1 + su, v1 + sv, y1));
    this.b.quad(this.at(u0, v0, y0 - w / 2), this.at(u0, v0, y0 + w / 2), this.at(u1, v1, y1 - w / 2), this.at(u1, v1, y1 + w / 2));
  }

  /** A square cell `size` across at (u, v), its corners at heights y(du, dv). */
  cell(u: number, v: number, size: number, y: (du: number, dv: number) => number, color: number): void {
    this.paint(color);
    this.b.quad(this.at(u, v, y(0, 0)), this.at(u + size, v, y(size, 0)), this.at(u, v + size, y(0, size)), this.at(u + size, v + size, y(size, size)));
  }

  /** An upright strip from (u0, v0) to (u1, v1), from height lo(u, v) up to hi(u, v). */
  wall(u0: number, v0: number, u1: number, v1: number, lo: (u: number, v: number) => number, hi: (u: number, v: number) => number, color: number): void {
    this.paint(color);
    this.b.quad(this.at(u0, v0, hi(u0, v0)), this.at(u0, v0, lo(u0, v0)), this.at(u1, v1, hi(u1, v1)), this.at(u1, v1, lo(u1, v1)));
  }

  /** An upright round prism of radius r, in n sides, from y0 to y1. */
  prism(u: number, v: number, r: number, y0: number, y1: number, color: number, n = 16): void {
    this.paint(color);
    const pt = (k: number) => [u + r * Math.cos((2 * Math.PI * k) / n), v + r * Math.sin((2 * Math.PI * k) / n)];
    for (let k = 0; k < n; k++) {
      const [au, av] = pt(k);
      const [bu, bv] = pt(k + 1);
      this.b.quad(this.at(au, av, y1), this.at(au, av, y0), this.at(bu, bv, y1), this.at(bu, bv, y0));
      this.b.quad(this.at(u, v, y1), this.at(u, v, y1), this.at(au, av, y1), this.at(bu, bv, y1));
    }
  }

  /** Any four-cornered face, corners as [u, v, y] in strip order (a, b along one edge, c, d along the other). */
  face(a: number[], b: number[], c: number[], d: number[], color: number): void {
    this.paint(color);
    this.b.quad(this.at(a[0], a[1], a[2]), this.at(b[0], b[1], b[2]), this.at(c[0], c[1], c[2]), this.at(d[0], d[1], d[2]));
  }

  /**
   * A leaning post `len` along u and `t` thick across, its foot centred at (u, v0, y0) and its head at (u, v1, y1),
   * so it slants across the frame.
   */
  lean(u: number, len: number, t: number, v0: number, y0: number, v1: number, y1: number, color: number): void {
    const l = len / 2;
    const w = t / 2;
    const c = (su: number, sv: number, top: boolean) => [u + su * l, (top ? v1 : v0) + sv * w, top ? y1 : y0];
    this.face(c(-1, -1, true), c(-1, -1, false), c(1, -1, true), c(1, -1, false), color);
    this.face(c(1, 1, true), c(1, 1, false), c(-1, 1, true), c(-1, 1, false), color);
    this.face(c(-1, 1, true), c(-1, 1, false), c(-1, -1, true), c(-1, -1, false), color);
    this.face(c(1, -1, true), c(1, -1, false), c(1, 1, true), c(1, 1, false), color);
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
    this.paint(color);
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
    this.paint(color);
    const l = len / 2;
    this.b.quad(this.at(u - l, v0, y0), this.at(u + l, v0, y0), this.at(u - l, v1, y1), this.at(u + l, v1, y1));
  }

  /** An upright triangle across the frame at u: base from v0 to v1 at y0, apex at (v, y1). */
  triangle(u: number, v0: number, v1: number, y0: number, v: number, y1: number, color: number): void {
    this.paint(color);
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
        this.paint(c);
        this.b.quad(at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j + 1));
      }
    }
  }

  /** Hipped roof: eaves `len` × `wid` at y0 sloping up on all four sides to a ridge along u at y1. */
  hip(u: number, v: number, len: number, wid: number, y0: number, y1: number, color: number): void {
    this.paint(color);
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
  /** glass, windows, signs and lamps: lit from within after dark, so a station stands out bright at night */
  private glow: THREE.Mesh;
  /** pools of lamplight on platforms and forecourts, added over the ground at night */
  private pools: THREE.Mesh;

  /** `night` is the sky's 0 (day) to 1 (night) uniform. */
  constructor(shadows: boolean, night: { value: number }) {
    this.body = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
    this.body.castShadow = shadows;
    this.body.receiveShadow = true;
    this.body.renderOrder = -2;
    // Floodlit after dark: walls washed in warm light, roofs a little
    const body = this.body.material as THREE.MeshLambertMaterial;
    body.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = night;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          if (uNight > 0.01) {
            vec3 wn = (vec4(normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition))), 0.0) * viewMatrix).xyz;
            totalEmissiveRadiance += vColor.rgb * vec3(1.0, 0.86, 0.66) * uNight * mix(0.5, 0.18, abs(wn.y));
          }`,
        );
    };
    body.customProgramCacheKey = () => 'stationFloodlit';
    const lit = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    lit.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = night;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace(
          '#include <emissivemap_fragment>',
          // Warm light behind the glass; signs keep their own colour, only brighter
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += max(vColor.rgb, vec3(1.0, 0.82, 0.55) * 0.8) * uNight * 0.95;`,
        );
    };
    lit.customProgramCacheKey = () => 'stationGlow';
    this.glow = new THREE.Mesh(new THREE.BufferGeometry(), lit);
    this.glow.castShadow = shadows;
    this.glow.receiveShadow = true;
    this.glow.renderOrder = -2;
    const pool = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    pool.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = night;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse * uNight * 0.55, opacity );');
    };
    pool.customProgramCacheKey = () => 'stationPools';
    this.pools = new THREE.Mesh(new THREE.BufferGeometry(), pool);
    this.pools.renderOrder = 3;
    this.mask = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    );
    this.mask.renderOrder = -1;
    this.mesh.add(this.body, this.glow, this.mask, this.pools);
  }

  /** Hide the light pools by day, when they add nothing. */
  light(night: number): void {
    this.pools.visible = night > 0.02;
  }

  /** `streets` is the road network above, which underground metro entrances must stand beside, not on. */
  rebuild(sys: RailSystem, streets: RoadNetwork, exits: MetroExit[] = []): void {
    const b = new Builder(0);
    const m = new Builder(0);
    const glow = new Builder(0);
    const pools = new Pools();
    const out: Out = { body: b, glow, pools };
    const masked: Out = { ...out, mask: m };
    const colorOf = new Map<number, number>();
    for (const l of sys.transit.lines.values()) for (const id of l.stops) if (!colorOf.has(id)) colorOf.set(id, l.color);
    for (const stop of sys.transit.stops.values()) {
      const pose = stationPose(sys, stop);
      if (!pose) continue;
      const { p, d, h } = pose;
      const f = new Frame(out, p.x, p.y, d.x, d.y);
      const color = colorOf.get(stop.id) ?? 0x9aa5b1;
      if (sys.kind === 'metro') {
        if (stop.look === 'canopy' && h > 0) canopyStation(f, h, color);
        else metroStation(f, h, color);
        // Entrances at street level, where the city placed them (a 共構 station's own building is its way down)
        for (const e of exits) {
          if (e.stop !== stop.id) continue;
          // Frame u along the street, v away from it
          const flip = e.dx * -e.ny + e.dy * e.nx < 0 ? 1 : -1;
          metroEntrance(new Frame(out, e.x, e.y, e.dx * flip, e.dy * flip), h, color);
        }
      } else {
        // The station building stands on the side of the tracks facing the town, off the roads: turn the frame
        // round if that is the other side
        const side = stop.face ?? stationSide(streets, sys.kind, pose);
        const g = side > 0 ? new Frame(masked, p.x, p.y, d.x, d.y) : new Frame(masked, p.x, p.y, -d.x, -d.y);
        if (sys.kind === 'train') {
          // A region's own station where the player built one; every other station in the standard style
          if (stop.style === 'kaohsiung') kaohsiungStation(g, h, color);
          else if (stop.style === 'pingtung') pingtungStation(g, h, color);
          else if (stop.style === 'twin') twinStation(g, h, color);
          else if (stop.style === 'triple') tripleStation(g, h, color);
          else trainStation(g, h, color);
        } else if (isShared(stop.style)) hsrPlatforms(g, h, color);
        else hsrStation(g, h, color);
      }
    }
    this.body.geometry.dispose();
    this.body.geometry = b.geometry();
    this.mask.geometry.dispose();
    this.mask.geometry = m.geometry();
    this.glow.geometry.dispose();
    this.glow.geometry = glow.geometry();
    this.pools.geometry.dispose();
    this.pools.geometry = pools.geometry();
  }
}

/** Side platforms on both sides of the double track, lamps down their outer edge. */
function platforms(f: Frame, h: number, len: number): void {
  for (const side of [-1, 1]) {
    f.box(0, side * 5.6, len, 3, h - 0.2, h + 1.1, PLATFORM);
    for (let u = -len / 2 + 3; u <= len / 2 - 3; u += 6) f.pool(u, side * 5.6, h + 1.1, 2.2, 0.7);
    for (let u = -len / 2 + 6; u <= len / 2 - 6; u += 12) f.lamp(u, side * 6.7, h + 1.1, 3.4, 2.6);
  }
}

/** A row of lamps along a forecourt at v, from u0 to u1, with lamplight spread over the paving. */
function forecourt(f: Frame, v: number, y: number, u0: number, u1: number): void {
  for (let u = u0; u <= u1; u += 8) f.lamp(u, v, y, 5);
  for (let u = u0 + 4; u < u1; u += 8) f.pool(u, v - 2.5, y, 6, 0.6);
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
    f.box(0, side * 8.3, 42, 0.2, h + 4.8, h + 5.0, LAMP);
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

const KMRT_BLUE = 0x1f5fae;
const STEEL = 0xc8ccd0;
const SHRUB = 0x4f7f3a;

/**
 * An underground station's entrance at street level, after Kaohsiung MRT's: a granite plinth three cells long
 * with steps up at the front, a glass hall over the stairs down with the station's white name board, and a white
 * shell roof that stands tall over the steps on two splayed legs and sweeps down to the plinth at the back. The
 * blue exit column stands by the steps. Frame u runs along the street (steps at +u), v away from it.
 */
function metroEntrance(f: Frame, h: number, color: number): void {
  const L = 12;
  const W = 3.6;
  const top = 0.75;
  const stairs = 3.2;
  // Plinth, its paving, and the steps up at the front between granite cheeks
  f.box(-stairs / 2, 0, L * 2 - stairs, W * 2, 0, top, GRANITE);
  f.box(-stairs / 2, 0, L * 2 - stairs - 0.3, W * 2 - 0.3, top, top + 0.03, GRANITE_LIGHT);
  for (let k = 0; k < 4; k++) {
    const u = L - stairs + (k + 0.5) * (stairs / 4);
    f.box(u, 0, stairs / 4, 5.2, 0, top * (1 - k / 4), GRANITE_LIGHT);
  }
  for (const side of [-1, 1]) {
    f.box(L - stairs / 2, side * 3.1, stairs, 1.0, 0, top + 0.25, GRANITE);
    // Steel handrails down the steps
    f.beam(L - stairs, side * 2.4, top + 0.95, L - 0.1, side * 2.4, 0.95, 0.07, STEEL);
    for (const u of [L - stairs + 0.2, L - 0.3]) f.box(u, side * 2.4, 0.06, 0.06, top * (1 - (u - (L - stairs)) / stairs), top * (1 - (u - (L - stairs)) / stairs) + 0.95, STEEL);
    // Low hedges along the plinth's sides
    f.box(-5.5, side * (W - 0.35), 11, 0.6, top, top + 0.55, SHRUB);
  }
  // Glass hall over the stairs down: dark glass between slim frames, a door at the front
  const h0 = top;
  const h1 = top + 3.3;
  const back = -8;
  const front = 6.2;
  f.box((back + front) / 2, 0, front - back, 5.6, h0, h1, KMRT_GLASS);
  for (let u = back; u <= front + 0.01; u += (front - back) / 8) for (const side of [-1, 1]) f.box(u, side * 2.82, 0.12, 0.12, h0, h1, 0xd9dcdf);
  f.box(front + 0.06, 0, 0.1, 2.4, h0, h0 + 2.4, 0x2d3a46);
  // The name board over the door, white with the line's colour beneath and the orange MRT mark at one end
  f.box(front + 0.12, 0, 0.18, 4.6, h1 - 0.85, h1 - 0.15, 0xf7f7f4);
  f.box(front + 0.13, 0, 0.18, 4.6, h1 - 1.0, h1 - 0.85, color);
  f.box(front + 0.24, 1.75, 0.08, 0.55, h1 - 0.75, h1 - 0.25, KMRT_ORANGE);
  // The shell roof: tall and wide over the steps, sweeping down to the plinth at the back
  const roofFront = 8.6;
  const t = (u: number) => (u + L) / (roofFront + L);
  const half = (u: number) => 3.35 + 0.65 * t(u);
  const rise = (u: number) => top + 0.12 + 5.35 * Math.pow(Math.sin((t(u) * Math.PI) / 2), 0.75);
  const y = (u: number, v: number) => rise(u) + 0.3 * (1 - (v / half(u)) ** 2);
  const n = 18;
  const m = 6;
  const pt = (i: number, j: number, under = 0) => {
    const u = -L + ((roofFront + L) * i) / n;
    const v = -half(u) + (2 * half(u) * j) / m;
    return [u, v, y(u, v) - under];
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      f.face(pt(i, j), pt(i, j + 1), pt(i + 1, j), pt(i + 1, j + 1), STEEL_WHITE);
      f.face(pt(i, j + 1, 0.35), pt(i, j, 0.35), pt(i + 1, j + 1, 0.35), pt(i + 1, j, 0.35), 0xe4e7e9);
    }
    // The shell's edges
    for (const j of [0, m]) f.face(pt(i, j), pt(i, j, 0.35), pt(i + 1, j), pt(i + 1, j, 0.35), STEEL_WHITE);
  }
  for (let j = 0; j < m; j++) f.face(pt(n, j), pt(n, j + 1), pt(n, j, 0.35), pt(n, j + 1, 0.35), STEEL_WHITE);
  // Two splayed legs carry the front of the shell, standing on the plinth beside the steps
  for (const side of [-1, 1]) f.lean(roofFront - 0.6, 1.1, 0.6, side * 3.0, 0, side * (half(roofFront) - 0.3), rise(roofFront) - 0.2, STEEL_WHITE);
  // The blue exit column by the steps, the orange MRT mark near its top
  f.box(L - 0.5, -W + 0.3, 0.6, 0.6, 0, 3.0, 0xf2f3f1);
  f.box(L - 0.5, -W + 0.3, 0.62, 0.62, 3.0, 4.6, KMRT_BLUE);
  f.box(L - 0.18, -W + 0.3, 0.04, 0.36, 3.9, 4.3, KMRT_ORANGE);
  f.box(L - 0.5, -W + 0.3, 0.64, 0.64, 2.75, 2.95, color);
  // Stair shaft down to the hall, seen in the see-through view
  if (h < 0) f.box(-1, 0, 12, 4, h + 3.9, -0.2, CONCRETE);
}

/** Height of a large elevated station's sail roof over (u, v), above track height h. */
function sail(h: number, u: number, v: number): number {
  const edge = Math.min(1, Math.abs(v) / 15);
  const mast = (1 + Math.cos((2 * Math.PI * u) / 15)) / 2;
  const end = Math.max(0, (Math.abs(u) - 46) / 10);
  return h + 6.4 + 2.6 * edge ** 1.6 + 1.1 * mast * (1 - edge) - 1.6 * end * end;
}

/**
 * A large elevated metro station (4 × 15 cells): platforms on a deck held up by white splayed columns, under a white
 * sail roof that sweeps up at its long edges and is hung from a row of tall masts with cables, and glass-covered
 * escalators climbing to the platforms from the street on either side. A glass concourse stands under the deck.
 */
function canopyStation(f: Frame, h: number, color: number): void {
  platforms(f, h, 100);
  // Deck under the platforms, and low glass screens along them
  f.box(0, 0, 100, 18.6, h - 1.3, h - 0.2, CONCRETE);
  for (const side of [-1, 1]) {
    f.box(0, side * 8.9, 100, 0.12, h + 1.1, h + 2.5, KMRT_GLASS);
    f.box(0, side * 9.05, 100.4, 0.5, h - 1.3, h - 0.5, color);
  }
  // White splayed columns under the deck
  for (let u = -45; u <= 45; u += 15) for (const side of [-1, 1]) f.lean(u, 1.0, 0.9, side * 6.2, 0, side * 8.4, h - 1.3, STEEL_WHITE);
  // Glass concourse at street level under the middle of the deck
  f.box(0, 0, 44, 13, 0, 4.6, KMRT_GLASS);
  f.box(0, 0, 44.6, 13.6, 4.6, 5.1, STEEL_WHITE);
  for (let u = -22; u <= 22; u += 4.4) for (const side of [-1, 1]) f.box(u, side * 6.55, 0.18, 0.18, 0, 4.6, 0xd9dcdf);
  // The sail roof, its underside a shade darker
  const nu = 56;
  const nv = 12;
  const pt = (i: number, j: number, under = 0) => {
    const u = -56 + (112 * i) / nu;
    const v = -15 + (30 * j) / nv;
    return [u, v, sail(h, u, v) - under];
  };
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      f.face(pt(i, j), pt(i, j + 1), pt(i + 1, j), pt(i + 1, j + 1), STEEL_WHITE);
      f.face(pt(i, j + 1, 0.2), pt(i, j, 0.2), pt(i + 1, j + 1, 0.2), pt(i + 1, j, 0.2), 0xdde2e5);
    }
    for (const j of [0, nv]) f.face(pt(i, j), pt(i, j, 0.25), pt(i + 1, j), pt(i + 1, j, 0.25), STEEL_WHITE);
  }
  // Struts from the platforms up to the roof
  for (let u = -45; u <= 45; u += 15) {
    for (const side of [-1, 1]) {
      for (const du of [-3, 3]) f.beam(u, side * 7.4, h + 1.1, u + du, side * 11, sail(h, u + du, side * 11) - 0.2, 0.35, STEEL_WHITE);
      f.box(u, side * 7.4, 0.4, 0.4, h + 1.1, h + 2.2, STEEL_WHITE);
    }
  }
  // Masts in a row along the middle, rising well above the roof, with cables down to it
  for (let u = -45; u <= 45; u += 15) {
    const base = sail(h, u, 0);
    f.prism(u, 0, 0.32, base - 0.3, h + 18, STEEL_WHITE, 8);
    f.prism(u, 0, 0.13, h + 18, h + 21, STEEL_WHITE, 6);
    for (const du of [-6, 6]) for (const side of [-1, 1]) f.beam(u, 0, h + 17.4, u + du, side * 11, sail(h, u + du, side * 11), 0.07, 0xd9dde0);
  }
  // Glass escalator tubes from the street up to the platforms, one on each side at opposite ends
  for (const side of [-1, 1]) {
    const u0 = side * 20;
    const u1 = side * 50;
    const v0 = side * 10.5;
    const v1 = side * 14.5;
    const vm = (v0 + v1) / 2;
    const y = (u: number) => (h * (u1 - u)) / (u1 - u0);
    const lo = (u: number) => y(u);
    const hi = (u: number) => y(u) + 3;
    f.sheet(Math.min(u0, u1), Math.max(u0, u1), Math.min(v0, v1), Math.max(v0, v1), 10, 1, (u) => y(u), () => 0x5d646b);
    f.sheet(Math.min(u0, u1), Math.max(u0, u1), Math.min(v0, v1), Math.max(v0, v1), 10, 1, (u) => hi(u), () => KMRT_GLASS);
    for (const v of [v0, v1]) f.wall(u0, v, u1, v, (u) => lo(u), (u) => hi(u), KMRT_GLASS);
    // White ribs over the tube
    for (let k = 0; k <= 10; k++) {
      const u = u0 + ((u1 - u0) * k) / 10;
      for (const v of [v0, v1]) f.box(u, v, 0.2, 0.2, y(u), y(u) + 3, STEEL_WHITE);
      f.box(u, vm, 0.2, 4.2, y(u) + 2.9, y(u) + 3.15, STEEL_WHITE);
    }
    // Columns under it, the landing that joins it to the platform, and the street end
    for (const u of [0.25, 0.5, 0.75].map((k) => u0 + (u1 - u0) * k)) f.box(u, vm, 0.8, 0.8, 0, y(u) - 0.1, CONCRETE);
    f.box(u0 - side * 2.5, side * 11.5, 5, 6, h - 1.3, h - 0.2, CONCRETE);
    f.box(u0 - side * 2.5, side * 11.5, 5, 6, h - 0.2, h + 3, KMRT_GLASS);
    f.box(u0 - side * 2.5, side * 11.5, 5.4, 6.4, h + 3, h + 3.4, STEEL_WHITE);
    // The exit column at the street end
    f.box(u1 + side * 3, vm, 0.6, 0.6, 0, 3.0, 0xf2f3f1);
    f.box(u1 + side * 3, vm, 0.62, 0.62, 3.0, 4.6, KMRT_BLUE);
    f.box(u1 + side * 3, vm, 0.66, 0.66, 2.75, 2.95, color);
    f.box(u1 + side * 3, vm, 0.7, 0.4, 3.9, 4.3, KMRT_ORANGE);
  }
}

function trainStation(f: Frame, h: number, color: number): void {
  platforms(f, h, 84);
  // Canopies over each platform: grey-blue pitched metal roofs on posts
  for (const side of [-1, 1]) {
    for (let u = -36; u <= 36; u += 12) f.box(u, side * 5.6, 0.3, 0.3, h + 1.1, h + 4.0, 0x6e757c);
    f.box(0, side * 5.6, 80, 3.6, h + 3.9, h + 4.1, color);
    f.box(0, side * 5.6, 78, 0.3, h + 3.75, h + 3.9, LAMP);
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
  forecourt(f, front + 5, base, -16, 16);
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
  forecourt(f, 30, base, -16, 16);
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
  // Lamps on the plaza floor and along the street at its top, light spilling down the stairs
  for (const [lu, lv] of [[-13, 24], [13, 24], [-8, 30], [8, 30]]) f.lamp(lu, lv, floor, 5);
  for (const [pu, pv, r] of [[0, 18, 9], [-10, 27, 7], [10, 27, 7], [0, 33, 8]]) f.pool(pu, pv, floor, r, 0.7);
  forecourt(f, 40, 0, -24, 24);
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
 * Pingtung station on raised track, after the design drawing of the real one: a long hall carrying the platforms,
 * dark stone below with a band of glass, a pale roof curved over the top with white rounded eaves, and a row of
 * white arched ribs striding over it. In front, under a white canopy that ripples along the entrance, a plaza
 * with a long pool of fountains, trees and pavilions, and the bus station's low round-roofed hall to one side.
 */
function pingtungElevated(f: Frame, h: number, color: number): void {
  platforms(f, h, 84);
  const [u0, u1, , v1] = PINGTUNG_STATION;
  const len = 92;
  const half = 9.5;
  // Ground floor and concourse: dark stone piers, glass between them, a band of glass under the platform floor
  f.box(0, 0, len, half * 2, 0, h - 0.4, STONE_DARK);
  for (const side of [-1, 1]) {
    for (let u = -42; u < 42; u += 6) f.box(u + 3, side * (half + 0.05), 4, 0.1, 0.3, h - 2.6, GLASS);
    f.box(0, side * (half + 0.1), len - 2, 0.1, h - 2.2, h - 0.8, 0x8fb4c4);
  }
  // Platform level: glass walls round the platforms, the tracks open at the ends
  for (const side of [-1, 1]) f.box(0, side * half, len, 0.3, h - 0.4, h + 6, 0xa9c4cf);
  for (let u = -42; u <= 42; u += 6) for (const side of [-1, 1]) f.box(u, side * (half + 0.1), 0.5, 0.4, h - 0.4, h + 6, 0xe4e6e3);
  // The roof: pale and curved over the top, rounded white eaves along both sides
  f.vault(0, 0, len + 4, half * 2 + 4, h + 6, 3.2, 0xd5d8d6, 12);
  for (const side of [-1, 1]) {
    f.box(0, side * (half + 2), len + 4.4, 1.2, h + 5.2, h + 6.4, STEEL_WHITE);
    f.box(0, side * (half + 2.7), len + 4, 0.2, h + 5.0, h + 5.2, LAMP);
    f.panel(0, len + 4.4, side * (half + 2.6), h + 5.4, side * (half + 1.4), h + 4.6, STEEL_WHITE);
  }
  for (const e of [-1, 1]) f.box(e * (len / 2 + 2), 0, 0.4, half * 2 + 4, h + 5.2, h + 6.6, color);
  // White arched ribs over the roof, each a pointed arch from eave to eave
  const ribs = 13;
  for (let k = 0; k < ribs; k++) {
    const u = -len / 2 + 4 + (k * (len - 8)) / (ribs - 1);
    const base = h + 5.6;
    const top = h + 15;
    const pts: [number, number][] = [];
    for (let j = 0; j <= 6; j++) {
      const t = j / 6;
      // From the eave up to the apex, bowed outwards like a pointed arch
      pts.push([(half + 3) * (1 - t), base + (top - base) * Math.sin((t * Math.PI) / 2) ** 0.8]);
    }
    for (const side of [-1, 1]) {
      for (let j = 0; j < 6; j++) f.beam(u, side * pts[j][0], pts[j][1], u, side * pts[j + 1][0], pts[j + 1][1], 0.55, STEEL_WHITE);
    }
  }
  // The station's name in blue on the front, by the entrance
  f.box(-20, half + 0.3, 12, 0.2, h - 3.2, h - 1.2, TR_BLUE);
  f.box(-20, half + 0.42, 10.5, 0.05, h - 2.7, h - 1.7, 0xf7f7f4);
  // Entrance canopy: a white membrane rippling along the front on slim posts
  const canopy = (u: number, v: number) => 6 + 1.1 * Math.cos((u / 7.5) * Math.PI) - 0.9 * ((v - half) / 8);
  f.sheet(-16, 40, half + 0.5, half + 8.5, 56, 4, canopy, () => 0xf4f6f6);
  for (let u = -12; u <= 36; u += 7.5) f.box(u, half + 7.6, 0.3, 0.3, 0, canopy(u, half + 7.6), STEEL_WHITE);
  // The plaza: paving, a long pool with fountains, trees, little pavilions
  f.box(0, (half + v1) / 2, u1 - u0, v1 - half, -0.02, 0.05, PAVING);
  f.box(-2, 25, 30, 11, 0.05, 0.35, GRANITE_LIGHT);
  f.box(-2, 25, 28.6, 9.6, 0.05, 0.4, 0x5fb8b5);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    f.box(-2 + Math.cos(a) * 3, 25 + Math.sin(a) * 2.2, 0.15, 0.15, 0.4, 2.6 + (k % 3) * 0.8, 0xf2f6f8);
  }
  f.box(-2, 25, 0.25, 0.25, 0.4, 4.2, 0xf2f6f8);
  const tree = (u: number, v: number, r: number) => {
    f.box(u, v, 0.35, 0.35, 0, 2.6, TRUNK);
    f.prism(u, v, r, 2.4, 2.4 + r * 1.3, 0x5f9446, 8);
    f.prism(u, v, r * 0.7, 2.4 + r * 1.3, 2.4 + r * 1.9, 0x6ea350, 8);
  };
  for (const [tu, tv, r] of [[-44, 14, 2.4], [-38, 20, 2.8], [-44, 27, 2.6], [-36, 31, 2.2], [-27, 15, 2], [-25, 31, 2.4], [20, 31, 2.2], [-16, 32, 1.8]]) tree(tu, tv, r);
  for (const [pu, pv, c] of [[-31, 24, 0xd4785a], [-21, 22, 0x6aa38f]] as const) {
    for (const cu of [-1.6, 1.6]) for (const cv of [-1.6, 1.6]) f.box(pu + cu, pv + cv, 0.2, 0.2, 0, 2.6, STEEL_WHITE);
    f.gable(pu, pv, 4.6, 4.6, 2.6, 3.4, c);
  }
  // The bus station's hall to one side: low, glass-fronted, a curved roof
  f.box(39, 27, 18, 10, 0, 4, 0xe8e9e6);
  f.box(39, 32.05, 16, 0.1, 0.3, 3.4, GLASS);
  f.vault(39, 27, 19, 11, 4, 1.4, 0xcfd3d3, 8);
  f.box(34, 32.3, 4, 0.1, 2.6, 3.4, TR_BLUE);
  // Stair and lift up to the platforms at the far end
  f.box(46, 0, 4, 4, 0, h + 1.1, STEEL_WHITE);
  // Lamps round the plaza, and light under the canopy along the front of the hall
  forecourt(f, v1 - 1.5, 0, -40, 32);
  for (let u = -12; u <= 36; u += 8) f.pool(u, half + 4.5, 0, 6, 0.8);
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
    f.box(0, side * 7.9, 78, 0.2, h + 5.2, h + 5.4, LAMP);
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
  forecourt(f, 30, base, -16, 16);
  for (const pu of [-14, -10, 10, 14]) {
    f.box(pu, 24, 0.35, 0.35, base, base + 6, TRUNK);
    f.box(pu, 24, 3.2, 0.7, base + 5.8, base + 6.3, PALM);
    f.box(pu, 24, 0.7, 3.2, base + 5.8, base + 6.3, PALM);
    f.box(pu, 24, 1.4, 1.4, base + 6.1, base + 6.8, PALM);
  }
  footbridge(f, h, STEEL_WHITE);
  trench(f, h);
}

/** High-speed platforms under their long roof, without a concourse: the 三鐵 station's hall serves them. */
function hsrPlatforms(f: Frame, h: number, color: number): void {
  platforms(f, h, 124);
  if (h < 0) {
    // In a tunnel (Kaohsiung's): walls down the sides, the line's colour along them
    for (const side of [-1, 1]) {
      f.box(0, side * 11.8, 128, 0.6, h - 0.4, h + 6.4, CONCRETE);
      f.box(0, side * 11.4, 128, 0.1, h + 3.4, h + 4.1, color);
    }
    return;
  }
  for (let u = -54; u <= 54; u += 18) for (const side of [-1, 1]) f.box(u, side * 10, 0.6, 0.6, h + 1.1, h + 9, 0x8a9096);
  f.box(0, 0, 130, 22, h + 9, h + 9.6, 0xeef0f2);
  for (const side of [-1, 1]) f.box(0, side * 5.6, 120, 0.4, h + 8.8, h + 9, LAMP);
  for (const side of [-1, 1]) f.box(0, side * 11, 130, 0.5, h + 8.4, h + 9.8, color);
  // Covered bridge from the platforms over to the hall in front
  f.box(0, 17.5, 8, 13, h + 6, h + 9, GLASS);
  f.box(0, 17.5, 8.6, 13.4, h + 9, h + 9.5, 0xeef0f2);
}

const PORTAL = 0xe2ddd1;
const SOFFIT = 0xeceae4;
const GARAGE = 0xbfc1bf;

/**
 * 雙鐵共構站, after 科工館車站: over the stairs down to both lines, a great white roof that sweeps up from the back
 * to a high, straight front edge far out over the entrance. Under it a stone portal with the station's name in
 * TR blue, broad steps up to a granite podium, a sloping glass wall down one side on white branching columns and
 * leaning white columns down the other, a concrete lift tower behind and a ramp along the side.
 */
function twinStation(f: Frame, h: number, color: number): void {
  platforms(f, h, 84);
  trench(f, h);
  const [u0, u1, v0, v1] = HUBS.twin.rects[0];
  f.box((u0 + u1) / 2, (v0 + v1) / 2, u1 - u0, v1 - v0, -0.02, 0.05, PAVING);
  // Granite podium the hall stands on, the escalator wells down to both lines, and the steps up at the front
  f.box(0, 2, 40, 20, 0, 1.5, GRANITE);
  f.box(0, 2, 39.6, 19.6, 1.5, 1.55, GRANITE_LIGHT);
  for (const eu of [-7, 7]) f.box(eu, 1, 9, 6, 1.5, 1.58, 0x2b2f33);
  for (let k = 0; k < 6; k++) f.box(0, 12.4 + k * 0.85, 26, 0.85, 0, 1.5 - k * 0.25, GRANITE_LIGHT);
  for (const su of [-13.6, 13.6]) f.box(su, 14.5, 1.2, 4.6, 0, 1.6, GRANITE);
  for (const su of [-6, 0, 6]) {
    f.box(su, 14.6, 0.12, 4.4, 1.2, 2.2, 0xc9ccd0);
  }
  // The roof: high and straight at the front, sweeping down to the back
  const roof = (_u: number, v: number) => 4.8 + 8.4 * ((v + 12) / 28) ** 2;
  f.sheet(-24, 24, -12, 16, 12, 14, roof, () => STEEL_WHITE);
  f.sheet(-24, 24, -12, 16, 12, 14, (u, v) => roof(u, v) - 0.7, () => SOFFIT);
  for (const e of [-24, 24]) f.wall(e, -12, e, 16, (u, v) => roof(u, v) - 0.7, roof, STEEL_WHITE);
  f.wall(-24, 16, 24, 16, (u, v) => roof(u, v) - 0.7, roof, STEEL_WHITE);
  f.wall(-24, -12, 24, -12, (u, v) => roof(u, v) - 0.7, roof, STEEL_WHITE);
  for (let u = -18; u <= 18; u += 6) for (let v = -6; v <= 12; v += 6) f.pool(u, v, 1.55, 2.4, 0.6);
  // Stone portal at the front: two piers and the lintel carrying the name
  const under = roof(0, 12) - 0.7;
  for (const pu of [-15.5, 15.5]) f.box(pu, 12, 3, 2, 1.5, under, PORTAL);
  f.box(0, 12, 34, 2, 6.8, under, PORTAL);
  f.box(-10.5, 13.06, 2.4, 0.1, 7.2, 9, TR_BLUE);
  f.box(-10.5, 13.12, 1.6, 0.05, 7.95, 8.25, PORTAL);
  for (let k = 0; k < 5; k++) f.box(-7.2 + k * 2.1, 13.06, 1.6, 0.1, 8.1, 9.1, TR_BLUE);
  f.box(1.5, 13.06, 22, 0.1, 7.2, 7.75, TR_BLUE);
  // Glass back wall into the hall, lit from inside
  f.box(0, -7.6, 36, 0.2, 1.5, roof(0, -7.6) - 0.7, GLASS);
  // Left: a sloping glass wall held out on white branching columns
  for (let v = -8; v <= 10; v += 3) {
    const top = roof(-23, v) - 0.7;
    f.beam(-19.5, v, 1.5, -23, v, top, 0.45, STEEL_WHITE);
    f.beam(-21.2, v, (1.5 + top) / 2, -22, v + 1.2, top - 0.6, 0.18, STEEL_WHITE);
    f.beam(-21.2, v, (1.5 + top) / 2, -22, v - 1.2, top - 0.6, 0.18, STEEL_WHITE);
  }
  f.sheet(-23.4, -20, -9, 11, 1, 10, (u, v) => 1.5 + ((u + 20) / -3.4) * (roof(-23, v) - 2.4), () => GLASS);
  // Right: open, under pairs of white columns leaning out like a V
  for (let v = -6; v <= 10; v += 4) {
    const top = roof(22.5, v) - 0.7;
    f.beam(19, v, 1.5, 22.5, v - 1.6, top, 0.5, STEEL_WHITE);
    f.beam(19, v, 1.5, 22.5, v + 1.6, top, 0.5, STEEL_WHITE);
  }
  f.sheet(20.5, 23.4, -9, 11, 1, 10, (u, v) => roof(22.5, v) - 0.8 - ((23.4 - u) / 2.9) * 2.4, () => GLASS);
  // Concrete lift and vent tower behind, with its windows, and the ramp along the side with its rails
  f.box(-27, -17, 10, 14, 0, 9.5, 0xc4c5c1);
  f.box(-27, -9.95, 6, 0.1, 5, 8.6, WINDOW);
  f.box(-27, -9.95, 2.2, 0.1, 0, 3, GLASS);
  f.sheet(-31.6, -28, -9, 17, 1, 8, (_u, v) => Math.max(0, 1.5 * (1 - (v + 9) / 26)), () => GRANITE_LIGHT);
  for (const ru of [-31.6, -28]) f.box(ru, 4, 0.12, 26, 0.6, 1.6, 0x9a9da0);
  // Bikes parked by the lift tower
  for (let k = 0; k < 6; k++) f.box(-32.5, 2 + k * 1.2, 1.6, 0.25, 0, 1, k % 2 ? 0xd94b3d : 0xe9e7e2);
  // A line-coloured band along the podium's edge, lamps along the front
  f.box(0, 12.05, 30, 0.1, 1.5, 1.75, color);
  forecourt(f, v1 - 1, 0, -28, 28);
}

/**
 * 三鐵共構站, after 新左營車站: a long hall of dark glass under a broad grey roof that bows gently, long skylights
 * ribbing its back half and white fascias all round, a lower block at the front corner, the name in TR blue across
 * the front. Beside it the car park, open decks on concrete with cars on the roof, which the elevated road runs
 * into; behind it the high-speed platforms, and the trains and metro below.
 */
function tripleStation(f: Frame, h: number, color: number): void {
  platforms(f, h, 84);
  trench(f, h);
  const [hall, park] = HUBS.triple.rects;
  const [a0, a1, b0, b1] = hall;
  f.box((a0 + a1) / 2, (b0 + b1) / 2, a1 - a0, b1 - b0, -0.02, 0.05, PAVING);
  // The hall: dark glass, two white floor bands, a lower block in the front corner
  const hu0 = -56;
  const hu1 = 44;
  const hv0 = -20;
  const hv1 = 26;
  const top = 15;
  f.box((hu0 + hu1) / 2, (hv0 + hv1) / 2, hu1 - hu0, hv1 - hv0, 0, top, 0x46596a);
  for (const y of [5.2, 10.4]) f.box((hu0 + hu1) / 2, (hv0 + hv1) / 2, hu1 - hu0 + 0.3, hv1 - hv0 + 0.3, y, y + 0.7, 0xdfe2e2);
  f.box((hu0 + hu1) / 2, hv1 + 0.05, hu1 - hu0 - 6, 0.1, 0.3, 5, GLASS);
  f.box(-36, 22, 32, 14, 0, 9, 0xd9dcdc);
  f.box(-36, 29.05, 30, 0.1, 0.4, 4.4, GLASS);
  f.box(-36, 22, 32.6, 14.6, 9, 9.6, STEEL_WHITE);
  // The name across the front in blue
  for (let k = 0; k < 4; k++) f.box(-8 + k * 3, hv1 + 0.12, 2.4, 0.1, 6.4, 8.8, TR_BLUE);
  f.box(4, hv1 + 0.12, 26, 0.1, 6.1, 6.3, TR_BLUE);
  // The roof: bowing across the hall, overhanging it, skylights ribbing the back half, white fascia round it
  const ru0 = hu0 - 2;
  const ru1 = hu1 + 2;
  const rv0 = hv0 - 2;
  const rv1 = hv1 + 3;
  const roof = (u: number, v: number) => top + 0.6 + 2.6 * Math.sin((Math.PI * (v - rv0)) / (rv1 - rv0)) - 0.6 * smooth(-58, -40, -u);
  const nu = 52;
  const nv = 16;
  f.sheet(ru0, ru1, rv0, rv1, nu, nv, roof, (i, j) => {
    const u = ru0 + ((ru1 - ru0) * (i + 0.5)) / nu;
    const v = rv0 + ((rv1 - rv0) * (j + 0.5)) / nv;
    if (i === 0 || j === 0 || i === nu - 1 || j === nv - 1) return STEEL_WHITE;
    return u > -14 && u < 40 && v > -14 && v < 18 && i % 3 === 0 ? SKYLIGHT : 0xa7aeb2;
  });
  for (const [x0, y0, x1, y1] of [[ru0, rv0, ru1, rv0], [ru0, rv1, ru1, rv1], [ru0, rv0, ru0, rv1], [ru1, rv0, ru1, rv1]]) {
    f.wall(x0, y0, x1, y1, (u, v) => roof(u, v) - 1.2, roof, STEEL_WHITE);
  }
  for (let u = hu0 + 6; u < hu1; u += 12) f.box(u, rv1 - 1.4, 0.6, 0.6, 0, roof(u, rv1 - 1.4) - 1, STEEL_WHITE);
  // The car park: open decks between concrete bands, cars parked on its roof, stair towers and a spiral ramp
  const [p0, p1, q0, q1] = park;
  const pu = (p0 + p1) / 2;
  const pv = (q0 + q1) / 2;
  const deck = 8;
  f.box(pu, pv, p1 - p0 - 1, q1 - q0 - 1, 0, deck, 0x3d4247);
  for (const y of [0, 3.8, deck - 0.4]) {
    f.box(pu, pv, p1 - p0, q1 - q0, y, y + 0.4, GARAGE);
    if (y > 0) f.box(pu, pv, p1 - p0 + 0.2, q1 - q0 + 0.2, y + 0.4, y + 1.4, 0xd3d5d3);
  }
  for (let u = p0 + 4; u < p1; u += 8) for (const v of [q0 + 0.6, q1 - 0.6]) f.box(u, v, 0.6, 0.6, 0, deck, GARAGE);
  const cars = [0xe9e9e6, 0x2a2d31, 0x9aa2a8, 0xb33a32, 0x31527a, 0xd8d2c4];
  for (let row = 0; row < 4; row++) {
    const v = q0 + 5 + row * 12.5;
    for (const dv of [-2.4, 2.4]) {
      for (let u = p0 + 5; u < p1 - 6; u += 2.6) {
        const k = Math.abs(Math.round(u * 7 + v * 13 + dv * 5)) % 9;
        if (k < cars.length) f.box(u, v + dv, 1.8, 4.2, deck, deck + 1.3, cars[k]);
      }
    }
  }
  for (const [tu, tv] of [[p0 + 3, q0 + 3], [p1 - 3, q0 + 3], [p0 + 3, q1 - 3]]) f.box(tu, tv, 5, 5, 0, deck + 3.4, 0xd7d9d7);
  f.prism(p1 - 6, q1 - 6, 6, 0, deck, GARAGE, 16);
  // Plaza and lamps out front, lamps on the car park roof
  forecourt(f, b1 - 2, 0, -50, 40);
  for (let u = p0 + 8; u < p1; u += 14) f.lamp(u, pv, deck, 5, 8);
  f.box((hu0 + hu1) / 2, hv1 + 0.2, hu1 - hu0, 0.2, 14.4, 15, color);
}

function hsrStation(f: Frame, h: number, color: number): void {
  platforms(f, h, 124);
  // Long roof over the tracks on slim columns
  for (let u = -54; u <= 54; u += 18) for (const side of [-1, 1]) f.box(u, side * 10, 0.6, 0.6, h + 1.1, h + 9, 0x8a9096);
  f.box(0, 0, 130, 22, h + 9, h + 9.6, 0xeef0f2);
  for (const side of [-1, 1]) f.box(0, side * 5.6, 120, 0.4, h + 8.8, h + 9, LAMP);
  for (const side of [-1, 1]) f.box(0, side * 11, 130, 0.5, h + 8.4, h + 9.8, color);
  // Glass concourse beside the line
  const base = Math.max(0, Math.min(h, 0));
  f.box(0, 24, 60, 20, base, base + 12, GLASS);
  f.box(0, 24, 64, 23, base + 12, base + 13, 0xeef0f2);
  f.box(0, 24, 64.4, 23.4, base + 13, base + 13.4, color);
  forecourt(f, 38, base, -28, 28);
  if (h > 2) f.box(0, 13, 10, 6, base, h + 1, CONCRETE);
}

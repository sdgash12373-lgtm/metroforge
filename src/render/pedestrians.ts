import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { City } from '../sim/city';
import { toWorld } from '../sim/facilities';
import { type RoadSegment, asphaltWidth, roadWidth } from '../sim/roads';
import { Zone } from '../sim/zoning';
import { painted, tint, wheel } from './kit';

const MAX = 900;
/** One walker on the street per this many residents. */
const PER_RESIDENTS = 30;
/** One cyclist on the street per this many residents who ride to work. */
const PER_CYCLIST = 25;
export const CLOTHES = [0xe4572e, 0x2e86ab, 0xf2f2f2, 0x3b3b3b, 0xf2b134, 0x6a994e, 0xa23b72, 0x4f8fd6, 0xd98ab0];
/** Office wear: white and pale blue shirts, grey and black jackets */
const OFFICE = [0xf4f4f4, 0xcfe0f0, 0x6e737a, 0x2f3238, 0xe9e4da];
export const ELDER = [0x8a7f6e, 0x6b7a8f, 0x9c8f80, 0x7d6b5d, 0xa4746a];
export const KIDS = [0xf2b134, 0xe4572e, 0x4f8fd6, 0x6a994e, 0xd98ab0, 0xffffff];
const POLICE_BLUE = 0x1f2f5a;

/** Who is out walking. */
export enum Person {
  Man,
  Woman,
  Elder,
  Child,
  Police,
}
const PEOPLE = [Person.Man, Person.Woman, Person.Elder, Person.Child, Person.Police];

interface Walker {
  seg: number;
  /** distance along the segment's samples */
  s: number;
  /** +1 walks a → b, -1 back */
  dir: 1 | -1;
  /** which sidewalk */
  side: 1 | -1;
  speed: number;
  color: number;
  phase: number;
  /** walking over a footbridge: its id, and how far across */
  bridge?: number;
  /** riding a bicycle (residents who can't afford a scooter or car) */
  bike?: boolean;
  who: Person;
}

const SKIN = 0xe8c4a0;
/** Top of the sidewalk, where people's feet go. */
const SIDEWALK = 0.04;
/** How far arms and legs swing either way (radians): elders shuffle, children bound along. */
const STRIDE: Record<Person, number> = {
  [Person.Man]: 0.45,
  [Person.Woman]: 0.4,
  [Person.Elder]: 0.22,
  [Person.Child]: 0.55,
  [Person.Police]: 0.45,
};
const HAIR = 0x2a2420;

const plain = (w: number, h: number, d: number, x: number, y: number, z: number) => painted(w, h, d, x, y, z);

/**
 * Mark a limb to swing while walking: it turns about the side axis through (px, py), one way for `sign` +1 and the
 * other for -1, by the walker's stride angle. Parts not marked stay still.
 */
function limb(g: THREE.BufferGeometry, sign: number, px: number, py: number): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([sign, px, py], i * 3);
  g.setAttribute('swing', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Merge a figure's parts, giving the still ones a zero swing so every part has the same attributes. */
function body(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const g of parts) if (!g.getAttribute('swing')) limb(g, 0, 0, 0);
  return mergeGeometries(parts)!;
}

/** Two legs from the hip at height `hip`, `w` wide and `gap` apart, in one colour. */
const legs = (hip: number, w: number, d: number, gap: number, color: number, x = 0) =>
  [1, -1].map((sign) => limb(painted(w, hip, d, x, hip / 2, (sign * gap) / 2, color), sign, x, hip));

/**
 * Two arms hanging from the shoulders at height `top`, `out` from the middle: a sleeve of `sleeve` length and a bare
 * forearm and hand below it. The sleeves go with the clothes, the hands with the rest. Each arm swings against the
 * leg on its side.
 */
function arms(top: number, len: number, out: number, sleeve: number, x = 0) {
  const t = 0.11;
  const clothes = [1, -1].map((sign) => limb(plain(t, len * sleeve, t, x, top - (len * sleeve) / 2, sign * out), -sign, x, top));
  const hands = [1, -1].map((sign) =>
    limb(painted(t * 0.9, len * (1 - sleeve), t * 0.9, x, top - len * sleeve - (len * (1 - sleeve)) / 2, sign * out, SKIN), -sign, x, top),
  );
  return { clothes, hands };
}

/**
 * Each kind of person in two parts, facing +x: clothes take each walker's colour, the rest (skin, hair, legs)
 * keeps its own. Arms and legs are separate so they can swing as the person walks.
 */
export function figure(who: Person): { clothes: THREE.BufferGeometry; rest: THREE.BufferGeometry } {
  switch (who) {
    case Person.Woman: {
      const a = arms(1.36, 0.6, 0.27, 0.35);
      return {
        clothes: body([plain(0.3, 0.6, 0.44, 0, 1.1, 0), plain(0.42, 0.42, 0.5, 0, 0.66, 0), ...a.clothes]),
        rest: body([
          ...legs(0.52, 0.11, 0.12, 0.17, SKIN),
          ...a.hands,
          painted(0.23, 0.23, 0.23, 0, 1.52, 0, SKIN),
          painted(0.27, 0.08, 0.27, -0.01, 1.66, 0, HAIR),
          painted(0.08, 0.38, 0.27, -0.12, 1.47, 0, HAIR),
        ]),
      };
    }
    case Person.Elder: {
      // a little stooped, grey-haired, with a walking stick
      const a = arms(1.28, 0.56, 0.3, 0.7, 0.06);
      return {
        clothes: body([plain(0.32, 0.6, 0.5, 0.06, 1.02, 0), ...a.clothes]),
        rest: body([
          ...legs(0.74, 0.13, 0.15, 0.2, 0x5b5348),
          ...a.hands,
          painted(0.23, 0.23, 0.23, 0.12, 1.44, 0, SKIN),
          painted(0.25, 0.07, 0.25, 0.11, 1.58, 0, 0xd9d9d6),
          painted(0.04, 0.9, 0.04, 0.32, 0.45, 0.36, 0x6b4a2b),
        ]),
      };
    }
    case Person.Child: {
      // about 1.15 m, with the yellow cap Taiwanese schoolchildren wear
      const a = arms(0.9, 0.4, 0.23, 0.35);
      return {
        clothes: body([plain(0.24, 0.42, 0.36, 0, 0.72, 0), ...a.clothes]),
        rest: body([
          ...legs(0.52, 0.1, 0.12, 0.15, 0x2d3a4f),
          ...a.hands,
          painted(0.22, 0.22, 0.22, 0, 1.04, 0, SKIN),
          painted(0.26, 0.08, 0.26, 0.02, 1.18, 0, 0xf6d32d),
          painted(0.14, 0.3, 0.3, -0.19, 0.76, 0, 0xc8402f),
        ]),
      };
    }
    case Person.Police: {
      const a = arms(1.42, 0.64, 0.32, 0.4);
      return {
        clothes: body([plain(0.34, 0.66, 0.52, 0, 1.12, 0), ...a.clothes]),
        rest: body([
          ...legs(0.8, 0.13, 0.15, 0.18, 0x1a2240),
          ...a.hands,
          painted(0.24, 0.24, 0.24, 0, 1.58, 0, SKIN),
          painted(0.3, 0.1, 0.3, 0.02, 1.74, 0, 0x1a2240),
          painted(0.31, 0.03, 0.31, 0.02, 1.7, 0, 0xf2f2f2),
          painted(0.35, 0.08, 0.53, 0, 0.82, 0, 0x111111),
        ]),
      };
    }
    default: {
      const a = arms(1.42, 0.62, 0.31, 0.4);
      return {
        clothes: body([plain(0.32, 0.65, 0.5, 0, 1.12, 0), ...a.clothes]),
        rest: body([
          ...legs(0.8, 0.13, 0.15, 0.18, 0x2d3a4f),
          ...a.hands,
          painted(0.24, 0.24, 0.24, 0, 1.58, 0, SKIN),
          painted(0.26, 0.07, 0.26, -0.01, 1.72, 0, HAIR),
        ]),
      };
    }
  }
}

/** A YouBike-style bicycle and its rider, facing +x: the rider's shirt takes the instance colour, the rest keeps its own. */
function cyclist(): { clothes: THREE.BufferGeometry; rest: THREE.BufferGeometry } {
  const frame = 0xf2a900;
  return {
    clothes: body([plain(0.34, 0.6, 0.45, -0.12, 1.2, 0), // Arms reaching for the handlebar
      ...[1, -1].map((s) => tint(new THREE.BoxGeometry(0.62, 0.11, 0.11).rotateZ(-0.55).translate(0.22, 1.26, s * 0.27), 0xffffff)),
    ]),
    rest: body([
      wheel(-0.55, 0, 0.33, 0.06),
      wheel(0.55, 0, 0.33, 0.06),
      painted(0.95, 0.07, 0.07, 0, 0.55, 0, frame),
      tint(new THREE.BoxGeometry(0.07, 0.6, 0.07).rotateZ(0.5).translate(0.4, 0.75, 0), frame),
      painted(0.07, 0.45, 0.07, -0.25, 0.75, 0, frame),
      painted(0.3, 0.22, 0.4, 0.72, 0.92, 0, 0x3a3d42),
      painted(0.05, 0.05, 0.55, 0.5, 1.08, 0, 0x2a2c30),
      // Legs pushing the pedals
      ...[1, -1].map((s) => limb(painted(0.12, 0.62, 0.12, -0.12, 0.6, s * 0.12, 0x2d3a4f), s, -0.12, 0.9)),
      painted(0.24, 0.24, 0.24, -0.02, 1.64, 0, SKIN),
      painted(0.26, 0.07, 0.26, -0.03, 1.78, 0, HAIR),
    ]),
  };
}

/** Turn each vertex of a swinging limb about its joint by the instance's stride angle (radians), in the shader. */
export function swingLimbs(m: THREE.Material): THREE.Material {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 swing;\nattribute float stride;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float swingAngle = stride * swing.x;
        vec2 fromJoint = transformed.xy - swing.yz;
        transformed.xy = swing.yz + vec2(fromJoint.x * cos(swingAngle) - fromJoint.y * sin(swingAngle), fromJoint.x * sin(swingAngle) + fromJoint.y * cos(swingAngle));`,
      );
  };
  return m;
}

/** Shares of men, women, elders and children out on a street. */
type Mix = [number, number, number, number];
const MIX_TOWN: Mix = [0.35, 0.35, 0.15, 0.15];
const MIX_SCHOOL: Mix = [0.15, 0.15, 0.1, 0.6];
const MIX_PARK: Mix = [0.12, 0.13, 0.4, 0.35];
const MIX_WORK: Mix = [0.46, 0.46, 0.04, 0.04];

/**
 * People walking and cycling along the sidewalks: men, women, elders and children, mixed by what the street is near
 * (children by schools, elders and children by parks, working adults among offices and shops); more where more people
 * live and work, fewer at night and in the rain; a few crossing each footbridge, and two officers on guard outside
 * each police station. Purely for looks; they don't affect the simulation.
 */
export class PedestrianLayer {
  readonly group = new THREE.Group();
  /** per kind of person: clothes (walker's colour) and the rest */
  private readonly clothes: THREE.InstancedMesh[] = [];
  private readonly rest: THREE.InstancedMesh[] = [];
  private readonly bikes: THREE.InstancedMesh;
  private readonly bikeFrames: THREE.InstancedMesh;
  private walkers: Walker[] = [];
  private mixes = new Map<number, Mix>();
  private mixKey = '';
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private c = new THREE.Color();
  private seed = 1;

  constructor(shadows: boolean) {
    // People walk by swinging their arms and legs in the shader, so they need no mesh per limb
    const mat = swingLimbs(new THREE.MeshLambertMaterial({ flatShading: true }));
    const fixed = swingLimbs(new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: true }));
    const shadow = swingLimbs(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
    for (const who of PEOPLE) {
      const g = figure(who);
      this.clothes.push(new THREE.InstancedMesh(g.clothes, mat, MAX));
      this.rest.push(new THREE.InstancedMesh(g.rest, fixed, MAX));
    }
    const bike = cyclist();
    this.bikes = new THREE.InstancedMesh(bike.clothes, mat, MAX);
    this.bikeFrames = new THREE.InstancedMesh(bike.rest, fixed, MAX);
    for (const m of [...this.clothes, ...this.rest, this.bikes, this.bikeFrames]) {
      m.geometry.setAttribute('stride', new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1));
      m.customDepthMaterial = shadow;
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = shadows;
      this.group.add(m);
    }
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** Streets with buildings along them, where people would be out walking. */
  private busyStreets(city: City): RoadSegment[] {
    const out: RoadSegment[] = [];
    for (const seg of city.net.segments.values()) {
      if (!city.net.isStreet(seg)) continue;
      const built = seg.lots.filter((l) => l.level > 0 && l.zone !== Zone.None).length;
      for (let i = 0; i < Math.min(6, Math.ceil(built / 4)); i++) out.push(seg);
    }
    return out;
  }

  /** Who walks a street: by a school, by a park, among offices and shops, or anywhere else. */
  private mixOf(city: City, seg: RoadSegment): Mix {
    const key = `${city.facilities.size}:${city.net.segments.size}`;
    if (key !== this.mixKey) {
      this.mixes.clear();
      this.mixKey = key;
    }
    let mix = this.mixes.get(seg.id);
    if (mix) return mix;
    const mid = seg.samples[Math.floor(seg.samples.length / 2)];
    const near = (kind: string, r: number) =>
      [...city.facilities.values()].some((f) => f.kind === kind && Math.hypot(f.p.x - mid.x, f.p.y - mid.y) < r);
    const built = seg.lots.filter((l) => l.level > 0 && l.zone !== Zone.None);
    const working = built.filter((l) => l.zone === Zone.Office || l.zone === Zone.Commercial).length;
    mix = near('school', 160) ? MIX_SCHOOL : near('park', 130) ? MIX_PARK : built.length && working / built.length > 0.5 ? MIX_WORK : MIX_TOWN;
    this.mixes.set(seg.id, mix);
    return mix;
  }

  private person(mix: Mix): Person {
    let r = this.rand();
    for (let i = 0; i < mix.length; i++) {
      r -= mix[i];
      if (r < 0) return i as Person;
    }
    return Person.Man;
  }

  private newWalker(city: City, seg: RoadSegment, bike: boolean): Walker {
    const who = bike ? Person.Man : this.person(this.mixOf(city, seg));
    const working = this.mixOf(city, seg) === MIX_WORK && who !== Person.Elder && who !== Person.Child;
    const palette = who === Person.Elder ? ELDER : who === Person.Child ? KIDS : working ? OFFICE : CLOTHES;
    const pace = who === Person.Elder ? 0.6 + this.rand() * 0.3 : who === Person.Child ? 1.2 + this.rand() * 0.6 : 1.1 + this.rand() * 0.6;
    return {
      seg: seg.id,
      s: this.rand() * seg.length,
      dir: this.rand() < 0.5 ? 1 : -1,
      side: this.rand() < 0.5 ? 1 : -1,
      speed: bike ? 3.5 + this.rand() * 2 : pace,
      color: palette[Math.floor(this.rand() * palette.length)],
      phase: this.rand() * 6,
      who,
      ...(bike ? { bike } : {}),
    };
  }

  update(city: City, dt: number, hour: number, rain: number): void {
    const net = city.net;
    // Fewer people out late at night and in the rain
    const night = hour < 5 ? 0.15 : hour < 7 ? 0.5 : hour >= 22 ? 0.35 : 1;
    const out = night * (1 - rain * 0.6);
    const wantWalkers = Math.min(MAX - 40, Math.round((city.stats.population / PER_RESIDENTS) * out));
    const wantBikes = Math.min(MAX - 40, Math.round((city.households.people.bike / PER_CYCLIST) * out));
    this.walkers = this.walkers.filter((w) => (w.bridge !== undefined ? city.facilities.has(w.bridge) : net.segments.has(w.seg)));
    for (const bike of [false, true]) {
      const want = bike ? wantBikes : wantWalkers;
      const mine = this.walkers.filter((w) => !!w.bike === bike && w.bridge === undefined);
      if (mine.length < want) {
        const streets = this.busyStreets(city);
        for (let k = 0, have = mine.length; k < 20 && streets.length && have < want; k++, have++) {
          this.walkers.push(this.newWalker(city, streets[Math.floor(this.rand() * streets.length)], bike));
        }
      } else if (mine.length > want + 20) {
        const drop = new Set(mine.slice(want));
        this.walkers = this.walkers.filter((w) => !drop.has(w));
      }
    }
    // Two people crossing each footbridge
    const bridges = [...city.facilities.values()].filter((f) => f.kind === 'footbridge');
    for (const f of bridges) {
      const on = this.walkers.filter((w) => w.bridge === f.id).length;
      for (let i = on; i < 2; i++) {
        this.walkers.push({ seg: -1, s: this.rand() * (f.span ?? 16), dir: i ? 1 : -1, side: 1, speed: 1.2, color: CLOTHES[(f.id + i) % CLOTHES.length], phase: 0, bridge: f.id, who: i ? Person.Woman : Person.Man });
      }
    }
    const counts = PEOPLE.map(() => 0);
    let nb = 0;
    const draw = (who: Person | 'bike', x: number, y: number, h: number, hx: number, hy: number, color: number, stride: number) => {
      this.q.setFromAxisAngle(this.up, Math.atan2(-hy, hx));
      this.p.set(x, h, y);
      this.m.compose(this.p, this.q, this.one);
      if (who === 'bike') {
        if (nb >= MAX) return;
        this.bikes.setMatrixAt(nb, this.m);
        this.bikeFrames.setMatrixAt(nb, this.m);
        this.setStride(this.bikeFrames, nb, stride);
        this.bikes.setColorAt(nb++, this.c.setHex(color));
        return;
      }
      const i = counts[who];
      if (i >= MAX) return;
      this.clothes[who].setMatrixAt(i, this.m);
      this.clothes[who].setColorAt(i, this.c.setHex(color));
      this.rest[who].setMatrixAt(i, this.m);
      this.setStride(this.clothes[who], i, stride);
      this.setStride(this.rest[who], i, stride);
      counts[who]++;
    };
    // Officers on guard either side of each police station's door
    for (const f of city.facilities.values()) {
      if (f.kind !== 'police') continue;
      const o = toWorld(f, 0, 0);
      const ahead = toWorld(f, 0, -1);
      for (const u of [-5, 5]) {
        const at = toWorld(f, u, -9.6);
        draw(Person.Police, at.x, at.y, 0.1, ahead.x - o.x, ahead.y - o.y, POLICE_BLUE, 0);
      }
    }
    for (const w of this.walkers) {
      w.s += w.speed * dt * w.dir;
      // A stride every metre or so, longer when cycling
      w.phase += dt * w.speed * (w.bike ? 1.6 : w.who === Person.Child ? 5.5 : 4.2);
      let x: number;
      let y: number;
      // Feet on the sidewalk
      let h = SIDEWALK;
      let hx: number;
      let hy: number;
      if (w.bridge !== undefined) {
        const f = city.facilities.get(w.bridge)!;
        const span = (f.span ?? 16) - 4.4;
        if (w.s > span) w.dir = -1;
        if (w.s < 0) w.dir = 1;
        const v = Math.max(0, Math.min(span, w.s)) - span / 2;
        const q = toWorld(f, w.dir * 0.8, v);
        const a = toWorld(f, 0, v + w.dir);
        x = q.x;
        y = q.y;
        h = 6.3;
        hx = a.x - toWorld(f, 0, v).x;
        hy = a.y - toWorld(f, 0, v).y;
      } else {
        let seg = net.segments.get(w.seg)!;
        if (w.s > seg.length || w.s < 0) {
          // Turn onto another street at the corner, or back the way they came
          const node = w.s > seg.length ? seg.b : seg.a;
          const next = [...net.segments.values()].filter((o) => o.id !== seg.id && (o.a === node || o.b === node) && net.isStreet(o));
          const o = next.length ? next[Math.floor(this.rand() * next.length)] : seg;
          if (o === seg) {
            w.dir = w.dir === 1 ? -1 : 1;
            w.s = Math.max(0, Math.min(seg.length, w.s));
          } else {
            w.seg = o.id;
            w.dir = o.a === node ? 1 : -1;
            w.s = w.dir === 1 ? 0 : o.length;
            seg = o;
          }
        }
        const off = w.side * (seg.walk ? asphaltWidth(seg) / 2 + 2.9 : (asphaltWidth(seg) + roadWidth(seg)) / 4);
        const S = seg.samples;
        let i = 1;
        while (i < S.length - 1 && S[i].s < w.s) i++;
        const a = S[i - 1];
        const b = S[i];
        const t = Math.max(0, Math.min(1, (w.s - a.s) / (b.s - a.s || 1)));
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const tx = (b.x - a.x) / l;
        const ty = (b.y - a.y) / l;
        x = a.x + (b.x - a.x) * t - ty * off;
        y = a.y + (b.y - a.y) * t + tx * off;
        hx = tx * w.dir;
        hy = ty * w.dir;
      }
      draw(w.bike ? 'bike' : w.who, x, y, h, hx, hy, w.color, Math.sin(w.phase) * (w.bike ? 0.5 : STRIDE[w.who]));
    }
    PEOPLE.forEach((who, k) => {
      this.clothes[who].count = counts[k];
      this.rest[who].count = counts[k];
    });
    this.bikes.count = nb;
    this.bikeFrames.count = nb;
    for (const m of [...this.clothes, ...this.rest, this.bikes, this.bikeFrames]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.geometry.getAttribute('stride').needsUpdate = true;
    }
  }

  private setStride(m: THREE.InstancedMesh, i: number, angle: number): void {
    (m.geometry.getAttribute('stride') as THREE.InstancedBufferAttribute).setX(i, angle);
  }
}

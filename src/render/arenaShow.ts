import * as THREE from 'three';
import { type Booking, type EventKind, eventEnd, expectedAttendance, matchup } from '../sim/events';
import type { Facility } from '../sim/facilities';
import { CLOTHES, ELDER, KIDS, Person, figure, swingLimbs } from './pedestrians';

const HOUR = 1 / 24;
/** Fans start lining up this long before the show, and the last are in shortly after it starts. */
const QUEUE_FROM = 3 * HOUR;
const QUEUE_TO = 0.3 * HOUR;
/** How long the crowd takes to stream out after it ends. */
export const EXIT_HOURS = 0.7;
const MAX = 700;
/** People in a queue: two abreast, this far apart, shuffling forward this fast (m/s). */
const QUEUE_GAP = 0.7;
const QUEUE_PACE = 0.3;
const WALK_PACE = 1.25;

type Path = [number, number][];
/** Queues from tail to door, in the arena's (u, v): down both sides to the side doors and along the back. */
const QUEUES: Path[] = [
  [
    [-26, -44.5],
    [-43.7, -44.5],
    [-43.7, -7.5],
  ],
  [
    [26, -44.5],
    [43.7, -44.5],
    [43.7, -7.5],
  ],
  [
    [-40, 44.2],
    [-5, 44.2],
    [-2.2, 41.8],
  ],
  [
    [40, 44.2],
    [5, 44.2],
    [2.2, 41.8],
  ],
];
/** Lanes of people walking from the street up the steps to the main door. */
const FRONT: Path[] = [-3.2, -1.6, 0, 1.6, 3.2].map((u) => [
  [u * 1.15, -45.5],
  [u * 0.45, -38.6],
]);
/** Where fans stand about by the stalls, tents and trucks, facing them, by kind of event. */
const STALLS: Record<EventKind, [number, number][]> = {
  concert: [
    [16, -42],
    [20.5, -42],
    [-9, -42.6],
  ],
  sports: [
    [13, -42],
    [18, -44],
    [-17, -42.6],
  ],
  festival: [
    [-20, -41.6],
    [16, -41.6],
    [22, -41.6],
  ],
};

interface Walk {
  len: number;
  /** cumulative length at each corner */
  at: number[];
  path: Path;
}
const walk = (path: Path): Walk => {
  const at = [0];
  for (let i = 1; i < path.length; i++) at.push(at[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  return { len: at[at.length - 1], at, path };
};
const QUEUE_WALKS = QUEUES.map(walk);
const FRONT_WALKS = FRONT.map(walk);

/** Point and heading `s` along a walk, pushed `side` to its right. */
function along(w: Walk, s: number, side: number): [number, number, number, number] {
  let i = 1;
  while (i < w.path.length - 1 && w.at[i] < s) i++;
  const [ax, ay] = w.path[i - 1];
  const [bx, by] = w.path[i];
  const l = w.at[i] - w.at[i - 1] || 1;
  const t = Math.max(0, Math.min(1, (s - w.at[i - 1]) / l));
  const tx = (bx - ax) / l;
  const ty = (by - ay) / l;
  return [ax + (bx - ax) * t - ty * side, ay + (by - ay) * t + tx * side, tx, ty];
}

/** A fixed random 0..1 for a person and a purpose. */
function hash(n: number, salt: number): number {
  let h = Math.imul(n ^ Math.imul(salt, 0x9e3779b1), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The crowd on the day: lines of fans down both sides and along the back to the doors, a stream up the front
 * steps, fans milling round the stalls through the show, and everyone streaming out when it ends. Longer lines for
 * a bigger crowd; concert-goers in the act's colours, sports fans in their team's.
 */
class Crowd {
  readonly group = new THREE.Group();
  private readonly clothes: THREE.InstancedMesh[] = [];
  private readonly rest: THREE.InstancedMesh[] = [];
  private readonly kinds = [Person.Man, Person.Woman, Person.Elder, Person.Child];
  private counts = [0, 0, 0, 0];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private c = new THREE.Color();
  private shuffle = 0;
  private stroll = 0;
  private fanColours: number[] = [];

  constructor() {
    const mat = swingLimbs(new THREE.MeshLambertMaterial({ flatShading: true }));
    const fixed = swingLimbs(new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: true }));
    for (const who of this.kinds) {
      const g = figure(who);
      this.clothes.push(new THREE.InstancedMesh(g.clothes, mat, MAX));
      this.rest.push(new THREE.InstancedMesh(g.rest, fixed, MAX));
    }
    for (const m of [...this.clothes, ...this.rest]) {
      m.geometry.setAttribute('stride', new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1));
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  dress(b: Booking): void {
    if (b.kind === 'concert') this.fanColours = [0xf0128f, 0x6a1fd1, 0x29d3ff, 0xffffff];
    else if (b.kind === 'sports') {
      const [[, hc], [, ac]] = matchup(b);
      this.fanColours = [parseInt(hc.slice(1), 16), parseInt(ac.slice(1), 16)];
    } else this.fanColours = [0xff6b6b, 0xf7b733, 0x0e9f8a, 0x4dabf7, 0xcc5de8];
  }

  private who(id: number, kind: EventKind): number {
    const r = hash(id, 1);
    const elders = kind === 'sports' ? 0.08 : 0.03;
    const kids = kind === 'concert' ? 0.04 : 0.08;
    return r < elders ? 2 : r < elders + kids ? 3 : r < elders + kids + (kind === 'sports' ? 0.5 : 0.42) ? 0 : 1;
  }

  private colour(id: number, who: number): number {
    if (who !== 2 && hash(id, 2) < 0.45) return this.fanColours[Math.floor(hash(id, 3) * this.fanColours.length)];
    const palette = who === 2 ? ELDER : who === 3 ? KIDS : CLOTHES;
    return palette[Math.floor(hash(id, 4) * palette.length)];
  }

  private draw(id: number, kind: EventKind, u: number, v: number, hu: number, hv: number, stride: number): void {
    const k = this.who(id, kind);
    const i = this.counts[k];
    if (i >= MAX) return;
    this.q.setFromAxisAngle(this.up, Math.atan2(-hv, hu));
    this.p.set(u, 0.12, v);
    this.m.compose(this.p, this.q, this.one);
    this.clothes[k].setMatrixAt(i, this.m);
    this.rest[k].setMatrixAt(i, this.m);
    this.clothes[k].setColorAt(i, this.c.setHex(this.colour(id, k)));
    for (const m of [this.clothes[k], this.rest[k]]) (m.geometry.getAttribute('stride') as THREE.InstancedBufferAttribute).setX(i, stride);
    this.counts[k]++;
  }

  /**
   * `queue` 0..1 how far down the lines reach, `arriving` and `leaving` 0..1 how busy the streams through the
   * doors are, `milling` 0..1 how many stand about the stalls.
   */
  update(kind: EventKind, dt: number, queue: number, arriving: number, leaving: number, milling: number): void {
    this.counts = [0, 0, 0, 0];
    this.shuffle += dt * QUEUE_PACE;
    this.stroll += dt * WALK_PACE;
    const stride = (t: number, amp: number) => Math.sin(t) * amp;
    if (queue > 0) {
      QUEUE_WALKS.forEach((w, q) => {
        const reach = w.len * queue;
        const moved = this.shuffle % QUEUE_GAP;
        const first = Math.floor(this.shuffle / QUEUE_GAP);
        for (let i = 0; i * QUEUE_GAP - moved < reach; i++) {
          const d = i * QUEUE_GAP - moved;
          if (d < 0) continue;
          for (const side of [-0.33, 0.33]) {
            // Who they are stays with them as the line moves up
            const id = q * 100003 + (i + first) * 2 + (side > 0 ? 1 : 0);
            const jitter = (hash(id, 5) - 0.5) * 0.25;
            const [u, v, hu, hv] = along(w, w.len - d + jitter, side);
            this.draw(id, kind, u, v, hu, hv, stride(this.shuffle * 9 + id, 0.12));
          }
        }
      });
    }
    const streams = (walks: Walk[], density: number, out: boolean, gap: number) => {
      if (density <= 0) return;
      walks.forEach((w, n) => {
        const first = Math.floor(this.stroll / gap);
        const moved = this.stroll % gap;
        for (let i = 0; i * gap - moved < w.len; i++) {
          const d = i * gap - moved;
          if (d < 0) continue;
          const id = 500009 * (out ? 2 : 1) + n * 7919 + i + first;
          if (hash(id, 6) > density) continue;
          const side = (hash(id, 7) - 0.5) * 0.9;
          const s = out ? d : w.len - d;
          const [u, v, hu, hv] = along(w, s, side);
          // Walking in: towards the door; out: away from it
          const dir = out ? -1 : 1;
          this.draw(id, kind, u, v, hu * dir, hv * dir, stride(this.stroll * 3.4 + id, 0.42));
        }
      });
    };
    streams(FRONT_WALKS, arriving, false, 1.1);
    streams(FRONT_WALKS, leaving, true, 0.8);
    // Out through every door, back along the lines' paths
    streams(QUEUE_WALKS, leaving * 0.8, true, 0.9);
    if (milling > 0) {
      STALLS[kind].forEach(([su, sv], n) => {
        for (let i = 0; i < 9; i++) {
          const id = 900001 + n * 31 + i;
          if (hash(id, 8) > milling) continue;
          const u = su + (hash(id, 9) - 0.5) * 4.4;
          const v = sv - hash(id, 10) * 2.4;
          this.draw(id, kind, u, v, (su - u) * 0.2, 1, 0);
        }
      });
    }
    this.kinds.forEach((_, k) => {
      for (const m of [this.clothes[k], this.rest[k]]) {
        m.count = this.counts[k];
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.geometry.getAttribute('stride').needsUpdate = true;
      }
    });
  }
}

/** The arena's roof and glass as in landmarks' arena(), a little proud of them, for the light show to play on. */
function domeShell(): THREE.BufferGeometry {
  const rx = 40;
  const ry = 34;
  const pos: number[] = [];
  const az: number[] = [];
  const ht: number[] = [];
  const idx: number[] = [];
  const n = 64;
  // Rings of (radius scale, height) from the foot of the glass to the crown
  const rings: [number, number, number][] = [
    [rx - 3, ry - 3, 5],
    [rx, ry, 16],
    [rx + 1, ry + 1, 17.5],
  ];
  for (let j = 1; j <= 10; j++) {
    const t = j / 10;
    const s = Math.cos((t * Math.PI) / 2);
    rings.push([(rx + 1) * s, (ry + 1) * s, 17.5 + 23 * Math.sin((t * Math.PI) / 2)]);
  }
  const lift = 0.35;
  rings.forEach(([a, b, z], j) => {
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2;
      pos.push(Math.cos(t) * (a + lift), z + lift, Math.sin(t) * (b + lift));
      az.push(i / n);
      ht.push((z - 5) / 36);
    }
    if (j === 0) return;
    for (let i = 0; i < n; i++) {
      const p = (j - 1) * (n + 1) + i;
      const q = j * (n + 1) + i;
      idx.push(p, q, p + 1, p + 1, q, q + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('az', new THREE.Float32BufferAttribute(az, 1));
  g.setAttribute('ht', new THREE.Float32BufferAttribute(ht, 1));
  g.setIndex(idx);
  return g;
}

const DOME_VERT = `
attribute float az;
attribute float ht;
varying float vAz;
varying float vHt;
void main() {
  vAz = az;
  vHt = ht;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** Concert: chasing bands of the act's colours; sports: the two teams' halves trading round; festival: a rainbow. */
const DOME_FRAG = `
uniform float uTime;
uniform float uAmp;
uniform int uMode;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
varying float vAz;
varying float vHt;
vec3 hue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}
void main() {
  float a = vAz * 6.2832;
  vec3 col;
  float glow;
  if (uMode == 0) {
    float band = sin(a * 6.0 - uTime * 2.2 + vHt * 9.0);
    col = mix(uA, uB, smoothstep(-0.3, 0.3, band));
    col = mix(col, uC, smoothstep(0.85, 1.0, sin(vHt * 18.0 - uTime * 4.0)));
    glow = 0.55 + 0.45 * sin(uTime * 5.0 + vHt * 4.0);
  } else if (uMode == 1) {
    float side = sin(a + uTime * 0.7);
    col = mix(uA, uB, smoothstep(-0.15, 0.15, side));
    glow = 0.6 + 0.4 * smoothstep(0.6, 1.0, sin(vHt * 14.0 - uTime * 3.0));
  } else {
    col = hue(fract(vAz * 2.0 + vHt * 0.6 - uTime * 0.12));
    glow = 0.65 + 0.35 * sin(a * 10.0 + uTime * 3.0);
  }
  gl_FragColor = vec4(col * glow * uAmp, 1.0);
}`;

const BEAM_LEN = 140;
const BEAM_VERT = `
varying float vAlong;
void main() {
  vAlong = position.y / ${BEAM_LEN.toFixed(1)};
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const BEAM_FRAG = `
uniform vec3 uColor;
uniform float uAmp;
varying float vAlong;
void main() {
  gl_FragColor = vec4(uColor * pow(1.0 - vAlong, 1.6) * uAmp * 0.35, 1.0);
}`;

const BURSTS = 8;
const SPARKS = 140;
const FIRE_VERT = `
uniform float uTime;
uniform float uAmp;
uniform float uScale;
uniform vec3 uCentres[${BURSTS}];
uniform vec3 uColours[${BURSTS}];
attribute vec3 dir;
attribute float burst;
varying vec3 vColour;
varying float vAlpha;
void main() {
  int b = int(burst);
  float t = fract(uTime / 3.2 + burst * 0.173);
  vec3 p = uCentres[b] + dir * 24.0 * (1.0 - exp(-t * 5.0)) - vec3(0.0, 10.0 * t * t, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uScale * 1.6 / -mv.z, 2.0, 9.0);
  vColour = mix(vec3(1.0, 0.95, 0.8), uColours[b], smoothstep(0.0, 0.25, t));
  vAlpha = (1.0 - t) * (1.0 - t) * uAmp;
}`;
const FIRE_FRAG = `
varying vec3 vColour;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  gl_FragColor = vec4(vColour * vAlpha, 1.0);
}`;

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } as const;

/**
 * The arena's light show after dark: the roof washed in moving colour, searchlights sweeping the sky from the roof
 * ring, and fireworks over it for the finale.
 */
class LightShow {
  readonly group = new THREE.Group();
  private readonly dome: THREE.ShaderMaterial;
  private readonly beams: THREE.Mesh[] = [];
  private readonly fire: THREE.ShaderMaterial;
  private readonly fireworks: THREE.Points;

  constructor() {
    this.dome = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uAmp: { value: 0 },
        uMode: { value: 0 },
        uA: { value: new THREE.Color() },
        uB: { value: new THREE.Color() },
        uC: { value: new THREE.Color() },
      },
      side: THREE.DoubleSide,
      ...additive,
    });
    this.group.add(new THREE.Mesh(domeShell(), this.dome));
    const cone = new THREE.ConeGeometry(7, BEAM_LEN, 14, 1, true);
    cone.rotateX(Math.PI);
    cone.translate(0, BEAM_LEN / 2, 0);
    for (let i = 0; i < 6; i++) {
      const beam = new THREE.Mesh(
        cone,
        new THREE.ShaderMaterial({
          vertexShader: BEAM_VERT,
          fragmentShader: BEAM_FRAG,
          uniforms: { uColor: { value: new THREE.Color() }, uAmp: { value: 0 } },
          side: THREE.DoubleSide,
          ...additive,
        }),
      );
      const a = (i / 6) * Math.PI * 2 + 0.3;
      beam.position.set(Math.cos(a) * 41, 17.6, Math.sin(a) * 35);
      beam.frustumCulled = false;
      this.beams.push(beam);
      this.group.add(beam);
    }
    const dirs: number[] = [];
    const ids: number[] = [];
    for (let b = 0; b < BURSTS; b++) {
      for (let i = 0; i < SPARKS; i++) {
        // Even-ish spread over a sphere
        const y = 1 - (2 * (i + 0.5)) / SPARKS;
        const r = Math.sqrt(1 - y * y);
        const t = i * 2.39996 + b;
        dirs.push(Math.cos(t) * r, y, Math.sin(t) * r);
        ids.push(b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(dirs.length), 3));
    g.setAttribute('dir', new THREE.Float32BufferAttribute(dirs, 3));
    g.setAttribute('burst', new THREE.Float32BufferAttribute(ids, 1));
    const centres = Array.from({ length: BURSTS }, (_, b) => {
      const a = b * 2.2;
      return new THREE.Vector3(Math.cos(a) * (18 + (b % 3) * 12), 55 + (b % 3) * 11, Math.sin(a) * (14 + (b % 2) * 10));
    });
    this.fire = new THREE.ShaderMaterial({
      vertexShader: FIRE_VERT,
      fragmentShader: FIRE_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uAmp: { value: 0 },
        uScale: { value: 600 },
        uCentres: { value: centres },
        uColours: { value: centres.map(() => new THREE.Color()) },
      },
      ...additive,
    });
    this.fireworks = new THREE.Points(g, this.fire);
    this.fireworks.frustumCulled = false;
    this.group.add(this.fireworks);
  }

  dress(b: Booking): void {
    const u = this.dome.uniforms;
    let colours: number[];
    if (b.kind === 'concert') {
      u.uMode.value = 0;
      colours = [0xf0128f, 0x6a1fd1, 0x29d3ff];
    } else if (b.kind === 'sports') {
      u.uMode.value = 1;
      const [[, hc], [, ac]] = matchup(b);
      colours = [parseInt(hc.slice(1), 16), parseInt(ac.slice(1), 16), 0xffd43b];
    } else {
      u.uMode.value = 2;
      colours = [0xff6b6b, 0xf7b733, 0x0e9f8a, 0x4dabf7, 0xcc5de8];
    }
    // Light adds to the dark roof, so a navy or maroon team colour is lifted until it shows
    const hsl = { h: 0, s: 0, l: 0 };
    const lit = (c: THREE.Color, hex: number) => {
      c.setHex(hex).getHSL(hsl);
      return hsl.l < 0.55 ? c.setHSL(hsl.h, hsl.s, 0.55) : c;
    };
    lit(u.uA.value as THREE.Color, colours[0]);
    lit(u.uB.value as THREE.Color, colours[1]);
    lit(u.uC.value as THREE.Color, colours[2]);
    this.beams.forEach((m, i) => ((m.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).setHex(b.kind === 'sports' ? 0xfff4d6 : colours[i % colours.length]));
    (this.fire.uniforms.uColours.value as THREE.Color[]).forEach((c, i) => lit(c, colours[i % colours.length]));
  }

  /** `amp` 0..1 how bright the roof and beams are, `finale` 0..1 the fireworks; `pixels` the screen's pixels per unit at one unit away. */
  update(time: number, amp: number, finale: number, pixels: number): void {
    this.group.visible = amp > 0.01;
    if (!this.group.visible) return;
    this.dome.uniforms.uTime.value = time;
    this.dome.uniforms.uAmp.value = amp * 0.75;
    this.beams.forEach((m, i) => {
      // Each light sweeps to and fro across its side of the sky, leaning out
      const out = Math.atan2(m.position.z, m.position.x);
      const yaw = out + Math.sin(time * 0.45 + i * 1.7) * 0.9;
      const lean = 0.35 + 0.2 * Math.sin(time * 0.31 + i);
      m.rotation.set(0, 0, 0);
      m.rotateY(-yaw);
      m.rotateZ(-lean);
      (m.material as THREE.ShaderMaterial).uniforms.uAmp.value = amp;
    });
    this.fireworks.visible = finale > 0.01;
    this.fire.uniforms.uTime.value = time;
    this.fire.uniforms.uAmp.value = finale;
    this.fire.uniforms.uScale.value = pixels;
  }
}

/**
 * What happens round the arena on an event's day: the crowd queuing, arriving, milling and going home, and after
 * dark the light show. Purely for looks.
 */
export class ArenaShow {
  readonly group = new THREE.Group();
  private readonly crowd = new Crowd();
  private readonly lights = new LightShow();
  private show = -1;
  private time = 0;

  constructor() {
    this.group.add(this.crowd.group, this.lights.group);
    this.group.visible = false;
  }

  update(f: Facility | null, b: Booking | undefined, day: number, dt: number, simDt: number, night: number, pixels: number): void {
    this.group.visible = !!f && !!b;
    if (!f || !b) return;
    if (b.id !== this.show) {
      this.show = b.id;
      this.crowd.dress(b);
      this.lights.dress(b);
    }
    this.group.position.set(f.p.x, 0, f.p.y);
    this.group.rotation.set(0, -f.angle, 0);
    this.time += dt;
    const end = eventEnd(b);
    // How full the night is: the real turnout once it starts, else what is expected
    const full = (b.attendance ?? expectedAttendance(b.capacity, b.keen)) / b.capacity;
    const size = 0.25 + 0.75 * Math.min(1, full);
    const lining = smooth(b.start - QUEUE_FROM, b.start - HOUR, day) * (1 - smooth(b.start, b.start + QUEUE_TO, day));
    const arriving = lining > 0 ? 0.35 + 0.65 * lining : 0;
    const leaving = day >= end ? 1 - smooth(end, end + EXIT_HOURS * HOUR, day) : 0;
    const milling = day >= b.start - QUEUE_FROM && day < end ? 0.7 : 0;
    this.crowd.update(b.kind, Math.min(simDt, 0.5), lining * size, arriving * size, leaving * size, milling * size);
    const lit = smooth(0.15, 0.6, night);
    const on = smooth(b.start - HOUR, b.start - 0.25 * HOUR, day) * (1 - smooth(end + 0.1 * HOUR, end + 0.5 * HOUR, day));
    const during = day >= b.start && day < end ? 1 : 0.6;
    // Fireworks over the last stretch: the encore, the final whistle, the festival's last act
    const tail = b.kind === 'festival' ? 1 : b.kind === 'concert' ? 0.5 : 0.25;
    const finale = smooth(end - tail * HOUR, end - tail * 0.8 * HOUR, day) * (1 - smooth(end + 0.05 * HOUR, end + 0.2 * HOUR, day));
    this.lights.update(this.time, lit * on * during, lit * finale, pixels);
  }
}

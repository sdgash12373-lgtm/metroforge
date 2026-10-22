import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { City } from '../sim/city';
import { toWorld } from '../sim/facilities';
import { type RoadSegment, asphaltWidth, roadWidth } from '../sim/roads';
import { Zone } from '../sim/zoning';

const MAX = 900;
/** One walker on the street per this many residents. */
const PER_RESIDENTS = 30;
const CLOTHES = [0xe4572e, 0x2e86ab, 0xf2f2f2, 0x3b3b3b, 0xf2b134, 0x6a994e, 0xa23b72, 0x4f8fd6, 0xd98ab0];

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
}

/** A little person, about 1.7 m tall, facing +x. */
function person(): THREE.BufferGeometry {
  const legs = new THREE.BoxGeometry(0.28, 0.8, 0.36).translate(0, 0.4, 0);
  const body = new THREE.BoxGeometry(0.32, 0.65, 0.5).translate(0, 1.12, 0);
  const head = new THREE.BoxGeometry(0.24, 0.24, 0.24).translate(0, 1.58, 0);
  return mergeGeometries([legs, body, head])!;
}

/**
 * People walking along the sidewalks: more where more people live and work, fewer at night and in the rain,
 * and a few crossing each footbridge. Purely for looks; they don't affect the simulation.
 */
export class PedestrianLayer {
  readonly mesh: THREE.InstancedMesh;
  private walkers: Walker[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private c = new THREE.Color();
  private seed = 1;

  constructor(shadows: boolean) {
    this.mesh = new THREE.InstancedMesh(person(), new THREE.MeshLambertMaterial({ flatShading: true }), MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadows;
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

  update(city: City, dt: number, hour: number, rain: number): void {
    const net = city.net;
    // Fewer people out late at night and in the rain
    const night = hour < 5 ? 0.15 : hour < 7 ? 0.5 : hour >= 22 ? 0.35 : 1;
    const want = Math.min(MAX - 40, Math.round((city.stats.population / PER_RESIDENTS) * night * (1 - rain * 0.6)));
    this.walkers = this.walkers.filter((w) => (w.bridge !== undefined ? city.facilities.has(w.bridge) : net.segments.has(w.seg)));
    if (this.walkers.length < want) {
      const streets = this.busyStreets(city);
      for (let k = 0; k < 20 && streets.length && this.walkers.length < want; k++) {
        const seg = streets[Math.floor(this.rand() * streets.length)];
        this.walkers.push({
          seg: seg.id,
          s: this.rand() * seg.length,
          dir: this.rand() < 0.5 ? 1 : -1,
          side: this.rand() < 0.5 ? 1 : -1,
          speed: 1.1 + this.rand() * 0.6,
          color: CLOTHES[Math.floor(this.rand() * CLOTHES.length)],
          phase: this.rand() * 6,
        });
      }
    } else if (this.walkers.length > want + 20) this.walkers.length = want;
    // Two people crossing each footbridge
    const bridges = [...city.facilities.values()].filter((f) => f.kind === 'footbridge');
    for (const f of bridges) {
      const on = this.walkers.filter((w) => w.bridge === f.id).length;
      for (let i = on; i < 2; i++) {
        this.walkers.push({ seg: -1, s: this.rand() * (f.span ?? 16), dir: i ? 1 : -1, side: 1, speed: 1.2, color: CLOTHES[(f.id + i) % CLOTHES.length], phase: 0, bridge: f.id });
      }
    }
    let n = 0;
    for (const w of this.walkers) {
      w.s += w.speed * dt * w.dir;
      w.phase += dt * 8;
      if (n >= MAX) break;
      let x: number;
      let y: number;
      let h = 0;
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
      this.q.setFromAxisAngle(this.up, Math.atan2(-hy, hx));
      this.p.set(x, h + 0.1 + Math.abs(Math.sin(w.phase)) * 0.06, y);
      this.m.compose(this.p, this.q, this.one);
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, this.c.setHex(w.color));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

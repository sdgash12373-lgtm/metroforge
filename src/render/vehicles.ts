import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type Traffic, type Vehicle, isTaxi } from '../sim/traffic';
import { GLASS, HEADLIGHT, TAILLIGHT, painted, shade, tint, wheel } from './kit';
import { PORTAL_DEPTH } from './roadMesh';

const MAX = 1200;
/** Popular colours on Taiwan's roads: pearl white, silver, black, grey, deep blue, red, and a few brighter ones */
const CAR_COLORS = [0xf2f2f0, 0xf2f2f0, 0xbfc4c9, 0x2b2d31, 0x6c7178, 0x23395d, 0xa3222a, 0x7a8f6a, 0xd8cbb0, 0x3f6f9a];
const TRUCK_COLORS = [0xf2f2f0, 0x2c6e91, 0x3f7f4a, 0xe0a030, 0xc0392b];
const TAXI_YELLOW = 0xf6c700;

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color = 0xffffff) => painted(w, h, d, x, y, z, color);
const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts)!;
const pair = (z: number, make: (z: number) => THREE.BufferGeometry) => [make(z), make(-z)];

/** A vehicle in two parts, long axis on +x, base at y = 0: paint takes the instance colour, trim keeps its own. */
interface Model {
  paint: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
}

const ARCH = 0x1b1d20;
const SEAM = 0x34373c;
const CHROME = 0xc9ccd0;

/** A black wheel arch over a wheel at x, on both sides of a body `half` wide: a lip over the top and down each side. */
function arches(x: number, r: number, half: number): THREE.BufferGeometry[] {
  const top = 2 * r + 0.06;
  return pair(half + 0.006, (z) =>
    merge([box(r * 2.7, 0.1, 0.03, x, top, z, ARCH), ...[-1, 1].map((s) => box(0.07, r + 0.02, 0.03, x + s * r * 1.32, top - r / 2, z, ARCH))]),
  );
}

/**
 * Wheels, lights, glass, and the lines that make a car read as one: black wheel arches, door seams and handles
 * down the body sides, and window frames (B-pillar, belt line, drip rail) round the glass. `cabin` is the box
 * the windows wrap, a touch proud of it; `body` is the lower body's half width and the height of its top.
 */
function carTrim(len: number, wheelbase: number, cabin: { w: number; h: number; d: number; x: number; y: number }, body: { half: number; top: number }, extra: THREE.BufferGeometry[] = []): THREE.BufferGeometry {
  const glassY = cabin.y + cabin.h * 0.05;
  const glassH = cabin.h * 0.75;
  const pillar = cabin.x + cabin.w * 0.05;
  const front = cabin.x + cabin.w / 2 - 0.02;
  const rear = cabin.x - cabin.w / 2 + 0.22;
  const seamH = body.top - 0.44;
  const seamY = 0.42 + seamH / 2;
  return merge([
    ...[-1, 1].flatMap((sx) => pair(0.78, (z) => wheel((sx * wheelbase) / 2, z, 0.34, 0.24))),
    ...[-1, 1].flatMap((sx) => arches((sx * wheelbase) / 2, 0.34, body.half)),
    box(cabin.w + 0.04, glassH, cabin.d + 0.04, cabin.x, glassY, 0, GLASS),
    // Window frames: belt line under the glass, drip rail over it, and the B-pillar between the doors
    box(cabin.w + 0.06, 0.05, cabin.d + 0.08, cabin.x, glassY - glassH / 2, 0, ARCH),
    box(cabin.w + 0.02, 0.035, cabin.d + 0.07, cabin.x, glassY + glassH / 2, 0, ARCH),
    box(0.1, glassH, cabin.d + 0.08, pillar, glassY, 0, ARCH),
    // Door seams and handles on both sides
    ...[front, pillar, rear].flatMap((x) => pair(body.half + 0.006, (z) => box(0.025, seamH, 0.02, x, seamY, z, SEAM))),
    ...[pillar + 0.18, rear + 0.16].flatMap((x) => pair(body.half + 0.01, (z) => box(0.16, 0.04, 0.025, x, body.top - 0.12, z, CHROME))),
    ...pair(0.62, (z) => box(0.08, 0.16, 0.36, len / 2, 0.75, z, HEADLIGHT)),
    ...pair(0.66, (z) => box(0.08, 0.16, 0.3, -len / 2, 0.8, z, TAILLIGHT)),
    box(0.1, 0.18, 1.7, len / 2 - 0.02, 0.38, 0, 0x2a2c30),
    box(0.1, 0.18, 1.7, -len / 2 + 0.02, 0.38, 0, 0x2a2c30),
    ...extra,
  ]);
}

/** Sedan, after the Toyota Corolla Altis: long, low, with a sloping boot. */
function sedan(): Model {
  return {
    paint: merge([box(4.6, 0.62, 1.8, 0, 0.62, 0), box(2.3, 0.56, 1.6, -0.15, 1.2, 0), box(1.2, 0.14, 1.76, 1.6, 0.98, 0), box(0.9, 0.1, 1.76, -1.85, 0.98, 0)]),
    trim: carTrim(4.6, 2.7, { w: 2.3, h: 0.56, d: 1.6, x: -0.15, y: 1.2 }, { half: 0.9, top: 0.93 }),
  };
}

/** Compact SUV, after the Corolla Cross and RAV4: taller, boxier, with roof rails and black wheel arches. */
function suv(): Model {
  return {
    paint: merge([box(4.45, 0.82, 1.84, 0, 0.75, 0), box(2.9, 0.66, 1.7, -0.3, 1.49, 0)]),
    trim: carTrim(4.45, 2.65, { w: 2.9, h: 0.66, d: 1.7, x: -0.3, y: 1.49 }, { half: 0.92, top: 1.16 }, [
      ...pair(0.62, (z) => box(2.4, 0.06, 0.06, -0.3, 1.86, z, 0x2a2c30)),
      ...[-1, 1].flatMap((sx) => pair(0.93, (z) => box(0.95, 0.16, 0.04, sx * 1.33, 0.7, z, 0x2a2c30))),
    ]),
  };
}

/** Hatchback, after the Yaris: short, with the roof running to a squared-off tail. */
function hatchback(): Model {
  return {
    paint: merge([box(3.95, 0.66, 1.72, 0, 0.62, 0), box(2.45, 0.58, 1.58, -0.45, 1.24, 0)]),
    trim: carTrim(3.95, 2.5, { w: 2.45, h: 0.58, d: 1.58, x: -0.45, y: 1.24 }, { half: 0.86, top: 0.95 }),
  };
}

/** Taiwan's yellow taxi: an Altis-sized sedan with a roof sign. */
function taxiSign(): THREE.BufferGeometry {
  return merge([box(0.35, 0.28, 0.9, -0.2, 1.62, 0, 0xffffff), box(0.37, 0.08, 0.92, -0.2, 1.52, 0, 0x2a2c30)]);
}

/** A whole yellow taxi in one vertex-coloured geometry, for the cabs waiting at an airport rank. */
export function taxiGeometry(): THREE.BufferGeometry {
  const car = sedan();
  return shade(merge([tint(car.paint, TAXI_YELLOW), car.trim, taxiSign()]));
}

/** A Gogoro-style scooter and its rider: the body and helmet take the instance colour. */
function scooter(): Model {
  return {
    paint: merge([box(0.95, 0.42, 0.42, -0.35, 0.62, 0), box(0.22, 0.75, 0.46, 0.55, 0.75, 0), box(0.3, 0.3, 0.3, -0.12, 1.72, 0)]),
    trim: merge([
      wheel(-0.62, 0, 0.27, 0.12),
      wheel(0.7, 0, 0.27, 0.12),
      box(0.65, 0.1, 0.4, 0.15, 0.42, 0, 0x2a2c30),
      box(0.75, 0.12, 0.36, -0.4, 0.88, 0, 0x2a2c30),
      box(0.05, 0.05, 0.62, 0.55, 1.18, 0, 0x2a2c30),
      box(0.06, 0.12, 0.2, 0.67, 1.0, 0, HEADLIGHT),
      box(0.06, 0.1, 0.24, -0.83, 0.72, 0, TAILLIGHT),
      box(0.26, 0.4, 0.34, -0.2, 0.75, 0, 0x2d3a4f),
      box(0.4, 0.62, 0.48, -0.18, 1.2, 0, 0x4a5563),
      box(0.22, 0.22, 0.22, -0.1, 1.6, 0, 0xe8c4a0),
    ]),
  };
}

/** A light box truck, after the Isuzu Elf and Hino 300: coloured cab, silver box, three axles' worth of wheels. */
function truck(): Model {
  return {
    paint: merge([box(1.9, 1.7, 2.2, 2.85, 1.35, 0), box(0.2, 0.5, 2.25, 3.8, 0.75, 0)]),
    trim: merge([
      box(5.6, 2.8, 2.4, -0.95, 1.95, 0, 0xe4e6e8),
      box(5.62, 0.2, 2.42, -0.95, 0.55, 0, 0x5b6066),
      box(0.06, 0.8, 2.0, 3.82, 1.75, 0, GLASS),
      ...pair(1.11, (z) => box(1.2, 0.6, 0.02, 2.95, 1.75, z, GLASS)),
      ...pair(0.75, (z) => box(0.06, 0.2, 0.3, 3.86, 0.75, z, HEADLIGHT)),
      ...[2.85, -1.6, -2.7].flatMap((x) => pair(1.0, (z) => wheel(x, z, 0.45, 0.32))),
      ...arches(2.85, 0.45, 1.1),
      // Cab door seams and window frames
      ...pair(1.106, (z) => box(0.03, 1.5, 0.02, 2.25, 1.25, z, SEAM)),
      ...pair(1.12, (z) => box(1.28, 0.05, 0.03, 2.95, 1.43, z, ARCH)),
      box(4, 0.25, 1.2, -0.5, 0.35, 0, 0x2a2c30),
    ]),
  };
}

/**
 * Taiwan's low-floor city bus: a white body with the line's colour on the skirt, roof and front,
 * deep window band, LED destination sign, and air-con pod on the roof.
 */
function bus(): Model {
  return {
    paint: merge([box(11.66, 0.55, 2.54, 0, 0.72, 0), box(11.2, 0.22, 2.4, 0, 3.1, 0), box(0.12, 0.7, 2.5, 5.82, 0.95, 0)]),
    trim: merge([
      box(11.6, 2.6, 2.5, 0, 1.75, 0, 0xf4f4f2),
      box(10.4, 1.15, 2.56, -0.4, 2.18, 0, GLASS),
      box(0.08, 1.5, 2.3, 5.82, 2.05, 0, GLASS),
      box(0.1, 0.32, 1.8, 5.84, 2.95, 0, 0xff9a1f),
      box(0.08, 1.3, 2.3, -5.82, 2.25, 0, GLASS),
      box(3.2, 0.4, 1.8, -1.5, 3.25, 0, 0xd9dbde),
      box(1.0, 2.0, 0.04, 3.9, 1.45, 1.26, 0x3b4148),
      ...pair(0.95, (z) => box(0.08, 0.2, 0.35, 5.84, 0.8, z, HEADLIGHT)),
      ...[3.7, -3.0].flatMap((x) => pair(1.05, (z) => wheel(x, z, 0.5, 0.32))),
      ...[3.7, -3.0].flatMap((x) => arches(x, 0.5, 1.25)),
      // Window pillars down both sides, a frame under the window band, and the door's split line
      ...Array.from({ length: 8 }, (_, i) => -5.2 + i * 1.3).flatMap((x) => pair(1.29, (z) => box(0.1, 1.15, 0.03, x, 2.18, z, ARCH))),
      ...pair(1.29, (z) => box(10.4, 0.06, 0.03, -0.4, 1.6, z, ARCH)),
      box(0.03, 2.0, 0.03, 3.9, 1.45, 1.285, ARCH),
    ]),
  };
}

/** Draws every vehicle as an instance, re-posed each frame. */
export class VehicleLayer {
  readonly group = new THREE.Group();
  /** one paint mesh and one trim mesh per model */
  private paint: THREE.InstancedMesh[] = [];
  private trim: THREE.InstancedMesh[] = [];
  private taxiSigns: THREE.InstancedMesh;
  /** red and blue lights flashing on patrol cars */
  private lightBars: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private c = new THREE.Color();

  constructor(shadows: boolean) {
    const mat = new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: true });
    const fixed = new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: true });
    const sizes = [MAX, MAX, MAX, MAX, MAX / 4, MAX / 8];
    [sedan(), suv(), hatchback(), scooter(), truck(), bus()].forEach((model, k) => {
      this.paint.push(new THREE.InstancedMesh(shade(model.paint), mat, sizes[k]));
      // Lights and trim keep more of their own colour than the paint
      this.trim.push(new THREE.InstancedMesh(shade(model.trim, 0.35), fixed, sizes[k]));
    });
    this.taxiSigns = new THREE.InstancedMesh(taxiSign(), fixed, MAX / 4);
    this.lightBars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.18, 1.3).translate(-0.2, 1.57, 0), new THREE.MeshBasicMaterial(), MAX / 8);
    for (const m of this.meshes()) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = shadows;
      this.group.add(m);
    }
  }

  private meshes(): THREE.InstancedMesh[] {
    return [...this.paint, ...this.trim, this.taxiSigns, this.lightBars];
  }

  /** `busColor` gives each bus its line colour. */
  update(traffic: Traffic, busColor: (v: Vehicle) => number): void {
    const counts = this.paint.map(() => 0);
    let taxis = 0;
    let l = 0;
    const flash = Math.floor(performance.now() / 350) % 2;
    for (const v of traffic.vehicles) {
      const pose = traffic.pose(v);
      if (!pose) continue;
      // Cars come in three body styles and some are taxis; the police drive sedans
      const style = Math.floor(((v.tint * 97) % 1) * 3);
      const taxi = isTaxi(v);
      const k = v.kind === 'scooter' ? 3 : v.kind === 'truck' ? 4 : v.kind === 'bus' ? 5 : v.kind === 'police' || taxi ? 0 : style;
      const i = counts[k];
      if (i >= this.paint[k].instanceMatrix.count) continue;
      this.q.setFromAxisAngle(this.up, Math.atan2(-pose.heading.y, pose.heading.x));
      // Wheels on the asphalt (drawn 7 cm up); ramps into tunnels are drawn at street level up to the portal
      this.p.set(pose.p.x, (pose.h > PORTAL_DEPTH ? Math.max(0, pose.h) : pose.h) + 0.07, pose.p.y);
      this.m.compose(this.p, this.q, this.one);
      this.paint[k].setMatrixAt(i, this.m);
      this.trim[k].setMatrixAt(i, this.m);
      counts[k]++;
      let color: number;
      if (v.kind === 'bus') color = busColor(v);
      else if (v.kind === 'police') {
        // Taiwanese patrol cars: white, with a flashing light bar
        color = 0xf5f5f5;
        if (l < this.lightBars.instanceMatrix.count) {
          this.lightBars.setMatrixAt(l, this.m);
          this.lightBars.setColorAt(l++, this.c.setHex((v.id + flash) % 2 ? 0xff2a2a : 0x2a6bff));
        }
      } else if (taxi) {
        color = TAXI_YELLOW;
        if (taxis < this.taxiSigns.instanceMatrix.count) this.taxiSigns.setMatrixAt(taxis++, this.m);
      } else {
        const palette = v.kind === 'truck' ? TRUCK_COLORS : CAR_COLORS;
        color = palette[Math.floor(v.tint * palette.length) % palette.length];
      }
      this.paint[k].setColorAt(i, this.c.setHex(color));
    }
    counts.forEach((n, k) => {
      this.paint[k].count = n;
      this.trim[k].count = n;
    });
    this.taxiSigns.count = taxis;
    this.lightBars.count = l;
    for (const m of this.meshes()) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

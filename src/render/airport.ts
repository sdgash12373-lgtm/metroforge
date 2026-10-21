import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type Airport, Aviation, GATE_Y, RUNWAY_LENGTH, RUNWAY_WIDTH, TAXI_Y, TERMINAL_DEPTH, TERMINAL_Y } from '../sim/airport';
import type { Vec2 } from '../sim/geometry';
import { Builder } from './roadMesh';

const GRASS = 0xb4cf8a;
const ASPHALT = 0x4f545b;
const APRON = 0xa9aca6;
const MARK = 0xf4f4f0;
const MAX_PLANES = 120;

/** Flat quads and boxes in an airport's own frame (x along the runways). */
class Field {
  constructor(
    private b: Builder,
    private a: Airport,
  ) {}

  private w(x: number, y: number): Vec2 {
    return Aviation.toWorld(this.a, { x, y });
  }

  rect(x0: number, y0: number, x1: number, y1: number, h: number, color: number): void {
    this.b.color = new THREE.Color(color);
    const p = [this.w(x0, y0), this.w(x1, y0), this.w(x0, y1), this.w(x1, y1)];
    this.b.quad([p[0].x, p[0].y, h], [p[1].x, p[1].y, h], [p[2].x, p[2].y, h], [p[3].x, p[3].y, h]);
  }

  box(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, color: number): void {
    this.b.color = new THREE.Color(color);
    const c = [this.w(x0, y0), this.w(x1, y0), this.w(x1, y1), this.w(x0, y1)];
    for (let k = 0; k < 4; k++) {
      const p = c[k];
      const q = c[(k + 1) % 4];
      this.b.quad([p.x, p.y, z1], [p.x, p.y, z0], [q.x, q.y, z1], [q.x, q.y, z0]);
    }
    this.b.quad([c[0].x, c[0].y, z1], [c[1].x, c[1].y, z1], [c[3].x, c[3].y, z1], [c[2].x, c[2].y, z1]);
  }
}

/** Runways, taxiways, apron, terminal and tower of every airport. */
export function buildAirportGeometry(airports: Iterable<Airport>): THREE.BufferGeometry {
  const b = new Builder(0);
  for (const a of airports) {
    const f = new Field(b, a);
    const e = Aviation.extent(a.runways);
    const L = RUNWAY_LENGTH / 2;
    f.rect(e.minX, e.minY, e.maxX, e.maxY, 0.03, GRASS);
    for (let k = 0; k < a.runways; k++) {
      const y = Aviation.runwayY(k);
      f.rect(-L, y - RUNWAY_WIDTH / 2, L, y + RUNWAY_WIDTH / 2, 0.08, ASPHALT);
      // Centre line dashes and threshold bars at both ends
      for (let x = -L + 40; x < L - 40; x += 30) f.rect(x, y - 0.5, x + 15, y + 0.5, 0.12, MARK);
      for (const end of [-1, 1]) {
        for (let i = -4; i <= 4; i++) {
          if (i === 0) continue;
          const yy = y + i * 3;
          const x0 = end * (L - 6);
          f.rect(Math.min(x0, x0 - end * 22), yy - 0.8, Math.max(x0, x0 - end * 22), yy + 0.8, 0.12, MARK);
        }
      }
      // Links from the runway ends to the taxiway
      for (const x of [-L - 20, L + 20]) f.rect(x - 9, y - 9, x + 9, TAXI_Y + 9, 0.07, ASPHALT);
      for (const x of [-L - 20, L + 20]) f.rect(Math.min(x, x < 0 ? -L : L), y - 9, Math.max(x, x < 0 ? -L : L), y + 9, 0.07, ASPHALT);
    }
    f.rect(-L - 29, TAXI_Y - 9, L + 29, TAXI_Y + 9, 0.07, ASPHALT);
    for (let x = -L - 20; x < L + 20; x += 12) f.rect(x, TAXI_Y - 0.25, x + 6, TAXI_Y + 0.25, 0.11, 0xf2c230);
    // Apron with a stand for every gate
    const half = (Aviation.gates(a) * 34) / 2 + 20;
    f.rect(-half, TAXI_Y + 9, half, TERMINAL_Y, 0.06, APRON);
    for (let g = 0; g < Aviation.gates(a); g++) {
      const x = Aviation.gateX(a, g);
      f.rect(x - 0.3, TAXI_Y, x + 0.3, GATE_Y + 8, 0.1, 0xf2c230);
      // Jet bridge
      f.box(x + 4, GATE_Y + 10, x + 7, TERMINAL_Y, 4, 6.5, 0xdfe3e6);
    }
    // Terminal: concrete base, glass band, white roof
    f.box(-half + 6, TERMINAL_Y, half - 6, TERMINAL_Y + TERMINAL_DEPTH, 0, 4, 0xd9d6cf);
    f.box(-half + 6, TERMINAL_Y, half - 6, TERMINAL_Y + TERMINAL_DEPTH, 4, 11, 0x8fb8cc);
    f.box(-half + 2, TERMINAL_Y - 4, half - 2, TERMINAL_Y + TERMINAL_DEPTH + 2, 11, 12.5, 0xf2f2ef);
    // Control tower
    const tx = half + 40;
    const ty = TERMINAL_Y + 12;
    f.box(tx - 3, ty - 3, tx + 3, ty + 3, 0, 34, 0xe6e3dc);
    f.box(tx - 6, ty - 6, tx + 6, ty + 6, 34, 39, 0x5e7f90);
    f.box(tx - 6.5, ty - 6.5, tx + 6.5, ty + 6.5, 39, 40, 0xf2f2ef);
    // Car park and the road in
    f.rect(-half, TERMINAL_Y + TERMINAL_DEPTH + 2, half, e.maxY - 2, 0.06, 0x6a6f75);
  }
  return b.geometry();
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

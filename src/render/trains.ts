import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RailKind, RailSystem } from '../sim/rail';
import { TRAIN_CARS } from '../sim/traffic';
import { PORTAL_DEPTH } from './roadMesh';

const MAX_CARS = 240;
const BODY: Record<RailKind, number> = { metro: 0xd9dde2, train: 0xe8e4da, hsr: 0xf6f6f4 };
const SIZE: Record<RailKind, { w: number; h: number }> = {
  metro: { w: 2.9, h: 3.2 },
  train: { w: 3, h: 3.6 },
  hsr: { w: 3.2, h: 3.4 },
};
/** Gap between cars. */
const GAP = 0.6;

/** Every train drawn car by car, each car following the track behind the one in front. */
export class TrainLayer {
  readonly group = new THREE.Group();
  private bodies: THREE.InstancedMesh;
  private bands: THREE.InstancedMesh;
  private noses: THREE.InstancedMesh | null = null;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private c = new THREE.Color();
  private carLength: number;

  constructor(
    readonly kind: RailKind,
    shadows: boolean,
  ) {
    const spec = TRAIN_CARS[kind]!;
    const { w, h } = SIZE[kind];
    this.carLength = spec.length - GAP;
    const L = this.carLength;
    const body = new THREE.BoxGeometry(L, h, w).translate(0, h / 2 + 0.6, 0);
    // Window band in the line colour, a touch proud of the body
    const band = mergeGeometries([
      new THREE.BoxGeometry(L - 0.4, 0.9, w + 0.06).translate(0, h * 0.62 + 0.6, 0),
      new THREE.BoxGeometry(L - 0.4, 0.25, w + 0.06).translate(0, 1.3, 0),
    ])!;
    this.bodies = new THREE.InstancedMesh(body, new THREE.MeshLambertMaterial({ color: BODY[kind], flatShading: true }), MAX_CARS);
    this.bands = new THREE.InstancedMesh(band, new THREE.MeshLambertMaterial({ flatShading: true }), MAX_CARS);
    const meshes = [this.bodies, this.bands];
    if (kind === 'hsr') {
      // Long sloping nose on the end cars
      const nose = new THREE.ConeGeometry(w / 2, 7, 4, 1).rotateY(Math.PI / 4).rotateZ(-Math.PI / 2).scale(1, h / w, 1).translate(L / 2 + 3.5, h / 2 + 0.4, 0);
      this.noses = new THREE.InstancedMesh(nose, new THREE.MeshLambertMaterial({ color: BODY[kind], flatShading: true }), 80);
      meshes.push(this.noses);
    }
    for (const m of meshes) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = shadows;
      this.group.add(m);
    }
  }

  update(sys: RailSystem): void {
    const cars = TRAIN_CARS[this.kind]!;
    let n = 0;
    let noses = 0;
    for (const v of sys.traffic.vehicles) {
      const color = sys.transit.lines.get(v.line ?? -1)?.color ?? 0x9aa5b1;
      for (let k = 0; k < cars.cars && n < MAX_CARS; k++) {
        const front = sys.traffic.poseBack(v, k * cars.length);
        const back = sys.traffic.poseBack(v, k * cars.length + this.carLength);
        if (!front || !back) continue;
        const hx = front.p.x - back.p.x;
        const hy = front.p.y - back.p.y;
        const h = (front.h + back.h) / 2;
        this.q.setFromAxisAngle(this.up, Math.atan2(-hy, hx));
        // Ramps into tunnels are drawn at street level up to the portal
        this.p.set((front.p.x + back.p.x) / 2, (h > PORTAL_DEPTH ? Math.max(0, h) : h) + 0.1, (front.p.y + back.p.y) / 2);
        this.m.compose(this.p, this.q, this.one);
        this.bodies.setMatrixAt(n, this.m);
        this.bands.setMatrixAt(n, this.m);
        this.bands.setColorAt(n, this.c.setHex(color));
        n++;
        if (this.noses && (k === 0 || k === cars.cars - 1) && noses < 80) {
          // The last car's nose points backwards
          if (k > 0) this.m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
          this.noses.setMatrixAt(noses++, this.m);
        }
      }
    }
    this.bodies.count = n;
    this.bands.count = n;
    if (this.noses) this.noses.count = noses;
    for (const m of [this.bodies, this.bands, this.noses]) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

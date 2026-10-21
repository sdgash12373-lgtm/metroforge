import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Traffic } from '../sim/traffic';

const MAX = 1200;
const CAR_COLORS = [0xe4572e, 0x2e86ab, 0xf2f2f2, 0x3b3b3b, 0xf2b134, 0x6a994e, 0xa23b72, 0x9aa5b1];
const TRUCK_COLORS = [0xd9d9d9, 0xc0392b, 0x2c6e91, 0xe0a030];

/** Low-poly boxes with their long axis on +x, base at y = 0. */
function car(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(4.2, 0.9, 1.8).translate(0, 0.55, 0);
  const cabin = new THREE.BoxGeometry(2.2, 0.7, 1.6).translate(-0.2, 1.35, 0);
  return mergeGeometries([body, cabin])!;
}

function truck(): THREE.BufferGeometry {
  const cab = new THREE.BoxGeometry(2, 2.2, 2.3).translate(2.8, 1.4, 0);
  const box = new THREE.BoxGeometry(5.4, 2.8, 2.4).translate(-1, 1.7, 0);
  return mergeGeometries([cab, box])!;
}

/** Draws every vehicle as an instance, re-posed each frame. */
export class VehicleLayer {
  readonly group = new THREE.Group();
  private cars: THREE.InstancedMesh;
  private trucks: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private c = new THREE.Color();

  constructor(shadows: boolean) {
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.cars = new THREE.InstancedMesh(car(), mat, MAX);
    this.trucks = new THREE.InstancedMesh(truck(), mat, MAX / 4);
    for (const m of [this.cars, this.trucks]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = shadows;
      this.group.add(m);
    }
  }

  update(traffic: Traffic): void {
    let c = 0;
    let t = 0;
    for (const v of traffic.vehicles) {
      const pose = traffic.pose(v);
      if (!pose) continue;
      const mesh = v.kind === 'truck' ? this.trucks : this.cars;
      const i = v.kind === 'truck' ? t : c;
      if (i >= mesh.instanceMatrix.count) continue;
      this.q.setFromAxisAngle(this.up, Math.atan2(-pose.heading.y, pose.heading.x));
      this.p.set(pose.p.x, 0.1, pose.p.y);
      this.m.compose(this.p, this.q, this.one);
      mesh.setMatrixAt(i, this.m);
      const palette = v.kind === 'truck' ? TRUCK_COLORS : CAR_COLORS;
      mesh.setColorAt(i, this.c.setHex(palette[Math.floor(v.tint * palette.length) % palette.length]));
      if (v.kind === 'truck') t++;
      else c++;
    }
    this.cars.count = c;
    this.trucks.count = t;
    for (const m of [this.cars, this.trucks]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

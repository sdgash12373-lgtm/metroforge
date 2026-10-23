import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Traffic, Vehicle } from '../sim/traffic';
import { PORTAL_DEPTH } from './roadMesh';

const MAX = 1200;
const CAR_COLORS = [0xe4572e, 0x2e86ab, 0xf2f2f2, 0x3b3b3b, 0xf2b134, 0x6a994e, 0xa23b72, 0x9aa5b1];
const TRUCK_COLORS = [0xd9d9d9, 0xc0392b, 0x2c6e91, 0xe0a030];

/** Low-poly boxes with their long axis on +x, base at y = 0. */
function car(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(4.2, 0.9, 1.8).translate(0, 0.55, 0);
  const cabin = new THREE.BoxGeometry(2.2, 0.7, 1.6).translate(-0.2, 1.35, 0);
  return mergeGeometries([body, cabin])!;
}

/** A scooter and its rider. */
function scooter(): THREE.BufferGeometry {
  const deck = new THREE.BoxGeometry(1.7, 0.45, 0.55).translate(0, 0.45, 0);
  const front = new THREE.BoxGeometry(0.3, 0.9, 0.5).translate(0.7, 0.9, 0);
  const rider = new THREE.BoxGeometry(0.45, 0.75, 0.5).translate(-0.15, 1.15, 0);
  const helmet = new THREE.BoxGeometry(0.3, 0.3, 0.3).translate(-0.1, 1.68, 0);
  return mergeGeometries([deck, front, rider, helmet])!;
}

function truck(): THREE.BufferGeometry {
  const cab = new THREE.BoxGeometry(2, 2.2, 2.3).translate(2.8, 1.4, 0);
  const box = new THREE.BoxGeometry(5.4, 2.8, 2.4).translate(-1, 1.7, 0);
  return mergeGeometries([cab, box])!;
}

function bus(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(11.6, 2.5, 2.5).translate(0, 1.65, 0);
}

/** Dark glass band around the bus, slightly proud of the body. */
function busWindows(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(11, 0.9, 2.56).translate(0.1, 2.1, 0);
}

/** Draws every vehicle as an instance, re-posed each frame. */
export class VehicleLayer {
  readonly group = new THREE.Group();
  private cars: THREE.InstancedMesh;
  private trucks: THREE.InstancedMesh;
  private scooters: THREE.InstancedMesh;
  private buses: THREE.InstancedMesh;
  private windows: THREE.InstancedMesh;
  /** red and blue lights flashing on patrol cars */
  private lightBars: THREE.InstancedMesh;
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
    this.scooters = new THREE.InstancedMesh(scooter(), mat, MAX);
    this.buses = new THREE.InstancedMesh(bus(), mat, MAX / 8);
    this.windows = new THREE.InstancedMesh(busWindows(), new THREE.MeshLambertMaterial({ color: 0x2b3a46 }), MAX / 8);
    this.lightBars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.18, 1.3).translate(-0.2, 1.8, 0), new THREE.MeshBasicMaterial(), MAX / 8);
    for (const m of [this.cars, this.scooters, this.trucks, this.buses, this.windows, this.lightBars]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = shadows;
      this.group.add(m);
    }
  }

  /** `busColor` gives each bus its line colour. */
  update(traffic: Traffic, busColor: (v: Vehicle) => number): void {
    let c = 0;
    let t = 0;
    let b = 0;
    let s = 0;
    let l = 0;
    const flash = Math.floor(performance.now() / 350) % 2;
    for (const v of traffic.vehicles) {
      const pose = traffic.pose(v);
      if (!pose) continue;
      const mesh = v.kind === 'truck' ? this.trucks : v.kind === 'bus' ? this.buses : v.kind === 'scooter' ? this.scooters : this.cars;
      const i = v.kind === 'truck' ? t : v.kind === 'bus' ? b : v.kind === 'scooter' ? s : c;
      if (i >= mesh.instanceMatrix.count) continue;
      this.q.setFromAxisAngle(this.up, Math.atan2(-pose.heading.y, pose.heading.x));
      // Ramps into tunnels are drawn at street level up to the portal
      this.p.set(pose.p.x, (pose.h > PORTAL_DEPTH ? Math.max(0, pose.h) : pose.h) + 0.1, pose.p.y);
      this.m.compose(this.p, this.q, this.one);
      mesh.setMatrixAt(i, this.m);
      if (v.kind === 'bus') {
        this.windows.setMatrixAt(i, this.m);
        mesh.setColorAt(i, this.c.setHex(busColor(v)));
        b++;
        continue;
      }
      if (v.kind === 'police') {
        // Taiwanese patrol cars: white, with a flashing light bar
        mesh.setColorAt(i, this.c.setHex(0xf5f5f5));
        if (l < this.lightBars.instanceMatrix.count) {
          this.lightBars.setMatrixAt(l, this.m);
          this.lightBars.setColorAt(l++, this.c.setHex((v.id + flash) % 2 ? 0xff2a2a : 0x2a6bff));
        }
        c++;
        continue;
      }
      const palette = v.kind === 'truck' ? TRUCK_COLORS : CAR_COLORS;
      mesh.setColorAt(i, this.c.setHex(palette[Math.floor(v.tint * palette.length) % palette.length]));
      if (v.kind === 'truck') t++;
      else if (v.kind === 'scooter') s++;
      else c++;
    }
    this.cars.count = c;
    this.trucks.count = t;
    this.scooters.count = s;
    this.buses.count = b;
    this.windows.count = b;
    this.lightBars.count = l;
    for (const m of [this.cars, this.scooters, this.trucks, this.buses, this.windows, this.lightBars]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { City } from '../sim/city';
import { FACILITIES, toWorld } from '../sim/facilities';
import { WATER_LEVEL } from '../sim/terrain';

const MAX_SHIPS = 32;
/** How far out to sea a ship sails before turning back, meters. */
const VOYAGE = 900;
/** Seconds of game time for a round trip, at normal speed. */
const ROUND_TRIP = { cargoPort: 260, cruisePort: 150 };

/** A box coloured per vertex, so a whole ship is one geometry. */
function part(w: number, h: number, d: number, x: number, y: number, z: number, color: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z).toNonIndexed();
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** A container ship, bow along +x: dark hull, red boot top, white bridge aft and a deck of containers. */
function containerShip(): THREE.BufferGeometry {
  const parts = [
    part(84, 6, 16, 0, -3, 0, 0x23324a),
    part(84.2, 2, 16.2, 0, -3.2, 0, 0xa8322a),
    part(8, 5, 10, 46, -2, 0, 0x23324a),
    part(10, 13, 14, -36, 3, 0, 0xf2f3f4),
    part(10.2, 1, 14.2, -36, 13.5, 0, 0x2f3f5a),
    part(4, 7, 6, -40, 10, 0, 0xd9343a),
  ];
  const colors = [0xc8442f, 0x2f5fa8, 0x3f8f5a, 0xe08a2e, 0x8d8a85, 0x1f7f8f];
  for (let i = 0; i < 9; i++) {
    const tiers = 2 + ((i * 7) % 3);
    for (let t = 0; t < tiers; t++) parts.push(part(6, 2.5, 13, -26 + i * 7, 3 + t * 2.6, 0, colors[(i + t * 2) % colors.length]));
  }
  return mergeGeometries(parts)!;
}

/** A Xiaoliuqiu ferry: white hull with a blue stripe and a two-deck cabin. */
function ferry(): THREE.BufferGeometry {
  return mergeGeometries([
    part(24, 3, 6, 0, -1.5, 0, 0xf5f5f5),
    part(3, 2.4, 4, 13, -1, 0, 0xf5f5f5),
    part(24.1, 0.7, 6.1, 0, -0.3, 0, 0x1f5fa8),
    part(15, 2.6, 4.8, -1.5, 1.5, 0, 0xf2f3f4),
    part(15.1, 1, 4.9, -1.5, 2.3, 0, 0x2a3a4a),
    part(9, 2, 4, -3, 4.1, 0, 0xf2f3f4),
    part(9.1, 0.8, 4.1, -3, 4.7, 0, 0x2a3a4a),
  ])!;
}

interface Route {
  kind: 'cargoPort' | 'cruisePort';
  /** where the ship leaves from, just off the berth */
  x: number;
  z: number;
  /** heading out to sea (unit) */
  dx: number;
  dz: number;
  /** where in its round trip it starts, 0..1 */
  offset: number;
}

/** Ships sailing out from each port to sea and back: container ships for cargo ports, ferries for cruise ports. */
export class ShipLayer {
  readonly group = new THREE.Group();
  private meshes: Record<Route['kind'], THREE.InstancedMesh>;
  private routes: Route[] = [];
  private version = -1;
  private time = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private counts = { cargoPort: 0, cruisePort: 0 };

  constructor(shadows: boolean) {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.meshes = {
      cargoPort: new THREE.InstancedMesh(containerShip(), material, MAX_SHIPS),
      cruisePort: new THREE.InstancedMesh(ferry(), material, MAX_SHIPS),
    };
    for (const m of Object.values(this.meshes)) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = shadows;
      this.group.add(m);
    }
  }

  /** Forgets the routes, so the next update reads the ports afresh (another city was loaded). */
  invalidate(): void {
    this.version = -1;
  }

  /** Moves the ships on by `dt` seconds of game time, picking up ports built or knocked down. */
  update(city: City, dt: number): void {
    if (city.facilitiesVersion !== this.version) {
      this.version = city.facilitiesVersion;
      this.routes = [];
      for (const f of city.facilities.values()) {
        if (f.kind !== 'cargoPort' && f.kind !== 'cruisePort') continue;
        const { d } = FACILITIES[f.kind];
        const from = toWorld(f, 0, d / 2 + (f.kind === 'cargoPort' ? 30 : 16));
        // The port's depth axis points out to sea
        const out = toWorld(f, 0, 1);
        const len = Math.hypot(out.x - f.p.x, out.y - f.p.y) || 1;
        this.routes.push({ kind: f.kind, x: from.x, z: from.y, dx: (out.x - f.p.x) / len, dz: (out.y - f.p.y) / len, offset: (f.id * 0.37) % 1 });
      }
    }
    this.time += dt;
    const n = this.counts;
    n.cargoPort = 0;
    n.cruisePort = 0;
    for (const r of this.routes) {
      const mesh = this.meshes[r.kind];
      if (n[r.kind] >= MAX_SHIPS) continue;
      // Out to sea, a while over the horizon, then back in; turned to face the way it goes
      const phase = (this.time / ROUND_TRIP[r.kind] + r.offset) % 1;
      if (phase > 0.42 && phase < 0.58) continue;
      const back = phase >= 0.58;
      const t = back ? (1 - phase) / 0.42 : phase / 0.42;
      const eased = t * t * (3 - 2 * t);
      const along = 40 + eased * VOYAGE;
      const sx = r.dx * (back ? -1 : 1);
      const sz = r.dz * (back ? -1 : 1);
      this.q.setFromAxisAngle(this.up, Math.atan2(-sz, sx));
      this.p.set(r.x + r.dx * along, WATER_LEVEL, r.z + r.dz * along);
      this.m.compose(this.p, this.q, this.one);
      mesh.setMatrixAt(n[r.kind]++, this.m);
    }
    this.meshes.cargoPort.count = n.cargoPort;
    this.meshes.cruisePort.count = n.cruisePort;
    this.meshes.cargoPort.instanceMatrix.needsUpdate = true;
    this.meshes.cruisePort.instanceMatrix.needsUpdate = true;
  }
}

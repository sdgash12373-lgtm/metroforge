import * as THREE from 'three';
import type { City } from '../sim/city';
import { quadPoint, quadTangent, tAtLength } from '../sim/geometry';
import { roadWidth } from '../sim/roads';
import type { BusStop } from '../sim/transit';

const MAX_STOPS = 400;
const PEOPLE_PER_STOP = 8;

/** Bus shelters at the kerb, coloured by their line, with a few people waiting under them. */
export class StopLayer {
  readonly group = new THREE.Group();
  private shelters: THREE.InstancedMesh;
  private roofs: THREE.InstancedMesh;
  private people: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private c = new THREE.Color();
  private spots: { x: number; z: number; angle: number; stop: BusStop }[] = [];

  constructor(shadows: boolean) {
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    // Back wall and two side panels, open to the road
    const back = new THREE.BoxGeometry(3.2, 2.4, 0.15).translate(0, 1.2, 0.6);
    const sideA = new THREE.BoxGeometry(0.15, 2.4, 1.2).translate(-1.55, 1.2, 0);
    const sideB = sideA.clone().translate(3.1, 0, 0);
    const shelter = new THREE.BufferGeometry();
    const parts = [back, sideA, sideB];
    const pos: number[] = [];
    const nor: number[] = [];
    for (const g of parts) {
      const ng = g.toNonIndexed();
      pos.push(...(ng.getAttribute('position').array as Float32Array));
      nor.push(...(ng.getAttribute('normal').array as Float32Array));
    }
    shelter.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    shelter.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    this.shelters = new THREE.InstancedMesh(shelter, new THREE.MeshLambertMaterial({ color: 0xdfe6ea }), MAX_STOPS);
    this.roofs = new THREE.InstancedMesh(new THREE.BoxGeometry(3.6, 0.25, 1.8).translate(0, 2.5, 0.1), mat, MAX_STOPS);
    this.people = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.25, 0.3, 1.7, 6).translate(0, 0.85, 0),
      new THREE.MeshLambertMaterial({ color: 0x4a4f57, flatShading: true }),
      MAX_STOPS * PEOPLE_PER_STOP,
    );
    for (const mesh of [this.shelters, this.roofs, this.people]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = shadows;
      this.group.add(mesh);
    }
  }

  /** Re-places the shelters; call when stops or roads change. */
  rebuild(city: City): void {
    this.spots = [];
    const lineOf = new Map<number, number>();
    for (const l of city.transit.lines.values()) for (const id of l.stops) if (!lineOf.has(id)) lineOf.set(id, l.color);
    let i = 0;
    for (const stop of city.transit.stops.values()) {
      const seg = stop.at && city.net.segments.get(stop.at.seg);
      if (!seg || !stop.at || i >= MAX_STOPS) continue;
      const q = city.net.quad(seg);
      const t = tAtLength(seg.samples, stop.at.s);
      const p = quadPoint(q, t);
      const d = quadTangent(q, t);
      // Kerbside on the right of a → b traffic, facing the road
      const off = roadWidth(seg) / 2 + 1.1;
      const x = p.x - d.y * off;
      const z = p.y + d.x * off;
      const angle = Math.atan2(-d.y, d.x);
      this.q.setFromAxisAngle(this.up, angle);
      this.p.set(x, 0, z);
      this.m.compose(this.p, this.q, this.one);
      this.shelters.setMatrixAt(i, this.m);
      this.roofs.setMatrixAt(i, this.m);
      this.roofs.setColorAt(i, this.c.setHex(lineOf.get(stop.id) ?? 0x9aa5b1));
      this.spots.push({ x, z, angle, stop });
      i++;
    }
    this.shelters.count = i;
    this.roofs.count = i;
    for (const mesh of [this.shelters, this.roofs]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.updatePeople(city);
  }

  /** One figure per few people waiting, so busy stops are easy to spot. */
  updatePeople(city: City): void {
    let n = 0;
    for (const s of this.spots) {
      const waiting = city.transit.waitingAt(s.stop);
      const shown = Math.min(PEOPLE_PER_STOP, Math.ceil(waiting / 4));
      const cos = Math.cos(s.angle);
      const sin = Math.sin(s.angle);
      for (let k = 0; k < shown; k++) {
        // Row along the kerb, in front of the shelter
        const u = (k - (PEOPLE_PER_STOP - 1) / 2) * 0.75;
        const v = -0.6 - (k % 2) * 0.5;
        this.p.set(s.x + cos * u + sin * v, 0, s.z - sin * u + cos * v);
        this.m.makeTranslation(this.p.x, 0, this.p.z);
        this.people.setMatrixAt(n++, this.m);
      }
    }
    this.people.count = n;
    this.people.instanceMatrix.needsUpdate = true;
  }
}

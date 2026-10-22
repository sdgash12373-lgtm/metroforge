import * as THREE from 'three';
import type { City } from '../sim/city';
import { CELL, type Lot, ZONES, Zone } from '../sim/zoning';

const MAX = 20000;

/** Triangular prism for gable roofs: 1 × 1 footprint, ridge along x, height 1, base at y = 0. */
function gableGeometry(): THREE.BufferGeometry {
  const v = [
    [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5],
    [-0.5, 1, 0], [0.5, 1, 0],
  ];
  const faces = [
    [0, 4, 5], [0, 5, 1], // back slope
    [3, 2, 5], [3, 5, 4], // front slope
    [0, 3, 4], [1, 5, 2], // gable ends
  ];
  const pos: number[] = [];
  for (const f of faces) for (const i of f) pos.push(...v[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const WALLS: Record<Exclude<Zone, Zone.None>, number[]> = {
  [Zone.ResidentialLow]: [0xf3e9d8, 0xe9d6b8, 0xdfe7ee, 0xf0dcd2, 0xe4ead6],
  [Zone.ResidentialHigh]: [0xd9d2c5, 0xc8cfd6, 0xe3d7c3, 0xbfc9c1],
  [Zone.Commercial]: [0x9cc3e6, 0xb5d3ec, 0x86b2dc, 0xd7e6f2],
  [Zone.Office]: [0xb9b3d9, 0x9ea6c9, 0xc9c6e0, 0x8f98bd],
  [Zone.Industrial]: [0xd8c39a, 0xc9b38a, 0xbfae95, 0xe0cfa8],
};
const ROOFS = [0xb5523b, 0x8c4a3a, 0x5d6b7a, 0x6e5a4a, 0x9a6b3f];

interface Shape {
  w: number;
  d: number;
  h: number;
}

/** Footprint and height of the building on a lot (sizes in meters). */
export function buildingShape(lot: Lot): Shape {
  const r = lot.seed;
  const f = CELL * 0.82;
  switch (lot.zone) {
    case Zone.ResidentialLow:
      return { w: f * (0.75 + r * 0.2), d: f * 0.7, h: 3 + lot.level * 0.9 };
    case Zone.ResidentialHigh:
      return { w: f, d: f * 0.9, h: 5 + lot.level * (5 + r * 3) };
    case Zone.Commercial:
      return { w: f, d: f * 0.85, h: 3.5 + lot.level * (2.5 + r * 2) };
    case Zone.Office:
      return { w: f * (0.75 + r * 0.2), d: f * (0.75 + r * 0.2), h: 8 + lot.level * (7 + r * 6) };
    case Zone.Industrial:
      return { w: f, d: f * 0.9, h: 4 + lot.level * 1.5 + r * 2 };
    default:
      return { w: 0, d: 0, h: 0 };
  }
}

/** Zone tiles plus low-poly buildings, all instanced. */
export class BuildingLayer {
  readonly group = new THREE.Group();
  private tiles: THREE.InstancedMesh;
  private bodies: THREE.InstancedMesh;
  private roofs: THREE.InstancedMesh;
  private stacks: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private c = new THREE.Color();
  showEmptyCells = false;

  /** walls, roofs and chimneys share it; lit windows are patched in at night */
  readonly material: THREE.MeshLambertMaterial;

  constructor(shadows: boolean) {
    const tileGeo = new THREE.PlaneGeometry(CELL * 0.9, CELL * 0.9).rotateX(-Math.PI / 2);
    this.tiles = new THREE.InstancedMesh(tileGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }), MAX);
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.material = mat;
    this.bodies = new THREE.InstancedMesh(box, mat, MAX);
    this.roofs = new THREE.InstancedMesh(gableGeometry(), mat, MAX);
    this.stacks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.6, 1, 6).translate(0, 0.5, 0), mat, MAX / 4);
    for (const mesh of [this.tiles, this.bodies, this.roofs, this.stacks]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    for (const mesh of [this.bodies, this.roofs, this.stacks]) {
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
    }
    this.tiles.renderOrder = 1;
  }

  private place(mesh: THREE.InstancedMesh, i: number, lot: Lot, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number): void {
    this.q.setFromAxisAngle(this.up, Math.atan2(-lot.dir.y, lot.dir.x));
    this.p.set(x, y, z);
    this.s.set(sx, sy, sz);
    this.m.compose(this.p, this.q, this.s);
    mesh.setMatrixAt(i, this.m);
    mesh.setColorAt(i, this.c.setHex(color));
  }

  update(city: City): void {
    let t = 0;
    let b = 0;
    let r = 0;
    let k = 0;
    for (const seg of city.net.segments.values()) {
      for (const lot of seg.lots) {
        if (lot.blocked) continue;
        if (lot.level === 0) {
          if (t >= MAX) continue;
          if (lot.zone !== Zone.None) this.place(this.tiles, t++, lot, lot.x, 0.12, lot.y, 1, 1, 1, ZONES[lot.zone].color);
          else if (this.showEmptyCells) this.place(this.tiles, t++, lot, lot.x, 0.12, lot.y, 1, 1, 1, 0xffffff);
          continue;
        }
        if (b >= MAX) continue;
        const zone = lot.zone as Exclude<Zone, Zone.None>;
        const shape = buildingShape(lot);
        const walls = WALLS[zone];
        const wall = walls[Math.floor(lot.seed * walls.length)];
        // Buildings sit toward the road: shift back from cell center by the spare depth
        const back = (CELL * 0.9 - shape.d) / 2;
        const nx = -lot.dir.y * lot.side;
        const ny = lot.dir.x * lot.side;
        const x = lot.x - nx * back;
        const z = lot.y - ny * back;
        this.place(this.bodies, b++, lot, x, 0, z, shape.w, shape.h, shape.d, wall);
        if (zone === Zone.ResidentialLow && r < MAX) {
          const roof = ROOFS[Math.floor(((lot.seed * 7) % 1) * ROOFS.length)];
          this.place(this.roofs, r++, lot, x, shape.h, z, shape.w + 0.6, 2.2, shape.d + 0.6, roof);
        } else if (zone === Zone.Industrial && k < this.stacks.instanceMatrix.count) {
          this.place(this.stacks, k++, lot, x + lot.dir.x * shape.w * 0.25, shape.h, z + lot.dir.y * shape.w * 0.25, 1.2, 4 + lot.level * 2, 1.2, 0x8d8a85);
        }
      }
    }
    this.tiles.count = t;
    this.bodies.count = b;
    this.roofs.count = r;
    this.stacks.count = k;
    for (const mesh of [this.tiles, this.bodies, this.roofs, this.stacks]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

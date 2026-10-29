import * as THREE from 'three';
import type { City } from '../sim/city';
import { CELL, type Lot, ZONES, Zone, isIndustry } from '../sim/zoning';
import { Skin, addSkins, facadeMaterial } from './facade';

const MAX = 20000;
/** facade details: arcades, balconies, window grilles, rooftop add-ons */
const MAX_PARTS = 120000;

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
  // Tiled facades of 透天厝 and 公寓: white and beige mosaic, pink, grey-green, brown 二丁掛 brick
  [Zone.ResidentialLow]: [0xf1ede4, 0xe8dcc6, 0xe7c9bf, 0xc9cfc8, 0xb98a6e, 0xd9cbb6, 0xd4d7da],
  [Zone.ResidentialHigh]: [0xe9e2d4, 0xd6cdbd, 0xc7ccc9, 0xb7927a, 0xdcd3cf, 0xcfc4ae],
  [Zone.Commercial]: [0xece6da, 0xd8d2c8, 0xe2cbb8, 0xc6ccd1, 0xb98a6e],
  // 商辦大樓: blue-green glass curtain walls
  [Zone.Office]: [0x6f97ad, 0x5b7f93, 0x8fb3c2, 0x7d9aa8, 0x4f6f84],
  // 鐵皮 factories: pale steel cladding
  [Zone.Industrial]: [0xe9ecee, 0xdfe3e6, 0xd3d9dd, 0xc8d3db],
  // The newer industries draw as plain factories for now, in their own wall colours
  [Zone.Processing]: [0xf2f3f4, 0xe3e8ee, 0xd5dee8],
  [Zone.Forestry]: [0xa47c52, 0x8e6a45, 0xb48b5c],
  [Zone.Chemical]: [0xcfd4d8, 0xbfc5ca, 0xdfe2e4],
  [Zone.SciencePark]: [0xf7f9fa, 0xeef3f6, 0xe6eef2],
  [Zone.IndustrialPark]: [0xe8dcc6, 0xd9cbb6, 0xe2d6c0],
};
/** Red tile roofs of village houses */
const ROOFS = [0xb5523b, 0x9c4632, 0xa85a3c];
/** Blue and green 鐵皮 roofs of factories and rooftop add-ons */
const TIN = [0x4a7fb0, 0x5b8fb9, 0x6d9a6b, 0xb9bcbf, 0x3f6f9a];
/** Shop signs: bright 招牌 colors */
const SIGNS = [0xe23b3b, 0xf2c12e, 0x2f7fd1, 0x2fae5e, 0xffffff, 0xf07c24, 0xd6336c];
/** Water tanks on the roof: stainless, white and blue plastic */
const TANKS = [0xd8dde0, 0xeef0f0, 0x3c78b5];
/** Granite and stone podiums under office towers */
const STONE = [0xc9c1b3, 0x8c8a86, 0xb3a796, 0x9b9fa3];
const FLOOR = 3.2;
const ARCADE = 0x5f5a55;
const GRILLE = 0x8f989c;

/** Hash a lot's seed into another value in 0..1, so features vary independently. */
const pick = (seed: number, salt: number) => (seed * (salt * 7.13 + 3.7)) % 1;
const choose = <T>(list: readonly T[], seed: number, salt: number) => list[Math.floor(pick(seed, salt) * list.length)];

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
      // a 2-storey village house, then 3- and 4-storey 透天厝
      return { w: f * (0.75 + r * 0.2), d: f * 0.8, h: (lot.level === 1 ? 2 : lot.level + 1) * FLOOR };
    case Zone.ResidentialHigh:
      return { w: f, d: f * 0.9, h: Math.round((5 + lot.level * (5 + r * 3)) / FLOOR) * FLOOR };
    case Zone.Commercial:
      return { w: f, d: f * 0.85, h: (2 + Math.round(lot.level * (0.8 + r * 0.6))) * FLOOR };
    case Zone.Office:
      // Skyscrapers of a 直轄市: full cells, much taller
      if (lot.level > 5) return { w: f * 1.08, d: f * 1.02, h: 70 + (lot.level - 5) * (40 + r * 45) };
      return { w: f * (0.75 + r * 0.2), d: f * (0.75 + r * 0.2), h: 8 + lot.level * (7 + r * 6) };
    case Zone.Industrial:
      return { w: f, d: f * 0.9, h: 4 + lot.level * 1.5 + r * 2 };
    case Zone.Processing:
      // long sawtooth halls
      return { w: CELL * 0.95, d: f * 0.9, h: 5 + lot.level * 1.2 };
    case Zone.Forestry:
      // the sawmill shed's eaves; log piles stand lower
      return { w: f, d: f * 0.9, h: 4.2 + lot.level * 0.6 };
    case Zone.Chemical:
      // storage tanks
      return { w: f, d: f * 0.9, h: 3 + lot.level * 1.2 + r };
    case Zone.SciencePark:
      return { w: f, d: f * 0.9, h: 7 + lot.level * 3.5 + r * 2 };
    case Zone.IndustrialPark:
      return { w: f * 0.95, d: f * 0.85, h: (2 + lot.level) * FLOOR };
    default:
      return { w: 0, d: 0, h: 0 };
  }
}

/** Shop signs light up after dark. */
function glowAtNight(mat: THREE.MeshLambertMaterial, night: { value: number }): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uNight * 0.85;');
  };
  mat.customProgramCacheKey = () => 'signs';
  mat.needsUpdate = true;
}

/**
 * Zone tiles plus low-poly buildings in the style of a Taiwanese street, all instanced:
 * 騎樓 arcades on the ground floor, balconies with 鐵窗 grilles, shop signs, and water tanks
 * and 鐵皮 add-ons on flat roofs.
 */
export class BuildingLayer {
  readonly group = new THREE.Group();
  private tiles: THREE.InstancedMesh;
  private bodies: THREE.InstancedMesh;
  private roofs: THREE.InstancedMesh;
  private stacks: THREE.InstancedMesh;
  private signs: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private c = new THREE.Color();
  private n = { b: 0, r: 0, k: 0, g: 0 };
  /** what each body box is clad in */
  private skins: THREE.InstancedBufferAttribute;
  showEmptyCells = false;

  /** walls, roofs and chimneys share it; facades and lit windows are drawn in by the shader */
  readonly material: THREE.MeshLambertMaterial;
  private readonly signMaterial = new THREE.MeshLambertMaterial({ flatShading: true });

  constructor(shadows: boolean) {
    const tileGeo = new THREE.PlaneGeometry(CELL * 0.9, CELL * 0.9).rotateX(-Math.PI / 2);
    this.tiles = new THREE.InstancedMesh(tileGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }), MAX);
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.material = mat;
    this.bodies = new THREE.InstancedMesh(box, mat, MAX_PARTS);
    this.skins = addSkins(box, MAX_PARTS);
    const gable = gableGeometry();
    addSkins(gable, MAX);
    const stack = new THREE.CylinderGeometry(0.5, 0.6, 1, 6).translate(0, 0.5, 0);
    addSkins(stack, MAX);
    this.roofs = new THREE.InstancedMesh(gable, mat, MAX);
    this.stacks = new THREE.InstancedMesh(stack, mat, MAX);
    this.signs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), this.signMaterial, MAX);
    for (const mesh of [this.tiles, this.bodies, this.roofs, this.stacks, this.signs]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    for (const mesh of [this.bodies, this.roofs, this.stacks, this.signs]) {
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
    }
    this.tiles.renderOrder = 1;
  }

  /** Draw the facades, and light windows, shop fronts and signs at night. */
  light(night: { value: number }): void {
    facadeMaterial(this.material, night);
    glowAtNight(this.signMaterial, night);
  }

  private place(mesh: THREE.InstancedMesh, i: number, lot: Lot, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number): void {
    this.q.setFromAxisAngle(this.up, Math.atan2(-lot.dir.y, lot.dir.x));
    this.p.set(x, y, z);
    this.s.set(sx, sy, sz);
    this.m.compose(this.p, this.q, this.s);
    mesh.setMatrixAt(i, this.m);
    mesh.setColorAt(i, this.c.setHex(color));
  }

  /**
   * One box of a building, in the building's own frame: `along` runs with the road, `out` away from it
   * (negative is toward the street), sizes likewise.
   */
  private part(kind: 'b' | 'r' | 'k' | 'g', lot: Lot, x: number, z: number, along: number, out: number, y: number, w: number, h: number, d: number, color: number, skin = Skin.Plain): void {
    const mesh = kind === 'b' ? this.bodies : kind === 'r' ? this.roofs : kind === 'k' ? this.stacks : this.signs;
    const cap = kind === 'b' ? MAX_PARTS : MAX;
    if (this.n[kind] >= cap) return;
    if (kind === 'b') this.skins.setX(this.n.b, skin);
    const nx = -lot.dir.y * lot.side;
    const ny = lot.dir.x * lot.side;
    this.place(mesh, this.n[kind]++, lot, x + lot.dir.x * along + nx * out, y, z + lot.dir.y * along + ny * out, w, h, d, color);
  }

  /** Ground-floor 騎樓: the shops sit back under the floor above, with pillars along the street. */
  private arcade(lot: Lot, x: number, z: number, w: number, d: number, wall: number): void {
    const deep = 2;
    this.part('b', lot, x, z, 0, deep / 2, 0, w, FLOOR, d - deep, ARCADE, Skin.Shopfront);
    for (const a of [-1, 1]) this.part('b', lot, x, z, a * (w / 2 - 0.25), -d / 2 + 0.25, 0, 0.5, FLOOR, 0.5, wall);
  }

  /** A balcony slab on each upper floor, some closed in by aluminium 鐵窗. */
  private balconies(lot: Lot, x: number, z: number, w: number, d: number, h: number, from: number): void {
    const floors = Math.round(h / FLOOR);
    const step = floors > 12 ? 2 : 1;
    for (let f = from; f < floors; f += step) {
      const y = f * FLOOR;
      this.part('b', lot, x, z, 0, -d / 2 - 0.3, y, w * 0.9, 0.25, 0.6, 0xcfcac2);
      if (pick(lot.seed, f + 3) < 0.55) this.part('b', lot, x, z, 0, -d / 2 - 0.45, y + 0.25, w * 0.8, 1.6, 0.3, GRILLE, Skin.Grille);
    }
  }

  /** Flat-roof clutter: a water tank, often a 鐵皮 add-on, and the stair housing. */
  private rooftop(lot: Lot, x: number, z: number, w: number, d: number, h: number, addOn: boolean): void {
    const tank = choose(TANKS, lot.seed, 5);
    this.part('k', lot, x, z, w * 0.28, d * 0.25, h, 1.4, 1.5, 1.4, tank);
    if (addOn && pick(lot.seed, 6) < 0.55) this.part('b', lot, x, z, -w * 0.12, d * 0.18, h, w * 0.7, 2.4, d * 0.55, choose(TIN, lot.seed, 7), Skin.Tin);
    else this.part('b', lot, x, z, -w * 0.25, d * 0.2, h, Math.min(2.4, w * 0.3), 2.3, Math.min(2.4, d * 0.3), 0xbdb8b0);
  }

  /** Shop signs: a band over the arcade and an upright sign sticking out over the street. */
  private shopSigns(lot: Lot, x: number, z: number, w: number, d: number, h: number): void {
    this.part('g', lot, x, z, 0, -d / 2 - 0.1, FLOOR - 0.1, w * 0.95, 0.9, 0.2, choose(SIGNS, lot.seed, 8));
    const tall = Math.min(h - FLOOR - 0.5, FLOOR * 3);
    if (tall > 2) {
      const side = pick(lot.seed, 9) < 0.5 ? -1 : 1;
      this.part('g', lot, x, z, side * (w / 2 - 0.6), -d / 2 - 0.8, FLOOR + 0.4, 0.25, tall, 1.3, choose(SIGNS, lot.seed, 10));
    }
  }

  /** 商辦大樓: glass tower on a stone podium, white floor bands, a company sign on the crown. */
  private office(lot: Lot, x: number, z: number, w: number, d: number, h: number, glass: number): void {
    const stone = choose(STONE, lot.seed, 12);
    this.part('b', lot, x, z, 0, 0, 0, w + 0.5, FLOOR * 2, d + 0.5, stone, Skin.Stone);
    // a glass canopy over the entrance
    this.part('b', lot, x, z, 0, -d / 2 - 1, FLOOR - 0.3, w * 0.5, 0.3, 2, 0xdfe5ea);
    const floors = Math.round(h / FLOOR);
    const every = Math.max(2, Math.ceil(floors / 8));
    for (let f = 2 + every; f < floors; f += every) this.part('b', lot, x, z, 0, 0, f * FLOOR, w + 0.15, 0.45, d + 0.15, 0xeef0f0);
    this.part('g', lot, x, z, 0, -d / 2 - 0.1, h - 2.4, w * 0.6, 1.6, 0.2, choose(SIGNS, lot.seed, 13));
    if (lot.level > 5) {
      // Setback crown and a mast on top of a skyscraper
      this.part('b', lot, x, z, 0, 0, h, w * 0.7, h * 0.08, d * 0.7, glass, Skin.Curtain);
      this.part('k', lot, x, z, 0, 0, h * 1.08, 0.6, 8 + lot.seed * 14, 0.6, 0xdfe5ea);
    } else this.part('b', lot, x, z, w * 0.15, d * 0.1, h, w * 0.4, 1.8, d * 0.4, 0xbdb8b0);
  }

  /** 鐵皮工廠: steel shed with a coloured band and roof, roller shutters, a small office in front, sometimes a stack. */
  private factory(lot: Lot, x: number, z: number, w: number, d: number, h: number): void {
    const tin = choose(TIN, lot.seed, 2);
    this.part('b', lot, x, z, 0, 0, h - 1, w + 0.1, 1, d + 0.1, tin, Skin.Tin);
    this.part('r', lot, x, z, 0, 0, h, w + 0.4, 1.2, d + 0.4, tin);
    // 鐵捲門 on the street side
    const doors = w > 6 ? 2 : 1;
    for (let i = 0; i < doors; i++) {
      const along = doors === 1 ? w * 0.15 : (i ? w * 0.3 : -w * 0.05);
      this.part('b', lot, x, z, along, -d / 2 - 0.05, 0, 2.8, Math.min(3.6, h - 1.2), 0.15, 0x7c8287, Skin.Shutter);
    }
    // two-storey tiled office at the front corner
    this.part('b', lot, x, z, -w * 0.32, -d * 0.3 - 0.3, 0, w * 0.36, FLOOR * 2, d * 0.4, choose(WALLS[Zone.ResidentialLow], lot.seed, 14), Skin.Tiled);
    if (pick(lot.seed, 15) < 0.2) this.part('k', lot, x, z, w * 0.3, d * 0.2, h, 1, 3 + lot.level * 1.5, 1, 0x8d8a85);
    else this.part('k', lot, x, z, w * 0.2, d * 0.15, h + 0.6, 0.9, 1, 0.9, 0xb9bcbf);
  }

  /** 加工工業區: a long white hall under a sawtooth roof with north lights, a blue band and loading bays. */
  private processing(lot: Lot, x: number, z: number, w: number, d: number, h: number, wall: number): void {
    const eave = h - 1.4;
    this.part('b', lot, x, z, 0, 0, 0, w, eave, d, wall, Skin.Tin);
    this.part('b', lot, x, z, 0, 0, eave - 1.1, w + 0.08, 0.7, d + 0.08, 0x2f6fb0);
    // Sawtooth: three gables side by side across the depth, glazing on one face
    const teeth = 3;
    for (let i = 0; i < teeth; i++) {
      const out = -d / 2 + (d / teeth) * (i + 0.5);
      this.part('r', lot, x, z, 0, out, eave, w + 0.2, 1.4, d / teeth, 0xd9dee3);
      this.part('b', lot, x, z, 0, out - d / teeth / 2 + 0.1, eave, w, 1.1, 0.12, 0x7fa9c4);
    }
    // Loading bays with dock levellers on the street side
    const bays = lot.level + 1;
    for (let i = 0; i < bays; i++) {
      const along = -w / 2 + (w / bays) * (i + 0.5);
      this.part('b', lot, x, z, along, -d / 2 - 0.05, 0, Math.min(2.6, (w / bays) * 0.7), 3, 0.15, 0x6d747a, Skin.Shutter);
    }
    this.part('b', lot, x, z, 0, -d / 2 - 0.6, 0, w * 0.9, 1.1, 1.2, 0x9aa0a4);
    this.part('g', lot, x, z, -w * 0.25, -d / 2 - 0.1, eave - 2.6, w * 0.35, 1.1, 0.2, 0x2f6fb0);
  }

  /** 林業: an open-sided sawmill shed on posts, stacks of logs and sawn timber, a small timber office. */
  private sawmill(lot: Lot, x: number, z: number, w: number, d: number, h: number): void {
    const shed = d * 0.55;
    const back = d / 2 - shed / 2;
    // Posts and a green tin roof over the saw line
    for (const a of [-1, 1]) for (const o of [-1, 1]) this.part('b', lot, x, z, a * (w / 2 - 0.25), back + o * (shed / 2 - 0.25), 0, 0.35, h, 0.35, 0x6e5238);
    this.part('r', lot, x, z, 0, back, h, w + 0.5, 1.3, shed + 0.4, choose([0x6d9a6b, 0x4f7f4c, 0x8a8f86], lot.seed, 21));
    this.part('b', lot, x, z, 0, back, 0, w * 0.8, 1.1, 0.9, 0x8d8a85);
    this.part('b', lot, x, z, w * 0.1, back, 1.1, 0.25, 1.2, 0.25, 0xc9c9c9);
    // Log piles in front: layers of bark-brown logs, cut ends lighter
    const layers = 1 + lot.level;
    for (let i = 0; i < layers; i++) {
      const y = i * 0.55;
      const inset = i * 0.25;
      this.part('b', lot, x, z, -w * 0.18, -d / 2 + 1.5, y, w * 0.55 - inset, 0.55, 2.2 - inset, 0x7a5233);
      this.part('b', lot, x, z, -w * 0.18 - (w * 0.55 - inset) / 2, -d / 2 + 1.5, y + 0.05, 0.08, 0.45, 2.1 - inset, 0xd8b98a);
    }
    // Sawn timber stacked with spacers
    for (let i = 0; i < lot.level + 1; i++) this.part('b', lot, x, z, w * 0.3, -d / 2 + 1.4, i * 0.42, 1.8, 0.32, 2.2, 0xe2c28f);
    this.part('b', lot, x, z, w * 0.3, -d * 0.05, 0, 1.6, FLOOR, 1.8, 0xa47c52);
    this.part('r', lot, x, z, w * 0.3, -d * 0.05, FLOOR, 2, 0.8, 2.2, 0x5b4636);
  }

  /** 化工業: silver storage tanks, a flare stack banded red and white, pipe racks and a control room. */
  private chemical(lot: Lot, x: number, z: number, w: number, d: number, h: number): void {
    this.part('b', lot, x, z, 0, 0, 0, w, 0.15, d, 0x9a9690);
    const r = Math.min(w, d) * 0.42;
    const tanks = lot.level >= 2 ? 2 : 1;
    for (let i = 0; i < tanks; i++) {
      const along = tanks === 1 ? -w * 0.15 : (i ? w * 0.22 : -w * 0.24);
      this.part('k', lot, x, z, along, d * 0.12, 0, r * (tanks === 1 ? 2.1 : 1.7), h, r * (tanks === 1 ? 2.1 : 1.7), 0xdfe3e6);
      this.part('k', lot, x, z, along, d * 0.12, h, r * 1.2, 0.5, r * 1.2, 0xc9ced2);
      this.part('b', lot, x, z, along, d * 0.12 - r * 0.85, h * 0.45, 0.6, 0.3, 0.3, 0xe0a030);
    }
    // Pipe rack along the front
    for (const a of [-1, 1]) this.part('b', lot, x, z, a * (w / 2 - 0.4), -d / 2 + 1, 0, 0.3, 3.4, 0.3, 0x8d8a85);
    this.part('b', lot, x, z, 0, -d / 2 + 1, 3.1, w - 0.6, 0.25, 0.9, 0x7c8287);
    this.part('b', lot, x, z, 0, -d / 2 + 0.7, 2.6, w - 0.6, 0.18, 0.18, 0xd0a040);
    // Flare stack on the bigger plants
    if (lot.level >= 2 && pick(lot.seed, 23) < 0.3) {
      const tall = h + 6 + lot.level * 3;
      const at = w / 2 - 0.8;
      this.part('k', lot, x, z, at, d / 2 - 0.8, 0, 0.7, tall, 0.7, 0xdfe3e6);
      for (let y = tall * 0.55; y < tall - 1; y += 2.4) this.part('k', lot, x, z, at, d / 2 - 0.8, y, 0.75, 1.2, 0.75, 0xc8442f);
      this.part('g', lot, x, z, at, d / 2 - 0.8, tall, 0.4, 0.9, 0.4, 0xf28c28);
    }
    this.part('b', lot, x, z, -w * 0.3, -d / 2 + 2.6, 0, w * 0.32, FLOOR, 1.8, 0xeef0f0);
  }

  /** 科學園區: a clean white fab with blue glass bands, rooftop plant and a lawn around it. */
  private fab(lot: Lot, x: number, z: number, w: number, d: number, h: number): void {
    this.part('b', lot, x, z, 0, 0, 0.02, CELL * 0.98, 0.1, CELL * 0.9, 0x86bf6a);
    const bw = w * 0.86;
    const bd = d * 0.8;
    this.part('b', lot, x, z, 0, d * 0.04, 0, bw, h, bd, 0xf4f6f7);
    for (let y = 2.4; y < h - 1; y += 4.2) this.part('b', lot, x, z, 0, d * 0.04, y, bw + 0.1, 1.3, bd + 0.1, 0x3f86c6);
    // Glass entrance hall
    this.part('b', lot, x, z, -bw * 0.22, -bd / 2 + d * 0.04 - 0.8, 0, bw * 0.36, 3.6, 1.6, 0x8fc3e3);
    // Air handlers and exhaust on the roof
    for (const a of [-0.25, 0.1]) this.part('b', lot, x, z, a * bw, d * 0.1, h, bw * 0.28, 1.4, bd * 0.4, 0xc9ced2);
    this.part('k', lot, x, z, bw * 0.35, d * 0.2, h, 0.7, 2.6, 0.7, 0xdfe3e6);
    this.part('g', lot, x, z, bw * 0.15, -bd / 2 + d * 0.04 - 0.08, h - 2.2, bw * 0.45, 1.2, 0.15, 0x1f5fa8);
    this.part('k', lot, x, z, w * 0.42, -d * 0.4, 0, 1.4, 2.6, 1.4, 0x4f8f45);
  }

  /** 產業園區: a multi-storey standard factory block, window bands on every floor, a company sign and shrubs. */
  private standardFactory(lot: Lot, x: number, z: number, w: number, d: number, h: number, wall: number): void {
    this.part('b', lot, x, z, 0, 0, 0, w, h, d, wall);
    const floors = Math.round(h / FLOOR);
    for (let f = 0; f < floors; f++) this.part('b', lot, x, z, 0, 0, f * FLOOR + 1.1, w + 0.08, 1.3, d + 0.08, 0x4c6f8a);
    // Goods lift tower and a parapet
    this.part('b', lot, x, z, w * 0.36, d * 0.3, 0, w * 0.22, h + 2, d * 0.3, 0xcfc4ae);
    this.part('b', lot, x, z, 0, 0, h, w + 0.1, 0.6, d + 0.1, 0xb9b0a0);
    this.part('g', lot, x, z, -w * 0.12, -d / 2 - 0.1, h - 1.6, w * 0.55, 1.1, 0.2, choose(SIGNS, lot.seed, 22));
    this.part('b', lot, x, z, -w * 0.2, -d / 2 - 0.05, 0, 2.6, 3, 0.15, 0x7c8287, Skin.Shutter);
    for (const a of [-0.42, 0.42]) this.part('k', lot, x, z, a * w, -d / 2 - 0.6, 0, 0.9, 1.2, 0.9, 0x4f8f45);
  }

  update(city: City): void {
    let t = 0;
    this.n = { b: 0, r: 0, k: 0, g: 0 };
    // A skyscraper takes in the skyscraper lot behind it too, for a bigger footprint
    const tower = (l: Lot | undefined) => !!l && !l.blocked && l.zone === Zone.Office && l.level > 5;
    const merged = new Set<Lot>();
    const behind = new Map<Lot, Lot>();
    for (const seg of city.net.segments.values()) for (const lot of seg.lots) if (lot.front) behind.set(lot.front, lot);
    for (const seg of city.net.segments.values()) {
      for (const lot of seg.lots) {
        if (lot.blocked || merged.has(lot)) continue;
        if (lot.level === 0) {
          if (t >= MAX) continue;
          if (lot.zone !== Zone.None) this.place(this.tiles, t++, lot, lot.x, 0.12, lot.y, 1, 1, 1, ZONES[lot.zone].color);
          else if (this.showEmptyCells) this.place(this.tiles, t++, lot, lot.x, 0.12, lot.y, 1, 1, 1, 0xffffff);
          continue;
        }
        if (this.n.b >= MAX_PARTS) continue;
        const zone = lot.zone as Exclude<Zone, Zone.None>;
        const shape = buildingShape(lot);
        const back2 = behind.get(lot);
        let deep = false;
        if (tower(lot) && tower(back2) && !merged.has(back2!) && lot.depth % 2 === 1) {
          merged.add(back2!);
          shape.d = CELL * 1.8;
          shape.h = Math.max(shape.h, buildingShape(back2!).h) * 1.15;
          deep = true;
        }
        const walls = WALLS[zone];
        const wall = walls[Math.floor(lot.seed * walls.length)];
        // Buildings sit toward the road: shift back from cell center by the spare depth
        const back = deep ? -CELL / 2 : (CELL * 0.9 - shape.d) / 2;
        const nx = -lot.dir.y * lot.side;
        const ny = lot.dir.x * lot.side;
        const x = lot.x - nx * back;
        const z = lot.y - ny * back;
        const { w, d, h } = shape;
        const village = zone === Zone.ResidentialLow && lot.level === 1;
        const arcaded = (zone === Zone.ResidentialLow && !village) || zone === Zone.Commercial || (zone === Zone.ResidentialHigh && lot.level <= 3);
        // The newer industries draw their own bodies: open sheds, tanks, halls
        const special = isIndustry(zone) && zone !== Zone.Industrial;
        const skin = zone === Zone.Office ? Skin.Curtain : zone === Zone.Industrial ? Skin.Tin : Skin.Tiled;
        if (arcaded) {
          this.arcade(lot, x, z, w, d, wall);
          this.part('b', lot, x, z, 0, 0, FLOOR, w, h - FLOOR, d, wall, skin);
        } else if (!special) this.part('b', lot, x, z, 0, 0, 0, w, h, d, wall, skin);
        if (village) {
          this.part('r', lot, x, z, 0, 0, h, w + 0.6, 2.2, d + 0.6, choose(ROOFS, lot.seed, 1));
        } else if (zone === Zone.ResidentialLow || zone === Zone.ResidentialHigh || zone === Zone.Commercial) {
          this.balconies(lot, x, z, w, d, h, 1);
          this.rooftop(lot, x, z, w, d, h, zone !== Zone.Commercial || lot.level < 3);
          if (zone === Zone.Commercial) this.shopSigns(lot, x, z, w, d, h);
          else if (arcaded && zone === Zone.ResidentialHigh) this.part('g', lot, x, z, 0, -d / 2 - 0.1, FLOOR - 0.1, w * 0.95, 0.8, 0.2, choose(SIGNS, lot.seed, 11));
        } else if (zone === Zone.Office) {
          this.office(lot, x, z, w, d, h, wall);
        } else if (zone === Zone.Processing) {
          this.processing(lot, x, z, w, d, h, wall);
        } else if (zone === Zone.Forestry) {
          this.sawmill(lot, x, z, w, d, h);
        } else if (zone === Zone.Chemical) {
          this.chemical(lot, x, z, w, d, h);
        } else if (zone === Zone.SciencePark) {
          this.fab(lot, x, z, w, d, h);
        } else if (zone === Zone.IndustrialPark) {
          this.standardFactory(lot, x, z, w, d, h, wall);
        } else if (zone === Zone.Industrial) {
          this.factory(lot, x, z, w, d, h);
        }
      }
    }
    this.tiles.count = t;
    this.bodies.count = this.n.b;
    this.roofs.count = this.n.r;
    this.stacks.count = this.n.k;
    this.signs.count = this.n.g;
    for (const mesh of [this.tiles, this.bodies, this.roofs, this.stacks, this.signs]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.skins.needsUpdate = true;
  }
}

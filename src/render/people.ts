import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Who the detailed people are: residents by kind, and the staff of police, fire and hospital stations. The models are
 * Gobkit's free character packs (CC0, https://gobkit.com/freebies), trimmed to their Walk and Idle clips and compressed
 * in public/people.
 */
export type Crowd = 'man' | 'woman' | 'elder' | 'child' | 'police' | 'firefighter' | 'medic';

export const CAST: Record<Crowd, { models: string[]; height: number }> = {
  man: { models: ['OfficeWorker', 'ItEngineer', 'SalesRep', 'DeliveryRider', 'StockClerk'], height: 1.72 },
  woman: { models: ['OfficeLady', 'OfficeIntern', 'OfficeManager', 'Receptionist', 'Cashier'], height: 1.62 },
  elder: { models: ['GrandmaShopper', 'Accountant', 'CompanyCeo'], height: 1.6 },
  child: { models: ['Schoolkid', 'Student'], height: 1.25 },
  police: { models: ['PoliceOfficer', 'SecurityGuard'], height: 1.75 },
  firefighter: { models: ['Firefighter', 'ExtinguisherOperator'], height: 1.75 },
  medic: { models: ['Paramedic', 'WardNurse'], height: 1.68 },
};

/** Animation frames baked per second of a clip, and the most a clip keeps. */
const FPS = 24;
const MAX_FRAMES = 48;
/** Most detailed people of one model drawn at once. */
export const PER_MODEL = 120;

interface Clip {
  row: number;
  frames: number;
  seconds: number;
}

/** One character, baked: its geometry, its joints' matrices per frame in a texture, drawn instanced. */
export interface Model {
  name: string;
  mesh: THREE.InstancedMesh;
  walk: Clip;
  idle: Clip;
  /** metres walked per Walk cycle */
  stride: number;
  /** how many drawn this frame */
  count: number;
}

/**
 * Skin each vertex from the joint matrices of its instance's animation frame, read from a texture: every walker
 * shares one geometry and plays the clip at its own point, with no skeleton per person.
 */
function bakedSkin<T extends THREE.Material>(m: T, bones: THREE.DataTexture): T {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.boneTex = { value: bones };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform highp sampler2D boneTex;
        attribute float animRow;
        attribute vec4 skinIndex;
        attribute vec4 skinWeight;
        mat4 bakedBone(float j, int row) {
          int x = int(j + 0.5) * 4;
          return mat4(texelFetch(boneTex, ivec2(x, row), 0), texelFetch(boneTex, ivec2(x + 1, row), 0),
            texelFetch(boneTex, ivec2(x + 2, row), 0), texelFetch(boneTex, ivec2(x + 3, row), 0));
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        `int bakedRow = int(animRow + 0.5);
        float bakedSum = max(1e-4, skinWeight.x + skinWeight.y + skinWeight.z + skinWeight.w);
        mat4 bakedSkinMat = (skinWeight.x * bakedBone(skinIndex.x, bakedRow) + skinWeight.y * bakedBone(skinIndex.y, bakedRow)
          + skinWeight.z * bakedBone(skinIndex.z, bakedRow) + skinWeight.w * bakedBone(skinIndex.w, bakedRow)) / bakedSum;
        vec3 transformed = (bakedSkinMat * vec4(position, 1.0)).xyz;`,
      );
  };
  m.customProgramCacheKey = () => `bakedSkin${m.type}`;
  return m;
}

/** Bake a loaded character: joint matrices for each frame of Walk then Idle, scaled to `height` and facing +x. */
function bake(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }, name: string, height: number, shadows: boolean): Model | null {
  const root = gltf.scene;
  let mesh: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
  });
  const skinned = mesh as THREE.SkinnedMesh | null;
  if (!skinned) return null;
  const found = ['Walk', 'Idle'].map((n) => THREE.AnimationClip.findByName(gltf.animations, n));
  if (found.some((c) => !c)) return null;
  const clips = found as THREE.AnimationClip[];
  const joints = skinned.skeleton.bones.length;
  const mixer = new THREE.AnimationMixer(root);
  const counts = clips.map((c) => Math.max(2, Math.min(MAX_FRAMES, Math.round(c.duration * FPS))));
  const total = counts[0] + counts[1];
  const raw: THREE.Matrix4[][] = [];
  const m = new THREE.Matrix4();
  for (const [k, clip] of clips.entries()) {
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.play();
    for (let f = 0; f < counts[k]; f++) {
      mixer.setTime((f / counts[k]) * clip.duration);
      root.updateMatrixWorld(true);
      skinned.skeleton.update();
      const frame: THREE.Matrix4[] = [];
      for (let j = 0; j < joints; j++) {
        m.fromArray(skinned.skeleton.boneMatrices!, j * 16);
        frame.push(new THREE.Matrix4().copy(skinned.matrixWorld).multiply(skinned.bindMatrixInverse).multiply(m).multiply(skinned.bindMatrix));
      }
      raw.push(frame);
    }
  }
  // Size and stand it from where its vertices are in the first Idle frame
  const g = skinned.geometry;
  const pos = g.getAttribute('position');
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  const idle0 = raw[counts[0]];
  const v = new THREE.Vector3();
  const acc = new THREE.Vector3();
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    acc.set(0, 0, 0);
    let sum = 0;
    for (let c = 0; c < 4; c++) {
      const w = sw.getComponent(i, c);
      if (!w) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(idle0[si.getComponent(i, c)]);
      acc.addScaledVector(v, w);
      sum += w;
    }
    if (!sum) continue;
    acc.divideScalar(sum);
    lo = Math.min(lo, acc.y);
    hi = Math.max(hi, acc.y);
  }
  if (!(hi > lo)) return null;
  const s = height / (hi - lo);
  const fix = new THREE.Matrix4()
    .makeRotationY(Math.PI / 2)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(0, -lo, 0));
  const data = new Float32Array(joints * 4 * total * 4);
  raw.forEach((frame, row) => {
    frame.forEach((j, i) => {
      m.copy(fix).multiply(j);
      data.set(m.elements, (row * joints * 4 + i * 4) * 4);
    });
  });
  const bones = new THREE.DataTexture(data, joints * 4, total, THREE.RGBAFormat, THREE.FloatType);
  bones.minFilter = bones.magFilter = THREE.NearestFilter;
  bones.needsUpdate = true;
  const source = (Array.isArray(skinned.material) ? skinned.material[0] : skinned.material) as THREE.MeshStandardMaterial;
  const mat = bakedSkin(new THREE.MeshLambertMaterial({ map: source.map, flatShading: true }), bones);
  const geo = new THREE.BufferGeometry();
  for (const a of ['position', 'uv', 'skinIndex', 'skinWeight']) {
    const attr = g.getAttribute(a);
    if (attr) geo.setAttribute(a, attr);
  }
  geo.setIndex(g.getIndex());
  geo.setAttribute('animRow', new THREE.InstancedBufferAttribute(new Float32Array(PER_MODEL), 1));
  const inst = new THREE.InstancedMesh(geo, mat, PER_MODEL);
  inst.customDepthMaterial = bakedSkin(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), bones);
  inst.count = 0;
  inst.frustumCulled = false;
  inst.castShadow = shadows;
  inst.name = name;
  mixer.stopAllAction();
  return {
    name,
    mesh: inst,
    walk: { row: 0, frames: counts[0], seconds: clips[0].duration },
    idle: { row: counts[0], frames: counts[1], seconds: clips[1].duration },
    stride: height * 0.62,
    count: 0,
  };
}

/** The detailed people: loaded in the background, then drawn near the camera in place of the simple figures. */
export class PeopleModels {
  readonly group = new THREE.Group();
  readonly cast = new Map<Crowd, Model[]>();
  ready = false;
  private readonly m = new THREE.Matrix4();

  constructor(private readonly shadows: boolean) {}

  /** Load every character from `base` (the folder holding the .glb files). Missing ones are left out. */
  async load(base: string): Promise<void> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const jobs: Promise<void>[] = [];
    for (const [crowd, { models, height }] of Object.entries(CAST) as [Crowd, (typeof CAST)[Crowd]][]) {
      const list: Model[] = [];
      this.cast.set(crowd, list);
      for (const name of models) {
        jobs.push(
          loader
            .loadAsync(`${base}${name}.glb`)
            .then((gltf) => {
              const model = bake(gltf, name, height, this.shadows);
              if (!model) return;
              list.push(model);
              this.group.add(model.mesh);
            })
            .catch(() => undefined),
        );
      }
    }
    await Promise.all(jobs);
    for (const list of this.cast.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    this.ready = [...this.cast.values()].every((l) => l.length > 0);
  }

  /** The look a person keeps: one of the crowd's models, by a number they were given. */
  model(crowd: Crowd, look: number): Model | null {
    const list = this.cast.get(crowd);
    return list?.length ? list[look % list.length] : null;
  }

  begin(): void {
    for (const list of this.cast.values()) for (const k of list) k.count = 0;
  }

  /**
   * Draw one person: at `matrix`, walking (cycle counts Walk cycles) or standing (cycle counts seconds of Idle).
   * False when that model is already full.
   */
  add(model: Model, matrix: THREE.Matrix4, walking: boolean, cycle: number): boolean {
    if (model.count >= PER_MODEL) return false;
    const clip = walking ? model.walk : model.idle;
    const t = walking ? cycle : cycle / clip.seconds;
    const frame = Math.floor((t - Math.floor(t)) * clip.frames) % clip.frames;
    model.mesh.setMatrixAt(model.count, this.m.copy(matrix));
    (model.mesh.geometry.getAttribute('animRow') as THREE.InstancedBufferAttribute).setX(model.count, clip.row + frame);
    model.count++;
    return true;
  }

  end(): void {
    for (const list of this.cast.values()) {
      for (const k of list) {
        k.mesh.count = k.count;
        if (!k.count) continue;
        k.mesh.instanceMatrix.needsUpdate = true;
        k.mesh.geometry.getAttribute('animRow').needsUpdate = true;
      }
    }
  }
}

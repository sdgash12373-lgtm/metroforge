import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * The citizens up close: the Metroforge_Citizens pack (eight people modelled in Blender in the game's own blocky,
 * flat-coloured style, with a Mixamo-style rig and Walk / Idle / Run, Bicycle and Motorcycle clips), packed into
 * public/citizens by scripts/citizens.mjs.
 *
 * Each model's clips are baked to a texture of joint matrices and skinned in the shader, so everyone wearing one
 * model is a single instanced mesh, each playing its clip at its own point. Shirts take each person's own colour
 * and scooter bodies their paint, so a few models make a varied crowd.
 */
export type Citizen = 'adultMan' | 'adultWoman' | 'elderMan' | 'elderWoman' | 'teenBoy' | 'teenGirl' | 'childBoy' | 'childGirl';

const FILES: Record<Citizen, string> = {
  adultMan: '01_adult_man',
  adultWoman: '02_adult_woman',
  elderMan: '03_elder_man',
  elderWoman: '04_elder_woman',
  teenBoy: '05_teen_boy',
  teenGirl: '06_teen_girl',
  childBoy: '07_child_boy',
  childGirl: '08_child_girl',
};

/** Who rides: cyclists of any age but children; only grown-ups on scooters. */
export const CYCLISTS: Citizen[] = ['adultMan', 'adultWoman', 'teenBoy', 'teenGirl', 'elderMan', 'elderWoman'];
export const SCOOTERISTS: Citizen[] = ['adultMan', 'adultWoman', 'elderMan', 'elderWoman'];

export type Ride = 'walk' | 'bicycle' | 'motorcycle';
type ClipName = 'Walk' | 'Idle' | 'Run' | 'Bicycle' | 'Motorcycle';

/** Animation frames baked per second of a clip, and the most a clip keeps. */
const FPS = 24;
const MAX_FRAMES = 48;

interface Clip {
  row: number;
  frames: number;
  seconds: number;
  /** metres covered per cycle, for clips that move along the ground (from how far the feet reach) */
  stride: number;
}

/** One model, baked: its geometry and a texture of its joints' matrices per frame, drawn instanced. */
export interface Model {
  name: string;
  mesh: THREE.InstancedMesh;
  clips: Partial<Record<ClipName, Clip>>;
  count: number;
  cap: number;
  /** the model's own shirt (dye 1) and paint (dye 2) colours, linear */
  own: Record<1 | 2, [number, number, number]>;
}

/**
 * Skin each vertex from the joint matrices of its instance's animation frame, read from a texture, and colour the
 * parts marked to dye (1 = shirt, 2 = vehicle paint) with the instance's own colours.
 */
function bakedSkin<T extends THREE.Material>(m: T, bones: THREE.DataTexture, colours: boolean): T {
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
        ${colours ? 'attribute float dye;\nattribute vec3 shirt;\nattribute vec3 paint;' : ''}
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
        // Most blocks hang from a single joint, so skip the reads for joints with no weight
        mat4 bakedSkinMat = skinWeight.x * bakedBone(skinIndex.x, bakedRow);
        if (skinWeight.y > 0.0) bakedSkinMat += skinWeight.y * bakedBone(skinIndex.y, bakedRow);
        if (skinWeight.z > 0.0) bakedSkinMat += skinWeight.z * bakedBone(skinIndex.z, bakedRow);
        if (skinWeight.w > 0.0) bakedSkinMat += skinWeight.w * bakedBone(skinIndex.w, bakedRow);
        bakedSkinMat /= bakedSum;
        vec3 transformed = (bakedSkinMat * vec4(position, 1.0)).xyz;`,
      );
    if (colours) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        vColor.rgb = dye > 1.5 ? paint : dye > 0.5 ? shirt : vColor.rgb;`,
      );
    }
  };
  m.customProgramCacheKey = () => `citizenSkin${m.type}`;
  return m;
}

type Gltf = { scene: THREE.Object3D; animations: THREE.AnimationClip[] };

/** Every attribute as plain floats, so meshes quantized differently can be merged. */
function floats(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number): Float32Array {
  const out = new Float32Array(a.count * size);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < size; c++) out[i * size + c] = a.getComponent(i, c);
  return out;
}

/**
 * Bake a loaded model: joint matrices of every skinned mesh in it (a rider and their bike are two) for each frame of
 * each clip, turned to face +x with the lowest point of the first clip's first frame on the ground.
 */
function bake(gltf: Gltf, name: string, want: ClipName[], cap: number, shadows: boolean): Model | null {
  const root = gltf.scene;
  const skinned: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
  });
  const clips = want.map((n) => THREE.AnimationClip.findByName(gltf.animations, n)).filter((c): c is THREE.AnimationClip => !!c);
  if (!skinned.length || !clips.length) return null;
  const offsets: number[] = [];
  let joints = 0;
  for (const s of skinned) {
    offsets.push(joints);
    joints += s.skeleton.bones.length;
  }
  const mixer = new THREE.AnimationMixer(root);
  const counts = clips.map((c) => Math.max(2, Math.min(MAX_FRAMES, Math.round(c.duration * FPS))));
  const total = counts.reduce((a, b) => a + b, 0);
  const raw: THREE.Matrix4[][] = [];
  const m = new THREE.Matrix4();
  // How far the left foot reaches forward and back in each clip, for its stride
  const foot = skinned[0].skeleton.bones.find((b) => b.name.endsWith('LeftFoot'));
  const reach: [number, number][] = [];
  const v = new THREE.Vector3();
  for (const [k, clip] of clips.entries()) {
    mixer.stopAllAction();
    mixer.clipAction(clip).play();
    let lo = Infinity;
    let hi = -Infinity;
    for (let f = 0; f < counts[k]; f++) {
      mixer.setTime((f / counts[k]) * clip.duration);
      root.updateMatrixWorld(true);
      const frame: THREE.Matrix4[] = [];
      for (const s of skinned) {
        s.skeleton.update();
        for (let j = 0; j < s.skeleton.bones.length; j++) {
          m.fromArray(s.skeleton.boneMatrices!, j * 16);
          frame.push(new THREE.Matrix4().copy(s.matrixWorld).multiply(s.bindMatrixInverse).multiply(m).multiply(s.bindMatrix));
        }
      }
      if (foot) {
        foot.getWorldPosition(v);
        lo = Math.min(lo, v.z);
        hi = Math.max(hi, v.z);
      }
      raw.push(frame);
    }
    reach.push([lo, hi]);
  }
  mixer.stopAllAction();
  // One geometry: positions, colours, dye marks and joints of every mesh, joints numbered across them
  const parts: { pos: Float32Array; col: Float32Array; dye: Float32Array; si: Float32Array; sw: Float32Array; index: number[] }[] = [];
  skinned.forEach((s, k) => {
    const g = s.geometry;
    const n = g.getAttribute('position').count;
    const si = floats(g.getAttribute('skinIndex') as THREE.BufferAttribute, 4);
    for (let i = 0; i < si.length; i++) si[i] += offsets[k];
    const col = g.getAttribute('color');
    const dye = g.getAttribute('_dye');
    const idx = g.getIndex();
    parts.push({
      pos: floats(g.getAttribute('position') as THREE.BufferAttribute, 3),
      col: col ? floats(col as THREE.BufferAttribute, 3) : new Float32Array(n * 3).fill(1),
      dye: dye ? floats(dye as THREE.BufferAttribute, 1) : new Float32Array(n),
      si,
      sw: floats(g.getAttribute('skinWeight') as THREE.BufferAttribute, 4),
      index: idx ? Array.from(idx.array as ArrayLike<number>) : Array.from({ length: n }, (_, i) => i),
    });
  });
  const join = (key: 'pos' | 'col' | 'dye' | 'si' | 'sw') => {
    const out = new Float32Array(parts.reduce((a, p) => a + p[key].length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p[key], at);
      at += p[key].length;
    }
    return out;
  };
  const pos = join('pos');
  const si = join('si');
  const sw = join('sw');
  const index: number[] = [];
  let base = 0;
  for (const p of parts) {
    for (const i of p.index) index.push(i + base);
    base += p.pos.length / 3;
  }
  // Stand it on the ground from where its vertices are in the first frame
  const first = raw[0];
  const acc = new THREE.Vector3();
  let low = Infinity;
  for (let i = 0; i < pos.length / 3; i++) {
    acc.set(0, 0, 0);
    let sum = 0;
    for (let c = 0; c < 4; c++) {
      const w = sw[i * 4 + c];
      if (!w) continue;
      v.fromArray(pos, i * 3).applyMatrix4(first[si[i * 4 + c]]);
      acc.addScaledVector(v, w);
      sum += w;
    }
    if (sum) low = Math.min(low, acc.y / sum);
  }
  if (!Number.isFinite(low)) return null;
  // glTF faces +z, the game +x
  const fix = new THREE.Matrix4().makeRotationY(Math.PI / 2).multiply(new THREE.Matrix4().makeTranslation(0, -low, 0));
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
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(join('col'), 3));
  geo.setAttribute('dye', new THREE.BufferAttribute(join('dye'), 1));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.setIndex(index);
  geo.setAttribute('animRow', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
  geo.setAttribute('shirt', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
  geo.setAttribute('paint', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
  const mat = bakedSkin(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), bones, true);
  const inst = new THREE.InstancedMesh(geo, mat, cap);
  inst.customDepthMaterial = bakedSkin(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), bones, false);
  inst.count = 0;
  inst.frustumCulled = false;
  inst.castShadow = shadows;
  inst.name = name;
  const own: Model['own'] = { 1: [1, 1, 1], 2: [1, 1, 1] };
  const dyes = join('dye');
  const cols = join('col');
  for (const mark of [1, 2] as const) {
    const v = dyes.indexOf(mark);
    if (v >= 0) own[mark] = [cols[v * 3], cols[v * 3 + 1], cols[v * 3 + 2]];
  }
  const out: Model = { name, mesh: inst, clips: {}, count: 0, cap, own };
  let row = 0;
  clips.forEach((c, k) => {
    const [lo, hi] = reach[k];
    out.clips[c.name as ClipName] = { row, frames: counts[k], seconds: c.duration, stride: Number.isFinite(hi - lo) ? 2 * (hi - lo) : 1 };
    row += counts[k];
  });
  return out;
}

/** The citizen models: loaded in the background, then drawn near the camera in place of the simple figures. */
export class CitizenModels {
  readonly group = new THREE.Group();
  private readonly walkers = new Map<Citizen, Model>();
  private readonly riders = new Map<string, Model>();
  ready = false;
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();

  constructor(private readonly shadows: boolean) {}

  /** Load every model from `base` (the folder holding the .glb files). */
  async load(base: string): Promise<void> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const get = (file: string, clips: ClipName[], cap: number) =>
      loader
        .loadAsync(`${base}${file}.glb`)
        .then((g) => {
          const model = bake(g, file, clips, cap, this.shadows);
          if (model) this.group.add(model.mesh);
          return model;
        })
        .catch(() => null);
    const jobs: Promise<unknown>[] = [];
    for (const [who, file] of Object.entries(FILES) as [Citizen, string][]) {
      jobs.push(get(file, ['Walk', 'Idle', 'Run'], 160).then((model) => model && this.walkers.set(who, model)));
    }
    for (const who of CYCLISTS) jobs.push(get(`${FILES[who]}_bicycle`, ['Bicycle'], 80).then((model) => model && this.riders.set(`bicycle:${who}`, model)));
    for (const who of SCOOTERISTS) jobs.push(get(`${FILES[who]}_motorcycle`, ['Motorcycle'], 120).then((model) => model && this.riders.set(`motorcycle:${who}`, model)));
    await Promise.all(jobs);
    this.ready = this.walkers.size === Object.keys(FILES).length;
  }

  model(who: Citizen, ride: Ride = 'walk'): Model | null {
    return (ride === 'walk' ? this.walkers.get(who) : this.riders.get(`${ride}:${who}`)) ?? null;
  }

  /** Metres covered by one cycle of a model's clip. */
  stride(model: Model, clip: ClipName): number {
    return model.clips[clip]?.stride ?? 1;
  }

  begin(): void {
    for (const k of [...this.walkers.values(), ...this.riders.values()]) k.count = 0;
  }

  /**
   * Draw one at `matrix` playing `clip`, `cycle` cycles in (any real number; only the fraction counts). `shirt` and
   * `paint` colour the parts marked to dye; -1 keeps the model's own. False when that model is already full.
   */
  add(model: Model, matrix: THREE.Matrix4, clip: ClipName, cycle: number, shirt = -1, paint = -1): boolean {
    const c = model.clips[clip];
    if (!c || model.count >= model.cap) return false;
    const i = model.count++;
    const frame = Math.floor((cycle - Math.floor(cycle)) * c.frames) % c.frames;
    model.mesh.setMatrixAt(i, this.m.copy(matrix));
    const g = model.mesh.geometry;
    (g.getAttribute('animRow') as THREE.InstancedBufferAttribute).setX(i, c.row + frame);
    this.colour(g.getAttribute('shirt') as THREE.InstancedBufferAttribute, i, shirt, model, 1);
    this.colour(g.getAttribute('paint') as THREE.InstancedBufferAttribute, i, paint, model, 2);
    return true;
  }

  /** Set an instance's dye colour, or the model's own colour for that part when `hex` is -1. */
  private colour(a: THREE.InstancedBufferAttribute, i: number, hex: number, model: Model, mark: 1 | 2): void {
    if (hex < 0) {
      const [r, g, b] = model.own[mark];
      a.setXYZ(i, r, g, b);
      return;
    }
    this.c.setHex(hex);
    a.setXYZ(i, this.c.r, this.c.g, this.c.b);
  }

  end(): void {
    for (const k of [...this.walkers.values(), ...this.riders.values()]) {
      k.mesh.count = k.count;
      if (!k.count) continue;
      k.mesh.instanceMatrix.needsUpdate = true;
      const g = k.mesh.geometry;
      for (const a of ['animRow', 'shirt', 'paint']) g.getAttribute(a).needsUpdate = true;
    }
  }
}

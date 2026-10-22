import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROAD_WIDTH, type RoadNetwork } from '../sim/roads';
import { type Junction, STOP_BACK } from '../sim/signals';
import type { Traffic } from '../sim/traffic';

const MAX = 2000;
const COLORS = { green: new THREE.Color(0x3ddc6e), yellow: new THREE.Color(0xffc93c), red: new THREE.Color(0xff4b3e) };

/** Pole on the kerb with an arm reaching over the lane and a signal head facing +x (towards traffic). */
function pole(): THREE.BufferGeometry {
  const post = new THREE.BoxGeometry(0.3, 5.2, 0.3).translate(0, 2.6, 0);
  const arm = new THREE.BoxGeometry(0.2, 0.2, 3.6).translate(0, 5, 1.8);
  const head = new THREE.BoxGeometry(0.6, 0.8, 1.9).translate(0, 4.6, 3.2);
  return mergeGeometries([post, arm, head])!;
}

/** The one lamp that is lit, on the face of the head. */
function lamp(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(0.12, 0.55, 0.55).translate(0.33, 4.6, 3.2);
}

/** Traffic lights at every signalled junction, lit in the colour each approach sees. */
export class SignalLayer {
  readonly group = new THREE.Group();
  private poles: THREE.InstancedMesh;
  private lamps: THREE.InstancedMesh;
  private built: Map<number, Junction> | null = null;
  /** the junction and phase behind each instance */
  private slots: { j: Junction; phase: number }[] = [];

  constructor(shadows: boolean) {
    this.poles = new THREE.InstancedMesh(pole(), new THREE.MeshLambertMaterial({ color: 0x3c4148, flatShading: true }), MAX);
    this.lamps = new THREE.InstancedMesh(lamp(), new THREE.MeshBasicMaterial(), MAX);
    this.poles.castShadow = shadows;
    for (const m of [this.poles, this.lamps]) {
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  private build(net: RoadNetwork, junctions: Map<number, Junction>): void {
    this.built = junctions;
    this.slots = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    for (const j of junctions.values()) {
      const n = net.nodes.get(j.node);
      if (!n || n.h < -1) continue;
      for (const a of j.approaches) {
        if (this.slots.length >= MAX) break;
        // Traffic comes in along -out and keeps right, so the pole stands on the kerb to its right
        const side = ROAD_WIDTH / 2 + 0.6;
        p.set(n.p.x + a.out.x * STOP_BACK + a.out.y * side, n.h, n.p.y + a.out.y * STOP_BACK - a.out.x * side);
        q.setFromAxisAngle(up, Math.atan2(-a.out.y, a.out.x));
        m.compose(p, q, one);
        const i = this.slots.length;
        this.poles.setMatrixAt(i, m);
        this.lamps.setMatrixAt(i, m);
        this.slots.push({ j, phase: a.phase });
      }
    }
    this.poles.count = this.lamps.count = this.slots.length;
    this.poles.instanceMatrix.needsUpdate = true;
    this.lamps.instanceMatrix.needsUpdate = true;
  }

  update(traffic: Traffic, net: RoadNetwork): void {
    const junctions = traffic.junctions();
    if (junctions !== this.built) this.build(net, junctions);
    this.slots.forEach((s, i) => this.lamps.setColorAt(i, COLORS[traffic.lightOf(s.j, s.phase)]));
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
}

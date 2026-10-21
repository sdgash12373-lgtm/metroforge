import * as THREE from 'three';
import { type Quad, type Sample, type Vec2, normalize, sampleQuad } from '../sim/geometry';
import { ROAD_WIDTH, type RoadNetwork } from '../sim/roads';

const ASPHALT_WIDTH = 7;
const DASH = 3;
const GAP = 3;
const MARK_WIDTH = 0.25;

/** Accumulates triangles in sim coordinates at a fixed height. */
class Builder {
  pos: number[] = [];
  idx: number[] = [];
  constructor(private y: number) {}

  quad(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): void {
    const i = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(p[0], this.y, p[1]);
    this.idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
  }

  disc(x: number, z: number, r: number, sides = 20): void {
    const i = this.pos.length / 3;
    this.pos.push(x, this.y, z);
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      this.pos.push(x + Math.cos(a) * r, this.y, z + Math.sin(a) * r);
    }
    for (let k = 0; k < sides; k++) this.idx.push(i, i + 1 + ((k + 1) % sides), i + 1 + k);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

function normalAt(s: Sample[], i: number): { x: number; y: number } {
  const a = s[Math.max(0, i - 1)];
  const b = s[Math.min(s.length - 1, i + 1)];
  const t = normalize({ x: b.x - a.x, y: b.y - a.y });
  return { x: -t.y, y: t.x };
}

function ribbon(b: Builder, s: Sample[], width: number): void {
  const h = width / 2;
  for (let i = 1; i < s.length; i++) {
    const n0 = normalAt(s, i - 1);
    const n1 = normalAt(s, i);
    const p0 = s[i - 1];
    const p1 = s[i];
    b.quad(
      [p0.x + n0.x * h, p0.y + n0.y * h],
      [p0.x - n0.x * h, p0.y - n0.y * h],
      [p1.x + n1.x * h, p1.y + n1.y * h],
      [p1.x - n1.x * h, p1.y - n1.y * h],
    );
  }
}

function dashes(b: Builder, s: Sample[], skip: number, width = MARK_WIDTH): void {
  const len = s[s.length - 1].s;
  let j = 1;
  for (let start = skip; start + DASH < len - skip; start += DASH + GAP) {
    const pts: Sample[] = [];
    for (const d of [start, start + DASH]) {
      while (j < s.length - 1 && s[j].s < d) j++;
      const a = s[j - 1];
      const c = s[j];
      const f = (d - a.s) / (c.s - a.s || 1);
      pts.push({ x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f, t: 0, s: d });
    }
    ribbon(b, pts, width);
  }
}

export interface RoadGeometries {
  sidewalk: THREE.BufferGeometry;
  asphalt: THREE.BufferGeometry;
  markings: THREE.BufferGeometry;
}

export function buildRoadGeometries(net: RoadNetwork): RoadGeometries {
  const walk = new Builder(0.04);
  const asphalt = new Builder(0.07);
  const marks = new Builder(0.1);
  for (const seg of net.segments.values()) {
    ribbon(walk, seg.samples, ROAD_WIDTH);
    ribbon(asphalt, seg.samples, ASPHALT_WIDTH);
    dashes(marks, seg.samples, ROAD_WIDTH * 0.6);
  }
  for (const n of net.nodes.values()) {
    walk.disc(n.p.x, n.p.y, ROAD_WIDTH / 2);
    asphalt.disc(n.p.x, n.p.y, ASPHALT_WIDTH / 2);
  }
  return { sidewalk: walk.geometry(), asphalt: asphalt.geometry(), markings: marks.geometry() };
}

/** Ghost road shown while drawing. */
export function buildPreviewGeometry(q: Quad): THREE.BufferGeometry {
  const b = new Builder(0.15);
  const s = sampleQuad(q, 32);
  ribbon(b, s, ROAD_WIDTH);
  b.disc(q.a.x, q.a.y, ROAD_WIDTH / 2);
  b.disc(q.b.x, q.b.y, ROAD_WIDTH / 2);
  return b.geometry();
}

/** Dashed straight lines on the ground, e.g. alignment guides. */
export function buildDashedLines(lines: { from: Vec2; to: Vec2 }[], width: number): THREE.BufferGeometry {
  const b = new Builder(0.4);
  for (const l of lines) {
    const len = Math.hypot(l.to.x - l.from.x, l.to.y - l.from.y);
    dashes(b, [{ ...l.from, t: 0, s: 0 }, { ...l.to, t: 1, s: len }], 0, width);
  }
  return b.geometry();
}

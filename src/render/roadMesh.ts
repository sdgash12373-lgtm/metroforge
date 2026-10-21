import * as THREE from 'three';
import { type Quad, type Sample, type Vec2, normalize, sampleQuad } from '../sim/geometry';
import { ROAD_WIDTH, type RoadNetwork, type RoadSegment } from '../sim/roads';

const ASPHALT_WIDTH = 7;
const DASH = 3;
const GAP = 3;
const MARK_WIDTH = 0.25;

/** Accumulates triangles in sim coordinates at a fixed height. */
class Builder {
  pos: number[] = [];
  idx: number[] = [];
  col: number[] = [];
  /** vertex colour for the quads that follow, when building a coloured mesh */
  color: THREE.Color | null = null;
  constructor(private y: number) {}

  quad(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): void {
    const i = this.pos.length / 3;
    for (const p of [a, b, c, d]) {
      this.pos.push(p[0], this.y, p[1]);
      if (this.color) this.col.push(this.color.r, this.color.g, this.color.b);
    }
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
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
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

/** Strip along a curve between two signed offsets from its centre line. */
function strip(b: Builder, s: Sample[], from: number, to: number): void {
  for (let i = 1; i < s.length; i++) {
    const n0 = normalAt(s, i - 1);
    const n1 = normalAt(s, i);
    const p0 = s[i - 1];
    const p1 = s[i];
    b.quad(
      [p0.x + n0.x * to, p0.y + n0.y * to],
      [p0.x + n0.x * from, p0.y + n0.y * from],
      [p1.x + n1.x * to, p1.y + n1.y * to],
      [p1.x + n1.x * from, p1.y + n1.y * from],
    );
  }
}

function ribbon(b: Builder, s: Sample[], width: number): void {
  strip(b, s, -width / 2, width / 2);
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

const FREE = new THREE.Color(0x4cc36b);
const BUSY = new THREE.Color(0xf2c230);
const JAMMED = new THREE.Color(0xe5483b);

/** Green → yellow → red by how full a lane is. */
export function congestionColor(level: number, out: THREE.Color): THREE.Color {
  if (level < 0.5) return out.copy(FREE).lerp(BUSY, level / 0.5);
  return out.copy(BUSY).lerp(JAMMED, Math.min(1, (level - 0.5) / 0.4));
}

/** Each direction of each road coloured by its congestion, laid over the asphalt. */
export function buildTrafficOverlay(net: RoadNetwork, level: (seg: RoadSegment, dir: 1 | -1) => number): THREE.BufferGeometry {
  const b = new Builder(0.12);
  const half = ASPHALT_WIDTH / 2;
  for (const seg of net.segments.values()) {
    // Right-hand traffic: travel a → b uses the right side of that direction
    b.color = congestionColor(level(seg, 1), new THREE.Color());
    strip(b, seg.samples, 0.15, half);
    b.color = congestionColor(level(seg, -1), new THREE.Color());
    strip(b, seg.samples, -half, -0.15);
  }
  return b.geometry();
}

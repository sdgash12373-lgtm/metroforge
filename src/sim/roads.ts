import {
  type BBox,
  type Quad,
  type Sample,
  type Vec2,
  bboxNear,
  bboxOf,
  bboxOverlap,
  closestOnSamples,
  curveIntersections,
  dist,
  lerp,
  quadPoint,
  sampleQuad,
  splitQuad,
} from './geometry';
import type { Lot } from './zoning';

/** Two 3.5 m lanes plus 1.5 m sidewalks. */
export const ROAD_WIDTH = 10;
/** Shortest road piece we keep; anything shorter is folded into a junction. */
export const MIN_SEGMENT = 4;

export interface RoadNode {
  id: number;
  p: Vec2;
}

export interface RoadSegment {
  id: number;
  a: number;
  b: number;
  /** quadratic control point */
  c: Vec2;
  samples: Sample[];
  length: number;
  bbox: BBox;
  lots: Lot[];
}

export type Snap =
  | { kind: 'node'; node: RoadNode; p: Vec2 }
  | { kind: 'segment'; seg: RoadSegment; t: number; p: Vec2 }
  | { kind: 'free'; p: Vec2 };

export interface NetworkListener {
  /** A segment was created. `from` is set when it is a piece of a segment that was split. */
  added(seg: RoadSegment, from?: RoadSegment): void;
  removed(seg: RoadSegment): void;
}

export class RoadNetwork {
  nodes = new Map<number, RoadNode>();
  segments = new Map<number, RoadSegment>();
  nextNode = 1;
  nextSeg = 1;
  listener: NetworkListener | null = null;

  quad(seg: RoadSegment): Quad {
    return { a: this.node(seg.a).p, c: seg.c, b: this.node(seg.b).p };
  }

  node(id: number): RoadNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`missing road node ${id}`);
    return n;
  }

  addNode(p: Vec2, id?: number): RoadNode {
    const n = { id: id ?? this.nextNode++, p: { x: p.x, y: p.y } };
    this.nextNode = Math.max(this.nextNode, n.id + 1);
    this.nodes.set(n.id, n);
    return n;
  }

  createSegment(a: number, b: number, c: Vec2, from?: RoadSegment, id?: number): RoadSegment {
    const seg: RoadSegment = {
      id: id ?? this.nextSeg++,
      a,
      b,
      c: { x: c.x, y: c.y },
      samples: [],
      length: 0,
      bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      lots: [],
    };
    this.nextSeg = Math.max(this.nextSeg, seg.id + 1);
    const q = this.quad(seg);
    seg.samples = sampleQuad(q, Math.max(8, Math.min(48, Math.ceil(dist(q.a, q.b) / 4))));
    seg.length = seg.samples[seg.samples.length - 1].s;
    seg.bbox = bboxOf(seg.samples);
    this.segments.set(seg.id, seg);
    this.listener?.added(seg, from);
    return seg;
  }

  degree(nodeId: number): number {
    let d = 0;
    for (const s of this.segments.values()) if (s.a === nodeId || s.b === nodeId) d++;
    return d;
  }

  connected(a: number, b: number): RoadSegment | null {
    for (const s of this.segments.values()) if ((s.a === a && s.b === b) || (s.a === b && s.b === a)) return s;
    return null;
  }

  snap(p: Vec2, radius: number): Snap {
    let bestNode: RoadNode | null = null;
    let bd = radius;
    for (const n of this.nodes.values()) {
      const d = dist(n.p, p);
      if (d < bd) {
        bd = d;
        bestNode = n;
      }
    }
    if (bestNode) return { kind: 'node', node: bestNode, p: bestNode.p };
    const hit = this.segmentAt(p, radius);
    if (hit) return { kind: 'segment', seg: hit.seg, t: hit.t, p: quadPoint(this.quad(hit.seg), hit.t) };
    return { kind: 'free', p: { x: p.x, y: p.y } };
  }

  segmentAt(p: Vec2, radius: number): { seg: RoadSegment; t: number; d: number } | null {
    let best: { seg: RoadSegment; t: number; d: number } | null = null;
    for (const seg of this.segments.values()) {
      if (!bboxNear(seg.bbox, p, radius)) continue;
      const r = closestOnSamples(seg.samples, p);
      if (r.d < radius && (!best || r.d < best.d)) best = { seg, t: r.t, d: r.d };
    }
    return best;
  }

  /** Turns a snap into a node, splitting a segment if needed. */
  resolve(s: Snap): RoadNode {
    if (s.kind === 'node') return s.node;
    if (s.kind === 'segment') return this.split(s.seg, s.t);
    // A free point exactly on an existing road still joins it
    const exact = this.snap(s.p, 0.5);
    if (exact.kind !== 'free') return this.resolve(exact);
    return this.addNode(s.p);
  }

  /** Splits a segment at t. Returns the existing end node when t is too close to an end. */
  split(seg: RoadSegment, t: number): RoadNode {
    const q = this.quad(seg);
    const p = quadPoint(q, t);
    if (dist(p, q.a) < MIN_SEGMENT) return this.node(seg.a);
    if (dist(p, q.b) < MIN_SEGMENT) return this.node(seg.b);
    const [q1, q2] = splitQuad(q, t);
    const n = this.addNode(p);
    this.segments.delete(seg.id);
    this.createSegment(seg.a, n.id, q1.c, seg);
    this.createSegment(n.id, seg.b, q2.c, seg);
    this.listener?.removed(seg);
    return n;
  }

  /**
   * Builds a road from start to end (control = null for straight). Snaps both ends,
   * and splits wherever the new road crosses an existing one so every crossing is a junction.
   */
  addRoad(start: Snap, control: Vec2 | null, end: Snap): RoadSegment[] {
    const A = this.resolve(start);
    // Resolving the start may have split the segment the end was snapped to
    const B = this.resolve(end.kind === 'segment' ? this.snap(end.p, 0.5) : end);
    if (A.id === B.id) return [];
    const quad: Quad = { a: A.p, c: control ?? lerp(A.p, B.p, 0.5), b: B.p };
    const samples = sampleQuad(quad, 48);
    const box = bboxOf(samples);

    // Collect crossings with existing roads, away from the two ends
    const hits: { ta: number; p: Vec2 }[] = [];
    for (const seg of this.segments.values()) {
      if (!bboxOverlap(box, seg.bbox, 1)) continue;
      for (const x of curveIntersections(samples, seg.samples)) {
        const p = quadPoint(quad, x.ta);
        if (dist(p, A.p) < MIN_SEGMENT || dist(p, B.p) < MIN_SEGMENT) continue;
        hits.push({ ta: x.ta, p });
      }
    }
    hits.sort((x, y) => x.ta - y.ta);

    // Turn crossings into junction nodes (each may split an existing segment)
    const chain: { node: RoadNode; t: number }[] = [{ node: A, t: 0 }];
    for (const h of hits) {
      const node = this.resolve(this.snap(h.p, 1));
      const last = chain[chain.length - 1];
      if (node.id !== last.node.id && dist(node.p, last.node.p) >= MIN_SEGMENT) chain.push({ node, t: h.ta });
    }
    if (chain.length > 1 && dist(chain[chain.length - 1].node.p, B.p) < MIN_SEGMENT) chain.pop();
    chain.push({ node: B, t: 1 });

    // Cut the curve at each junction and create one segment per piece
    const created: RoadSegment[] = [];
    let rest = quad;
    let prevT = 0;
    for (let i = 1; i < chain.length; i++) {
      const { node, t } = chain[i];
      let piece: Quad;
      if (i === chain.length - 1) piece = rest;
      else {
        const [p1, p2] = splitQuad(rest, (t - prevT) / (1 - prevT));
        piece = p1;
        rest = p2;
        prevT = t;
      }
      const from = chain[i - 1].node;
      const existing = this.connected(from.id, node.id);
      if (existing && control === null) continue;
      created.push(this.createSegment(from.id, node.id, piece.c));
    }
    return created;
  }

  removeSegment(id: number): void {
    const seg = this.segments.get(id);
    if (!seg) return;
    this.segments.delete(id);
    this.listener?.removed(seg);
    for (const n of [seg.a, seg.b]) if (this.degree(n) === 0) this.nodes.delete(n);
  }

  /** Approximate cost-relevant length of a prospective road. */
  static previewLength(a: Vec2, c: Vec2 | null, b: Vec2): number {
    const s = sampleQuad({ a, c: c ?? lerp(a, b, 0.5), b }, 16);
    return s[s.length - 1].s;
  }
}

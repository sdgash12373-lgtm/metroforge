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
export const LANE_WIDTH = 3.5;
/** Extra width each side for a wide, tree-lined sidewalk (人行道). */
export const WALK_EXTRA = 2.5;
/** Lanes each way a road can be upgraded to: 雙向單線道, 雙向雙線道, 雙向四線道. */
export const LANE_CHOICES = [1, 2, 4] as const;
export type LaneCount = (typeof LANE_CHOICES)[number];

/** What a road's width depends on. */
type Widths = { lanes?: number; walk?: boolean; oneway?: boolean; ring?: boolean };
/** Width of the asphalt: lanes each way, both ways; a one-way road's lanes all go its way. */
export const asphaltWidth = (seg: Widths): number => (seg.lanes ?? 1) * (seg.oneway && !seg.ring ? 1 : 2) * LANE_WIDTH;
/** Full width, kerb to kerb including sidewalks. */
export const roadWidth = (seg: Widths): number =>
  asphaltWidth(seg) + (ROAD_WIDTH - 2 * LANE_WIDTH) + (seg.walk ? WALK_EXTRA * 2 : 0);
/** Shortest road piece we keep; anything shorter is folded into a junction. */
export const MIN_SEGMENT = 4;
/** Deck height of elevated roads, enough for traffic to pass underneath. */
export const ELEVATED_HEIGHT = 8;
/** Depth of tunnels (negative height). */
export const TUNNEL_DEPTH = -8;
/** Roads closer in height than this at a crossing meet in a junction; otherwise one passes over the other. */
export const LEVEL_TOLERANCE = 4;
/** Steepest average slope a ramp may have (18 %). */
export const MAX_GRADE = 0.18;

/** Eases height along a segment so ramps start and end flat. */
const ease = (t: number) => t * t * (3 - 2 * t);

export interface RoadNode {
  id: number;
  p: Vec2;
  /** height above ground; 0 for street level */
  h: number;
}

/** What kind of road a new segment is, set before its lots are laid out. */
export type RoadFlags = Pick<RoadSegment, 'ring' | 'ramp' | 'highway' | 'built' | 'lanes'>;

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
  /** traffic only drives a → b: roundabouts, one-way streets (單行道) and ramps (匝道) */
  oneway: boolean;
  /** part of a roundabout's ring */
  ring?: boolean;
  /** a ramp (匝道): one-way, it may join a freeway */
  ramp?: boolean;
  /** a freeway the player built, which may be torn down unlike the region's own 國道 */
  built?: boolean;
  /** street name the player gave it */
  name?: string;
  /** lanes each way (1 when unset) */
  lanes?: LaneCount;
  /** wide sidewalks with street trees */
  walk?: boolean;
  /** part of a freeway or its interchange ramps: joined only by ramps, never rebuilt */
  highway?: boolean;
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

  addNode(p: Vec2, id?: number, h = 0): RoadNode {
    const n = { id: id ?? this.nextNode++, p: { x: p.x, y: p.y }, h };
    this.nextNode = Math.max(this.nextNode, n.id + 1);
    this.nodes.set(n.id, n);
    return n;
  }

  /** New segment a → b. Pieces of a split segment keep its one-way setting. */
  createSegment(a: number, b: number, c: Vec2, from?: RoadSegment, id?: number, oneway = from?.oneway ?? false, kind?: RoadFlags): RoadSegment {
    const seg: RoadSegment = {
      ...kind,
      oneway,
      name: from?.name,
      ...(from?.lanes && from.lanes > 1 ? { lanes: from.lanes } : {}),
      ...(from?.walk ? { walk: true } : {}),
      ...(from?.highway ? { highway: true } : {}),
      ...(from?.ring ? { ring: true } : {}),
      ...(from?.ramp ? { ramp: true } : {}),
      ...(from?.built ? { built: true } : {}),
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

  /** Road height at curve parameter t. */
  heightAt(seg: RoadSegment, t: number): number {
    const ha = this.node(seg.a).h;
    const hb = this.node(seg.b).h;
    return ha + (hb - ha) * ease(t);
  }

  /** True when any part of the segment is off the ground (elevated road or ramp). */
  isRaised(seg: RoadSegment): boolean {
    return this.node(seg.a).h > 0 || this.node(seg.b).h > 0;
  }

  /** An ordinary road at ground level, two-way or one-way: the kind buildings and bus stops can front onto. */
  isStreet(seg: RoadSegment): boolean {
    return !seg.ring && !seg.ramp && !seg.highway && this.node(seg.a).h === 0 && this.node(seg.b).h === 0;
  }

  /** Height a snap would join the network at (free points take `free`). */
  snapHeight(s: Snap, free: number): number {
    if (s.kind === 'node') return s.node.h;
    if (s.kind === 'segment') return this.heightAt(s.seg, s.t);
    return free;
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

  /**
   * Nearest node, else nearest road, within radius. With a height, roads on that level win;
   * other levels are only used when nothing on the level is in reach.
   */
  snap(p: Vec2, radius: number, h?: number): Snap {
    if (h !== undefined) {
      const level = this.snapLevel(p, radius, h);
      if (level.kind !== 'free') return level;
    }
    return this.snapLevel(p, radius);
  }

  snapLevel(p: Vec2, radius: number, h?: number): Snap {
    let bestNode: RoadNode | null = null;
    let bd = radius;
    for (const n of this.nodes.values()) {
      if (h !== undefined && Math.abs(n.h - h) >= LEVEL_TOLERANCE) continue;
      const d = dist(n.p, p);
      if (d < bd) {
        bd = d;
        bestNode = n;
      }
    }
    if (bestNode) return { kind: 'node', node: bestNode, p: bestNode.p };
    const hit = this.segmentAt(p, radius, h);
    if (hit) return { kind: 'segment', seg: hit.seg, t: hit.t, p: quadPoint(this.quad(hit.seg), hit.t) };
    return { kind: 'free', p: { x: p.x, y: p.y } };
  }

  /** Nearest road within radius; with a height, only roads at that level there. */
  segmentAt(p: Vec2, radius: number, h?: number): { seg: RoadSegment; t: number; d: number } | null {
    let best: { seg: RoadSegment; t: number; d: number } | null = null;
    for (const seg of this.segments.values()) {
      if (!bboxNear(seg.bbox, p, radius)) continue;
      const r = closestOnSamples(seg.samples, p);
      if (h !== undefined && Math.abs(this.heightAt(seg, r.t) - h) >= LEVEL_TOLERANCE) continue;
      if (r.d < radius && (!best || r.d < best.d)) best = { seg, t: r.t, d: r.d };
    }
    return best;
  }

  /** Turns a snap into a node, splitting a segment if needed. New free nodes sit at height h. */
  resolve(s: Snap, h = 0): RoadNode {
    if (s.kind === 'node') return s.node;
    if (s.kind === 'segment') return this.split(s.seg, s.t);
    // A free point exactly on an existing road at the same level still joins it
    const exact = this.snapLevel(s.p, 0.5, h);
    if (exact.kind !== 'free') return this.resolve(exact);
    return this.addNode(s.p, undefined, h);
  }

  /** Splits a segment at t. Returns the existing end node when t is too close to an end. */
  split(seg: RoadSegment, t: number): RoadNode {
    const q = this.quad(seg);
    const p = quadPoint(q, t);
    if (dist(p, q.a) < MIN_SEGMENT) return this.node(seg.a);
    if (dist(p, q.b) < MIN_SEGMENT) return this.node(seg.b);
    const [q1, q2] = splitQuad(q, t);
    const n = this.addNode(p, undefined, this.heightAt(seg, t));
    this.segments.delete(seg.id);
    this.createSegment(seg.a, n.id, q1.c, seg);
    this.createSegment(n.id, seg.b, q2.c, seg);
    this.listener?.removed(seg);
    return n;
  }

  /**
   * Builds a road from start to end (control = null for straight). Snaps both ends, and splits
   * wherever the new road crosses an existing one at the same level so those crossings are junctions.
   * Free ends are placed at `height`; an end on an existing road takes that road's height, which makes ramps.
   */
  addRoad(start: Snap, control: Vec2 | null, end: Snap, height = 0, oneway = false, kind?: RoadFlags): RoadSegment[] {
    const A = this.resolve(start, height);
    // Resolving the start may have split the segment the end was snapped to
    const B = this.resolve(end.kind === 'segment' ? this.snap(end.p, 0.5, this.heightAt(end.seg, end.t)) : end, height);
    if (A.id === B.id) return [];
    const quad: Quad = { a: A.p, c: control ?? lerp(A.p, B.p, 0.5), b: B.p };
    const samples = sampleQuad(quad, 48);
    const box = bboxOf(samples);

    // Collect crossings with existing roads, away from the two ends
    const hits: { ta: number; p: Vec2; h: number }[] = [];
    for (const seg of this.segments.values()) {
      if (!bboxOverlap(box, seg.bbox, 1)) continue;
      for (const x of curveIntersections(samples, seg.samples)) {
        const p = quadPoint(quad, x.ta);
        if (dist(p, A.p) < MIN_SEGMENT || dist(p, B.p) < MIN_SEGMENT) continue;
        const h = A.h + (B.h - A.h) * ease(x.ta);
        // Grade-separated: one road passes over the other
        if (Math.abs(h - this.heightAt(seg, x.tb)) >= LEVEL_TOLERANCE) continue;
        hits.push({ ta: x.ta, p, h });
      }
    }
    hits.sort((x, y) => x.ta - y.ta);

    // Turn crossings into junction nodes (each may split an existing segment)
    const chain: { node: RoadNode; t: number }[] = [{ node: A, t: 0 }];
    for (const h of hits) {
      const node = this.resolve(this.snap(h.p, 1, h.h), h.h);
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
      created.push(this.createSegment(from.id, node.id, piece.c, undefined, undefined, oneway, kind));
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

  /**
   * The street a segment belongs to: it and the segments that carry straight on from it through
   * junctions (turning less than 35°), at the same level. Roundabouts are left out.
   */
  street(seg: RoadSegment): RoadSegment[] {
    const out = [seg];
    const seen = new Set([seg.id]);
    const level = (s: RoadSegment) => this.node(s.a).h + this.node(s.b).h;
    // Unit direction leaving `node` along s
    const away = (s: RoadSegment, node: number) => {
      const S = s.samples;
      const [p, q] = s.a === node ? [S[0], S[Math.min(2, S.length - 1)]] : [S[S.length - 1], S[Math.max(0, S.length - 3)]];
      const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      return { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
    };
    for (const start of [seg.a, seg.b]) {
      let cur = seg;
      let node = start;
      for (let guard = 0; guard < 500; guard++) {
        const back = away(cur, node);
        let best: { s: RoadSegment; dot: number } | null = null;
        for (const o of this.segments.values()) {
          if (seen.has(o.id) || o.ring || o.oneway !== seg.oneway || (o.a !== node && o.b !== node) || Math.abs(level(o) - level(cur)) > LEVEL_TOLERANCE) continue;
          const d = away(o, node);
          // Straight on means leaving opposite to where we came in
          const dot = -(d.x * back.x + d.y * back.y);
          if (dot > Math.cos((35 * Math.PI) / 180) && (!best || dot > best.dot)) best = { s: o, dot };
        }
        if (!best) break;
        seen.add(best.s.id);
        out.push(best.s);
        node = best.s.a === node ? best.s.b : best.s.a;
        cur = best.s;
      }
    }
    return out;
  }

  /** Approximate cost-relevant length of a prospective road. */
  static previewLength(a: Vec2, c: Vec2 | null, b: Vec2): number {
    const s = sampleQuad({ a, c: c ?? lerp(a, b, 0.5), b }, 16);
    return s[s.length - 1].s;
  }
}

import * as THREE from 'three';
import { type Quad, type Sample, type Vec2, normalize, sampleQuad } from '../sim/geometry';
import { LANE_WIDTH, ROAD_WIDTH, type RoadNetwork, type RoadSegment, asphaltWidth, roadWidth } from '../sim/roads';
import { CAR_LINE, CROSSWALK, type Junction, SCOOTER_LINE, TURN_BOX, findJunctions } from '../sim/signals';
import { LANE_OFFSET } from '../sim/traffic';
import type { PathPiece } from '../sim/transit';

const DASH = 3;
const GAP = 3;
const MARK_WIDTH = 0.25;
/** Taiwan's road paint: white lines and boxes, yellow centre lines between the two directions */
const WHITE = new THREE.Color(0xf4f4ef);
const YELLOW = new THREE.Color(0xf2b632);
/** Depth of the concrete girder under an elevated deck. */
const GIRDER = 1.4;
const PILLAR_EVERY = 28;
const PILLAR_SIZE = 1.8;
/** Depth at which a tunnel ramp goes under the ground through a portal. */
export const PORTAL_DEPTH = -5;
const PORTAL_HEIGHT = 5.6;

/** Height along a curve, by curve parameter t. */
export type Height = (t: number) => number;
export const FLAT: Height = () => 0;

/** Accumulates triangles in sim coordinates, `y` above the given heights. */
export class Builder {
  pos: number[] = [];
  idx: number[] = [];
  col: number[] = [];
  /** vertex colour for the quads that follow, when building a coloured mesh */
  color: THREE.Color | null = null;
  constructor(private y: number) {}

  /** Points are [x, z] on the ground, or [x, z, height]. */
  quad(a: number[], b: number[], c: number[], d: number[]): void {
    const i = this.pos.length / 3;
    for (const p of [a, b, c, d]) {
      this.pos.push(p[0], this.y + (p[2] ?? 0), p[1]);
      if (this.color) this.col.push(this.color.r, this.color.g, this.color.b);
    }
    this.idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
  }

  disc(x: number, z: number, r: number, h = 0, sides = 20): void {
    const i = this.pos.length / 3;
    this.pos.push(x, this.y + h, z);
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      this.pos.push(x + Math.cos(a) * r, this.y + h, z + Math.sin(a) * r);
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

export function normalAt(s: Sample[], i: number): { x: number; y: number } {
  const a = s[Math.max(0, i - 1)];
  const b = s[Math.min(s.length - 1, i + 1)];
  const t = normalize({ x: b.x - a.x, y: b.y - a.y });
  return { x: -t.y, y: t.x };
}

/** Strip along a curve between two signed offsets from its centre line. */
export function strip(b: Builder, s: Sample[], from: number, to: number, h: Height = FLAT): void {
  for (let i = 1; i < s.length; i++) {
    const n0 = normalAt(s, i - 1);
    const n1 = normalAt(s, i);
    const p0 = s[i - 1];
    const p1 = s[i];
    const h0 = h(p0.t);
    const h1 = h(p1.t);
    b.quad(
      [p0.x + n0.x * to, p0.y + n0.y * to, h0],
      [p0.x + n0.x * from, p0.y + n0.y * from, h0],
      [p1.x + n1.x * to, p1.y + n1.y * to, h1],
      [p1.x + n1.x * from, p1.y + n1.y * from, h1],
    );
  }
}

export function ribbon(b: Builder, s: Sample[], width: number, h: Height = FLAT): void {
  strip(b, s, -width / 2, width / 2, h);
}

/** Vertical wall hanging under a curve at a signed offset, from its height down by `depth`. */
export function wall(b: Builder, s: Sample[], offset: number, depth: number, h: Height): void {
  for (let i = 1; i < s.length; i++) {
    const n0 = normalAt(s, i - 1);
    const n1 = normalAt(s, i);
    const p0 = s[i - 1];
    const p1 = s[i];
    const h0 = h(p0.t);
    const h1 = h(p1.t);
    if (h0 < 0.3 && h1 < 0.3) continue;
    const x0 = p0.x + n0.x * offset;
    const z0 = p0.y + n0.y * offset;
    const x1 = p1.x + n1.x * offset;
    const z1 = p1.y + n1.y * offset;
    b.quad([x0, z0, h0], [x0, z0, Math.max(0, h0 - depth)], [x1, z1, h1], [x1, z1, Math.max(0, h1 - depth)]);
  }
}

/** Upright box from the ground to `top`, centred on (x, z), turned to face along (dx, dz). */
export function pillar(b: Builder, x: number, z: number, dx: number, dz: number, w: number, d: number, top: number, bottom = 0): void {
  const nx = -dz;
  const nz = dx;
  const c = (u: number, v: number) => [x + dx * u + nx * v, z + dz * u + nz * v];
  const corners = [c(-d / 2, -w / 2), c(d / 2, -w / 2), c(d / 2, w / 2), c(-d / 2, w / 2)];
  for (let k = 0; k < 4; k++) {
    const p = corners[k];
    const q = corners[(k + 1) % 4];
    b.quad([p[0], p[1], top], [p[0], p[1], bottom], [q[0], q[1], top], [q[0], q[1], bottom]);
  }
  const [k0, k1, k2, k3] = corners;
  b.quad([k0[0], k0[1], top], [k1[0], k1[1], top], [k3[0], k3[1], top], [k2[0], k2[1], top]);
}

export function dashes(b: Builder, s: Sample[], skip: number, width = MARK_WIDTH, h: Height = FLAT, skipEnd = skip): void {
  const len = s[s.length - 1].s;
  let j = 1;
  for (let start = skip; start + DASH < len - skipEnd; start += DASH + GAP) {
    const pts: Sample[] = [];
    for (const d of [start, start + DASH]) {
      while (j < s.length - 1 && s[j].s < d) j++;
      const a = s[j - 1];
      const c = s[j];
      const f = (d - a.s) / (c.s - a.s || 1);
      pts.push({ x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f, t: a.t + (c.t - a.t) * f, s: d });
    }
    ribbon(b, pts, width, h);
  }
}

export interface RoadGeometries {
  sidewalk: THREE.BufferGeometry;
  asphalt: THREE.BufferGeometry;
  markings: THREE.BufferGeometry;
  /** girders and pillars of elevated roads, tunnel portals */
  concrete: THREE.BufferGeometry;
  /** tunnel openings */
  dark: THREE.BufferGeometry;
  /** noise barrier panels along freeways */
  barriers: THREE.BufferGeometry;
  /** street light poles and arms along ground-level streets */
  lampPosts: THREE.BufferGeometry;
  /** their lamp heads, lit at night */
  lampHeads: THREE.BufferGeometry;
  /** pools of their light on the road, added over it at night */
  lampPools: THREE.BufferGeometry;
}

export const isTunnelRamp = (net: RoadNetwork, seg: RoadSegment): boolean => {
  const ha = net.node(seg.a).h;
  const hb = net.node(seg.b).h;
  return Math.min(ha, hb) < 0 && Math.max(ha, hb) === 0;
};

/**
 * Height a road is drawn at. The ground has no holes, so a tunnel ramp is drawn at street level up to
 * its portal and drops out of sight there.
 */
export function shownHeight(net: RoadNetwork, seg: RoadSegment): Height {
  const ha = net.node(seg.a).h;
  const hb = net.node(seg.b).h;
  if (ha === 0 && hb === 0) return FLAT;
  if (!isTunnelRamp(net, seg)) return (t) => net.heightAt(seg, t);
  return (t) => {
    const h = net.heightAt(seg, t);
    return h > PORTAL_DEPTH ? 0 : h;
  };
}

const segHeight = shownHeight;

/** Low walls along a tunnel ramp up to its portal: two posts, a beam, and the dark opening between them. */
export function portal(b: Builder, dark: Builder, s: Sample[], depth: Height, width = ROAD_WIDTH): void {
  for (const side of [-1, 1]) {
    const off = side * (width / 2 + 0.2);
    for (let i = 1; i < s.length; i++) {
      const h0 = depth(s[i - 1].t);
      const h1 = depth(s[i].t);
      if ((h0 > -0.2 && h1 > -0.2) || (h0 <= PORTAL_DEPTH && h1 <= PORTAL_DEPTH)) continue;
      const n0 = normalAt(s, i - 1);
      const n1 = normalAt(s, i);
      // Walls rise as the road would sink: up to the portal's beam at the mouth
      const w0 = Math.min(PORTAL_HEIGHT, 0.9 + (-h0 / -PORTAL_DEPTH) * (PORTAL_HEIGHT - 0.9));
      const w1 = Math.min(PORTAL_HEIGHT, 0.9 + (-h1 / -PORTAL_DEPTH) * (PORTAL_HEIGHT - 0.9));
      const p0 = [s[i - 1].x + n0.x * off, s[i - 1].y + n0.y * off];
      const p1 = [s[i].x + n1.x * off, s[i].y + n1.y * off];
      b.quad([p0[0], p0[1], w0], [p0[0], p0[1], 0], [p1[0], p1[1], w1], [p1[0], p1[1], 0]);
    }
  }
  for (let i = 1; i < s.length; i++) {
    const h0 = depth(s[i - 1].t);
    const h1 = depth(s[i].t);
    if (h0 > PORTAL_DEPTH === h1 > PORTAL_DEPTH) continue;
    const p = s[h0 > PORTAL_DEPTH ? i : i - 1];
    const d = normalize({ x: s[i].x - s[i - 1].x, y: s[i].y - s[i - 1].y });
    const n = { x: -d.y, y: d.x };
    const half = width / 2 + 0.6;
    for (const side of [-1, 1]) pillar(b, p.x + n.x * half * side, p.y + n.y * half * side, d.x, d.y, 1.2, 1.6, PORTAL_HEIGHT);
    pillar(b, p.x, p.y, d.x, d.y, half * 2 + 1.2, 1.6, PORTAL_HEIGHT, PORTAL_HEIGHT - 1.2);
    const l = [p.x - n.x * half, p.y - n.y * half];
    const r = [p.x + n.x * half, p.y + n.y * half];
    dark.quad([l[0], l[1], PORTAL_HEIGHT - 1.2], [l[0], l[1], 0], [r[0], r[1], PORTAL_HEIGHT - 1.2], [r[0], r[1], 0]);
  }
}

/** Girders along both edges and a pillar every so often where the deck is high enough to need one. */
export function supports(b: Builder, s: Sample[], h: Height, width = ROAD_WIDTH): void {
  wall(b, s, width / 2, GIRDER, h);
  wall(b, s, -width / 2, GIRDER, h);
  const len = s[s.length - 1].s;
  let j = 1;
  for (let d = PILLAR_EVERY / 2; d < len; d += PILLAR_EVERY) {
    while (j < s.length - 1 && s[j].s < d) j++;
    const a = s[j - 1];
    const c = s[j];
    const f = (d - a.s) / (c.s - a.s || 1);
    const top = h(a.t + (c.t - a.t) * f);
    if (top < GIRDER + 1.5) continue;
    const dir = normalize({ x: c.x - a.x, y: c.y - a.y });
    pillar(b, a.x + (c.x - a.x) * f, a.y + (c.y - a.y) * f, dir.x, dir.y, width * 0.5, PILLAR_SIZE, top - GIRDER * 0.5);
  }
}

/** Widest road meeting at each node, so junction discs cover every approach. */
export function nodeWidths(net: RoadNetwork): Map<number, { full: number; asphalt: number }> {
  const out = new Map<number, { full: number; asphalt: number }>();
  for (const seg of net.segments.values()) {
    for (const id of [seg.a, seg.b]) {
      const w = out.get(id) ?? { full: 0, asphalt: 0 };
      w.full = Math.max(w.full, roadWidth(seg));
      w.asphalt = Math.max(w.asphalt, seg.ring ? asphaltWidth({}) : asphaltWidth(seg));
      out.set(id, w);
    }
  }
  return out;
}

/** Spots for street trees along roads with wide sidewalks (人行道), each side, kept clear of junctions. */
export function streetTreeSpots(net: RoadNetwork, every = 10): { x: number; y: number; h: number }[] {
  const out: { x: number; y: number; h: number }[] = [];
  for (const seg of net.segments.values()) {
    if (!seg.walk || !net.isStreet(seg)) continue;
    const s = seg.samples;
    const len = s[s.length - 1].s;
    const off = asphaltWidth(seg) / 2 + 1.3;
    let j = 1;
    for (let d = 9; d < len - 9; d += every) {
      while (j < s.length - 1 && s[j].s < d) j++;
      const a = s[j - 1];
      const c = s[j];
      const f = (d - a.s) / (c.s - a.s || 1);
      const n = normalAt(s, j);
      const x = a.x + (c.x - a.x) * f;
      const y = a.y + (c.y - a.y) * f;
      for (const side of [-1, 1]) out.push({ x: x + n.x * off * side, y: y + n.y * off * side, h: 0 });
    }
  }
  return out;
}

/** Where paint along a segment stops short of each end: behind the stop line at a signalled junction. */
function paintSkip(seg: RoadSegment, junctions: Map<number, Junction>): [number, number] {
  const plain = roadWidth(seg) * 0.6;
  const at = (node: number) => {
    const j = junctions.get(node);
    return j ? j.edge + CAR_LINE + 0.6 : plain;
  };
  return [at(seg.a), at(seg.b)];
}

/**
 * Markings: a yellow centre line (dashed on two-lane roads, double on wider ones), white lane dashes, and a white
 * edge line along each side.
 */
function laneMarks(marks: Builder, seg: RoadSegment, h: Height, [skipA, skipB]: [number, number]): void {
  const lanes = seg.lanes ?? 1;
  const half = asphaltWidth(seg) / 2;
  const s = trimmed(seg.samples, skipA, skipB);
  if (s.length < 2) return;
  marks.color = WHITE;
  for (const side of [-1, 1]) strip(marks, s, side * (half - 0.35), side * (half - 0.2), h);
  for (let k = 1; k < lanes; k++) {
    for (const side of [-1, 1]) dashes(marks, offsetSamples(seg.samples, side * k * LANE_WIDTH), skipA, MARK_WIDTH * 0.6, h, skipB);
  }
  marks.color = YELLOW;
  if (lanes === 1) dashes(marks, seg.samples, skipA, MARK_WIDTH * 0.6, h, skipB);
  else for (const side of [-1, 1]) strip(marks, s, side * 0.1, side * 0.25, h);
}

/**
 * Paint on a one-way road: edge lines, dashed lines between its lanes, and an arrow in every lane every so often
 * pointing the way traffic goes (a → b).
 */
function onewayMarks(marks: Builder, seg: RoadSegment, h: Height, [skipA, skipB]: [number, number]): void {
  const lanes = seg.lanes ?? 1;
  const half = asphaltWidth(seg) / 2;
  const s = trimmed(seg.samples, skipA, skipB);
  if (s.length < 2) return;
  marks.color = WHITE;
  for (const side of [-1, 1]) strip(marks, s, side * (half - 0.35), side * (half - 0.2), h);
  for (let k = 1; k < lanes; k++) dashes(marks, offsetSamples(seg.samples, -half + k * LANE_WIDTH), skipA, MARK_WIDTH * 0.6, h, skipB);
  const len = seg.length;
  const free = len - skipA - skipB;
  if (free < ARROW_LENGTH + 2) return;
  const count = Math.max(1, Math.floor(free / ARROW_EVERY));
  for (let i = 0; i < count; i++) {
    const d = skipA + (free * (i + 0.5)) / count - ARROW_LENGTH / 2;
    for (let k = 0; k < lanes; k++) arrow(marks, seg.samples, d, -half + (k + 0.5) * LANE_WIDTH, h);
  }
}

/** Length of a direction arrow painted on a one-way road, and how far apart they are. */
const ARROW_LENGTH = 5;
const ARROW_EVERY = 30;

/** An arrow on the road starting `d` along it at `offset` across, pointing the way the samples run. */
function arrow(marks: Builder, s: Sample[], d: number, offset: number, h: Height): void {
  const tail = along(s, d);
  const neck = along(s, d + ARROW_LENGTH * 0.6);
  const tip = along(s, d + ARROW_LENGTH);
  const pt = (f: ReturnType<typeof along>, o: number) => [f.x - f.dy * (offset + o), f.y + f.dx * (offset + o), h(f.t)];
  marks.quad(pt(tail, -0.15), pt(tail, 0.15), pt(neck, -0.15), pt(neck, 0.15));
  marks.quad(pt(neck, -0.6), pt(neck, 0.6), pt(tip, 0), pt(tip, 0));
}

/** Point and direction a distance along a curve. */
function along(s: Sample[], d: number): { x: number; y: number; t: number; dx: number; dy: number } {
  let j = 1;
  while (j < s.length - 1 && s[j].s < d) j++;
  const a = s[j - 1];
  const c = s[j];
  const f = Math.max(0, Math.min(1, (d - a.s) / (c.s - a.s || 1)));
  const l = Math.hypot(c.x - a.x, c.y - a.y) || 1;
  return { x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f, t: a.t + (c.t - a.t) * f, dx: (c.x - a.x) / l, dy: (c.y - a.y) / l };
}

/**
 * The paint on one approach to a signalled junction, `end` the segment's end at the junction. Distances are back
 * from the junction centre and offsets are to the right of traffic coming in.
 */
function junctionMarks(marks: Builder, seg: RoadSegment, end: 'a' | 'b', j: Junction, h: Height): void {
  const half = asphaltWidth(seg) / 2;
  const len = seg.length;
  if (len / 2 < j.edge + CAR_LINE + 0.6) {
    // Too short for the whole layout: just the crossing, if it fits
    if (len / 2 < j.edge + CROSSWALK[1]) return;
  }
  const full = len / 2 >= j.edge + CAR_LINE + 0.6;
  // Coming in to b, traffic keeps to the +normal side; coming in to a, to the -normal side
  const sign = end === 'b' ? 1 : -1;
  const rect = (d0: number, d1: number, o0: number, o1: number) => {
    const p = along(seg.samples, end === 'b' ? len - d0 : d0);
    const q = along(seg.samples, end === 'b' ? len - d1 : d1);
    const pt = (f: typeof p, o: number) => [f.x - f.dy * o * sign, f.y + f.dx * o * sign, h(f.t)];
    marks.quad(pt(p, o0), pt(p, o1), pt(q, o0), pt(q, o1));
  };
  // Outline of a box, lines `w` wide
  const box = (d0: number, d1: number, o0: number, o1: number, w = 0.15) => {
    rect(d0, d0 + w, o0, o1);
    rect(d1 - w, d1, o0, o1);
    rect(d0, d1, o0, o0 + w);
    rect(d0, d1, o1 - w, o1);
  };
  const e = j.edge;
  marks.color = WHITE;
  // Zebra crossing: bars along the road, all the way across
  for (let o = -half + 0.3; o + 0.45 <= half - 0.2; o += 0.9) rect(e + CROSSWALK[0], e + CROSSWALK[1], o, o + 0.45);
  if (!full) return;
  // 機車待轉區 in the kerb lane, just ahead of the crossing, for scooters turning left in two stages
  box(e + TURN_BOX[0], e + TURN_BOX[1], half - LANE_WIDTH + 0.5, half - 0.4);
  // 機車停等區 across the incoming lanes, with the scooters' stop line at its front and the cars' behind it
  rect(e + SCOOTER_LINE, e + SCOOTER_LINE + 0.4, 0.3, half - 0.2);
  rect(e + CAR_LINE, e + CAR_LINE + 0.4, 0.3, half - 0.2);
  for (const o of [0.3, half - 0.35]) rect(e + SCOOTER_LINE, e + CAR_LINE, o, o + 0.15);
  // A scooter drawn in the box: two wheels and a body
  const mid = (0.3 + half) / 2;
  const d = e + (SCOOTER_LINE + CAR_LINE) / 2 + 0.2;
  rect(d - 0.9, d + 0.9, mid - 0.06, mid + 0.06);
  for (const k of [-0.75, 0.75]) rect(d + k - 0.18, d + k + 0.18, mid - 0.2, mid + 0.2);
  rect(d - 0.3, d + 0.2, mid - 0.25, mid + 0.25);
}

/** The samples between `skip` from the start and `skipEnd` from the end. */
function trimmed(s: Sample[], skip: number, skipEnd = skip): Sample[] {
  const len = s[s.length - 1].s;
  return s.filter((p) => p.s >= skip && p.s <= len - skipEnd);
}

/** A curve moved sideways by a signed offset, its distances measured anew. */
export function offsetSamples(s: Sample[], off: number): Sample[] {
  const out: Sample[] = [];
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    const n = normalAt(s, i);
    const p = { x: s[i].x + n.x * off, y: s[i].y + n.y * off, t: s[i].t, s: 0 };
    if (i > 0) d += Math.hypot(p.x - out[i - 1].x, p.y - out[i - 1].y);
    p.s = d;
    out.push(p);
  }
  return out;
}

export function buildRoadGeometries(net: RoadNetwork): RoadGeometries {
  const walk = new Builder(0.04);
  const asphalt = new Builder(0.07);
  const marks = new Builder(0.1);
  marks.color = WHITE;
  const junctions = findJunctions(net);
  const concrete = new Builder(0);
  const dark = new Builder(0);
  const panels = new Builder(0);
  const posts = new Builder(0);
  const heads = new Builder(0);
  const pools = new Builder(0.12);
  for (const seg of net.segments.values()) {
    const h = segHeight(net, seg);
    const raised = net.isRaised(seg);
    const full = roadWidth(seg);
    // Raised decks go with the concrete so they cast shadows on the streets below
    ribbon(raised ? concrete : walk, seg.samples, full, h);
    ribbon(asphalt, seg.samples, seg.ring ? asphaltWidth({}) : asphaltWidth(seg), h);
    // Roundabouts have no paint; one-way roads and ramps get lane lines and arrows the way traffic goes
    if (seg.ring) {
      // nothing
    } else if (seg.oneway) onewayMarks(marks, seg, h, paintSkip(seg, junctions));
    else {
      laneMarks(marks, seg, h, paintSkip(seg, junctions));
      for (const end of ['a', 'b'] as const) {
        const j = junctions.get(end === 'a' ? seg.a : seg.b);
        if (j && net.node(j.node).h >= 0) junctionMarks(marks, seg, end, j, h);
      }
    }
    if (seg.highway) noiseBarriers(net, seg, concrete, panels, h);
    if (net.isStreet(seg)) streetLights(seg, posts, heads, pools);
    if (raised) supports(concrete, seg.samples, h, full);
    // Tunnel mouths: the ramp between street level and a tunnel
    else if (isTunnelRamp(net, seg)) portal(concrete, dark, seg.samples, (t) => net.heightAt(seg, t), full);
  }
  const widths = nodeWidths(net);
  for (const n of net.nodes.values()) {
    const w = widths.get(n.id) ?? { full: ROAD_WIDTH, asphalt: asphaltWidth({}) };
    (n.h > 0 ? concrete : walk).disc(n.p.x, n.p.y, w.full / 2, n.h);
    asphalt.disc(n.p.x, n.p.y, w.asphalt / 2, n.h);
    // Elevated junctions stand on a pillar of their own
    if (n.h > GIRDER + 1.5) pillar(concrete, n.p.x, n.p.y, 1, 0, PILLAR_SIZE * 1.4, PILLAR_SIZE * 1.4, n.h - GIRDER * 0.5);
  }
  return {
    sidewalk: walk.geometry(),
    asphalt: asphalt.geometry(),
    markings: marks.geometry(),
    concrete: concrete.geometry(),
    dark: dark.geometry(),
    barriers: panels.geometry(),
    lampPosts: posts.geometry(),
    lampHeads: heads.geometry(),
    lampPools: pools.geometry(),
  };
}

/** Street lights: one every LAMP_SPACING along a street, on alternate sides, and on both sides of wide roads. */
const LAMP_SPACING = 32;
const LAMP_HEIGHT = 8.5;
/** how far the arm reaches out over the road from the pole */
const LAMP_ARM = 2.6;
/** no lamps this close to a segment's ends, where junctions are */
const LAMP_END = 10;

/**
 * Taiwan's grey street lights: a slim pole at the kerb, a short arm out over the road with a flat LED head at its
 * tip, and a pool of warm light on the asphalt beneath at night.
 */
function streetLights(seg: RoadSegment, posts: Builder, heads: Builder, pools: Builder): void {
  const len = seg.length;
  if (len < LAMP_END * 2 + 4) return;
  const both = (seg.lanes ?? 1) > 1;
  const kerb = asphaltWidth(seg) / 2 + 0.6;
  const s = seg.samples;
  const count = Math.max(1, Math.floor((len - LAMP_END * 2) / LAMP_SPACING) + 1);
  const step = count > 1 ? (len - LAMP_END * 2) / (count - 1) : 0;
  let i = 1;
  for (let k = 0; k < count; k++) {
    const at = count > 1 ? LAMP_END + k * step : len / 2;
    while (i < s.length - 1 && s[i].s < at) i++;
    const a = s[i - 1];
    const b = s[i];
    const f = (at - a.s) / Math.max(1e-6, b.s - a.s);
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    const n = normalAt(s, i);
    for (const side of both ? [1, -1] : [k % 2 ? 1 : -1]) {
      const px = x + n.x * kerb * side;
      const py = y + n.y * kerb * side;
      // The arm reaches back over the road
      const ex = px - n.x * LAMP_ARM * side;
      const ey = py - n.y * LAMP_ARM * side;
      bar(posts, px, py, px, py, 0, LAMP_HEIGHT, 0.24);
      bar(posts, px, py, ex, ey, LAMP_HEIGHT - 0.12, LAMP_HEIGHT + 0.06, 0.14);
      const hx = ex - n.x * 0.5 * side;
      const hy = ey - n.y * 0.5 * side;
      bar(heads, ex + n.x * 0.1 * side, ey + n.y * 0.1 * side, hx, hy, LAMP_HEIGHT - 0.28, LAMP_HEIGHT - 0.04, 0.42);
      pools.disc((ex + hx) / 2, (ey + hy) / 2, 5.5, 0, 12);
    }
  }
}

/** A bar `w` thick from (ax, ay) to (bx, by) between heights z0 and z1; with both ends the same, an upright post. */
function bar(b: Builder, ax: number, ay: number, bx: number, by: number, z0: number, z1: number, w: number): void {
  const len = Math.hypot(bx - ax, by - ay);
  const h = w / 2;
  const c =
    len < 0.01
      ? [[ax - h, ay - h], [ax + h, ay - h], [ax + h, ay + h], [ax - h, ay + h]]
      : (() => {
          const nx = (-(by - ay) / len) * h;
          const ny = ((bx - ax) / len) * h;
          return [[ax - nx, ay - ny], [bx - nx, by - ny], [bx + nx, by + ny], [ax + nx, ay + ny]];
        })();
  for (let k = 0; k < 4; k++) {
    const p = c[k];
    const q = c[(k + 1) % 4];
    b.quad([p[0], p[1], z1], [p[0], p[1], z0], [q[0], q[1], z1], [q[0], q[1], z0]);
  }
  b.quad([c[0][0], c[0][1], z1], [c[1][0], c[1][1], z1], [c[3][0], c[3][1], z1], [c[2][0], c[2][1], z1]);
}

/** Height of a freeway's noise barrier: a low concrete parapet with panels on top. */
const PARAPET = 0.9;
const BARRIER = 3.2;
/** How far back from a junction the barrier stops, to leave room for ramps to join. */
const BARRIER_GAP = 36;

/**
 * Noise barriers (隔音牆) along both edges of a freeway: a concrete parapet with panels above it. They stop short
 * of junctions with ramps so the ramps can be seen joining, and run on through plain joins between freeway pieces.
 */
function noiseBarriers(net: RoadNetwork, seg: RoadSegment, base: Builder, panels: Builder, h: Height): void {
  const gap = (node: number) => {
    const touching = [...net.segments.values()].filter((o) => o !== seg && (o.a === node || o.b === node));
    return touching.length === 1 && touching[0].highway ? 0 : touching.length ? BARRIER_GAP : 0;
  };
  const s = trimmed(seg.samples, gap(seg.a), gap(seg.b));
  if (s.length < 2) return;
  const edge = roadWidth(seg) / 2 - 0.25;
  for (const side of [-1, 1]) {
    upright(base, s, side * edge, h, 0, PARAPET);
    upright(panels, s, side * edge, h, PARAPET, BARRIER);
  }
}

/** An upright strip along a curve, `offset` across it, from `lo` to `hi` above the road's height. */
function upright(b: Builder, s: Sample[], offset: number, h: Height, lo: number, hi: number): void {
  for (let i = 1; i < s.length; i++) {
    const n0 = normalAt(s, i - 1);
    const n1 = normalAt(s, i);
    const p = [s[i - 1].x + n0.x * offset, s[i - 1].y + n0.y * offset];
    const q = [s[i].x + n1.x * offset, s[i].y + n1.y * offset];
    const hp = h(s[i - 1].t);
    const hq = h(s[i].t);
    b.quad([p[0], p[1], hp + hi], [p[0], p[1], hp + lo], [q[0], q[1], hq + hi], [q[0], q[1], hq + lo]);
  }
}

/** Ghost road shown while drawing, rising from height ha to hb like a built ramp would. */
export function buildPreviewGeometry(q: Quad, ha = 0, hb = 0): THREE.BufferGeometry {
  const b = new Builder(0.15);
  const s = sampleQuad(q, 32);
  const h: Height = (t) => ha + (hb - ha) * t * t * (3 - 2 * t);
  ribbon(b, s, ROAD_WIDTH, h);
  b.disc(q.a.x, q.a.y, ROAD_WIDTH / 2, ha);
  b.disc(q.b.x, q.b.y, ROAD_WIDTH / 2, hb);
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
  for (const seg of net.segments.values()) {
    const half = seg.ring ? asphaltWidth({}) / 2 : asphaltWidth(seg) / 2;
    // Right-hand traffic: travel a → b uses the right side of that direction
    const h = segHeight(net, seg);
    b.color = congestionColor(level(seg, 1), new THREE.Color());
    if (seg.oneway) {
      strip(b, seg.samples, -half, half, h);
      continue;
    }
    strip(b, seg.samples, 0.15, half, h);
    b.color = congestionColor(level(seg, -1), new THREE.Color());
    strip(b, seg.samples, -half, -0.15, h);
  }
  return b.geometry();
}

/** The part of a lane between two travel distances, as samples in travel order. */
function lanePiece(seg: RoadSegment, piece: PathPiece): Sample[] {
  const S = seg.samples;
  const len = seg.length;
  const lo = piece.dir === 1 ? piece.from : len - piece.to;
  const hi = piece.dir === 1 ? piece.to : len - piece.from;
  const at = (d: number): Sample => {
    let j = 1;
    while (j < S.length - 1 && S[j].s < d) j++;
    const a = S[j - 1];
    const c = S[j];
    const f = Math.max(0, Math.min(1, (d - a.s) / (c.s - a.s || 1)));
    return { x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f, t: a.t + (c.t - a.t) * f, s: d };
  };
  const out = [at(lo), ...S.filter((p) => p.s > lo && p.s < hi), at(hi)];
  return piece.dir === 1 ? out : out.reverse();
}

/** Bus routes drawn on the lanes they use, one colour per line. */
export function buildLinePaths(net: RoadNetwork, lines: { color: number; path: PathPiece[] }[], width = 1.4, offset = LANE_OFFSET): THREE.BufferGeometry {
  const b = new Builder(0.2);
  for (const line of lines) {
    b.color = new THREE.Color(line.color);
    for (const piece of line.path) {
      const seg = net.segments.get(piece.seg);
      if (!seg || piece.to - piece.from < 0.1) continue;
      strip(b, lanePiece(seg, piece), offset - width / 2, offset + width / 2, segHeight(net, seg));
    }
  }
  return b.geometry();
}

/** Tunnels drawn on the surface above them, for the underground view. */
export function buildTunnelOverlay(net: RoadNetwork): THREE.BufferGeometry {
  const b = new Builder(0.35);
  for (const seg of net.segments.values()) {
    if (net.node(seg.a).h >= 0 && net.node(seg.b).h >= 0) continue;
    ribbon(b, seg.samples, roadWidth(seg));
    dashes(b, seg.samples, ROAD_WIDTH * 0.6, MARK_WIDTH * 2);
  }
  const widths = nodeWidths(net);
  for (const n of net.nodes.values()) if (n.h < 0) b.disc(n.p.x, n.p.y, (widths.get(n.id)?.full ?? ROAD_WIDTH) / 2);
  return b.geometry();
}

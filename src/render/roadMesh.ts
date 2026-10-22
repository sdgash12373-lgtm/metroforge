import * as THREE from 'three';
import { type Quad, type Sample, type Vec2, normalize, sampleQuad } from '../sim/geometry';
import { LANE_WIDTH, ROAD_WIDTH, type RoadNetwork, type RoadSegment, asphaltWidth, roadWidth } from '../sim/roads';
import { LANE_OFFSET } from '../sim/traffic';
import type { PathPiece } from '../sim/transit';

const DASH = 3;
const GAP = 3;
const MARK_WIDTH = 0.25;
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

export function dashes(b: Builder, s: Sample[], skip: number, width = MARK_WIDTH, h: Height = FLAT): void {
  const len = s[s.length - 1].s;
  let j = 1;
  for (let start = skip; start + DASH < len - skip; start += DASH + GAP) {
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
      w.asphalt = Math.max(w.asphalt, seg.oneway ? asphaltWidth({}) : asphaltWidth(seg));
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

/** Markings: a dashed centre line on two-lane roads, a double centre line and lane dashes on wider ones. */
function laneMarks(marks: Builder, seg: RoadSegment, h: Height): void {
  const lanes = seg.lanes ?? 1;
  const skip = roadWidth(seg) * 0.6;
  if (lanes === 1) {
    dashes(marks, seg.samples, skip, MARK_WIDTH, h);
    return;
  }
  const s = trimmed(seg.samples, skip);
  if (s.length < 2) return;
  for (const side of [-1, 1]) strip(marks, s, side * 0.15, side * (0.15 + MARK_WIDTH * 0.8), h);
  for (let k = 1; k < lanes; k++) {
    for (const side of [-1, 1]) dashes(marks, offsetSamples(seg.samples, side * k * LANE_WIDTH), skip, MARK_WIDTH, h);
  }
}

/** The samples between `skip` from each end. */
function trimmed(s: Sample[], skip: number): Sample[] {
  const len = s[s.length - 1].s;
  return s.filter((p) => p.s >= skip && p.s <= len - skip);
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
  const concrete = new Builder(0);
  const dark = new Builder(0);
  for (const seg of net.segments.values()) {
    const h = segHeight(net, seg);
    const raised = net.isRaised(seg);
    const full = roadWidth(seg);
    // Raised decks go with the concrete so they cast shadows on the streets below
    ribbon(raised ? concrete : walk, seg.samples, full, h);
    ribbon(asphalt, seg.samples, seg.oneway ? asphaltWidth({}) : asphaltWidth(seg), h);
    // One-way roads (roundabouts) have no centre line
    if (!seg.oneway) laneMarks(marks, seg, h);
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
  };
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
    const half = seg.oneway ? asphaltWidth({}) / 2 : asphaltWidth(seg) / 2;
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

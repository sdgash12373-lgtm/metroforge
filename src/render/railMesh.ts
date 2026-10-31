import type * as THREE from 'three';
import type { Sample } from '../sim/geometry';
import * as THREE_ from 'three';
import { type RailKind, TRACK_OFFSET } from '../sim/rail';
import { ROAD_WIDTH, type RoadNetwork } from '../sim/roads';
import { Builder, type Height, PORTAL_DEPTH, isTunnelRamp, normalAt, pillar, ribbon, shownHeight, strip, supports } from './roadMesh';

const BALLAST_WIDTH = 9.4;
const GAUGE = 1.44;
const SLEEPER_EVERY = 1.6;
const MAST_EVERY = 48;
const MAST_HEIGHT = 7;

/** Inside half-width of the open cutting a track sinks through on its way into a tunnel. */
export const CUTTING_HALF = BALLAST_WIDTH / 2 + 0.7;
const CUTTING_WALL = 0.6;
/** Parapet of the cutting walls above the ground. */
const PARAPET = 1.1;
/** Height of the ground mask over the cutting: above the ground, below track laid at street level. */
const MASK_HEIGHT = 0.03;

export interface TrackParts {
  ballast: THREE.BufferGeometry;
  sleepers: THREE.BufferGeometry;
  steel: THREE.BufferGeometry;
  /** viaducts, pillars, portals, cutting walls and catenary masts */
  concrete: THREE.BufferGeometry;
  /** tunnel openings */
  dark: THREE.BufferGeometry;
}

export interface TrackGeometries extends TrackParts {
  /**
   * Track sinking into a tunnel through an open cutting (引道): drawn before the ground mask, so it shows
   * below street level through the hole the mask makes in the ground.
   */
  sunk: TrackParts;
  /** the openings in the ground over the cuttings, depth only */
  mask: THREE.BufferGeometry;
}

interface Builders {
  ballast: Builder;
  sleepers: Builder;
  steel: Builder;
  concrete: Builder;
  dark: Builder;
}

/**
 * How each kind of track looks, so they are told apart at a glance: Taiwan Railway's on brown ballast with timber-
 * coloured sleepers, the high-speed line on pale concrete slabs, the metro on a dark bed with a yellow third rail.
 */
export const TRACK_LOOK: Record<RailKind, { bed: number; ties: number; rail: number; every: number; tieLen: number; masts: boolean; third: boolean; tunnel: number }> = {
  train: { bed: 0x968d82, ties: 0x6b5a48, rail: 0xa7adb3, every: SLEEPER_EVERY, tieLen: 0.28, masts: true, third: false, tunnel: 0xd2603c },
  hsr: { bed: 0xcfcdc6, ties: 0x9da2a6, rail: 0xb8bec4, every: 5.1, tieLen: 4.8, masts: true, third: false, tunnel: 0xf2a33a },
  metro: { bed: 0x76828a, ties: 0x8b8f93, rail: 0xa7adb3, every: SLEEPER_EVERY, tieLen: 0.28, masts: false, third: true, tunnel: 0x2fbf7f },
};
const THIRD_RAIL = 0xe8b830;

const builders = (kind: RailKind): Builders => {
  const look = TRACK_LOOK[kind];
  const b = {
    ballast: new Builder(0.06),
    sleepers: new Builder(0.16),
    steel: new Builder(0.3),
    concrete: new Builder(0),
    dark: new Builder(0),
  };
  b.ballast.color = new THREE_.Color(look.bed);
  b.sleepers.color = new THREE_.Color(look.ties);
  b.steel.color = new THREE_.Color(look.rail);
  return b;
};

const parts = (b: Builders): TrackParts => ({
  ballast: b.ballast.geometry(),
  sleepers: b.sleepers.geometry(),
  steel: b.steel.geometry(),
  concrete: b.concrete.geometry(),
  dark: b.dark.geometry(),
});

/**
 * The open cutting (引道) where track leaves street level for a tunnel: a concrete trough whose floor follows
 * the track down, walls standing a parapet above the ground, and the tunnel portal where the track is deep
 * enough to pass under the ground. The mask opens the ground over the trough, so the sinking track and a
 * train climbing out of the dark mouth show from above.
 */
function cutting(b: Builders, mask: Builder, s: Sample[], depth: Height): void {
  const { concrete, dark } = b;
  // Up to the portal: the first sample deep enough for the tunnel to close over the track
  let end = s.length - 1;
  let start = 0;
  const deep = (i: number) => depth(s[i].t) <= PORTAL_DEPTH;
  if (deep(0)) {
    // The ramp climbs from the tunnel: walk it backwards
    start = s.length - 1;
    end = 0;
  }
  const step = start < end ? 1 : -1;
  let mouth = end;
  for (let i = start; i !== end; i += step) {
    if (deep(i)) {
      mouth = i;
      break;
    }
  }
  // Track coming down from a viaduct: the cutting starts where it reaches the ground
  while (start !== mouth && depth(s[start].t) > 0.05) start += step;
  const lo = Math.min(start, mouth);
  const hi = Math.max(start, mouth);
  const span = s.slice(lo, hi + 1);
  if (span.length < 2) return;
  const h: Height = (t) => depth(t);
  const inner = CUTTING_HALF;
  const outer = CUTTING_HALF + CUTTING_WALL;
  // Floor, a little under the ballast
  strip(concrete, span, -inner, inner, (t) => h(t) - 0.05);
  for (const side of [-1, 1]) {
    for (let i = 1; i < span.length; i++) {
      const n0 = normalAt(span, i - 1);
      const n1 = normalAt(span, i);
      const p0 = span[i - 1];
      const p1 = span[i];
      const at = (p: Sample, n: { x: number; y: number }, off: number) => [p.x + n.x * off * side, p.y + n.y * off * side];
      const a0 = at(p0, n0, inner);
      const a1 = at(p1, n1, inner);
      const b0 = at(p0, n0, outer);
      const b1 = at(p1, n1, outer);
      // Inner face from the floor up to the parapet, its top, and the outer face of the parapet
      concrete.quad([a0[0], a0[1], PARAPET], [a0[0], a0[1], h(p0.t) - 0.05], [a1[0], a1[1], PARAPET], [a1[0], a1[1], h(p1.t) - 0.05]);
      concrete.quad([a0[0], a0[1], PARAPET], [a1[0], a1[1], PARAPET], [b0[0], b0[1], PARAPET], [b1[0], b1[1], PARAPET]);
      concrete.quad([b0[0], b0[1], PARAPET], [b0[0], b0[1], 0], [b1[0], b1[1], PARAPET], [b1[0], b1[1], 0]);
    }
    // The end at street level: a low cap closing the parapet
    const p = span[start < mouth ? 0 : span.length - 1];
    const n = normalAt(span, start < mouth ? 0 : span.length - 1);
    const a = [p.x + n.x * inner * side, p.y + n.y * inner * side];
    const c = [p.x + n.x * outer * side, p.y + n.y * outer * side];
    concrete.quad([a[0], a[1], PARAPET], [a[0], a[1], 0], [c[0], c[1], PARAPET], [c[0], c[1], 0]);
  }
  // Open the ground over the trough
  strip(mask, span, -outer, outer, () => MASK_HEIGHT);
  // The portal: a headwall across the mouth from the tunnel's roof up past the parapet, the dark tunnel in it
  const m = s[mouth];
  const prev = s[mouth - step] ?? s[mouth];
  const d = { x: m.x - prev.x, y: m.y - prev.y };
  const len = Math.hypot(d.x, d.y) || 1;
  const dx = d.x / len;
  const dy = d.y / len;
  const floor = depth(m.t);
  const roof = floor + 4.6;
  const half = outer + 1.2;
  const nx = -dy;
  const ny = dx;
  // Headwall face, with wing piers either side and a coping on top
  pillar(concrete, m.x, m.y, dx, dy, half * 2, 1.2, PARAPET + 0.5, roof);
  for (const side of [-1, 1]) pillar(concrete, m.x + nx * (outer + 0.6) * side, m.y + ny * (outer + 0.6) * side, dx, dy, 1.2, 1.4, PARAPET + 0.5, floor - 0.1);
  // The tunnel beyond the mouth: dark walls, roof and back, so what is inside stays out of sight until it comes out
  const back = 0.2;
  const fx = m.x - dx * (0.6 - back);
  const fy = m.y - dy * (0.6 - back);
  const L = [fx + nx * inner, fy + ny * inner];
  const R = [fx - nx * inner, fy - ny * inner];
  dark.quad([L[0], L[1], roof], [L[0], L[1], floor - 0.1], [R[0], R[1], roof], [R[0], R[1], floor - 0.1]);
}

/** Point, direction and normal at distance d along samples. */
function at(s: Sample[], d: number, j: { i: number }): { x: number; y: number; t: number; dx: number; dy: number } {
  while (j.i < s.length - 1 && s[j.i].s < d) j.i++;
  const a = s[j.i - 1];
  const c = s[j.i];
  const f = (d - a.s) / (c.s - a.s || 1);
  const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
  return { x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f, t: a.t + (c.t - a.t) * f, dx: (c.x - a.x) / len, dy: (c.y - a.y) / len };
}

/**
 * Double track: a ballast bed with sleepers and two pairs of rails. Raised track stands on a viaduct,
 * and track going underground passes through a portal like a road tunnel.
 */
export function buildTrackGeometries(net: RoadNetwork, kind: RailKind): TrackGeometries {
  const look = TRACK_LOOK[kind];
  const masts = look.masts;
  const main = builders(kind);
  const sunk = builders(kind);
  const third = new THREE_.Color(THIRD_RAIL);
  const mask = new Builder(0);
  for (const seg of net.segments.values()) {
    const s = seg.samples;
    const raised = net.isRaised(seg);
    // Into a tunnel from street level, or straight down from a viaduct
    const ramp = isTunnelRamp(net, seg) || (raised && Math.min(net.node(seg.a).h, net.node(seg.b).h) < 0);
    // Track into a tunnel sinks through its cutting, at its true height
    const h: Height = ramp ? (t) => net.heightAt(seg, t) : shownHeight(net, seg);
    const { ballast, sleepers, steel, concrete } = ramp ? sunk : main;
    if (raised) {
      ribbon(concrete, s, ROAD_WIDTH, (t) => h(t) - 0.02);
      supports(concrete, s, h);
    }
    if (ramp) cutting(sunk, mask, s, h);
    ribbon(ballast, s, BALLAST_WIDTH, h);
    for (const side of [-1, 1]) {
      const c = side * TRACK_OFFSET;
      for (const r of [c - GAUGE / 2, c + GAUGE / 2]) strip(steel, s, r - 0.08, r + 0.08, h);
      // The metro's third rail, under its yellow cover, outside each track
      if (look.third) {
        const rail = steel.color;
        steel.color = third;
        const r = c + side * (GAUGE / 2 + 0.7);
        strip(steel, s, r - 0.16, r + 0.16, h);
        steel.color = rail;
      }
    }
    const j = { i: 1 };
    for (let d = look.every / 2; d < seg.length; d += look.every) {
      const p = at(s, d, j);
      const hh = h(p.t);
      for (const side of [-1, 1]) {
        const cx = p.x - p.dy * TRACK_OFFSET * side;
        const cy = p.y + p.dx * TRACK_OFFSET * side;
        const ux = p.dx * (look.tieLen / 2);
        const uy = p.dy * (look.tieLen / 2);
        const vx = -p.dy * 1.3;
        const vy = p.dx * 1.3;
        sleepers.quad([cx - ux - vx, cy - uy - vy, hh], [cx - ux + vx, cy - uy + vy, hh], [cx + ux - vx, cy + uy - vy, hh], [cx + ux + vx, cy + uy + vy, hh]);
      }
    }
    // Overhead line masts on electrified lines, above ground only
    if (masts) {
      const k = { i: 1 };
      for (let d = MAST_EVERY / 2; d < seg.length; d += MAST_EVERY) {
        const p = at(s, d, k);
        const hh = h(p.t);
        if (hh < -0.5) continue;
        const n = normalAt(s, Math.max(1, k.i - 1));
        const off = BALLAST_WIDTH / 2 + 0.2;
        pillar(concrete, p.x + n.x * off, p.y + n.y * off, p.dx, p.dy, 0.35, 0.35, hh + MAST_HEIGHT, hh);
        // Arm reaching over both tracks
        pillar(concrete, p.x, p.y, p.dx, p.dy, BALLAST_WIDTH + 0.4, 0.3, hh + MAST_HEIGHT, hh + MAST_HEIGHT - 0.3);
      }
    }
  }
  for (const n of net.nodes.values()) {
    main.ballast.disc(n.p.x, n.p.y, BALLAST_WIDTH / 2, n.h);
    if (n.h > 0) main.concrete.disc(n.p.x, n.p.y, ROAD_WIDTH / 2, n.h - 0.02);
  }
  return { ...parts(main), sunk: parts(sunk), mask: mask.geometry() };
}

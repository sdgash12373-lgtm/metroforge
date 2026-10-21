import type * as THREE from 'three';
import type { Sample } from '../sim/geometry';
import { TRACK_OFFSET } from '../sim/rail';
import { ROAD_WIDTH, type RoadNetwork } from '../sim/roads';
import { Builder, type Height, isTunnelRamp, normalAt, pillar, portal, ribbon, shownHeight, strip, supports } from './roadMesh';

const BALLAST_WIDTH = 9.4;
const GAUGE = 1.44;
const SLEEPER_EVERY = 1.6;
const MAST_EVERY = 48;
const MAST_HEIGHT = 7;

export interface TrackGeometries {
  ballast: THREE.BufferGeometry;
  sleepers: THREE.BufferGeometry;
  steel: THREE.BufferGeometry;
  /** viaducts, pillars, portals and catenary masts */
  concrete: THREE.BufferGeometry;
  /** tunnel openings */
  dark: THREE.BufferGeometry;
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
export function buildTrackGeometries(net: RoadNetwork, masts: boolean): TrackGeometries {
  const ballast = new Builder(0.06);
  const sleepers = new Builder(0.16);
  const steel = new Builder(0.3);
  const concrete = new Builder(0);
  const dark = new Builder(0);
  for (const seg of net.segments.values()) {
    const h: Height = shownHeight(net, seg);
    const s = seg.samples;
    const raised = net.isRaised(seg);
    if (raised) {
      ribbon(concrete, s, ROAD_WIDTH, (t) => h(t) - 0.02);
      supports(concrete, s, h);
    } else if (isTunnelRamp(net, seg)) portal(concrete, dark, s, (t) => net.heightAt(seg, t));
    ribbon(ballast, s, BALLAST_WIDTH, h);
    for (const side of [-1, 1]) {
      const c = side * TRACK_OFFSET;
      for (const r of [c - GAUGE / 2, c + GAUGE / 2]) strip(steel, s, r - 0.08, r + 0.08, h);
    }
    const j = { i: 1 };
    for (let d = SLEEPER_EVERY / 2; d < seg.length; d += SLEEPER_EVERY) {
      const p = at(s, d, j);
      const hh = h(p.t);
      for (const side of [-1, 1]) {
        const cx = p.x - p.dy * TRACK_OFFSET * side;
        const cy = p.y + p.dx * TRACK_OFFSET * side;
        const ux = p.dx * 0.14;
        const uy = p.dy * 0.14;
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
    ballast.disc(n.p.x, n.p.y, BALLAST_WIDTH / 2, n.h);
    if (n.h > 0) concrete.disc(n.p.x, n.p.y, ROAD_WIDTH / 2, n.h - 0.02);
  }
  return {
    ballast: ballast.geometry(),
    sleepers: sleepers.geometry(),
    steel: steel.geometry(),
    concrete: concrete.geometry(),
    dark: dark.geometry(),
  };
}

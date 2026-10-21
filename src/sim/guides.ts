import type { Vec2 } from './geometry';
import { directionsAt } from './angles';
import type { RoadNetwork } from './roads';

/** How far from a road end its guide lines reach, in meters. */
export const GUIDE_RANGE = 800;

export interface GuideLine {
  from: Vec2;
  to: Vec2;
}

interface Candidate {
  origin: Vec2;
  dir: Vec2;
  /** distance from the point to the line */
  off: number;
  /** distance along the line from the origin */
  along: number;
}

/**
 * Snaps a free point onto alignment lines drawn from existing road ends:
 * the road's own extension and the perpendicular across it. Lining up a new road's
 * end with the end of a parallel road shows a dashed line between the two.
 * Where two guides cross near the point, it snaps to the crossing.
 */
export function alignToGuides(net: RoadNetwork, p: Vec2, radius: number, ignore: number[] = []): { p: Vec2; lines: GuideLine[] } {
  const cands: Candidate[] = [];
  for (const node of net.nodes.values()) {
    if (ignore.includes(node.id)) continue;
    const o = node.p;
    if (Math.abs(p.x - o.x) > GUIDE_RANGE || Math.abs(p.y - o.y) > GUIDE_RANGE) continue;
    for (const d of directionsAt(net, { kind: 'node', node, p: o })) {
      for (const dir of [{ x: -d.x, y: -d.y }, { x: -d.y, y: d.x }, { x: d.y, y: -d.x }]) {
        const vx = p.x - o.x;
        const vy = p.y - o.y;
        const along = vx * dir.x + vy * dir.y;
        if (along < 4 || along > GUIDE_RANGE) continue;
        const off = Math.abs(vx * dir.y - vy * dir.x);
        if (off < radius) cands.push({ origin: o, dir, off, along });
      }
    }
  }
  if (!cands.length) return { p, lines: [] };
  cands.sort((a, b) => a.off - b.off);
  const best = cands[0];
  // A second guide that is not parallel to the first: snap to where they cross
  for (const other of cands.slice(1)) {
    const cross = best.dir.x * other.dir.y - best.dir.y * other.dir.x;
    if (Math.abs(cross) < 0.2) continue;
    const dx = other.origin.x - best.origin.x;
    const dy = other.origin.y - best.origin.y;
    const t = (dx * other.dir.y - dy * other.dir.x) / cross;
    const q = { x: best.origin.x + best.dir.x * t, y: best.origin.y + best.dir.y * t };
    if (Math.hypot(q.x - p.x, q.y - p.y) > radius * 1.5) continue;
    return { p: q, lines: [{ from: best.origin, to: q }, { from: other.origin, to: q }] };
  }
  const q = { x: best.origin.x + best.dir.x * best.along, y: best.origin.y + best.dir.y * best.along };
  return { p: q, lines: [{ from: best.origin, to: q }] };
}

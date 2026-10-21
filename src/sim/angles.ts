import { type Vec2, lerp, normalize, quadTangent } from './geometry';
import type { RoadNetwork, Snap } from './roads';

/** Angle between the road being drawn and the nearest existing road at one of its ends. */
export interface AngleGuide {
  at: Vec2;
  /** direction the new road leaves `at` */
  road: Vec2;
  /** direction of the existing road it is measured against */
  other: Vec2;
  /** 0–180 */
  degrees: number;
}

/** Unit directions of the existing roads leaving a snapped point. */
export function directionsAt(net: RoadNetwork, s: Snap): Vec2[] {
  if (s.kind === 'segment') {
    const d = quadTangent(net.quad(s.seg), s.t);
    return [d, { x: -d.x, y: -d.y }];
  }
  if (s.kind !== 'node') return [];
  const out: Vec2[] = [];
  for (const seg of net.segments.values()) {
    const q = net.quad(seg);
    if (seg.a === s.node.id) out.push(quadTangent(q, 0));
    if (seg.b === s.node.id) {
      const d = quadTangent(q, 1);
      out.push({ x: -d.x, y: -d.y });
    }
  }
  return out;
}

export function angleBetween(a: Vec2, b: Vec2): number {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y));
  return (Math.acos(dot) * 180) / Math.PI;
}

/** The smallest angle at each end of a prospective road that touches existing roads. */
export function angleGuides(net: RoadNetwork, start: Snap, control: Vec2 | null, end: Snap): AngleGuide[] {
  const q = { a: start.p, c: control ?? lerp(start.p, end.p, 0.5), b: end.p };
  if (Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y) < 1) return [];
  const ends: [Snap, Vec2][] = [
    [start, quadTangent(q, 0)],
    [end, normalize({ x: -quadTangent(q, 1).x, y: -quadTangent(q, 1).y })],
  ];
  const guides: AngleGuide[] = [];
  for (const [snap, road] of ends) {
    let best: AngleGuide | null = null;
    for (const other of directionsAt(net, snap)) {
      const degrees = angleBetween(road, other);
      if (!best || degrees < best.degrees) best = { at: snap.p, road, other, degrees };
    }
    if (best) guides.push(best);
  }
  return guides;
}

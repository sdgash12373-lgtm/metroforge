import { type Vec2, closestOnSamples, quadPoint, quadTangent, tAtLength } from './geometry';
import type { RailKind, RailSystem } from './rail';
import { type RoadNetwork, roadWidth } from './roads';
import type { BusStop } from './transit';

/** Where a station stands on its track: the point, the heading, and the track's height. */
export interface StationPose {
  p: Vec2;
  d: Vec2;
  h: number;
}

export function stationPose(sys: RailSystem, stop: BusStop): StationPose | null {
  const seg = stop.at && sys.net.segments.get(stop.at.seg);
  if (!seg || !stop.at) return null;
  const q = sys.net.quad(seg);
  const t = tAtLength(seg.samples, stop.at.s);
  return { p: quadPoint(q, t), d: quadTangent(q, t), h: sys.net.heightAt(seg, t) };
}

/** A rectangle in station coordinates: u along the track, v across it towards the station building's side. */
type Rect = [u0: number, u1: number, v0: number, v1: number];

/** Platforms and canopies, astride the track. */
const PLATFORMS: Record<RailKind, Rect> = {
  train: [-42, 42, -7.8, 7.8],
  hsr: [-65, 65, -11.3, 11.3],
  metro: [-22.2, 22.2, -8.8, 8.8],
};
/** The station building (and footbridge) on one side; these match what the renderer draws. */
const BUILDING: Record<RailKind, Rect[]> = {
  train: [
    [-17.3, 17.3, 9.7, 24.8],
    [18, 22, -7.8, 11],
  ],
  hsr: [[-32.2, 32.2, 12.3, 35.7]],
  metro: [[-3.7, 4.5, 8.2, 13.5]],
};

/** The parts of a station that stand on the ground: at street level, or raised over it. */
export function stationRects(kind: RailKind, h: number): Rect[] {
  // Underground, only a train station's building is at street level; metro entrances find their own spots
  if (h < 0) return kind === 'metro' ? [] : [BUILDING[kind][0]];
  return [PLATFORMS[kind], ...BUILDING[kind]];
}

/** Whether `pt` is within `margin` of the ground a station covers, with its building on side `side` (±1). */
export function stationCovers(kind: RailKind, pose: StationPose, side: number, pt: Vec2, margin: number): boolean {
  const dx = pt.x - pose.p.x;
  const dy = pt.y - pose.p.y;
  // A building on the -1 side is the station turned round, so u flips with v
  const u = (dx * pose.d.x + dy * pose.d.y) * side;
  const v = (-dx * pose.d.y + dy * pose.d.x) * side;
  return stationRects(kind, pose.h).some(([u0, u1, v0, v1]) => u >= u0 - margin && u <= u1 + margin && v >= v0 - margin && v <= v1 + margin);
}

/**
 * Which side of the track a station's building goes on: +1 for the station frame's +v side, -1 for the other. It faces the town, on the side with streets nearer, unless the building would stand on a road
 * there and not on the other side.
 */
export function stationSide(net: RoadNetwork, kind: RailKind, pose: StationPose): 1 | -1 {
  const streets = [...net.segments.values()].filter((s) => net.isStreet(s));
  const [u0, u1, v0, v1] = BUILDING[kind][0];
  const score = (side: number) => {
    let onRoad = 0;
    for (let u = u0; u <= u1; u += 4) {
      for (let v = v0; v <= v1; v += 3) {
        const pt = { x: pose.p.x + pose.d.x * u - pose.d.y * v * side, y: pose.p.y + pose.d.y * u + pose.d.x * v * side };
        if (streets.some((s) => closestOnSamples(s.samples, pt).d < roadWidth(s) / 2)) onRoad++;
      }
    }
    const mid = (v0 + v1) / 2;
    const q = { x: pose.p.x - pose.d.y * mid * side, y: pose.p.y + pose.d.x * mid * side };
    let near = Infinity;
    for (const s of streets) near = Math.min(near, closestOnSamples(s.samples, q).d);
    return { onRoad, near };
  };
  const a = score(1);
  const b = score(-1);
  if (a.onRoad !== b.onRoad && (a.onRoad === 0 || b.onRoad === 0)) return a.onRoad === 0 ? 1 : -1;
  return b.near < a.near ? -1 : 1;
}

import { type Vec2, bboxNear, closestOnSamples, quadPoint, quadTangent, tAtLength } from './geometry';
import type { RailKind, RailSystem } from './rail';
import { type RoadNetwork, roadWidth } from './roads';
import { type BusStop, type HubStyle, type StationShape, type StationStyle, isHub } from './transit';

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

/** Ground a large elevated metro station covers (its sail roof, stairs and escalators): 15 × 4 cells. */
export const CANOPY_STATION: Rect = [-60, 60, -16, 16];

/** Ground Kaohsiung's underground train stations cover: their park roof, towers and sunken plaza. */
export const KAOHSIUNG_STATION: Rect = [-60, 60, -28, 38];

/** Ground Pingtung's elevated train stations cover: the hall under the tracks and the plaza with its pool in front. */
export const PINGTUNG_STATION: Rect = [-50, 50, -12, 34];

/**
 * A 共構 station: one building over the train line (underground, at v = 0) and the metro line (underground, at
 * `metro.v`), and for 三鐵 a high-speed line at street level behind it and an elevated road into its car park.
 * v runs from the track towards the street the station fronts; u along the track. Lengths are half-lengths.
 */
export interface HubSpec {
  /** ground the station covers: buildings, platforms and plaza */
  rects: Rect[];
  /** how far the front reaches towards the street */
  front: number;
  train: number;
  metro: { v: number; half: number };
  hsr?: { v: number; half: number };
  /** an elevated road from the car park out along u, at v */
  road?: { v: number; u0: number; u1: number };
}

/** Kaohsiung's own station is 三鐵共構 too: metro and high-speed lines in tunnels beside the train's. */
export const KAOHSIUNG_SHARED = { metro: { v: -18, half: 30 }, hsr: { v: -40, half: 82 } };

export const HUBS: Record<HubStyle, HubSpec> = {
  // 雙鐵: a pavilion over the stairs down, under a great sweeping roof
  twin: { rects: [[-34, 34, -26, 18]], front: 18, train: 60, metro: { v: -16, half: 30 } },
  // 三鐵: the great hall, the car park beside it, high-speed platforms behind
  triple: {
    rects: [
      [-60, 48, -24, 40],
      [48, 104, -18, 34],
      [-66, 66, -48, -24],
    ],
    front: 40,
    train: 70,
    metro: { v: -12, half: 30 },
    hsr: { v: -36, half: 82 },
    road: { v: 10, u0: 104, u1: 150 },
  },
};

/** How far from the track a train station's building reaches on its own side: where the street it fronts must run. */
export function stationFront(style?: StationStyle): number {
  if (isHub(style)) return HUBS[style].front;
  return style === 'kaohsiung' ? KAOHSIUNG_STATION[3] : style === 'pingtung' ? PINGTUNG_STATION[3] : BUILDING.train[0][3];
}

/**
 * The parts of a station that stand on the ground: at street level, or raised over it. A region's own train station
 * (`style`) covers more: Kaohsiung's spreads its roof and sunken plaza over the tracks, Pingtung's its plaza in front.
 */
export function stationRects(kind: RailKind, h: number, style?: StationShape): Rect[] {
  if (kind === 'metro' && style === 'canopy' && h > 0) return [CANOPY_STATION];
  // A 共構 station's train stop carries the whole building; its metro and high-speed stops add nothing
  if (isHub(style)) return kind === 'train' ? HUBS[style].rects : [];
  if (style === 'kaohsiung' && kind !== 'train') return [];
  // Underground, only a train station's building is at street level; metro entrances find their own spots
  if (kind === 'train' && style === 'kaohsiung' && h < 0) return [KAOHSIUNG_STATION];
  if (kind === 'train' && style === 'pingtung' && h > 0) return [PINGTUNG_STATION];
  if (h < 0) return kind === 'metro' ? [] : [BUILDING[kind][0]];
  return [PLATFORMS[kind], ...BUILDING[kind]];
}

/** Whether `pt` is within `margin` of the ground a station covers, with its building on side `side` (±1). */
export function stationCovers(kind: RailKind, pose: StationPose, side: number, pt: Vec2, margin: number, style?: StationShape): boolean {
  const dx = pt.x - pose.p.x;
  const dy = pt.y - pose.p.y;
  // A building on the -1 side is the station turned round, so u flips with v
  const u = (dx * pose.d.x + dy * pose.d.y) * side;
  const v = (-dx * pose.d.y + dy * pose.d.x) * side;
  return stationRects(kind, pose.h, style).some(([u0, u1, v0, v1]) => u >= u0 - margin && u <= u1 + margin && v >= v0 - margin && v <= v1 + margin);
}

/**
 * Which side of the track a station's building goes on: +1 for the station frame's +v side, -1 for the other. It faces the town, on the side with streets nearer, unless the building would stand on a road
 * there and not on the other side.
 */
export function stationSide(net: RoadNetwork, kind: RailKind, pose: StationPose): 1 | -1 {
  const [u0, u1, v0, v1] = BUILDING[kind][0];
  const reach = Math.hypot(Math.max(Math.abs(u0), Math.abs(u1)), v1);
  // Only streets that could reach the building are checked for standing on it
  const streets = [...net.segments.values()].filter((s) => net.isStreet(s));
  const close = streets.filter((s) => bboxNear(s.bbox, pose.p, reach + roadWidth(s)));
  const score = (side: number) => {
    let onRoad = 0;
    for (let u = u0; u <= u1; u += 4) {
      for (let v = v0; v <= v1; v += 3) {
        const pt = { x: pose.p.x + pose.d.x * u - pose.d.y * v * side, y: pose.p.y + pose.d.y * u + pose.d.x * v * side };
        if (close.some((s) => bboxNear(s.bbox, pt, roadWidth(s) / 2) && closestOnSamples(s.samples, pt).d < roadWidth(s) / 2)) onRoad++;
      }
    }
    const mid = (v0 + v1) / 2;
    const q = { x: pose.p.x - pose.d.y * mid * side, y: pose.p.y + pose.d.x * mid * side };
    let near = Infinity;
    for (const s of streets) if (bboxNear(s.bbox, q, near)) near = Math.min(near, closestOnSamples(s.samples, q).d);
    return { onRoad, near };
  };
  const a = score(1);
  const b = score(-1);
  if (a.onRoad !== b.onRoad && (a.onRoad === 0 || b.onRoad === 0)) return a.onRoad === 0 ? 1 : -1;
  return b.near < a.near ? -1 : 1;
}

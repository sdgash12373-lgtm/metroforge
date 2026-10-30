import type { Vec2 } from './geometry';
import { type RoadNetwork, type RoadSegment, asphaltWidth } from './roads';

/** Seconds of green, then yellow, for each direction in turn. */
export const GREEN_TIME = 12;
export const YELLOW_TIME = 3;
/** Roads within this angle of each other share a green (straight across the junction). */
const SAME_AXIS = Math.PI / 6;
/** Vehicles wait this far back from the junction centre where there is no junction. */
export const STOP_BACK = 6;
/**
 * Paint on each approach to a signalled junction, in metres back from the edge of the crossing road's asphalt:
 * the 機車待轉區 (two-stage left-turn box) in the kerb lane, the zebra crossing, the scooter stop line at the front
 * of the 機車停等區, and the stop line for cars behind it.
 */
export const TURN_BOX: [number, number] = [0.3, 2.3];
export const CROSSWALK: [number, number] = [2.7, 5.7];
export const SCOOTER_LINE = 6.1;
export const CAR_LINE = 9.3;
/** Half a car: vehicles are placed by their middle, so they wait this far behind the line they stop at. */
const HALF_CAR = 2.4;

export type Light = 'green' | 'yellow' | 'red';

export interface Approach {
  seg: number;
  /** the junction is at this end of the segment */
  end: 'a' | 'b';
  /** unit direction from the junction out along the road */
  out: Vec2;
  phase: number;
}

export interface Junction {
  node: number;
  approaches: Approach[];
  phases: number;
  /** how far back from the centre traffic waits (behind the stop line): further where wide roads cross */
  stopBack: number;
  /** scooters wait further up, in the 機車停等區 */
  scooterBack: number;
  /** from the centre to the edge of the widest road's asphalt, where the paint on each approach starts */
  edge: number;
  /** staggers neighbouring junctions so they do not all change together */
  offset: number;
}

/** Direction from a segment's end at `end` out along it. */
function outward(seg: RoadSegment, end: 'a' | 'b'): Vec2 {
  const s = seg.samples;
  const [p, q] = end === 'a' ? [s[0], s[1]] : [s[s.length - 1], s[s.length - 2]];
  const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  return { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
}

/**
 * Every node where three or more two-way roads meet gets traffic lights. Roads that line up across
 * the junction share a phase; roundabouts (one-way rings) keep yielding instead.
 */
export function findJunctions(net: RoadNetwork): Map<number, Junction> {
  const at = new Map<number, { seg: RoadSegment; end: 'a' | 'b' }[]>();
  const add = (node: number, seg: RoadSegment, end: 'a' | 'b') => {
    const l = at.get(node);
    if (l) l.push({ seg, end });
    else at.set(node, [{ seg, end }]);
  };
  for (const seg of net.segments.values()) {
    add(seg.a, seg, 'a');
    add(seg.b, seg, 'b');
  }
  const out = new Map<number, Junction>();
  for (const [node, list] of at) {
    if (list.length < 3 || list.some((e) => e.seg.ring)) continue;
    const axes: number[] = [];
    const approaches = list.map(({ seg, end }) => {
      const o = outward(seg, end);
      const axis = (Math.atan2(o.y, o.x) + Math.PI) % Math.PI;
      let phase = axes.findIndex((a) => {
        const d = Math.abs(a - axis);
        return Math.min(d, Math.PI - d) < SAME_AXIS;
      });
      if (phase < 0) phase = axes.push(axis) - 1;
      return { seg: seg.id, end, out: o, phase };
    });
    const cycle = axes.length * (GREEN_TIME + YELLOW_TIME);
    const edge = Math.max(...list.map((e) => asphaltWidth(e.seg))) / 2;
    out.set(node, {
      node,
      approaches,
      phases: axes.length,
      stopBack: edge + CAR_LINE + HALF_CAR,
      scooterBack: edge + SCOOTER_LINE + 1,
      edge,
      offset: (node * 7.31) % cycle,
    });
  }
  return out;
}

/** The light shown to traffic coming in on approach `phase` of a junction at `time` seconds. */
export function lightAt(j: Junction, phase: number, time: number): Light {
  const slot = GREEN_TIME + YELLOW_TIME;
  const t = (time + j.offset) % (j.phases * slot);
  if (Math.floor(t / slot) !== phase) return 'red';
  return t % slot < GREEN_TIME ? 'green' : 'yellow';
}

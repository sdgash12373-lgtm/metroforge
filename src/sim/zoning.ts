import { type Vec2, bboxNear, closestOnSamples, hash01, quadPoint, quadTangent, tAtLength } from './geometry';
import { ROAD_WIDTH, type RoadNetwork, type RoadSegment } from './roads';

/** Zoning cell size, as in Cities: Skylines (8 m × 8 m). */
export const CELL = 8;
/** Cells per row behind the road. */
export const DEPTH = 4;

export enum Zone {
  None = 0,
  ResidentialLow = 1,
  ResidentialHigh = 2,
  Commercial = 3,
  Office = 4,
  Industrial = 5,
}

export type DemandKey = 'R' | 'C' | 'O' | 'I';

export interface ZoneInfo {
  name: string;
  color: number;
  maxLevel: number;
  demand: DemandKey;
  /** residents or jobs added per building level */
  perLevel: number;
}

export const ZONES: Record<Exclude<Zone, Zone.None>, ZoneInfo> = {
  [Zone.ResidentialLow]: { name: '低密住宅', color: 0x7cc576, maxLevel: 3, demand: 'R', perLevel: 4 },
  [Zone.ResidentialHigh]: { name: '高密住宅', color: 0x3f9a4a, maxLevel: 5, demand: 'R', perLevel: 18 },
  [Zone.Commercial]: { name: '商業', color: 0x4f8fd6, maxLevel: 3, demand: 'C', perLevel: 6 },
  [Zone.Office]: { name: '辦公', color: 0x8a6fd1, maxLevel: 5, demand: 'O', perLevel: 14 },
  [Zone.Industrial]: { name: '工業', color: 0xd9a33a, maxLevel: 3, demand: 'I', perLevel: 10 },
};

export interface Lot {
  x: number;
  y: number;
  /** unit vector along the road; buildings face the road */
  dir: Vec2;
  /** +1 / -1: which side of the road */
  side: number;
  /** 1 = first row against the road */
  depth: number;
  zone: Zone;
  level: number;
  blocked: boolean;
  /** the cell between this one and the road */
  front: Lot | null;
  /** 0..1, stable per position, for visual variety */
  seed: number;
  /** distance along the owning road segment, where its traffic enters the road */
  s: number;
}

/** Columns of cells every CELL meters along the curve, DEPTH cells deep on both sides. */
export function generateLots(net: RoadNetwork, seg: RoadSegment): Lot[] {
  const q = net.quad(seg);
  const lots: Lot[] = [];
  for (let s = CELL / 2; s <= seg.length - CELL / 2 + 1e-6; s += CELL) {
    const t = tAtLength(seg.samples, s);
    const p = quadPoint(q, t);
    const dir = quadTangent(q, t);
    const n = { x: -dir.y, y: dir.x };
    for (const side of [-1, 1]) {
      let front: Lot | null = null;
      for (let depth = 1; depth <= DEPTH; depth++) {
        const off = side * (ROAD_WIDTH / 2 + CELL * (depth - 0.5));
        const x = p.x + n.x * off;
        const y = p.y + n.y * off;
        const lot: Lot = { x, y, dir, side, depth, zone: Zone.None, level: 0, blocked: false, front, seed: hash01(x, y), s };
        lots.push(lot);
        front = lot;
      }
    }
  }
  return lots;
}

/** Copies zoning and buildings from the segment that was split into its pieces. */
export function inheritLots(target: Lot[], source: Lot[]): void {
  const zoned = source.filter((l) => l.zone !== Zone.None);
  for (const l of target) {
    for (const o of zoned) {
      if (Math.abs(o.x - l.x) < CELL / 2 && Math.abs(o.y - l.y) < CELL / 2) {
        l.zone = o.zone;
        l.level = o.level;
        break;
      }
    }
  }
}

/**
 * A cell is unusable if a road runs through it, it overlaps an older cell
 * (inside of curves, junction corners), or the cell in front of it is unusable.
 */
export function recomputeBlocked(net: RoadNetwork): void {
  const grid = new Map<string, Lot[]>();
  const clearance = ROAD_WIDTH / 2 + CELL * 0.45;
  const segs = [...net.segments.values()];
  for (const seg of segs) {
    for (const lot of seg.lots) {
      let blocked = lot.front !== null && lot.front.blocked;
      if (!blocked) {
        for (const other of segs) {
          if (!bboxNear(other.bbox, lot, clearance)) continue;
          if (closestOnSamples(other.samples, lot).d < clearance) {
            blocked = true;
            break;
          }
        }
      }
      const gx = Math.floor(lot.x / CELL);
      const gy = Math.floor(lot.y / CELL);
      if (!blocked) {
        search: for (let i = -1; i <= 1; i++) {
          for (let j = -1; j <= 1; j++) {
            for (const o of grid.get(`${gx + i},${gy + j}`) ?? []) {
              if (Math.hypot(o.x - lot.x, o.y - lot.y) < CELL * 0.8) {
                blocked = true;
                break search;
              }
            }
          }
        }
      }
      lot.blocked = blocked;
      if (blocked) {
        lot.level = 0;
      } else {
        const key = `${gx},${gy}`;
        const cell = grid.get(key);
        if (cell) cell.push(lot);
        else grid.set(key, [lot]);
      }
    }
  }
}

/** Paints a zone with a round brush. Returns the number of cells changed. */
export function paintZone(net: RoadNetwork, center: Vec2, radius: number, zone: Zone): number {
  let changed = 0;
  for (const seg of net.segments.values()) {
    if (!bboxNear(seg.bbox, center, radius + ROAD_WIDTH / 2 + CELL * DEPTH)) continue;
    for (const lot of seg.lots) {
      if (lot.blocked || lot.zone === zone) continue;
      if ((lot.x - center.x) ** 2 + (lot.y - center.y) ** 2 > radius * radius) continue;
      lot.zone = zone;
      lot.level = 0;
      changed++;
    }
  }
  return changed;
}

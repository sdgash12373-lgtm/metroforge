import { type Vec2, bboxNear, closestOnSamples, hash01, quadPoint, quadTangent, tAtLength } from './geometry';
import { ROAD_WIDTH, type RoadNetwork, type RoadSegment, roadWidth } from './roads';

/** Zoning cell size (8 m × 8 m). */
export const CELL = 8;

/** Middle of the drawing-grid square a point is in: free road ends go there, never onto a grid line. */
export const cellCenter = (p: Vec2): Vec2 => ({ x: Math.round(p.x / CELL) * CELL, y: Math.round(p.y / CELL) * CELL });
/** Cells per row behind the road. */
export const DEPTH = 4;

export enum Zone {
  None = 0,
  ResidentialLow = 1,
  ResidentialHigh = 2,
  Commercial = 3,
  Office = 4,
  Industrial = 5,
  /** 加工工業區: like an export processing zone, worth most shipped out through a cargo port */
  Processing = 6,
  /** 林業: sawmills and timber yards, only at the foot of forested hills */
  Forestry = 7,
  /** 化工業: petrochemical plants, valuable but polluting the homes around them */
  Chemical = 8,
  /** 科學園區: clean high-tech fabs that need a school nearby for educated workers */
  SciencePark = 9,
  /** 產業園區: tidy multi-storey standard factories */
  IndustrialPark = 10,
}

export type DemandKey = 'R' | 'C' | 'O' | 'I';

export interface ZoneInfo {
  name: string;
  color: number;
  maxLevel: number;
  demand: DemandKey;
  /** residents or jobs added per building level */
  perLevel: number;
  /** industry: value of the goods each job makes, relative to general industry (1) */
  goods?: number;
}

export const ZONES: Record<Exclude<Zone, Zone.None>, ZoneInfo> = {
  [Zone.ResidentialLow]: { name: '低密住宅', color: 0x7cc576, maxLevel: 3, demand: 'R', perLevel: 4 },
  [Zone.ResidentialHigh]: { name: '高密住宅', color: 0x3f9a4a, maxLevel: 5, demand: 'R', perLevel: 18 },
  [Zone.Commercial]: { name: '商業', color: 0x4f8fd6, maxLevel: 3, demand: 'C', perLevel: 6 },
  [Zone.Office]: { name: '辦公', color: 0x8a6fd1, maxLevel: 5, demand: 'O', perLevel: 14 },
  [Zone.Industrial]: { name: '一般工業', color: 0xd9a33a, maxLevel: 3, demand: 'I', perLevel: 10, goods: 1 },
  [Zone.Processing]: { name: '加工工業區', color: 0xe07b39, maxLevel: 3, demand: 'I', perLevel: 12, goods: 1.4 },
  [Zone.Forestry]: { name: '林業', color: 0x6b8e3a, maxLevel: 3, demand: 'I', perLevel: 6, goods: 0.8 },
  [Zone.Chemical]: { name: '化工業', color: 0xb5651d, maxLevel: 3, demand: 'I', perLevel: 10, goods: 1.8 },
  [Zone.SciencePark]: { name: '科學園區', color: 0x3fb8c9, maxLevel: 4, demand: 'I', perLevel: 16, goods: 2.5 },
  [Zone.IndustrialPark]: { name: '產業園區', color: 0xc9a227, maxLevel: 4, demand: 'I', perLevel: 12, goods: 1.2 },
};

/** Every kind of industry, general first, in the order the zone dock lists them. */
export const INDUSTRY_ZONES = [Zone.Industrial, Zone.Processing, Zone.Forestry, Zone.Chemical, Zone.SciencePark, Zone.IndustrialPark] as const;

export const isIndustry = (zone: Zone): boolean => zone !== Zone.None && ZONES[zone].demand === 'I';

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

/** Columns of cells every CELL meters along a street, DEPTH cells deep on both sides. */
export function generateLots(net: RoadNetwork, seg: RoadSegment): Lot[] {
  const lots: Lot[] = [];
  // Nothing fronts onto elevated roads, tunnels, ramps or roundabouts
  if (!net.isStreet(seg)) return lots;
  const q = net.quad(seg);
  for (let s = CELL / 2; s <= seg.length - CELL / 2 + 1e-6; s += CELL) {
    const t = tAtLength(seg.samples, s);
    const p = quadPoint(q, t);
    const dir = quadTangent(q, t);
    const n = { x: -dir.y, y: dir.x };
    for (const side of [-1, 1]) {
      let front: Lot | null = null;
      for (let depth = 1; depth <= DEPTH; depth++) {
        const off = side * (roadWidth(seg) / 2 + CELL * (depth - 0.5));
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

/** Size of the squares roads are sorted into when checking which cells they run through. */
const BUCKET = 64;

/**
 * A cell is unusable if a road runs through it, it is taken by track or an airport, it overlaps an older cell
 * (inside of curves, junction corners), or the cell in front of it is unusable.
 */
export function recomputeBlocked(net: RoadNetwork, occupied?: (p: Vec2) => boolean): void {
  const grid = new Map<string, Lot[]>();
  const clearance = ROAD_WIDTH / 2 + CELL * 0.45;
  const segs = [...net.segments.values()];
  // Roads by the squares their reach covers, so each cell only checks the roads near it
  const near = new Map<string, RoadSegment[]>();
  for (const seg of segs) {
    const pad = clearance + (roadWidth(seg) - ROAD_WIDTH) / 2;
    for (let i = Math.floor((seg.bbox.minX - pad) / BUCKET); i <= Math.floor((seg.bbox.maxX + pad) / BUCKET); i++) {
      for (let j = Math.floor((seg.bbox.minY - pad) / BUCKET); j <= Math.floor((seg.bbox.maxY + pad) / BUCKET); j++) {
        const key = `${i},${j}`;
        const list = near.get(key);
        if (list) list.push(seg);
        else near.set(key, [seg]);
      }
    }
  }
  for (const seg of segs) {
    for (const lot of seg.lots) {
      let blocked = (lot.front !== null && lot.front.blocked) || !!occupied?.(lot);
      if (!blocked) {
        for (const other of near.get(`${Math.floor(lot.x / BUCKET)},${Math.floor(lot.y / BUCKET)}`) ?? []) {
          const clear = clearance + (roadWidth(other) - ROAD_WIDTH) / 2;
          if (!bboxNear(other.bbox, lot, clear)) continue;
          if (closestOnSamples(other.samples, lot).d < clear) {
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
/**
 * Zones the empty cells in a circle. Cells that already have another zone are left alone unless
 * `overwrite` is set (the 更正 button); clearing (Zone.None) always works.
 */
export function paintZone(net: RoadNetwork, center: Vec2, radius: number, zone: Zone, overwrite = false, allowed?: (lot: Lot) => boolean): number {
  let changed = 0;
  for (const seg of net.segments.values()) {
    if (!bboxNear(seg.bbox, center, radius + ROAD_WIDTH / 2 + CELL * DEPTH)) continue;
    for (const lot of seg.lots) {
      if (lot.blocked || lot.zone === zone) continue;
      if (!overwrite && zone !== Zone.None && lot.zone !== Zone.None) continue;
      if ((lot.x - center.x) ** 2 + (lot.y - center.y) ** 2 > radius * radius) continue;
      if (zone !== Zone.None && allowed && !allowed(lot)) continue;
      lot.zone = zone;
      lot.level = 0;
      changed++;
    }
  }
  return changed;
}

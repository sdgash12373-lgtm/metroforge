import { type Vec2, clamp } from './geometry';
import { RoadNetwork, type Snap } from './roads';
import { type DemandKey, type Lot, ZONES, Zone, generateLots, inheritLots, paintZone, recomputeBlocked } from './zoning';

export const ROAD_COST_PER_M = 20;
export const BULLDOZE_REFUND = 0.5;
const SAVE_VERSION = 1;

export type Rng = () => number;

export interface CityStats {
  population: number;
  jobs: number;
  buildings: number;
}

export interface SaveData {
  v: number;
  money: number;
  day: number;
  nodes: [number, number, number][];
  /** id, a, b, control x, control y, per-lot zone * 10 + level */
  segs: [number, number, number, number, number, number[]][];
}

export class City {
  net = new RoadNetwork();
  money = 80000;
  day = 0;
  demand: Record<DemandKey, number> = { R: 50, C: 30, O: 20, I: 40 };
  stats: CityStats = { population: 0, jobs: 0, buildings: 0 };
  /** bumped whenever roads change, so the renderer knows to rebuild meshes */
  roadsVersion = 0;
  /** bumped whenever zoning or buildings change */
  lotsVersion = 0;

  constructor() {
    this.net.listener = {
      added: (seg, from) => {
        seg.lots = generateLots(this.net, seg);
        if (from) inheritLots(seg.lots, from.lots);
      },
      removed: () => {},
    };
  }

  private roadsChanged(): void {
    recomputeBlocked(this.net);
    this.roadsVersion++;
    this.lotsVersion++;
  }

  roadCost(a: Vec2, c: Vec2 | null, b: Vec2): number {
    return Math.round(RoadNetwork.previewLength(a, c, b) * ROAD_COST_PER_M);
  }

  buildRoad(start: Snap, control: Vec2 | null, end: Snap, free = false): { ok: boolean; cost: number; reason?: string; endNode?: number } {
    const cost = free ? 0 : this.roadCost(start.p, control, end.p);
    if (Math.hypot(start.p.x - end.p.x, start.p.y - end.p.y) < 4) return { ok: false, cost, reason: '道路太短' };
    if (cost > this.money) return { ok: false, cost, reason: `資金不足，需要 $${cost.toLocaleString()}` };
    const created = this.net.addRoad(start, control, end);
    if (!created.length) return { ok: false, cost, reason: '這裡已經有道路了' };
    this.money -= cost;
    this.roadsChanged();
    const last = created[created.length - 1];
    return { ok: true, cost, endNode: last.b };
  }

  bulldoze(p: Vec2, radius: number): { ok: boolean; refund: number } {
    const hit = this.net.segmentAt(p, radius);
    if (!hit) return { ok: false, refund: 0 };
    const refund = Math.round(hit.seg.length * ROAD_COST_PER_M * BULLDOZE_REFUND);
    this.net.removeSegment(hit.seg.id);
    this.money += refund;
    this.roadsChanged();
    return { ok: true, refund };
  }

  paint(center: Vec2, radius: number, zone: Zone): number {
    const n = paintZone(this.net, center, radius, zone);
    if (n) this.lotsVersion++;
    return n;
  }

  /** Recounts population, jobs and demand from the current buildings. Returns the zoned, usable lots. */
  measure(): Lot[] {
    let pop = 0;
    let buildings = 0;
    const jobs: Record<DemandKey, number> = { R: 0, C: 0, O: 0, I: 0 };
    const zoned: Lot[] = [];
    for (const seg of this.net.segments.values()) {
      for (const lot of seg.lots) {
        if (lot.blocked || lot.zone === Zone.None) continue;
        zoned.push(lot);
        if (!lot.level) continue;
        buildings++;
        const info = ZONES[lot.zone];
        if (info.demand === 'R') pop += lot.level * info.perLevel;
        else jobs[info.demand] += lot.level * info.perLevel;
      }
    }
    const totalJobs = jobs.C + jobs.O + jobs.I;
    const d = (v: number) => clamp(Math.round(v), 0, 100);
    this.demand = {
      R: d(45 + (totalJobs * 1.1 - pop) * 0.3),
      C: d(35 + (pop * 0.25 - jobs.C) * 0.5),
      O: d(20 + (pop * 0.2 - jobs.O) * 0.4),
      I: d(40 + (pop * 0.3 - jobs.I) * 0.4),
    };
    this.stats = { population: pop, jobs: totalJobs, buildings };
    return zoned;
  }

  /** One simulation step: demand from the residents/jobs balance, then a few buildings grow, then taxes. */
  tick(rng: Rng = Math.random): void {
    const zoned = this.measure();
    let changed = false;
    const attempts = Math.min(16, zoned.length);
    for (let i = 0; i < attempts; i++) {
      const lot = zoned[Math.floor(rng() * zoned.length) % zoned.length];
      const info = ZONES[lot.zone as Exclude<Zone, Zone.None>];
      const want = this.demand[info.demand] / 100;
      // Back rows only build once the row in front has something on it
      if (lot.front && lot.front.level === 0) continue;
      if (lot.level === 0) {
        if (rng() < want) {
          lot.level = 1;
          changed = true;
        }
      } else if (lot.level < info.maxLevel && rng() < 0.03 * (0.3 + want)) {
        lot.level++;
        changed = true;
      }
    }
    if (changed) this.lotsVersion++;

    let roadLength = 0;
    for (const s of this.net.segments.values()) roadLength += s.length;
    this.money += this.stats.population * 0.04 + this.stats.jobs * 0.03 - roadLength * 0.004;
    this.day++;
  }

  serialize(): SaveData {
    return {
      v: SAVE_VERSION,
      money: Math.round(this.money),
      day: this.day,
      nodes: [...this.net.nodes.values()].map((n) => [n.id, round2(n.p.x), round2(n.p.y)]),
      segs: [...this.net.segments.values()].map((s) => [
        s.id,
        s.a,
        s.b,
        round2(s.c.x),
        round2(s.c.y),
        s.lots.map((l) => l.zone * 10 + l.level),
      ]),
    };
  }

  static deserialize(data: SaveData): City {
    if (data.v !== SAVE_VERSION) throw new Error(`unsupported save version ${data.v}`);
    const city = new City();
    city.money = data.money;
    city.day = data.day;
    for (const [id, x, y] of data.nodes) city.net.addNode({ x, y }, id);
    for (const [id, a, b, cx, cy, lots] of data.segs) {
      const seg = city.net.createSegment(a, b, { x: cx, y: cy }, undefined, id);
      lots.forEach((v, i) => {
        const lot = seg.lots[i];
        if (!lot) return;
        lot.zone = Math.floor(v / 10) as Zone;
        lot.level = v % 10;
      });
    }
    city.roadsChanged();
    city.measure();
    return city;
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

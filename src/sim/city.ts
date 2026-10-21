import { type Vec2, clamp } from './geometry';
import { RoadNetwork, type RoadSegment, type Snap } from './roads';
import { type RoadPoint, Traffic } from './traffic';
import { type DemandKey, type Lot, ZONES, Zone, generateLots, inheritLots, paintZone, recomputeBlocked } from './zoning';

export const ROAD_COST_PER_M = 20;
export const BULLDOZE_REFUND = 0.5;
/** Road upkeep per meter per day. */
export const ROAD_UPKEEP = 0.004;
export const DEFAULT_TAX = 9;
export const MAX_TAX = 29;
const SAVE_VERSION = 2;

export type Rng = () => number;

export interface CityStats {
  population: number;
  jobs: number;
  buildings: number;
  /** zoned cells that cannot grow because their road does not reach the highway */
  disconnected: number;
}

export interface Budget {
  residentialTax: number;
  businessTax: number;
  roadUpkeep: number;
}

export interface TaxRates {
  residential: number;
  business: number;
}

export interface SaveData {
  v: number;
  money: number;
  day: number;
  nodes: [number, number, number][];
  /** id, a, b, control x, control y, per-lot zone * 10 + level */
  segs: [number, number, number, number, number, number[]][];
  /** node ids where roads leave the map (v2) */
  outside?: number[];
  taxes?: TaxRates;
}

/** A zoned cell together with the road it sits on. */
interface Placed {
  lot: Lot;
  seg: RoadSegment;
}

export class City {
  net = new RoadNetwork();
  traffic = new Traffic(this.net);
  money = 80000;
  day = 0;
  demand: Record<DemandKey, number> = { R: 50, C: 30, O: 20, I: 40 };
  stats: CityStats = { population: 0, jobs: 0, buildings: 0, disconnected: 0 };
  taxes: TaxRates = { residential: DEFAULT_TAX, business: DEFAULT_TAX };
  /** last day's income and expenses */
  budget: Budget = { residentialTax: 0, businessTax: 0, roadUpkeep: 0 };
  /** road ends at the map edge: the highway that people and goods come in by */
  outside = new Set<number>();
  /** junctions that can reach an outside connection */
  private connected = new Set<number>();
  maxVehicles = 400;
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
    this.traffic.onNetworkChanged();
    this.computeConnectivity();
    this.roadsVersion++;
    this.lotsVersion++;
  }

  private computeConnectivity(): void {
    this.connected.clear();
    const adj = new Map<number, number[]>();
    for (const s of this.net.segments.values()) {
      (adj.get(s.a) ?? adj.set(s.a, []).get(s.a)!).push(s.b);
      (adj.get(s.b) ?? adj.set(s.b, []).get(s.b)!).push(s.a);
    }
    // Cities without an outside connection (old saves) treat every road as connected
    const roots = this.outside.size ? [...this.outside] : [...this.net.nodes.keys()];
    const stack = roots.filter((n) => this.net.nodes.has(n));
    for (const n of stack) this.connected.add(n);
    while (stack.length) {
      for (const m of adj.get(stack.pop()!) ?? []) {
        if (!this.connected.has(m)) {
          this.connected.add(m);
          stack.push(m);
        }
      }
    }
  }

  isConnected(seg: RoadSegment): boolean {
    return this.connected.has(seg.a);
  }

  /** Marks a road end as the highway into the city. */
  addOutsideConnection(nodeId: number): void {
    this.outside.add(nodeId);
    this.computeConnectivity();
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

  bulldoze(p: Vec2, radius: number): { ok: boolean; refund: number; reason?: string } {
    const hit = this.net.segmentAt(p, radius);
    if (!hit) return { ok: false, refund: 0 };
    if (this.outside.has(hit.seg.a) || this.outside.has(hit.seg.b)) {
      return { ok: false, refund: 0, reason: '這段是對外的高速公路，不能拆除' };
    }
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
    return this.survey().map((p) => p.lot);
  }

  private survey(): Placed[] {
    let pop = 0;
    let buildings = 0;
    let disconnected = 0;
    const jobs: Record<DemandKey, number> = { R: 0, C: 0, O: 0, I: 0 };
    const zoned: Placed[] = [];
    for (const seg of this.net.segments.values()) {
      const linked = this.isConnected(seg);
      for (const lot of seg.lots) {
        if (lot.blocked || lot.zone === Zone.None) continue;
        zoned.push({ lot, seg });
        if (!linked && !lot.level) disconnected++;
        if (!lot.level) continue;
        buildings++;
        const info = ZONES[lot.zone];
        if (info.demand === 'R') pop += lot.level * info.perLevel;
        else jobs[info.demand] += lot.level * info.perLevel;
      }
    }
    const totalJobs = jobs.C + jobs.O + jobs.I;
    const d = (v: number) => clamp(Math.round(v), 0, 100);
    // Every tax point above the default costs demand
    const rTax = (this.taxes.residential - DEFAULT_TAX) * 3;
    const bTax = (this.taxes.business - DEFAULT_TAX) * 3;
    this.demand = {
      R: d(45 + (totalJobs * 1.1 - pop) * 0.3 - rTax),
      C: d(35 + (pop * 0.25 - jobs.C) * 0.5 - bTax),
      O: d(20 + (pop * 0.2 - jobs.O) * 0.4 - bTax),
      I: d(40 + (pop * 0.3 - jobs.I) * 0.4 - bTax),
    };
    this.stats = { population: pop, jobs: totalJobs, buildings, disconnected };
    return zoned;
  }

  /** How jammed a segment is in its busier direction, 0..1. */
  congestion(seg: RoadSegment): number {
    return Math.max(this.traffic.congestion(seg, 1), this.traffic.congestion(seg, -1));
  }

  /**
   * One simulation day: demand, building growth (needs a road to the highway; slowed by jams),
   * new trips onto the roads, then taxes and upkeep.
   */
  tick(rng: Rng = Math.random): void {
    const zoned = this.survey();
    let changed = false;
    const attempts = Math.min(16, zoned.length);
    for (let i = 0; i < attempts; i++) {
      const { lot, seg } = zoned[Math.floor(rng() * zoned.length) % zoned.length];
      if (!this.isConnected(seg)) continue;
      const info = ZONES[lot.zone as Exclude<Zone, Zone.None>];
      const want = this.demand[info.demand] / 100;
      // Back rows only build once the row in front has something on it
      if (lot.front && lot.front.level === 0) continue;
      if (lot.level === 0) {
        if (rng() < want) {
          lot.level = 1;
          changed = true;
        }
      } else if (lot.level < info.maxLevel && rng() < 0.03 * (0.3 + want) * (1 - 0.7 * this.congestion(seg))) {
        lot.level++;
        changed = true;
      }
    }
    if (changed) this.lotsVersion++;

    this.spawnTrips(zoned, rng);

    let roadLength = 0;
    for (const s of this.net.segments.values()) roadLength += s.length;
    this.budget = {
      residentialTax: this.stats.population * this.taxes.residential * 0.005,
      businessTax: this.stats.jobs * this.taxes.business * 0.004,
      roadUpkeep: roadLength * ROAD_UPKEEP,
    };
    this.money += this.budget.residentialTax + this.budget.businessTax - this.budget.roadUpkeep;
    this.day++;
  }

  /** Commuters from homes to workplaces, shoppers, and lorries supplying industry from the highway. */
  private spawnTrips(zoned: Placed[], rng: Rng): void {
    const homes: Placed[] = [];
    const work: Placed[] = [];
    const industry: Placed[] = [];
    for (const p of zoned) {
      if (!p.lot.level || !this.isConnected(p.seg)) continue;
      if (ZONES[p.lot.zone as Exclude<Zone, Zone.None>].demand === 'R') homes.push(p);
      else work.push(p);
      if (p.lot.zone === Zone.Industrial) industry.push(p);
    }
    const room = this.maxVehicles - this.traffic.vehicles.length;
    if (room <= 0) return;
    const pick = <T>(a: T[]) => a[Math.floor(rng() * a.length) % a.length];
    const at = (p: Placed): RoadPoint => ({ seg: p.seg.id, s: p.lot.s });
    const gate = this.gatePoint(rng);

    const wanted = Math.min(room, Math.round((this.stats.population + this.stats.jobs) / 60 + rng()));
    for (let i = 0; i < wanted && homes.length; i++) {
      const from = at(pick(homes));
      // Without local jobs, residents commute out of town along the highway
      const to = work.length ? at(pick(work)) : gate;
      if (to) this.traffic.spawn(from, to, 'car', rng());
    }
    if (gate && industry.length && rng() < Math.min(0.9, this.stats.jobs / 300)) {
      this.traffic.spawn(gate, at(pick(industry)), 'truck', rng());
    }
  }

  /** Where the highway enters the map, as a road point. */
  private gatePoint(rng: Rng): RoadPoint | null {
    const gates = [...this.outside];
    if (!gates.length) return null;
    const node = gates[Math.floor(rng() * gates.length) % gates.length];
    for (const s of this.net.segments.values()) {
      if (s.a === node) return { seg: s.id, s: 1 };
      if (s.b === node) return { seg: s.id, s: s.length - 1 };
    }
    return null;
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
      outside: [...this.outside],
      taxes: { ...this.taxes },
    };
  }

  static deserialize(data: SaveData): City {
    if (data.v !== 1 && data.v !== SAVE_VERSION) throw new Error(`unsupported save version ${data.v}`);
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
    for (const n of data.outside ?? []) city.outside.add(n);
    if (data.taxes) city.taxes = { ...data.taxes };
    city.roadsChanged();
    city.measure();
    return city;
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

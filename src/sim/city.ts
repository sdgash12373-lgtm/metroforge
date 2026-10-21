import { type Sample, type Vec2, clamp, curveIntersections, dist, quadPoint } from './geometry';
import { ELEVATED_HEIGHT, MAX_GRADE, RoadNetwork, type RoadSegment, type Snap, TUNNEL_DEPTH } from './roads';
import { type RoadPoint, Traffic } from './traffic';
import { BUS_SHARE, BUS_UPKEEP, STOP_COST, Transit } from './transit';
import { type DemandKey, type Lot, ZONES, Zone, generateLots, inheritLots, paintZone, recomputeBlocked } from './zoning';

export const ROAD_COST_PER_M = 20;
export const BULLDOZE_REFUND = 0.5;
/** Road upkeep per meter per day. */
export const ROAD_UPKEEP = 0.004;
export const DEFAULT_TAX = 9;
export const MAX_TAX = 29;
const SAVE_VERSION = 3;
/** Ring radius of a roundabout by its number of exits. */
export const ROUNDABOUT_RADIUS: Record<RoundaboutSize, number> = { 4: 26, 6: 34 };
/** Length of the short roads a new roundabout puts out at each exit. */
const SPOKE_LENGTH = 30;
/** An exit is skipped where an existing road already joins the ring this close to it. */
const SPOKE_CLEARANCE = (25 * Math.PI) / 180;

export type RoundaboutSize = 4 | 6;

export type Rng = () => number;

export interface CityStats {
  population: number;
  jobs: number;
  buildings: number;
  /** zoned cells that cannot grow because their road does not reach the highway */
  disconnected: number;
  /** bus boardings yesterday */
  riders: number;
}

export interface Budget {
  residentialTax: number;
  businessTax: number;
  roadUpkeep: number;
  busFares: number;
  busUpkeep: number;
}

export interface TaxRates {
  residential: number;
  business: number;
}

export interface SaveData {
  v: number;
  money: number;
  day: number;
  /** id, x, y, height (v3) */
  nodes: ([number, number, number] | [number, number, number, number])[];
  /** id, a, b, control x, control y, per-lot zone * 10 + level, 1 if one-way (v3) */
  segs: ([number, number, number, number, number, number[]] | [number, number, number, number, number, number[], number])[];
  /** node ids where roads leave the map (v2) */
  outside?: number[];
  taxes?: TaxRates;
  /** v3: bus stops (id, x, y) and lines (id, color, stop ids) */
  stops?: [number, number, number][];
  lines?: [number, number, number[]][];
}

/** A zoned cell together with the road it sits on. */
interface Placed {
  lot: Lot;
  seg: RoadSegment;
}

export class City {
  net = new RoadNetwork();
  traffic = new Traffic(this.net);
  transit = new Transit(this.net, this.traffic);
  money = 80000;
  day = 0;
  demand: Record<DemandKey, number> = { R: 50, C: 30, O: 20, I: 40 };
  stats: CityStats = { population: 0, jobs: 0, buildings: 0, disconnected: 0, riders: 0 };
  taxes: TaxRates = { residential: DEFAULT_TAX, business: DEFAULT_TAX };
  /** last day's income and expenses */
  budget: Budget = { residentialTax: 0, businessTax: 0, roadUpkeep: 0, busFares: 0, busUpkeep: 0 };
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
    this.transit.onNetworkChanged();
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

  /** Price of a road: elevated decks cost 3× a street, tunnels 4×, ramps in between. */
  roadCost(a: Vec2, c: Vec2 | null, b: Vec2, ha = 0, hb = 0): number {
    const avg = (ha + hb) / 2;
    const extra = avg >= 0 ? (2 * avg) / ELEVATED_HEIGHT : (3 * avg) / TUNNEL_DEPTH;
    return Math.round(RoadNetwork.previewLength(a, c, b) * ROAD_COST_PER_M * (1 + extra));
  }

  /** Heights the two ends of a planned road would have, given the level new road ends are built at. */
  roadHeights(start: Snap, end: Snap, height: number): [number, number] {
    return [this.net.snapHeight(start, height), this.net.snapHeight(end, height)];
  }

  /** Why a planned road can't be built for its slope, or null. */
  gradeProblem(start: Snap, control: Vec2 | null, end: Snap, height: number): string | null {
    const [ha, hb] = this.roadHeights(start, end, height);
    const climb = Math.abs(ha - hb);
    if (climb < 0.01 || climb / RoadNetwork.previewLength(start.p, control, end.p) <= MAX_GRADE) return null;
    return `坡度太陡：這段匝道至少要 ${Math.ceil(climb / MAX_GRADE)} 公尺長`;
  }

  buildRoad(
    start: Snap,
    control: Vec2 | null,
    end: Snap,
    free = false,
    height = 0,
  ): { ok: boolean; cost: number; reason?: string; endNode?: number } {
    const [ha, hb] = this.roadHeights(start, end, height);
    const cost = free ? 0 : this.roadCost(start.p, control, end.p, ha, hb);
    if (Math.hypot(start.p.x - end.p.x, start.p.y - end.p.y) < 4) return { ok: false, cost, reason: '道路太短' };
    const steep = this.gradeProblem(start, control, end, height);
    if (steep) return { ok: false, cost, reason: steep };
    if (cost > this.money) return { ok: false, cost, reason: `資金不足，需要 $${cost.toLocaleString()}` };
    const created = this.net.addRoad(start, control, end, height);
    if (!created.length) return { ok: false, cost, reason: '這裡已經有道路了' };
    this.money -= cost;
    this.roadsChanged();
    const last = created[created.length - 1];
    return { ok: true, cost, endNode: last.b };
  }

  bulldoze(p: Vec2, radius: number): { ok: boolean; refund: number; reason?: string } {
    // Roads you can see win over tunnels beneath them
    const hit = this.net.segmentAt(p, radius, 0) ?? this.net.segmentAt(p, radius);
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

  /** Estimated price of a roundabout: the ring plus its exit roads. */
  roundaboutCost(size: RoundaboutSize): number {
    return Math.round((2 * Math.PI * ROUNDABOUT_RADIUS[size] + size * SPOKE_LENGTH) * ROAD_COST_PER_M);
  }

  /**
   * A one-way ring (anticlockwise on screen, for right-hand traffic) with 4 or 6 exits.
   * Roads it crosses join the ring, road pieces left inside it are removed, and exits
   * get a short road unless an existing road already joins the ring there.
   */
  buildRoundabout(center: Vec2, size: RoundaboutSize): { ok: boolean; cost: number; reason?: string } {
    const r = ROUNDABOUT_RADIUS[size];
    const cost = this.roundaboutCost(size);
    if (cost > this.money) return { ok: false, cost, reason: `資金不足，需要 $${cost.toLocaleString()}` };
    for (const seg of this.net.segments.values()) {
      const near = seg.samples.some((p) => dist(p, center) < r + 12);
      if (!near) continue;
      if (seg.oneway) return { ok: false, cost, reason: '離另一個圓環太近' };
      if (!this.net.isStreet(seg)) return { ok: false, cost, reason: '圓環要蓋在平地上，不能壓到高架或隧道' };
    }
    // Line the exits up with the first road that crosses the ring, if any
    const circle: Sample[] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (-i / 64) * Math.PI * 2;
      circle.push({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r, t: i / 64, s: 0 });
    }
    let offset = 0;
    for (const seg of this.net.segments.values()) {
      const hit = curveIntersections(circle, seg.samples)[0];
      if (hit) {
        offset = -hit.ta * Math.PI * 2;
        break;
      }
    }
    const step = (Math.PI * 2) / size;
    const angle = (k: number) => offset - k * step;
    const at = (a: number, d: number): Vec2 => ({ x: center.x + Math.cos(a) * d, y: center.y + Math.sin(a) * d });
    const spent = this.money;

    // Ring: one quadratic arc per exit, built in driving order
    let first: number | null = null;
    let prev: number | null = null;
    for (let k = 0; k < size; k++) {
      const node = (id: number): Snap => ({ kind: 'node', node: this.net.node(id), p: this.net.node(id).p });
      const start: Snap = prev === null ? { kind: 'free', p: at(angle(k), r) } : node(prev);
      const end: Snap = k === size - 1 && first !== null ? node(first) : { kind: 'free', p: at(angle(k + 1), r) };
      const control = at(angle(k + 0.5), r / Math.cos(step / 2));
      const pieces = this.net.addRoad(start, control, end, 0, true);
      if (!pieces.length) continue;
      if (first === null) first = pieces[0].a;
      prev = pieces[pieces.length - 1].b;
    }
    // Clear the old roads inside the ring
    for (const seg of [...this.net.segments.values()]) {
      if (seg.oneway) continue;
      const mid = quadPoint(this.net.quad(seg), 0.5);
      if (dist(mid, center) < r - 2) this.net.removeSegment(seg.id);
    }
    // Exit roads where nothing joins the ring yet
    const joined: number[] = [];
    for (const seg of this.net.segments.values()) {
      if (seg.oneway) continue;
      for (const id of [seg.a, seg.b]) {
        const p = this.net.node(id).p;
        if (Math.abs(dist(p, center) - r) < 1.5) joined.push(Math.atan2(p.y - center.y, p.x - center.x));
      }
    }
    for (let k = 0; k < size; k++) {
      const a = angle(k);
      const taken = joined.some((j) => Math.abs(Math.atan2(Math.sin(j - a), Math.cos(j - a))) < SPOKE_CLEARANCE);
      if (taken) continue;
      const exit = this.net.snap(at(a, r), 1.5, 0);
      if (exit.kind === 'free') continue;
      this.net.addRoad(exit, null, { kind: 'free', p: at(a, r + SPOKE_LENGTH) });
    }
    this.money = spent - cost;
    this.roadsChanged();
    return { ok: true, cost };
  }

  /** Opens a bus line through the given stops (a loop). */
  createBusLine(stops: number[]): { ok: boolean; cost: number; reason?: string } {
    const cost = stops.length * STOP_COST;
    if (stops.length < 2) return { ok: false, cost, reason: '路線至少要兩個站' };
    if (cost > this.money) return { ok: false, cost, reason: `資金不足，需要 $${cost.toLocaleString()}` };
    const plan = this.transit.plan(stops, true);
    if (!plan.ok) return { ok: false, cost, reason: '有些站之間沒有道路相連' };
    this.money -= cost;
    this.transit.addLine(stops);
    return { ok: true, cost };
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
    this.stats = { population: pop, jobs: totalJobs, buildings, disconnected, riders: this.stats.riders };
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

    this.transit.maintain();
    this.spawnTrips(zoned, rng);

    let roadLength = 0;
    for (const s of this.net.segments.values()) roadLength += s.length;
    this.budget = {
      residentialTax: this.stats.population * this.taxes.residential * 0.005,
      businessTax: this.stats.jobs * this.taxes.business * 0.004,
      roadUpkeep: roadLength * ROAD_UPKEEP,
      // Buses pay in bursts as they reach stops; show a running average
      busFares: this.budget.busFares * 0.9 + this.transit.faresToday * 0.1,
      busUpkeep: this.transit.buses().length * BUS_UPKEEP,
    };
    const b = this.budget;
    this.money += b.residentialTax + b.businessTax + this.transit.faresToday - b.roadUpkeep - b.busUpkeep;
    this.stats.riders = this.transit.ridersToday;
    this.transit.faresToday = 0;
    this.transit.ridersToday = 0;
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
      const home = pick(homes);
      // Without local jobs, residents commute out of town along the highway
      const job = work.length ? pick(work) : null;
      // Commuters with a bus line from near home to near work mostly ride it
      if (job && this.transit.lines.size && rng() < BUS_SHARE && this.transit.board(home.lot, job.lot)) continue;
      const to = job ? at(job) : gate;
      if (to) this.traffic.spawn(at(home), to, 'car', rng());
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
      nodes: [...this.net.nodes.values()].map((n) => [n.id, round2(n.p.x), round2(n.p.y), round2(n.h)]),
      segs: [...this.net.segments.values()].map((s) => [
        s.id,
        s.a,
        s.b,
        round2(s.c.x),
        round2(s.c.y),
        s.lots.map((l) => l.zone * 10 + l.level),
        ...(s.oneway ? [1] : []),
      ] as SaveData['segs'][number]),
      outside: [...this.outside],
      taxes: { ...this.taxes },
      stops: [...this.transit.stops.values()].map((s) => [s.id, round2(s.p.x), round2(s.p.y)]),
      lines: [...this.transit.lines.values()].map((l) => [l.id, l.color, [...l.stops]]),
    };
  }

  static deserialize(data: SaveData): City {
    if (data.v < 1 || data.v > SAVE_VERSION) throw new Error(`unsupported save version ${data.v}`);
    const city = new City();
    city.money = data.money;
    city.day = data.day;
    for (const [id, x, y, h] of data.nodes) city.net.addNode({ x, y }, id, h ?? 0);
    for (const [id, a, b, cx, cy, lots, oneway] of data.segs) {
      const seg = city.net.createSegment(a, b, { x: cx, y: cy }, undefined, id, oneway === 1);
      lots.forEach((v, i) => {
        const lot = seg.lots[i];
        if (!lot) return;
        lot.zone = Math.floor(v / 10) as Zone;
        lot.level = v % 10;
      });
    }
    for (const n of data.outside ?? []) city.outside.add(n);
    if (data.taxes) city.taxes = { ...data.taxes };
    for (const [id, x, y] of data.stops ?? []) city.transit.addStop(id, { x, y });
    for (const [id, color, stops] of data.lines ?? []) city.transit.addLine(stops, id, color);
    city.roadsChanged();
    city.measure();
    return city;
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

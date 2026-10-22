import { AIRPORT_COST, AIRPORT_UPKEEP, type Airport, Aviation, FLIGHT_UPKEEP, type RunwayCount } from './airport';
import {
  FACILITIES,
  type Facility,
  type FacilityKind,
  SERVICE_KINDS,
  type ServiceKind,
  TOURIST_SPEND,
  corners as facilityCorners,
  covers,
  footprintContains,
  footprintGrid,
  isLandmark,
} from './facilities';
import { ntd } from './format';
import { type Sample, type Vec2, bboxNear, clamp, closestOnSamples, curveIntersections, dist, lerp, quadPoint, sampleQuad } from './geometry';
import { RAIL_KINDS, type RailKind, RailSystem, TRACK_UPKEEP } from './rail';
import { ELEVATED_HEIGHT, type LaneCount, MAX_GRADE, ROAD_WIDTH, RoadNetwork, roadWidth, type RoadSegment, type Snap, TUNNEL_DEPTH } from './roads';
import { Weather } from './weather';
import { type CityLevel, LEVELS, MONTH_DAYS, UNLOCK } from './levels';
import { FLAT, type Terrain, type TerrainName, TERRAINS, buildable } from './terrain';
import { type RoadPoint, Traffic } from './traffic';
import { Transit } from './transit';
import { CELL, type DemandKey, type Lot, ZONES, Zone, generateLots, inheritLots, paintZone, recomputeBlocked } from './zoning';

export const ROAD_COST_PER_M = 20;
/** Upkeep of roads, transit and public buildings is billed once every this many days (each bill is one hour's worth). */
export const UPKEEP_DAYS = 14;
/** Highest office level once a 直轄市 opens skyscrapers (otherwise 5). */
export const OFFICE_TOWER_LEVEL = 7;
export const BULLDOZE_REFUND = 0.5;
/** Simulation steps in one game day: each is half a second at normal speed, so a day lasts 20 minutes. */
export const DAY_STEPS = 2400;
/** Steps in one game hour; the budget shows money per hour. */
export const HOUR_STEPS = DAY_STEPS / 24;
/** Steps in one game month (30 days); the budget shows money per month. */
export const MONTH_STEPS = DAY_STEPS * MONTH_DAYS;

/** Road upkeep per meter per simulation step. */
export const ROAD_UPKEEP = 0.004;
export const DEFAULT_TAX = 9;
export const MAX_TAX = 29;
const SAVE_VERSION = 8;
/** Ring radius of a roundabout by its number of exits. */
export const ROUNDABOUT_RADIUS: Record<RoundaboutSize, number> = { 4: 26, 6: 34 };
/** Length of the short roads a new roundabout puts out at each exit. */
const SPOKE_LENGTH = 30;
/** An exit is skipped where an existing road already joins the ring this close to it. */
const SPOKE_CLEARANCE = (25 * Math.PI) / 180;

export type RoundaboutSize = 4 | 6;

/** A named part of town, shown as a big label on the map. */
export interface District {
  id: number;
  p: Vec2;
  /** how far the district reaches, meters */
  r: number;
  name: string;
  color: number;
}

export const DISTRICT_COLORS = [0xffffff, 0xf4d35e, 0x9ad1f5, 0xf7a072, 0xb8e0a0, 0xd7b8f3];

export type Rng = () => number;

export interface CityStats {
  population: number;
  jobs: number;
  buildings: number;
  /** zoned cells that cannot grow because their road does not reach the highway */
  disconnected: number;
  /** bus and train boardings yesterday */
  riders: number;
}

/** Facility ends at most this far from a road's edge. */
const FACILITY_ROAD_GAP = 4;
/** Residential levels need this many services in reach: level 2 one service, level 3 two, ... */
const SERVICES_PER_LEVEL = 1;

/**
 * The city's finances per game month, at the current rate: what comes in moves with the
 * population, jobs, tax rates, riders and visitors, never a fixed sum.
 * 每月收入 = 稅收 + 補助 + 規費 + 其他收入; 每月結餘 = 每月收入 − 營運支出 − 建設支出.
 */
export interface Budget {
  /** 稅收 */
  residentialTax: number;
  businessTax: number;
  /** 補助: from the central government, per resident by rank */
  subsidy: number;
  /** 規費: tickets on buses and trains, and airport fees */
  transitFares: number;
  airIncome: number;
  /** 其他收入: what visitors to the landmarks spend */
  tourism: number;
  /** 營運支出 */
  roadUpkeep: number;
  /** buses, trains and track */
  transitUpkeep: number;
  airUpkeep: number;
  /** parks, schools, police, fire, hospitals and landmarks */
  servicesUpkeep: number;
  /** civil servants and city offices, per resident by rank */
  admin: number;
  /** 建設支出: roads, track, buildings bought, averaged over the last few days */
  construction: number;
}

export function budgetTotals(b: Budget): { income: number; taxes: number; fees: number; other: number; running: number; balance: number } {
  const taxes = b.residentialTax + b.businessTax;
  const fees = b.transitFares + b.airIncome;
  const income = taxes + b.subsidy + fees + b.tourism;
  const running = b.roadUpkeep + b.transitUpkeep + b.airUpkeep + b.servicesUpkeep + b.admin;
  return { income, taxes, fees, other: b.tourism, running, balance: income - running - b.construction };
}

/** How well the city looks after its residents. */
export interface Needs {
  /** 0..100 */
  happiness: number;
  /** share of residents each service reaches, 0..1 */
  coverage: Record<ServiceKind, number>;
  /** services most residents lack, worst first */
  wants: ServiceKind[];
  /** visitors to the landmarks per game hour */
  tourists: number;
}

export interface TaxRates {
  residential: number;
  business: number;
}

/** A network's junctions and segments. */
interface NetSave {
  /** id, x, y, height (v3) */
  nodes: ([number, number, number] | [number, number, number, number])[];
  /** id, a, b, control x, control y, per-lot zone * 10 + level, 1 if one-way (v3) */
  segs: ([number, number, number, number, number, number[]] | [number, number, number, number, number, number[], number])[];
  /** v8: widened roads (segment id, lanes each way, 1 if wide sidewalks) */
  styles?: [number, number, number][];
}

/** Stops (id, x, y), lines (id, color, stop ids, name) and the fare of one kind of transport. */
interface TransitSave {
  stops?: [number, number, number][];
  lines?: ([number, number, number[]] | [number, number, number[], string])[];
  fare?: number;
}

export interface SaveData extends NetSave {
  v: number;
  money: number;
  day: number;
  /** node ids where roads leave the map (v2) */
  outside?: number[];
  taxes?: TaxRates;
  /** v3: bus stops (id, x, y), lines (id, color, stop ids, name) and the fare */
  stops?: [number, number, number][];
  lines?: ([number, number, number[]] | [number, number, number[], string])[];
  busFare?: number;
  /** v4: track networks and lines of the metro, trains and high-speed rail */
  rails?: Partial<Record<RailKind, NetSave & TransitSave>>;
  /** v4: airports (id, x, y, angle, runways), flights (id, airport, colour, name) and the air fare */
  airports?: [number, number, number, number, RunwayCount][];
  flights?: [number, number, number, string][];
  airFare?: number;
  /** v4: street names (segment id, name) and districts (id, x, y, radius, name, colour) */
  roadNames?: [number, string][];
  districts?: [number, number, number, number, string, number][];
  /** v5: the land the city stands on (older saves are flat) */
  terrain?: TerrainName;
  name?: string;
  /** v7: rank */
  level?: number;
  /** v6: parks, schools, police, fire, hospitals and landmarks (id, kind, x, y, angle) */
  facilities?: [number, FacilityKind, number, number, number][];
}

const RAIL_COST_EXTRA = { elevated: 1, tunnel: 2 };

/** A zoned cell together with the road it sits on. */
interface Placed {
  lot: Lot;
  seg: RoadSegment;
}

export class City {
  net = new RoadNetwork();
  traffic = new Traffic(this.net);
  transit = new Transit(this.net, this.traffic);
  /** shown on the start screen and in save slots */
  name = '我的城市';
  money = 500000;
  /** the sky over the city, by the climate of its land */
  readonly weather: Weather;
  /** simulation steps so far; DAY_STEPS make a day. A new city starts at 8 in the morning. */
  steps = DAY_STEPS / 3;
  /** days so far, with the part of today that has passed */
  get day(): number {
    return this.steps / DAY_STEPS;
  }
  demand: Record<DemandKey, number> = { R: 50, C: 30, O: 20, I: 40 };
  stats: CityStats = { population: 0, jobs: 0, buildings: 0, disconnected: 0, riders: 0 };
  taxes: TaxRates = { residential: DEFAULT_TAX, business: DEFAULT_TAX };
  /** income and expenses per game month, at the current rate */
  budget: Budget = {
    residentialTax: 0,
    businessTax: 0,
    subsidy: 0,
    transitFares: 0,
    airIncome: 0,
    tourism: 0,
    roadUpkeep: 0,
    transitUpkeep: 0,
    airUpkeep: 0,
    servicesUpkeep: 0,
    admin: 0,
    construction: 0,
  };
  /** rank: index into LEVELS */
  level = 0;
  /** bumped when the rank changes */
  levelVersion = 0;
  /** money spent building since the last step */
  private spentThisStep = 0;
  facilities = new Map<number, Facility>();
  nextFacility = 1;
  /** bumped when facilities are built or removed */
  facilitiesVersion = 0;
  needs: Needs = { happiness: 50, coverage: { park: 0, school: 0, police: 0, fire: 0, hospital: 0 }, wants: [], tourists: 0 };
  /** services in reach of each home, from the last survey */
  private served = new Map<Lot, number>();
  /** metro, train and high-speed rail, each on its own track */
  rails: Record<RailKind, RailSystem> = { metro: new RailSystem('metro'), train: new RailSystem('train'), hsr: new RailSystem('hsr') };
  aviation = new Aviation();
  districts = new Map<number, District>();
  nextDistrict = 1;
  /** bumped when street or district names change, so the map labels are redrawn */
  labelsVersion = 0;
  /** road ends at the map edge: the highway that people and goods come in by */
  outside = new Set<number>();
  /** junctions that can reach an outside connection */
  private connected = new Set<number>();
  maxVehicles = 400;
  /** bumped whenever roads change, so the renderer knows to rebuild meshes */
  roadsVersion = 0;
  /** what the last two-weekly upkeep bill (roads, transit, public buildings) came to */
  lastUpkeepBill = 0;
  /** bumped whenever zoning or buildings change */
  lotsVersion = 0;

  constructor(readonly terrain: Terrain = FLAT) {
    this.weather = new Weather(terrain);
    this.net.listener = {
      added: (seg, from) => {
        seg.lots = generateLots(this.net, seg);
        if (from) inheritLots(seg.lots, from.lots);
      },
      removed: () => {},
    };
  }

  /** Buses, then the train systems. */
  get transits(): Transit[] {
    return [this.transit, ...RAIL_KINDS.map((k) => this.rails[k].transit)];
  }

  private roadsChanged(): void {
    // Footbridges go with the road under them, and fit it when it is widened
    for (const f of [...this.facilities.values()]) {
      if (f.kind !== 'footbridge') continue;
      const seg = this.footbridgeRoad(f.p);
      if (!seg) this.facilities.delete(f.id);
      else f.span = roadWidth(seg) + 6;
      this.facilitiesVersion++;
    }
    recomputeBlocked(this.net, (p) => this.occupied(p));
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

  /** Water, hillside, track or an airfield on this spot, so nothing can be built on it. */
  occupied(p: Vec2): boolean {
    if (!buildable(this.terrain, p)) return true;
    // Footbridges stand on the sidewalks and leave the lots beside them free
    for (const f of this.facilities.values()) if (f.kind !== 'footbridge' && footprintContains(f, p, 2)) return true;
    for (const a of this.aviation.airports.values()) if (Aviation.contains(a, p, 2)) return true;
    const clear = ROAD_WIDTH / 2 + CELL * 0.45;
    for (const r of RAIL_KINDS) {
      const net = this.rails[r].net;
      for (const seg of net.segments.values()) {
        if (net.node(seg.a).h < 0 && net.node(seg.b).h < 0) continue;
        if (bboxNear(seg.bbox, p, clear) && closestOnSamples(seg.samples, p).d < clear) return true;
      }
    }
    return false;
  }

  /** Track or airports changed: zoning under them goes, and the renderer rebuilds. */
  private landChanged(): void {
    recomputeBlocked(this.net, (p) => this.occupied(p));
    this.lotsVersion++;
  }

  private railChanged(kind: RailKind): void {
    this.rails[kind].changed();
    this.landChanged();
  }

  /** Roads with no way through to the highway: shown in red with the warning so they're easy to find. */
  disconnectedRoads(): RoadSegment[] {
    return [...this.net.segments.values()].filter((s) => !this.isConnected(s));
  }

  /** Where the zoning that can't grow for lack of a road out is, nearest `from` first. */
  disconnectedLots(from: Vec2): Vec2[] {
    const out: Vec2[] = [];
    for (const seg of this.net.segments.values()) {
      if (this.isConnected(seg)) continue;
      for (const l of seg.lots) if (!l.blocked && l.zone !== Zone.None && !l.level) out.push({ x: l.x, y: l.y });
    }
    return out.sort((a, b) => dist(a, from) - dist(b, from));
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

  /** Price of track: elevated twice the ground price, tunnels three times. */
  trackCost(kind: RailKind, a: Vec2, c: Vec2 | null, b: Vec2, ha = 0, hb = 0): number {
    const avg = (ha + hb) / 2;
    const extra = avg >= 0 ? (RAIL_COST_EXTRA.elevated * avg) / ELEVATED_HEIGHT : (RAIL_COST_EXTRA.tunnel * avg) / TUNNEL_DEPTH;
    return Math.round(RoadNetwork.previewLength(a, c, b) * this.rails[kind].spec.costPerM * (1 + extra));
  }

  /** Heights the two ends of a planned road would have, given the level new road ends are built at. */
  roadHeights(start: Snap, end: Snap, height: number, net = this.net): [number, number] {
    return [net.snapHeight(start, height), net.snapHeight(end, height)];
  }

  /** Why a planned road can't be built for its slope, or null. */
  gradeProblem(start: Snap, control: Vec2 | null, end: Snap, height: number, net = this.net): string | null {
    const [ha, hb] = this.roadHeights(start, end, height, net);
    const climb = Math.abs(ha - hb);
    if (climb < 0.01 || climb / RoadNetwork.previewLength(start.p, control, end.p) <= MAX_GRADE) return null;
    return `坡度太陡：這段匝道至少要 ${Math.ceil(climb / MAX_GRADE)} 公尺長`;
  }

  /** Why the land won't take a road or track at these heights, or null: streets need flat dry land, viaducts clear water and low ground. */
  terrainProblem(a: Vec2, c: Vec2 | null, b: Vec2, ha: number, hb: number): string | null {
    if (this.terrain === FLAT) return null;
    const pts = sampleQuad({ a, c: c ?? lerp(a, b, 0.5), b }, Math.max(8, Math.ceil(dist(a, b) / 8)));
    for (const p of pts) {
      const h = ha + (hb - ha) * p.t;
      if (h < -1) continue;
      if (h <= 1) {
        if (this.terrain.water(p.x, p.y)) return '這裡是水面，地面蓋不了（改用高架跨過，或從地下穿過）';
        if (this.terrain.height(p.x, p.y) > 0.05) return '這裡是山坡地，地面蓋不了（改用隧道穿過）';
      } else if (this.terrain.height(p.x, p.y) > Math.max(0.05, h - 3)) return '山太高，高架過不去（改用隧道穿過）';
    }
    return null;
  }

  /** Why a planned road or track can't be built for its slope or the land under it, or null. */
  buildProblem(start: Snap, control: Vec2 | null, end: Snap, height: number, net = this.net): string | null {
    const [ha, hb] = this.roadHeights(start, end, height, net);
    return this.gradeProblem(start, control, end, height, net) ?? this.terrainProblem(start.p, control, end.p, ha, hb);
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
    const steep = this.buildProblem(start, control, end, height);
    if (steep) return { ok: false, cost, reason: steep };
    if (this.crossesAirport(start.p, control, end.p, ha, hb)) return { ok: false, cost, reason: '不能穿過機場（可以從地下穿過）' };
    if (cost > this.money) return { ok: false, cost, reason: `資金不足，需要 ${ntd(cost)}` };
    const created = this.net.addRoad(start, control, end, height);
    if (!created.length) return { ok: false, cost, reason: '這裡已經有道路了' };
    this.spend(cost);
    this.roadsChanged();
    const last = created[created.length - 1];
    return { ok: true, cost, endNode: last.b };
  }

  /** Would a road or track at these heights run across an airfield? Tunnels may pass under. */
  private crossesAirport(a: Vec2, c: Vec2 | null, b: Vec2, ha: number, hb: number): boolean {
    if (!this.aviation.airports.size || (ha < 0 && hb < 0)) return false;
    const pts = sampleQuad({ a, c: c ?? lerp(a, b, 0.5), b }, 24);
    return pts.some((p) => this.aviation.airportAt(p, 4));
  }

  /** Draws track for one kind of train, like a road: crossings at the same level become junctions. */
  buildTrack(
    kind: RailKind,
    start: Snap,
    control: Vec2 | null,
    end: Snap,
    height = 0,
    free = false,
  ): { ok: boolean; cost: number; reason?: string; endNode?: number } {
    const sys = this.rails[kind];
    const [ha, hb] = this.roadHeights(start, end, height, sys.net);
    const cost = free ? 0 : this.trackCost(kind, start.p, control, end.p, ha, hb);
    if (Math.hypot(start.p.x - end.p.x, start.p.y - end.p.y) < 4) return { ok: false, cost, reason: '軌道太短' };
    const steep = this.buildProblem(start, control, end, height, sys.net);
    if (steep) return { ok: false, cost, reason: steep };
    if (this.crossesAirport(start.p, control, end.p, ha, hb)) return { ok: false, cost, reason: '不能穿過機場（可以從地下穿過）' };
    if (cost > this.money) return { ok: false, cost, reason: `資金不足，需要 ${ntd(cost)}` };
    const created = sys.net.addRoad(start, control, end, height);
    if (!created.length) return { ok: false, cost, reason: '這裡已經有軌道了' };
    this.spend(cost);
    this.railChanged(kind);
    return { ok: true, cost, endNode: created[created.length - 1].b };
  }

  /** Places an airport centred on p, its runways turned by `angle`. */
  buildAirport(p: Vec2, angle: number, runways: RunwayCount, free = false): { ok: boolean; cost: number; reason?: string; airport?: Airport } {
    const cost = free ? 0 : AIRPORT_COST[runways];
    const plan: Airport = { id: -1, p, angle, runways };
    const inside = (q: Vec2) => Aviation.contains(plan, q, 6);
    const blocked = (net: RoadNetwork) =>
      [...net.segments.values()].some((seg) => seg.samples.some((q) => inside(q) && net.heightAt(seg, q.t) >= 0));
    const land = Aviation.corners(plan);
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      const top = lerp(land[0], land[1], i / 8);
      const bottom = lerp(land[3], land[2], i / 8);
      if (!buildable(this.terrain, lerp(top, bottom, j / 8))) return { ok: false, cost, reason: '機場要蓋在平坦的陸地上' };
    }
    if (blocked(this.net)) return { ok: false, cost, reason: '機場範圍內有道路，請換個空地' };
    if (RAIL_KINDS.some((k) => blocked(this.rails[k].net))) return { ok: false, cost, reason: '機場範圍內有軌道，請換個空地' };
    for (const a of this.aviation.airports.values()) {
      if (Aviation.corners(plan).some((q) => Aviation.contains(a, q)) || Aviation.corners(a).some((q) => inside(q)) || dist(a.p, p) < 300) {
        return { ok: false, cost, reason: '離另一座機場太近' };
      }
    }
    if (cost > this.money) return { ok: false, cost, reason: `資金不足，需要 ${ntd(cost)}` };
    this.spend(cost);
    const airport = this.aviation.addAirport(p, angle, runways);
    this.landChanged();
    return { ok: true, cost, airport };
  }

  /**
   * Where a facility tapped at p would go: set back from the nearest street, facing it.
   * Without a street close by it stays at p, turned by `angle`.
   */
  facilitySpot(kind: FacilityKind, p: Vec2, angle = 0): { p: Vec2; angle: number; road: boolean } {
    const { d } = FACILITIES[kind];
    const hit = this.net.segmentAt(p, kind === 'footbridge' ? 30 : d + ROAD_WIDTH, 0);
    if (!hit || !this.net.isStreet(hit.seg)) return { p, angle, road: false };
    const s = hit.seg.samples;
    const i = Math.max(1, s.findIndex((q) => q.t >= hit.t));
    const a = s[i - 1];
    const b = s[i] ?? s[s.length - 1];
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    const on = quadPoint(this.net.quad(hit.seg), hit.t);
    // Normal pointing to the side of the road that was tapped
    let nx = -ty / len;
    let ny = tx / len;
    if ((p.x - on.x) * nx + (p.y - on.y) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    // A footbridge stands across the road, its stairs on both kerbs
    if (kind === 'footbridge') return { p: on, angle: Math.atan2(ny, nx) - Math.PI / 2, road: true };
    const back = roadWidth(hit.seg) / 2 + FACILITY_ROAD_GAP / 2 + d / 2;
    // The footprint's depth axis points away from the road
    return { p: { x: on.x + nx * back, y: on.y + ny * back }, angle: Math.atan2(ny, nx) - Math.PI / 2, road: true };
  }

  /** Why a facility can't go here, or null. */
  facilityProblem(kind: FacilityKind, p: Vec2, angle: number): string | null {
    const spec = FACILITIES[kind];
    if (spec.unlock && !this.unlocked(spec.unlock)) return `城市升級為「${LEVELS[UNLOCK[spec.unlock]].name}」後才能蓋${spec.label}`;
    if (kind === 'footbridge') return this.footbridgeProblem(p, angle);
    const plan = { kind, p, angle };
    if (isLandmark(kind) && [...this.facilities.values()].some((f) => f.kind === kind)) return `城市裡已經有${spec.label}了`;
    if (footprintGrid(plan).some((q) => !buildable(this.terrain, q))) return `${spec.label}要蓋在平坦的陸地上`;
    const inside = (q: Vec2) => footprintContains(plan, q, 1);
    const hits = (net: RoadNetwork) => [...net.segments.values()].some((seg) => seg.samples.some((q) => inside(q) && net.heightAt(seg, q.t) >= 0));
    if (hits(this.net) || RAIL_KINDS.some((k) => hits(this.rails[k].net))) return '這裡有道路或軌道，請換個空地';
    if (facilityCorners(plan).some((q) => this.aviation.airportAt(q)) || footprintGrid(plan, 3).some((q) => this.aviation.airportAt(q))) return '這裡是機場';
    for (const f of this.facilities.values()) {
      if (facilityCorners(plan).some((q) => footprintContains(f, q)) || facilityCorners(f).some((q) => inside(q)) || footprintContains(f, p)) {
        return `這裡已經有${FACILITIES[f.kind].label}`;
      }
    }
    const reach = Math.max(spec.w, spec.d) / 2 + this.widestRoadNear(p, Math.max(spec.w, spec.d)) / 2 + FACILITY_ROAD_GAP + 2;
    if (!this.net.segmentAt(p, reach, 0)) return `${spec.label}要蓋在道路旁邊`;
    if (spec.cost > this.money) return `資金不足，需要 ${ntd(spec.cost)}`;
    return null;
  }

  /** Widest street near p, so facilities set back from wide roads still count as beside one. */
  private widestRoadNear(p: Vec2, r: number): number {
    let w = ROAD_WIDTH;
    for (const seg of this.net.segments.values()) if (bboxNear(seg.bbox, p, r + 40)) w = Math.max(w, roadWidth(seg));
    return w;
  }

  /** The road a footbridge at p would cross: a street, away from junctions. */
  private footbridgeRoad(p: Vec2): RoadSegment | null {
    const hit = this.net.segmentAt(p, 3, 0);
    return hit && this.net.isStreet(hit.seg) ? hit.seg : null;
  }

  private footbridgeProblem(p: Vec2, angle: number): string | null {
    const seg = this.footbridgeRoad(p);
    if (!seg) return '天橋要蓋在一般道路上，橫跨馬路';
    if ([seg.a, seg.b].some((n) => dist(this.net.node(n).p, p) < roadWidth(seg) / 2 + 12)) return '離路口太近';
    const span = roadWidth(seg) + 6;
    for (const f of this.facilities.values()) {
      if (f.kind === 'footbridge' && dist(f.p, p) < 40) return '附近已經有天橋';
      if (f.kind !== 'footbridge' && facilityCorners({ kind: 'footbridge', p, angle, span }).some((q) => footprintContains(f, q))) return `這裡已經有${FACILITIES[f.kind].label}`;
    }
    if (FACILITIES.footbridge.cost > this.money) return `資金不足，需要 ${ntd(FACILITIES.footbridge.cost)}`;
    return null;
  }

  buildFacility(kind: FacilityKind, p: Vec2, angle: number, free = false): { ok: boolean; cost: number; reason?: string; facility?: Facility } {
    const cost = free ? 0 : FACILITIES[kind].cost;
    const problem = this.facilityProblem(kind, p, angle);
    if (problem && !(free && problem.startsWith('資金不足'))) return { ok: false, cost, reason: problem };
    this.spend(cost);
    const facility = this.addFacility(kind, p, angle);
    return { ok: true, cost, facility };
  }

  private addFacility(kind: FacilityKind, p: Vec2, angle: number, id?: number): Facility {
    const f: Facility = { id: id ?? this.nextFacility++, kind, p: { x: p.x, y: p.y }, angle };
    if (kind === 'footbridge') {
      const seg = this.footbridgeRoad(p);
      f.span = (seg ? roadWidth(seg) : ROAD_WIDTH) + 6;
    }
    this.nextFacility = Math.max(this.nextFacility, f.id + 1);
    this.facilities.set(f.id, f);
    this.facilitiesVersion++;
    this.landChanged();
    return f;
  }

  removeFacility(id: number): void {
    if (!this.facilities.delete(id)) return;
    this.facilitiesVersion++;
    this.landChanged();
  }

  /** Tears down the facility at p and gives back part of what it cost (建設拆除). */
  demolish(p: Vec2, pad = 2): { ok: boolean; refund: number; reason?: string; what?: string } {
    const f = this.facilityAt(p, pad);
    if (!f) return { ok: false, refund: 0, reason: '點一棟公共建設或地標來拆除' };
    const refund = Math.round(FACILITIES[f.kind].cost * BULLDOZE_REFUND);
    this.removeFacility(f.id);
    this.spend(-refund);
    return { ok: true, refund, what: FACILITIES[f.kind].label };
  }

  facilityAt(p: Vec2, pad = 0): Facility | null {
    for (const f of this.facilities.values()) if (footprintContains(f, p, pad)) return f;
    return null;
  }

  /** Services within reach of a point, and how much landmarks around it add (0..1). */
  servicesAt(p: Vec2): { kinds: Set<ServiceKind>; landmark: number } {
    const kinds = new Set<ServiceKind>();
    let landmark = 0;
    for (const f of this.facilities.values()) {
      if (!covers(f, p)) continue;
      const spec = FACILITIES[f.kind];
      if (isLandmark(f.kind)) landmark += 0.5;
      else if (f.kind === 'footbridge') landmark += 0.1;
      else if (spec.serves) kinds.add(spec.serves);
      else kinds.add(f.kind as ServiceKind);
    }
    return { kinds, landmark: Math.min(1, landmark) };
  }

  /**
   * Removes what is at p: roads and track you can see first, then an airport, then tunnels.
   * Returns what was removed so the UI can say so.
   */
  bulldoze(p: Vec2, radius: number): { ok: boolean; refund: number; reason?: string; what?: string } {
    const ground = this.net.segmentAt(p, radius, 0);
    if (ground) return this.bulldozeRoad(ground.seg);
    for (const level of [0, ELEVATED_HEIGHT]) {
      for (const k of RAIL_KINDS) {
        const hit = this.rails[k].net.segmentAt(p, radius, level);
        if (hit) return this.bulldozeTrack(k, hit.seg);
      }
    }
    const facility = this.facilityAt(p);
    if (facility) {
      const refund = Math.round(FACILITIES[facility.kind].cost * BULLDOZE_REFUND);
      this.removeFacility(facility.id);
      this.spend(-refund);
      return { ok: true, refund, what: FACILITIES[facility.kind].label };
    }
    const airport = this.aviation.airportAt(p);
    if (airport) {
      const refund = Math.round(AIRPORT_COST[airport.runways] * BULLDOZE_REFUND);
      this.aviation.removeAirport(airport.id);
      this.spend(-refund);
      this.landChanged();
      return { ok: true, refund, what: '機場' };
    }
    const any = this.net.segmentAt(p, radius);
    if (any) return this.bulldozeRoad(any.seg);
    for (const k of RAIL_KINDS) {
      const hit = this.rails[k].net.segmentAt(p, radius);
      if (hit) return this.bulldozeTrack(k, hit.seg);
    }
    return { ok: false, refund: 0 };
  }

  private bulldozeTrack(kind: RailKind, seg: RoadSegment): { ok: boolean; refund: number; what: string } {
    const sys = this.rails[kind];
    const refund = Math.round(seg.length * sys.spec.costPerM * BULLDOZE_REFUND);
    sys.net.removeSegment(seg.id);
    this.spend(-refund);
    this.railChanged(kind);
    return { ok: true, refund, what: `${sys.spec.mode.label}軌道` };
  }

  private bulldozeRoad(seg: RoadSegment): { ok: boolean; refund: number; reason?: string; what?: string } {
    if (this.outside.has(seg.a) || this.outside.has(seg.b)) {
      return { ok: false, refund: 0, reason: '這段是對外的高速公路，不能拆除' };
    }
    const refund = Math.round(seg.length * ROAD_COST_PER_M * BULLDOZE_REFUND);
    this.net.removeSegment(seg.id);
    this.spend(-refund);
    this.roadsChanged();
    return { ok: true, refund, what: '道路' };
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
    if (cost > this.money) return { ok: false, cost, reason: `資金不足，需要 ${ntd(cost)}` };
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      if (!buildable(this.terrain, { x: center.x + Math.cos(a) * (r + 10), y: center.y + Math.sin(a) * (r + 10) })) {
        return { ok: false, cost, reason: '圓環要蓋在平坦的陸地上' };
      }
    }
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
    this.money = spent;
    this.spend(cost);
    this.roadsChanged();
    return { ok: true, cost };
  }

  /** Price of restyling a street: widening is paid per metre and per added lane, narrowing is free. */
  restyleCost(segs: RoadSegment[], style: RoadStyle): number {
    let cost = 0;
    for (const seg of segs) {
      const lanes = style.lanes ?? seg.lanes ?? 1;
      cost += seg.length * Math.max(0, lanes - (seg.lanes ?? 1)) * ROAD_COST_PER_M * 2;
      if (style.walk && !seg.walk) cost += seg.length * ROAD_COST_PER_M * 1.5;
    }
    return Math.round(cost);
  }

  /**
   * Changes the lanes or sidewalks of the street a segment belongs to (opens at 縣轄市). Lots are laid
   * out again further back from the new kerb and keep their zoning and buildings.
   */
  restyleRoad(segId: number, style: RoadStyle): { ok: boolean; cost: number; reason?: string } {
    const seg = this.net.segments.get(segId);
    if (!seg) return { ok: false, cost: 0, reason: '找不到道路' };
    if (!this.unlocked('roadUpgrade')) return { ok: false, cost: 0, reason: `升級為${LEVELS[UNLOCK.roadUpgrade].name}後開放` };
    if (seg.oneway) return { ok: false, cost: 0, reason: '圓環不能升級' };
    const segs = this.net.street(seg).filter((s) => (style.lanes ?? s.lanes ?? 1) !== (s.lanes ?? 1) || (style.walk ?? !!s.walk) !== !!s.walk);
    if (!segs.length) return { ok: false, cost: 0, reason: '已經是這個樣式' };
    const cost = this.restyleCost(segs, style);
    if (cost > this.money) return { ok: false, cost, reason: '資金不足' };
    for (const s of segs) applyStyle(this.net, s, style);
    this.spend(cost);
    this.roadsChanged();
    return { ok: true, cost };
  }

  /** Names the street a segment belongs to (blank clears it). */
  nameStreet(segId: number, name: string): void {
    const seg = this.net.segments.get(segId);
    if (!seg) return;
    const clean = name.trim().slice(0, 20) || undefined;
    for (const s of this.net.street(seg)) s.name = clean;
    this.labelsVersion++;
  }

  addDistrict(p: Vec2, r: number, opts: { id?: number; name?: string; color?: number } = {}): District {
    const id = opts.id ?? this.nextDistrict++;
    this.nextDistrict = Math.max(this.nextDistrict, id + 1);
    const d: District = {
      id,
      p: { x: p.x, y: p.y },
      r,
      name: opts.name ?? `區域 ${id}`,
      color: opts.color ?? DISTRICT_COLORS[(id - 1) % DISTRICT_COLORS.length],
    };
    this.districts.set(id, d);
    this.labelsVersion++;
    return d;
  }

  /** The district whose label or middle is near p. */
  districtAt(p: Vec2, reach: number): District | null {
    let best: District | null = null;
    let bd = Infinity;
    for (const d of this.districts.values()) {
      const dd = dist(d.p, p);
      if (dd < Math.max(reach, d.r * 0.35) && dd < bd) {
        bd = dd;
        best = d;
      }
    }
    return best;
  }

  editDistrict(id: number, change: { name?: string; color?: number; r?: number }): void {
    const d = this.districts.get(id);
    if (!d) return;
    if (change.name !== undefined) d.name = change.name.trim().slice(0, 20) || `區域 ${id}`;
    if (change.color !== undefined) d.color = change.color;
    if (change.r !== undefined) d.r = change.r;
    this.labelsVersion++;
  }

  removeDistrict(id: number): void {
    this.districts.delete(id);
    this.labelsVersion++;
  }

  /** Opens a bus line through the given stops (a loop). */
  createBusLine(stops: number[]): { ok: boolean; cost: number; reason?: string } {
    return this.createLine(this.transit, stops);
  }

  /** Opens a line through the given stops: buses loop round them, trains run back and forth. */
  createLine(transit: Transit, stops: number[]): { ok: boolean; cost: number; reason?: string } {
    const cost = stops.length * transit.mode.stopCost;
    if (stops.length < 2) return { ok: false, cost, reason: '路線至少要兩個站' };
    if (cost > this.money) return { ok: false, cost, reason: `資金不足，需要 ${ntd(cost)}` };
    const plan = transit.plan(stops, true);
    if (!plan.ok) return { ok: false, cost, reason: transit.mode.streetsOnly ? '有些站之間沒有道路相連' : '有些車站之間沒有軌道相連' };
    this.spend(cost);
    transit.addLine(stops);
    return { ok: true, cost };
  }

  paint(center: Vec2, radius: number, zone: Zone, overwrite = false): number {
    const n = paintZone(this.net, center, radius, zone, overwrite);
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
    const reach: Record<ServiceKind, number> = { park: 0, school: 0, police: 0, fire: 0, hospital: 0 };
    let satisfied = 0;
    this.served.clear();
    for (const seg of this.net.segments.values()) {
      const linked = this.isConnected(seg);
      for (const lot of seg.lots) {
        if (lot.blocked || lot.zone === Zone.None) continue;
        zoned.push({ lot, seg });
        if (!linked && !lot.level) disconnected++;
        if (!lot.level) continue;
        buildings++;
        const info = ZONES[lot.zone];
        if (info.demand === 'R') {
          const people = lot.level * info.perLevel;
          pop += people;
          const s = this.facilities.size ? this.servicesAt(lot) : { kinds: new Set<ServiceKind>(), landmark: 0 };
          for (const k of s.kinds) reach[k] += people;
          this.served.set(lot, s.kinds.size + s.landmark);
          satisfied += people * Math.min(1, (s.kinds.size + s.landmark) / SERVICE_KINDS.length);
        } else jobs[info.demand] += lot.level * info.perLevel;
      }
    }
    const totalJobs = jobs.C + jobs.O + jobs.I;
    const coverage = { park: 0, school: 0, police: 0, fire: 0, hospital: 0 };
    for (const k of SERVICE_KINDS) coverage[k] = pop ? reach[k] / pop : 0;
    const hall = [...this.facilities.values()].some((f) => f.kind === 'cityHall') ? 8 : 0;
    const happiness = pop ? clamp(Math.round(30 + 65 * (satisfied / pop) + hall), 0, 100) : 50;
    const wants = SERVICE_KINDS.filter((k) => coverage[k] < 0.6).sort((a, b) => coverage[a] - coverage[b]);
    this.needs = { happiness, coverage, wants, tourists: this.needs.tourists };
    // Happy residents bring more; landmarks' visitors bring shops and offices
    const mood = pop > 60 ? (happiness - 45) * 0.3 : 0;
    const visitors = Math.min(15, this.needs.tourists / 6);
    const d = (v: number) => clamp(Math.round(v), 0, 100);
    // Demand follows how far supply is from what the city needs, as a share rather than a head
    // count, so the bars keep moving in a big city instead of sticking at full or empty
    const gap = (want: number, have: number, slack: number) => 42 * Math.tanh((1.6 * (want - have)) / (want + have + slack));
    // Every tax point above the default costs demand
    const rTax = (this.taxes.residential - DEFAULT_TAX) * 3;
    const bTax = (this.taxes.business - DEFAULT_TAX) * 3;
    this.demand = {
      R: d(50 + gap(totalJobs * 1.1 + 40, pop, 80) - rTax + mood),
      C: d(45 + gap(pop * 0.25 + 15, jobs.C, 40) - bTax + visitors),
      O: d(35 + gap(pop * 0.2 + 10, jobs.O, 40) - bTax + visitors * 0.5),
      I: d(45 + gap(pop * 0.3 + 15, jobs.I, 40) - bTax),
    };
    this.stats = { population: pop, jobs: totalJobs, buildings, disconnected, riders: this.stats.riders };
    return zoned;
  }

  /**
   * Highest level a building can reach. Homes need services in reach to grow tall: one more for
   * each level, and a school for the top levels of high-density housing.
   */
  levelCap(lot: Lot): number {
    const info = ZONES[lot.zone as Exclude<Zone, Zone.None>];
    // A 直轄市's office districts keep growing into skyscrapers
    if (lot.zone === Zone.Office && this.unlocked('tallOffices')) return OFFICE_TOWER_LEVEL;
    if (info.demand !== 'R') return info.maxLevel;
    const served = this.served.get(lot) ?? 0;
    let cap = Math.min(info.maxLevel, 1 + Math.floor(served / SERVICES_PER_LEVEL));
    if (lot.zone === Zone.ResidentialHigh && cap > 2 && !this.servicesAt(lot).kinds.has('school')) cap = 2;
    return cap;
  }

  /** Homes with parks and services nearby grow faster. */
  private growthBoost(lot: Lot): number {
    if (ZONES[lot.zone as Exclude<Zone, Zone.None>].demand !== 'R') return 1;
    return 0.5 + 0.5 * Math.min(1, (this.served.get(lot) ?? 0) / 3);
  }

  /** How jammed a segment is in its busier direction, 0..1. */
  congestion(seg: RoadSegment): number {
    return Math.max(this.traffic.congestion(seg, 1), this.traffic.congestion(seg, -1));
  }

  /** Pays for building (or takes back a refund), counted as 建設支出. */
  private spend(cost: number): void {
    this.money -= cost;
    this.spentThisStep += cost;
  }

  /** The next rank and how far the city is from each of its bars, or null at the top. */
  nextLevel(): { level: CityLevel; checks: { label: string; have: number; need: number; ok: boolean }[]; ready: boolean } | null {
    const level = LEVELS[this.level + 1];
    if (!level) return null;
    const t = budgetTotals(this.budget);
    const checks = [
      { label: '人口', have: this.stats.population, need: level.population },
      { label: '每月收入', have: t.income, need: level.income },
      { label: '每月結餘', have: t.balance, need: level.balance },
    ].map((c) => ({ ...c, ok: c.have >= c.need }));
    return { level, checks, ready: checks.every((c) => c.ok) };
  }

  /** Moves up a rank when every bar is met. */
  upgrade(): boolean {
    if (!this.nextLevel()?.ready) return false;
    this.level++;
    this.levelVersion++;
    return true;
  }

  /** Whether the city's rank has opened a feature. */
  unlocked(feature: keyof typeof UNLOCK): boolean {
    return this.level >= UNLOCK[feature];
  }

  /**
   * One simulation step (half a second at normal speed): demand, building growth (needs a road to the highway;
   * slowed by jams), new trips onto the roads, then taxes and upkeep. The rates below are per step;
   * the budget shows them per hour.
   */
  tick(rng: Rng = Math.random): void {
    const zoned = this.survey();
    let changed = false;
    const attempts = Math.min(16, zoned.length);
    for (let i = 0; i < attempts; i++) {
      const { lot, seg } = zoned[Math.floor(rng() * zoned.length) % zoned.length];
      if (!this.isConnected(seg)) continue;
      const info = ZONES[lot.zone as Exclude<Zone, Zone.None>];
      // Below a quarter the bar means "enough for now": nothing new is built
      const want = clamp((this.demand[info.demand] - 25) / 75, 0, 1);
      // Back rows only build once the row in front has something on it
      if (lot.front && lot.front.level === 0) continue;
      if (lot.level === 0) {
        if (rng() < want) {
          lot.level = 1;
          changed = true;
        }
      } else if (lot.level < this.levelCap(lot) && rng() < 0.03 * (0.3 + want) * (1 - 0.7 * this.congestion(seg)) * this.growthBoost(lot)) {
        lot.level++;
        changed = true;
      }
    }
    if (changed) this.lotsVersion++;

    for (const t of this.transits) t.maintain();
    this.spawnTrips(zoned, rng);
    // Trains and high-speed rail also carry people from out of town
    for (const k of RAIL_KINDS) {
      const sys = this.rails[k];
      const want = this.stats.population * sys.spec.visitorsPerResident * sys.transit.share();
      sys.transit.visitors(Math.floor(want) + (rng() < want % 1 ? 1 : 0), rng);
    }

    let roadLength = 0;
    for (const s of this.net.segments.values()) roadLength += s.length;
    let fares = 0;
    let upkeep = 0;
    let riders = 0;
    for (const t of this.transits) {
      fares += t.faresToday;
      riders += t.ridersToday;
      upkeep += t.buses().length * t.mode.upkeep;
      t.faresToday = 0;
      t.ridersToday = 0;
    }
    for (const k of RAIL_KINDS) upkeep += this.rails[k].trackLength() * TRACK_UPKEEP;
    const air = this.aviation;
    // Each building's bill, paid every two weeks
    let bill = 0;
    let tourists = 0;
    for (const f of this.facilities.values()) {
      const spec = FACILITIES[f.kind];
      bill += spec.upkeep * HOUR_STEPS;
      if (spec.tourists) tourists += (spec.tourists * (20 + this.stats.population / 1000)) / DAY_STEPS;
    }
    // Few visitors come in a storm, none in a typhoon
    tourists *= { clear: 1, cloudy: 1, fog: 0.9, rain: 0.75, storm: 0.5, typhoon: 0 }[this.weather.sky];
    this.needs.tourists = Math.round(tourists * HOUR_STEPS);
    const rank = LEVELS[this.level];
    const pop = this.stats.population;
    const step = {
      subsidy: (pop * rank.subsidy) / MONTH_STEPS,
      admin: (pop * rank.admin) / MONTH_STEPS,
      residentialTax: this.stats.population * this.taxes.residential * 0.0025,
      businessTax: this.stats.jobs * this.taxes.business * 0.002,
      // Roads, transit and public buildings: an hour's upkeep billed once every two weeks,
      // spread over the two weeks for the monthly budget
      roadUpkeep: (roadLength * ROAD_UPKEEP * HOUR_STEPS) / (UPKEEP_DAYS * DAY_STEPS),
      transitUpkeep: (upkeep * HOUR_STEPS) / (UPKEEP_DAYS * DAY_STEPS),
      airUpkeep: air.airports.size * AIRPORT_UPKEEP + air.flights.size * FLIGHT_UPKEEP,
      servicesUpkeep: bill / (UPKEEP_DAYS * DAY_STEPS),
      tourism: tourists * TOURIST_SPEND,
    };
    const perMonth = (v: number) => v * MONTH_STEPS;
    // Construction averages over about three days so one big build doesn't swing the month
    const ease = 1 / (3 * DAY_STEPS);
    this.budget = {
      residentialTax: perMonth(step.residentialTax),
      businessTax: perMonth(step.businessTax),
      subsidy: perMonth(step.subsidy),
      // Fares come in bursts as vehicles reach stops and planes leave; show running averages
      transitFares: this.budget.transitFares * 0.9 + perMonth(fares) * 0.1,
      airIncome: this.budget.airIncome * 0.97 + perMonth(air.incomeToday) * 0.03,
      tourism: perMonth(step.tourism),
      roadUpkeep: perMonth(step.roadUpkeep),
      transitUpkeep: perMonth(step.transitUpkeep),
      airUpkeep: perMonth(step.airUpkeep),
      servicesUpkeep: perMonth(step.servicesUpkeep),
      admin: perMonth(step.admin),
      construction: this.budget.construction * (1 - ease) + perMonth(this.spentThisStep) * ease,
    };
    this.spentThisStep = 0;
    this.money +=
      step.residentialTax + step.businessTax + step.subsidy + fares + air.incomeToday + step.tourism -
      step.airUpkeep - step.admin;
    if (this.steps % (UPKEEP_DAYS * DAY_STEPS) === 0) {
      const due = (roadLength * ROAD_UPKEEP + upkeep) * HOUR_STEPS + bill;
      this.money -= due;
      this.lastUpkeepBill = due;
    }
    this.stats.riders = riders;
    air.incomeToday = 0;
    air.passengersToday = 0;
    this.steps++;
    this.weather.step(this.day, 1 / DAY_STEPS, rng);
  }

  /** Moves every vehicle, train and plane on by dt seconds. */
  drive(dt: number): void {
    this.traffic.step(dt);
    for (const k of RAIL_KINDS) this.rails[k].traffic.step(dt);
    this.aviation.step(dt, this.stats.population);
  }

  /** Puts a commuter on the bus or train that suits their trip best, if any line serves it. */
  private rideTransit(from: Vec2, to: Vec2, rng: Rng): boolean {
    let best: { t: Transit; o: NonNullable<ReturnType<Transit['option']>>; score: number } | null = null;
    for (const t of this.transits) {
      if (!t.lines.size) continue;
      const o = t.option(from, to);
      if (!o) continue;
      const score = o.walk - t.mode.appeal;
      if (!best || score < best.score) best = { t, o, score };
    }
    return !!best && rng() < best.t.share() && best.t.enqueue(best.o);
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
      // Commuters with a bus or train line from near home to near work mostly ride it
      if (job && this.rideTransit(home.lot, job.lot, rng)) continue;
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
    const air = this.aviation;
    const rails: SaveData['rails'] = {};
    for (const k of RAIL_KINDS) {
      const sys = this.rails[k];
      if (sys.net.segments.size) rails[k] = { ...saveNet(sys.net), ...saveTransit(sys.transit) };
    }
    const bus = saveTransit(this.transit);
    return {
      v: SAVE_VERSION,
      money: Math.round(this.money),
      day: this.day,
      ...saveNet(this.net),
      outside: [...this.outside],
      taxes: { ...this.taxes },
      stops: bus.stops,
      lines: bus.lines,
      busFare: bus.fare,
      rails,
      airports: [...air.airports.values()].map((a) => [a.id, round2(a.p.x), round2(a.p.y), round2(a.angle * 1000) / 1000, a.runways]),
      flights: [...air.flights.values()].map((f) => [f.id, f.airport, f.color, f.name]),
      airFare: air.fare,
      roadNames: [...this.net.segments.values()].filter((s) => s.name).map((s) => [s.id, s.name!]),
      districts: [...this.districts.values()].map((d) => [d.id, round2(d.p.x), round2(d.p.y), Math.round(d.r), d.name, d.color]),
      terrain: this.terrain.name,
      name: this.name,
      level: this.level,
      facilities: [...this.facilities.values()].map((f) => [f.id, f.kind, round2(f.p.x), round2(f.p.y), round2(f.angle * 1000) / 1000]),
    };
  }

  static deserialize(data: SaveData): City {
    if (data.v < 1 || data.v > SAVE_VERSION) throw new Error(`unsupported save version ${data.v}`);
    const city = new City(TERRAINS[data.terrain ?? 'flat'] ?? FLAT);
    city.money = data.money;
    city.steps = Math.round(data.day * DAY_STEPS);
    if (data.name) city.name = data.name;
    city.level = Math.min(LEVELS.length - 1, data.level ?? 0);
    loadNet(city.net, data, true);
    for (const n of data.outside ?? []) city.outside.add(n);
    if (data.taxes) city.taxes = { ...data.taxes };
    loadTransit(city.transit, { stops: data.stops, lines: data.lines, fare: data.busFare });
    for (const k of RAIL_KINDS) {
      const r = data.rails?.[k];
      if (!r) continue;
      const sys = city.rails[k];
      loadNet(sys.net, r, false);
      loadTransit(sys.transit, r);
      sys.changed();
    }
    for (const [id, x, y, angle, runways] of data.airports ?? []) city.aviation.addAirport({ x, y }, angle, runways, id);
    for (const [id, airport, color, name] of data.flights ?? []) city.aviation.addFlight(airport, { id, color, name });
    if (data.airFare !== undefined) city.aviation.fare = data.airFare;
    for (const [id, name] of data.roadNames ?? []) {
      const seg = city.net.segments.get(id);
      if (seg) seg.name = name;
    }
    for (const [id, x, y, r, name, color] of data.districts ?? []) city.addDistrict({ x, y }, r, { id, name, color });
    for (const [id, kind, x, y, angle] of data.facilities ?? []) if (FACILITIES[kind]) city.addFacility(kind, { x, y }, angle, id);
    city.roadsChanged();
    city.measure();
    return city;
  }
}

function saveNet(net: RoadNetwork): NetSave {
  return {
    nodes: [...net.nodes.values()].map((n) => [n.id, round2(n.p.x), round2(n.p.y), round2(n.h)]),
    segs: [...net.segments.values()].map((s) => [
      s.id,
      s.a,
      s.b,
      round2(s.c.x),
      round2(s.c.y),
      s.lots.map((l) => l.zone * 10 + l.level),
      ...(s.oneway ? [1] : []),
    ] as NetSave['segs'][number]),
    styles: [...net.segments.values()].filter((s) => s.lanes || s.walk).map((s) => [s.id, s.lanes ?? 1, s.walk ? 1 : 0]),
  };
}

export interface RoadStyle {
  lanes?: LaneCount;
  walk?: boolean;
}

/** Gives a segment new lanes or sidewalks and lays its lots out again, keeping what stood on each. */
function applyStyle(net: RoadNetwork, seg: RoadSegment, style: RoadStyle): void {
  const old = seg.lots;
  if (style.lanes !== undefined) seg.lanes = style.lanes === 1 ? undefined : style.lanes;
  if (style.walk !== undefined) seg.walk = style.walk || undefined;
  seg.lots = generateLots(net, seg);
  // Same segment, same layout: each lot is the one at the same place in the list, just moved back
  seg.lots.forEach((l, i) => {
    const o = old[i];
    if (!o) return;
    l.zone = o.zone;
    l.level = o.level;
  });
}

function loadNet(net: RoadNetwork, data: NetSave, lots: boolean): void {
  for (const [id, x, y, h] of data.nodes) net.addNode({ x, y }, id, h ?? 0);
  const styles = new Map((data.styles ?? []).map(([id, lanes, walk]) => [id, { lanes: lanes as LaneCount, walk: walk === 1 }]));
  for (const [id, a, b, cx, cy, zoning, oneway] of data.segs) {
    const seg = net.createSegment(a, b, { x: cx, y: cy }, undefined, id, oneway === 1);
    const style = styles.get(id);
    if (style) applyStyle(net, seg, style);
    if (!lots) continue;
    zoning.forEach((v, i) => {
      const lot = seg.lots[i];
      if (!lot) return;
      lot.zone = Math.floor(v / 10) as Zone;
      lot.level = v % 10;
    });
  }
}

function saveTransit(t: Transit): TransitSave {
  return {
    stops: [...t.stops.values()].map((s) => [s.id, round2(s.p.x), round2(s.p.y)]),
    lines: [...t.lines.values()].map((l) => [l.id, l.color, [...l.stops], l.name]),
    fare: t.fare,
  };
}

function loadTransit(t: Transit, data: TransitSave): void {
  for (const [id, x, y] of data.stops ?? []) t.addStop(id, { x, y });
  for (const [id, color, stops, name] of data.lines ?? []) t.addLine(stops, id, color, name);
  if (data.fare !== undefined) t.fare = data.fare;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

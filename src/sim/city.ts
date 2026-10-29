import { ACCESS_Y, AIRPORT_COST, AIRPORT_UPKEEP, type Airport, Aviation, FLIGHT_UPKEEP, type RunwayCount } from './airport';
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
  isPort,
  PORT_BERTH,
  PORT_LAND,
  toWorld,
} from './facilities';
import { ntd } from './format';
import { type Households, PEOPLE_PER_HOUSEHOLD, bracketOf, emptyHouseholds, residentIncome } from './income';
import { type Sample, type Vec2, bboxNear, clamp, closestOnSamples, curveIntersections, dist, lerp, quadPoint, quadTangent, sampleQuad } from './geometry';
import { RAIL_KINDS, type RailKind, RailSystem, TRACK_UPKEEP } from './rail';
import { type StationPose, stationCovers, stationFront, stationPose, stationSide } from './stations';
import { ELEVATED_HEIGHT, type LaneCount, LEVEL_TOLERANCE, MAX_GRADE, MIN_SEGMENT, ROAD_WIDTH, RoadNetwork, type RoadNode, roadWidth, type RoadSegment, type Snap, TUNNEL_DEPTH } from './roads';
import { Weather } from './weather';
import { type CityLevel, LEVELS, MONTH_DAYS, UNLOCK } from './levels';
import { FLAT, FLAT_CLASSIC, PLAIN, REGION_NAMES, type RegionName, type Terrain, type TerrainName, TERRAINS, buildable } from './terrain';
import { type RoadPoint, Traffic, taxiTint } from './traffic';
import { type BusStop, type StationStyle, Transit } from './transit';
import { CELL, DEPTH, type DemandKey, type Lot, ZONES, Zone, cellCenter, isIndustry, generateLots, inheritLots, paintZone, recomputeBlocked } from './zoning';

export const ROAD_COST_PER_M = 20;
/** Upkeep of roads, transit and public buildings is billed once every this many days (each bill is one hour's worth). */
export const UPKEEP_DAYS = 14;
/** Highest office level once a 直轄市 opens skyscrapers (otherwise 5). */
export const OFFICE_TOWER_LEVEL = 7;
export const BULLDOZE_REFUND = 0.5;
/** Simulation steps in one game day: each is half a second at normal speed, so a day lasts 20 minutes. */
/** Patrol cars each police station keeps on the road */
export const PATROLS_PER_STATION = 2;
export const DAY_STEPS = 2400;
/** Steps in one game hour; the budget shows money per hour. */
export const HOUR_STEPS = DAY_STEPS / 24;
/** Steps in one game month (30 days); the budget shows money per month. */
export const MONTH_STEPS = DAY_STEPS * MONTH_DAYS;

/** Road upkeep per meter per simulation step. */
export const ROAD_UPKEEP = 0.004;
export const DEFAULT_TAX = 9;
export const MAX_TAX = 29;
const SAVE_VERSION = 9;
/** Ring radius of a roundabout by its number of exits. */
/** Where the single highway road entered the map in cities from before the freeway */
export const GATE: Vec2 = { x: -480, y: 60 };
/**
 * A new city's freeway: north–south on viaducts west of the plain (north is -y), with an interchange
 * whose two ramps come down at `exit` and an access road running on into town.
 */
export const FREEWAY = { x: -700, north: -1000, south: 700, ramp: 160, exit: { x: -560, y: 0 }, town: { x: -304, y: 0 }, name: '國道 1 號' };

/**
 * A freeway laid out along `axis` (pointing to its north end) through `center`: the main line runs `north`
 * and `south` metres each way, the ramps meet it `ramp` metres either side of the middle, and the
 * interchange (`exit`) and the end of the access road (`town`) lie that far off it towards `side`.
 */
export interface FreewaySpec {
  center: Vec2;
  axis: Vec2;
  side: Vec2;
  north: number;
  south: number;
  ramp: number;
  exit: number;
  town: number;
  name: string;
}

const RS = Math.SQRT1_2;
/** Each region's freeway: 國道 1 號 west of Kaohsiung, 國道 3 號 up the Pingtung Plain east of Pingtung city. */
/** Level each region's own train station is built at: Kaohsiung's underground, Pingtung's on a viaduct. */
export const STATION_LEVEL: Record<RegionName, number> = { kaohsiung: TUNNEL_DEPTH, pingtung: ELEVATED_HEIGHT };
/** Track a train station comes with either side of its middle, a little longer than its platforms, kept level. */
export const STATION_LEVEL_HALF = 50;
/** Ramp from there back to street level for a station underground or on a viaduct, as steep as track may be. */
export const STATION_RAMP = 48;
/** How far from the street (beyond its edge) a tap may be to build a train station beside it. */
export const STATION_STREET_REACH = 40;
/** A region's own station costs this many times an ordinary one, besides its track. */
export const SPECIAL_STATION_COST = 3;

/** A station standing on a rail line: where, which side its building is on, and whether it is Kaohsiung's own. */
export interface StationSpot {
  kind: RailKind;
  pose: StationPose;
  side: 1 | -1;
  wide: boolean;
  stop: BusStop;
}

export const FREEWAYS: Record<RegionName, FreewaySpec> = {
  kaohsiung: { center: { x: FREEWAY.x, y: 0 }, axis: { x: 0, y: -1 }, side: { x: 1, y: 0 }, north: -FREEWAY.north, south: FREEWAY.south, ramp: FREEWAY.ramp, exit: 140, town: 396, name: FREEWAY.name },
  // Turned axes: up the plain (u) and away from the Gaoping River (v), the town on the river side
  pingtung: { center: { x: 1900 * RS, y: 1900 * RS }, axis: { x: RS, y: -RS }, side: { x: -RS, y: -RS }, north: 1300, south: 1250, ramp: 160, exit: 140, town: 400, name: '國道 3 號' },
};

/** A point `a` metres along a freeway and `c` across it, towards its town. */
export function freewayPoint(f: FreewaySpec, a: number, c: number): Vec2 {
  // + 0 turns -0 into 0
  return { x: f.center.x + f.axis.x * a + f.side.x * c + 0, y: f.center.y + f.axis.y * a + f.side.y * c + 0 };
}

/** Where a region's access road ends, on a cell centre: a new city starts here. */
export const freewayTown = (region: RegionName): Vec2 => cellCenter(freewayPoint(FREEWAYS[region], 0, FREEWAYS[region].town));

/** Price of opening another region of the map, and the rank it can be opened at. */
export const REGION_COST = 1_000_000;
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
/** A new airport's access road reaches this far for a street, meters. */
export const AIRPORT_ROAD_REACH = 400;
/** An airport's access road has two lanes each way. */
export const AIRPORT_ROAD_LANES: LaneCount = 2;
/** A building's road side must be this close to a street's middle, meters. */
const FACILITY_ROAD_REACH = 20;
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
  /** 汽燃稅: a share of car owners' income */
  fuelTax: number;
  /** 補助: from the central government, per resident by rank */
  subsidy: number;
  /** 規費: tickets on buses and trains, and airport fees */
  transitFares: number;
  airIncome: number;
  /** 其他收入: what visitors to the landmarks spend */
  tourism: number;
  /** 外貿收入: industry's goods shipped abroad through cargo ports */
  trade: number;
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
  const taxes = b.residentialTax + b.businessTax + b.fuelTax;
  const fees = b.transitFares + b.airIncome;
  const income = taxes + b.subsidy + fees + b.tourism + b.trade;
  const running = b.roadUpkeep + b.transitUpkeep + b.airUpkeep + b.servicesUpkeep + b.admin;
  return { income, taxes, fees, other: b.tourism + b.trade, running, balance: income - running - b.construction };
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
  /** share of residents living near a chemical plant, 0..1 */
  polluted: number;
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
  /** v8: widened roads (segment id, lanes each way, 1 if wide sidewalks, 1 if freeway) */
  styles?: ([number, number, number] | [number, number, number, number])[];
}

/** Stops (id, x, y), lines (id, color, stop ids, name) and the fare of one kind of transport. */
interface TransitSave {
  /** id, x, y; then for a train station built on its own, its style and the side its building is on */
  stops?: ([number, number, number] | [number, number, number, StationStyle, 1 | -1])[];
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
  /** id, x, y; then for a train station built on its own, its style and the side its building is on */
  stops?: ([number, number, number] | [number, number, number, StationStyle, 1 | -1])[];
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
  /** v9: parts of the map opened (older saves have only Kaohsiung) */
  regions?: RegionName[];
}

const RAIL_COST_EXTRA = { elevated: 1, tunnel: 2 };
/** NT$ of goods each industrial job makes a month, times its zone's `goods`. */
export const GOODS_PER_JOB = 900;
/** Goods a cargo port can ship a month, NT$. */
export const PORT_CAPACITY = 60_000_000;
/** The city's share of the goods it ships abroad (customs, port dues, trade). */
export const TRADE_SHARE = 0.25;
/** Each landmark makes a cruise port's visitors this much more keen. */
const CRUISE_LANDMARK_BOOST = 0.15;

/** What industry makes and how much of it leaves through the cargo ports, per month. */
export interface Trade {
  /** cargo ports */
  ports: number;
  /** goods made by all industry, NT$ a month */
  goods: number;
  /** goods made by industry with a road to a cargo port */
  reachable: number;
  /** goods shipped: the reachable ones up to the capacity of the ports on their road network */
  shipped: number;
}

/** 林業 needs forested hills this close, meters. */
export const FOREST_REACH = 160;
/** Homes this close to a chemical plant breathe its fumes, meters. */
export const POLLUTION_REACH = 250;

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
    fuelTax: 0,
    subsidy: 0,
    transitFares: 0,
    airIncome: 0,
    tourism: 0,
    trade: 0,
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
  needs: Needs = { happiness: 50, coverage: { park: 0, school: 0, police: 0, fire: 0, hospital: 0 }, wants: [], tourists: 0, polluted: 0 };
  /** services in reach of each home, from the last survey */
  private served = new Map<Lot, number>();
  /** yearly income of each resident of a home */
  private incomes = new Map<Lot, number>();
  /** residents by income bracket and what car owners pay in fuel tax */
  households: Households = emptyHouseholds();
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
  /** bumped when zones are painted or lots are blocked or freed, but not when buildings grow */
  zoningVersion = 0;
  /** exports through the cargo ports, from the last survey */
  trade: Trade = { ports: 0, goods: 0, reachable: 0, shipped: 0 };
  private portCache: { key: string; ports: { f: Facility; at: RoadPoint; piece: number }[] } | null = null;
  /** which road network piece each junction belongs to, for linking industry to ports */
  private component = new Map<number, number>();
  /** parts of the map the city may build in */
  regions = new Set<RegionName>(['kaohsiung']);
  /** bumped when a region is opened */
  regionsVersion = 0;
  private stationCache: { key: string; spots: StationSpot[] } | null = null;
  private stationsSeen: number[] = [];

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
    // Stations may move to the other side of their track now the streets differ (roadsVersion is bumped below)
    this.stationCache = null;
    recomputeBlocked(this.net, (p) => this.occupied(p));
    this.traffic.onNetworkChanged();
    this.transit.onNetworkChanged();
    this.computeConnectivity();
    this.roadsVersion++;
    this.lotsVersion++;
    this.zoningVersion++;
  }

  private computeConnectivity(): void {
    this.connected.clear();
    const adj = new Map<number, number[]>();
    for (const s of this.net.segments.values()) {
      (adj.get(s.a) ?? adj.set(s.a, []).get(s.a)!).push(s.b);
      (adj.get(s.b) ?? adj.set(s.b, []).get(s.b)!).push(s.a);
    }
    // Pieces of road network, so goods can tell whether a road leads to a port
    this.component.clear();
    let pieces = 0;
    for (const start of adj.keys()) {
      if (this.component.has(start)) continue;
      const id = pieces++;
      const todo = [start];
      this.component.set(start, id);
      while (todo.length) {
        for (const m of adj.get(todo.pop()!) ?? []) {
          if (this.component.has(m)) continue;
          this.component.set(m, id);
          todo.push(m);
        }
      }
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

  /** Water, hillside, track, a station or an airfield on this spot, so nothing can be built on it. */
  occupied(p: Vec2): boolean {
    if (!this.open(p) || !buildable(this.terrain, p)) return true;
    for (const st of this.stationSpots()) if (stationCovers(st.kind, st.pose, st.side, p, CELL * 0.45, st.wide)) return true;
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

  /** Whether p lies in a part of the map the city has opened. */
  open(p: Vec2): boolean {
    const r = this.terrain.region(p.x, p.y);
    return r !== null && this.regions.has(r);
  }

  /** Why nothing can be built at p for the region it is in, or null. */
  regionProblem(p: Vec2): string | null {
    const r = this.terrain.region(p.x, p.y);
    if (r === null) return '超出地圖範圍';
    if (this.regions.has(r)) return null;
    return `${REGION_NAMES[r]}尚未開通（城市升級為${LEVELS[UNLOCK.region].name}後，可在等級面板花 NT$${REGION_COST / 10000}萬 開通）`;
  }

  /** Regions of this land not opened yet. */
  lockedRegions(): RegionName[] {
    return this.terrain.regions.filter((r) => !this.regions.has(r));
  }

  /** Why a region can't be opened now, or null. */
  regionOpenProblem(r: RegionName): string | null {
    if (!this.terrain.regions.includes(r)) return '這張地圖沒有這個區域';
    if (this.regions.has(r)) return `${REGION_NAMES[r]}已經開通`;
    if (!this.unlocked('region')) return `城市升級為「${LEVELS[UNLOCK.region].name}」後才能開通`;
    if (this.money < REGION_COST) return `資金不足，需要 ${ntd(REGION_COST)}`;
    return null;
  }

  /**
   * Opens another part of the map for NT$1,000,000 (from 縣轄市 on). Its freeway is laid too unless one
   * already runs there, giving the new region its own way in.
   */
  openRegion(r: RegionName): { ok: boolean; reason?: string } {
    const problem = this.regionOpenProblem(r);
    if (problem) return { ok: false, reason: problem };
    this.spend(REGION_COST);
    this.regions.add(r);
    this.regionsVersion++;
    const hasFreeway = [...this.net.segments.values()].some((s) => s.highway && this.terrain.region(s.samples[0].x, s.samples[0].y) === r);
    if (!hasFreeway) this.buildFreeway(r);
    else this.roadsChanged();
    return { ok: true };
  }

  /** Train, high-speed and metro stations on lines, where they stand and which side their building is on. */
  stationSpots(): StationSpot[] {
    const key = `${this.roadsVersion}:${RAIL_KINDS.map((k) => `${this.rails[k].version}.${this.rails[k].transit.version}`).join(':')}`;
    if (this.stationCache?.key === key) return this.stationCache.spots;
    const spots: StationSpot[] = [];
    for (const kind of RAIL_KINDS) {
      const sys = this.rails[kind];
      const used = new Set<number>();
      for (const l of sys.transit.lines.values()) for (const id of l.stops) used.add(id);
      // Stations built on their own stand before any line stops there
      for (const st of sys.transit.stops.values()) if (st.style) used.add(st.id);
      for (const id of used) {
        const stop = sys.transit.stops.get(id);
        const pose = stop && stationPose(sys, stop);
        if (!stop || !pose) continue;
        const side = stop.face ?? (kind === 'metro' ? 1 : stationSide(this.net, kind, pose));
        spots.push({ kind, pose, side, wide: stop.style === 'kaohsiung', stop });
      }
    }
    this.stationCache = { key, spots };
    return spots;
  }

  /** Whether any rail system's track or stations changed since last asked (without allocating: it runs every step). */
  private stationsChanged(): boolean {
    let changed = false;
    RAIL_KINDS.forEach((k, i) => {
      const v = this.rails[k].version * 1e6 + this.rails[k].transit.version;
      if (this.stationsSeen[i] !== v) {
        this.stationsSeen[i] = v;
        changed = true;
      }
    });
    return changed;
  }

  /** Track or airports changed: zoning under them goes, and the renderer rebuilds. */
  private landChanged(): void {
    recomputeBlocked(this.net, (p) => this.occupied(p));
    this.lotsVersion++;
    this.zoningVersion++;
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

  /**
   * Puts the highway back if every entry to it has been removed (an earlier version let a roundabout
   * clear it away): joins the nearest road to the gate, with a short free stub when it's not right there.
   */
  restoreGate(): boolean {
    if (!this.outside.size || [...this.outside].some((n) => this.net.nodes.has(n))) return false;
    this.outside.clear();
    let best: { id: number; d: number } | null = null;
    for (const n of this.net.nodes.values()) {
      if (n.h !== 0) continue;
      const d = dist(n.p, GATE);
      if (!best || d < best.d) best = { id: n.id, d };
    }
    if (!best) return false;
    if (best.d < 12) this.outside.add(best.id);
    else {
      const pieces = this.net.addRoad({ kind: 'free', p: GATE }, null, { kind: 'node', node: this.net.node(best.id), p: this.net.node(best.id).p });
      const gate = pieces.find((s) => dist(this.net.node(s.a).p, GATE) < 0.5)?.a ?? pieces[0]?.a;
      if (gate === undefined) return false;
      this.outside.add(gate);
      this.roadsChanged();
    }
    this.computeConnectivity();
    return true;
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
  terrainProblem(a: Vec2, c: Vec2 | null, b: Vec2, ha: number, hb: number, terrain = this.terrain): string | null {
    const pts = sampleQuad({ a, c: c ?? lerp(a, b, 0.5), b }, Math.max(8, Math.ceil(dist(a, b) / 8)));
    for (const p of pts) {
      const locked = this.regionProblem(p);
      if (locked) return locked;
    }
    if (terrain === FLAT || terrain === FLAT_CLASSIC) return null;
    for (const p of pts) {
      const h = ha + (hb - ha) * p.t;
      if (h < -1) continue;
      if (h <= 1) {
        if (terrain.water(p.x, p.y)) return '這裡是水面，地面蓋不了（改用高架跨過，或從地下穿過）';
        if (terrain.height(p.x, p.y) > 0.05) return '這裡是山坡地，地面蓋不了（改用隧道穿過）';
      } else if (terrain.height(p.x, p.y) > Math.max(0.05, h - 3)) return '山太高，高架過不去（改用隧道穿過）';
    }
    return null;
  }

  /** Why a planned road or track can't be built for its slope or the land under it, or null. */
  buildProblem(start: Snap, control: Vec2 | null, end: Snap, height: number, net = this.net): string | null {
    const [ha, hb] = this.roadHeights(start, end, height, net);
    return (
      this.gradeProblem(start, control, end, height, net) ??
      this.terrainProblem(start.p, control, end.p, ha, hb) ??
      (net === this.net ? this.freewayProblem(start, control, end, ha, hb) : null)
    );
  }

  /** Roads may pass over or under the freeway but only join it at the interchange, which is already built. */
  private freewayProblem(start: Snap, control: Vec2 | null, end: Snap, ha: number, hb: number): string | null {
    const net = this.net;
    const highways = [...net.segments.values()].filter((s) => s.highway);
    if (!highways.length) return null;
    const reason = '高速公路只能從交流道進出，可以從上方或下方穿過';
    const onFreeway = (s: Snap, h: number): boolean => {
      const at = s.kind === 'free' ? net.snapLevel(s.p, 0.5, h) : s;
      if (at.kind === 'segment') return !!at.seg.highway;
      if (at.kind === 'node') {
        const touching = [...net.segments.values()].filter((x) => x.a === at.node.id || x.b === at.node.id);
        return touching.length > 0 && touching.every((x) => x.highway);
      }
      return false;
    };
    if (onFreeway(start, ha) || onFreeway(end, hb)) return reason;
    const quad = { a: start.p, c: control ?? lerp(start.p, end.p, 0.5), b: end.p };
    const samples = sampleQuad(quad, 48);
    for (const seg of highways) {
      for (const x of curveIntersections(samples, seg.samples)) {
        const p = quadPoint(quad, x.ta);
        if (dist(p, start.p) < MIN_SEGMENT || dist(p, end.p) < MIN_SEGMENT) continue;
        const t = x.ta * x.ta * (3 - 2 * x.ta);
        if (Math.abs(ha + (hb - ha) * t - net.heightAt(seg, x.tb)) < LEVEL_TOLERANCE) return reason;
      }
    }
    return null;
  }

  /**
   * Lays out a region's freeway, free: the main line on viaducts (two lanes each way) leaving the map at
   * both ends, two ramps down to the interchange, and an access road into town.
   */
  buildFreeway(region: RegionName = 'kaohsiung'): void {
    const net = this.net;
    const f = FREEWAYS[region];
    const at = (a: number, c: number) => freewayPoint(f, a, c);
    const free = (p: Vec2): Snap => ({ kind: 'free', p });
    const main = net.addRoad(free(at(f.north, 0)), null, free(at(-f.south, 0)), ELEVATED_HEIGHT);
    for (const s of main) Object.assign(s, { lanes: 2, highway: true, name: f.name });
    const ends = [main[0].a, main[main.length - 1].b];
    const exit = region === 'kaohsiung' ? at(0, f.exit) : cellCenter(at(0, f.exit));
    const access = net.addRoad(free(exit), null, free(region === 'kaohsiung' ? at(0, f.town) : freewayTown(region)), 0);
    for (const s of access) applyStyle(net, s, { lanes: 2 });
    const g = net.node(access[0].a);
    for (const dir of [-1, 1]) {
      const on = net.snap(at(-dir * f.ramp, 0), 1, ELEVATED_HEIGHT);
      const control = at(-dir * f.ramp * 0.3, 10);
      for (const s of net.addRoad({ kind: 'node', node: g, p: g.p }, control, on, 0)) s.highway = true;
    }
    for (const n of ends) this.outside.add(n);
    this.labelsVersion++;
    this.roadsChanged();
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

  /**
   * Where a train station built beside the street nearest p would go: its track along the street, far enough out
   * for the building to stand between them and front onto it. `special` asks for the region's own station, built
   * as its real one is: Kaohsiung's underground and Pingtung's on a viaduct, with ramps at both ends back to
   * street level. Every station comes with its stretch of track; lines of track are then drawn on from its ends.
   */
  planTrainStation(p: Vec2, special: boolean): {
    cost: number;
    reason?: string;
    style?: StationStyle;
    centre?: Vec2;
    d?: Vec2;
    face?: 1 | -1;
  } {
    const sys = this.rails.train;
    let best: { seg: RoadSegment; t: number; d: number } | null = null;
    for (const seg of this.net.segments.values()) {
      if (!this.net.isStreet(seg) || !bboxNear(seg.bbox, p, STATION_STREET_REACH + roadWidth(seg))) continue;
      const c = closestOnSamples(seg.samples, p);
      const d = c.d - roadWidth(seg) / 2;
      if (d <= STATION_STREET_REACH && (!best || d < best.d)) best = { seg, t: c.t, d };
    }
    if (!best) return { cost: 0, reason: '火車站要蓋在路邊：請點在道路旁邊' };
    const region = this.terrain.region(p.x, p.y);
    if (special && !region) return { cost: 0, reason: '這裡不屬於任何地區，沒有特色車站' };
    const style: StationStyle = special && region ? region : 'standard';
    if (special && region && [...sys.transit.stops.values()].some((st) => st.style === region)) {
      return { cost: 0, reason: `${REGION_NAMES[region]}已經有特色車站了（每區限蓋一座）` };
    }
    const q = this.net.quad(best.seg);
    const at = quadPoint(q, best.t);
    const tan = quadTangent(q, best.t);
    // Out from the street towards where the player tapped
    let n = { x: -tan.y, y: tan.x };
    if ((p.x - at.x) * n.x + (p.y - at.y) * n.y < 0) n = { x: -n.x, y: -n.y };
    const wide = style === 'kaohsiung';
    const offset = stationFront(wide) + roadWidth(best.seg) / 2 + 1.5;
    const centre = { x: at.x + n.x * offset, y: at.y + n.y * offset };
    // The building stands on the side of the track towards the street
    const face: 1 | -1 = -tan.y * -n.x + tan.x * -n.y > 0 ? 1 : -1;
    const level = style === 'standard' ? 0 : STATION_LEVEL[style];
    const half = level ? STATION_LEVEL_HALF + STATION_RAMP : STATION_LEVEL_HALF;
    const a = { x: centre.x - tan.x * half, y: centre.y - tan.y * half };
    const b = { x: centre.x + tan.x * half, y: centre.y + tan.y * half };
    for (const end of [a, b, centre]) {
      const locked = this.regionProblem(end);
      if (locked) return { cost: 0, reason: locked };
    }
    // Clear ground: no track already there, no street under what stands at street level
    for (let k = 0; k <= 40; k++) {
      const pt = lerp(a, b, k / 40);
      if (sys.net.segmentAt(pt, 8)) return { cost: 0, reason: '這裡已經有軌道了，請換個地方' };
    }
    const pose: StationPose = { p: centre, d: tan, h: level };
    for (const seg of this.net.segments.values()) {
      if (seg === best.seg || !bboxNear(seg.bbox, centre, 120)) continue;
      if (seg.samples.some((pt) => stationCovers('train', pose, face, pt, roadWidth(seg) / 2, wide) && this.net.heightAt(seg, pt.t) >= 0)) {
        return { cost: 0, reason: '車站範圍內有其他道路，請換個地方' };
      }
    }
    if (this.terrainProblem(a, null, b, 0, 0) && !level) return { cost: 0, reason: this.terrainProblem(a, null, b, 0, 0)! };
    const cost = this.trackCost('train', a, null, b, level, level) + sys.spec.mode.stopCost * (style === 'standard' ? 1 : SPECIAL_STATION_COST);
    if (cost > this.money) return { cost, reason: `資金不足，需要 ${ntd(cost)}` };
    return { cost, style, centre, d: tan, face };
  }

  /** Builds a train station beside the street nearest p (see planTrainStation): its track, then the station on it. */
  buildTrainStation(p: Vec2, special: boolean): { ok: boolean; cost: number; reason?: string; style?: StationStyle; stop?: number } {
    const plan = this.planTrainStation(p, special);
    if (plan.reason || !plan.centre || !plan.d || !plan.style || !plan.face) return { ok: false, cost: plan.cost, reason: plan.reason };
    const { centre, d, style, face } = plan;
    const sys = this.rails.train;
    const level = style === 'standard' ? 0 : STATION_LEVEL[style];
    // Laid at street level in pieces, then the middle taken down or up: level along the platforms, ramps either end
    const marks = level ? [-1, -STATION_LEVEL_HALF / (STATION_LEVEL_HALF + STATION_RAMP), STATION_LEVEL_HALF / (STATION_LEVEL_HALF + STATION_RAMP), 1] : [-1, 1];
    const half = level ? STATION_LEVEL_HALF + STATION_RAMP : STATION_LEVEL_HALF;
    const pts = marks.map((m) => ({ x: centre.x + d.x * m * half, y: centre.y + d.y * m * half }));
    const nodes: RoadNode[] = [];
    let start: Snap = { kind: 'free', p: pts[0] };
    for (let i = 1; i < pts.length; i++) {
      const created = sys.net.addRoad(start, null, { kind: 'free', p: pts[i] }, 0);
      const seg = created[created.length - 1];
      if (i === 1) nodes.push(sys.net.node(created[0].a));
      const end = sys.net.node(seg.b);
      nodes.push(end);
      start = { kind: 'node', node: end, p: end.p };
    }
    if (level) for (const n of nodes.slice(1, -1)) n.h = level;
    const stop = sys.transit.stopAt(centre, 4);
    if (!stop) return { ok: false, cost: 0, reason: '車站蓋不起來，請換個地方' };
    stop.style = style;
    stop.face = face;
    this.spend(plan.cost);
    this.railChanged('train');
    return { ok: true, cost: plan.cost, style, stop: stop.id };
  }

  /** Takes down a train station built on its own, unless a line still stops there. Its track stays. */
  private bulldozeTrainStation(p: Vec2): { ok: boolean; refund: number; reason?: string; what?: string } | null {
    const sys = this.rails.train;
    for (const st of this.stationSpots()) {
      if (st.kind !== 'train' || !st.stop.style || !stationCovers('train', st.pose, st.side, p, 0, st.wide)) continue;
      const line = [...sys.transit.lines.values()].find((l) => l.stops.includes(st.stop.id));
      if (line) return { ok: false, refund: 0, reason: `「${line.name}」還停靠這個車站，請先拆除路線` };
      sys.transit.stops.delete(st.stop.id);
      sys.transit.version++;
      const refund = Math.round(sys.spec.mode.stopCost * BULLDOZE_REFUND);
      this.spend(-refund);
      this.railChanged('train');
      return { ok: true, refund, what: st.stop.style === 'standard' ? '火車站' : '特色車站' };
    }
    return null;
  }

  /**
   * Whether an airport can go here and what it costs: the airfield on flat open land, and an access
   * road from the middle of its landside (the terminal's side) to the nearest street it can reach.
   */
  planAirport(p: Vec2, angle: number, runways: RunwayCount, free = false, checkMoney = true): { cost: number; reason?: string; access?: { start: Vec2; end: Snap } } {
    let cost = free ? 0 : AIRPORT_COST[runways];
    const plan: Airport = { id: -1, p, angle, runways };
    const inside = (q: Vec2) => Aviation.contains(plan, q, 6);
    const blocked = (net: RoadNetwork) =>
      [...net.segments.values()].some((seg) => seg.samples.some((q) => inside(q) && net.heightAt(seg, q.t) >= 0));
    const land = Aviation.corners(plan);
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      const top = lerp(land[0], land[1], i / 8);
      const bottom = lerp(land[3], land[2], i / 8);
      const q = lerp(top, bottom, j / 8);
      const locked = this.regionProblem(q);
      if (locked) return { cost, reason: locked };
      if (!buildable(this.terrain, q)) return { cost, reason: '機場要蓋在平坦的陸地上' };
    }
    if (blocked(this.net)) return { cost, reason: '機場範圍內有道路，請換個空地' };
    if (RAIL_KINDS.some((k) => blocked(this.rails[k].net))) return { cost, reason: '機場範圍內有軌道，請換個空地' };
    for (const a of this.aviation.airports.values()) {
      if (Aviation.corners(plan).some((q) => Aviation.contains(a, q)) || Aviation.corners(a).some((q) => inside(q)) || dist(a.p, p) < 300) {
        return { cost, reason: '離另一座機場太近' };
      }
    }
    const access = this.airportAccess(plan);
    if (!access) return { cost, reason: `航廈那一側 ${AIRPORT_ROAD_REACH} 公尺內要有道路，機場才接得上聯外道路（可以「旋轉」讓航廈朝向道路）` };
    // A road with its extra lanes, priced as building one and widening it
    if (!free) cost += this.roadCost(access.start, null, access.end.p, 0, 0) * (2 * AIRPORT_ROAD_LANES - 1);
    if (checkMoney && cost > this.money) return { cost, reason: `資金不足，需要 ${ntd(cost)}` };
    return { cost, access };
  }

  /** The access road a new airport gets: straight out from the middle of its landside to the nearest street it can reach without crossing an airfield. */
  private airportAccess(plan: Airport): { start: Vec2; end: Snap } | null {
    const start = Aviation.toWorld(plan, { x: 0, y: ACCESS_Y });
    const spots: { seg: RoadSegment; t: number; d: number }[] = [];
    for (const seg of this.net.segments.values()) {
      if (!this.net.isStreet(seg) || !bboxNear(seg.bbox, start, AIRPORT_ROAD_REACH)) continue;
      for (const q of seg.samples) {
        const d = dist(q, start);
        if (d < AIRPORT_ROAD_REACH && d > 6 && Math.abs(this.net.heightAt(seg, q.t)) < LEVEL_TOLERANCE) spots.push({ seg, t: q.t, d });
      }
    }
    spots.sort((a, b) => a.d - b.d || a.seg.id - b.seg.id || a.t - b.t);
    // Spots whose line runs over the new airfield are dropped first, so the costlier checks below
    // are capped only among roads the access road could actually reach.
    let tries = 0;
    for (const s of spots) {
      const end: Snap = { kind: 'segment', seg: s.seg, t: s.t, p: quadPoint(this.net.quad(s.seg), s.t) };
      const line = sampleQuad({ a: start, c: lerp(start, end.p, 0.5), b: end.p }, 24);
      if (line.some((q) => Aviation.contains(plan, q, 4))) continue;
      if (++tries > 60) break;
      if (this.crossesAirport(start, null, end.p, 0, 0)) continue;
      if (this.buildProblem({ kind: 'free', p: start }, null, end, 0)) continue;
      return { start, end };
    }
    return null;
  }

  /** Widens an access road from its start at the airport up to the first junction. */
  private widenAccess(start: Vec2): void {
    const hit = this.net.segmentAt(start, 3, 0);
    if (!hit) return;
    let seg: RoadSegment | undefined = hit.seg;
    let node = dist(this.net.node(seg.a).p, start) <= dist(this.net.node(seg.b).p, start) ? seg.a : seg.b;
    for (let i = 0; seg && i < 50; i++) {
      if (seg.highway || !this.net.isStreet(seg)) return;
      if ((seg.lanes ?? 1) < AIRPORT_ROAD_LANES) applyStyle(this.net, seg, { lanes: AIRPORT_ROAD_LANES });
      node = seg.a === node ? seg.b : seg.a;
      if (this.net.degree(node) !== 2) return;
      const prev: RoadSegment = seg;
      seg = [...this.net.segments.values()].find((s) => s !== prev && (s.a === node || s.b === node));
    }
  }

  private layAccess(access: { start: Vec2; end: Snap }): void {
    for (const s of this.net.addRoad({ kind: 'free', p: access.start }, null, access.end, 0)) applyStyle(this.net, s, { lanes: AIRPORT_ROAD_LANES });
  }

  /** Where an airport's access road starts, as a road point, if the road is there and reaches the highway. */
  private airportExit(a: Airport): RoadPoint | null {
    const start = Aviation.toWorld(a, { x: 0, y: ACCESS_Y });
    const hit = this.net.segmentAt(start, 3, 0);
    if (!hit || !this.isConnected(hit.seg)) return null;
    const seg = hit.seg;
    return dist(this.net.node(seg.a).p, start) <= dist(this.net.node(seg.b).p, start) ? { seg: seg.id, s: 1 } : { seg: seg.id, s: seg.length - 1 };
  }

  /** Places an airport centred on p, its runways turned by `angle`, with an access road out to the streets. */
  buildAirport(p: Vec2, angle: number, runways: RunwayCount, free = false): { ok: boolean; cost: number; reason?: string; airport?: Airport } {
    const plan = this.planAirport(p, angle, runways, free);
    if (!plan.access) return { ok: false, cost: plan.cost, reason: plan.reason };
    this.spend(plan.cost);
    this.layAccess(plan.access);
    const airport = this.aviation.addAirport(p, angle, runways);
    this.roadsChanged();
    this.landChanged();
    return { ok: true, cost: plan.cost, airport };
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
    for (const q of footprintGrid(plan)) {
      const locked = this.regionProblem(q);
      if (locked) return locked;
    }
    if (isPort(kind)) {
      const coast = this.portCoastProblem(plan);
      if (coast) return coast;
    } else if (footprintGrid(plan).some((q) => !buildable(this.terrain, q))) return `${spec.label}要蓋在平坦的陸地上`;
    const inside = (q: Vec2) => footprintContains(plan, q, 1);
    const hits = (net: RoadNetwork) => [...net.segments.values()].some((seg) => seg.samples.some((q) => inside(q) && net.heightAt(seg, q.t) >= 0));
    if (hits(this.net) || RAIL_KINDS.some((k) => hits(this.rails[k].net))) return '這裡有道路或軌道，請換個空地';
    if (facilityCorners(plan).some((q) => this.aviation.airportAt(q)) || footprintGrid(plan, 3).some((q) => this.aviation.airportAt(q))) return '這裡是機場';
    for (const f of this.facilities.values()) {
      if (facilityCorners(plan).some((q) => footprintContains(f, q)) || facilityCorners(f).some((q) => inside(q)) || footprintContains(f, p)) {
        return `這裡已經有${FACILITIES[f.kind].label}`;
      }
    }
    // The side facing the road (its front, -v) has to sit on a street, so the building is reached from it
    const front = this.net.segmentAt(toWorld(plan, 0, -spec.d / 2 - FACILITY_ROAD_GAP / 2), FACILITY_ROAD_REACH, 0);
    if (!front || !this.net.isStreet(front.seg)) {
      return isPort(kind) ? `${spec.label}靠陸地的一側要接上道路：點海邊道路靠海的一側興建` : `${spec.label}要蓋在道路旁邊：點道路旁的空地興建`;
    }
    if (spec.cost > this.money) return `資金不足，需要 ${ntd(spec.cost)}`;
    return null;
  }

  /**
   * Ports go on the coastline: the side by the road on land, the far side (where ships berth) out in the
   * sea, not on a river, and nothing on a hillside in between.
   */
  private portCoastProblem(plan: { kind: FacilityKind; p: Vec2; angle: number }): string | null {
    const { w, d } = FACILITIES[plan.kind];
    const t = this.terrain;
    const n = 10;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const v = (j / n - 0.5) * d;
        const q = toWorld(plan, (i / n - 0.5) * w, v);
        const fromRoad = (v + d / 2) / d;
        const sea = t.sea(q.x, q.y);
        const land = buildable(t, q);
        if (fromRoad <= PORT_LAND ? !land : fromRoad >= 1 - PORT_BERTH ? !sea : !land && !sea) {
          return '港口要蓋在海岸線上（靠路的一側在陸地，碼頭伸進海裡）';
        }
      }
    }
    return null;
  }

  /** Where a port's lorries and passengers reach it: the street in front of it. */
  portRoad(f: Facility): RoadPoint | null {
    const { d } = FACILITIES[f.kind];
    const front = toWorld(f, 0, -d / 2);
    const hit = this.net.segmentAt(front, ROAD_WIDTH * 2 + FACILITY_ROAD_GAP + 8, 0);
    if (!hit || !this.net.isStreet(hit.seg)) return null;
    const S = hit.seg.samples;
    const i = Math.max(1, S.findIndex((q) => q.t >= hit.t));
    return { seg: hit.seg.id, s: clamp(S[Math.min(i, S.length - 1)].s, 1, hit.seg.length - 1) };
  }

  /** Cargo ports with the street in front of each and the road network piece it is on, cached until roads or ports change. */
  private cargoPorts(): { f: Facility; at: RoadPoint; piece: number }[] {
    const key = `${this.roadsVersion}:${this.facilitiesVersion}`;
    if (this.portCache?.key === key) return this.portCache.ports;
    const ports: { f: Facility; at: RoadPoint; piece: number }[] = [];
    for (const f of this.facilities.values()) {
      if (f.kind !== 'cargoPort') continue;
      const at = this.portRoad(f);
      const seg = at && this.net.segments.get(at.seg);
      if (at && seg) ports.push({ f, at, piece: this.component.get(seg.a) ?? -1 });
    }
    this.portCache = { key, ports };
    return ports;
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
   * Removes what is at p: a facility first (so a footbridge goes without its road), then the building whose
   * cell holds p (which also unzones it), roads and track you can see, an airport, then tunnels.
   * Returns what was removed so the UI can say so.
   */
  bulldoze(p: Vec2, radius: number): { ok: boolean; refund: number; reason?: string; what?: string } {
    const facility = this.facilityAt(p, 2);
    if (facility) {
      const refund = Math.round(FACILITIES[facility.kind].cost * BULLDOZE_REFUND);
      this.removeFacility(facility.id);
      this.spend(-refund);
      return { ok: true, refund, what: FACILITIES[facility.kind].label };
    }
    const station = this.bulldozeTrainStation(p);
    if (station) return station;
    // A tap inside a building's cell means that building, however wide the road pick is when zoomed out
    const lot = this.buildingAt(p);
    if (lot) {
      const what = `${ZONES[lot.zone as Exclude<Zone, Zone.None>].name}建築`;
      this.clearLot(lot);
      return { ok: true, refund: 0, what };
    }
    const ground = this.net.segmentAt(p, radius, 0);
    if (ground) return this.bulldozeRoad(ground.seg);
    for (const level of [0, ELEVATED_HEIGHT]) {
      for (const k of RAIL_KINDS) {
        const hit = this.rails[k].net.segmentAt(p, radius, level);
        if (hit) return this.bulldozeTrack(k, hit.seg);
      }
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

  /** The grown building (or zoned cell) whose cell holds p. */
  buildingAt(p: Vec2, onlyBuilt = true): Lot | null {
    for (const seg of this.net.segments.values()) {
      if (!seg.lots.length || !bboxNear(seg.bbox, p, roadWidth(seg) / 2 + CELL * DEPTH)) continue;
      for (const lot of seg.lots) {
        if (lot.blocked || lot.zone === Zone.None || (onlyBuilt && !lot.level)) continue;
        const dx = p.x - lot.x;
        const dy = p.y - lot.y;
        if (Math.abs(dx * lot.dir.x + dy * lot.dir.y) <= CELL / 2 && Math.abs(dy * lot.dir.x - dx * lot.dir.y) <= CELL / 2) return lot;
      }
    }
    return null;
  }

  /** Knocks the building down and unzones its cell, so nothing grows back there. */
  private clearLot(lot: Lot): void {
    lot.level = 0;
    lot.zone = Zone.None;
    this.lotsVersion++;
    this.zoningVersion++;
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
    if (seg.highway) return { ok: false, refund: 0, reason: '高速公路和交流道不能拆除' };
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
      const q = { x: center.x + Math.cos(a) * (r + 10), y: center.y + Math.sin(a) * (r + 10) };
      const locked = this.regionProblem(q);
      if (locked) return { ok: false, cost, reason: locked };
      if (!buildable(this.terrain, q)) return { ok: false, cost, reason: '圓環要蓋在平坦的陸地上' };
    }
    for (const seg of this.net.segments.values()) {
      const near = seg.samples.some((p) => dist(p, center) < r + 12);
      if (!near) continue;
      if (seg.oneway) return { ok: false, cost, reason: '離另一個圓環太近' };
      if (!this.net.isStreet(seg)) return { ok: false, cost, reason: '圓環要蓋在平地上，不能壓到高架或隧道' };
    }
    // The ring clears the roads inside it, which would cut the city off from the highway
    for (const id of this.outside) {
      const n = this.net.nodes.get(id);
      if (n && dist(n.p, center) < r + 12) return { ok: false, cost, reason: '離高速公路出入口太近，圓環會把它拆掉' };
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
    if (seg.highway) return { ok: false, cost: 0, reason: '高速公路不能改建' };
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
    const cost = stops.filter((id) => !transit.stops.get(id)?.style).length * transit.mode.stopCost;
    if (stops.length < 2) return { ok: false, cost, reason: '路線至少要兩個站' };
    if (cost > this.money) return { ok: false, cost, reason: `資金不足，需要 ${ntd(cost)}` };
    const plan = transit.plan(stops, true);
    if (!plan.ok) return { ok: false, cost, reason: transit.mode.streetsOnly ? '有些站之間沒有道路相連' : '有些車站之間沒有軌道相連' };
    this.spend(cost);
    transit.addLine(stops);
    return { ok: true, cost };
  }

  paint(center: Vec2, radius: number, zone: Zone, overwrite = false): number {
    const n = paintZone(this.net, center, radius, zone, overwrite, zone === Zone.Forestry ? (l) => this.nearForest(l) : undefined);
    if (n) {
      this.lotsVersion++;
      this.zoningVersion++;
    }
    return n;
  }

  /** Forested hills or mountains (ground over 3 m) within FOREST_REACH of p: where 林業 may go. */
  nearForest(p: Vec2): boolean {
    const t = this.terrain;
    for (let ring = 1; ring <= 3; ring++) {
      const r = (FOREST_REACH * ring) / 3;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + ring * 0.4;
        if (t.height(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r) > 3) return true;
      }
    }
    return false;
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
    this.incomes.clear();
    const homes = emptyHouseholds();
    // Chemical plants, bucketed so each home only looks at the ones around it
    const fumes = new Map<string, Vec2[]>();
    const bucket = (x: number, y: number) => `${Math.floor(x / POLLUTION_REACH)},${Math.floor(y / POLLUTION_REACH)}`;
    for (const seg of this.net.segments.values()) {
      for (const lot of seg.lots) {
        if (lot.blocked || lot.zone !== Zone.Chemical || !lot.level) continue;
        const k = bucket(lot.x, lot.y);
        (fumes.get(k) ?? fumes.set(k, []).get(k)!).push(lot);
      }
    }
    const polluted = (p: Vec2): boolean => {
      if (!fumes.size) return false;
      const gx = Math.floor(p.x / POLLUTION_REACH);
      const gy = Math.floor(p.y / POLLUTION_REACH);
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          for (const q of fumes.get(`${gx + i},${gy + j}`) ?? []) if (dist(p, q) < POLLUTION_REACH) return true;
        }
      }
      return false;
    };
    let smog = 0;
    const ports = this.cargoPorts();
    // Ports per road network, and the goods made on each: industry ships only through ports it can reach
    const portPieces = new Map<number, number>();
    for (const x of ports) portPieces.set(x.piece, (portPieces.get(x.piece) ?? 0) + 1);
    const madeIn = new Map<number, number>();
    let goods = 0;
    let reachable = 0;
    let earned = 0;
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
          // Fumes from a chemical plant nearby cost a service's worth
          const dirty = polluted(lot);
          if (dirty) smog += people;
          const served = Math.max(0, s.kinds.size + s.landmark - (dirty ? 1 : 0));
          this.served.set(lot, served);
          satisfied += people * Math.min(1, served / SERVICE_KINDS.length);
          const income = residentIncome(lot, served, this.level);
          const bracket = bracketOf(income);
          this.incomes.set(lot, income);
          homes.people[bracket.key] += people;
          homes.fuelTaxYear += (people / PEOPLE_PER_HOUSEHOLD) * income * bracket.fuelTax;
          earned += people * income;
        } else {
          jobs[info.demand] += lot.level * info.perLevel;
          if (info.goods) {
            const made = lot.level * info.perLevel * info.goods * GOODS_PER_JOB;
            goods += made;
            const piece = this.component.get(seg.a) ?? -2;
            if (portPieces.has(piece)) {
              reachable += made;
              madeIn.set(piece, (madeIn.get(piece) ?? 0) + made);
            }
          }
        }
      }
    }
    const totalJobs = jobs.C + jobs.O + jobs.I;
    const coverage = { park: 0, school: 0, police: 0, fire: 0, hospital: 0 };
    for (const k of SERVICE_KINDS) coverage[k] = pop ? reach[k] / pop : 0;
    const hall = [...this.facilities.values()].some((f) => f.kind === 'cityHall') ? 8 : 0;
    const happiness = pop ? clamp(Math.round(30 + 65 * (satisfied / pop) + hall), 0, 100) : 50;
    const wants = SERVICE_KINDS.filter((k) => coverage[k] < 0.6).sort((a, b) => coverage[a] - coverage[b]);
    this.needs = { happiness, coverage, wants, tourists: this.needs.tourists, polluted: pop ? smog / pop : 0 };
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
      // A cargo port opens markets abroad for industry
      I: d(45 + gap(pop * 0.3 + 15, jobs.I, 40) - bTax + Math.min(15, ports.length * 6)),
    };
    this.stats = { population: pop, jobs: totalJobs, buildings, disconnected, riders: this.stats.riders };
    homes.averageIncome = pop ? earned / pop : 0;
    let shipped = 0;
    for (const [piece, made] of madeIn) shipped += Math.min(made, portPieces.get(piece)! * PORT_CAPACITY);
    this.trade = { ports: ports.length, goods, reachable, shipped };
    this.households = homes;
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
    // Fabs need educated workers: a science park stays small without a school in reach
    if (lot.zone === Zone.SciencePark) return this.servicesAt(lot).kinds.has('school') ? info.maxLevel : 1;
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
    // Stations opened or closed (lines are edited straight on the transit systems): clear the lots they stand on
    if (this.stationsChanged()) this.landChanged();
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
    let landmarks = 0;
    for (const f of this.facilities.values()) if (isLandmark(f.kind)) landmarks++;
    for (const f of this.facilities.values()) {
      const spec = FACILITIES[f.kind];
      bill += spec.upkeep * HOUR_STEPS;
      // Ferries bring more visitors to a city with sights to see
      const keen = f.kind === 'cruisePort' ? 1 + CRUISE_LANDMARK_BOOST * landmarks : 1;
      if (spec.tourists) tourists += (spec.tourists * keen * (20 + this.stats.population / 1000)) / DAY_STEPS;
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
      fuelTax: this.households.fuelTaxYear / (12 * MONTH_STEPS),
      // Roads, transit and public buildings: an hour's upkeep billed once every two weeks,
      // spread over the two weeks for the monthly budget
      roadUpkeep: (roadLength * ROAD_UPKEEP * HOUR_STEPS) / (UPKEEP_DAYS * DAY_STEPS),
      transitUpkeep: (upkeep * HOUR_STEPS) / (UPKEEP_DAYS * DAY_STEPS),
      airUpkeep: air.airports.size * AIRPORT_UPKEEP + air.flights.size * FLIGHT_UPKEEP,
      servicesUpkeep: bill / (UPKEEP_DAYS * DAY_STEPS),
      tourism: tourists * TOURIST_SPEND,
      trade: (this.trade.shipped * TRADE_SHARE) / MONTH_STEPS,
    };
    const perMonth = (v: number) => v * MONTH_STEPS;
    // Construction averages over about three days so one big build doesn't swing the month
    const ease = 1 / (3 * DAY_STEPS);
    this.budget = {
      residentialTax: perMonth(step.residentialTax),
      businessTax: perMonth(step.businessTax),
      fuelTax: perMonth(step.fuelTax),
      subsidy: perMonth(step.subsidy),
      // Fares come in bursts as vehicles reach stops and planes leave; show running averages
      transitFares: this.budget.transitFares * 0.9 + perMonth(fares) * 0.1,
      airIncome: this.budget.airIncome * 0.97 + perMonth(air.incomeToday) * 0.03,
      tourism: perMonth(step.tourism),
      trade: perMonth(step.trade),
      roadUpkeep: perMonth(step.roadUpkeep),
      transitUpkeep: perMonth(step.transitUpkeep),
      airUpkeep: perMonth(step.airUpkeep),
      servicesUpkeep: perMonth(step.servicesUpkeep),
      admin: perMonth(step.admin),
      construction: this.budget.construction * (1 - ease) + perMonth(this.spentThisStep) * ease,
    };
    this.spentThisStep = 0;
    this.money +=
      step.residentialTax + step.businessTax + step.fuelTax + step.subsidy + fares + air.incomeToday + step.tourism + step.trade -
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
      if (isIndustry(p.lot.zone)) industry.push(p);
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
      // What they can afford: a bicycle keeps off the road, a scooter or a car joins the traffic
      const commute = bracketOf(this.incomes.get(home.lot) ?? 0).commute;
      if (commute === 'bike') continue;
      const to = job ? at(job) : gate;
      if (to) this.traffic.spawn(at(home), to, commute, rng());
    }
    if (gate && industry.length && rng() < Math.min(0.9, this.stats.jobs / 300)) {
      this.traffic.spawn(gate, at(pick(industry)), 'truck', rng());
    }
    // Freight: lorries take goods from industry down to a cargo port on the same roads
    const ports = this.cargoPorts();
    if (ports.length && industry.length && rng() < Math.min(0.9, this.trade.shipped / 2e7)) {
      const from = pick(industry);
      const piece = this.component.get(from.seg.a);
      const port = ports.find((x) => x.piece === piece);
      if (port) this.traffic.spawn(at(from), port.at, 'truck', rng());
    }
    // Each police station keeps two patrol cars out on the streets, setting off from the blocks near it
    const stations = [...this.facilities.values()].filter((f) => f.kind === 'police');
    const placed = homes.concat(work);
    // Taxis that pulled out of an airport rank head off into town
    for (; this.aviation.taxisDue > 0; this.aviation.taxisDue--) {
      if (!placed.length) continue;
      for (const a of this.aviation.airports.values()) {
        const from = this.airportExit(a);
        if (from && this.traffic.vehicles.length < this.maxVehicles) this.traffic.spawn(from, at(pick(placed)), 'car', taxiTint(rng()));
      }
    }
    if (stations.length && placed.length && rng() < 0.3) {
      const out = this.traffic.vehicles.filter((v) => v.kind === 'police').length;
      if (out < stations.length * PATROLS_PER_STATION) {
        const f = pick(stations);
        let from = pick(placed);
        for (let k = 0; k < 24; k++) {
          const c = pick(placed);
          if (Math.hypot(c.lot.x - f.p.x, c.lot.y - f.p.y) < Math.hypot(from.lot.x - f.p.x, from.lot.y - f.p.y)) from = c;
        }
        this.traffic.spawn(at(from), at(pick(placed)), 'police', rng());
      }
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
      regions: [...this.regions],
    };
  }

  static deserialize(data: SaveData): City {
    if (data.v < 1 || data.v > SAVE_VERSION) throw new Error(`unsupported save version ${data.v}`);
    const terrain = TERRAINS[legacyTerrain(data) ?? data.terrain ?? 'flat'] ?? FLAT;
    // Cities on the all-flat 平地 map move onto its mountains, river and coast, unless something they built would end up on them
    // (checked on the flat load: loading onto the new ground would already have cleared buildings standing in its water)
    const city = City.load(data, terrain);
    return terrain === FLAT && city.fitsTerrain(PLAIN) ? City.load(data, PLAIN) : city;
  }

  /** Whether everything built would stand where that land allows it: roads and tracks, grown buildings, facilities and airports. */
  private fitsTerrain(terrain: Terrain): boolean {
    for (const net of [this.net, ...RAIL_KINDS.map((k) => this.rails[k].net)]) {
      for (const seg of net.segments.values()) {
        const a = net.node(seg.a);
        const b = net.node(seg.b);
        if (this.terrainProblem(a.p, seg.c, b.p, a.h, b.h, terrain)) return false;
        if (seg.lots.some((l) => l.level > 0 && !buildable(terrain, l))) return false;
      }
    }
    for (const f of this.facilities.values()) if (footprintGrid(f).some((q) => !buildable(terrain, q))) return false;
    for (const a of this.aviation.airports.values()) {
      const land = Aviation.corners(a);
      for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
        if (!buildable(terrain, lerp(lerp(land[0], land[1], i / 8), lerp(land[3], land[2], i / 8), j / 8))) return false;
      }
    }
    return true;
  }

  private static load(data: SaveData, terrain: Terrain): City {
    const city = new City(terrain);
    city.money = data.money;
    city.steps = Math.round(data.day * DAY_STEPS);
    if (data.name) city.name = data.name;
    city.level = Math.min(LEVELS.length - 1, data.level ?? 0);
    const regions = (data.regions ?? []).filter((r) => city.terrain.regions.includes(r));
    if (regions.length) city.regions = new Set(regions);
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
    // Saves from before regions: open every region they already built in, so nothing they had gets locked
    if (!data.regions) {
      const points = [
        ...[...city.net.nodes.values()].map((n) => n.p),
        ...RAIL_KINDS.flatMap((k) => [...city.rails[k].net.nodes.values()].map((n) => n.p)),
        ...[...city.facilities.values()].map((f) => f.p),
        ...[...city.aviation.airports.values()].map((a) => a.p),
      ];
      for (const p of points) {
        const r = city.terrain.region(p.x, p.y);
        if (r) city.regions.add(r);
      }
    }
    // Airports from before access roads: lay theirs to the nearest street, free; ones from v3.0.2 widen to two lanes each way
    for (const a of city.aviation.airports.values()) {
      const start = Aviation.toWorld(a, { x: 0, y: ACCESS_Y });
      if (city.net.segmentAt(start, 3, 0)) city.widenAccess(start);
      else {
        const access = city.airportAccess(a);
        if (access) city.layAccess(access);
      }
    }
    city.restoreGate();
    city.roadsChanged();
    city.measure();
    return city;
  }
}

/**
 * Saves from before regions that built across the Gaoping River or past the map's edge: they keep the
 * ground they were built on, as the new Pingtung's rivers and coast or the edge would take some of it.
 */
function legacyTerrain(data: SaveData): TerrainName | null {
  if (data.regions) return null;
  const terrain = data.terrain ?? 'flat';
  if (terrain !== 'flat' && terrain !== 'kaohsiung') return null;
  const now = TERRAINS[terrain];
  const points: [number, number][] = [
    ...data.nodes.map(([, x, y]) => [x, y] as [number, number]),
    ...RAIL_KINDS.flatMap((k) => (data.rails?.[k]?.nodes ?? []).map(([, x, y]) => [x, y] as [number, number])),
    ...(data.facilities ?? []).map(([, , x, y]) => [x, y] as [number, number]),
    ...(data.airports ?? []).map(([, x, y]) => [x, y] as [number, number]),
  ];
  // Anything now in Pingtung (new ground across the river) or off the map (past the new edge)
  const changed = (x: number, y: number) => now.region(x, y) !== 'kaohsiung';
  return points.some(([x, y]) => changed(x, y)) ? (`${terrain}-classic` as TerrainName) : null;
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
    styles: [...net.segments.values()].filter((s) => s.lanes || s.walk || s.highway)
      .map((s) => (s.highway ? [s.id, s.lanes ?? 1, s.walk ? 1 : 0, 1] : [s.id, s.lanes ?? 1, s.walk ? 1 : 0])),
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
  const styles = new Map((data.styles ?? []).map(([id, lanes, walk, highway]) => [id, { lanes: lanes as LaneCount, walk: walk === 1, highway: highway === 1 }]));
  for (const [id, a, b, cx, cy, zoning, oneway] of data.segs) {
    const seg = net.createSegment(a, b, { x: cx, y: cy }, undefined, id, oneway === 1);
    const style = styles.get(id);
    if (style?.highway) seg.highway = true;
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
    stops: [...t.stops.values()].map((s) => (s.style ? [s.id, round2(s.p.x), round2(s.p.y), s.style, s.face ?? 1] : [s.id, round2(s.p.x), round2(s.p.y)])),
    lines: [...t.lines.values()].map((l) => [l.id, l.color, [...l.stops], l.name]),
    fare: t.fare,
  };
}

function loadTransit(t: Transit, data: TransitSave): void {
  for (const [id, x, y, style, face] of data.stops ?? []) {
    const stop = t.addStop(id, { x, y });
    if (style) {
      stop.style = style;
      stop.face = face;
    }
  }
  for (const [id, color, stops, name] of data.lines ?? []) t.addLine(stops, id, color, name);
  if (data.fare !== undefined) t.fare = data.fare;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

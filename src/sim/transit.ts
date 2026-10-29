import type { RegionName } from './terrain';
import { type Vec2, bboxNear, clamp, closestOnSamples, dist, lengthAt, quadPoint, tAtLength } from './geometry';
import type { RoadNetwork, RoadSegment } from './roads';
import type { Dir, RoadPoint, Traffic, Vehicle, VehicleKind } from './traffic';

export type TransitKind = 'bus' | 'metro' | 'train' | 'hsr';

/** What sets one kind of public transport apart: vehicles, prices, and where stops may go. */
export interface TransitMode {
  kind: TransitKind & VehicleKind;
  /** shown in the UI, e.g. 捷運 */
  label: string;
  /** what a stop is called: 站牌 or 車站 */
  stopLabel: string;
  capacity: number;
  /** default ticket price per boarding, and the most a player can charge */
  fare: number;
  maxFare: number;
  /** running cost per vehicle per day */
  upkeep: number;
  /** building cost per stop or station */
  stopCost: number;
  /** how far people will walk to and from a stop */
  walk: number;
  /** one vehicle per this many meters of route, up to maxVehicles */
  metersPerVehicle: number;
  maxVehicles: number;
  /** seconds at a stop before boarding time is added */
  dwell: number;
  /** stops keep this far from the ends of their segment (platform length) */
  margin: number;
  /** stops only on two-way ground streets (buses) */
  streetsOnly: boolean;
  /** vehicles can change direction at a stop (trains drive from either end) */
  reverses: boolean;
  /** share of commuters with a usable line who ride at a free fare, and how much each dollar costs */
  shareAtFree: number;
  sharePerDollar: number;
  /** how attractive the mode is against the others, in meters of walking it is worth */
  appeal: number;
}

export const BUS: TransitMode = {
  kind: 'bus',
  label: '公車',
  stopLabel: '站',
  capacity: 30,
  fare: 1,
  maxFare: 5,
  upkeep: 3,
  stopCost: 300,
  walk: 180,
  metersPerVehicle: 500,
  maxVehicles: 8,
  dwell: 3,
  margin: 6,
  streetsOnly: true,
  reverses: false,
  shareAtFree: 0.75,
  sharePerDollar: 0.12,
  appeal: 0,
};

export const METRO: TransitMode = {
  kind: 'metro',
  label: '捷運',
  stopLabel: '站',
  capacity: 240,
  fare: 2,
  maxFare: 10,
  upkeep: 25,
  stopCost: 4000,
  walk: 320,
  metersPerVehicle: 1200,
  maxVehicles: 6,
  dwell: 10,
  margin: 22,
  streetsOnly: false,
  reverses: true,
  shareAtFree: 0.85,
  sharePerDollar: 0.05,
  appeal: 150,
};

export const TRAIN: TransitMode = {
  kind: 'train',
  label: '火車',
  stopLabel: '站',
  capacity: 320,
  fare: 3,
  maxFare: 15,
  upkeep: 30,
  stopCost: 3500,
  walk: 400,
  metersPerVehicle: 1800,
  maxVehicles: 5,
  dwell: 14,
  margin: 42,
  streetsOnly: false,
  reverses: true,
  shareAtFree: 0.8,
  sharePerDollar: 0.035,
  appeal: 100,
};

export const HSR: TransitMode = {
  kind: 'hsr',
  label: '高鐵',
  stopLabel: '站',
  capacity: 400,
  fare: 8,
  maxFare: 40,
  upkeep: 60,
  stopCost: 8000,
  walk: 500,
  metersPerVehicle: 3000,
  maxVehicles: 4,
  dwell: 16,
  margin: 62,
  streetsOnly: false,
  reverses: true,
  shareAtFree: 0.7,
  sharePerDollar: 0.012,
  appeal: 80,
};

export const MODES: Record<TransitKind, TransitMode> = { bus: BUS, metro: METRO, train: TRAIN, hsr: HSR };

const STOP_REACH = 10;
const WAITING_CAP = 150;

/** A trip's best line: board at stop `a` and get off at stop `b`, walking `walk` meters in all. */
export interface TransitOption {
  line: number;
  a: BusStop;
  b: number;
  walk: number;
}

export const LINE_COLORS = [0xe4572e, 0x2e86ab, 0x6a994e, 0xa23b72, 0xf2b134, 0x3d5a80, 0xd62828, 0x2a9d8f];

export interface BusStop {
  id: number;
  p: Vec2;
  /** where buses stop on the road; null while no street is in reach */
  at: RoadPoint | null;
  /** riders waiting, by line and then by the stop they are going to */
  waiting: Map<number, Map<number, number>>;
  /**
   * A train station built on its own, before any line: 'standard', or a region's own station in the style of its
   * real one. It stays when no line uses it. Stops made by tapping track while drawing a line have none.
   */
  style?: StationStyle;
  /** which side of the track its building stands on, when built on its own */
  face?: 1 | -1;
}

export type StationStyle = 'standard' | RegionName;

/** A piece of a line's route: one lane, from and to travel distances along it. */
export interface PathPiece {
  seg: number;
  dir: Dir;
  from: number;
  to: number;
}

export interface BusLine {
  id: number;
  /** shown in the dock and on the line panel; players can rename lines */
  name: string;
  color: number;
  /** stop ids in order; buses run the loop and come back to the first one */
  stops: number[];
  path: PathPiece[];
  length: number;
  /** false when some stops are no longer connected by road */
  ok: boolean;
  riders: number;
}

/** Stops, lines, and the riders that use them, for one kind of transport. The vehicles drive in Traffic. */
export class Transit {
  stops = new Map<number, BusStop>();
  lines = new Map<number, BusLine>();
  nextStop = 1;
  nextLine = 1;
  /** bumped whenever stops, lines or their routes change, so the renderer can rebuild */
  version = 0;
  faresToday = 0;
  ridersToday = 0;
  /** ticket price per boarding */
  fare: number;

  constructor(
    readonly net: RoadNetwork,
    readonly traffic: Traffic,
    readonly mode: TransitMode = BUS,
  ) {
    this.fare = mode.fare;
    traffic.lineHooks = { arrive: (v) => this.arrive(v), depart: (v) => this.depart(v) };
  }

  /** Segments a stop may sit on: streets for buses; any level stretch of track for trains. */
  private canStop(seg: RoadSegment): boolean {
    if (this.mode.streetsOnly) return this.net.isStreet(seg);
    return this.net.node(seg.a).h === this.net.node(seg.b).h;
  }

  /** Default name of a new line. */
  defaultName(id: number): string {
    return this.mode.kind === 'bus' ? `${id} 號線` : `${this.mode.label} ${id} 號線`;
  }

  /** The point a stop at p would use: the nearest road or track it may sit on, away from junctions. */
  locate(p: Vec2, reach = STOP_REACH): { at: RoadPoint; p: Vec2 } | null {
    let best: { seg: number; t: number; d: number } | null = null;
    for (const seg of this.net.segments.values()) {
      if (!this.canStop(seg) || !bboxNear(seg.bbox, p, reach)) continue;
      const r = closestOnSamples(seg.samples, p);
      if (r.d < reach && (!best || r.d < best.d)) best = { seg: seg.id, t: r.t, d: r.d };
    }
    if (!best) return null;
    const seg = this.net.segments.get(best.seg)!;
    const margin = Math.min(this.mode.margin, seg.length / 2);
    const s = clamp(lengthAt(seg.samples, best.t), margin, seg.length - margin);
    return { at: { seg: seg.id, s }, p: quadPoint(this.net.quad(seg), tAtLength(seg.samples, s)) };
  }

  stopNear(p: Vec2, radius: number): BusStop | null {
    let best: BusStop | null = null;
    let bd = radius;
    for (const s of this.stops.values()) {
      const d = dist(s.p, p);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** An existing stop near p, or a new one on the nearest street. Null when there is no street. */
  stopAt(p: Vec2, radius: number): BusStop | null {
    const near = this.stopNear(p, radius);
    if (near) return near;
    const spot = this.locate(p, Math.max(radius, STOP_REACH));
    if (!spot) return null;
    const stop: BusStop = { id: this.nextStop++, p: spot.p, at: spot.at, waiting: new Map() };
    this.stops.set(stop.id, stop);
    this.version++;
    return stop;
  }

  addStop(id: number, p: Vec2): BusStop {
    const stop: BusStop = { id, p: { ...p }, at: this.locate(p)?.at ?? null, waiting: new Map() };
    this.stops.set(id, stop);
    this.nextStop = Math.max(this.nextStop, id + 1);
    return stop;
  }

  /** Drops stops that no line uses (e.g. left over from a cancelled line). */
  pruneStops(): void {
    const used = new Set<number>();
    for (const l of this.lines.values()) for (const s of l.stops) used.add(s);
    for (const [id, stop] of [...this.stops]) if (!used.has(id) && !stop.style) this.stops.delete(id);
    this.version++;
  }

  addLine(stops: number[], id?: number, color?: number, name?: string): BusLine {
    const lineId = id ?? this.nextLine++;
    this.nextLine = Math.max(this.nextLine, lineId + 1);
    const line: BusLine = {
      id: lineId,
      name: name ?? this.defaultName(lineId),
      color: color ?? LINE_COLORS[(lineId - 1) % LINE_COLORS.length],
      stops: [...stops],
      path: [],
      length: 0,
      ok: false,
      riders: 0,
    };
    this.lines.set(line.id, line);
    this.route(line);
    this.version++;
    return line;
  }

  /** Share of commuters with a usable line who take it at the current fare. */
  share(): number {
    return clamp(this.mode.shareAtFree - this.mode.sharePerDollar * this.fare, 0.1, 0.9);
  }

  /** Renames or recolours a line (blank names fall back to the default). */
  editLine(id: number, change: { name?: string; color?: number }): void {
    const line = this.lines.get(id);
    if (!line) return;
    if (change.name !== undefined) line.name = change.name.trim().slice(0, 20) || this.defaultName(line.id);
    if (change.color !== undefined) line.color = change.color;
    this.version++;
  }

  /** The line whose route or stops pass nearest to p, within r. */
  lineAt(p: Vec2, r: number): BusLine | null {
    return this.linesAt(p, r)[0] ?? null;
  }

  /** Every line whose route or stops pass within r of p, nearest first. */
  linesAt(p: Vec2, r: number): BusLine[] {
    const near: { line: BusLine; d: number }[] = [];
    for (const line of this.lines.values()) {
      let best = r;
      for (const id of line.stops) {
        const s = this.stops.get(id);
        if (s) best = Math.min(best, dist(s.p, p));
      }
      for (const piece of line.path) {
        const seg = this.net.segments.get(piece.seg);
        if (!seg || !bboxNear(seg.bbox, p, best)) continue;
        const lo = Math.min(piece.from, piece.to);
        const hi = Math.max(piece.from, piece.to);
        for (const q of seg.samples) {
          const along = piece.dir === 1 ? q.s : seg.length - q.s;
          if (along < lo - 4 || along > hi + 4) continue;
          best = Math.min(best, dist(q, p));
        }
      }
      if (best < r) near.push({ line, d: best });
    }
    return near.sort((a, b) => a.d - b.d).map((n) => n.line);
  }

  removeLine(id: number): void {
    this.lines.delete(id);
    this.traffic.vehicles = this.traffic.vehicles.filter((v) => v.line !== id);
    for (const s of this.stops.values()) s.waiting.delete(id);
    this.pruneStops();
  }

  /** Closes every line and takes their buses off the road. */
  clearLines(): void {
    for (const id of [...this.lines.keys()]) this.removeLine(id);
  }

  /**
   * Route of a list of stops, leg by leg. Buses leave each stop in the direction they arrived; trains may reverse.
   * `loop` adds the leg from the last stop back to the first.
   */
  plan(stopIds: number[], loop: boolean): { path: PathPiece[]; length: number; ok: boolean } {
    const path: PathPiece[] = [];
    let length = 0;
    let ok = stopIds.length >= 2;
    let dir: Dir | undefined;
    const legs = loop ? stopIds.length : stopIds.length - 1;
    for (let i = 0; i < legs; i++) {
      const a = this.stops.get(stopIds[i])?.at;
      const b = this.stops.get(stopIds[(i + 1) % stopIds.length])?.at;
      const r = a && b ? this.traffic.findRoute(a, b, dir) : null;
      if (!r) {
        ok = false;
        dir = undefined;
        continue;
      }
      const lanes = [r.first, ...r.route];
      lanes.forEach((l, k) => {
        const len = this.net.segments.get(l.seg)!.length;
        const from = k === 0 ? r.startPos : 0;
        const to = k === lanes.length - 1 ? r.dest : len;
        path.push({ seg: l.seg, dir: l.dir, from, to });
        length += Math.max(0, to - from);
      });
      dir = this.mode.reverses ? undefined : lanes[lanes.length - 1].dir;
    }
    return { path, length, ok };
  }

  private route(line: BusLine): void {
    Object.assign(line, this.plan(line.stops, true));
  }

  /** After roads change: move stops onto the new road pieces, drop stops that lost their street, re-route lines. */
  onNetworkChanged(): void {
    for (const stop of [...this.stops.values()]) {
      const spot = this.locate(stop.p);
      if (spot) stop.at = spot.at;
      else this.stops.delete(stop.id);
    }
    for (const line of [...this.lines.values()]) {
      line.stops = line.stops.filter((id, i, a) => this.stops.has(id) && id !== a[(i + 1) % a.length]);
      if (line.stops.length < 2) this.removeLine(line.id);
      else this.route(line);
    }
    this.version++;
  }

  /** Vehicles running on a line, or on every line of this mode. */
  buses(lineId?: number): Vehicle[] {
    return this.traffic.vehicles.filter((v) => v.kind === this.mode.kind && v.line !== undefined && (lineId === undefined || v.line === lineId));
  }

  /** Vehicles a line runs: one per so many meters of route. */
  fleetSize(line: BusLine): number {
    return line.ok ? clamp(Math.ceil(line.length / this.mode.metersPerVehicle), 1, this.mode.maxVehicles) : 0;
  }

  /** Puts at most one missing bus per line on the road, spread out along the loop. */
  maintain(): void {
    for (const line of this.lines.values()) {
      const have = this.buses(line.id).length;
      const want = this.fleetSize(line);
      if (have >= want) continue;
      const n = line.stops.length;
      const first = Math.floor((have * n) / want);
      // Start at the stop that spreads the fleet best; if a car is in the way there, try the next
      for (let k = 0; k < n; k++) {
        const i = (first + k) % n;
        const a = this.stops.get(line.stops[i])?.at;
        const b = this.stops.get(line.stops[(i + 1) % n])?.at;
        const v = a && b ? this.traffic.spawn(a, b, this.mode.kind, 0) : null;
        if (!v) continue;
        v.line = line.id;
        v.next = (i + 1) % n;
        v.load = new Map();
        break;
      }
    }
  }

  /** The line with stops in walking distance of both ends of a trip, walking the least; null if none. */
  option(from: Vec2, to: Vec2): TransitOption | null {
    let best: TransitOption | null = null;
    const walk = this.mode.walk;
    for (const line of this.lines.values()) {
      if (!line.ok) continue;
      let a: BusStop | null = null;
      let da = walk;
      let b: BusStop | null = null;
      let db = walk;
      for (const id of line.stops) {
        const s = this.stops.get(id)!;
        const d1 = dist(s.p, from);
        const d2 = dist(s.p, to);
        if (d1 < da) {
          da = d1;
          a = s;
        }
        if (d2 < db) {
          db = d2;
          b = s;
        }
      }
      if (a && b && a !== b && (!best || da + db < best.walk)) best = { line: line.id, a, b: b.id, walk: da + db };
    }
    return best;
  }

  /** Puts a rider in the queue at a stop. False when the stop is too crowded to wait at. */
  enqueue(o: TransitOption, riders = 1): boolean {
    let byLine = o.a.waiting.get(o.line);
    if (!byLine) o.a.waiting.set(o.line, (byLine = new Map()));
    let total = 0;
    for (const n of byLine.values()) total += n;
    // A crowded stop sends people back to their cars
    if (total >= WAITING_CAP * (this.mode.capacity / BUS.capacity) ** 0.5) return false;
    byLine.set(o.b, (byLine.get(o.b) ?? 0) + riders);
    return true;
  }

  /** A commuter takes this mode when one line has stops within walking distance of both ends. */
  board(from: Vec2, to: Vec2): boolean {
    const o = this.option(from, to);
    return !!o && this.enqueue(o);
  }

  /** Travellers from out of town, between two random stations of a random line. */
  visitors(count: number, rng: () => number): void {
    const lines = [...this.lines.values()].filter((l) => l.ok && l.stops.length >= 2);
    for (let i = 0; i < count && lines.length; i++) {
      const line = lines[Math.floor(rng() * lines.length) % lines.length];
      const n = line.stops.length;
      const from = Math.floor(rng() * n) % n;
      const to = (from + 1 + (Math.floor(rng() * (n - 1)) % (n - 1))) % n;
      const a = this.stops.get(line.stops[from]);
      if (a) this.enqueue({ line: line.id, a, b: line.stops[to], walk: 0 });
    }
  }

  waitingAt(stop: BusStop): number {
    let n = 0;
    for (const m of stop.waiting.values()) for (const c of m.values()) n += c;
    return n;
  }

  /** Riders get off and on; the bus then heads for the following stop. */
  private arrive(v: Vehicle): number {
    const line = v.line !== undefined ? this.lines.get(v.line) : undefined;
    const dwell = this.mode.dwell;
    if (!line || v.next === undefined || !v.load) return dwell;
    const stopId = line.stops[v.next % line.stops.length];
    const stop = this.stops.get(stopId);
    const off = v.load.get(stopId) ?? 0;
    v.load.delete(stopId);
    let onBoard = 0;
    for (const n of v.load.values()) onBoard += n;
    let on = 0;
    const queue = stop?.waiting.get(line.id);
    if (queue) {
      for (const [dest, n] of queue) {
        const take = Math.min(n, this.mode.capacity - onBoard - on);
        if (take <= 0) break;
        on += take;
        v.load.set(dest, (v.load.get(dest) ?? 0) + take);
        if (take === n) queue.delete(dest);
        else queue.set(dest, n - take);
      }
    }
    this.faresToday += on * this.fare;
    this.ridersToday += on;
    line.riders += on;
    v.next = (v.next + 1) % line.stops.length;
    return Math.min(dwell * 2.5, dwell + (on + off) * 0.05);
  }

  private depart(v: Vehicle): boolean {
    const line = v.line !== undefined ? this.lines.get(v.line) : undefined;
    if (!line?.ok || v.next === undefined) return false;
    const at = this.stops.get(line.stops[v.next % line.stops.length])?.at;
    return !!at && this.traffic.retarget(v, at);
  }
}

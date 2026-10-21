import { type Vec2, bboxNear, clamp, closestOnSamples, dist, lengthAt, quadPoint, tAtLength } from './geometry';
import type { RoadNetwork } from './roads';
import type { Dir, RoadPoint, Traffic, Vehicle } from './traffic';

export const BUS_CAPACITY = 30;
/** Ticket price per boarding. */
export const BUS_FARE = 1;
/** Running cost per bus per day. */
export const BUS_UPKEEP = 3;
/** Building cost per stop on a new line. */
export const STOP_COST = 300;
/** How far people will walk to and from a stop. */
export const WALK_RADIUS = 180;
/** Share of commuters with a usable bus line who take it instead of driving. */
export const BUS_SHARE = 0.6;
const STOP_DWELL = 3;
const STOP_REACH = 10;
const METERS_PER_BUS = 500;
const MAX_BUSES_PER_LINE = 8;
const WAITING_CAP = 150;

export const LINE_COLORS = [0xe4572e, 0x2e86ab, 0x6a994e, 0xa23b72, 0xf2b134, 0x3d5a80, 0xd62828, 0x2a9d8f];

export interface BusStop {
  id: number;
  p: Vec2;
  /** where buses stop on the road; null while no street is in reach */
  at: RoadPoint | null;
  /** riders waiting, by line and then by the stop they are going to */
  waiting: Map<number, Map<number, number>>;
}

/** A piece of a line's route: one lane, from and to travel distances along it. */
export interface PathPiece {
  seg: number;
  dir: Dir;
  from: number;
  to: number;
}

export interface BusLine {
  id: number;
  color: number;
  /** stop ids in order; buses run the loop and come back to the first one */
  stops: number[];
  path: PathPiece[];
  length: number;
  /** false when some stops are no longer connected by road */
  ok: boolean;
  riders: number;
}

/** Bus stops, lines, and the riders that use them. Buses themselves drive in Traffic. */
export class Transit {
  stops = new Map<number, BusStop>();
  lines = new Map<number, BusLine>();
  nextStop = 1;
  nextLine = 1;
  /** bumped whenever stops, lines or their routes change, so the renderer can rebuild */
  version = 0;
  faresToday = 0;
  ridersToday = 0;

  constructor(
    private net: RoadNetwork,
    private traffic: Traffic,
  ) {
    traffic.busHooks = { arrive: (v) => this.arrive(v), depart: (v) => this.depart(v) };
  }

  /** The street point a stop at p would use: the nearest road at ground level, away from junctions. */
  locate(p: Vec2, reach = STOP_REACH): { at: RoadPoint; p: Vec2 } | null {
    let best: { seg: number; t: number; d: number } | null = null;
    for (const seg of this.net.segments.values()) {
      if (!this.net.isStreet(seg) || !bboxNear(seg.bbox, p, reach)) continue;
      const r = closestOnSamples(seg.samples, p);
      if (r.d < reach && (!best || r.d < best.d)) best = { seg: seg.id, t: r.t, d: r.d };
    }
    if (!best) return null;
    const seg = this.net.segments.get(best.seg)!;
    const margin = Math.min(6, seg.length / 2);
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
    for (const id of [...this.stops.keys()]) if (!used.has(id)) this.stops.delete(id);
    this.version++;
  }

  addLine(stops: number[], id?: number, color?: number): BusLine {
    const lineId = id ?? this.nextLine++;
    this.nextLine = Math.max(this.nextLine, lineId + 1);
    const line: BusLine = {
      id: lineId,
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
   * Route of a list of stops, leg by leg, each leg leaving in the direction the last one arrived.
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
      dir = lanes[lanes.length - 1].dir;
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

  buses(lineId?: number): Vehicle[] {
    return this.traffic.vehicles.filter((v) => v.kind === 'bus' && (lineId === undefined || v.line === lineId));
  }

  /** Buses a line runs: one per 500 m of route. */
  fleetSize(line: BusLine): number {
    return line.ok ? clamp(Math.ceil(line.length / METERS_PER_BUS), 1, MAX_BUSES_PER_LINE) : 0;
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
        const v = a && b ? this.traffic.spawn(a, b, 'bus', 0) : null;
        if (!v) continue;
        v.line = line.id;
        v.next = (i + 1) % n;
        v.load = new Map();
        break;
      }
    }
  }

  /**
   * A commuter from `from` to `to` takes the bus when one line has stops within walking
   * distance of both ends. Returns true when they joined the queue at a stop.
   */
  board(from: Vec2, to: Vec2): boolean {
    let best: { line: number; a: BusStop; b: number; walk: number } | null = null;
    for (const line of this.lines.values()) {
      if (!line.ok) continue;
      let a: BusStop | null = null;
      let da = WALK_RADIUS;
      let b: BusStop | null = null;
      let db = WALK_RADIUS;
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
    if (!best) return false;
    let byLine = best.a.waiting.get(best.line);
    if (!byLine) best.a.waiting.set(best.line, (byLine = new Map()));
    let total = 0;
    for (const n of byLine.values()) total += n;
    // A crowded stop sends people back to their cars
    if (total >= WAITING_CAP) return false;
    byLine.set(best.b, (byLine.get(best.b) ?? 0) + 1);
    return true;
  }

  waitingAt(stop: BusStop): number {
    let n = 0;
    for (const m of stop.waiting.values()) for (const c of m.values()) n += c;
    return n;
  }

  /** Riders get off and on; the bus then heads for the following stop. */
  private arrive(v: Vehicle): number {
    const line = v.line !== undefined ? this.lines.get(v.line) : undefined;
    if (!line || v.next === undefined || !v.load) return STOP_DWELL;
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
        const take = Math.min(n, BUS_CAPACITY - onBoard - on);
        if (take <= 0) break;
        on += take;
        v.load.set(dest, (v.load.get(dest) ?? 0) + take);
        if (take === n) queue.delete(dest);
        else queue.set(dest, n - take);
      }
    }
    this.faresToday += on * BUS_FARE;
    this.ridersToday += on;
    line.riders += on;
    v.next = (v.next + 1) % line.stops.length;
    return Math.min(8, STOP_DWELL + (on + off) * 0.05);
  }

  private depart(v: Vehicle): boolean {
    const line = v.line !== undefined ? this.lines.get(v.line) : undefined;
    if (!line?.ok || v.next === undefined) return false;
    const at = this.stops.get(line.stops[v.next % line.stops.length])?.at;
    return !!at && this.traffic.retarget(v, at);
  }
}

import { type Vec2, dist } from './geometry';
import { LANE_WIDTH, type RoadNetwork, type RoadSegment } from './roads';
import { type Junction, type Light, STOP_BACK, findJunctions, lightAt } from './signals';

/** 50 km/h town roads. */
export const SPEED_LIMIT = 13.9;
/** Lane centre offset from the road centre line (right-hand traffic). */
export const LANE_OFFSET = 1.75;

const ACCEL = 2.0;
const BRAKE = 3.0;
const HEADWAY = 1.2;
const MIN_GAP = 2.0;
/** Seconds a vehicle may sit still before it gives up (keeps gridlocked loops from freezing forever). */
export const GIVE_UP_AFTER = 40;
/** The player's car accelerates this much harder than traffic. */
const PLAYER_PUNCH = 1.8;
/** Patrol ignores the rules: it may drive this much faster than the speed limit. */
const PLAYER_TOP = 1.6;
/** Lanes per second a vehicle drifts across while changing lanes. */
const LANE_CHANGE_RATE = 0.7;
/** Vehicles don't start a lane change this close to the junction ahead. */
const NO_CHANGE_NEAR = 12;
/**
 * Vehicles keep to the lane they cruise in until this close to the junction where they turn, then move over to
 * the lane for the turn: so on a long road the turning traffic doesn't fill one lane from end to end.
 */
const TURN_LANE_REACH = 90;

export type Dir = 1 | -1;
export type VehicleKind = 'car' | 'police' | 'scooter' | 'truck' | 'bus' | 'metro' | 'train' | 'hsr';

/** One travel direction of one segment. */
export interface LaneRef {
  seg: number;
  dir: Dir;
}

export const laneKey = (seg: number, dir: Dir): number => seg * 2 + (dir === 1 ? 0 : 1);

/** Trains are drawn as a row of cars of this length. */
export const TRAIN_CARS: Partial<Record<VehicleKind, { cars: number; length: number }>> = {
  metro: { cars: 3, length: 14 },
  train: { cars: 4, length: 20 },
  hsr: { cars: 6, length: 20 },
};

/** Cars whose tint falls here are yellow taxis. */
export const isTaxi = (v: { kind: VehicleKind; tint: number }): boolean => v.kind === 'car' && (v.tint * 13) % 1 < 0.1;
/** A tint that makes a car a taxi, from r in 0..1. */
export const taxiTint = (r: number): number => (Math.floor(r * 13) + 0.05) / 13;

export const VEHICLE_LENGTH: Record<VehicleKind, number> = { car: 4.5, police: 4.5, scooter: 2, truck: 8, bus: 12, metro: 42, train: 80, hsr: 120 };

/** How vehicles drive on one network: roads, or the tracks of one kind of train. */
export interface DrivingRules {
  /** top speed, m/s */
  speed: number;
  accel: number;
  brake: number;
  /** lane (or track) centre offset from the centre line */
  laneOffset: number;
  /** vehicles on a line may turn back at a stop instead of driving on */
  reverses: boolean;
  /** traffic lights at every junction */
  signals?: boolean;
}

export const ROAD_RULES: DrivingRules = { speed: SPEED_LIMIT, accel: ACCEL, brake: BRAKE, laneOffset: LANE_OFFSET, reverses: false, signals: true };

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  seg: number;
  dir: Dir;
  /** distance travelled along the current lane, from the node it entered at */
  pos: number;
  speed: number;
  /** lanes still to drive after the current one */
  route: LaneRef[];
  /** where to stop on the last lane, in that lane's travel distance */
  dest: number;
  /** 0..1 for colour variety */
  tint: number;
  /** seconds spent stopped in a row */
  stuck: number;
  /** which of the lanes going this way, 0 = kerbside (wider roads have more) */
  sub?: number;
  /** where the vehicle is drawn across the lanes, easing towards `sub` so lane changes are smooth */
  lat?: number;
  /** the lane it keeps to along this road */
  want?: number;
  /** the lane for its turn at the end of this road, moved into once near the junction (none going straight on) */
  turn?: number;
  /** driven by the player: never gives up or arrives, speed set from the controls */
  player?: boolean;
  /** player's throttle, −1 (brake) .. 1 */
  throttle?: number;
  /** buses and trains: the line they run on, the index of the stop they are heading to, and seconds left at a stop */
  line?: number;
  next?: number;
  dwell?: number;
  /** buses: riders on board, by the stop they get off at */
  load?: Map<number, number>;
}

/** Called when a bus or train reaches the stop it was heading to, and when it is ready to leave. */
export interface LineHooks {
  /** unloads and boards riders; returns seconds to wait at the stop */
  arrive(v: Vehicle): number;
  /** sets the route to the next stop; false takes the bus off the road */
  depart(v: Vehicle): boolean;
}

/** A place on the road network: a segment and a distance from its `a` end. */
export interface RoadPoint {
  seg: number;
  s: number;
}

class MinHeap {
  private items: { k: number; v: number }[] = [];
  get size(): number {
    return this.items.length;
  }
  push(v: number, k: number): void {
    const a = this.items;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): { k: number; v: number } {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Vehicles driving on the road network. Each segment has one or more lanes per direction (`sub`):
 * vehicles pick the lane for their next turn (left turns on the inside, right turns at the kerb),
 * keep to it from road to road and move over when the lane beside them is clear.
 * Cars follow the car ahead (a simplified Intelligent Driver Model) and wait at a
 * junction until there is room on the next lane, so queues and jams form on their own.
 */
export class Traffic {
  vehicles: Vehicle[] = [];
  nextId = 1;
  tripsCompleted = 0;
  tripsAbandoned = 0;
  lineHooks: LineHooks | null = null;
  /** seconds driven, which runs the traffic lights */
  time = 0;
  /** vehicles currently on each lane, sorted back to front */
  private lanes = new Map<number, Vehicle[]>();

  constructor(
    private net: RoadNetwork,
    readonly rules: DrivingRules = ROAD_RULES,
  ) {}

  setNetwork(net: RoadNetwork): void {
    this.net = net;
    this.vehicles = [];
    this.lanes.clear();
  }

  /** Share of a lane's length taken up by vehicles (0 = empty, 1 = bumper to bumper). */
  congestion(seg: RoadSegment, dir: Dir): number {
    const list = this.lanes.get(laneKey(seg.id, dir));
    if (!list?.length) return 0;
    let used = 0;
    for (const v of list) used += VEHICLE_LENGTH[v.kind] + MIN_GAP;
    return Math.min(1, used / Math.max(seg.length * this.laneCount(seg), 1));
  }

  /** Lanes each way on a segment. */
  laneCount(seg: RoadSegment): number {
    return seg.lanes ?? 1;
  }

  /** Top speed on a segment: wider roads are faster (50, 60, 70 km/h). */
  topSpeed(seg: RoadSegment): number {
    const n = this.laneCount(seg);
    return this.rules.speed * (n >= 4 ? 1.4 : n >= 2 ? 1.2 : 1);
  }

  /** Expected seconds to drive a lane, slower when it is busy. */
  private laneTime(seg: RoadSegment, dir: Dir): number {
    return seg.length / (this.topSpeed(seg) * (1 - 0.8 * this.congestion(seg, dir)));
  }

  /**
   * Fastest route between two road points (A* over junctions, weighted by current traffic).
   * `startDir` forces the first lane's direction, for a vehicle already driving along it.
   */
  findRoute(from: RoadPoint, to: RoadPoint, startDir?: Dir): { first: LaneRef; route: LaneRef[]; startPos: number; dest: number } | null {
    const s0 = this.net.segments.get(from.seg);
    const s1 = this.net.segments.get(to.seg);
    if (!s0 || !s1) return null;
    const ahead: Dir = to.s > from.s ? 1 : -1;
    // One-way roads can only be driven a → b
    if (s0.oneway) startDir = 1;
    if (s0.id === s1.id && Math.abs(to.s - from.s) > 1 && (startDir ?? ahead) === ahead) {
      const dir = ahead;
      return {
        first: { seg: s0.id, dir },
        route: [],
        startPos: dir === 1 ? from.s : s0.length - from.s,
        dest: dir === 1 ? to.s : s0.length - to.s,
      };
    }
    const goal = this.net.node(s1.a).p;
    const speed = this.rules.speed;
    const h = (n: number) => dist(this.net.node(n).p, goal) / speed;
    const cost = new Map<number, number>();
    const prev = new Map<number, { node: number; lane: LaneRef } | null>();
    const heap = new MinHeap();
    const start = (node: number, c: number, lane: LaneRef) => {
      if (c < (cost.get(node) ?? Infinity)) {
        cost.set(node, c);
        prev.set(node, { node: -1, lane });
        heap.push(node, c + h(node));
      }
    };
    // Part-lanes at either end go at the same speed laneTime gives the whole lane, so a trip never
    // looks quicker by driving past its destination and coming back the other way
    const v0 = this.topSpeed(s0);
    const v1 = this.topSpeed(s1);
    if (startDir !== -1) start(s0.b, (s0.length - from.s) / v0, { seg: s0.id, dir: 1 });
    if (startDir !== 1) start(s0.a, from.s / v0, { seg: s0.id, dir: -1 });

    const adj = this.adjacency();
    const done = new Set<number>();
    while (heap.size) {
      const { v: u } = heap.pop();
      if (done.has(u)) continue;
      done.add(u);
      if (done.has(s1.a) && done.has(s1.b)) break;
      for (const e of adj.get(u) ?? []) {
        const c = cost.get(u)! + this.laneTime(e.seg, e.dir);
        if (c < (cost.get(e.to) ?? Infinity)) {
          cost.set(e.to, c);
          prev.set(e.to, { node: u, lane: { seg: e.seg.id, dir: e.dir } });
          heap.push(e.to, c + h(e.to));
        }
      }
    }
    // Enter the destination segment from whichever end is cheaper
    const viaA = (cost.get(s1.a) ?? Infinity) + to.s / v1;
    const viaB = s1.oneway ? Infinity : (cost.get(s1.b) ?? Infinity) + (s1.length - to.s) / v1;
    if (!Number.isFinite(Math.min(viaA, viaB))) return null;
    const endNode = viaA <= viaB ? s1.a : s1.b;
    const lastLane: LaneRef = { seg: s1.id, dir: viaA <= viaB ? 1 : -1 };
    const lanes: LaneRef[] = [lastLane];
    let n = endNode;
    for (;;) {
      const p = prev.get(n);
      if (!p) return null;
      lanes.unshift(p.lane);
      if (p.node === -1) break;
      n = p.node;
    }
    const first = lanes.shift()!;
    const startPos = first.dir === 1 ? from.s : s0.length - from.s;
    const dest = lastLane.dir === 1 ? to.s : s1.length - to.s;
    return { first, route: lanes, startPos, dest };
  }

  private adjacencyCache: { version: number; map: Map<number, { to: number; seg: RoadSegment; dir: Dir }[]> } | null = null;
  private netVersion = 0;

  /** Call after roads change: drops vehicles whose road is gone and rebuilds the graph. */
  onNetworkChanged(): void {
    this.netVersion++;
    this.vehicles = this.vehicles.filter(
      (v) => this.net.segments.has(v.seg) && v.route.every((l) => this.net.segments.has(l.seg)),
    );
  }

  private junctionCache: { version: number; map: Map<number, Junction> } | null = null;

  /** Junctions with traffic lights, if these rules have them. */
  junctions(): Map<number, Junction> {
    if (!this.rules.signals) return new Map();
    if (this.junctionCache?.version !== this.netVersion) this.junctionCache = { version: this.netVersion, map: findJunctions(this.net) };
    return this.junctionCache.map;
  }

  /** The light a lane's traffic sees at the junction it drives into, or null where there is none. */
  lightFor(seg: RoadSegment, dir: Dir): Light | null {
    const j = this.junctions().get(dir === 1 ? seg.b : seg.a);
    const a = j?.approaches.find((x) => x.seg === seg.id && x.end === (dir === 1 ? 'b' : 'a'));
    return j && a ? lightAt(j, a.phase, this.time) : null;
  }

  /** The light shown now to one phase of a junction. */
  lightOf(j: Junction, phase: number): Light {
    return lightAt(j, phase, this.time);
  }

  /** Where a vehicle must stop for a light this step, or Infinity if it may go on. */
  private stopLine(v: Vehicle, seg: RoadSegment): number {
    if (!v.route.length || !this.rules.signals) return Infinity;
    const j = this.junctions().get(v.dir === 1 ? seg.b : seg.a);
    // Scooters pull up to the front, into the 機車停等區
    const back = j ? (v.kind === 'scooter' ? j.scooterBack : j.stopBack) : STOP_BACK;
    const line = seg.length - Math.min(back, seg.length / 2);
    if (v.pos > line) return Infinity;
    const light = this.lightFor(seg, v.dir);
    if (!light || light === 'green') return Infinity;
    // On yellow, go on if too close to stop comfortably
    if (light === 'yellow' && line - v.pos < (v.speed * v.speed) / (2 * this.rules.brake)) return Infinity;
    return line;
  }

  private adjacency(): Map<number, { to: number; seg: RoadSegment; dir: Dir }[]> {
    if (this.adjacencyCache?.version === this.netVersion) return this.adjacencyCache.map;
    const m = new Map<number, { to: number; seg: RoadSegment; dir: Dir }[]>();
    const add = (k: number, e: { to: number; seg: RoadSegment; dir: Dir }) => {
      const l = m.get(k);
      if (l) l.push(e);
      else m.set(k, [e]);
    };
    for (const seg of this.net.segments.values()) {
      add(seg.a, { to: seg.b, seg, dir: 1 });
      if (!seg.oneway) add(seg.b, { to: seg.a, seg, dir: -1 });
    }
    this.adjacencyCache = { version: this.netVersion, map: m };
    return m;
  }

  spawn(from: RoadPoint, to: RoadPoint, kind: VehicleKind, tint: number): Vehicle | null {
    const r = this.findRoute(from, to);
    if (!r) return null;
    const v: Vehicle = {
      id: this.nextId++,
      kind,
      seg: r.first.seg,
      dir: r.first.dir,
      pos: r.startPos,
      speed: 0,
      route: r.route,
      dest: r.dest,
      tint,
      stuck: 0,
    };
    const seg = this.net.segments.get(v.seg)!;
    v.sub = Math.floor(tint * 997) % this.laneCount(seg);
    this.planLanes(v, { seg: v.seg, dir: v.dir }, v.route[0]);
    v.lat = v.sub;
    // Don't drop a vehicle on top of another one
    const lane = this.lanes.get(laneKey(v.seg, v.dir));
    if (lane?.some((o) => (o.sub ?? 0) === v.sub && Math.abs(o.pos - v.pos) < VEHICLE_LENGTH[kind] + MIN_GAP)) return null;
    this.vehicles.push(v);
    this.index();
    return v;
  }

  /** Puts the player's car on a lane; the drive controls then pick its next lane as it goes. */
  spawnPlayer(seg: RoadSegment, dir: Dir, pos: number): Vehicle {
    const v: Vehicle = { id: this.nextId++, kind: 'car', seg: seg.id, dir, pos, speed: 0, route: [], dest: seg.length - 1, tint: 0.05, stuck: 0, sub: 0, lat: 0, player: true, throttle: 0 };
    this.vehicles.push(v);
    this.index();
    return v;
  }

  /** Whether another vehicle is alongside `v` in sub-lane `sub`, so it can't move over. */
  laneTaken(v: Vehicle, sub: number): boolean {
    const list = this.lanes.get(laneKey(v.seg, v.dir)) ?? [];
    return list.some((o) => o !== v && (o.sub ?? 0) === sub && Math.abs(o.pos - v.pos) < VEHICLE_LENGTH[o.kind] + MIN_GAP + 2);
  }

  /**
   * Turns a vehicle round on the spot (the patrol car may), into the inside lane the other way. It
   * starts drawn where it was and drifts over, so the swing across the road is smooth.
   */
  uTurn(v: Vehicle): boolean {
    const seg = this.net.segments.get(v.seg);
    if (!seg || seg.oneway) return false;
    const n = this.laneCount(seg);
    const off = this.rules.laneOffset + (n - 1 - (v.lat ?? v.sub ?? 0)) * LANE_WIDTH;
    v.dir = v.dir === 1 ? -1 : 1;
    v.pos = Math.max(0, seg.length - v.pos);
    v.sub = n - 1;
    v.want = v.sub;
    v.turn = undefined;
    v.lat = n - 1 + (this.rules.laneOffset + off) / LANE_WIDTH;
    v.speed = Math.min(v.speed, 5);
    v.route = [];
    v.dest = seg.length - 1;
    this.index();
    return true;
  }

  removeVehicle(v: Vehicle): void {
    this.vehicles = this.vehicles.filter((o) => o !== v);
    this.index();
  }

  /**
   * Sends a vehicle on from where it is now to a new destination. Road vehicles never turn around on
   * the spot; trains (rules.reverses) may set off the other way.
   */
  retarget(v: Vehicle, to: RoadPoint): boolean {
    const seg = this.net.segments.get(v.seg);
    if (!seg) return false;
    const here = { seg: v.seg, s: v.dir === 1 ? v.pos : seg.length - v.pos };
    const r = this.findRoute(here, to, this.rules.reverses ? undefined : v.dir);
    if (!r) return false;
    if (r.first.dir !== v.dir) {
      v.dir = r.first.dir;
      v.pos = r.startPos;
    }
    v.route = r.route;
    v.dest = r.dest;
    return true;
  }

  private index(): void {
    this.lanes.clear();
    for (const v of this.vehicles) {
      const k = laneKey(v.seg, v.dir);
      const l = this.lanes.get(k);
      if (l) l.push(v);
      else this.lanes.set(k, [v]);
    }
    for (const l of this.lanes.values()) l.sort((a, b) => a.pos - b.pos);
  }

  /** Space free at the start of one sub-lane (distance to its last vehicle's tail). */
  private subRoom(lane: LaneRef, sub: number): number {
    const tail = this.lanes.get(laneKey(lane.seg, lane.dir))?.find((o) => (o.sub ?? 0) === sub);
    return tail ? tail.pos - VEHICLE_LENGTH[tail.kind] : Infinity;
  }

  /**
   * The sub-lane `v` drives into on `lane`: the one it wants for its next turn while there is room,
   * otherwise the emptiest.
   */
  private entryRoom(v: Vehicle, lane: LaneRef, after: LaneRef | undefined): { room: number; sub: number } {
    const seg = this.net.segments.get(lane.seg);
    const n = seg ? this.laneCount(seg) : 1;
    const want = Math.min(n - 1, this.wantSub(v, lane, after, seg ? seg.length : 0));
    const room = this.subRoom(lane, want);
    if (room >= VEHICLE_LENGTH[v.kind] + MIN_GAP) return { room, sub: want };
    let best = { room, sub: want };
    for (let sub = 0; sub < n; sub++) {
      const r = this.subRoom(lane, sub);
      if (r > best.room) best = { room: r, sub };
    }
    return best;
  }

  /**
   * The sub-lane a vehicle on `lane` should be in for its turn at the end of it: inside for a left turn (either of
   * the two inside lanes on a wide road), the kerb for a right turn, a bus stop or the end of its trip (once on its
   * last road); none going straight on.
   */
  private turnSub(v: Vehicle, lane: LaneRef, after: LaneRef | undefined): number | undefined {
    const seg = this.net.segments.get(lane.seg);
    const n = seg ? this.laneCount(seg) : 1;
    if (n === 1 || !seg) return 0;
    if (v.kind === 'bus' || (!after && v.seg === lane.seg)) return 0;
    const next = after && this.net.segments.get(after.seg);
    if (!after || !next) return undefined;
    const a = this.headingAt(seg, lane.dir, seg.length);
    const b = this.headingAt(next, after.dir, 0);
    // y points south on the map, so a turn to the left has a negative cross product
    const turn = Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
    if (turn < -0.5) return n >= 3 ? n - 1 - (Math.floor(v.tint * 991) % 2) : n - 1;
    if (turn > 0.5) return 0;
    return undefined;
  }

  /**
   * The sub-lane a vehicle keeps to along `lane` while not about to turn: the lane it is in, or coming off a
   * narrower road or a turn one picked from its tint, so traffic spreads over every lane.
   */
  private cruiseSub(v: Vehicle, lane: LaneRef): number {
    const seg = this.net.segments.get(lane.seg);
    const n = seg ? this.laneCount(seg) : 1;
    if (n === 1) return 0;
    if (v.kind === 'bus') return 0;
    if (v.seg === lane.seg) return Math.min(n - 1, v.sub ?? 0);
    // Straight on from a road as wide keeps its lane; after a turn it picks one afresh
    const cur = this.net.segments.get(v.seg);
    if (cur && v.turn === undefined && this.laneCount(cur) > 1) return Math.min(n - 1, v.sub ?? 0);
    return Math.floor(v.tint * 997) % n;
  }

  /** The lane to drive into on `lane`, `left` metres from its end: the turn's lane when that close to the junction. */
  private wantSub(v: Vehicle, lane: LaneRef, after: LaneRef | undefined, left: number): number {
    const turn = this.turnSub(v, lane, after);
    return turn !== undefined && left < TURN_LANE_REACH ? turn : this.cruiseSub(v, lane);
  }

  /** Sets the lanes a vehicle keeps to on `lane` and moves into for its turn at the end. */
  private planLanes(v: Vehicle, lane: LaneRef, after: LaneRef | undefined): void {
    v.want = this.cruiseSub(v, lane);
    v.turn = this.turnSub(v, lane, after);
  }

  step(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    this.index();
    const arrived = new Set<number>();
    const gaveUp = new Set<number>();
    // A vehicle that drives onto a lane still to come this step must not move twice
    const moved = new Set<Vehicle>();
    for (const list of this.lanes.values()) {
      // Queued behind a red light: waiting there does not count towards giving up
      let held = false;
      // Front to back so each car sees where its leader is this step
      for (let i = list.length - 1; i >= 0; i--) {
        const v = list[i];
        if (moved.has(v)) continue;
        moved.add(v);
        const seg = this.net.segments.get(v.seg);
        if (!seg) {
          arrived.add(v.id);
          continue;
        }
        // A bus at a stop waits for riders, holding up the lane behind it
        if (v.dwell !== undefined && v.dwell > 0) {
          v.speed = 0;
          v.stuck = 0;
          v.dwell -= dt;
          if (v.dwell <= 0 && !this.lineHooks?.depart(v)) gaveUp.add(v.id);
          continue;
        }
        const len = VEHICLE_LENGTH[v.kind];
        let gap: number;
        let leadSpeed = 0;
        // The car ahead in the same sub-lane
        const sub = v.sub ?? 0;
        let li = i + 1;
        while (li < list.length && (list[li].sub ?? 0) !== sub) li++;
        if (li < list.length) {
          const lead = list[li];
          // The leader may have just crossed into its next lane this step
          const ahead = lead.seg === v.seg && lead.dir === v.dir ? lead.pos : seg.length + lead.pos;
          gap = ahead - VEHICLE_LENGTH[lead.kind] - v.pos;
          leadSpeed = lead.speed;
        } else if (!v.route.length) {
          gap = v.dest - v.pos + MIN_GAP;
        } else {
          const { room } = this.entryRoom(v, v.route[0], v.route[1]);
          gap = seg.length - v.pos + (room === Infinity ? 200 : room);
          if (room < len + MIN_GAP) gap = Math.min(gap, seg.length - v.pos + MIN_GAP * 0.5);
          leadSpeed = room === Infinity ? this.rules.speed : 0;
        }
        // The patrol car ignores the rules: it runs red lights and drives through the car ahead
        if (v.player) gap = v.route.length ? Infinity : v.dest - v.pos + MIN_GAP;
        const stop = v.player ? Infinity : this.stopLine(v, seg);
        if (stop - v.pos < gap) {
          gap = stop - v.pos;
          leadSpeed = 0;
        }
        gap = Math.max(gap, 0.01);
        const { accel, brake } = this.rules;
        const top = this.topSpeed(seg) * (v.player ? PLAYER_TOP : 1);
        const sStar = MIN_GAP + v.speed * HEADWAY + (v.speed * (v.speed - leadSpeed)) / (2 * Math.sqrt(accel * brake));
        let acc = accel * (1 - (v.speed / top) ** 4 - (Math.max(sStar, 0) / gap) ** 2);
        // The player's car goes as the controls ask
        if (v.player) {
          // A livelier car than the city's traffic, so driving it feels responsive
          const free = acc * PLAYER_PUNCH;
          const t = v.throttle ?? 0;
          acc = Math.min(free, t > 0 ? t * accel * PLAYER_PUNCH : t < 0 ? t * brake * 2 : -0.6);
        }
        v.speed = Math.max(0, Math.min(top, v.speed + acc * dt));
        v.pos += v.speed * dt;
        if (v.pos > stop) {
          v.pos = stop;
          v.speed = 0;
        }
        const waiting = v.speed < 0.2;
        held = waiting && (stop < Infinity || held);
        v.stuck = waiting && !held && !v.player ? v.stuck + dt : 0;
        if (v.stuck > GIVE_UP_AFTER) {
          gaveUp.add(v.id);
          continue;
        }

        // Move over a lane towards the one wanted for the next turn, once the lane beside is clear
        const sub0 = v.sub ?? 0;
        const want = v.turn !== undefined && seg.length - v.pos < TURN_LANE_REACH ? v.turn : v.want;
        if (!v.player && want !== undefined && want !== sub0 && v.pos < seg.length - NO_CHANGE_NEAR) {
          const to = sub0 + Math.sign(want - sub0);
          if (!this.laneTaken(v, to)) v.sub = to;
        }
        const target = v.sub ?? 0;
        const lat = v.lat ?? target;
        v.lat = lat + Math.max(-LANE_CHANGE_RATE * dt, Math.min(LANE_CHANGE_RATE * dt, target - lat));

        if (!v.route.length) {
          if (v.pos < v.dest - 0.5 || v.player) continue;
          if (v.line !== undefined && this.lineHooks) {
            v.pos = Math.min(v.pos, v.dest);
            v.speed = 0;
            v.dwell = Math.max(0.01, this.lineHooks.arrive(v));
          } else arrived.add(v.id);
          continue;
        }
        if (v.pos >= seg.length) {
          const next = v.route[0];
          const entry = this.entryRoom(v, next, v.route[1]);
          if (v.player || entry.room >= len + MIN_GAP) {
            const nextSeg = this.net.segments.get(next.seg);
            const top = nextSeg ? this.laneCount(nextSeg) - 1 : 0;
            v.pos -= seg.length;
            v.seg = next.seg;
            v.dir = next.dir;
            v.sub = v.player ? Math.min(v.sub ?? 0, top) : entry.sub;
            v.lat = Math.min(v.lat ?? v.sub, top);
            v.route.shift();
            if (v.player) {
              v.want = v.sub;
              v.turn = undefined;
            } else this.planLanes(v, next, v.route[0]);
            // Joined the tail of the next lane: keep the index right for cars behind
            const k = laneKey(next.seg, next.dir);
            const l = this.lanes.get(k);
            if (l) l.unshift(v);
            else this.lanes.set(k, [v]);
          } else {
            v.pos = seg.length;
            v.speed = 0;
          }
        }
      }
    }
    if (arrived.size || gaveUp.size) {
      this.tripsCompleted += arrived.size;
      this.tripsAbandoned += gaveUp.size;
      this.vehicles = this.vehicles.filter((v) => !arrived.has(v.id) && !gaveUp.has(v.id));
    }
  }

  /** World position, height and heading of a vehicle (sim coordinates). */
  pose(v: Vehicle): { p: Vec2; h: number; heading: Vec2 } | null {
    return this.poseBack(v, 0);
  }

  /**
   * Pose of a point `back` meters behind the front of a vehicle, for the cars of a train. Behind the
   * start of its lane it follows the straightest track leading into that lane.
   */
  poseBack(v: Vehicle, back: number): { p: Vec2; h: number; heading: Vec2 } | null {
    let seg = this.net.segments.get(v.seg);
    if (!seg) return null;
    let dir = v.dir;
    let along = v.pos - back;
    for (let hop = 0; along < 0 && hop < 6; hop++) {
      // Node the lane starts at, and the way the vehicle was heading there
      const node: number = dir === 1 ? seg.a : seg.b;
      const out = this.headingAt(seg, dir, 0);
      let best: { seg: RoadSegment; dir: Dir; score: number } | null = null;
      for (const o of this.net.segments.values()) {
        if (o.id === seg.id || (o.a !== node && o.b !== node)) continue;
        // Driving into `node` along o
        const d: Dir = o.b === node ? 1 : -1;
        const into = this.headingAt(o, d, o.length);
        const score = into.x * out.x + into.y * out.y;
        if (!best || score > best.score) best = { seg: o, dir: d, score };
      }
      if (!best) {
        along = 0;
        break;
      }
      seg = best.seg;
      dir = best.dir;
      along += seg.length;
    }
    return this.laneSample(seg, dir, Math.max(0, along), seg.id === v.seg ? (v.lat ?? v.sub ?? 0) : 0);
  }

  headingAt(seg: RoadSegment, dir: Dir, along: number): Vec2 {
    return this.laneSample(seg, dir, along).heading;
  }

  /** Point on a lane, `along` meters from where the lane starts; `sub` may fall between lanes. */
  laneSample(seg: RoadSegment, dir: Dir, along: number, sub = 0): { p: Vec2; h: number; heading: Vec2 } {
    const s = dir === 1 ? along : seg.length - along;
    const S = seg.samples;
    let i = 1;
    while (i < S.length - 1 && S[i].s < s) i++;
    const a = S[i - 1];
    const b = S[i];
    const f = Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s || 1)));
    let hx = (b.x - a.x) * dir;
    let hy = (b.y - a.y) * dir;
    const hl = Math.hypot(hx, hy) || 1;
    hx /= hl;
    hy /= hl;
    // Right of travel direction (x east, y south); wider roads have more lanes further out
    // A one-way road's lanes spread across the whole carriageway; two-way traffic keeps right of the centre line
    const off = seg.oneway && !seg.ring
      ? ((this.laneCount(seg) - 1) / 2 - sub) * LANE_WIDTH
      : this.rules.laneOffset + ((seg.lanes ?? 1) - 1 - sub) * LANE_WIDTH;
    return {
      p: { x: a.x + (b.x - a.x) * f - hy * off, y: a.y + (b.y - a.y) * f + hx * off },
      h: this.net.heightAt(seg, a.t + (b.t - a.t) * f),
      heading: { x: hx, y: hy },
    };
  }
}

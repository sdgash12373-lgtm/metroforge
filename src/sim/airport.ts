import { type Vec2, clamp } from './geometry';

export type RunwayCount = 2 | 4;

export const RUNWAY_LENGTH = 520;
export const RUNWAY_WIDTH = 30;
/** Distance between parallel runways. */
export const RUNWAY_GAP = 70;
/** Local y of the taxiway, the gates and the terminal (runway 0 is at y = 0, the others below it). */
export const TAXI_Y = 42;
export const GATE_Y = 74;
export const TERMINAL_Y = 92;
export const TERMINAL_DEPTH = 34;
const GATE_SPACING = 34;
/** Local y where an airport's access road starts, just past its landside road. */
export const ACCESS_Y = TERMINAL_Y + TERMINAL_DEPTH + 16 + 6.5;
/** The taxi rank: the head of the queue waits at local x RANK_X, and one cab leaves every TAXI_CYCLE seconds. */
export const RANK_X = 14;
export const TAXI_CYCLE = 9;
/** Seconds into a cycle when the leaving cab, pulling away at 2 m/s², reaches the access road at x = 0. */
const TAXI_LEAVE = Math.sqrt(RANK_X);
/** Free land kept around the airfield. */
const MARGIN = 50;

export const AIRPORT_COST: Record<RunwayCount, number> = { 2: 40000, 4: 75000 };
export const AIRPORT_UPKEEP = 10;
export const FLIGHT_UPKEEP = 2;
export const AIR_FARE = 60;
export const MAX_AIR_FARE = 200;
const PLANE_SEATS = 180;

/** Seconds (of driving time) spent in each part of a flight. */
const AWAY = 70;
const APPROACH = 14;
const ROLLOUT = 8;
const TAXI_SPEED = 14;
const BOARDING = 22;
const TAKEOFF_ROLL = 7;
const CLIMB = 9;

export interface Airport {
  id: number;
  /** centre of the airfield */
  p: Vec2;
  /** runway direction, radians */
  angle: number;
  runways: RunwayCount;
}

export type FlightState = 'away' | 'approach' | 'rollout' | 'taxi-in' | 'boarding' | 'taxi-out' | 'takeoff' | 'climb';

export interface Flight {
  id: number;
  airport: number;
  name: string;
  color: number;
  state: FlightState;
  /** seconds spent in the current state */
  t: number;
  runway: number;
  gate: number;
  /** passengers flown so far */
  passengers: number;
  /** taxi route for the current taxi state, in airport-local coordinates */
  path?: Vec2[];
}

export interface PlanePose {
  p: Vec2;
  h: number;
  heading: Vec2;
}

export const PLANE_COLORS = [0xffffff, 0xe4572e, 0x2e86ab, 0x6a994e, 0xa23b72, 0xf2b134, 0x3d5a80, 0xd62828];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Airports and the flights that use them. */
export class Aviation {
  airports = new Map<number, Airport>();
  flights = new Map<number, Flight>();
  nextAirport = 1;
  nextFlight = 1;
  /** bumped when airports or flights are added, removed or edited */
  version = 0;
  fare = AIR_FARE;
  incomeToday = 0;
  passengersToday = 0;
  /** where the taxi ranks are in their cycle, in seconds */
  taxiTime = 0;
  /** cabs that have left each rank for the access road and not yet been put on the streets */
  taxisDue = 0;

  /** Local y range of an airport's land (runways below, terminal above). */
  static extent(runways: RunwayCount): { minX: number; maxX: number; minY: number; maxY: number } {
    return {
      minX: -RUNWAY_LENGTH / 2 - MARGIN,
      maxX: RUNWAY_LENGTH / 2 + MARGIN,
      minY: -RUNWAY_GAP * (runways - 1) - RUNWAY_WIDTH / 2 - MARGIN * 0.6,
      maxY: TERMINAL_Y + TERMINAL_DEPTH + 16,
    };
  }

  /** Shift that centres the land on the airport's point. */
  private static centreY(runways: RunwayCount): number {
    const e = Aviation.extent(runways);
    return (e.minY + e.maxY) / 2;
  }

  /** Airport-local point (x along the runways) to world coordinates. */
  static toWorld(a: Airport, l: Vec2): Vec2 {
    const y = l.y - Aviation.centreY(a.runways);
    const c = Math.cos(a.angle);
    const s = Math.sin(a.angle);
    return { x: a.p.x + l.x * c - y * s, y: a.p.y + l.x * s + y * c };
  }

  static toLocal(a: Airport, p: Vec2): Vec2 {
    const dx = p.x - a.p.x;
    const dy = p.y - a.p.y;
    const c = Math.cos(a.angle);
    const s = Math.sin(a.angle);
    return { x: dx * c + dy * s, y: -dx * s + dy * c + Aviation.centreY(a.runways) };
  }

  /** True when p lies on the airport's land (grown by `pad` meters). */
  static contains(a: Airport, p: Vec2, pad = 0): boolean {
    const l = Aviation.toLocal(a, p);
    const e = Aviation.extent(a.runways);
    return l.x > e.minX - pad && l.x < e.maxX + pad && l.y > e.minY - pad && l.y < e.maxY + pad;
  }

  /** The four corners of the airport's land, for previews. */
  static corners(a: Airport): Vec2[] {
    const e = Aviation.extent(a.runways);
    return [
      { x: e.minX, y: e.minY },
      { x: e.maxX, y: e.minY },
      { x: e.maxX, y: e.maxY },
      { x: e.minX, y: e.maxY },
    ].map((l) => Aviation.toWorld(a, l));
  }

  static runwayY(k: number): number {
    return -k * RUNWAY_GAP;
  }

  static gates(a: Airport): number {
    return a.runways * 3;
  }

  static gateX(a: Airport, g: number): number {
    return (g - (Aviation.gates(a) - 1) / 2) * GATE_SPACING;
  }

  airportAt(p: Vec2, pad = 0): Airport | null {
    for (const a of this.airports.values()) if (Aviation.contains(a, p, pad)) return a;
    return null;
  }

  addAirport(p: Vec2, angle: number, runways: RunwayCount, id?: number): Airport {
    const a: Airport = { id: id ?? this.nextAirport++, p: { ...p }, angle, runways };
    this.nextAirport = Math.max(this.nextAirport, a.id + 1);
    this.airports.set(a.id, a);
    this.version++;
    return a;
  }

  removeAirport(id: number): void {
    this.airports.delete(id);
    for (const f of [...this.flights.values()]) if (f.airport === id) this.flights.delete(f.id);
    this.version++;
  }

  /** A new flight at the airport with the most room per runway. Null when there is no airport. */
  addFlight(airportId?: number, opts: { id?: number; name?: string; color?: number } = {}): Flight | null {
    let airport = airportId !== undefined ? this.airports.get(airportId) : undefined;
    if (!airport) {
      let best = Infinity;
      for (const a of this.airports.values()) {
        const load = this.flightsAt(a.id).length / a.runways;
        if (load < best) {
          best = load;
          airport = a;
        }
      }
    }
    if (!airport) return null;
    const id = opts.id ?? this.nextFlight++;
    this.nextFlight = Math.max(this.nextFlight, id + 1);
    const count = this.flightsAt(airport.id).length;
    const f: Flight = {
      id,
      airport: airport.id,
      name: opts.name ?? `CS${100 + id}`,
      color: opts.color ?? PLANE_COLORS[(id - 1) % PLANE_COLORS.length],
      state: 'away',
      // Spread new flights out so they don't all land at once
      t: AWAY - 4 - (count % 6) * 9,
      runway: count % airport.runways,
      gate: -1,
      passengers: 0,
    };
    this.flights.set(f.id, f);
    this.version++;
    return f;
  }

  flightsAt(airportId: number): Flight[] {
    return [...this.flights.values()].filter((f) => f.airport === airportId);
  }

  editFlight(id: number, change: { name?: string; color?: number }): void {
    const f = this.flights.get(id);
    if (!f) return;
    if (change.name !== undefined) f.name = change.name.trim().slice(0, 20) || `CS${100 + f.id}`;
    if (change.color !== undefined) f.color = change.color;
    this.version++;
  }

  removeFlight(id: number): void {
    this.flights.delete(id);
    this.version++;
  }

  /** Share of seats sold at the current fare. */
  loadFactor(): number {
    return clamp(1 - (this.fare / MAX_AIR_FARE) * 0.85, 0.1, 1);
  }

  /** Passengers on one departure: more people in town fill bigger planes. */
  passengersPerFlight(population: number): number {
    return Math.round(clamp(30 + population / 25, 30, PLANE_SEATS) * this.loadFactor());
  }

  /** Is anything landing on, rolling along or taking off from this runway? */
  private runwayBusy(a: number, runway: number, except: Flight): boolean {
    for (const f of this.flights.values()) {
      if (f === except || f.airport !== a || f.runway !== runway) continue;
      if (f.state === 'approach' || f.state === 'rollout' || f.state === 'takeoff') return true;
      // A plane lined up at the start of the runway
      if (f.state === 'taxi-out' && f.path && f.t * TAXI_SPEED > pathLength(f.path) - 60) return true;
    }
    return false;
  }

  private freeGate(a: Airport, except: Flight): number {
    const used = new Set<number>();
    for (const f of this.flights.values()) if (f !== except && f.airport === a.id && f.gate >= 0) used.add(f.gate);
    for (let g = 0; g < Aviation.gates(a); g++) if (!used.has(g)) return g;
    return -1;
  }

  /** Advances every flight by dt seconds. */
  step(dt: number, population: number): void {
    const t = this.taxiTime + dt;
    if (this.airports.size) this.taxisDue = Math.min(4, this.taxisDue + Math.floor((t - TAXI_LEAVE) / TAXI_CYCLE) - Math.floor((this.taxiTime - TAXI_LEAVE) / TAXI_CYCLE));
    this.taxiTime = t % TAXI_CYCLE;
    for (const f of this.flights.values()) {
      const a = this.airports.get(f.airport);
      if (!a) continue;
      f.t += dt;
      const L = RUNWAY_LENGTH / 2;
      const y = Aviation.runwayY(f.runway);
      switch (f.state) {
        case 'away':
          if (f.t < AWAY) break;
          if (this.runwayBusy(a.id, f.runway, f)) break;
          f.gate = this.freeGate(a, f);
          if (f.gate < 0) break;
          this.enter(f, 'approach');
          break;
        case 'approach':
          if (f.t >= APPROACH) this.enter(f, 'rollout');
          break;
        case 'rollout':
          if (f.t >= ROLLOUT) {
            const gx = Aviation.gateX(a, f.gate);
            this.enter(f, 'taxi-in', [
              { x: L - 60, y },
              { x: L + 20, y },
              { x: L + 20, y: TAXI_Y },
              { x: gx, y: TAXI_Y },
              { x: gx, y: GATE_Y },
            ]);
          }
          break;
        case 'taxi-in':
          if (f.t * TAXI_SPEED >= pathLength(f.path!)) this.enter(f, 'boarding');
          break;
        case 'boarding':
          if (f.t < BOARDING || this.runwayBusy(a.id, f.runway, f)) break;
          {
            const pax = this.passengersPerFlight(population);
            f.passengers += pax;
            this.passengersToday += pax;
            this.incomeToday += pax * this.fare;
            const gx = Aviation.gateX(a, f.gate);
            this.enter(f, 'taxi-out', [
              { x: gx, y: GATE_Y },
              { x: gx, y: TAXI_Y },
              { x: -L - 20, y: TAXI_Y },
              { x: -L - 20, y },
              { x: -L + 10, y },
            ]);
          }
          break;
        case 'taxi-out':
          if (f.t * TAXI_SPEED >= pathLength(f.path!)) {
            f.gate = -1;
            this.enter(f, 'takeoff');
          }
          break;
        case 'takeoff':
          if (f.t >= TAKEOFF_ROLL) this.enter(f, 'climb');
          break;
        case 'climb':
          if (f.t >= CLIMB) this.enter(f, 'away');
          break;
      }
    }
  }

  private enter(f: Flight, state: FlightState, path?: Vec2[]): void {
    f.state = state;
    f.t = 0;
    f.path = path;
  }

  /** Where a plane is, in world coordinates; null while it is away. */
  pose(f: Flight): PlanePose | null {
    const a = this.airports.get(f.airport);
    if (!a || f.state === 'away') return null;
    const L = RUNWAY_LENGTH / 2;
    const y = Aviation.runwayY(f.runway);
    let l: Vec2;
    let h = 0;
    let dir: Vec2 = { x: 1, y: 0 };
    switch (f.state) {
      case 'approach': {
        const u = f.t / APPROACH;
        l = { x: lerp(-L - 1100, -L + 60, u), y };
        h = lerp(150, 0, u);
        break;
      }
      case 'rollout': {
        const u = f.t / ROLLOUT;
        l = { x: lerp(-L + 60, L - 60, 1 - (1 - u) * (1 - u)), y };
        break;
      }
      case 'taxi-in':
      case 'taxi-out': {
        const at = alongPath(f.path!, f.t * TAXI_SPEED);
        l = at.p;
        dir = at.dir;
        break;
      }
      case 'boarding': {
        l = { x: Aviation.gateX(a, f.gate), y: GATE_Y };
        dir = { x: 0, y: 1 };
        break;
      }
      case 'takeoff': {
        const u = f.t / TAKEOFF_ROLL;
        l = { x: lerp(-L + 10, L - 160, u * u), y };
        break;
      }
      case 'climb': {
        const u = f.t / CLIMB;
        l = { x: lerp(L - 160, L + 1300, u), y };
        h = 220 * u ** 1.4;
        break;
      }
    }
    const p = Aviation.toWorld(a, l);
    const ahead = Aviation.toWorld(a, { x: l.x + dir.x, y: l.y + dir.y });
    return { p, h, heading: { x: ahead.x - p.x, y: ahead.y - p.y } };
  }
}

function pathLength(path: Vec2[]): number {
  let n = 0;
  for (let i = 1; i < path.length; i++) n += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return n;
}

function alongPath(path: Vec2[], d: number): { p: Vec2; dir: Vec2 } {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const dir = { x: (b.x - a.x) / (len || 1), y: (b.y - a.y) / (len || 1) };
    if (d <= len || i === path.length - 1) {
      const f = clamp(d / (len || 1), 0, 1);
      return { p: { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) }, dir };
    }
    d -= len;
  }
  return { p: path[0], dir: { x: 1, y: 0 } };
}

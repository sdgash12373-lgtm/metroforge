import { RoadNetwork } from './roads';
import { type DrivingRules, Traffic } from './traffic';
import { HSR, METRO, TRAIN, Transit, type TransitMode } from './transit';

export type RailKind = 'metro' | 'train' | 'hsr';
export const RAIL_KINDS: RailKind[] = ['metro', 'train', 'hsr'];

export interface RailSpec {
  mode: TransitMode;
  rules: DrivingRules;
  /** track price per meter at ground level */
  costPerM: number;
  /** level new track is drawn on by default: metro runs underground */
  defaultLevel: 'ground' | 'elevated' | 'tunnel';
  /** out-of-town travellers per resident per day, spread over the lines */
  visitorsPerResident: number;
}

/** Tracks are double: one per direction, 2.2 m either side of the centre line. */
export const TRACK_OFFSET = 2.2;
/** Track upkeep per meter per day. */
export const TRACK_UPKEEP = 0.006;

export const RAIL_SPECS: Record<RailKind, RailSpec> = {
  metro: {
    mode: METRO,
    rules: { speed: 22, accel: 1.3, brake: 1.5, laneOffset: TRACK_OFFSET, reverses: true },
    costPerM: 25,
    defaultLevel: 'tunnel',
    visitorsPerResident: 0,
  },
  train: {
    mode: TRAIN,
    rules: { speed: 33, accel: 0.9, brake: 1.2, laneOffset: TRACK_OFFSET, reverses: true },
    costPerM: 25,
    defaultLevel: 'ground',
    visitorsPerResident: 1 / 400,
  },
  hsr: {
    mode: HSR,
    rules: { speed: 60, accel: 1.1, brake: 1.3, laneOffset: TRACK_OFFSET, reverses: true },
    costPerM: 45,
    defaultLevel: 'elevated',
    visitorsPerResident: 1 / 250,
  },
};

/** One kind of train: its own track network, the trains on it, and its stations and lines. */
export class RailSystem {
  readonly net = new RoadNetwork();
  readonly traffic: Traffic;
  readonly transit: Transit;
  /** bumped whenever track changes */
  version = 0;

  constructor(readonly kind: RailKind) {
    const spec = RAIL_SPECS[kind];
    this.traffic = new Traffic(this.net, spec.rules);
    this.transit = new Transit(this.net, this.traffic, spec.mode);
  }

  get spec(): RailSpec {
    return RAIL_SPECS[this.kind];
  }

  changed(): void {
    this.traffic.onNetworkChanged();
    this.transit.onNetworkChanged();
    this.version++;
  }

  trackLength(): number {
    let n = 0;
    for (const s of this.net.segments.values()) n += s.length;
    return n;
  }
}

import { describe, expect, it } from 'vitest';
import { Aviation } from '../src/sim/airport';
import { City } from '../src/sim/city';
import type { RailKind } from '../src/sim/rail';
import { ELEVATED_HEIGHT, TUNNEL_DEPTH } from '../src/sim/roads';
import { Zone } from '../src/sim/zoning';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

function rng(seed = 11) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** Straight track from (0, 0) to (len, 0) with a station near each end and one in the middle. */
function railLine(city: City, kind: RailKind, len = 1200, height = 0) {
  const sys = city.rails[kind];
  expect(city.buildTrack(kind, free(0, 0), null, free(len, 0), height, true).ok).toBe(true);
  const stops = [80, len / 2, len - 80].map((x) => sys.transit.stopAt({ x, y: 0 }, 12)!.id);
  return { sys, result: city.createLine(sys.transit, stops) };
}

describe('rail', () => {
  it('runs metro trains underground, back and forth between the end stations', () => {
    const city = new City();
    city.money = 1e6;
    const { sys, result } = railLine(city, 'metro', 1200, TUNNEL_DEPTH);
    expect(result.ok).toBe(true);
    expect([...sys.net.nodes.values()].every((n) => n.h === TUNNEL_DEPTH)).toBe(true);
    const line = [...sys.transit.lines.values()][0];
    expect(line.ok).toBe(true);
    city.tick(rng());
    const train = sys.transit.buses(line.id)[0];
    expect(train?.kind).toBe('metro');
    const dirs = new Set<number>();
    const visited = new Set<number>();
    for (let i = 0; i < 8000; i++) {
      sys.traffic.step(0.1);
      dirs.add(train.dir);
      if (train.dwell && train.dwell > 0) visited.add(train.next!);
    }
    expect(sys.traffic.vehicles).toContain(train);
    // It turned round at the end of the line and called at every station
    expect(dirs.size).toBe(2);
    expect(visited.size).toBe(3);
  });

  it('draws the cars of a train behind it, along the track', () => {
    const city = new City();
    city.money = 1e6;
    const { sys } = railLine(city, 'hsr', 1500, ELEVATED_HEIGHT);
    city.tick(rng());
    const train = sys.transit.buses()[0];
    for (let i = 0; i < 300; i++) sys.traffic.step(0.1);
    const front = sys.traffic.pose(train)!;
    const tail = sys.traffic.poseBack(train, 100)!;
    expect(Math.abs(front.p.x - tail.p.x)).toBeCloseTo(100, 0);
    expect(front.h).toBe(ELEVATED_HEIGHT);
  });

  it('keeps track and airports off zoned land and charges for track by level', () => {
    const city = new City();
    city.money = 1e6;
    city.buildRoad(free(0, 0), null, free(300, 0), true);
    city.paint({ x: 150, y: 20 }, 60, Zone.ResidentialLow);
    const zoned = () => [...city.net.segments.values()].flatMap((s) => s.lots).filter((l) => !l.blocked && l.zone).length;
    const before = zoned();
    city.buildTrack('train', free(150, -60), null, free(150, 60), 0, true);
    expect(zoned()).toBeLessThan(before);
    const ground = city.trackCost('metro', { x: 0, y: 0 }, null, { x: 100, y: 0 });
    expect(city.trackCost('metro', { x: 0, y: 0 }, null, { x: 100, y: 0 }, TUNNEL_DEPTH, TUNNEL_DEPTH)).toBe(ground * 3);
  });

  it('carries commuters who live and work near its stations, and visitors on intercity lines', () => {
    const city = new City();
    city.money = 1e6;
    city.buildRoad(free(-100, 40), null, free(1300, 40), true);
    city.addOutsideConnection([...city.net.nodes.values()].find((n) => n.p.x === -100)!.id);
    city.paint({ x: 60, y: 60 }, 40, Zone.ResidentialHigh);
    city.paint({ x: 1120, y: 60 }, 40, Zone.Office);
    for (const s of city.net.segments.values()) for (const lot of s.lots) if (lot.zone) lot.level = 3;
    const { sys } = railLine(city, 'train', 1200);
    const r = rng();
    let riders = 0;
    for (let i = 0; i < 300; i++) {
      city.tick(r);
      for (let k = 0; k < 5; k++) city.drive(0.1);
      riders += city.stats.riders;
    }
    expect(riders).toBeGreaterThan(0);
    expect([...sys.transit.lines.values()][0].riders).toBeGreaterThan(0);
    expect(city.budget.transitUpkeep).toBeGreaterThan(0);
  });

  it('are saved and loaded with their lines', () => {
    const city = new City();
    city.money = 1e6;
    const { sys } = railLine(city, 'metro', 1000, TUNNEL_DEPTH);
    const line = [...sys.transit.lines.values()][0];
    sys.transit.editLine(line.id, { name: '板南線', color: 0x2e86ab });
    sys.transit.fare = 4;
    const copy = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    const c = copy.rails.metro.transit.lines.get(line.id)!;
    expect([c.name, c.color, c.ok, c.stops.length]).toEqual(['板南線', 0x2e86ab, true, 3]);
    expect(copy.rails.metro.transit.fare).toBe(4);
    expect(copy.rails.metro.net.segments.size).toBe(sys.net.segments.size);
  });
});

describe('airports', () => {
  it('need clear land, and roads cannot cross them except in a tunnel', () => {
    const city = new City();
    city.money = 1e6;
    city.buildRoad(free(-100, 0), null, free(100, 0), true);
    expect(city.buildAirport({ x: 0, y: 0 }, 0, 2).ok).toBe(false);
    const r = city.buildAirport({ x: 0, y: 600 }, 0, 4);
    expect(r.ok).toBe(true);
    expect(city.buildRoad(free(0, 450), null, free(0, 750), true).ok).toBe(false);
    expect(city.buildRoad(free(0, 450), null, free(0, 750), true, TUNNEL_DEPTH).ok).toBe(true);
    expect(Aviation.contains(r.airport!, { x: 0, y: 600 })).toBe(true);
  });

  it('fly flights that land, board at a gate, take off and earn fares', () => {
    const city = new City();
    city.money = 1e6;
    const a = city.buildAirport({ x: 0, y: 0 }, Math.PI / 6, 2).airport!;
    const f = city.aviation.addFlight()!;
    expect(f.airport).toBe(a.id);
    const seen = new Set<string>();
    let income = 0;
    for (let i = 0; i < 3000; i++) {
      city.aviation.step(0.1, 2000);
      seen.add(f.state);
      income += city.aviation.incomeToday;
      city.aviation.incomeToday = 0;
      if (f.state !== 'away') expect(city.aviation.pose(f)).not.toBeNull();
    }
    expect([...seen].sort()).toEqual(['approach', 'away', 'boarding', 'climb', 'rollout', 'takeoff', 'taxi-in', 'taxi-out']);
    expect(income).toBeGreaterThan(0);
    expect(f.passengers).toBeGreaterThan(0);
  });

  it('keep flights, names and plane colours through a save', () => {
    const city = new City();
    city.money = 1e6;
    city.buildAirport({ x: 0, y: 0 }, 0.5, 4);
    const f = city.aviation.addFlight()!;
    city.aviation.editFlight(f.id, { name: 'BR 189', color: 0x6a994e });
    const copy = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    const a = [...copy.aviation.airports.values()][0];
    expect([a.runways, a.angle]).toEqual([4, 0.5]);
    const g = copy.aviation.flights.get(f.id)!;
    expect([g.name, g.color]).toEqual(['BR 189', 0x6a994e]);
  });
});

describe('names', () => {
  it('name a whole street through junctions, and keep it when the street is split', () => {
    const city = new City();
    city.buildRoad(free(0, 0), null, free(400, 0), true);
    city.buildRoad(free(200, -100), null, free(200, 100), true);
    const piece = city.net.segmentAt({ x: 50, y: 0 }, 3)!.seg;
    city.nameStreet(piece.id, '中山路');
    const named = [...city.net.segments.values()].filter((s) => s.name === '中山路');
    // Both halves of the east-west road, not the cross street
    expect(named).toHaveLength(2);
    expect(named.every((s) => Math.abs(city.net.node(s.a).p.y) < 1)).toBe(true);
    city.buildRoad(free(320, -60), null, free(320, 60), true);
    expect([...city.net.segments.values()].filter((s) => s.name === '中山路')).toHaveLength(3);
  });

  it('keep street names and districts through a save', () => {
    const city = new City();
    city.buildRoad(free(0, 0), null, free(400, 0), true);
    city.nameStreet(city.net.segmentAt({ x: 50, y: 0 }, 3)!.seg.id, '忠孝東路');
    const d = city.addDistrict({ x: 100, y: 100 }, 150);
    city.editDistrict(d.id, { name: '信義區', color: 0xf4d35e });
    const copy = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    expect([...copy.net.segments.values()][0].name).toBe('忠孝東路');
    const e = copy.districts.get(d.id)!;
    expect([e.name, e.color, e.r]).toEqual(['信義區', 0xf4d35e, 150]);
    expect(copy.districtAt({ x: 110, y: 100 }, 20)?.id).toBe(d.id);
  });
});

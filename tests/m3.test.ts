import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/city';
import { ELEVATED_HEIGHT } from '../src/sim/roads';
import { Zone } from '../src/sim/zoning';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });
const segAt = (city: City, x: number, y: number) => city.net.segmentAt({ x, y }, 3)!.seg;

function rng(seed = 7) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

describe('elevated roads', () => {
  it('pass over a street without making a junction', () => {
    const city = new City();
    city.buildRoad(free(0, -100), null, free(0, 100), true);
    const r = city.buildRoad(free(-100, 0), null, free(100, 0), true, ELEVATED_HEIGHT);
    expect(r.ok).toBe(true);
    expect(city.net.segments.size).toBe(2);
    expect([...city.net.nodes.values()].every((n) => city.net.degree(n.id) === 1)).toBe(true);
  });

  it('still meet other elevated roads in a junction', () => {
    const city = new City();
    city.buildRoad(free(0, -100), null, free(0, 100), true, ELEVATED_HEIGHT);
    city.buildRoad(free(-100, 0), null, free(100, 0), true, ELEVATED_HEIGHT);
    expect(city.net.segments.size).toBe(4);
    const hub = [...city.net.nodes.values()].find((n) => city.net.degree(n.id) === 4)!;
    expect(hub.h).toBe(ELEVATED_HEIGHT);
  });

  it('ramp up from a street end, and refuse ramps that are too steep', () => {
    const city = new City();
    city.buildRoad(free(0, 0), null, free(100, 0), true);
    const end = city.net.snap({ x: 100, y: 0 }, 1);
    expect(city.buildRoad(end, null, free(120, 0), true, ELEVATED_HEIGHT).ok).toBe(false);
    const ramp = city.buildRoad(end, null, free(180, 0), true, ELEVATED_HEIGHT);
    expect(ramp.ok).toBe(true);
    const seg = segAt(city, 140, 0);
    expect(city.net.heightAt(seg, 0)).toBe(0);
    expect(city.net.heightAt(seg, 1)).toBe(ELEVATED_HEIGHT);
    // Traffic drives straight up the ramp
    const from = segAt(city, 50, 0);
    expect(city.traffic.findRoute({ seg: from.id, s: 10 }, { seg: seg.id, s: 70 })).not.toBeNull();
  });

  it('have no zoning along them and cost more than streets', () => {
    const city = new City();
    city.buildRoad(free(0, 0), null, free(200, 0), true, ELEVATED_HEIGHT);
    expect(segAt(city, 100, 0).lots).toHaveLength(0);
    const street = city.roadCost({ x: 0, y: 0 }, null, { x: 100, y: 0 });
    const deck = city.roadCost({ x: 0, y: 0 }, null, { x: 100, y: 0 }, ELEVATED_HEIGHT, ELEVATED_HEIGHT);
    expect(deck).toBe(street * 3);
  });

  it('keep their height through a save', () => {
    const city = new City();
    city.buildRoad(free(0, 0), null, free(200, 0), true, ELEVATED_HEIGHT);
    const copy = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    expect([...copy.net.nodes.values()].every((n) => n.h === ELEVATED_HEIGHT)).toBe(true);
  });
});

/** A 300 × 300 block of streets. */
function block() {
  const city = new City();
  city.money = 1e6;
  city.buildRoad(free(0, 0), null, free(300, 0), true);
  city.buildRoad(city.net.snap({ x: 300, y: 0 }, 1), null, free(300, 300), true);
  city.buildRoad(city.net.snap({ x: 300, y: 300 }, 1), null, free(0, 300), true);
  city.buildRoad(city.net.snap({ x: 0, y: 300 }, 1), null, city.net.snap({ x: 0, y: 0 }, 1), true);
  return city;
}

function line(city: City, pts: [number, number][]) {
  const stops = pts.map(([x, y]) => city.transit.stopAt({ x, y }, 12)!.id);
  return city.createBusLine(stops);
}

describe('bus lines', () => {
  it('need stops on streets that connect', () => {
    const city = block();
    expect(city.transit.stopAt({ x: 150, y: 150 }, 12)).toBeNull();
    city.buildRoad(free(500, 0), null, free(700, 0), true);
    const r = line(city, [[150, 0], [600, 0]]);
    expect(r.ok).toBe(false);
    expect(city.transit.lines.size).toBe(0);
  });

  it('run buses that loop through every stop', () => {
    const city = block();
    expect(line(city, [[150, 0], [300, 150], [150, 300]]).ok).toBe(true);
    const l = [...city.transit.lines.values()][0];
    expect(l.ok).toBe(true);
    expect(l.length).toBeGreaterThan(600);
    city.tick(rng());
    const bus = city.transit.buses(l.id)[0];
    expect(bus).toBeDefined();
    const visited = new Set<number>();
    for (let i = 0; i < 6000; i++) {
      city.traffic.step(0.1);
      if (bus.dwell && bus.dwell > 0) visited.add(l.stops[(bus.next! + l.stops.length - 1) % l.stops.length]);
    }
    expect(city.traffic.vehicles).toContain(bus);
    expect(visited.size).toBe(3);
  });

  it('carry commuters instead of cars and earn fares', () => {
    const city = block();
    city.addOutsideConnection([...city.net.nodes.values()].find((n) => n.p.x === 0 && n.p.y === 0)!.id);
    city.paint({ x: 60, y: 15 }, 40, Zone.ResidentialHigh);
    city.paint({ x: 240, y: 285 }, 40, Zone.Office);
    for (const s of city.net.segments.values()) for (const lot of s.lots) if (lot.zone) lot.level = 3;
    line(city, [[60, 0], [240, 300]]);
    const r = rng();
    let riders = 0;
    let fares = 0;
    for (let i = 0; i < 200; i++) {
      city.tick(r);
      for (let k = 0; k < 5; k++) city.traffic.step(0.1);
      riders += city.stats.riders;
      fares += city.budget.busFares;
    }
    expect(riders).toBeGreaterThan(0);
    expect(fares).toBeGreaterThan(0);
    expect(city.budget.busUpkeep).toBeGreaterThan(0);
  });

  it('follow their stops when a road is split, and close when a stop loses its street', () => {
    const city = block();
    line(city, [[150, 0], [150, 300]]);
    // A new street splits both roads the stops are on
    city.buildRoad(free(100, -50), null, free(100, 350), true);
    const l = [...city.transit.lines.values()][0];
    expect(l.ok).toBe(true);
    for (const id of l.stops) expect(city.net.segments.has(city.transit.stops.get(id)!.at!.seg)).toBe(true);
    city.bulldoze({ x: 200, y: 300 }, 3);
    expect(city.transit.lines.size).toBe(0);
    expect(city.transit.stops.size).toBe(0);
  });

  it('are saved and loaded', () => {
    const city = block();
    line(city, [[150, 0], [300, 150], [150, 300]]);
    const copy = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    const l = [...copy.transit.lines.values()][0];
    expect(l.stops).toHaveLength(3);
    expect(l.ok).toBe(true);
  });
});

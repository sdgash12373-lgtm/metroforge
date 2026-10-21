import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/city';
import { ELEVATED_HEIGHT, TUNNEL_DEPTH } from '../src/sim/roads';
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
      fares += city.budget.transitFares;
    }
    expect(riders).toBeGreaterThan(0);
    expect(fares).toBeGreaterThan(0);
    expect(city.budget.transitUpkeep).toBeGreaterThan(0);
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

  it('can be renamed and recoloured, and keep both with the fare in a save', () => {
    const city = block();
    line(city, [[150, 0], [300, 150], [150, 300]]);
    const l = [...city.transit.lines.values()][0];
    expect(l.name).toBe(`${l.id} 號線`);
    city.transit.editLine(l.id, { name: '  市區環狀線  ', color: 0x2e86ab });
    expect(l.name).toBe('市區環狀線');
    city.transit.editLine(l.id, { name: '' });
    expect(l.name).toBe(`${l.id} 號線`);
    city.transit.editLine(l.id, { name: '市區環狀線' });
    city.transit.fare = 3;
    const copy = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    const c = copy.transit.lines.get(l.id)!;
    expect([c.name, c.color]).toEqual(['市區環狀線', 0x2e86ab]);
    expect(copy.transit.fare).toBe(3);
  });

  it('lose riders as the fare goes up', () => {
    const city = new City();
    const shares = [0, 1, 3, 5].map((f) => {
      city.transit.fare = f;
      return city.transit.share();
    });
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeLessThan(shares[i - 1]);
    expect(shares[3]).toBeGreaterThan(0);
  });
});

describe('tunnels', () => {
  it('pass under streets and slope down from a street end', () => {
    const city = new City();
    city.buildRoad(free(0, -100), null, free(0, 100), true);
    city.buildRoad(free(-200, 0), null, free(-100, 0), true);
    const end = city.net.snap({ x: -100, y: 0 }, 1);
    expect(city.buildRoad(end, null, free(-80, 0), true, TUNNEL_DEPTH).ok).toBe(false);
    expect(city.buildRoad(end, null, free(-40, 0), true, TUNNEL_DEPTH).ok).toBe(true);
    expect(city.buildRoad(city.net.snap({ x: -40, y: 0 }, 1, TUNNEL_DEPTH), null, free(100, 0), true, TUNNEL_DEPTH).ok).toBe(true);
    // The street at x = 0 is untouched: no junction under it
    expect([...city.net.nodes.values()].filter((n) => city.net.degree(n.id) > 2)).toHaveLength(0);
    expect(segAt(city, 50, 0).lots).toHaveLength(0);
    const from = segAt(city, -150, 0);
    const to = segAt(city, 50, 0);
    expect(city.traffic.findRoute({ seg: from.id, s: 10 }, { seg: to.id, s: 20 })).not.toBeNull();
  });

  it('cost more than elevated roads, and bulldozing hits the street above first', () => {
    const city = new City();
    const deck = city.roadCost({ x: 0, y: 0 }, null, { x: 100, y: 0 }, ELEVATED_HEIGHT, ELEVATED_HEIGHT);
    const tunnel = city.roadCost({ x: 0, y: 0 }, null, { x: 100, y: 0 }, TUNNEL_DEPTH, TUNNEL_DEPTH);
    expect(tunnel).toBeGreaterThan(deck);
    city.buildRoad(free(0, -100), null, free(0, 100), true);
    city.buildRoad(free(-100, 0), null, free(100, 0), true, TUNNEL_DEPTH);
    city.bulldoze({ x: 0, y: 0 }, 3);
    expect([...city.net.nodes.values()].every((n) => n.h === TUNNEL_DEPTH)).toBe(true);
  });
});

describe('roundabouts', () => {
  it('make a one-way ring with four exit roads', () => {
    const city = new City();
    expect(city.buildRoundabout({ x: 0, y: 0 }, 4).ok).toBe(true);
    const ring = [...city.net.segments.values()].filter((s) => s.oneway);
    const exits = [...city.net.segments.values()].filter((s) => !s.oneway);
    expect(ring).toHaveLength(4);
    expect(exits).toHaveLength(4);
    expect(ring.every((s) => s.lots.length === 0)).toBe(true);
    // Driving round: every ring piece leads into the next, anticlockwise on screen (angle decreasing)
    for (const s of ring) {
      const a = city.net.node(s.a).p;
      const b = city.net.node(s.b).p;
      const turn = Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x);
      expect(Math.atan2(Math.sin(turn), Math.cos(turn))).toBeLessThan(0);
    }
  });

  it('route traffic round the ring in one direction only', () => {
    const city = new City();
    city.buildRoundabout({ x: 0, y: 0 }, 4);
    const exits = [...city.net.segments.values()].filter((s) => !s.oneway);
    const along = (s: (typeof exits)[number]) => {
      const p = city.net.node(s.b).p;
      return Math.atan2(p.y, p.x);
    };
    // From the east exit to the north exit (y negative): anticlockwise is a quarter turn
    const east = exits.find((s) => Math.abs(along(s)) < 0.1)!;
    const north = exits.find((s) => Math.abs(along(s) + Math.PI / 2) < 0.1)!;
    const r = city.traffic.findRoute({ seg: east.id, s: east.length - 2 }, { seg: north.id, s: north.length - 2 })!;
    expect(r).not.toBeNull();
    expect(r.route.filter((l) => city.net.segments.get(l.seg)!.oneway)).toHaveLength(1);
    // The other way round takes three ring pieces, never driving against the flow
    const back = city.traffic.findRoute({ seg: north.id, s: north.length - 2 }, { seg: east.id, s: east.length - 2 })!;
    const ringLanes = [back.first, ...back.route].filter((l) => city.net.segments.get(l.seg)!.oneway);
    expect(ringLanes).toHaveLength(3);
    expect(ringLanes.every((l) => l.dir === 1)).toBe(true);
  });

  it('take over a crossroads and line up with its roads', () => {
    const city = new City();
    city.buildRoad(free(-150, 0), null, free(150, 0), true);
    city.buildRoad(free(0, -150), null, free(0, 150), true);
    expect(city.buildRoundabout({ x: 0, y: 0 }, 4).ok).toBe(true);
    // The old junction is gone and the four roads end on the ring; no extra exits were added
    expect(city.net.snap({ x: 0, y: 0 }, 5).kind).toBe('free');
    expect([...city.net.segments.values()].filter((s) => !s.oneway)).toHaveLength(4);
    expect([...city.net.segments.values()].filter((s) => s.oneway)).toHaveLength(4);
  });

  it('builds six exits and survives a save', () => {
    const city = new City();
    expect(city.buildRoundabout({ x: 0, y: 0 }, 6).ok).toBe(true);
    const copy = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    expect([...copy.net.segments.values()].filter((s) => s.oneway)).toHaveLength(6);
    expect([...copy.net.segments.values()].filter((s) => !s.oneway)).toHaveLength(6);
  });
});

describe('clearing bus lines', () => {
  it('removes every line, bus and stop', () => {
    const city = block();
    line(city, [[150, 0], [300, 150]]);
    line(city, [[150, 300], [0, 150]]);
    city.tick(rng());
    expect(city.transit.buses().length).toBeGreaterThan(0);
    city.transit.clearLines();
    expect(city.transit.lines.size).toBe(0);
    expect(city.transit.stops.size).toBe(0);
    expect(city.transit.buses()).toHaveLength(0);
  });
});

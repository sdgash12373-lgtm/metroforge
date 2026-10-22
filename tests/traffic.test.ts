import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/city';
import { Zone } from '../src/sim/zoning';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });
const segAt = (city: City, x: number, y: number) => city.net.segmentAt({ x, y }, 3)!.seg;

/** Deterministic Park–Miller generator so growth and trips are repeatable. */
function rng(seed = 7) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

describe('route finding', () => {
  it('takes the shorter way around a block', () => {
    const city = new City();
    // A square block 100 × 100 with the trip from the middle of the bottom edge to the middle of the right edge
    city.buildRoad(free(0, 0), null, free(100, 0), true);
    city.buildRoad(free(100, 0), null, free(100, 100), true);
    city.buildRoad(free(100, 100), null, free(0, 100), true);
    city.buildRoad(free(0, 100), null, free(0, 0), true);
    const from = segAt(city, 50, 100);
    const to = segAt(city, 100, 50);
    const r = city.traffic.findRoute({ seg: from.id, s: from.length / 2 }, { seg: to.id, s: to.length / 2 })!;
    expect(r).not.toBeNull();
    // Straight to the shared corner: no lanes in between
    expect(r.route).toHaveLength(1);
    expect(r.route[0].seg).toBe(to.id);
  });

  it('has no route between roads that do not touch', () => {
    const city = new City();
    city.buildRoad(free(0, 0), null, free(100, 0), true);
    city.buildRoad(free(0, 50), null, free(100, 50), true);
    const a = segAt(city, 50, 0);
    const b = segAt(city, 50, 50);
    expect(city.traffic.findRoute({ seg: a.id, s: 10 }, { seg: b.id, s: 10 })).toBeNull();
  });
});

describe('vehicles', () => {
  it('drive along their route and arrive', () => {
    const city = new City();
    city.buildRoad(free(0, 0), null, free(200, 0), true);
    city.buildRoad(free(200, 0), null, free(200, 200), true);
    const a = segAt(city, 100, 0);
    const b = segAt(city, 200, 100);
    expect(city.traffic.spawn({ seg: a.id, s: 10 }, { seg: b.id, s: 150 }, 'car', 0.5)).not.toBeNull();
    for (let i = 0; i < 600 && city.traffic.vehicles.length; i++) city.traffic.step(0.1);
    expect(city.traffic.vehicles).toHaveLength(0);
    expect(city.traffic.tripsCompleted).toBe(1);
  });

  it('queue behind each other without overlapping', () => {
    const city = new City();
    city.buildRoad(free(0, 0), null, free(400, 0), true);
    const seg = segAt(city, 200, 0);
    // Ten cars all heading for the same spot
    for (let i = 0; i < 10; i++) city.traffic.spawn({ seg: seg.id, s: 5 + i * 15 }, { seg: seg.id, s: 390 }, 'car', 0);
    for (let t = 0; t < 400; t++) {
      city.traffic.step(0.05);
      const sorted = [...city.traffic.vehicles].sort((x, y) => x.pos - y.pos);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i].pos - sorted[i - 1].pos).toBeGreaterThan(4.4);
    }
  });

  it('report congestion on a busy lane', () => {
    const city = new City();
    city.buildRoad(free(0, 0), null, free(60, 0), true);
    const seg = segAt(city, 30, 0);
    expect(city.congestion(seg)).toBe(0);
    for (let i = 0; i < 6; i++) city.traffic.spawn({ seg: seg.id, s: 2 + i * 8 }, { seg: seg.id, s: 59 }, 'car', 0);
    expect(city.congestion(seg)).toBeGreaterThan(0.5);
  });

  it('are removed with the road they drive on', () => {
    const city = new City();
    city.buildRoad(free(0, 0), null, free(200, 0), true);
    const seg = segAt(city, 100, 0);
    city.traffic.spawn({ seg: seg.id, s: 10 }, { seg: seg.id, s: 190 }, 'car', 0);
    city.bulldoze({ x: 100, y: 0 }, 3);
    expect(city.traffic.vehicles).toHaveLength(0);
  });
});

describe('outside connection', () => {
  function town() {
    const city = new City();
    city.buildRoad(free(-300, 0), null, free(0, 0), true);
    city.addOutsideConnection([...city.net.nodes.values()].find((n) => n.p.x === -300)!.id);
    city.buildRoad(free(0, 0), null, free(200, 0), true);
    // An island road nobody can drive to
    city.buildRoad(free(0, 300), null, free(200, 300), true);
    city.paint({ x: 100, y: 15 }, 40, Zone.ResidentialLow);
    city.paint({ x: 100, y: 285 }, 40, Zone.ResidentialLow);
    return city;
  }

  it('only lets buildings grow on roads that reach the highway', () => {
    const city = town();
    const r = rng();
    for (let i = 0; i < 300; i++) city.tick(r);
    const island = segAt(city, 100, 300);
    const main = segAt(city, 100, 0);
    expect(island.lots.some((l) => l.level > 0)).toBe(false);
    expect(main.lots.some((l) => l.level > 0)).toBe(true);
    expect(city.stats.disconnected).toBeGreaterThan(0);
  });

  it('cannot be bulldozed', () => {
    const city = town();
    const r = city.bulldoze({ x: -150, y: 0 }, 3);
    expect(r.ok).toBe(false);
    expect(r.reason).toBeDefined();
  });

  it('sends commuters onto the roads', () => {
    const city = town();
    const r = rng();
    let seen = 0;
    for (let i = 0; i < 300; i++) {
      city.tick(r);
      city.traffic.step(0.5);
      seen = Math.max(seen, city.traffic.vehicles.length);
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('budget', () => {
  it('collects more tax at a higher rate but lowers demand', () => {
    const make = (rate: number) => {
      const city = new City();
      city.buildRoad(free(0, 0), null, free(200, 0), true);
      city.paint({ x: 100, y: 15 }, 60, Zone.ResidentialLow);
      for (const s of city.net.segments.values()) for (const l of s.lots) if (l.zone) l.level = 2;
      city.taxes.residential = rate;
      city.tick(() => 0.99);
      return city;
    };
    const low = make(5);
    const high = make(15);
    expect(high.budget.residentialTax).toBeGreaterThan(low.budget.residentialTax);
    const demand = (rate: number) => {
      const city = new City();
      city.taxes.residential = rate;
      city.measure();
      return city.demand.R;
    };
    expect(demand(15)).toBeLessThan(demand(5));
    expect(low.budget.roadUpkeep).toBeGreaterThan(0);
  });

  it('saves outside connections and taxes', () => {
    const city = new City();
    city.buildRoad(free(0, 0), null, free(100, 0), true);
    city.addOutsideConnection([...city.net.nodes.keys()][0]);
    city.taxes = { residential: 12, business: 7 };
    const copy = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    expect([...copy.outside]).toEqual([...city.outside]);
    expect(copy.taxes).toEqual({ residential: 12, business: 7 });
  });
});

describe('gridlock', () => {
  it('lets vehicles stuck for too long give up their trips', () => {
    const city = new City();
    // A one-way-full triangle: every lane is packed and every car wants the next lane
    city.buildRoad(free(0, 0), null, free(100, 0), true);
    city.buildRoad(city.net.snap({ x: 100, y: 0 }, 1), null, free(50, 87), true);
    city.buildRoad(city.net.snap({ x: 50, y: 87 }, 1), null, city.net.snap({ x: 0, y: 0 }, 1), true);
    const sides = [segAt(city, 50, 0), segAt(city, 75, 43.5), segAt(city, 25, 43.5)];
    sides.forEach((seg, k) => {
      const next = sides[(k + 1) % 3];
      for (let i = 0; i < 15; i++) {
        const pos = seg.length - 2 - i * 6.6;
        // a → b of each side runs round the triangle the same way
        city.traffic.spawn({ seg: seg.id, s: pos }, { seg: next.id, s: next.length / 2 }, 'car', 0);
      }
    });
    expect(city.traffic.vehicles.length).toBeGreaterThan(40);
    for (let i = 0; i < 1200; i++) city.traffic.step(0.05);
    expect(city.traffic.tripsAbandoned).toBeGreaterThan(0);
  });
});

describe('traffic lights', () => {
  it('stand at crossroads, giving the two roads green in turn, but not at bends or roundabouts', () => {
    const city = new City();
    city.buildRoad(free(-200, 0), null, free(200, 0), true);
    city.buildRoad(free(0, -200), null, free(0, 200), true);
    city.buildRoad(free(200, 0), null, free(300, 100), true);
    const js = [...city.traffic.junctions().values()];
    expect(js).toHaveLength(1);
    const j = js[0];
    expect(j.approaches).toHaveLength(4);
    expect(j.phases).toBe(2);
    const ew = segAt(city, -100, 0);
    const ns = segAt(city, 0, -100);
    const lights = new Set<string>();
    for (let t = 0; t < 40; t++) {
      city.traffic.time = t;
      const a = city.traffic.lightFor(ew, ew.b === j.node ? 1 : -1);
      const b = city.traffic.lightFor(ns, ns.b === j.node ? 1 : -1);
      // Never green both ways at once
      expect(a === 'red' || b === 'red').toBe(true);
      lights.add(`${a}`).add(`${b}`);
    }
    expect([...lights].sort()).toEqual(['green', 'red', 'yellow']);
  });

  it('hold cars at the stop line on red and let them go on green', () => {
    const city = new City();
    city.buildRoad(free(-200, 0), null, free(200, 0), true);
    city.buildRoad(free(0, -200), null, free(0, 200), true);
    const from = segAt(city, -100, 0);
    const to = segAt(city, 100, 0);
    const j = [...city.traffic.junctions().values()][0];
    const dir = from.b === j.node ? 1 : -1;
    // Start just as the east-west road turns red
    city.traffic.time = 0;
    while (city.traffic.lightFor(from, dir) !== 'red') city.traffic.time += 0.5;
    const v = city.traffic.spawn({ seg: from.id, s: from.length - 40 }, { seg: to.id, s: to.length / 2 }, 'car', 0)!;
    expect(v).not.toBeNull();
    let held = 0;
    for (let i = 0; i < 400 && v.seg === from.id; i++) {
      if (city.traffic.lightFor(from, dir) === 'red' && v.seg === from.id && v.speed < 1 && v.pos > from.length - 12) held++;
      city.traffic.step(0.1);
      if (city.traffic.lightFor(from, dir) === 'red') expect(v.seg).toBe(from.id);
    }
    expect(held).toBeGreaterThan(10);
    expect(v.seg).toBe(to.id);
    expect(v.stuck).toBe(0);
  });
});

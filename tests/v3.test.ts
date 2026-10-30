import { describe, expect, it } from 'vitest';
import { City, FOREST_REACH, GOODS_PER_JOB, PORT_CAPACITY, REGION_COST, TRADE_SHARE, budgetTotals, freewayTown } from '../src/sim/city';
import { FACILITIES } from '../src/sim/facilities';
import { UNLOCK } from '../src/sim/levels';
import { FLAT_CLASSIC, KAOHSIUNG, KAOHSIUNG_CLASSIC } from '../src/sim/terrain';
import { ZONES, Zone } from '../src/sim/zoning';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });
const at = (u: number, v: number) => ({ x: (u + v) * Math.SQRT1_2, y: (v - u) * Math.SQRT1_2 });
const T = KAOHSIUNG;

function rng(seed = 7) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

const lots = (city: City) => [...city.net.segments.values()].flatMap((s) => s.lots);

/** The coast's u at v: the first sea going out from the plain. */
function coastU(v: number): number {
  let u = -600;
  while (!T.sea(at(u, v).x, at(u, v).y)) u -= 2;
  return u;
}

/** A city on the Kaohsiung coast with a street along the shore, and a cargo port on it if one fits. */
function harbour(kind: 'cargoPort' | 'cruisePort' = 'cargoPort'): { city: City; port: ReturnType<City['buildFacility']> } {
  for (let v = -1600; v < 800; v += 40) {
    const city = new City(T);
    city.money = 1e9;
    const c = Math.max(coastU(v - 100), coastU(v), coastU(v + 100));
    const a = at(c + 45, v - 160);
    const b = at(c + 45, v + 160);
    if (!city.buildRoad(free(a.x, a.y), null, free(b.x, b.y), true).ok) continue;
    city.addOutsideConnection([...city.net.nodes.values()][0].id);
    const tap = at(c + 20, v);
    const spot = city.facilitySpot(kind, tap);
    const port = city.buildFacility(kind, spot.p, spot.angle);
    if (port.ok) return { city, port };
  }
  throw new Error('no harbour site found');
}

describe('regions', () => {
  it('keeps Pingtung shut until a 縣轄市 pays to open it, then lays 國道 3 號 there', () => {
    const city = new City(T);
    city.money = 1e8;
    city.buildFreeway();
    const p = at(0, 1600);
    const q = at(100, 1600);
    const r = city.buildRoad(free(p.x, p.y), null, free(q.x, q.y));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('屏東區尚未開通');
    expect(city.occupied(p)).toBe(true);
    expect(city.openRegion('pingtung').ok).toBe(false);
    city.level = UNLOCK.region;
    const before = city.money;
    expect(city.openRegion('pingtung').ok).toBe(true);
    expect(before - city.money).toBe(REGION_COST);
    // Both ends of 國道 1 號 and 國道 3 號, and 國道 10 號 on towards 旗山
    expect(city.outside.size).toBe(5);
    expect(city.disconnectedRoads()).toHaveLength(0);
    expect(city.buildRoad(free(p.x, p.y), null, free(q.x, q.y)).ok).toBe(true);
    expect(city.openRegion('pingtung').ok).toBe(false);
    const copy = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    expect([...copy.regions].sort()).toEqual(['kaohsiung', 'pingtung']);
  });

  it('loads saves from before regions with Kaohsiung only', () => {
    const city = new City(T);
    const old = { ...city.serialize(), v: 8, regions: undefined };
    expect([...City.deserialize(old).regions]).toEqual(['kaohsiung']);
  });

  it('keeps what old saves built beyond the Gaoping River on the ground they were built on', () => {
    // Built on the old map, where Kaohsiung's ground ran on across the river
    const city = new City(KAOHSIUNG_CLASSIC);
    city.money = 1e9;
    city.regions = new Set(['kaohsiung', 'pingtung']);
    expect(T.region(1170, 1890)).toBe('pingtung');
    expect(city.buildRoad(free(1170, 1890), null, free(1260, 1970), true).ok).toBe(true);
    city.paint({ x: 1215, y: 1930 }, 60, Zone.ResidentialLow);
    for (const l of lots(city)) if (l.zone && !l.blocked) l.level = 2;
    const built = lots(city).filter((l) => l.level === 2).length;
    expect(built).toBeGreaterThan(0);
    const old = { ...city.serialize(), v: 8, terrain: 'kaohsiung' as const, regions: undefined };
    const copy = City.deserialize(old);
    expect(copy.terrain).toBe(KAOHSIUNG_CLASSIC);
    expect([...copy.regions].sort()).toEqual(['kaohsiung', 'pingtung']);
    expect(lots(copy).filter((l) => l.level === 2).length).toBe(built);
    // and keeps that ground from then on
    expect(City.deserialize(copy.serialize()).terrain).toBe(KAOHSIUNG_CLASSIC);
    // Old saves that stayed on the Kaohsiung side get the new map
    expect(City.deserialize({ ...new City(T).serialize(), v: 8, regions: undefined }).terrain).toBe(T);
  });

  it('keeps what old saves built past the edge of the map', () => {
    for (const [classic, name, a, b] of [
      [FLAT_CLASSIC, 'flat', free(1970, 0), free(2090, 0)],
      [KAOHSIUNG_CLASSIC, 'kaohsiung', free(-1600, -1970), free(-1600, -2090)],
    ] as const) {
      const city = new City(classic);
      city.money = 1e9;
      expect(city.buildRoad(a, null, b, true).ok).toBe(true);
      city.paint({ x: (a.p.x + b.p.x) / 2, y: (a.p.y + b.p.y) / 2 }, 60, Zone.ResidentialLow);
      for (const l of lots(city)) if (l.zone && !l.blocked) l.level = 2;
      const built = lots(city).filter((l) => l.level === 2).length;
      expect(built).toBeGreaterThan(0);
      const copy = City.deserialize({ ...city.serialize(), v: 8, terrain: name, regions: undefined });
      expect(copy.terrain).toBe(classic);
      expect(lots(copy).filter((l) => l.level === 2).length).toBe(built);
    }
  });

  it('can start in Pingtung with Kaohsiung locked', () => {
    const city = new City(T);
    city.regions = new Set(['pingtung']);
    city.buildFreeway('pingtung');
    expect(city.disconnectedRoads()).toHaveLength(0);
    expect(city.occupied(freewayTown('pingtung'))).toBe(false);
    const r = city.buildRoad(free(0, 0), null, free(100, 0));
    expect(r.reason).toContain('高雄區尚未開通');
  });
});

describe('industry kinds', () => {
  it('only lets 林業 be zoned near forested hills', () => {
    const city = new City(T);
    city.money = 1e8;
    // Out on the open plain
    city.buildRoad(free(-200, 0), null, free(200, 0), true);
    expect(city.paint({ x: 0, y: 12 }, 60, Zone.Forestry)).toBe(0);
    expect(city.paint({ x: 0, y: 12 }, 60, Zone.Industrial)).toBeGreaterThan(0);
    // At the foot of the hills, inland
    let u = 200;
    while (!city.nearForest(at(u, -300))) u += 10;
    const a = at(u + FOREST_REACH / 2, -400);
    const b = at(u + FOREST_REACH / 2, -200);
    expect(city.buildRoad(free(a.x, a.y), null, free(b.x, b.y), true).ok).toBe(true);
    expect(city.paint(at(u + FOREST_REACH / 2, -300), 60, Zone.Forestry)).toBeGreaterThan(0);
  });

  it('makes chemical plants foul the homes around them', () => {
    const grow = (chemical: boolean) => {
      const city = new City();
      city.money = 1e8;
      city.buildRoad(free(-300, 0), null, free(300, 0), true);
      city.addOutsideConnection([...city.net.nodes.values()][0].id);
      for (const k of ['park', 'school', 'police'] as const) {
        const s = city.facilitySpot(k, { x: -150 + ['park', 'school', 'police'].indexOf(k) * 90, y: -30 });
        city.buildFacility(k, s.p, s.angle);
      }
      city.paint({ x: 0, y: 20 }, 40, Zone.ResidentialLow);
      city.paint({ x: 200, y: 20 }, 40, chemical ? Zone.Chemical : Zone.Industrial);
      const r = rng();
      for (let i = 0; i < 3000; i++) city.tick(r);
      return city;
    };
    const clean = grow(false);
    const dirty = grow(true);
    expect(dirty.needs.polluted).toBeGreaterThan(0);
    expect(clean.needs.polluted).toBe(0);
    expect(dirty.needs.happiness).toBeLessThan(clean.needs.happiness);
  });

  it('keeps science parks small without a school', () => {
    const city = new City();
    city.money = 1e8;
    city.buildRoad(free(-300, 0), null, free(300, 0), true);
    city.paint({ x: 0, y: 12 }, 30, Zone.SciencePark);
    const lot = lots(city).find((l) => l.zone === Zone.SciencePark)!;
    expect(city.levelCap(lot)).toBe(1);
    const s = city.facilitySpot('school', { x: 100, y: -30 });
    expect(city.buildFacility('school', s.p, s.angle).ok).toBe(true);
    expect(city.levelCap(lot)).toBe(ZONES[Zone.SciencePark].maxLevel);
  });

  it('keeps the new zones through a save', () => {
    const city = new City();
    city.buildRoad(free(-100, 0), null, free(100, 0), true);
    city.paint({ x: 0, y: 12 }, 30, Zone.IndustrialPark);
    const copy = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    expect(lots(copy).some((l) => l.zone === Zone.IndustrialPark)).toBe(true);
  });
});

describe('ports', () => {
  it('only go on the coastline, never inland or on a river', () => {
    const { port } = harbour();
    expect(port.ok).toBe(true);
    const city = new City(T);
    city.money = 1e9;
    city.buildRoad(free(-200, 0), null, free(200, 0), true);
    const spot = city.facilitySpot('cargoPort', { x: 0, y: 40 });
    expect(city.buildFacility('cargoPort', spot.p, spot.angle).reason).toContain('海岸線');
  });

  it('ship connected industry abroad for 外貿收入, up to what the ports can handle', () => {
    const { city } = harbour();
    const road = [...city.net.segments.values()][0];
    const mid = road.samples[Math.floor(road.samples.length / 2)];
    city.paint(mid, 400, Zone.Processing);
    for (const l of lots(city)) if (l.zone === Zone.Processing) l.level = 3;
    city.tick(rng());
    const t = city.trade;
    expect(t.ports).toBe(1);
    expect(t.reachable).toBeGreaterThan(0);
    expect(t.shipped).toBe(Math.min(t.reachable, PORT_CAPACITY));
    expect(city.budget.trade).toBeCloseTo(t.shipped * TRADE_SHARE, -1);
    expect(budgetTotals(city.budget).other).toBeGreaterThanOrEqual(city.budget.trade);
    const jobs = lots(city).filter((l) => l.zone === Zone.Processing && !l.blocked).length * 3 * ZONES[Zone.Processing].perLevel;
    expect(t.goods).toBeCloseTo(jobs * ZONES[Zone.Processing].goods! * GOODS_PER_JOB, -1);
    const copy = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    expect([...copy.facilities.values()].some((f) => f.kind === 'cargoPort')).toBe(true);
  });

  it('only ship through ports on the same road network as the industry', () => {
    const { city } = harbour();
    const road = [...city.net.segments.values()][0];
    // Streets of fabs running inland from the port's street, as far as the plain goes
    for (const t of [0.15, 0.5, 0.85]) {
      const from = road.samples[Math.floor(road.samples.length * t)];
      for (let len = 900; len >= 200; len -= 50) {
        const to = { x: from.x + len * Math.SQRT1_2, y: from.y - len * Math.SQRT1_2 };
        if (!city.buildRoad(city.net.snapLevel(from, 10, 0), null, free(to.x, to.y), true).ok) continue;
        for (let k = 0; k * 60 <= len; k++) city.paint({ x: from.x + k * 60 * Math.SQRT1_2, y: from.y - k * 60 * Math.SQRT1_2 }, 50, Zone.SciencePark);
        break;
      }
    }
    for (const l of lots(city)) if (l.zone === Zone.SciencePark) l.level = 4;
    city.tick(rng());
    const one = city.trade;
    expect(one.reachable).toBeGreaterThan(PORT_CAPACITY);
    expect(one.shipped).toBe(PORT_CAPACITY);
    // A second port on a street of its own further up the coast adds nothing for that industry
    const far = road.samples[0];
    for (let v = 400; v < 2000; v += 40) {
      const c = Math.max(coastU(v - 100), coastU(v), coastU(v + 100));
      const a = at(c + 45, v - 160);
      const b = at(c + 45, v + 160);
      if (Math.hypot(a.x - far.x, a.y - far.y) < 600) continue;
      if (!city.buildRoad(free(a.x, a.y), null, free(b.x, b.y), true).ok) continue;
      const spot = city.facilitySpot('cargoPort', at(c + 20, v));
      if (city.buildFacility('cargoPort', spot.p, spot.angle).ok) break;
    }
    city.tick(rng());
    expect(city.trade.ports).toBe(2);
    expect(city.trade.shipped).toBe(PORT_CAPACITY);
  });

  it('bring ferry tourists with a cruise port', () => {
    const { city } = harbour('cruisePort');
    city.tick(rng());
    const withPort = city.needs.tourists;
    city.removeFacility([...city.facilities.values()][0].id);
    city.tick(rng());
    expect(withPort).toBeGreaterThan(city.needs.tourists);
    expect(FACILITIES.cruisePort.tourists).toBeGreaterThan(0);
  });
});

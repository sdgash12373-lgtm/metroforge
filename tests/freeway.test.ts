import { describe, expect, it } from 'vitest';
import { City, FREEWAY } from '../src/sim/city';
import { ELEVATED_HEIGHT } from '../src/sim/roads';
import { TERRAINS } from '../src/sim/terrain';
import { Zone } from '../src/sim/zoning';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

function rng(seed = 3) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

function fresh(terrain: 'flat' | 'plain' | 'kaohsiung' = 'flat'): City {
  const city = new City(TERRAINS[terrain]);
  city.money = 1e7;
  city.buildFreeway();
  return city;
}

describe('the freeway a new city starts with', () => {
  it('runs north–south on viaducts, two lanes each way, carried on to the edge of the land at both ends', () => {
    for (const terrain of ['flat', 'plain', 'kaohsiung'] as const) {
      const city = fresh(terrain);
      // On the Kaohsiung map 國道 3 號 and 10 號 lead out too
      expect(city.outside.size).toBe(terrain === 'kaohsiung' ? 5 : 2);
      const all = [...city.outside].map((n) => city.net.node(n));
      expect(all.every((n) => n.h === ELEVATED_HEIGHT)).toBe(true);
      const ends = all.filter((n) => n.p.x === FREEWAY.x);
      expect(ends).toHaveLength(2);
      const [north, south] = ends.sort((a, b) => a.p.y - b.p.y);
      expect(north.p.x).toBe(FREEWAY.x);
      expect(north.p.y).toBeLessThan(FREEWAY.north);
      expect(south.p.y).toBeGreaterThan(FREEWAY.south);
      const main = [...city.net.segments.values()].filter((s) => s.highway && s.name === FREEWAY.name);
      expect(main.length).toBeGreaterThanOrEqual(3);
      expect(main.every((s) => s.lanes === 2 && s.lots.length === 0)).toBe(true);
      expect(city.disconnectedRoads()).toHaveLength(0);
    }
  });

  it('comes down at a diverging diamond interchange to an access road into town that can be zoned', () => {
    const city = fresh();
    expect([...city.net.segments.values()].filter((s) => s.highway && s.name !== FREEWAY.name)).toHaveLength(0);
    expect([...city.net.segments.values()].filter((s) => s.ramp).length).toBeGreaterThanOrEqual(12);
    const access = city.net.segmentAt(FREEWAY.town, 3, 0)!.seg;
    expect(access.highway).toBeFalsy();
    expect(access.lanes).toBe(2);
    expect(access.lots.length).toBeGreaterThan(0);
  });

  it('can only be joined at the interchange; roads may pass over or under it', () => {
    const city = fresh();
    const x = FREEWAY.x;
    // Onto the main line, or crossing it on a viaduct at its level
    expect(city.buildRoad(free(x + 100, -400), null, city.net.snap({ x, y: -400 }, 2)).ok).toBe(false);
    expect(city.buildRoad(free(x + 100, -500), null, free(x - 100, -500), false, ELEVATED_HEIGHT).reason).toContain('交流道');
    // Under it at street level
    expect(city.buildRoad(free(x + 100, -400), null, free(x - 100, -400)).ok).toBe(true);
    // From the end of the access road into town
    const town = city.net.snap(FREEWAY.town, 1, 0);
    expect(town.kind).toBe('node');
    expect(city.buildRoad(town, null, free(0, 0)).ok).toBe(true);
    expect(city.disconnectedRoads().some((s) => city.net.node(s.b).p.x === 0)).toBe(false);
  });

  it('cannot be torn down or rebuilt, and is still the freeway after a save', () => {
    const city = fresh();
    city.level = 4;
    const seg = city.net.segmentAt({ x: FREEWAY.x, y: -500 }, 3)!.seg;
    expect(city.bulldoze({ x: FREEWAY.x, y: -500 }, 3).ok).toBe(false);
    expect(city.restyleRoad(seg.id, { lanes: 4 }).ok).toBe(false);
    const back = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    const again = back.net.segments.get(seg.id)!;
    expect(again.highway).toBe(true);
    expect(again.lanes).toBe(2);
    expect(back.bulldoze({ x: FREEWAY.x, y: -500 }, 3).ok).toBe(false);
  });

  it('brings people in to zoning along the access road', () => {
    const city = fresh();
    city.paint({ x: -420, y: 25 }, 60, Zone.ResidentialLow);
    city.paint({ x: -420, y: -25 }, 60, Zone.Commercial);
    const r = rng();
    for (let i = 0; i < 3000; i++) city.tick(r);
    expect(city.stats.population).toBeGreaterThan(0);
  });
});

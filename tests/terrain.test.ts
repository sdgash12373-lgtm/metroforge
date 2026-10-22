import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/city';
import { TUNNEL_DEPTH, ELEVATED_HEIGHT } from '../src/sim/roads';
import { KAOHSIUNG, buildable } from '../src/sim/terrain';
import { Zone } from '../src/sim/zoning';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });
/** Turned axes: u inland (north-east), v along the coast (south-east). */
const at = (u: number, v: number) => ({ x: (u + v) * Math.SQRT1_2, y: (v - u) * Math.SQRT1_2 });

describe('Kaohsiung terrain', () => {
  it('has sea in the south-west, a plain round the start and mountains in the north-east', () => {
    expect(KAOHSIUNG.water(at(-1600, 0).x, at(-1600, 0).y)).toBe(true);
    expect(buildable(KAOHSIUNG, { x: 0, y: 0 })).toBe(true);
    expect(buildable(KAOHSIUNG, { x: -480, y: 60 })).toBe(true);
    const peak = at(2400, 0);
    expect(KAOHSIUNG.height(peak.x, peak.y)).toBeGreaterThan(200);
    // Higher the further inland
    const h = [700, 1300, 1900, 2500].map((u) => KAOHSIUNG.height(at(u, -300).x, at(u, -300).y));
    expect(h[3]).toBeGreaterThan(h[1]);
    expect(h[1]).toBeGreaterThan(0);
    // A river along the south-east side
    expect([...Array(60).keys()].some((i) => KAOHSIUNG.water(at(0, 900 + i * 5).x, at(0, 900 + i * 5).y))).toBe(true);
  });

  it('keeps streets and zoning on dry flat land, lets viaducts cross water and tunnels go under hills', () => {
    const city = new City(KAOHSIUNG);
    city.money = 1e7;
    const shore = at(-900, 0);
    const sea = at(-1500, 0);
    expect(city.buildRoad(free(shore.x, shore.y), null, free(sea.x, sea.y)).ok).toBe(false);
    expect(city.buildRoad(free(shore.x, shore.y), null, free(sea.x, sea.y), false, ELEVATED_HEIGHT).ok).toBe(true);
    const plain = at(300, 0);
    const mountain = at(1400, 0);
    const r = city.buildRoad(free(plain.x, plain.y), null, free(mountain.x, mountain.y));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('山');
    expect(city.buildRoad(free(plain.x, plain.y), null, free(mountain.x, mountain.y), false, TUNNEL_DEPTH).ok).toBe(true);
    // Lots that would stand in the sea are blocked
    const coast = at(-1150, 300);
    city.buildRoad(free(at(-1050, 200).x, at(-1050, 200).y), null, free(at(-1050, 400).x, at(-1050, 400).y));
    city.paint(coast, 200, Zone.ResidentialLow);
    const lots = [...city.net.segments.values()].flatMap((s) => s.lots);
    for (const l of lots) if (KAOHSIUNG.water(l.x, l.y)) expect(l.blocked).toBe(true);
  });

  it('is kept by a save, and old saves stay flat', () => {
    const city = new City(KAOHSIUNG);
    const copy = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    expect(copy.terrain.name).toBe('kaohsiung');
    const old = { ...city.serialize(), v: 4, terrain: undefined };
    expect(City.deserialize(old).terrain.name).toBe('flat');
  });
});

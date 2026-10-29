import { describe, expect, it } from 'vitest';
import { City, FREEWAY } from '../src/sim/city';
import { FLAT, PLAIN, buildable } from '../src/sim/terrain';
import { Zone } from '../src/sim/zoning';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

describe('the 平地 map', () => {
  it('keeps open plain round the start, with mountains in the north-east, a river, a lake and sea to the west and south', () => {
    // The freeway, its ramps and the town around the access road stay on dry flat land
    for (let y = FREEWAY.north; y <= FREEWAY.south; y += 20) {
      for (let x = -900; x <= 100; x += 20) expect(buildable(PLAIN, { x, y })).toBe(true);
    }
    expect(PLAIN.height(1700, -1800)).toBeGreaterThan(300);
    expect(PLAIN.height(-1000, -1800)).toBe(0);
    expect(PLAIN.sea(-1900, 0) && PLAIN.sea(0, 1900)).toBe(true);
    expect(PLAIN.sea(-500, -1000) || PLAIN.sea(1000, 1000)).toBe(false);
    // A river crosses the plain from the mountains, not the sea
    for (const y of [-1500, -500, 500, 1300]) {
      const xs = [...Array(400).keys()].map((i) => -600 + i * 5);
      expect(xs.some((x) => PLAIN.water(x, y) && !PLAIN.sea(x, y))).toBe(true);
    }
    expect(PLAIN.water(-1020, 980) && !PLAIN.sea(-1020, 980)).toBe(true);
    // The river bends east round the plain south of town, where old flat cities put airports
    for (let y = 680; y <= 940; y += 10) for (let x = -480; x <= 150; x += 10) expect(buildable(PLAIN, { x, y })).toBe(true);
  });

  it('starts new cities on the freeway, and moves old flat cities onto it when everything they built fits', () => {
    const city = new City(PLAIN);
    city.money = 1e7;
    city.buildFreeway();
    expect(city.disconnectedRoads()).toHaveLength(0);
    expect(city.buildRoad(free(-300, 0), null, free(-300, -300), true).ok).toBe(true);
    expect(City.deserialize(city.serialize()).terrain).toBe(PLAIN);

    // Built only on what is still plain: the city moves onto the new map
    const town = new City(FLAT);
    town.money = 1e7;
    town.buildFreeway();
    expect(town.buildRoad(free(-300, 0), null, free(-300, -400), true).ok).toBe(true);
    const moved = City.deserialize(town.serialize());
    expect(moved.terrain).toBe(PLAIN);
    expect(moved.net.segments.size).toBe(town.net.segments.size);

    // A street where the mountains now are, or across the river: it keeps the flat ground
    for (const [a, b] of [[free(1700, -1800), free(1700, -1500)], [free(0, 300), free(800, 300)]]) {
      const old = new City(FLAT);
      old.money = 1e7;
      expect(old.buildRoad(a, null, b, true).ok).toBe(true);
      const back = City.deserialize(old.serialize());
      expect(back.terrain).toBe(FLAT);
      expect(back.net.segments.size).toBe(old.net.segments.size);
    }
  });

  it('keeps flat ground for a city whose buildings stand where the lake now is, even with its roads on dry land', () => {
    const old = new City(FLAT);
    old.money = 1e7;
    expect(old.buildRoad(free(-1150, 840), null, free(-900, 840), true).ok).toBe(true);
    expect(buildable(PLAIN, { x: -1150, y: 840 }) && buildable(PLAIN, { x: -900, y: 840 })).toBe(true);
    // Offices already grown beside it, on what is now the lake shore
    for (const seg of old.net.segments.values()) for (const l of seg.lots) if (l.side > 0) Object.assign(l, { zone: Zone.Office, level: 1 });
    const wet = () => [...old.net.segments.values()].flatMap((s) => s.lots).filter((l) => l.level > 0 && !buildable(PLAIN, l)).length;
    const before = wet();
    expect(before).toBeGreaterThan(0);
    const back = City.deserialize(JSON.parse(JSON.stringify(old.serialize())));
    expect(back.terrain).toBe(FLAT);
    expect([...back.net.segments.values()].flatMap((s) => s.lots).filter((l) => l.level > 0 && !buildable(PLAIN, l)).length).toBe(before);
  });
});

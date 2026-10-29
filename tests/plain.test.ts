import { describe, expect, it } from 'vitest';
import { City, FREEWAY } from '../src/sim/city';
import { FLAT, PLAIN, buildable } from '../src/sim/terrain';

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
  });

  it('starts new cities on the freeway, and old flat saves stay flat', () => {
    const city = new City(PLAIN);
    city.money = 1e7;
    city.buildFreeway();
    expect(city.disconnectedRoads()).toHaveLength(0);
    expect(city.buildRoad(free(-300, 0), null, free(-300, -300), true).ok).toBe(true);
    expect(City.deserialize(city.serialize()).terrain).toBe(PLAIN);

    const old = new City(FLAT);
    old.money = 1e7;
    expect(old.buildRoad(free(1700, -1800), null, free(1700, -1500), true).ok).toBe(true);
    const back = City.deserialize(old.serialize());
    expect(back.terrain).toBe(FLAT);
    expect(back.net.segments.size).toBe(old.net.segments.size);
  });
});

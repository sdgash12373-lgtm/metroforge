import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/city';
import { UNLOCK } from '../src/sim/levels';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

/** A two-lane avenue running east, crossed at x = 0 by a narrow street. */
function avenue(): City {
  const city = new City();
  city.money = 1e9;
  city.level = UNLOCK.roadUpgrade;
  city.buildRoad(free(-300, 0), null, free(300, 0), true);
  city.buildRoad(free(0, -150), null, free(0, 150), true);
  const west = city.net.segmentAt({ x: -150, y: 0 }, 3)!.seg;
  city.restyleRoad(west.id, { lanes: 2 });
  return city;
}
const seg = (city: City, x: number, y: number) => city.net.segmentAt({ x, y }, 3)!.seg;

describe('multi-lane roads', () => {
  it('spread straight-on traffic over every lane and keep a car in its lane from road to road', () => {
    const city = avenue();
    const west = seg(city, -150, 0);
    const east = seg(city, 150, 0);
    expect(west.lanes).toBe(2);
    expect(east.lanes).toBe(2);
    const t = city.traffic;
    const cars = [0.1, 0.35, 0.6, 0.85].map((tint, i) => t.spawn({ seg: west.id, s: 20 + i * 40 }, { seg: east.id, s: east.length - 5 }, 'car', tint)!);
    expect(new Set(cars.map((v) => v.sub))).toEqual(new Set([0, 1]));
    // The lane each car is in as it drives onto the next road (it pulls over to the kerb later, to stop)
    const entered = new Map<number, number | undefined>();
    for (let i = 0; i < 600 && entered.size < cars.length; i++) {
      t.step(0.1);
      for (const v of cars) if (v.seg === east.id && !entered.has(v.id)) entered.set(v.id, v.sub);
    }
    expect(new Set(entered.values())).toEqual(new Set([0, 1]));
  });

  it('keep a car on its own in the inside lane when it drives straight on', () => {
    const city = avenue();
    const west = seg(city, -150, 0);
    const east = seg(city, 150, 0);
    const t = city.traffic;
    const tint = [0.1, 0.35, 0.6, 0.85].find((x) => Math.floor(x * 997) % 2 === 1)!;
    const v = t.spawn({ seg: west.id, s: 100 }, { seg: east.id, s: east.length - 5 }, 'car', tint)!;
    expect(v.sub).toBe(1);
    // Straight to the stop, not past it and back
    expect(v.route).toEqual([{ seg: east.id, dir: 1 }]);
    for (let i = 0; i < 600 && v.seg !== east.id; i++) t.step(0.1);
    expect(v.seg).toBe(east.id);
    expect(v.sub).toBe(1);
  });

  it('move to the inside lane before turning left and to the kerb before turning right', () => {
    const city = avenue();
    const west = seg(city, -150, 0);
    // North is −y: heading east, left is north
    const north = seg(city, 0, -75);
    const south = seg(city, 0, 75);
    const t = city.traffic;
    const left = t.spawn({ seg: west.id, s: 30 }, { seg: north.id, s: 20 }, 'car', 0.1)!;
    const right = t.spawn({ seg: west.id, s: 90 }, { seg: south.id, s: south.length - 20 }, 'car', 0.35)!;
    for (let i = 0; i < 100; i++) t.step(0.1);
    expect(left.seg).toBe(west.id);
    expect(left.sub).toBe(1);
    expect(right.sub).toBe(0);
    // Drawn part way across at first, then fully in the new lane
    expect(left.lat).toBeCloseTo(1, 5);
  });

  it('let the patrol car turn round on the spot into the inside lane the other way', () => {
    const city = avenue();
    const west = seg(city, -150, 0);
    const t = city.traffic;
    const car = t.spawnPlayer(west, 1, 100);
    const p0 = t.pose(car)!;
    expect(t.uTurn(car)).toBe(true);
    expect(car.dir).toBe(-1);
    expect(car.sub).toBe(1);
    // Starts where it was, then drifts over
    const p1 = t.pose(car)!;
    expect(Math.hypot(p1.p.x - p0.p.x, p1.p.y - p0.p.y)).toBeLessThan(0.01);
    expect(p1.heading.x).toBeLessThan(0);
  });
});

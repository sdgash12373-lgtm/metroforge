import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/city';
import { closestOnSamples } from '../src/sim/geometry';
import { asphaltWidth } from '../src/sim/roads';
import { CAR_LINE, CROSSWALK, SCOOTER_LINE, findJunctions } from '../src/sim/signals';
import { Zone } from '../src/sim/zoning';
import { entranceSpot } from '../src/render/stations';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

function crossroads(): City {
  const city = new City();
  city.money = 1e9;
  city.buildRoad(free(-200, 0), null, free(200, 0), true);
  city.buildRoad(free(0, -200), null, free(0, 200), true);
  return city;
}

/** Distance from a point to the nearest asphalt edge (negative when on the asphalt). */
const offAsphalt = (city: City, p: { x: number; y: number }) =>
  Math.min(...[...city.net.segments.values()].map((s) => closestOnSamples(s.samples, p).d - asphaltWidth(s) / 2));

describe('metro entrances', () => {
  it('stand beside the street, not on it, when the station is under a road', () => {
    const city = crossroads();
    for (const want of [
      { x: 40, y: 0 },
      { x: 0, y: -60 },
      { x: 3, y: 3 },
    ]) {
      const spot = entranceSpot(city.net, want)!;
      expect(spot).not.toBeNull();
      expect(offAsphalt(city, spot)).toBeGreaterThan(1.8);
      expect(Math.hypot(spot.x - want.x, spot.y - want.y)).toBeLessThan(20);
    }
  });

  it('still keep off the roads when every lot is zoned', () => {
    const city = crossroads();
    city.paint({ x: 0, y: 0 }, 300, Zone.Commercial);
    const spot = entranceSpot(city.net, { x: 40, y: 0 })!;
    expect(offAsphalt(city, spot)).toBeGreaterThan(1.8);
  });

  it('keep two entrances of one station apart', () => {
    const city = crossroads();
    const a = entranceSpot(city.net, { x: 40, y: 0 })!;
    const b = entranceSpot(city.net, { x: 40, y: 0 }, [a])!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(12);
  });
});

describe('junction paint', () => {
  it('has cars wait behind their stop line and scooters ahead of them, both behind the crossing', () => {
    const j = [...findJunctions(crossroads().net).values()][0];
    expect(j.scooterBack).toBeGreaterThan(j.edge + CROSSWALK[1]);
    expect(j.scooterBack).toBeLessThan(j.edge + CAR_LINE);
    expect(j.stopBack).toBeGreaterThan(j.edge + CAR_LINE);
    expect(SCOOTER_LINE).toBeGreaterThan(CROSSWALK[1]);
  });
});

import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/city';
import { closestOnSamples } from '../src/sim/geometry';
import { asphaltWidth } from '../src/sim/roads';
import { CAR_LINE, CROSSWALK, SCOOTER_LINE, findJunctions } from '../src/sim/signals';
import { Zone } from '../src/sim/zoning';
import { entranceSpot } from '../src/render/stations';
import { stationCovers, stationSide } from '../src/sim/stations';

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

  it('never go inside a facility on a roadside lot', () => {
    const city = new City();
    city.money = 1e9;
    city.buildRoad(free(-200, 0), null, free(200, 0), true);
    const spot = city.facilitySpot('police', { x: 40, y: 22 });
    const police = city.buildFacility('police', spot.p, spot.angle, true).facility!;
    const at = entranceSpot(city.net, { x: 40, y: 4 })!;
    const blocked = city.net.segments.values().next().value!.lots.filter((l) => l.blocked);
    expect(blocked.length).toBeGreaterThan(0);
    // Not on any lot the station blocks
    for (const l of blocked) expect(Math.hypot(l.x - at.x, l.y - at.y)).toBeGreaterThan(3);
    expect(Math.hypot(police.p.x - at.x, police.p.y - at.y)).toBeGreaterThan(10);
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

describe('train stations', () => {
  it('put the station building on the side of the tracks where the streets are', () => {
    const city = new City();
    city.money = 1e9;
    // Streets to the east of a north-south line at x = 0
    city.buildRoad(free(60, -200), null, free(60, 200), true);
    const north = { x: 0, y: -1 };
    const south = { x: 0, y: 1 };
    // Heading north (-y), the frame's +v points east (+x), towards the town; heading south it points away
    expect(stationSide(city.net, 'train', { p: { x: 0, y: 0 }, d: north, h: 0 })).toBe(1);
    expect(stationSide(city.net, 'train', { p: { x: 0, y: 0 }, d: south, h: 0 })).toBe(-1);
  });

  it('keep the building off a road that runs right beside the track', () => {
    const city = new City();
    city.money = 1e9;
    // A street 16 m east of a north-south line, where the building would stand, and none to the west
    city.buildRoad(free(16, -200), null, free(16, 200), true);
    expect(stationSide(city.net, 'train', { p: { x: 0, y: 0 }, d: { x: 0, y: -1 }, h: 0 })).toBe(-1);
  });

  it('clear the houses from the ground a station stands on', () => {
    const city = new City();
    city.money = 1e9;
    // Houses along a street 40 m north of the line; the station building reaches about 25 m towards it
    city.buildRoad(free(-300, -40), null, free(300, -40), true);
    city.paint({ x: 0, y: -20 }, 60, Zone.ResidentialLow);
    for (const seg of city.net.segments.values()) for (const l of seg.lots) if (l.zone !== Zone.None && !l.blocked) l.level = 2;
    expect(city.buildTrack('train', free(-300, 0), null, free(300, 0), 0, true).ok).toBe(true);
    const sys = city.rails.train;
    const stops = [-200, 0, 200].map((x) => sys.transit.stopAt({ x, y: 0 }, 12)!.id);
    expect(city.createLine(sys.transit, stops).ok).toBe(true);
    city.tick(() => 0.5);
    const [spot] = city.stationSpots().filter((s) => Math.abs(s.pose.p.x) < 1);
    const lots = [...city.net.segments.values()].flatMap((s) => s.lots);
    const under = lots.filter((l) => stationCovers('train', spot.pose, spot.side, l, 0));
    expect(under.length).toBeGreaterThan(0);
    for (const l of under) {
      expect(l.blocked).toBe(true);
      expect(l.level).toBe(0);
    }
  });
});

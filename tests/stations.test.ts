import { describe, expect, it } from 'vitest';
import { City, EXIT_CELLS } from '../src/sim/city';
import { closestOnSamples } from '../src/sim/geometry';
import { ELEVATED_HEIGHT, TUNNEL_DEPTH, asphaltWidth } from '../src/sim/roads';
import { CAR_LINE, CROSSWALK, SCOOTER_LINE, findJunctions } from '../src/sim/signals';
import { Zone } from '../src/sim/zoning';
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
  /** Crossroads with an underground metro line under the east-west road, stations at x = ±100. */
  function metroCity(): City {
    const city = crossroads();
    city.buildTrack('metro', free(-180, 0), null, free(180, 0), TUNNEL_DEPTH, true);
    const t = city.rails.metro.transit;
    const a = t.stopAt({ x: -100, y: 0 }, 8)!;
    const b = t.stopAt({ x: 100, y: 0 }, 8)!;
    expect(city.createLine(t, [a.id, b.id]).ok).toBe(true);
    return city;
  }
  const lotsOf = (city: City) => [...city.net.segments.values()].flatMap((s) => s.lots);

  it('take three first-row cells in a row beside a street, two per station', () => {
    const city = metroCity();
    const exits = city.metroExits();
    expect(exits.length).toBe(4);
    for (const e of exits) {
      expect(e.cells.length).toBe(EXIT_CELLS);
      for (const c of e.cells) expect(offAsphalt(city, c)).toBeGreaterThan(1.8);
      // A cell apart, in a line
      expect(Math.hypot(e.cells[2].x - e.cells[0].x, e.cells[2].y - e.cells[0].y)).toBeCloseTo(16, 0);
      for (const c of e.cells) expect(city.occupied(c)).toBe(true);
    }
    // No two entrances share a cell
    const cells = exits.flatMap((e) => e.cells);
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) expect(Math.hypot(cells[i].x - cells[j].x, cells[i].y - cells[j].y)).toBeGreaterThan(4);
  });

  it('are skipped by the zoning brush and stay put when everything around is zoned', () => {
    const city = metroCity();
    const before = JSON.stringify(city.metroExits().map((e) => e.cells));
    city.paint({ x: 0, y: 0 }, 300, Zone.Commercial, true);
    expect(JSON.stringify(city.metroExits().map((e) => e.cells))).toBe(before);
    for (const e of city.metroExits()) {
      for (const c of e.cells) {
        const lot = lotsOf(city).find((l) => Math.hypot(l.x - c.x, l.y - c.y) < 0.1)!;
        expect(lot.blocked).toBe(true);
        expect(lot.zone).toBe(Zone.None);
      }
    }
  });

  it('clear the buildings that stood where a station is added later', () => {
    const city = crossroads();
    city.paint({ x: 0, y: 0 }, 300, Zone.Commercial);
    for (const l of lotsOf(city)) if (l.zone) l.level = 3;
    city.buildTrack('metro', free(-180, 0), null, free(180, 0), TUNNEL_DEPTH, true);
    const t = city.rails.metro.transit;
    const a = t.stopAt({ x: -100, y: 0 }, 8)!;
    const b = t.stopAt({ x: 100, y: 0 }, 8)!;
    city.createLine(t, [a.id, b.id]);
    const exits = city.metroExits();
    expect(exits.length).toBe(4);
    for (const e of exits) {
      for (const c of e.cells) {
        const lot = lotsOf(city).find((l) => Math.hypot(l.x - c.x, l.y - c.y) < 0.1)!;
        expect(lot.blocked).toBe(true);
        expect(lot.level).toBe(0);
      }
    }
  });

  it('never stand on a facility', () => {
    const city = new City();
    city.money = 1e9;
    city.buildRoad(free(-200, 0), null, free(200, 0), true);
    const spot = city.facilitySpot('police', { x: -85, y: 22 });
    const police = city.buildFacility('police', spot.p, spot.angle, true).facility!;
    city.buildTrack('metro', free(-180, 0), null, free(180, 0), TUNNEL_DEPTH, true);
    const t = city.rails.metro.transit;
    city.createLine(t, [t.stopAt({ x: -100, y: 0 }, 8)!.id, t.stopAt({ x: 100, y: 0 }, 8)!.id]);
    for (const e of city.metroExits()) for (const c of e.cells) expect(Math.hypot(police.p.x - c.x, police.p.y - c.y)).toBeGreaterThan(8);
  });
});

describe('large elevated metro stations', () => {
  it('cover 15 × 4 cells and clear what stood there', () => {
    const city = new City();
    city.money = 1e9;
    city.buildRoad(free(-200, 0), null, free(200, 0), true);
    city.paint({ x: 0, y: 0 }, 300, Zone.Commercial);
    for (const l of [...city.net.segments.values()].flatMap((s) => s.lots)) if (l.zone) l.level = 2;
    city.buildTrack('metro', free(-180, 30), null, free(180, 30), ELEVATED_HEIGHT, true);
    const t = city.rails.metro.transit;
    const stop = t.stopAt({ x: 0, y: 30 }, 8)!;
    expect(city.setMetroLook(stop, 'canopy').ok).toBe(true);
    const spot = city.stationSpots().find((s) => s.stop === stop)!;
    expect(stationCovers('metro', spot.pose, spot.side, { x: 55, y: 30 + 14 }, 0, spot.style)).toBe(true);
    expect(stationCovers('metro', spot.pose, spot.side, { x: 65, y: 30 }, 0, spot.style)).toBe(false);
    const lot = [...city.net.segments.values()].flatMap((s) => s.lots).find((l) => Math.abs(l.x - 20) < 5 && l.y > 12 && l.y < 44)!;
    expect(lot.blocked).toBe(true);
    expect(lot.level).toBe(0);
    // Saved and loaded back
    const back = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    expect(back.rails.metro.transit.stops.get(stop.id)!.look).toBe('canopy');
  });

  it('only stand on elevated track', () => {
    const city = new City();
    city.money = 1e9;
    city.buildTrack('metro', free(-180, 30), null, free(180, 30), TUNNEL_DEPTH, true);
    const stop = city.rails.metro.transit.stopAt({ x: 0, y: 30 }, 8)!;
    expect(city.setMetroLook(stop, 'canopy').ok).toBe(false);
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

  it('clear the lots under a station building that moves when a road is built', () => {
    const city = new City();
    city.money = 1e9;
    city.buildRoad(free(-300, -40), null, free(300, -40), true);
    city.buildRoad(free(-300, 48), null, free(300, 48), true);
    city.paint({ x: 0, y: 0 }, 80, Zone.ResidentialLow);
    expect(city.buildTrack('train', free(-300, 0), null, free(300, 0), 0, true).ok).toBe(true);
    const sys = city.rails.train;
    const stops = [-200, 0, 200].map((x) => sys.transit.stopAt({ x, y: 0 }, 12)!.id);
    expect(city.createLine(sys.transit, stops).ok).toBe(true);
    city.tick(() => 0.5);
    const before = city.stationSpots().find((s) => Math.abs(s.pose.p.x) < 1)!.side;
    // A street nearer the line on the other side: the building moves over to it
    city.buildRoad(free(-300, -16), null, free(300, -16), true);
    const spot = city.stationSpots().find((s) => Math.abs(s.pose.p.x) < 1)!;
    expect(spot.side).not.toBe(before);
    const lots = [...city.net.segments.values()].flatMap((s) => s.lots);
    for (const l of lots.filter((l) => stationCovers('train', spot.pose, spot.side, l, 0))) expect(l.blocked).toBe(true);
  });
});

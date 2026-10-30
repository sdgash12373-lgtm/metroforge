import { describe, expect, it } from 'vitest';
import { City, FREEWAY, INTERCHANGE_REACH } from '../src/sim/city';
import { quadPoint } from '../src/sim/geometry';
import { UNLOCK } from '../src/sim/levels';
import { ELEVATED_HEIGHT } from '../src/sim/roads';
import { TERRAINS } from '../src/sim/terrain';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

function city(): City {
  const c = new City();
  c.money = 1e10;
  return c;
}

describe('one-way streets', () => {
  it('carry traffic one way across all their lanes, keep their lots, and survive a save', () => {
    const c = city();
    const r = c.buildRoad(free(0, 0), null, free(200, 0), false, 0, 'oneway');
    expect(r.ok).toBe(true);
    const seg = r.segs![0];
    expect(seg.oneway).toBe(true);
    expect(seg.ring).toBeFalsy();
    expect(seg.lanes).toBe(2);
    expect(seg.lots.length).toBeGreaterThan(0);
    expect(c.net.isStreet(seg)).toBe(true);
    const loaded = City.deserialize(JSON.parse(JSON.stringify(c.serialize())));
    const back = loaded.net.segments.get(seg.id)!;
    expect(back.oneway).toBe(true);
    expect(back.ring).toBeFalsy();
    expect(back.lanes).toBe(2);
  });

  it('keep roundabouts apart from one-way streets in old saves', () => {
    const c = city();
    c.buildRoad(free(-200, 0), null, free(200, 0), true);
    expect(c.buildRoundabout({ x: 0, y: 0 }, 4).ok).toBe(true);
    const loaded = City.deserialize(JSON.parse(JSON.stringify(c.serialize())));
    const rings = [...loaded.net.segments.values()].filter((s) => s.ring);
    expect(rings).toHaveLength(4);
    expect(rings.every((s) => s.oneway && s.lots.length === 0)).toBe(true);
  });
});

describe('freeways and ramps', () => {
  it('a freeway the player draws meets ramps but not streets, and has no lots', () => {
    const c = city();
    c.buildRoad(free(0, -100), null, free(0, 100), true);
    const hw = c.buildRoad(free(-300, 300), null, free(300, 300), false, ELEVATED_HEIGHT, 'highway');
    expect(hw.ok).toBe(true);
    expect(hw.segs!.every((s) => s.highway && s.built && s.lanes === 2 && !s.lots.length)).toBe(true);
    // A street can't join it…
    const street = c.buildRoad(free(0, 100), null, { kind: 'node', node: c.net.node(hw.segs![0].b), p: c.net.node(hw.segs![0].b).p }, false, 0);
    expect(street.ok).toBe(false);
    // …a ramp can
    const end = c.net.node(hw.segs![0].b);
    const ramp = c.buildRoad({ kind: 'node', node: end, p: end.p }, null, free(0, 100), false, 0, 'ramp');
    expect(ramp.ok).toBe(true);
    expect(ramp.segs!.every((s) => s.ramp && s.oneway)).toBe(true);
    // Player freeways can be torn down; the region's 國道 can't
    expect(c.bulldoze({ x: -200, y: 300 }, 4).ok).toBe(true);
  });

  it('a diamond interchange on the 國道 adds a street under it and four ramps', () => {
    const c = city();
    c.buildFreeway('kaohsiung');
    const before = c.net.segments.size;
    const r = c.buildInterchange({ x: FREEWAY.x, y: -600 });
    expect(r.ok, r.reason).toBe(true);
    const ramps = [...c.net.segments.values()].filter((s) => s.ramp);
    expect(ramps.length).toBeGreaterThanOrEqual(4);
    expect(c.net.segments.size).toBeGreaterThan(before);
    // Off the freeway on the right of each direction, down to the street, and back up
    const near = c.net.segmentAt({ x: FREEWAY.x, y: -600 + INTERCHANGE_REACH }, 2, ELEVATED_HEIGHT);
    expect(near?.seg.highway).toBe(true);
    expect(c.buildInterchange({ x: FREEWAY.x + 300, y: -600 }).ok).toBe(false);
  });

  it('carries the 國道 on to the edge of the land and joins 國道 1 號 to 國道 3 號 as 國道 10 號', () => {
    const c = new City(TERRAINS.kaohsiung);
    c.money = 1e9;
    c.buildFreeway('kaohsiung');
    const link = () => [...c.net.segments.values()].filter((s) => s.name === '國道 10 號');
    // Before Pingtung opens: 國道 10 號 stops at its edge, leading out of the map
    expect(link().length).toBeGreaterThan(0);
    expect(c.outside.size).toBe(2);
    c.level = UNLOCK.region;
    expect(c.openRegion('pingtung').ok).toBe(true);
    // Joined: 國道 1 號's north end and 國道 3 號's two ends lead out
    expect(c.outside.size).toBe(3);
    expect(link().every((s) => s.highway && !s.built && s.lanes === 2)).toBe(true);
    expect(c.disconnectedRoads()).toHaveLength(0);
    // Saving and loading again lays nothing more
    const size = c.net.segments.size;
    const back = City.deserialize(JSON.parse(JSON.stringify(c.serialize())));
    expect(back.net.segments.size).toBe(size);
    expect(back.outside.size).toBe(3);
    // Nobody can tear the extension down
    const s = link()[0];
    const mid = quadPoint(c.net.quad(s), 0.5);
    expect(c.bulldoze(mid, 4).ok).toBe(false);
  });

});

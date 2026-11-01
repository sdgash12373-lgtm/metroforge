import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/city';
import { DIG_FLOOR, LAYER } from '../src/sim/landform';
import { ELEVATED_HEIGHT } from '../src/sim/roads';
import { KAOHSIUNG, WATER_LEVEL, buildable } from '../src/sim/terrain';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

function rich(): City {
  const city = new City(KAOHSIUNG);
  city.money = 1e9;
  return city;
}

/** Dabs the brush over and over at one spot, then ends the stroke. */
function brush(city: City, mode: 'level' | 'raise' | 'dig', x: number, y: number, r: number, times: number) {
  for (let i = 0; i < times; i++) city.terraform(mode, { x, y }, r);
  city.settleLand();
}

describe('整地', () => {
  it('levels a hill a layer at a time, only under the brush, so a street can then be built', () => {
    const city = rich();
    const t = city.terrain;
    const p = { x: 40, y: -680 };
    const before = t.height(p.x, p.y);
    expect(before).toBeGreaterThan(30);
    const r = city.terraform('level', p, 60);
    expect(r.ok).toBe(true);
    expect(r.cost).toBeGreaterThan(0);
    // One layer, not all the way down
    expect(before - t.height(p.x, p.y)).toBeLessThan(LAYER + 0.01);
    expect(t.height(p.x, p.y)).toBeGreaterThan(before - LAYER - 0.01);
    // Land past the brush is as it was
    expect(t.height(p.x + 200, p.y)).toBeCloseTo(KAOHSIUNG.height(p.x + 200, p.y), 5);
    brush(city, 'level', p.x, p.y, 60, 80);
    expect(t.height(p.x, p.y)).toBeCloseTo(0, 3);
    expect(buildable(t, p)).toBe(true);
    expect(city.terrainProblem({ x: p.x - 15, y: p.y }, null, { x: p.x + 15, y: p.y }, 0, 0)).toBeNull();
  });

  it('raises the sea into land, which 整平 then makes buildable', () => {
    const city = rich();
    const t = city.terrain;
    const sea = { x: -1880, y: -150 };
    expect(t.water(sea.x, sea.y)).toBe(true);
    brush(city, 'raise', sea.x, sea.y, 80, 40);
    expect(t.water(sea.x, sea.y)).toBe(false);
    expect(t.height(sea.x, sea.y)).toBeGreaterThan(0.05);
    brush(city, 'level', sea.x, sea.y, 80, 40);
    expect(t.height(sea.x, sea.y)).toBeCloseTo(0, 3);
    expect(buildable(t, sea)).toBe(true);
  });

  it('digs a dry pit inland, and a lake where the pit reaches water', () => {
    const city = rich();
    const t = city.terrain;
    const pit = { x: 300, y: 300 };
    brush(city, 'dig', pit.x, pit.y, 60, 20);
    expect(t.height(pit.x, pit.y)).toBeCloseTo(DIG_FLOOR, 1);
    expect(t.water(pit.x, pit.y)).toBe(false);
    expect(buildable(t, pit)).toBe(false);
    expect(city.buildRoad(free(pit.x - 20, pit.y), null, free(pit.x + 20, pit.y)).ok).toBe(false);
    // A pit dug from the shore fills from the sea
    const shore = { x: -1900, y: -300 };
    expect(t.water(-2000, -300)).toBe(true);
    brush(city, 'dig', shore.x, shore.y, 60, 20);
    expect(t.height(shore.x, shore.y)).toBeLessThan(WATER_LEVEL);
    expect(t.water(shore.x, shore.y)).toBe(true);
    // Saved and loaded, the land is the same
    const back = City.deserialize(city.serialize());
    expect(back.terrain.height(pit.x, pit.y)).toBeCloseTo(t.height(pit.x, pit.y), 1);
    expect(back.terrain.water(shore.x, shore.y)).toBe(true);
    expect(back.terrain.water(pit.x, pit.y)).toBe(false);
  });

  it('keeps the land under streets as it is', () => {
    const city = rich();
    expect(city.buildRoad(free(200, -100), null, free(400, -100)).ok).toBe(true);
    const r = city.terraform('dig', { x: 300, y: -100 }, 20);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('道路');
    expect(city.terrain.height(300, -100)).toBe(KAOHSIUNG.height(300, -100));
  });

  it('bores a tunnel through a hill for streets and viaducts, and carries water through it to a lake', () => {
    const city = rich();
    const t = city.terrain;
    const a = { x: -1330, y: 300 };
    const b = { x: -870, y: 300 };
    expect(city.buildRoad(free(a.x, a.y), null, free(b.x, b.y)).ok).toBe(false);
    expect(city.boreProblem({ x: 300, y: 300 }, { x: 600, y: 300 }).reason).toContain('沒有山');
    const r = city.buildBore(a, b);
    expect(r.reason).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(city.terrainProblem(a, null, b, 0, 0)).toBeNull();
    expect(city.terrainProblem(a, null, b, ELEVATED_HEIGHT, ELEVATED_HEIGHT)).toBeNull();
    expect(city.buildRoad(free(a.x, a.y), null, free(b.x, b.y)).ok).toBe(true);
    // The hill beside the bore still stands
    expect(t.height(-1100, 380)).toBe(KAOHSIUNG.height(-1100, 380));
    // A pit dug at the far end stays dry until water reaches the near end
    const lake = { x: -800, y: 380 };
    brush(city, 'dig', lake.x, lake.y, 50, 20);
    expect(t.water(lake.x, lake.y)).toBe(false);
    // A channel from the sea to the near end of the tunnel
    for (let x = -1500; x <= -1340; x += 30) brush(city, 'dig', x, 340, 30, 20);
    expect(t.water(-1340, 340)).toBe(true);
    expect(t.water(lake.x, lake.y)).toBe(true);
    expect(t.sea(lake.x, lake.y)).toBe(false);
  });

  it('takes a port on the edge of reclaimed land', () => {
    const city = rich();
    city.level = 3;
    for (let x = -1900; x <= -1700; x += 40) {
      brush(city, 'raise', x, -150, 80, 12);
      brush(city, 'level', x, -150, 80, 12);
    }
    expect(city.terrain.sea(-1900, -150)).toBe(false);
    expect(city.buildRoad(free(-1900, -320), null, free(-1900, -100)).ok).toBe(true);
    const spot = city.facilitySpot('cruisePort', { x: -1920, y: -220 });
    expect(city.facilityProblem('cruisePort', spot.p, spot.angle)).toBeNull();
  });

  it('takes a port off a street along the very edge of reclaimed land', () => {
    const city = rich();
    city.level = 3;
    city.buildFreeway('kaohsiung');
    for (let x = -1900; x <= -1700; x += 40) {
      brush(city, 'raise', x, -150, 80, 12);
      brush(city, 'level', x, -150, 80, 12);
    }
    // The last land going south (into the sea) at x = -1800, and a street right along it
    let edge = -150;
    while (!city.terrain.sea(-1800, edge + 2)) edge += 2;
    const road = city.buildRoad(free(-1860, edge - 8), null, free(-1740, edge - 8));
    expect(road.ok).toBe(true);
    const spot = city.facilitySpot('cruisePort', { x: -1800, y: edge + 20 });
    expect(city.facilityProblem('cruisePort', spot.p, spot.angle)).toBeNull();
    // Not joined to any road out of town, yet the ferries make it a way in: the street can grow
    const seg = road.segs![0];
    expect(city.isConnected(seg)).toBe(false);
    expect(city.buildFacility('cruisePort', spot.p, spot.angle).ok).toBe(true);
    expect(city.isConnected(seg)).toBe(true);
    const copy = City.deserialize(city.serialize());
    expect(copy.isConnected(copy.net.segments.get(seg.id)!)).toBe(true);
  });
});

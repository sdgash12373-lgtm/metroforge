import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/city';
import { FACILITIES, footprintContains } from '../src/sim/facilities';
import { gameDate, ntd } from '../src/sim/format';
import { Zone } from '../src/sim/zoning';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

function rng(seed = 5) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

function street(): City {
  const city = new City();
  city.money = 1e7;
  city.buildRoad(free(-400, 0), null, free(400, 0), true);
  city.addOutsideConnection([...city.net.nodes.values()].find((n) => n.p.x === -400)!.id);
  return city;
}

describe('public services and landmarks', () => {
  it('sit beside a street facing it, off the road, and clear the zoning under them', () => {
    const city = street();
    city.paint({ x: 0, y: 40 }, 80, Zone.ResidentialLow);
    const spot = city.facilitySpot('school', { x: 10, y: 30 });
    expect(spot.road).toBe(true);
    expect(spot.p.y).toBeGreaterThan(FACILITIES.school.d / 2);
    const r = city.buildFacility('school', spot.p, spot.angle);
    expect(r.ok).toBe(true);
    expect(city.money).toBe(1e7 - FACILITIES.school.cost);
    const lots = [...city.net.segments.values()].flatMap((s) => s.lots).filter((l) => footprintContains(r.facility!, l));
    expect(lots.length).toBeGreaterThan(0);
    expect(lots.every((l) => l.blocked)).toBe(true);
    // Not on top of it, not far from roads, not twice for a landmark
    expect(city.buildFacility('park', spot.p, spot.angle).ok).toBe(false);
    expect(city.buildFacility('park', { x: 0, y: 300 }, 0).reason).toContain('道路旁邊');
    // Close to the road but turned with its back to it: no way in from the street
    const back = city.facilitySpot('park', { x: 200, y: 30 });
    expect(city.facilityProblem('park', back.p, back.angle)).toBeNull();
    expect(city.buildFacility('park', back.p, back.angle + Math.PI).reason).toContain('道路旁邊');
    const t = city.facilitySpot('tower85', { x: -200, y: -30 });
    expect(city.buildFacility('tower85', t.p, t.angle).ok).toBe(true);
    const t2 = city.facilitySpot('tower85', { x: 250, y: -30 });
    expect(city.buildFacility('tower85', t2.p, t2.angle).reason).toContain('已經有');
  });

  it('let homes grow taller and residents be happier when services reach them', () => {
    const grow = (withServices: boolean) => {
      const city = street();
      city.paint({ x: 0, y: 60 }, 70, Zone.Commercial);
      city.paint({ x: 0, y: -50 }, 120, Zone.ResidentialLow);
      if (withServices) {
        for (const [k, x] of [['park', -40], ['school', 60], ['police', -180], ['fire', 200]] as const) {
          const s = city.facilitySpot(k, { x, y: 30 });
          expect(city.buildFacility(k, s.p, s.angle).ok).toBe(true);
        }
      }
      const r = rng();
      for (let i = 0; i < 600; i++) city.tick(r);
      const homes = [...city.net.segments.values()].flatMap((s) => s.lots).filter((l) => l.zone === Zone.ResidentialLow && l.level);
      return { city, top: Math.max(...homes.map((l) => l.level)) };
    };
    const bare = grow(false);
    const served = grow(true);
    expect(bare.top).toBe(1);
    expect(served.top).toBe(3);
    expect(bare.city.needs.wants).toContain('school');
    expect(served.city.needs.happiness).toBeGreaterThan(bare.city.needs.happiness);
    expect(served.city.needs.coverage.park).toBeGreaterThan(0.5);
    expect(served.city.budget.servicesUpkeep).toBeGreaterThan(0);
  });

  it('bring tourists who spend money, are bulldozed for a refund, and are saved', () => {
    const city = street();
    const s = city.facilitySpot('arena', { x: 0, y: 60 });
    const arena = city.buildFacility('arena', s.p, s.angle).facility!;
    city.tick(rng());
    expect(city.needs.tourists).toBeGreaterThan(0);
    expect(city.budget.tourism).toBeGreaterThan(0);
    const copy = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    const f = [...copy.facilities.values()][0];
    expect([f.kind, Math.round(f.p.x), Math.round(f.p.y)]).toEqual(['arena', Math.round(arena.p.x), Math.round(arena.p.y)]);
    const before = city.money;
    const r = city.bulldoze(arena.p, 4);
    expect(r.what).toBe('巨蛋');
    expect(city.money).toBe(before + FACILITIES.arena.cost / 2);
    expect(city.facilities.size).toBe(0);
  });
});

describe('format', () => {
  it('shows money in NT$ and game days as calendar dates', () => {
    expect(ntd(1234567)).toBe('NT$1,234,567');
    expect(ntd(-50)).toBe('−NT$50');
    expect(gameDate(0)).toBe('2026/01/01 00:00:00');
    expect(gameDate(31.5)).toBe('2026/02/01 12:00:00');
    expect(gameDate(365, false)).toBe('2027/01/01');
  });
});

describe('upkeep of roads and public buildings', () => {
  it('is billed with the roads in one go every two weeks, an hour\'s worth each time', async () => {
    const { DAY_STEPS, HOUR_STEPS, UPKEEP_DAYS } = await import('../src/sim/city');
    const city = street();
    const spot = city.facilitySpot('hospital', { x: 0, y: 40 });
    expect(city.buildFacility('hospital', spot.p, spot.angle).ok).toBe(true);
    const period = UPKEEP_DAYS * DAY_STEPS;
    // Run up to just before the next bill, then over it
    while (city.steps % period !== 0) city.tick(rng());
    const before = city.money;
    city.tick(rng());
    const { ROAD_UPKEEP } = await import('../src/sim/city');
    const roads = [...city.net.segments.values()].reduce((sum, s) => sum + s.length, 0);
    expect(city.lastUpkeepBill).toBeCloseTo(FACILITIES.hospital.upkeep * HOUR_STEPS + roads * ROAD_UPKEEP * HOUR_STEPS, 3);
    expect(city.money).toBeLessThan(before - city.lastUpkeepBill * 0.5);
  });

  it('拆除 knocks down a grown building and unzones its cell, leaving the road', () => {
    const city = street();
    city.paint({ x: 0, y: 20 }, 30, Zone.Commercial);
    const lot = [...city.net.segments.values()].flatMap((s) => s.lots).find((l) => l.zone === Zone.Commercial && !l.blocked && l.depth === 1)!;
    expect(city.bulldoze(lot, 4).ok).toBe(false);
    lot.level = 2;
    const roads = city.net.segments.size;
    // Even with a wide pick radius (zoomed out), a tap inside the building takes the building
    const r = city.bulldoze(lot, 18);
    expect(r.ok).toBe(true);
    expect(r.what).toBe('商業建築');
    expect(lot.level).toBe(0);
    expect(lot.zone).toBe(Zone.None);
    expect(city.net.segments.size).toBe(roads);
  });
});

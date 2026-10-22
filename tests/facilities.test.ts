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

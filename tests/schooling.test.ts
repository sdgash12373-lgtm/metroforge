import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/city';
import { PUPIL_SHARE, SCHOOL_SEATS } from '../src/sim/facilities';
import { Zone } from '../src/sim/zoning';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

function rng(seed = 5) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

describe('就學人數', () => {
  it('counts the children at each school and the students at the universities', () => {
    const city = new City();
    city.money = 1e9;
    city.buildRoad(free(-400, 0), null, free(400, 0), true);
    city.addOutsideConnection([...city.net.nodes.values()].find((n) => n.p.x === -400)!.id);
    city.paint({ x: -200, y: 12 }, 40, Zone.ResidentialHigh);
    for (const s of city.net.segments.values()) for (const l of s.lots) if (l.zone) l.level = 3;
    const r = rng();
    city.tick(r);
    // No school yet: every child is out of reach, every student studies elsewhere
    expect(city.schooling.pupils).toBe(0);
    expect(city.schooling.unschooled).toBeGreaterThan(0);
    expect(city.schooling.studentsWaiting).toBeGreaterThan(0);
    const spot = city.facilitySpot('school', { x: -200, y: -40 });
    expect(city.buildFacility('school', spot.p, spot.angle).ok).toBe(true);
    for (let i = 0; i < 4; i++) city.tick(r);
    const s = city.schooling;
    const school = [...city.facilities.values()].find((f) => f.kind === 'school')!;
    expect(s.pupils).toBeGreaterThan(0);
    expect(s.pupils).toBeLessThanOrEqual(SCHOOL_SEATS);
    expect(s.enrolled.get(school.id)).toBe(s.pupils);
    expect(s.pupilSeats).toBe(SCHOOL_SEATS);
    expect(s.pupils + s.unschooled + s.turnedAway).toBeCloseTo(city.stats.population * PUPIL_SHARE, -1);
  });
});

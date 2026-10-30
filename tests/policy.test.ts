import { describe, expect, it } from 'vitest';
import { City, budgetTotals } from '../src/sim/city';
import { ELEVATED_HEIGHT } from '../src/sim/roads';
import { POLICIES, TOD_DENSITY, TOD_LEVELS } from '../src/sim/policy';
import { ZONES, Zone } from '../src/sim/zoning';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

function rng(seed = 7) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** A 縣轄市 with a street along y = 0 and a metro line under it. */
function town(): City {
  const city = new City();
  city.money = 1e10;
  city.level = 3;
  city.buildRoad(free(-600, 0), null, free(600, 0), true);
  expect(city.buildTrack('metro', free(-600, 40), null, free(600, 40), 0, true).ok).toBe(true);
  const sys = city.rails.metro;
  const stops = [-500, 500].map((x) => sys.transit.stopAt({ x, y: 40 }, 12)!.id);
  expect(city.createLine(sys.transit, stops).ok).toBe(true);
  return city;
}

const lotsOf = (city: City, zone: Zone) => [...city.net.segments.values()].flatMap((s) => s.lots).filter((l) => l.zone === zone && !l.blocked);

describe('市政政策', () => {
  it('open at 縣轄市 only', () => {
    const city = new City();
    expect(city.setPolicy('tod', true).ok).toBe(false);
    expect(city.policies.size).toBe(0);
    city.level = 3;
    expect(city.setPolicy('tod', true).ok).toBe(true);
    expect(city.policies.has('tod')).toBe(true);
  });

  it('捷運聯合開發 packs more people into taller buildings round a station, and costs money each month', () => {
    const city = town();
    city.paint({ x: -500, y: -12 }, 30, Zone.ResidentialHigh);
    city.paint({ x: 0, y: -12 }, 30, Zone.ResidentialHigh);
    for (const l of lotsOf(city, Zone.ResidentialHigh)) l.level = 2;
    city.tick(rng());
    const before = city.stats.population;
    expect(city.tod.size).toBe(0);
    city.setPolicy('tod', true);
    city.tick(rng());
    const near = lotsOf(city, Zone.ResidentialHigh).filter((l) => Math.abs(l.x + 500) < 100);
    const far = lotsOf(city, Zone.ResidentialHigh).filter((l) => Math.abs(l.x) < 60);
    expect(near.length).toBeGreaterThan(0);
    expect(near.every((l) => city.tod.has(l))).toBe(true);
    expect(far.some((l) => city.tod.has(l))).toBe(false);
    expect(city.stats.population).toBeGreaterThan(before);
    expect(city.policyStats.todPeople).toBe(near.reduce((n, l) => n + Math.round(l.level * ZONES[Zone.ResidentialHigh].perLevel * TOD_DENSITY), 0));
    // Two more levels than usual, with enough services
    const lot = near[0];
    city.paint({ x: 500, y: -12 }, 20, Zone.Office);
    const desk = lotsOf(city, Zone.Office)[0];
    desk.level = 1;
    city.tick(rng());
    expect(city.levelCap(desk)).toBe(ZONES[Zone.Office].maxLevel + TOD_LEVELS);
    expect(city.budget.policy).toBeCloseTo(POLICIES.tod.cost, -2);
    expect(budgetTotals(city.budget).running).toBeGreaterThanOrEqual(POLICIES.tod.cost);
    // Ending the policy brings the extra levels down again
    desk.level = ZONES[Zone.Office].maxLevel + 2;
    city.setPolicy('tod', false);
    const r = rng();
    for (let i = 0; i < 2000 && desk.level > ZONES[Zone.Office].maxLevel; i++) city.tick(r);
    expect(desk.level).toBe(ZONES[Zone.Office].maxLevel);
    expect(city.tod.has(lot)).toBe(false);
  });

  it('產業創新計畫 turns a university, a science park and an interchange into a 產業聚落', () => {
    const city = town();
    // A freeway with a ramp down to the street
    const hw = city.buildRoad(free(-600, -900), null, free(600, -900), false, ELEVATED_HEIGHT, 'highway');
    expect(hw.ok).toBe(true);
    const end = city.net.node(hw.segs![0].b);
    expect(city.buildRoad({ kind: 'node', node: end, p: end.p }, null, city.net.snap({ x: 600, y: 0 }, 1), false, 0, 'ramp').ok).toBe(true);
    city.paint({ x: 200, y: 12 }, 40, Zone.SciencePark);
    city.paint({ x: -200, y: 12 }, 40, Zone.ResidentialHigh);
    for (const l of [...lotsOf(city, Zone.SciencePark), ...lotsOf(city, Zone.ResidentialHigh)]) l.level = 3;
    const s = city.facilitySpot('university', { x: 0, y: -60 });
    const built = city.buildFacility('university', s.p, s.angle);
    expect(built.reason).toBeUndefined();
    city.tick(rng());
    expect(city.clusters).toHaveLength(1);
    expect(city.clusters[0].ramp).toBe(true);
    expect(city.clusters[0].active).toBe(false);
    const jobs = city.stats.jobs;
    city.setPolicy('industry', true);
    city.tick(rng());
    expect(city.clusters[0].active).toBe(true);
    expect(city.stats.jobs).toBeGreaterThan(jobs);
    expect(city.policyStats.clusterPeople).toBeGreaterThan(0);
    expect(city.budget.cluster).toBeGreaterThan(0);
    expect(city.review.industry.ok).toBe(true);
  });

  it('升格審查 marks each bar and gives its bonus', () => {
    const city = town();
    city.paint({ x: -500, y: -12 }, 30, Zone.ResidentialHigh);
    for (const l of lotsOf(city, Zone.ResidentialHigh)) l.level = 1;
    city.tick(rng());
    city.tick(rng());
    // Everyone lives by the metro, nobody near a police station
    expect(city.review.metro.ok).toBe(true);
    expect(city.review.safety.ok).toBe(false);
    expect(city.review.finance.ok).toBe(budgetTotals(city.budget).balance > 0);
    // Below 縣轄市 nothing counts
    city.level = 2;
    city.tick(rng());
    expect(city.review.metro.ok).toBe(false);
  });

  it('are kept in a save', () => {
    const city = town();
    city.setPolicy('industry', true);
    city.ridersDay = 1234;
    const copy = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    expect([...copy.policies]).toEqual(['industry']);
    expect(copy.ridersDay).toBe(1234);
  });
});

import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/city';
import { INCOME_BRACKETS, bracketOf, residentIncome } from '../src/sim/income';
import { type Lot, Zone } from '../src/sim/zoning';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

function rng(seed = 7) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** A street to the highway with homes on one side and shops on the other, all built to `level`. */
function town(home: Zone, level: number, rank = 0): City {
  const city = new City();
  city.money = 1e9;
  city.level = rank;
  city.buildRoad(free(-400, 0), null, free(400, 0), true);
  city.addOutsideConnection([...city.net.nodes.values()].find((n) => n.p.x === -400)!.id);
  city.paint({ x: 0, y: 30 }, 200, home);
  city.paint({ x: 0, y: -30 }, 200, Zone.Commercial);
  for (const seg of city.net.segments.values()) for (const l of seg.lots) if (l.zone !== Zone.None) l.level = l.zone === Zone.Commercial ? 1 : level;
  city.measure();
  return city;
}

const lot = (zone: Zone, level: number, seed = 0.5) => ({ zone, level, seed }) as Lot;

describe('resident income', () => {
  it('sorts residents into the four brackets', () => {
    expect(bracketOf(50_000).commute).toBe('bike');
    expect(bracketOf(150_000).commute).toBe('scooter');
    expect(bracketOf(399_999).commute).toBe('scooter');
    expect(bracketOf(450_000)).toMatchObject({ commute: 'car', fuelTax: 0.03 });
    expect(bracketOf(600_000)).toMatchObject({ commute: 'car', fuelTax: 0.07 });
    expect(INCOME_BRACKETS.map((b) => b.fuelTax)).toEqual([0, 0, 0.03, 0.07]);
  });

  it('rises with the building, the services in reach and the city rank', () => {
    const base = residentIncome(lot(Zone.ResidentialHigh, 2), 1, 0);
    expect(residentIncome(lot(Zone.ResidentialHigh, 4), 1, 0)).toBeGreaterThan(base);
    expect(residentIncome(lot(Zone.ResidentialHigh, 2), 4, 0)).toBeGreaterThan(base);
    expect(residentIncome(lot(Zone.ResidentialHigh, 2), 1, 4)).toBeGreaterThan(base);
    expect(residentIncome(lot(Zone.Commercial, 2), 1, 0)).toBe(0);
  });

  it('keeps cyclists off the road and pays no fuel tax in a poor town', () => {
    const city = town(Zone.ResidentialHigh, 1);
    expect(city.households.people.bike).toBe(city.stats.population);
    expect(city.households.fuelTaxYear).toBe(0);
    const r = rng();
    for (let i = 0; i < 300; i++) city.tick(r);
    expect(city.traffic.vehicles.filter((v) => v.kind === 'car' || v.kind === 'scooter')).toHaveLength(0);
    expect(city.budget.fuelTax).toBe(0);
  });

  it('puts scooters on the road in a working town', () => {
    const city = town(Zone.ResidentialLow, 1);
    expect(city.households.people.scooter).toBeGreaterThan(0);
    const r = rng();
    for (let i = 0; i < 300; i++) city.tick(r);
    expect(city.traffic.vehicles.some((v) => v.kind === 'scooter')).toBe(true);
  });

  it('has car owners pay 3% or 7% of their income in fuel tax', () => {
    const city = town(Zone.ResidentialLow, 3, 4);
    const h = city.households;
    expect(h.people.car + h.people.rich).toBeGreaterThan(0);
    expect(h.fuelTaxYear).toBeGreaterThan(0);
    const r = rng();
    for (let i = 0; i < 300; i++) city.tick(r);
    expect(city.traffic.vehicles.some((v) => v.kind === 'car')).toBe(true);
    expect(city.budget.fuelTax).toBeCloseTo(city.households.fuelTaxYear / 12, 0);
  });
});

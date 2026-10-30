import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/city';
import { DEFAULT_PARKING_FEE, PARKING_SPACES, parkedCars } from '../src/sim/facilities';
import { composeLetter } from '../src/sim/mail';
import { Zone } from '../src/sim/zoning';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

function rng(seed = 5) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** A street to the highway with shops on one side and homes on the other, grown for a while. */
function town(garage: boolean): City {
  const city = new City();
  city.money = 1e7;
  city.buildRoad(free(-400, 0), null, free(400, 0), true);
  city.addOutsideConnection([...city.net.nodes.values()].find((n) => n.p.x === -400)!.id);
  city.paint({ x: 0, y: 60 }, 120, Zone.Commercial);
  city.paint({ x: 0, y: -60 }, 120, Zone.ResidentialLow);
  if (garage) {
    const s = city.facilitySpot('parking', { x: 250, y: 30 });
    expect(city.buildFacility('parking', s.p, s.angle).ok).toBe(true);
  }
  const r = rng();
  for (let i = 0; i < 900; i++) city.tick(r);
  return city;
}

describe('公有停車場', () => {
  it('fills fewer spaces as the fee rises, never more than it holds', () => {
    expect(parkedCars(100, 10)).toBe(100);
    expect(parkedCars(100, 60)).toBeLessThan(parkedCars(100, 30));
    expect(parkedCars(10_000, 0)).toBe(PARKING_SPACES);
  });

  it('earns parking fees from the shops around it, saved with the fee', () => {
    const city = town(true);
    expect(city.parked).toBeGreaterThan(0);
    expect(city.budget.parking).toBeGreaterThan(0);
    expect(town(false).budget.parking).toBe(0);
    city.parkingFee = 55;
    const back = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    expect(back.parkingFee).toBe(55);
    // Older saves charge the default
    const old = city.serialize() as unknown as Record<string, unknown>;
    delete old.parkingFee;
    expect(City.deserialize(old as never).parkingFee).toBe(DEFAULT_PARKING_FEE);
  });
});

describe('市民信箱', () => {
  it('stays quiet before anyone lives in the city', () => {
    expect(composeLetter(new City(), rng(), 12)).toBeNull();
  });

  it('writes about how the city is doing, and not the same subject twice running', () => {
    const city = town(false);
    const r = rng(9);
    const recent: string[] = [];
    for (let i = 0; i < 30; i++) {
      const l = composeLetter(city, r, 12, recent.slice(0, 4))!;
      expect(l.text.length).toBeGreaterThan(0);
      expect(['mood', 'idea', 'suggest', 'complain']).toContain(l.tone);
      expect(recent.slice(0, 4)).not.toContain(l.topic);
      recent.unshift(l.topic);
    }
    // No services were built, so someone asks for one
    expect(recent.some((t) => t.startsWith('lack-') || t.startsWith('idea-'))).toBe(true);
  });
});

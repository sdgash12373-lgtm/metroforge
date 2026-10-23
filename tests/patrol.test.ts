import { describe, expect, it } from 'vitest';
import { City, PATROLS_PER_STATION } from '../src/sim/city';
import { Zone } from '../src/sim/zoning';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

function rng(seed = 11) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

function town(): City {
  const city = new City();
  city.money = 1e9;
  city.buildRoad(free(-400, 0), null, free(400, 0), true);
  city.addOutsideConnection([...city.net.nodes.values()].find((n) => n.p.x === -400)!.id);
  city.paint({ x: 0, y: 30 }, 200, Zone.ResidentialLow);
  city.paint({ x: 0, y: -30 }, 200, Zone.Commercial);
  for (const seg of city.net.segments.values()) for (const l of seg.lots) if (l.zone !== Zone.None) l.level = 2;
  city.measure();
  return city;
}

const patrols = (city: City) => city.traffic.vehicles.filter((v) => v.kind === 'police').length;

describe('police patrols', () => {
  it('sends no patrol cars out without a police station', () => {
    const city = town();
    const r = rng();
    for (let i = 0; i < 400; i++) city.tick(r);
    expect(patrols(city)).toBe(0);
  });

  it('keeps up to two patrol cars on the road per station', () => {
    const city = town();
    const spot = city.facilitySpot('police', { x: 320, y: 20 });
    const built = city.buildFacility('police', spot.p, spot.angle, true);
    expect(built.reason).toBeUndefined();
    city.measure();
    const r = rng();
    let most = 0;
    for (let i = 0; i < 400; i++) {
      city.tick(r);
      most = Math.max(most, patrols(city));
    }
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(PATROLS_PER_STATION);
  });
});

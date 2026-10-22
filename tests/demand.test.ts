import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/city';
import { Zone } from '../src/sim/zoning';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

describe('RCOI demand', () => {
  it('keeps moving as the city grows instead of sticking at full or empty', () => {
    let seed = 5;
    const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const city = new City();
    city.money = 1e7;
    city.buildRoad(free(-400, 0), null, free(400, 0), true);
    city.addOutsideConnection([...city.net.nodes.values()].find((n) => n.p.x === -400)!.id);
    city.buildRoad(free(-400, 200), null, free(400, 200), true);
    city.buildRoad(free(0, 0), null, free(0, 200), true);
    city.paint({ x: -200, y: 60 }, 120, Zone.ResidentialLow);
    city.paint({ x: 200, y: 60 }, 80, Zone.Commercial);
    city.paint({ x: 200, y: 160 }, 60, Zone.Industrial);
    city.paint({ x: -200, y: -60 }, 80, Zone.Office);
    const seen: Record<string, Set<number>> = { R: new Set(), C: new Set(), O: new Set(), I: new Set() };
    for (let i = 0; i < 600; i++) {
      city.tick(rng);
      for (const k of ['R', 'C', 'O', 'I'] as const) seen[k].add(city.demand[k]);
    }
    expect(city.stats.population).toBeGreaterThan(200);
    for (const k of ['R', 'C', 'O', 'I'] as const) {
      expect(seen[k].size).toBeGreaterThan(3);
      expect(city.demand[k]).toBeGreaterThan(0);
      expect(city.demand[k]).toBeLessThan(100);
    }
  });
});

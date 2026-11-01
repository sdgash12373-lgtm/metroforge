import { describe, expect, it } from 'vitest';
import { City, FREEWAYS, freewayTown } from '../src/sim/city';
import { KAOHSIUNG, buildable, hengchunPoint } from '../src/sim/terrain';

/** Turned axes: u inland (roughly real north), v along the coast (roughly real east). */
const at = (u: number, v: number) => ({ x: (u + v) * Math.SQRT1_2, y: (v - u) * Math.SQRT1_2 });
const T = KAOHSIUNG;

describe('Pingtung, across the Gaoping River', () => {
  it('is its own region south-east of the river, with Kaohsiung unchanged on the near bank', () => {
    expect(T.region(0, 0)).toBe('kaohsiung');
    const plain = at(0, 1600);
    expect(T.region(plain.x, plain.y)).toBe('pingtung');
    expect(buildable(T, plain)).toBe(true);
    // Beyond the old square
    const far = at(0, 3000);
    expect(far.x > 2000 || far.y > 2000).toBe(true);
    expect(T.region(far.x, far.y)).toBe('pingtung');
    expect(T.region(5000, 5000)).toBeNull();
    expect(T.bounds.maxX).toBeGreaterThan(4000);
  });

  it('follows the real county: plain, Central Range in the east, rivers, Dapeng Bay and Xiaoliuqiu', () => {
    const range = at(0, 3700);
    expect(T.height(range.x, range.y)).toBeGreaterThan(300);
    const coast = at(-2300, 2000);
    expect(T.sea(coast.x, coast.y)).toBe(true);
    const liuqiu = at(-2180, 2260);
    expect(T.water(liuqiu.x, liuqiu.y)).toBe(false);
    expect(T.height(liuqiu.x, liuqiu.y)).toBeGreaterThan(5);
    const dapeng = at(-1390, 2470);
    expect(T.sea(dapeng.x, dapeng.y)).toBe(true);
    // Rivers are water but not sea
    const gaoping = at(0, 1080 + 75 * Math.sin(0) + 35 * Math.sin(2));
    expect(T.water(gaoping.x, gaoping.y)).toBe(true);
    expect(T.sea(gaoping.x, gaoping.y)).toBe(false);
    const donggang = [...Array(200).keys()].map((i) => at(500, 2200 + i * 3)).some((p) => T.water(p.x, p.y) && !T.sea(p.x, p.y));
    expect(donggang).toBe(true);
  });

  it('reaches south past Fangliao down the Hengchun Peninsula to Eluanbi, with the Pacific on its east', () => {
    // Points on the peninsula, given in its own frame
    const hp = hengchunPoint;
    // The Hengchun plain, with Longluan Lake on it
    const hengchun = hp(-4250, 3150);
    expect(T.region(hengchun.x, hengchun.y)).toBe('pingtung');
    expect(buildable(T, hengchun)).toBe(true);
    const lake = hp(-4380, 3020);
    expect(T.water(lake.x, lake.y)).toBe(true);
    expect(T.sea(lake.x, lake.y)).toBe(false);
    // The range runs on down the east side, lower than up north
    const spine = hp(-2800, 3420);
    expect(T.height(spine.x, spine.y)).toBeGreaterThan(100);
    // Sea on all three sides: west of Checheng, Nanwan bay off Kenting, the Pacific off Jiupeng
    for (const [u, v] of [[-3000, 2600], [-5200, 3350], [-3300, 4300]]) {
      const p = hp(u, v);
      expect(T.sea(p.x, p.y)).toBe(true);
      expect(T.region(p.x, p.y)).toBe('pingtung');
    }
    // It carries on down the coast (turned only a little seaward of it), not straight out to sea
    const root = hp(-1850, 3300);
    const tip = hp(-4900, 3300);
    const along = { u: (tip.x - tip.y - root.x + root.y) * Math.SQRT1_2, v: (tip.x + tip.y - root.x - root.y) * Math.SQRT1_2 };
    const angle = (Math.atan2(-along.u, along.v) * 180) / Math.PI;
    expect(angle).toBeGreaterThan(20);
    expect(angle).toBeLessThan(45);
    for (const p of [hp(-5300, 2400), hp(-5300, 4400)]) {
      expect(T.bounds.minX).toBeLessThanOrEqual(p.x + 1);
      expect(T.bounds.maxX).toBeGreaterThanOrEqual(p.x - 1);
      expect(T.bounds.maxY).toBeGreaterThanOrEqual(p.y - 1);
    }
  });

  it('has Cijin off the city: a narrow island with Kaohsiung Harbour between it and the shore', () => {
    for (const v of [0, 300, 600]) {
      const coast = [...Array(400).keys()].map((i) => -900 - i).find((u) => { const p = at(u, v); return T.sea(p.x, p.y); })!;
      // Out from the shore: harbour water, then the island, then the open sea
      const kinds: string[] = [];
      for (let u = coast; u > coast - 300; u -= 4) {
        const p = at(u, v);
        const k = T.sea(p.x, p.y) ? 'sea' : 'land';
        if (kinds[kinds.length - 1] !== k) kinds.push(k);
      }
      expect(kinds).toEqual(['sea', 'land', 'sea']);
      const island = [...Array(75).keys()].map((i) => at(coast - i * 4, v)).find((p) => !T.sea(p.x, p.y))!;
      expect(T.region(island.x, island.y)).toBe('kaohsiung');
      expect(T.height(island.x, island.y)).toBeGreaterThan(0.5);
    }
  });

  it('carries the hills and mountains on across the Gaoping River without a cliff at the border', () => {
    for (let u = 600; u <= 2400; u += 100) {
      const c = 1080 + 75 * Math.sin(u / 230) + 35 * Math.sin(u / 87 + 2);
      const half = 30;
      const near = at(u, c - half - 5);
      const far = at(u, c + half + 5);
      const a = T.height(near.x, near.y);
      const b = T.height(far.x, far.y);
      if (a <= 0 || b <= 0) continue;
      expect(Math.abs(a - b)).toBeLessThan(Math.max(25, 0.35 * a));
    }
  });

  it('has 國道 3 號 up the plain with an interchange and a road into Pingtung city', () => {
    const city = new City(T);
    city.buildFreeway('pingtung');
    // 國道 1, 3, 8 and 10 all lead out of the map
    expect(city.outside.size).toBe(6);
    const main = [...city.net.segments.values()].filter((s) => s.highway && s.name === FREEWAYS.pingtung.name);
    expect(main.length).toBeGreaterThan(0);
    const town = freewayTown('pingtung');
    expect(city.net.segmentAt(town, 3, 0)).toBeTruthy();
    expect(T.region(town.x, town.y)).toBe('pingtung');
    expect(buildable(T, town)).toBe(true);
    expect(city.disconnectedRoads()).toHaveLength(0);
  });
});

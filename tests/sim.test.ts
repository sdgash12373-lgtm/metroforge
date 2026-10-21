import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/city';
import { curveIntersections, quadPoint, sampleQuad, splitQuad } from '../src/sim/geometry';
import { Zone } from '../src/sim/zoning';
import { angleGuides } from '../src/sim/angles';
import { alignToGuides } from '../src/sim/guides';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });
const snap = (city: City, x: number, y: number) => city.net.snap({ x, y }, 6);

describe('geometry', () => {
  it('splits a quadratic into two halves that meet on the curve', () => {
    const q = { a: { x: 0, y: 0 }, c: { x: 50, y: 100 }, b: { x: 100, y: 0 } };
    const [l, r] = splitQuad(q, 0.3);
    const m = quadPoint(q, 0.3);
    expect(l.b).toEqual(m);
    expect(r.a).toEqual(m);
    expect(quadPoint(l, 0.5).x).toBeCloseTo(quadPoint(q, 0.15).x, 6);
  });

  it('finds the crossing of two straight curves', () => {
    const a = sampleQuad({ a: { x: -10, y: 0 }, c: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
    const b = sampleQuad({ a: { x: 0, y: -10 }, c: { x: 0, y: 0 }, b: { x: 0, y: 10 } });
    const hits = curveIntersections(a, b);
    expect(hits).toHaveLength(1);
    expect(hits[0].ta).toBeCloseTo(0.5, 3);
  });
});

describe('road network', () => {
  it('turns a crossing into a four-way junction', () => {
    const city = new City();
    city.buildRoad(free(-100, 0), null, free(100, 0), true);
    city.buildRoad(free(0, -100), null, free(0, 100), true);
    expect(city.net.segments.size).toBe(4);
    const junction = [...city.net.nodes.values()].find((n) => Math.hypot(n.p.x, n.p.y) < 0.5);
    expect(junction).toBeDefined();
    expect(city.net.degree(junction!.id)).toBe(4);
  });

  it('splits a curved road at every road it crosses', () => {
    const city = new City();
    city.buildRoad(free(-100, 0), null, free(100, 0), true);
    // An arch that starts and ends below the avenue and crosses it twice
    city.buildRoad(free(-60, 40), { x: 0, y: -120 }, free(60, 40), true);
    expect(city.net.segments.size).toBe(3 + 3);
    const fourWay = [...city.net.nodes.values()].filter((n) => city.net.degree(n.id) === 4);
    expect(fourWay).toHaveLength(2);
  });

  it('makes a T junction when a road ends on another road', () => {
    const city = new City();
    city.buildRoad(free(-100, 0), null, free(100, 0), true);
    city.buildRoad(snap(city, 20, 2), null, free(20, 100), true);
    expect(city.net.segments.size).toBe(3);
    const t = [...city.net.nodes.values()].find((n) => city.net.degree(n.id) === 3);
    expect(t?.p.x).toBeCloseTo(20, 0);
  });

  it('removes orphaned nodes on bulldoze', () => {
    const city = new City();
    city.buildRoad(free(0, 0), null, free(100, 0), true);
    expect(city.bulldoze({ x: 50, y: 1 }, 5).ok).toBe(true);
    expect(city.net.segments.size).toBe(0);
    expect(city.net.nodes.size).toBe(0);
  });

  it('charges for roads and refuses when money runs out', () => {
    const city = new City();
    city.money = 1000;
    const r = city.buildRoad(free(0, 0), null, free(1000, 0));
    expect(r.ok).toBe(false);
    expect(city.net.segments.size).toBe(0);
    const ok = city.buildRoad(free(0, 0), null, free(40, 0));
    expect(ok.ok).toBe(true);
    expect(city.money).toBe(1000 - 800);
  });
});

describe('zoning', () => {
  it('creates 8 m cells, four deep, on both sides of a road', () => {
    const city = new City();
    city.buildRoad(free(0, 0), null, free(80, 0), true);
    const lots = [...city.net.segments.values()][0].lots;
    expect(lots).toHaveLength(10 * 2 * 4);
    expect(lots.every((l) => !l.blocked)).toBe(true);
  });

  it('blocks cells a crossing road runs through', () => {
    const city = new City();
    city.buildRoad(free(-80, 0), null, free(80, 0), true);
    city.buildRoad(free(0, -80), null, free(0, 80), true);
    for (const seg of city.net.segments.values()) {
      for (const lot of seg.lots) {
        if (lot.blocked) continue;
        // No usable cell may sit on the other road
        expect(Math.min(Math.abs(lot.x), Math.abs(lot.y))).toBeGreaterThan(5);
      }
    }
  });

  it('keeps zoning when a zoned road gets split by a new junction', () => {
    const city = new City();
    city.buildRoad(free(-100, 0), null, free(100, 0), true);
    city.paint({ x: 60, y: 10 }, 12, Zone.Commercial);
    const before = [...city.net.segments.values()].flatMap((s) => s.lots).filter((l) => l.zone === Zone.Commercial).length;
    city.buildRoad(snap(city, 0, 0), null, free(0, -100), true);
    const after = [...city.net.segments.values()].flatMap((s) => s.lots).filter((l) => l.zone === Zone.Commercial && !l.blocked).length;
    expect(before).toBeGreaterThan(0);
    expect(after).toBe(before);
  });

  it('grows buildings on zoned land', () => {
    const city = new City();
    city.buildRoad(free(-100, 0), null, free(100, 0), true);
    city.paint({ x: -50, y: 10 }, 30, Zone.ResidentialLow);
    city.paint({ x: 50, y: 10 }, 30, Zone.Commercial);
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 300; i++) city.tick(rng);
    expect(city.stats.buildings).toBeGreaterThan(10);
    expect(city.stats.population).toBeGreaterThan(0);
  });
});

describe('save', () => {
  it('round-trips roads, zoning and buildings', () => {
    const city = new City();
    city.buildRoad(free(-100, 0), { x: 0, y: -60 }, free(100, 0), true);
    city.buildRoad(free(0, -100), null, free(0, 100), true);
    city.paint({ x: 0, y: 20 }, 40, Zone.Office);
    for (let i = 0; i < 50; i++) city.tick();
    const data = JSON.parse(JSON.stringify(city.serialize()));
    const copy = City.deserialize(data);
    expect(copy.net.segments.size).toBe(city.net.segments.size);
    expect(copy.stats.buildings).toBe(city.measure().length && city.stats.buildings);
    expect(copy.serialize()).toEqual(city.serialize());
  });
});

describe('angle guides', () => {
  it('reports 90° for a road leaving a straight road at a right angle', () => {
    const city = new City();
    city.buildRoad(free(-100, 0), null, free(100, 0), true);
    const g = angleGuides(city.net, snap(city, 0, 1), null, free(0, 80));
    expect(g).toHaveLength(1);
    expect(g[0].degrees).toBeCloseTo(90, 0);
  });

  it('reports the smaller angle against a road end and measures both ends', () => {
    const city = new City();
    city.buildRoad(free(0, 0), null, free(100, 0), true);
    city.buildRoad(free(0, 100), null, free(100, 100), true);
    // From the end of the first road to the start of the second, at 45° to the first
    const g = angleGuides(city.net, snap(city, 100, 0), null, snap(city, 0, 100));
    expect(g).toHaveLength(2);
    expect(g[0].degrees).toBeCloseTo(45, 0);
    expect(g[1].degrees).toBeCloseTo(45, 0);
  });

  it('has no guide where the road starts on empty ground', () => {
    const city = new City();
    expect(angleGuides(city.net, free(0, 0), null, free(50, 0))).toHaveLength(0);
  });
});

describe('alignment guides', () => {
  it('lines a new road end up with the end of a parallel road', () => {
    const city = new City();
    city.buildRoad(free(0, 0), null, free(100, 0), true);
    // Drawing a parallel road 60 m away; the cursor stops 2 m short of the first road's end
    const r = alignToGuides(city.net, { x: 98, y: 60 }, 5);
    expect(r.p.x).toBeCloseTo(100, 6);
    expect(r.p.y).toBeCloseTo(60, 6);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].from).toEqual({ x: 100, y: 0 });
  });

  it('snaps to where two guides cross', () => {
    const city = new City();
    city.buildRoad(free(0, 0), null, free(100, 0), true);
    city.buildRoad(free(200, 100), null, free(200, 200), true);
    // Extension of road 1 (y = 0) meets the extension of road 2 (x = 200) at (200, 0)
    const r = alignToGuides(city.net, { x: 197, y: 3 }, 6);
    expect(r.p.x).toBeCloseTo(200, 6);
    expect(r.p.y).toBeCloseTo(0, 6);
    expect(r.lines).toHaveLength(2);
  });

  it('leaves points far from every guide alone', () => {
    const city = new City();
    city.buildRoad(free(0, 0), null, free(100, 0), true);
    const p = { x: 140, y: 47 };
    expect(alignToGuides(city.net, p, 5)).toEqual({ p, lines: [] });
  });
});

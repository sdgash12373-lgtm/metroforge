import { describe, expect, it } from 'vitest';
import { City, GATE, budgetTotals } from '../src/sim/city';
import { LEVELS, UNLOCK } from '../src/sim/levels';
import { roadWidth } from '../src/sim/roads';
import { Zone } from '../src/sim/zoning';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

function rng(seed = 5) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

function street(): City {
  const city = new City();
  city.money = 1e9;
  city.buildRoad(free(-400, 0), null, free(400, 0), true);
  city.addOutsideConnection([...city.net.nodes.values()].find((n) => n.p.x === -400)!.id);
  return city;
}

describe('city ranks and monthly finances', () => {
  it('balance is income less running and construction costs', () => {
    const city = street();
    city.paint({ x: 0, y: 30 }, 120, Zone.ResidentialLow);
    const r = rng();
    for (let i = 0; i < 400; i++) city.tick(r);
    const t = budgetTotals(city.budget);
    expect(t.income).toBeCloseTo(t.taxes + city.budget.subsidy + t.fees + t.other, 3);
    expect(t.balance).toBeCloseTo(t.income - t.running - city.budget.construction, 3);
  });

  it('only moves up when people, income and balance all clear the bar', () => {
    const city = street();
    expect(city.level).toBe(0);
    const next = city.nextLevel()!;
    expect(next.level.name).toBe(LEVELS[1].name);
    expect(next.ready).toBe(false);
    expect(city.upgrade()).toBe(false);
    expect(next.checks.map((c) => c.label)).toEqual(['人口', '每月收入', '每月結餘']);
  });

  it('survives a save', () => {
    const city = street();
    city.level = 3;
    const back = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    expect(back.level).toBe(3);
  });
});

describe('road upgrades', () => {
  it('stay locked until 縣轄市', () => {
    const city = street();
    const seg = [...city.net.segments.values()][0];
    const r = city.restyleRoad(seg.id, { lanes: 2 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain(LEVELS[UNLOCK.roadUpgrade].name);
  });

  it('widen the whole street, move lots back and keep their zoning, and are saved', () => {
    const city = street();
    city.level = UNLOCK.roadUpgrade;
    city.paint({ x: 0, y: 20 }, 60, Zone.Commercial);
    const seg = [...city.net.segments.values()][0];
    const zoned = seg.lots.filter((l) => l.zone === Zone.Commercial).length;
    const nearest = Math.min(...seg.lots.map((l) => Math.abs(l.y)));
    const money = city.money;
    const r = city.restyleRoad(seg.id, { lanes: 4 });
    expect(r.ok).toBe(true);
    expect(r.cost).toBeGreaterThan(0);
    expect(city.money).toBe(money - r.cost);
    const after = city.net.segments.get(seg.id)!;
    expect(after.lanes).toBe(4);
    expect(roadWidth(after)).toBe(31);
    expect(after.lots.filter((l) => l.zone === Zone.Commercial).length).toBe(zoned);
    expect(Math.min(...after.lots.map((l) => Math.abs(l.y)))).toBeCloseTo(nearest + 10.5, 3);
    expect(city.restyleRoad(seg.id, { walk: true }).ok).toBe(true);
    expect(city.restyleRoad(seg.id, { walk: true }).reason).toBe('已經是這個樣式');
    const back = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    const s2 = back.net.segments.get(seg.id)!;
    expect(s2.lanes).toBe(4);
    expect(s2.walk).toBe(true);
    expect(s2.lots.filter((l) => l.zone === Zone.Commercial).length).toBe(zoned);
  });

  it('carry more traffic side by side in their lanes', () => {
    const city = street();
    city.level = UNLOCK.roadUpgrade;
    const seg = [...city.net.segments.values()][0];
    city.restyleRoad(seg.id, { lanes: 2 });
    city.paint({ x: 0, y: 30 }, 200, Zone.ResidentialLow);
    city.paint({ x: 0, y: -30 }, 200, Zone.Industrial);
    const r = rng(9);
    for (let i = 0; i < 2000; i++) city.tick(r);
    const subs = new Set(city.traffic.vehicles.map((v) => v.sub ?? 0));
    expect(city.traffic.vehicles.length).toBeGreaterThan(0);
    expect([...subs].every((s) => s === 0 || s === 1)).toBe(true);
  });
});

describe('highway connection', () => {
  it('stays connected through road upgrades and footbridges, and finds the roads that are cut off', () => {
    const city = street();
    city.level = 4;
    city.buildRoad(free(0, 0), null, free(0, 200), true);
    city.buildRoad(free(300, 300), null, free(500, 300), true);
    city.paint({ x: 20, y: 100 }, 40, Zone.ResidentialLow);
    city.paint({ x: 400, y: 320 }, 40, Zone.ResidentialLow);
    const side = city.net.segmentAt({ x: 0, y: 100 }, 3)!.seg;
    city.restyleRoad(side.id, { lanes: 4, walk: true });
    const spot = city.facilitySpot('footbridge', { x: 0, y: 100 });
    expect(city.buildFacility('footbridge', spot.p, spot.angle).ok).toBe(true);
    city.tick(rng());
    const cut = city.disconnectedRoads();
    expect(cut).toHaveLength(1);
    expect(city.net.node(cut[0].a).p.y).toBe(300);
    expect(city.isConnected(city.net.segmentAt({ x: 0, y: 100 }, 3)!.seg)).toBe(true);
    const lots = city.disconnectedLots({ x: 0, y: 0 });
    expect(lots.length).toBe(city.stats.disconnected);
    expect(lots.every((p) => p.x >= 290)).toBe(true);
    // 拆除 on the bridge takes the bridge, not the road under it
    const roads = city.net.segments.size;
    expect(city.bulldoze(spot.p, 20).what).toBe('天橋');
    expect(city.net.segments.size).toBe(roads);
  });

  it('keeps roundabouts off the highway entry, and puts a lost entry back when a save loads', () => {
    const city = new City();
    city.money = 1e9;
    city.buildRoad(free(GATE.x, GATE.y), null, free(0, 0), true);
    const gate = [...city.net.nodes.values()].find((n) => n.p.x === GATE.x)!.id;
    city.addOutsideConnection(gate);
    city.paint({ x: -200, y: 60 }, 40, Zone.ResidentialLow);
    const r = city.buildRoundabout({ x: GATE.x + 20, y: GATE.y }, 4);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('高速公路');

    // What an earlier version did: the entry was cleared away and every road was cut off
    const save = city.serialize();
    save.outside = [999];
    const back = City.deserialize(JSON.parse(JSON.stringify(save)));
    expect([...back.outside]).toEqual([gate]);
    expect(back.disconnectedRoads()).toHaveLength(0);

    // Entry gone with no road near the gate: a short highway stub joins the nearest road
    const far = new City();
    far.money = 1e9;
    far.buildRoad(free(-300, 0), null, free(0, 0), true);
    const s2 = far.serialize();
    s2.outside = [999];
    const b2 = City.deserialize(JSON.parse(JSON.stringify(s2)));
    const entry = b2.net.node([...b2.outside][0]);
    expect(entry.p).toEqual(GATE);
    expect(b2.disconnectedRoads()).toHaveLength(0);
  });
});

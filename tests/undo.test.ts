import { describe, expect, it } from 'vitest';
import { City, type SaveData } from '../src/sim/city';
import { UNDO_STEPS, ToolController } from '../src/ui/tools';
import type { World } from '../src/render/world';

/** A map that only answers what the tools ask of it. */
function fakeWorld(): World {
  const rig = { snapRadius: 8, pickHeight: 0, target: { x: 0, y: 0 }, toGround: () => null };
  return new Proxy({ rig } as object, { get: (t, k) => (k in t ? (t as never)[k] : () => {}) }) as World;
}

function setup() {
  const box = { city: new City() };
  box.city.money = 1e9;
  const toasts: string[] = [];
  const tools: ToolController = new ToolController(box.city, fakeWorld(), {
    toast: (m) => toasts.push(m),
    changed: () => {},
    restore: (data: SaveData, cost: number) => {
      const back = City.deserialize(data);
      back.money = box.city.money + cost;
      back.steps = box.city.steps;
      box.city = back;
      tools.setCity(back);
    },
  });
  return { box, tools, toasts };
}

describe('上一步', () => {
  it('takes back the last road built, with its cost, and only that one step', () => {
    const { box, tools } = setup();
    tools.setTool('road');
    expect(tools.canUndo).toBe(false);
    const roads = box.city.net.segments.size;
    tools.onTap({ x: -100, y: 200 });
    expect(tools.canUndo).toBe(false); // only the start point so far
    tools.onTap({ x: 100, y: 200 });
    const first = box.city.net.segments.size;
    expect(first).toBeGreaterThan(roads);
    tools.cancel();
    tools.onTap({ x: -100, y: 400 });
    tools.onTap({ x: 100, y: 400 });
    expect(box.city.net.segments.size).toBeGreaterThan(first);
    const before = box.city.money;
    expect(tools.canUndo).toBe(true);
    expect(tools.undo()).toBe(true);
    expect(box.city.net.segments.size).toBe(first);
    expect(box.city.money).toBeGreaterThan(before);
    // Only one step back
    expect(tools.canUndo).toBe(false);
    expect(tools.undo()).toBe(false);
    expect(box.city.net.segments.size).toBe(first);
  });

  it('puts back what was demolished and takes its refund back', () => {
    const { box, tools } = setup();
    tools.setTool('road');
    tools.onTap({ x: -100, y: 200 });
    tools.onTap({ x: 100, y: 200 });
    tools.cancel();
    const n = box.city.net.segments.size;
    tools.setTool('bulldoze');
    const money = box.city.money;
    tools.onTap({ x: 0, y: 200 });
    expect(box.city.net.segments.size).toBeLessThan(n);
    const refunded = box.city.money - money;
    tools.undo();
    expect(box.city.net.segments.size).toBe(n);
    expect(box.city.money).toBeCloseTo(money, 0);
    expect(refunded).toBeGreaterThanOrEqual(0);
  });

  it('takes back a brush stroke of zoning', () => {
    const { box, tools } = setup();
    tools.setTool('road');
    tools.onTap({ x: -100, y: 200 });
    tools.onTap({ x: 100, y: 200 });
    tools.cancel();
    tools.setTool('zone');
    const zoned = () => [...box.city.net.segments.values()].flatMap((s) => s.lots).filter((l) => l.zone).length;
    expect(zoned()).toBe(0);
    tools.setPainting(true);
    tools.onPaint({ x: -40, y: 205 });
    tools.onPaint({ x: 40, y: 205 });
    tools.setPainting(false);
    expect(zoned()).toBeGreaterThan(0);
    tools.undo();
    expect(zoned()).toBe(0);
    expect(box.city.net.segments.size).toBeGreaterThan(0);
  });

  it('lapses after a while, and when the city changes some other way', () => {
    const { box, tools } = setup();
    tools.setTool('road');
    tools.onTap({ x: -100, y: 200 });
    tools.onTap({ x: 100, y: 200 });
    expect(tools.canUndo).toBe(true);
    box.city.steps += UNDO_STEPS + 1;
    expect(tools.canUndo).toBe(false);
    tools.cancel();
    tools.onTap({ x: -100, y: 400 });
    tools.onTap({ x: 100, y: 400 });
    expect(tools.canUndo).toBe(true);
    const seg = [...box.city.net.segments.values()].find((s) => !s.highway)!;
    box.city.nameStreet(seg.id, '中山路');
    expect(tools.canUndo).toBe(false);
  });
});

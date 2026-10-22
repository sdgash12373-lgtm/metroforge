import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/city';
import { KAOHSIUNG } from '../src/sim/terrain';
import { AUTO_SLOT, LEGACY_KEY, MemoryStore, SLOTS, SaveSlots } from '../src/storage/saves';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

function town(name = '港都'): City {
  const city = new City(KAOHSIUNG);
  city.name = name;
  city.buildRoad(free(0, 0), null, free(200, 0), true);
  city.money = 12345;
  return city;
}

function clock() {
  let t = 1000;
  return () => (t += 1000);
}

describe('save slots', () => {
  it('save, list, load and delete cities in slots', async () => {
    const slots = new SaveSlots(new MemoryStore(), clock());
    expect((await slots.list()).map((s) => s.id)).toEqual([AUTO_SLOT, ...SLOTS]);
    expect((await slots.list()).every((s) => s.info === null)).toBe(true);
    await slots.save('slot2', town('港都'), 'data:image/jpeg;base64,xx');
    const info = (await slots.info('slot2'))!;
    expect([info.name, info.money, info.terrain, info.thumb]).toEqual(['港都', 12345, 'kaohsiung', 'data:image/jpeg;base64,xx']);
    const back = await slots.load('slot2');
    expect([back.name, back.money, back.net.segments.size, back.terrain.name]).toEqual(['港都', 12345, 1, 'kaohsiung']);
    expect(await slots.freeSlot()).toBe('slot1');
    await slots.remove('slot2');
    expect(await slots.info('slot2')).toBeNull();
    await expect(slots.load('slot2')).rejects.toThrow();
  });

  it('pick the latest save to continue, and rename a city in its save', async () => {
    const slots = new SaveSlots(new MemoryStore(), clock());
    await slots.save('slot1', town('甲'));
    await slots.save(AUTO_SLOT, town('乙'));
    expect((await slots.latest())?.id).toBe(AUTO_SLOT);
    await slots.save('slot1', town('甲'));
    expect((await slots.latest())?.id).toBe('slot1');
    await slots.rename('slot1', '  新興區  ');
    expect((await slots.info('slot1'))?.name).toBe('新興區');
    expect((await slots.load('slot1')).name).toBe('新興區');
  });

  it('export a slot to a file and import it into another', async () => {
    const slots = new SaveSlots(new MemoryStore(), clock());
    await slots.save('slot1', town('前鎮'));
    const file = (await slots.exportSlot('slot1'))!;
    expect(file.filename).toBe('前鎮.skyline.json');
    const other = new SaveSlots(new MemoryStore(), clock());
    await other.importText(file.text, 'slot3');
    expect((await other.load('slot3')).name).toBe('前鎮');
    await expect(other.importText('{"nope":1}', 'slot4')).rejects.toThrow();
    expect(await other.info('slot4')).toBeNull();
  });

  it('move the old single save into the auto slot once', async () => {
    const legacy = new Map<string, string>([[LEGACY_KEY, JSON.stringify(town('舊城').serialize())]]);
    const storage = { getItem: (k: string) => legacy.get(k) ?? null, removeItem: (k: string) => void legacy.delete(k) };
    const slots = new SaveSlots(new MemoryStore(), clock());
    expect(await slots.migrateLegacy(storage)).toBe(true);
    expect((await slots.info(AUTO_SLOT))?.name).toBe('舊城');
    expect(legacy.has(LEGACY_KEY)).toBe(false);
    expect(await slots.migrateLegacy(storage)).toBe(false);
  });
});

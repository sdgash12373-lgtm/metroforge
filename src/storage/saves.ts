import { City, type SaveData } from '../sim/city';

/** A key–value store for save slots: IndexedDB in the browser, memory in tests. */
export interface SlotStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const AUTO_SLOT = 'auto';
export const SLOTS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'];
const ALL_SLOTS = [AUTO_SLOT, ...SLOTS];
/** where saves lived before save slots */
export const LEGACY_KEY = 'skyline-city:save';
const EXPORT_FORMAT = 'skyline-city';

export interface SlotInfo {
  id: string;
  name: string;
  population: number;
  money: number;
  day: number;
  /** ms since epoch */
  savedAt: number;
  terrain: string;
  /** small JPEG data URL of the view when it was saved */
  thumb?: string;
}

export const slotLabel = (id: string): string => (id === AUTO_SLOT ? '自動存檔' : `存檔 ${SLOTS.indexOf(id) + 1}`);

function info(id: string, city: City, savedAt: number, thumb?: string): SlotInfo {
  return {
    id,
    name: city.name,
    population: city.stats.population,
    money: Math.round(city.money),
    day: city.day,
    savedAt,
    terrain: city.terrain.name,
    ...(thumb ? { thumb } : {}),
  };
}

/** Save slots: a manual few plus one the game writes on its own. */
export class SaveSlots {
  constructor(
    private store: SlotStore,
    private now: () => number = Date.now,
  ) {}

  /** Every slot, empty ones as null, the auto slot first. */
  async list(): Promise<{ id: string; info: SlotInfo | null }[]> {
    return Promise.all(ALL_SLOTS.map(async (id) => ({ id, info: await this.info(id) })));
  }

  async info(id: string): Promise<SlotInfo | null> {
    const raw = await this.store.get(`meta:${id}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SlotInfo;
    } catch {
      return null;
    }
  }

  /** The slot saved most recently, for 繼續遊戲. */
  async latest(): Promise<SlotInfo | null> {
    let best: SlotInfo | null = null;
    for (const { info } of await this.list()) if (info && (!best || info.savedAt > best.savedAt)) best = info;
    return best;
  }

  async save(id: string, city: City, thumb?: string): Promise<SlotInfo> {
    const meta = info(id, city, this.now(), thumb);
    await this.store.set(`data:${id}`, JSON.stringify(city.serialize()));
    await this.store.set(`meta:${id}`, JSON.stringify(meta));
    return meta;
  }

  async load(id: string): Promise<City> {
    const raw = await this.store.get(`data:${id}`);
    if (!raw) throw new Error(`empty slot ${id}`);
    return City.deserialize(JSON.parse(raw) as SaveData);
  }

  async remove(id: string): Promise<void> {
    await this.store.delete(`data:${id}`);
    await this.store.delete(`meta:${id}`);
  }

  /** Renames the city kept in a slot, inside the save too, so it keeps the name when loaded. */
  async rename(id: string, name: string): Promise<void> {
    const meta = await this.info(id);
    const raw = await this.store.get(`data:${id}`);
    if (!meta || !raw) return;
    const clean = name.trim().slice(0, 24) || meta.name;
    const data = JSON.parse(raw) as SaveData;
    data.name = clean;
    await this.store.set(`data:${id}`, JSON.stringify(data));
    await this.store.set(`meta:${id}`, JSON.stringify({ ...meta, name: clean }));
  }

  /** The first manual slot with nothing in it. */
  async freeSlot(): Promise<string | null> {
    for (const id of SLOTS) if (!(await this.info(id))) return id;
    return null;
  }

  /** A slot as a file to keep or move to another device. */
  async exportSlot(id: string): Promise<{ filename: string; text: string } | null> {
    const raw = await this.store.get(`data:${id}`);
    const meta = await this.info(id);
    if (!raw || !meta) return null;
    const text = JSON.stringify({ format: EXPORT_FORMAT, name: meta.name, data: JSON.parse(raw) as SaveData });
    return { filename: `${meta.name.replace(/[\\/:*?"<>|]/g, '_')}.skyline.json`, text };
  }

  /** Reads an exported file (or a bare save) into a slot. Throws if it is not a city. */
  async importText(text: string, id: string): Promise<SlotInfo> {
    const parsed = JSON.parse(text) as { format?: string; data?: SaveData } & Partial<SaveData>;
    const data = (parsed.format === EXPORT_FORMAT ? parsed.data : parsed) as SaveData;
    const city = City.deserialize(data);
    return this.save(id, city);
  }

  /** Moves the single save from before slots into the auto slot, once. */
  async migrateLegacy(legacy: Pick<Storage, 'getItem' | 'removeItem'> | null): Promise<boolean> {
    let raw: string | null = null;
    try {
      raw = legacy?.getItem(LEGACY_KEY) ?? null;
    } catch {
      return false;
    }
    if (!raw) return false;
    try {
      const city = City.deserialize(JSON.parse(raw) as SaveData);
      if (!(await this.info(AUTO_SLOT))) await this.save(AUTO_SLOT, city);
    } catch (err) {
      console.warn('Could not move the old save', err);
      return false;
    }
    legacy?.removeItem(LEGACY_KEY);
    return true;
  }
}

export class MemoryStore implements SlotStore {
  readonly data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key);
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
  }
  async delete(key: string) {
    this.data.delete(key);
  }
}

/** Saves in IndexedDB, which holds far more than localStorage's few megabytes. */
export class IdbStore implements SlotStore {
  private db: Promise<IDBDatabase>;
  constructor(name = 'skyline-city') {
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('saves');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  private async run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const req = f(db.transaction('saves', mode).objectStore('saves'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async get(key: string) {
    return (await this.run('readonly', (s) => s.get(key))) as string | undefined;
  }
  async set(key: string, value: string) {
    await this.run('readwrite', (s) => s.put(value, key));
  }
  async delete(key: string) {
    await this.run('readwrite', (s) => s.delete(key));
  }
  /** Resolves once the database opened, or rejects where IndexedDB is blocked. */
  async ready(): Promise<void> {
    await this.db;
  }
}

/** Fallback where IndexedDB is unavailable. */
export class LocalStore implements SlotStore {
  async get(key: string) {
    return localStorage.getItem(`skyline-city:${key}`) ?? undefined;
  }
  async set(key: string, value: string) {
    localStorage.setItem(`skyline-city:${key}`, value);
  }
  async delete(key: string) {
    localStorage.removeItem(`skyline-city:${key}`);
  }
}

/** The best store this browser offers. */
export async function openStore(): Promise<SlotStore> {
  try {
    const idb = new IdbStore();
    await idb.ready();
    return idb;
  } catch {
    // Blocked IndexedDB: localStorage if that works, else saves last only while the page is open
    try {
      localStorage.setItem('skyline-city:probe', '1');
      localStorage.removeItem('skyline-city:probe');
      return new LocalStore();
    } catch {
      return new MemoryStore();
    }
  }
}

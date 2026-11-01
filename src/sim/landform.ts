import type { Vec2 } from './geometry';
import { type Bounds, type RegionName, type Terrain, type TerrainName, WATER_LEVEL } from './terrain';

/** 整地 works on the ground's own corner grid: corners this many meters apart, from the map's lower corner. */
export const LAND_STEP = 20;
/** How far one dab of the brush moves the ground at its centre (meters): hills come down a layer at a time. */
export const LAYER = 1.5;
/** 下挖 goes no deeper than this (a lake's floor), 填高 no higher than this. */
export const DIG_FLOOR = -8;
export const RAISE_TOP = 120;
/** A tunnel bore is this wide each side of its line; its approaches are cut down to the plain below this height. */
export const BORE_HALF = 12;
export const PORTAL_HEIGHT = 16;
/** Bore ends this close to water carry it through, to a lake dug at the other end. */
const BORE_REACH = 40;

export type LandMode = 'level' | 'raise' | 'dig';

export interface Bore {
  a: Vec2;
  b: Vec2;
}

/** What a save keeps of the reshaped land: changed corners (i, j, meters) and tunnels (ax, ay, bx, by). */
export interface LandSave {
  d: [number, number, number][];
  bores?: [number, number, number, number][];
}

/**
 * The land a city stands on, as reshaped by 整地: the map's own terrain plus a height change at each corner of
 * the ground grid (between corners it is blended), tunnels bored through hills, and the dug pits water has
 * reached. Untouched land answers straight from the map.
 */
export class Landform implements Terrain {
  readonly name: TerrainName;
  readonly bounds: Bounds;
  readonly regions: RegionName[];
  /** change in height per corner, by corner key */
  private readonly d = new Map<number, number>();
  /** cells with a changed corner, by cell key: only these are drawn and checked differently */
  private readonly cells = new Set<number>();
  /** dug cells water has reached */
  private readonly wet = new Set<number>();
  readonly bores: Bore[] = [];
  /** the part of the map changed so far (in corners), for a quick answer everywhere else */
  box: CornerBox | null = null;
  /** bumped on every change, so caches know */
  version = 0;

  constructor(readonly base: Terrain) {
    this.name = base.name;
    this.bounds = base.bounds;
    this.regions = base.regions;
  }

  get edited(): boolean {
    return this.d.size > 0 || this.bores.length > 0;
  }

  /** Corner indices of a point (fractional). */
  gi(x: number): number {
    return (x - this.bounds.minX) / LAND_STEP;
  }

  gj(y: number): number {
    return (y - this.bounds.minY) / LAND_STEP;
  }

  cornerX(i: number): number {
    return this.bounds.minX + i * LAND_STEP;
  }

  cornerY(j: number): number {
    return this.bounds.minY + j * LAND_STEP;
  }

  static key(i: number, j: number): number {
    return i * 65536 + j;
  }

  /** The height change at a corner. */
  cornerDelta(i: number, j: number): number {
    return this.d.get(Landform.key(i, j)) ?? 0;
  }

  /** Whether the ground cell holding a point (or with corner i, j) has been reshaped. */
  touched(x: number, y: number): boolean {
    if (!this.box) return false;
    return this.cells.has(Landform.key(Math.floor(this.gi(x)), Math.floor(this.gj(y))));
  }

  touchedCell(i: number, j: number): boolean {
    return this.cells.has(Landform.key(i, j));
  }

  /**
   * Untouched land is the map's own; a reshaped cell is the two flat triangles between its corners, as the
   * ground is drawn, so ground brought to the plain at its corners is level all across.
   */
  height(x: number, y: number): number {
    if (!this.box) return this.base.height(x, y);
    const fi = this.gi(x);
    const fj = this.gj(y);
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    if (!this.cells.has(Landform.key(i, j))) return this.base.height(x, y);
    const u = fi - i;
    const v = fj - j;
    const h00 = this.corner(i, j);
    const h10 = this.corner(i + 1, j);
    const h01 = this.corner(i, j + 1);
    const h11 = this.corner(i + 1, j + 1);
    if (u + v <= 1) return h00 + u * (h10 - h00) + v * (h01 - h00);
    return h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
  }

  /** A corner's height, reshaped. */
  corner(i: number, j: number): number {
    return this.baseCorner(i, j) + this.cornerDelta(i, j);
  }

  water(x: number, y: number): boolean {
    if (!this.touched(x, y)) return this.base.water(x, y);
    if (this.height(x, y) >= WATER_LEVEL) return false;
    return this.base.water(x, y) || this.wet.has(Landform.key(Math.floor(this.gi(x)), Math.floor(this.gj(y))));
  }

  sea(x: number, y: number): boolean {
    return this.base.sea(x, y) && this.water(x, y);
  }

  region(x: number, y: number): RegionName | null {
    return this.base.region(x, y);
  }

  /** Whether p is inside a tunnel bore, where roads go through the hill whatever its height. */
  bored(p: Vec2): boolean {
    return this.bores.some((b) => boreDistance(b, p) <= BORE_HALF);
  }

  /** Sets a corner's height change (the corner's height becomes base + delta). */
  setCorner(i: number, j: number, delta: number): void {
    const k = Landform.key(i, j);
    if (Math.abs(delta) < 1e-3) {
      if (!this.d.has(k)) return;
      this.d.delete(k);
    } else this.d.set(k, delta);
    for (let a = i - 1; a <= i; a++) for (let b = j - 1; b <= j; b++) this.cells.add(Landform.key(a, b));
    this.box = grow(this.box, i, j);
    this.dirty = grow(this.dirty, i, j);
    this.version++;
  }

  addBore(a: Vec2, b: Vec2): void {
    this.bores.push({ a: { ...a }, b: { ...b } });
    this.version++;
  }

  /** Corners changed since the drawing last asked, for it to redraw only that part. */
  private dirty: CornerBox | null = null;

  takeDirty(): CornerBox | null {
    const d = this.dirty;
    this.dirty = null;
    return d;
  }

  /** The base height at a corner. */
  baseCorner(i: number, j: number): number {
    const k = Landform.key(i, j);
    let h = this.baseCorners.get(k);
    if (h === undefined) this.baseCorners.set(k, (h = this.base.height(this.cornerX(i), this.cornerY(j))));
    return h;
  }

  private readonly baseCorners = new Map<number, number>();

  /**
   * Works out which dug cells water has reached: those below the waterline joined to the sea, a river or a
   * lake through other dug cells, or through a tunnel bore that has water at its other end.
   */
  settleWater(): void {
    this.wet.clear();
    if (!this.cells.size) return;
    const centre = (k: number): [number, number] => [this.cornerX(Math.floor(k / 65536) + 0.5), this.cornerY((k % 65536) + 0.5)];
    const low = (k: number) => {
      const [x, y] = centre(k);
      return this.height(x, y) < WATER_LEVEL;
    };
    // Water already there: untouched cells' own, and touched cells that were under water to begin with
    const waterAt = (i: number, j: number) => {
      const k = Landform.key(i, j);
      const [x, y] = centre(k);
      if (!this.cells.has(k)) return this.base.water(x, y);
      return this.wet.has(k) || (low(k) && this.base.water(x, y));
    };
    const todo: number[] = [];
    const flood = (k: number) => {
      if (this.wet.has(k) || !this.cells.has(k) || !low(k)) return;
      this.wet.add(k);
      todo.push(k);
    };
    for (const k of this.cells) {
      if (!low(k)) continue;
      const i = Math.floor(k / 65536);
      const j = k % 65536;
      if (waterAt(i, j) || waterAt(i + 1, j) || waterAt(i - 1, j) || waterAt(i, j + 1) || waterAt(i, j - 1)) flood(k);
    }
    const spread = () => {
      while (todo.length) {
        const k = todo.pop()!;
        const i = Math.floor(k / 65536);
        const j = k % 65536;
        flood(Landform.key(i + 1, j));
        flood(Landform.key(i - 1, j));
        flood(Landform.key(i, j + 1));
        flood(Landform.key(i, j - 1));
      }
    };
    spread();
    // Water runs through a tunnel from an end that has it to dug ground at the other end, and on from there
    const reach = Math.ceil(BORE_REACH / LAND_STEP);
    const near = (p: Vec2, f: (i: number, j: number) => void) => {
      const ci = Math.floor(this.gi(p.x));
      const cj = Math.floor(this.gj(p.y));
      for (let i = ci - reach; i <= ci + reach; i++) for (let j = cj - reach; j <= cj + reach; j++) f(i, j);
    };
    const hasWater = (p: Vec2) => {
      let yes = false;
      near(p, (i, j) => (yes ||= waterAt(i, j)));
      return yes;
    };
    for (let round = 0; round <= this.bores.length; round++) {
      const before = this.wet.size;
      for (const b of this.bores) {
        for (const [from, to] of [[b.a, b.b], [b.b, b.a]] as const) {
          if (hasWater(from)) near(to, (i, j) => flood(Landform.key(i, j)));
        }
      }
      spread();
      if (this.wet.size === before) break;
    }
  }

  /** The changes, for a save (nothing if the land is as the map made it). */
  save(): LandSave | undefined {
    if (!this.edited) return undefined;
    const r = (v: number) => Math.round(v * 100) / 100;
    return {
      d: [...this.d].map(([k, v]) => [Math.floor(k / 65536), k % 65536, r(v)]),
      bores: this.bores.length ? this.bores.map((b) => [r(b.a.x), r(b.a.y), r(b.b.x), r(b.b.y)]) : undefined,
    };
  }

  load(data: LandSave | undefined): void {
    if (!data) return;
    for (const [i, j, v] of data.d ?? []) if (i >= 0 && j >= 0 && Number.isFinite(v)) this.setCorner(i, j, v);
    for (const [ax, ay, bx, by] of data.bores ?? []) this.addBore({ x: ax, y: ay }, { x: bx, y: by });
    this.settleWater();
  }

  /** Every touched cell, as (i, j). */
  *touchedCells(): Iterable<[number, number]> {
    for (const k of this.cells) yield [Math.floor(k / 65536), k % 65536];
  }
}

export interface CornerBox {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

function grow(box: CornerBox | null, i: number, j: number): CornerBox {
  if (!box) return { i0: i, j0: j, i1: i, j1: j };
  box.i0 = Math.min(box.i0, i);
  box.j0 = Math.min(box.j0, j);
  box.i1 = Math.max(box.i1, i);
  box.j1 = Math.max(box.j1, j);
  return box;
}

/** Distance from p to a bore's line. */
export function boreDistance(b: Bore, p: Vec2): number {
  const dx = b.b.x - b.a.x;
  const dy = b.b.y - b.a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - b.a.x) * dx + (p.y - b.a.y) * dy) / l2));
  return Math.hypot(b.a.x + dx * t - p.x, b.a.y + dy * t - p.y);
}

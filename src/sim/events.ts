import { type Vec2, clamp } from './geometry';

/**
 * 巨蛋活動: once the city has an arena, promoters offer it concerts, domestic sports finals and music
 * festivals at random. The player takes or turns each one down, seeing how keen residents are on it.
 * A keen crowd fills the arena and the city earns venue fees, entertainment tax and visitors' spending;
 * a cold one leaves the city paying more for staging and security than it takes. Fans who cannot reach
 * the arena by train or bus drive, jamming the streets round it. Two bookings that overlap split the
 * crowd and cost the goodwill of residents (民眾好感度) and promoters (廠商好感度).
 */
export type EventKind = 'concert' | 'sports' | 'festival';

export interface EventKindSpec {
  label: string;
  icon: string;
  /** seats, or tickets for a festival on the arena's grounds */
  capacity: number;
  /** hours the doors are open */
  hours: number;
  /** hour of day it starts */
  startHour: number;
  /** staging, security and cleaning the city pays, NT$, from–to */
  cost: [number, number];
  /** what the city takes per head in venue fees and entertainment tax, NT$ */
  take: number;
  /** how keen people usually are, from–to */
  keen: [number, number];
  names: string[];
}

export const EVENT_KINDS: Record<EventKind, EventKindSpec> = {
  concert: {
    label: '演唱會',
    icon: '🎤',
    capacity: 15000,
    hours: 4,
    startHour: 19,
    cost: [1_800_000, 3_400_000],
    take: 260,
    keen: [35, 98],
    names: ['天后世界巡迴演唱會', '搖滾天團演唱會', '偶像男團見面會', '金曲歌王演唱會', '跨年晚會', '民歌經典演唱會', '女團亞洲巡演', '台語金曲之夜'],
  },
  sports: {
    label: '運動賽事',
    icon: '🏀',
    capacity: 12000,
    hours: 3,
    startHour: 18,
    cost: [800_000, 1_600_000],
    take: 160,
    keen: [25, 90],
    names: ['職籃總冠軍賽', '企業排球聯賽決賽', '全國運動會開幕典禮', '羽球公開賽', '桌球國際邀請賽', '電競職業聯賽總決賽', '高中籃球聯賽冠軍戰', '拳擊錦標賽'],
  },
  festival: {
    label: '音樂祭',
    icon: '🎸',
    capacity: 20000,
    hours: 10,
    startHour: 12,
    cost: [1_400_000, 2_800_000],
    take: 190,
    keen: [20, 92],
    names: ['夏日搖滾音樂祭', '南台灣音樂祭', '電音派對', '獨立樂團音樂祭', '海港爵士音樂節', '原住民族音樂祭', '嘻哈音樂祭'],
  },
};
export const EVENT_KEYS = Object.keys(EVENT_KINDS) as EventKind[];

/** Visitors spend this much in town besides their ticket, NT$, and this share of the crowd comes from out of town. */
export const EVENT_SPEND = 400;
export const EVENT_VISITORS = 0.5;
/** People per car among fans who drive. */
export const FANS_PER_CAR = 2.5;
/** Goodwill both start at, out of 100. */
export const FAVOR_START = 70;
/** Two bookings closer than this many hours count as a clash (set-up and clearing out). */
export const CLASH_GAP_HOURS = 6;

export interface EventOffer {
  id: number;
  kind: EventKind;
  name: string;
  /** start, in game days */
  start: number;
  hours: number;
  /** what the city pays to host it, NT$ */
  cost: number;
  capacity: number;
  /** how keen residents are, 0..100 */
  keen: number;
  /** offers lapse unanswered at this game day */
  expires: number;
}

export interface Booking extends EventOffer {
  /** set when it starts: fans through the gates, and the share of them who drove */
  attendance?: number;
  drove?: number;
  /** it overlapped another booking */
  clash?: boolean;
}

export interface EventResult {
  id: number;
  kind: EventKind;
  name: string;
  /** when it ended, in game days */
  day: number;
  attendance: number;
  /** what the city made (or lost), NT$ */
  net: number;
  /** share of fans who drove, 0..1 */
  drove: number;
  clash: boolean;
}

export interface EventSave {
  offers: EventOffer[];
  booked: Booking[];
  history: EventResult[];
  publicFavor: number;
  vendorFavor: number;
  nextOffer: number;
  nextId: number;
}

/** Keenness in words, for the cards. */
export function keenLabel(keen: number): string {
  return keen >= 80 ? '非常熱烈' : keen >= 60 ? '熱烈' : keen >= 40 ? '普通' : keen >= 25 ? '冷淡' : '非常冷淡';
}

/** Fans through the gates at a keenness: a full house when everyone is keen, a thin crowd when nobody is. */
export function expectedAttendance(capacity: number, keen: number): number {
  return Math.round(capacity * Math.min(1, (keen / 100) ** 1.3 * 1.08));
}

/** What the city makes on a crowd, NT$: venue fees and tax, plus what visitors spend, less the staging cost. */
export function eventNet(o: Pick<EventOffer, 'kind' | 'cost'>, attendance: number): number {
  return Math.round(attendance * (EVENT_KINDS[o.kind].take + EVENT_SPEND * EVENT_VISITORS) - o.cost);
}

export const eventEnd = (e: Pick<EventOffer, 'start' | 'hours'>) => e.start + e.hours / 24;

/** Whether two bookings sit too close together for one arena. */
export function clashes(a: Pick<EventOffer, 'start' | 'hours'>, b: Pick<EventOffer, 'start' | 'hours'>): boolean {
  const gap = CLASH_GAP_HOURS / 24;
  return a.start < eventEnd(b) + gap && b.start < eventEnd(a) + gap;
}

/** What the city tells the book each step. */
export interface EventContext {
  day: number;
  /** the city has an arena */
  arena: boolean;
  /** 0..100 */
  happiness: number;
  population: number;
  /** share of fans who can come by train, metro, bus or bike, 0..1 */
  transit: number;
}

/** What happened this step, for the city and the HUD. */
export interface EventStep {
  /** money in or out this step, NT$ */
  money: number;
  /** fans arriving by car this step */
  cars: number;
  offered?: EventOffer;
  started?: Booking;
  ended?: EventResult;
}

/** The arena's diary: offers waiting for an answer, bookings, what past events made, and goodwill. */
export class EventBook {
  offers: EventOffer[] = [];
  booked: Booking[] = [];
  history: EventResult[] = [];
  publicFavor = FAVOR_START;
  vendorFavor = FAVOR_START;
  nextOffer = -1;
  nextId = 1;
  /** bumped whenever an offer, booking or result changes, so the panel redraws */
  version = 0;

  /** One step of the clock: new offers, lapsed ones, events starting, fans arriving and events ending. */
  step(ctx: EventContext, stepDays: number, rng: () => number): EventStep {
    const out: EventStep = { money: 0, cars: 0 };
    const { day } = ctx;
    // Offers lapse; nothing is offered without an arena
    const before = this.offers.length;
    this.offers = this.offers.filter((o) => o.expires > day);
    if (this.offers.length !== before) this.version++;
    if (ctx.arena) {
      if (this.nextOffer < 0) this.nextOffer = day + 0.15;
      if (day >= this.nextOffer && this.offers.length < 3) {
        out.offered = this.offer(ctx, rng);
        this.offers.push(out.offered);
        this.version++;
        // Promoters who like working with the city call more often
        this.nextOffer = day + (0.35 + 0.5 * rng()) * (1.5 - this.vendorFavor / 100);
      }
    }
    for (const b of this.booked) {
      if (b.attendance === undefined && day >= b.start) {
        // Doors open: a clash splits the crowd and costs goodwill on both sides
        const clash = this.booked.some((o) => o !== b && clashes(o, b));
        b.clash = clash;
        b.attendance = Math.round(expectedAttendance(b.capacity, b.keen) * (clash ? 0.55 : 1) * (ctx.arena ? 1 : 0));
        b.drove = 1 - ctx.transit;
        if (clash) {
          this.publicFavor = clamp(this.publicFavor - 8, 0, 100);
          this.vendorFavor = clamp(this.vendorFavor - 10, 0, 100);
        }
        out.started = b;
        this.version++;
      }
      // Fans drive in over the first two hours
      if (b.attendance !== undefined && day < b.start + 2 / 24) out.cars += ((b.attendance * (b.drove ?? 1)) / FANS_PER_CAR) * (stepDays / (2 / 24));
    }
    const done = this.booked.find((b) => b.attendance !== undefined && day >= eventEnd(b));
    if (done) {
      this.booked = this.booked.filter((b) => b !== done);
      const result: EventResult = {
        id: done.id,
        kind: done.kind,
        name: done.name,
        day,
        attendance: done.attendance!,
        net: eventNet(done, done.attendance!),
        drove: done.drove ?? 1,
        clash: !!done.clash,
      };
      out.money += result.net;
      // A full, smooth night pleases everyone; an empty hall puts promoters off; jams anger residents
      const full = result.attendance / done.capacity;
      if (!result.clash && full >= 0.6) {
        this.publicFavor = clamp(this.publicFavor + 2, 0, 100);
        this.vendorFavor = clamp(this.vendorFavor + 4, 0, 100);
      }
      if (full < 0.3) this.vendorFavor = clamp(this.vendorFavor - 3, 0, 100);
      if (result.drove > 0.6 && result.attendance > 4000) this.publicFavor = clamp(this.publicFavor - 3, 0, 100);
      this.history = [result, ...this.history].slice(0, 12);
      out.ended = result;
      this.version++;
    }
    return out;
  }

  private offer(ctx: EventContext, rng: () => number): EventOffer {
    const kind = EVENT_KEYS[Math.floor(rng() * EVENT_KEYS.length) % EVENT_KEYS.length];
    const spec = EVENT_KINDS[kind];
    // A show already on the books or on the table doesn't come round again
    const taken = new Set([...this.offers, ...this.booked].map((x) => x.name));
    const fresh = spec.names.filter((n) => !taken.has(n));
    const names = fresh.length ? fresh : spec.names;
    const name = names[Math.floor(rng() * names.length) % names.length];
    // Two to five days out, at the kind's usual hour
    const date = Math.floor(ctx.day) + 2 + Math.floor(rng() * 4);
    const start = date + spec.startHour / 24;
    // Happy residents and a big city turn out more; promoters who trust the city bring better acts
    const [lo, hi] = spec.keen;
    const keen = clamp(
      Math.round(lo + (hi - lo) * rng() + (ctx.happiness - 60) * 0.25 + (this.vendorFavor - FAVOR_START) * 0.2 + Math.min(6, ctx.population / 50000)),
      5,
      99,
    );
    const [c0, c1] = spec.cost;
    return {
      id: this.nextId++,
      kind,
      name,
      start,
      hours: spec.hours,
      cost: Math.round((c0 + (c1 - c0) * rng()) / 10000) * 10000,
      capacity: spec.capacity,
      keen,
      expires: Math.min(start - 0.5, ctx.day + 0.8),
    };
  }

  /** Bookings an offer would overlap. */
  clashesWith(id: number): Booking[] {
    const o = this.offers.find((x) => x.id === id);
    return o ? this.booked.filter((b) => clashes(b, o)) : [];
  }

  /** Takes an offer; it is booked even if it clashes (the player was warned). */
  accept(id: number): Booking | null {
    const o = this.offers.find((x) => x.id === id);
    if (!o) return null;
    this.offers = this.offers.filter((x) => x !== o);
    const b: Booking = { ...o };
    this.booked.push(b);
    this.booked.sort((a, c) => a.start - c.start);
    this.version++;
    return b;
  }

  decline(id: number): void {
    this.offers = this.offers.filter((x) => x.id !== id);
    this.version++;
  }

  /** What events made over the last `days` days, NT$. */
  recentNet(day: number, days: number): number {
    return this.history.filter((r) => r.day > day - days).reduce((s, r) => s + r.net, 0);
  }

  save(): EventSave {
    return {
      offers: this.offers,
      booked: this.booked,
      history: this.history,
      publicFavor: Math.round(this.publicFavor),
      vendorFavor: Math.round(this.vendorFavor),
      nextOffer: this.nextOffer,
      nextId: this.nextId,
    };
  }

  load(s: EventSave): void {
    this.offers = s.offers ?? [];
    this.booked = s.booked ?? [];
    this.history = s.history ?? [];
    this.publicFavor = s.publicFavor ?? FAVOR_START;
    this.vendorFavor = s.vendorFavor ?? FAVOR_START;
    this.nextOffer = s.nextOffer ?? -1;
    this.nextId = s.nextId ?? 1;
    this.version++;
  }
}

/** Where an arena's fans arrive, and how they can get there without a car. */
export interface ArenaAccess {
  p: Vec2;
  /** share of fans who come by train, metro, bus or bike, 0..1 */
  transit: number;
  /** what serves it, for the panel */
  modes: string[];
}

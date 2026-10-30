import { describe, expect, it } from 'vitest';
import { City, DAY_STEPS } from '../src/sim/city';
import { EVENT_KINDS, EventBook, type EventContext, FAVOR_START, backToBack, clashes, delayRisk, eventNet, expectedAttendance } from '../src/sim/events';
import { Zone } from '../src/sim/zoning';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

function rng(seed = 3) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

const ctx = (day: number, extra: Partial<EventContext> = {}): EventContext => ({ day, arena: true, happiness: 60, population: 50000, transit: 0, ...extra });

/** Runs the book from `from` to `to` game days, returning the money it made and the cars it sent. */
function run(book: EventBook, from: number, to: number, extra: Partial<EventContext> = {}, r = rng()) {
  let money = 0;
  let cars = 0;
  for (let d = from; d < to; d += 1 / DAY_STEPS) {
    const s = book.step(ctx(d, extra), 1 / DAY_STEPS, r);
    money += s.money;
    cars += s.cars;
  }
  return { money, cars };
}

describe('巨蛋活動', () => {
  it('only offers events once there is an arena', () => {
    const book = new EventBook();
    run(book, 0, 2, { arena: false });
    expect(book.offers).toHaveLength(0);
    run(book, 2, 3);
    expect(book.offers.length).toBeGreaterThan(0);
    const o = book.offers[0];
    expect(EVENT_KINDS[o.kind].names).toContain(o.name);
    expect(o.start).toBeGreaterThan(3);
    expect(o.keen).toBeGreaterThanOrEqual(5);
  });

  it('a keen crowd earns money and a cold one loses it', () => {
    const offer = { kind: 'concert' as const, cost: 2_500_000 };
    expect(eventNet(offer, expectedAttendance(15000, 90))).toBeGreaterThan(0);
    expect(eventNet(offer, expectedAttendance(15000, 20))).toBeLessThan(0);
  });

  it('holds a booked event, pays out at the end and sends fewer cars when transit serves the arena', () => {
    const play = (transit: number) => {
      const book = new EventBook();
      book.offers.push({ id: 1, kind: 'concert', name: '跨年晚會', start: 1.8, hours: 4, cost: 2_000_000, capacity: 15000, keen: 85, expires: 1.5 });
      book.accept(1);
      const r = run(book, 1, 2.2, { transit });
      return { ...r, book };
    };
    const car = play(0);
    const rail = play(0.7);
    expect(car.book.booked).toHaveLength(0);
    expect(car.book.history[0].attendance).toBe(expectedAttendance(15000, 85));
    expect(car.money).toBe(car.book.history[0].net);
    expect(car.money).toBeGreaterThan(0);
    expect(rail.cars).toBeLessThan(car.cars * 0.4);
    // A full house with jams on every road: promoters are pleased, residents less so
    expect(car.book.vendorFavor).toBeGreaterThan(FAVOR_START);
    expect(car.book.publicFavor).toBeLessThan(rail.book.publicFavor);
  });

  it('two bookings that clash split the crowd and cost goodwill', () => {
    const book = new EventBook();
    book.offers.push({ id: 1, kind: 'concert', name: 'A', start: 1.8, hours: 4, cost: 2_000_000, capacity: 15000, keen: 85, expires: 1.5 });
    book.offers.push({ id: 2, kind: 'sports', name: 'B', start: 1.85, hours: 3, cost: 1_000_000, capacity: 12000, keen: 85, expires: 1.5 });
    book.accept(1);
    expect(book.clashesWith(2).map((b) => b.name)).toEqual(['A']);
    book.accept(2);
    run(book, 1, 2.2, { transit: 0.8 });
    expect(book.history.every((r) => r.clash)).toBe(true);
    expect(book.history.find((r) => r.name === 'A')!.attendance).toBeLessThan(expectedAttendance(15000, 85));
    expect(book.publicFavor).toBeLessThan(FAVOR_START);
    expect(book.vendorFavor).toBeLessThan(FAVOR_START);
  });

  it('同日接檔: two shows on one day both fill up, but the first can hold up the second', () => {
    const afternoon = { start: 1 + 13 / 24, hours: 3 };
    const evening = { start: 1 + 19 / 24, hours: 4 };
    expect(clashes(afternoon, evening)).toBe(false);
    expect(backToBack(afternoon, evening)).toBeCloseTo(3);
    expect(backToBack(afternoon, { start: 3, hours: 4 })).toBeNull();
    // Riskier with a short gap and a crowd that drove
    expect(delayRisk(1.5, 1, 1).any).toBeGreaterThan(delayRisk(5, 1, 1).any);
    expect(delayRisk(3, 0.1, 1).any).toBeLessThan(delayRisk(3, 1, 1).any);
    const play = (roll: number) => {
      const book = new EventBook();
      book.offers.push({ id: 1, kind: 'sports', name: 'A', ...afternoon, cost: 1_000_000, capacity: 12000, keen: 85, expires: 1 });
      book.offers.push({ id: 2, kind: 'concert', name: 'B', ...evening, cost: 2_000_000, capacity: 15000, keen: 85, expires: 1 });
      book.accept(1);
      book.accept(2);
      expect(book.clashesWith(2)).toHaveLength(0);
      expect(book.backToBackWith(book.booked[1]).map((x) => x.other.name)).toEqual(['A']);
      run(book, 1, 2.2, {}, () => roll);
      return book;
    };
    const smooth = play(0.99);
    expect(smooth.history.every((r) => !r.clash && !r.delayed)).toBe(true);
    expect(smooth.history.find((r) => r.name === 'B')!.attendance).toBe(expectedAttendance(15000, 85));
    const late = play(0);
    const b = late.history.find((r) => r.name === 'B')!;
    expect(b.delayed).toBeGreaterThan(0);
    expect(b.attendance).toBeLessThan(expectedAttendance(15000, 85));
    expect(b.net).toBeLessThan(smooth.history.find((r) => r.name === 'B')!.net);
    expect(late.vendorFavor).toBeLessThan(smooth.vendorFavor);
    expect(late.publicFavor).toBeLessThan(smooth.publicFavor);
  });

  it('declined and lapsed offers go away', () => {
    const book = new EventBook();
    run(book, 0, 0.3);
    const id = book.offers[0].id;
    book.decline(id);
    expect(book.offers.find((o) => o.id === id)).toBeUndefined();
    book.offers.push({ id: 99, kind: 'festival', name: 'X', start: 5, hours: 10, cost: 1, capacity: 1, keen: 50, expires: 0.5 });
    run(book, 0.4, 0.6);
    expect(book.offers.find((o) => o.id === 99)).toBeUndefined();
  });

  it('in a city: offers come to the arena, fans drive in, and the diary is saved', () => {
    const city = new City();
    city.money = 1e9;
    city.buildRoad(free(-400, 0), null, free(400, 0), true);
    city.addOutsideConnection([...city.net.nodes.values()].find((n) => n.p.x === -400)!.id);
    city.paint({ x: -200, y: 12 }, 40, Zone.ResidentialHigh);
    for (const s of city.net.segments.values()) for (const l of s.lots) if (l.zone) l.level = 3;
    expect(city.arenaAccess()).toBeNull();
    const spot = city.facilitySpot('arena', { x: 200, y: -60 });
    expect(city.buildFacility('arena', spot.p, spot.angle).ok).toBe(true);
    const access = city.arenaAccess()!;
    expect(access.at).not.toBeNull();
    expect(access.transit).toBe(0);
    const r = rng();
    for (let i = 0; i < DAY_STEPS && !city.events.offers.length; i++) city.tick(r);
    expect(city.events.offers.length).toBeGreaterThan(0);
    expect(city.eventNews.some((n) => n.offered)).toBe(true);
    const o = city.events.offers[0];
    city.events.accept(o.id);
    const copy = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    expect(copy.events.booked.map((b) => b.name)).toEqual([o.name]);
    // Jump to the doors opening: cars head for the arena
    city.steps = Math.ceil(o.start * DAY_STEPS);
    const before = city.traffic.vehicles.length;
    for (let i = 0; i < 20; i++) city.tick(r);
    expect(city.traffic.vehicles.length).toBeGreaterThan(before);
    city.steps = Math.ceil((o.start + o.hours / 24) * DAY_STEPS);
    city.tick(r);
    expect(city.events.history[0].name).toBe(o.name);
    expect(city.budget.events).toBe(city.events.history[0].net);
  });
});

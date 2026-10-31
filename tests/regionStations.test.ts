import { describe, expect, it } from 'vitest';
import { City, freewayTown } from '../src/sim/city';
import { ELEVATED_HEIGHT, TUNNEL_DEPTH } from '../src/sim/roads';
import { KAOHSIUNG } from '../src/sim/terrain';
import { HUBS, stationCovers } from '../src/sim/stations';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

/** A city with a long street east-west near the region's town, and where to tap beside it. */
function cityWithStreet(region: 'kaohsiung' | 'pingtung'): { city: City; tap: { x: number; y: number }; y: number } {
  const city = new City(KAOHSIUNG);
  city.money = 1e10;
  city.regions = new Set(['kaohsiung', 'pingtung']);
  const t = freewayTown(region);
  const y = t.y + 160;
  expect(city.buildRoad(free(t.x - 300, y), null, free(t.x + 300, y), true).ok).toBe(true);
  return { city, tap: { x: t.x, y: y - 20 }, y };
}

const heightAt = (city: City, p: { x: number; y: number }) => {
  const net = city.rails.train.net;
  const hit = net.segmentAt(p, 3)!;
  return net.heightAt(hit.seg, hit.t);
};

describe('train stations built before their track', () => {
  it('stand beside the street with a stretch of track at street level, the building towards the street', () => {
    const { city, tap, y } = cityWithStreet('kaohsiung');
    const r = city.buildTrainStation(tap, false);
    expect(r.ok).toBe(true);
    expect(r.style).toBe('standard');
    const [spot] = city.stationSpots();
    // Track runs along the street on the tapped side, the building between them
    expect(spot.pose.p.y).toBeLessThan(y - 25);
    expect(Math.abs(spot.pose.d.y)).toBeLessThan(0.01);
    // The building's side of the track (station +v) points south, towards the street
    expect(spot.pose.d.x * spot.side).toBeGreaterThan(0);
    expect(heightAt(city, spot.pose.p)).toBe(0);
    // It stays with no line, and a saved city keeps it
    city.rails.train.transit.pruneStops();
    expect(city.rails.train.transit.stops.size).toBe(1);
    const loaded = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    const stop = [...loaded.rails.train.transit.stops.values()][0];
    expect(stop.style).toBe('standard');
    expect(stop.face).toBe(spot.side);
  });

  it('must be beside a street', () => {
    const { city, tap } = cityWithStreet('kaohsiung');
    const r = city.buildTrainStation({ x: tap.x, y: tap.y - 200 }, false);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('路邊');
  });

  it("Kaohsiung's own station goes underground with ramps back up at both ends, one per region", () => {
    const { city, tap } = cityWithStreet('kaohsiung');
    const r = city.buildTrainStation(tap, true);
    expect(r.ok).toBe(true);
    expect(r.style).toBe('kaohsiung');
    const spot = city.stationSpots().find((st) => st.kind === 'train')!;
    expect(spot.style).toBe('kaohsiung');
    const p = spot.pose.p;
    const d = spot.pose.d;
    expect(heightAt(city, p)).toBe(TUNNEL_DEPTH);
    expect(heightAt(city, { x: p.x + d.x * 96, y: p.y + d.y * 96 })).toBeGreaterThan(TUNNEL_DEPTH / 4);
    // 三鐵共構: metro and high-speed stations come with it, in tunnels
    for (const kind of ['metro', 'hsr'] as const) {
      const other = city.stationSpots().find((st) => st.kind === kind);
      expect(other?.style).toBe('kaohsiung');
      expect(other!.pose.h).toBe(TUNNEL_DEPTH);
      expect(city.hubPartner(kind, spot.stop)).toBe(other!.stop);
    }
    const again = city.buildTrainStation({ x: tap.x + 200, y: tap.y }, true);
    expect(again.ok).toBe(false);
    expect(again.reason).toContain('每區限蓋一座');
    // A standard station is still allowed in the region
    expect(city.buildTrainStation({ x: tap.x + 250, y: tap.y + 40 }, false).ok).toBe(true);
  });

  it("Pingtung's own station stands on a viaduct", () => {
    const { city, tap } = cityWithStreet('pingtung');
    expect(city.buildTrainStation(tap, true).style).toBe('pingtung');
    expect(heightAt(city, city.stationSpots()[0].pose.p)).toBe(ELEVATED_HEIGHT);
  });

  it('can be taken down while no line stops there', () => {
    const { city, tap } = cityWithStreet('kaohsiung');
    city.buildTrainStation(tap, false);
    const spot = city.stationSpots()[0];
    const r = city.bulldoze({ x: spot.pose.p.x, y: spot.pose.p.y + 15 * spot.side }, 4);
    expect(r.ok).toBe(true);
    expect(city.rails.train.transit.stops.size).toBe(0);
  });
});

describe('共構 stations', () => {
  for (const style of ['twin', 'triple'] as const) {
    it(`${style}: train and metro underground${style === 'triple' ? ', high-speed at street level and an elevated road' : ''}, all taken down together`, () => {
      const { city, tap } = cityWithStreet('kaohsiung');
      const roads = city.net.segments.size;
      const r = city.buildHubStation(tap, style);
      expect(r.reason).toBeUndefined();
      expect(r.ok).toBe(true);
      const train = city.stationSpots().find((st) => st.kind === 'train')!;
      expect(train.style).toBe(style);
      expect(train.pose.h).toBe(TUNNEL_DEPTH);
      const metro = city.hubPartner('metro', train.stop)!;
      expect(metro).toBeTruthy();
      expect(city.stationSpots().find((st) => st.stop === metro)!.pose.h).toBe(TUNNEL_DEPTH);
      const hsr = city.hubPartner('hsr', train.stop);
      if (style === 'triple') {
        expect(city.stationSpots().find((st) => st.stop === hsr)!.pose.h).toBe(0);
        expect(city.net.segments.size).toBeGreaterThan(roads);
      } else expect(hsr).toBeNull();
      // Saved and loaded, then demolished as one
      const loaded = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
      expect(loaded.hubPartner('metro', [...loaded.rails.train.transit.stops.values()][0])).toBeTruthy();
      expect(city.bulldoze(train.pose.p, 4).ok).toBe(true);
      expect(city.rails.metro.transit.stops.size).toBe(0);
      expect(city.rails.hsr.transit.stops.size).toBe(0);
    });
  }
});

describe('三鐵共構 on either side of the street', () => {
  for (const side of [-1, 1]) {
    it(`keeps its elevated road at the car park, built on the ${side < 0 ? 'north' : 'south'} side`, () => {
      const { city, tap, y } = cityWithStreet('kaohsiung');
      const at = side < 0 ? tap : { x: tap.x, y: y + 20 };
      expect(city.buildHubStation(at, 'triple').ok).toBe(true);
      const spot = city.stationSpots().find((st) => st.kind === 'train')!;
      const road = HUBS.triple.road!;
      // The road's inner end is at the car park's edge, which the station covers
      const inner = city.hubPoint(spot.pose, spot.side, road.u0, road.v);
      expect(city.net.segmentAt(inner, 3, ELEVATED_HEIGHT)).toBeTruthy();
      expect(stationCovers('train', spot.pose, spot.side, city.hubPoint(spot.pose, spot.side, road.u0 - 4, road.v), 0, 'triple')).toBe(true);
      // Its high-speed platforms turn with it, behind the hall
      const hsr = city.stationSpots().find((st) => st.kind === 'hsr')!;
      expect(hsr.pose.d.x * spot.pose.d.x + hsr.pose.d.y * spot.pose.d.y).toBeGreaterThan(0.99);
      const behind = city.hubPoint(spot.pose, spot.side, 0, HUBS.triple.hsr!.v);
      expect(Math.hypot(hsr.pose.p.x - behind.x, hsr.pose.p.y - behind.y)).toBeLessThan(1);
    });
  }
});

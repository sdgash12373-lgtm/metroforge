import { describe, expect, it } from 'vitest';
import { City, FREEWAY, FREEWAYS, PENGHU_TOWN, freewayTown } from '../src/sim/city';
import { ELEVATED_HEIGHT } from '../src/sim/roads';
import { UNLOCK } from '../src/sim/levels';
import { KAOHSIUNG, KAOHSIUNG_CLASSIC, REGION_NAMES, buildable, geoPoint, northPoint, penghuPoint } from '../src/sim/terrain';
import { Zone } from '../src/sim/zoning';

const T = KAOHSIUNG;
const N = northPoint;
const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });
const region = (p: { x: number; y: number }) => T.region(p.x, p.y);

describe('Tainan, Chiayi and Penghu', () => {
  it('are regions of the Kaohsiung map: Tainan and Chiayi up the coast, Penghu out at sea', () => {
    expect(T.regions).toEqual(['kaohsiung', 'pingtung', 'tainan', 'chiayi', 'penghu']);
    expect(REGION_NAMES.tainan).toBe('台南區');
    // Tainan city on the plain, 嘉義 inland across the 八掌溪
    const tainan = geoPoint(23.0, 120.2);
    expect(region(tainan)).toBe('tainan');
    expect(buildable(T, tainan)).toBe(true);
    const chiayi = geoPoint(23.48, 120.42);
    expect(region(chiayi)).toBe('chiayi');
    expect(buildable(T, chiayi)).toBe(true);
    // Chiayi lies north of Tainan on the screen (north is -y), Penghu west of Chiayi's coast
    expect(chiayi.y).toBeLessThan(tainan.y - 1500);
    const magong = geoPoint(23.565, 119.57);
    expect(region(magong)).toBe('penghu');
    expect(buildable(T, magong)).toBe(true);
    expect(magong.x).toBeLessThan(geoPoint(23.565, 120.15).x - 3000);
    // The strait between is open sea, not part of any region
    const strait = geoPoint(23.4, 119.85);
    expect(T.sea(strait.x, strait.y)).toBe(true);
    expect(region(strait)).toBeNull();
    // The map's edge takes them all in
    for (const p of [tainan, chiayi, magong, penghuPoint(-14, -39)]) {
      expect(p.x).toBeGreaterThan(T.bounds.minX);
      expect(p.y).toBeGreaterThan(T.bounds.minY);
    }
  });

  it('has the real land: rivers, reservoirs, 七股潟湖, 外傘頂洲, mountains towards 阿里山', () => {
    // 曾文溪 and 八掌溪 are water but not sea
    const zengwen = N(3150, 500);
    expect(T.water(zengwen.x, zengwen.y)).toBe(true);
    expect(T.sea(zengwen.x, zengwen.y)).toBe(false);
    const bazhang = N(5150, 600);
    expect(T.water(bazhang.x, bazhang.y)).toBe(true);
    // 烏山頭 reservoir
    const wushantou = N(3950, 1720);
    expect(T.water(wushantou.x, wushantou.y)).toBe(true);
    expect(T.sea(wushantou.x, wushantou.y)).toBe(false);
    // 七股's lagoon is sea behind its sandbars
    const lagoon = N(3330, -330);
    expect(T.sea(lagoon.x, lagoon.y)).toBe(true);
    // 外傘頂洲: dry but not for building
    const bar = N(5800, -600);
    expect(T.water(bar.x, bar.y)).toBe(false);
    expect(buildable(T, bar)).toBe(false);
    // Hills behind Tainan, higher mountains behind Chiayi
    const hills = N(2600, 1900);
    expect(T.height(hills.x, hills.y)).toBeGreaterThan(5);
    const alishan = N(5300, 3250);
    expect(T.height(alishan.x, alishan.y)).toBeGreaterThan(250);
  });

  it('carries the land on from Kaohsiung without a cliff at the old edge', () => {
    for (let y = -1950; y <= -400; y += 50) {
      const a = T.height(-1990, y);
      const b = T.height(-2010, y);
      expect(Math.abs(a - b)).toBeLessThan(Math.max(4, 0.3 * a));
    }
    for (let x = -1900; x <= 0; x += 50) {
      const a = T.height(x, -1990);
      const b = T.height(x, -2010);
      expect(Math.abs(a - b)).toBeLessThan(Math.max(6, 0.3 * a));
    }
  });

  it('has Penghu as islands: Magong, 白沙 and 西嶼 apart across the bay, 望安 and 七美 to the south', () => {
    for (const [e, n] of [[6, 0], [3, 8.8], [-7.8, 4], [-7, -22.7], [-14, -39]]) {
      const p = penghuPoint(e, n);
      expect(T.water(p.x, p.y)).toBe(false);
      expect(region(p)).toBe('penghu');
    }
    // 澎湖灣 and the channel 跨海大橋 crosses
    for (const [e, n] of [[-4, 3], [-3.5, 8.6]]) {
      const p = penghuPoint(e, n);
      expect(T.sea(p.x, p.y)).toBe(true);
      expect(region(p)).toBe('penghu');
    }
  });

  it('starts a city in each with its way in, all roads on dry land and connected', () => {
    for (const r of ['tainan', 'chiayi', 'penghu'] as const) {
      const city = new City(T);
      city.regions = new Set([r]);
      city.buildFreeway(r);
      const town = freewayTown(r);
      expect(region(town)).toBe(r);
      const road = city.net.segmentAt(town, 3, 0);
      expect(road).toBeTruthy();
      expect(road!.seg.lots.length).toBeGreaterThan(0);
      expect(city.disconnectedRoads()).toHaveLength(0);
      for (const s of city.net.segments.values()) {
        const ground = city.net.node(s.a).h === 0 && city.net.node(s.b).h === 0;
        for (const p of s.samples) {
          if (ground) expect(buildable(T, p)).toBe(true);
          if (s.highway) expect(T.sea(p.x, p.y) || T.height(p.x, p.y) > 5).toBe(false);
        }
      }
    }
    // Penghu's way in is the pier in Magong harbour: a road end that leads out
    const city = new City(T);
    city.regions = new Set(['penghu']);
    city.buildFreeway('penghu');
    const pier = [...city.outside].map((n) => city.net.node(n)).find((n) => n.h === 0)!;
    expect(pier).toBeTruthy();
    expect(Math.hypot(pier.p.x - PENGHU_TOWN.x, pier.p.y - PENGHU_TOWN.y)).toBeGreaterThan(40);
  });

  it('lays 國道 1, 3 and 8 up the north as on the map of Taiwan', () => {
    const city = new City(T);
    city.buildFreeway('kaohsiung');
    const name = (p: { x: number; y: number }, r = 40) => city.net.segmentAt(p, r, ELEVATED_HEIGHT)?.seg.name;
    expect(name(FREEWAYS.tainan.center, 3)).toBe('國道 1 號');
    expect(name(FREEWAYS.chiayi.center, 3)).toBe('國道 1 號');
    expect(name(N(4300, 1600), 120)).toBe('國道 3 號');
    expect(name(N(2950, 400), 30)).toBe('國道 8 號');
    // 國道 1 號 no longer runs on north into the hills from where it turns for Tainan
    expect(city.net.segmentAt({ x: FREEWAY.x, y: FREEWAY.north - 150 }, 5, ELEVATED_HEIGHT)).toBeNull();
  });

  it('keeps them shut until a 縣轄市 opens them, each with its way in, and lays the 國道 into an older city', () => {
    const city = new City(T);
    city.money = 1e8;
    city.buildFreeway('kaohsiung');
    const town = freewayTown('tainan');
    expect(city.regionProblem(town)).toContain('台南區尚未開通');
    city.level = UNLOCK.region;
    for (const r of ['tainan', 'chiayi', 'penghu'] as const) {
      expect(city.openRegion(r).ok).toBe(true);
      expect(city.net.segmentAt(freewayTown(r), 3, 0)).toBeTruthy();
    }
    expect(city.disconnectedRoads()).toHaveLength(0);
    // Building and zoning there works
    const p = N(5800, 1950);
    const q = N(5920, 1950);
    expect(city.buildRoad(free(p.x, p.y), null, free(q.x, q.y)).ok).toBe(true);
    city.paint(N(5860, 1975), 30, Zone.ResidentialLow);
    const copy = City.deserialize(JSON.parse(JSON.stringify(city.serialize())));
    expect([...copy.regions].sort()).toEqual(['chiayi', 'kaohsiung', 'penghu', 'tainan']);
    expect(copy.net.segments.size).toBe(city.net.segments.size);
  });

  it('turns an older save’s 國道 1 號 off for Tainan, dropping the stub it ran on north into the hills', () => {
    const c = new City(T);
    c.buildFreeway('kaohsiung');
    const data = c.serialize();
    const pos = new Map(data.nodes.map(([id, x, y]) => [id, { x, y }]));
    const names = new Map(data.roadNames ?? []);
    const inSquare = (p: { x: number; y: number }) => Math.abs(p.x) <= 2000 && Math.abs(p.y) <= 2000;
    // As saved before Tainan: nothing north of Kaohsiung, 國道 1 號 carried on north until the hills
    data.segs = data.segs.filter(([id, a, b]) => {
      const pa = pos.get(a)!;
      const pb = pos.get(b)!;
      const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      const n = names.get(id);
      if (!inSquare(pa) || !inSquare(pb)) return false;
      if (n === '國道 1 號' && mid.x < FREEWAY.x - 1) return false;
      if (n === '國道 3 號' && mid.y < -881 && mid.x < -300) return false;
      return n !== '國道 8 號';
    });
    const turn = data.nodes.find(([, x, y]) => x === FREEWAY.x && y === FREEWAY.north)!;
    const id = Math.max(...data.nodes.map(([n]) => n)) + 1;
    data.nodes.push([id, FREEWAY.x, -1280, ELEVATED_HEIGHT]);
    const seg = Math.max(...data.segs.map(([s]) => s)) + 1;
    data.segs.push([seg, turn[0], id, FREEWAY.x, -1140, []]);
    data.styles = [...(data.styles ?? []), [seg, 2, 0, 1]];
    data.roadNames = [...(data.roadNames ?? []), [seg, '國道 1 號']];
    data.outside = [id];
    const back = City.deserialize(JSON.parse(JSON.stringify(data)));
    expect(back.net.segmentAt(FREEWAYS.tainan.center, 3, ELEVATED_HEIGHT)?.seg.name).toBe('國道 1 號');
    expect(back.net.segmentAt({ x: FREEWAY.x, y: -1200 }, 5, ELEVATED_HEIGHT)).toBeNull();
    expect(back.disconnectedRoads()).toHaveLength(0);
  });

  it('keeps old saves near the square on their old ground and regions', () => {
    // Land just outside the square's north-west edge stays Kaohsiung's on the classic map
    expect(KAOHSIUNG_CLASSIC.region(-2200, -1500)).toBe('kaohsiung');
    expect(KAOHSIUNG.region(-2200, -1500)).toBe('tainan');
    expect(KAOHSIUNG_CLASSIC.region(-4000, -4000)).toBe(KAOHSIUNG.region(-4000, -4000));
  });
});

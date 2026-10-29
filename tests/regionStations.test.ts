import { describe, expect, it } from 'vitest';
import { City, STATION_LEVEL_HALF, STATION_RAMP, freewayTown } from '../src/sim/city';
import { ELEVATED_HEIGHT, TUNNEL_DEPTH } from '../src/sim/roads';
import { KAOHSIUNG } from '../src/sim/terrain';

const free = (x: number, y: number) => ({ kind: 'free' as const, p: { x, y } });

function cityWithTrack(region: 'kaohsiung' | 'pingtung', pieces = 1): { city: City; c: { x: number; y: number } } {
  const city = new City(KAOHSIUNG);
  city.money = 1e10;
  city.regions = new Set(['kaohsiung', 'pingtung']);
  const t = freewayTown(region);
  const c = { x: t.x, y: t.y + 120 };
  const xs = Array.from({ length: pieces + 1 }, (_, i) => c.x - 300 + (600 * i) / pieces);
  for (let i = 0; i < pieces; i++) expect(city.buildTrack('train', free(xs[i], c.y), null, free(xs[i + 1], c.y), 0, true).ok).toBe(true);
  return { city, c };
}

describe('regional train stations', () => {
  it('take the track underground in Kaohsiung, with ramps back up at both ends', () => {
    const { city, c } = cityWithTrack('kaohsiung');
    expect(city.regionStationTrack('train', c, 10).changed).toBe(true);
    const net = city.rails.train.net;
    const heightAt = (x: number) => {
      const hit = net.segmentAt({ x, y: c.y }, 2)!;
      return net.heightAt(hit.seg, hit.t);
    };
    expect(heightAt(c.x)).toBe(TUNNEL_DEPTH);
    expect(heightAt(c.x + STATION_LEVEL_HALF - 5)).toBe(TUNNEL_DEPTH);
    expect(heightAt(c.x - STATION_LEVEL_HALF - STATION_RAMP - 20)).toBe(0);
    expect(heightAt(c.x + STATION_LEVEL_HALF + STATION_RAMP + 20)).toBe(0);
    const mid = heightAt(c.x + STATION_LEVEL_HALF + STATION_RAMP / 2);
    expect(mid).toBeLessThan(0);
    expect(mid).toBeGreaterThan(TUNNEL_DEPTH);
    // The stop goes on the level stretch below
    const stop = city.rails.train.transit.stopAt(c, 10)!;
    expect(stop).not.toBeNull();
    // A second tap on the same spot changes nothing
    expect(city.regionStationTrack('train', c, 10).changed).toBe(false);
  });

  it('raise the track onto a viaduct in Pingtung, across joins in the track', () => {
    const { city, c } = cityWithTrack('pingtung', 5);
    expect(city.regionStationTrack('train', c, 10).changed).toBe(true);
    const net = city.rails.train.net;
    const hit = net.segmentAt(c, 2)!;
    expect(net.heightAt(hit.seg, hit.t)).toBe(ELEVATED_HEIGHT);
  });

  it('are refused where a branch joins the track near the station', () => {
    const { city, c } = cityWithTrack('kaohsiung');
    expect(city.buildTrack('train', free(c.x + 60, c.y), null, free(c.x + 60, c.y + 200), 0, true).ok).toBe(true);
    const r = city.regionStationTrack('train', c, 10);
    expect(r.changed).toBe(false);
    expect(r.reason).toContain('地下化');
  });
});

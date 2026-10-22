import { describe, expect, it } from 'vitest';
import { City, DAY_STEPS } from '../src/sim/city';
import { FLAT, KAOHSIUNG } from '../src/sim/terrain';
import { Weather, clock } from '../src/sim/weather';

function rng(seed = 7) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** Skies seen over `days` days starting at `from`. */
function skies(w: Weather, from: number, days: number) {
  const r = rng();
  const seen: Record<string, number> = {};
  for (let s = 0; s < days * DAY_STEPS; s++) {
    w.step(from + s / DAY_STEPS, 1 / DAY_STEPS, r);
    seen[w.sky] = (seen[w.sky] ?? 0) + 1;
  }
  return seen;
}

describe('time and weather', () => {
  it('takes 2,400 half-second steps (20 minutes) to make a day', () => {
    const city = new City();
    expect(clock(city.day).hour).toBeCloseTo(8);
    const start = city.day;
    for (let i = 0; i < DAY_STEPS; i++) city.tick(rng());
    expect(city.day - start).toBeCloseTo(1);
    expect(clock(0.75).hour).toBe(18);
  });

  it('follows the climate of the land: typhoons in a Kaohsiung summer, snow on a winter plain', () => {
    const summer = 181;
    const kh = skies(new Weather(KAOHSIUNG), summer, 90);
    expect(kh.storm).toBeGreaterThan(0);
    expect(kh.typhoon).toBeGreaterThan(0);
    const plain = new Weather(FLAT);
    expect(skies(plain, summer, 90).typhoon ?? 0).toBe(0);
    // A cold January night on the plain turns rain to snow
    plain.sky = 'rain';
    expect(plain.at({ x: 0, y: 0 }, 10.1).snow).toBe(true);
  });

  it('is colder, wetter and foggier up in the mountains, with sea fog on the coast in the morning', () => {
    const w = new Weather(KAOHSIUNG);
    w.sky = 'rain';
    // Find a mountain and a coast spot on the map
    let peak = { x: 0, y: 0 };
    let shore = { x: 0, y: 0 };
    for (let x = -2500; x <= 2500; x += 100) {
      for (let y = -2500; y <= 2500; y += 100) {
        if (KAOHSIUNG.height(x, y) > KAOHSIUNG.height(peak.x, peak.y)) peak = { x, y };
        if (KAOHSIUNG.height(x, y) === 0 && !KAOHSIUNG.water(x, y) && KAOHSIUNG.water(x - 150, y + 150)) shore = { x, y };
      }
    }
    const plain = w.at({ x: 0, y: 0 }, 100.5);
    const mountain = w.at(peak, 100.5);
    expect(mountain.region).toBe('山區');
    expect(mountain.temp).toBeLessThan(plain.temp);
    expect(mountain.precip).toBeGreaterThan(plain.precip);
    expect(mountain.fog).toBeGreaterThan(plain.fog);
    w.sky = 'clear';
    expect(w.at(shore, 100.25).region).toBe('海邊');
    expect(w.at(shore, 100.25).fog).toBeGreaterThan(w.at({ x: 0, y: 0 }, 100.25).fog);
  });
});

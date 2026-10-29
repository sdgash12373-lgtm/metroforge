import type { Vec2 } from './geometry';
import type { Terrain, TerrainName } from './terrain';
import { START_DATE } from './format';

/** What the sky is doing over the whole map; each place then sees it a little differently. */
export type Sky = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'typhoon';

interface Climate {
  /** mean temperature per month, °C */
  temps: number[];
  /** day-night swing, °C */
  swing: number;
  /** how likely each sky is to set in, by month (0-11) and hour */
  odds(month: number, hour: number): Record<Sky, number>;
}

/** Kaohsiung: hot and humid; summer afternoon thunderstorms and typhoons, a dry sunny winter. */
const SUBTROPICAL: Climate = {
  temps: [19, 20, 23, 26, 28, 29, 30, 29, 29, 27, 24, 20],
  swing: 7,
  odds(m, h) {
    const wet = m >= 4 && m <= 8;
    const afternoon = h >= 12 && h < 19;
    return {
      clear: wet ? 4 : 8,
      cloudy: wet ? 3 : 3,
      rain: wet ? 2 : 0.6,
      storm: wet && afternoon ? 4 : wet ? 0.6 : 0.1,
      fog: !wet && h < 9 ? 1.2 : 0.2,
      typhoon: m >= 6 && m <= 8 ? 0.15 : 0,
    };
  },
};

/** The open plain: four seasons, misty mornings in autumn and winter, snow when it is cold enough. */
const TEMPERATE: Climate = {
  temps: [3, 5, 10, 15, 20, 24, 27, 26, 22, 16, 10, 5],
  swing: 10,
  odds(m, h) {
    const summer = m >= 5 && m <= 7;
    const cold = m <= 1 || m === 11;
    return {
      clear: summer ? 6 : 4,
      cloudy: cold ? 5 : 3,
      rain: summer ? 1.5 : 2.2,
      storm: summer && h >= 12 && h < 20 ? 1.8 : 0.1,
      fog: (m >= 9 || m <= 2) && h < 10 ? 2.5 : 0.3,
      typhoon: 0,
    };
  },
};

const CLIMATES: Record<TerrainName, Climate> = { kaohsiung: SUBTROPICAL, 'kaohsiung-classic': SUBTROPICAL, flat: TEMPERATE, plain: TEMPERATE, 'flat-classic': TEMPERATE };

/** Game time → calendar month (0-11) and hour (0-24). */
export function clock(days: number): { month: number; hour: number } {
  const d = new Date(START_DATE + days * 86400000);
  return { month: d.getUTCMonth(), hour: (days - Math.floor(days)) * 24 };
}

/** The weather as felt at one spot. */
export interface Conditions {
  sky: Sky;
  /** rain or snow falling, 0..1 */
  precip: number;
  snow: boolean;
  /** cloud cover, 0..1 */
  cloud: number;
  /** fog, 0..1 */
  fog: number;
  /** lightning flashes per second */
  lightning: number;
  /** wind, 0..1 */
  wind: number;
  temp: number;
  /** what the land is like here: 海邊, 平原, 丘陵, 山區 */
  region: string;
  label: string;
  icon: string;
}

const BASE: Record<Sky, { precip: number; cloud: number; fog: number; lightning: number; wind: number }> = {
  clear: { precip: 0, cloud: 0.1, fog: 0, lightning: 0, wind: 0.15 },
  cloudy: { precip: 0, cloud: 0.7, fog: 0.05, lightning: 0, wind: 0.3 },
  rain: { precip: 0.55, cloud: 0.9, fog: 0.2, lightning: 0, wind: 0.35 },
  storm: { precip: 0.9, cloud: 1, fog: 0.25, lightning: 0.35, wind: 0.6 },
  fog: { precip: 0, cloud: 0.5, fog: 0.85, lightning: 0, wind: 0.05 },
  typhoon: { precip: 1, cloud: 1, fog: 0.35, lightning: 0.15, wind: 1 },
};

/**
 * Sky over the city: changes every couple of game hours, more often to what the season and the
 * hour favour, by the climate of the land the city stands on. Typhoons last a day or so.
 */
export class Weather {
  sky: Sky = 'clear';
  /** game days until the sky may change */
  private hold = 0;
  private climate: Climate;

  constructor(private terrain: Terrain) {
    this.climate = CLIMATES[terrain.name as TerrainName] ?? TEMPERATE;
  }

  /** Called once a simulation step (`stepDays` of a day). */
  step(days: number, stepDays: number, rng: () => number): void {
    this.hold -= stepDays;
    if (this.hold > 0) return;
    const { month, hour } = clock(days);
    const odds = this.climate.odds(month, hour);
    // Weather tends to stay as it is
    odds[this.sky] += 3;
    const total = Object.values(odds).reduce((a, b) => a + b, 0);
    let pick = rng() * total;
    let next: Sky = 'clear';
    for (const [k, w] of Object.entries(odds) as [Sky, number][]) {
      pick -= w;
      if (pick <= 0) {
        next = k;
        break;
      }
    }
    this.sky = next;
    this.hold = next === 'typhoon' ? 1 + rng() * 0.8 : 0.08 + rng() * 0.17;
  }

  /** Mean temperature now on the plain. */
  temperature(days: number): number {
    const { month, hour } = clock(days);
    const t = this.climate.temps;
    // Blend into next month, coolest before dawn and warmest mid-afternoon
    const day = new Date(START_DATE + days * 86400000).getUTCDate() / 31;
    const mean = t[month] * (1 - day) + t[(month + 1) % 12] * day;
    return mean + (this.climate.swing / 2) * Math.sin(((hour - 9) / 24) * Math.PI * 2);
  }

  /** The weather at p: the mountains catch more rain and cloud and are colder, the coast gets sea fog. */
  at(p: Vec2, days: number): Conditions {
    const base = BASE[this.sky];
    const c = { sky: this.sky, ...base };
    let temp = this.temperature(days);
    let region = '平原';
    const t = this.terrain;
    const h = Math.max(0, t.height(p.x, p.y));
    const { hour } = clock(days);
    if (t.name !== 'flat') {
      const coast = t.water(p.x, p.y) || [0, 1, 2, 3, 4, 5].some((i) => t.water(p.x + 220 * Math.cos(i), p.y + 220 * Math.sin(i)));
      if (h > 150) {
        region = '山區';
        c.cloud = Math.min(1, c.cloud + 0.25);
        c.precip = Math.min(1, c.precip * 1.5 + (this.sky === 'cloudy' ? 0.25 : 0));
        c.fog = Math.min(1, c.fog + 0.25 + h / 1500);
        c.wind = Math.min(1, c.wind + 0.15);
      } else if (h > 8) {
        region = '丘陵';
        c.precip = Math.min(1, c.precip * 1.2);
        c.fog = Math.min(1, c.fog + 0.1);
      } else if (coast) {
        region = '海邊';
        c.wind = Math.min(1, c.wind + 0.2);
        if (hour < 10) c.fog = Math.min(1, c.fog * 1.4 + 0.1);
        // The sea keeps the coast milder
        temp = temp * 0.85 + 26 * 0.15;
      }
      temp -= h * 0.0065;
      if (t.region(p.x, p.y) === 'pingtung') region = `屏東${region}`;
    }
    const snow = c.precip > 0 && temp < 1;
    const label = this.label(c.sky, c.precip, snow, c.fog);
    if (label.icon === '☀️' && (hour < 6 || hour >= 18)) label.icon = '🌙';
    return { ...c, temp: Math.round(temp), snow, region, label: label.text, icon: label.icon };
  }

  private label(sky: Sky, precip: number, snow: boolean, fog: number): { text: string; icon: string } {
    if (sky === 'typhoon') return { text: '颱風', icon: '🌀' };
    if (snow) return { text: '下雪', icon: '❄️' };
    if (sky === 'storm') return { text: '雷雨', icon: '⛈️' };
    if (precip > 0.6) return { text: '大雨', icon: '🌧️' };
    if (precip > 0) return { text: '下雨', icon: '🌦️' };
    if (fog > 0.5) return { text: '起霧', icon: '🌫️' };
    if (sky === 'cloudy') return { text: '多雲', icon: '☁️' };
    return { text: '晴', icon: '☀️' };
  }
}

/**
 * City ranks. A city moves up when it has the people and its finances can carry the next rank:
 * monthly income and monthly balance (income − running costs − construction) both above the bar.
 * Each rank also changes the central government's subsidy and what running the city costs per
 * resident, and unlocks new things to build.
 */
export interface CityLevel {
  name: string;
  /** suggested population to move up to this rank */
  population: number;
  /** monthly income needed, NT$ */
  income: number;
  /** monthly balance needed, NT$ */
  balance: number;
  /** central government subsidy per resident per month */
  subsidy: number;
  /** civil servants, offices and admin per resident per month */
  admin: number;
  /** what moving up opens */
  unlocks: string[];
}

export const LEVELS: CityLevel[] = [
  { name: '聚落', population: 0, income: 0, balance: -Infinity, subsidy: 600, admin: 400, unlocks: [] },
  { name: '鄉村', population: 1_000, income: 3_000_000, balance: 300_000, subsidy: 450, admin: 1000, unlocks: ['中央補助調整'] },
  { name: '城鎮', population: 10_000, income: 35_000_000, balance: 2_000_000, subsidy: 350, admin: 1600, unlocks: ['中央補助調整'] },
  {
    name: '縣轄市',
    population: 100_000,
    income: 400_000_000,
    balance: 10_000_000,
    subsidy: 260,
    admin: 2200,
    unlocks: ['道路升級：雙向雙線道、雙向四線道', '天橋', '人行道', '綠化建設'],
  },
  {
    name: '直轄市',
    population: 1_000_000,
    income: 4_000_000_000,
    balance: 50_000_000,
    subsidy: 200,
    admin: 2800,
    unlocks: ['辦公區蓋出更大更高的大樓', '主題樂園', '購物商城'],
  },
];

/** Rank at which each later feature opens. */
export const UNLOCK = { roadUpgrade: 3, footbridge: 3, greenery: 3, tallOffices: 4, themePark: 4, mall: 4 } as const;

/** Days in a game month. */
export const MONTH_DAYS = 30;

/** Short money for big sums: 3,000,000 → 300萬, 4e9 → 40億. */
export function ntdShort(v: number): string {
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1e8) return `${sign}${trim(a / 1e8)}億`;
  if (a >= 1e4) return `${sign}${trim(a / 1e4)}萬`;
  return `${sign}${Math.round(a).toLocaleString()}`;
}

const trim = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : n >= 10 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2).replace(/\.?0+$/, ''));

import { type Lot, Zone } from './zoning';

/** How a resident gets to work. Bicycles keep off the road; scooters and cars join the traffic. */
export type Commute = 'bike' | 'scooter' | 'car';

export type BracketKey = 'bike' | 'scooter' | 'car' | 'rich';

export interface IncomeBracket {
  key: BracketKey;
  label: string;
  /** yearly income below this (NT$) */
  upTo: number;
  commute: Commute;
  /** 汽燃稅: share of yearly income each car-owning household pays */
  fuelTax: number;
}

/** Yearly income decides whether a resident can afford a vehicle, and which. */
export const INCOME_BRACKETS: readonly IncomeBracket[] = [
  { key: 'bike', label: '年收 10 萬以下', upTo: 100_000, commute: 'bike', fuelTax: 0 },
  { key: 'scooter', label: '年收 10–40 萬', upTo: 400_000, commute: 'scooter', fuelTax: 0 },
  { key: 'car', label: '年收 40–60 萬', upTo: 600_000, commute: 'car', fuelTax: 0.03 },
  { key: 'rich', label: '年收 60 萬以上', upTo: Infinity, commute: 'car', fuelTax: 0.07 },
];

/** Typical yearly income per resident by building level (index = level). */
const BASE: Partial<Record<Zone, number[]>> = {
  [Zone.ResidentialLow]: [0, 150_000, 330_000, 600_000],
  [Zone.ResidentialHigh]: [0, 80_000, 200_000, 350_000, 450_000, 600_000],
};
/** Residents sharing one home and one car; the fuel tax is billed per car. */
export const PEOPLE_PER_HOUSEHOLD = 3;

/** Pay rises as the city moves up the ranks. */
const RANK_PAY = [1, 1.05, 1.15, 1.3, 1.5];

/**
 * A resident's yearly income in a home: bigger homes with services in reach in a bigger city earn more,
 * and neighbours differ by up to a quarter either way.
 */
export function residentIncome(lot: Lot, served: number, rank: number): number {
  const base = BASE[lot.zone]?.[lot.level] ?? 0;
  const services = 0.8 + 0.1 * Math.min(6, served);
  const pay = RANK_PAY[Math.min(rank, RANK_PAY.length - 1)];
  return Math.round(base * services * pay * (0.75 + 0.5 * lot.seed));
}

export function bracketOf(income: number): IncomeBracket {
  return INCOME_BRACKETS.find((b) => income < b.upTo) ?? INCOME_BRACKETS[INCOME_BRACKETS.length - 1];
}

/** Residents by income bracket, their average income and the fuel tax car owners owe a year. */
export interface Households {
  people: Record<BracketKey, number>;
  averageIncome: number;
  fuelTaxYear: number;
}

export const emptyHouseholds = (): Households => ({ people: { bike: 0, scooter: 0, car: 0, rich: 0 }, averageIncome: 0, fuelTaxYear: 0 });

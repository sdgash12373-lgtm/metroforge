import type { Vec2 } from './geometry';

/**
 * 市政政策 from 縣轄市 up: the levers that make a big city grow when the player does the right thing,
 * rather than lower bars to the next rank.
 *  - 捷運聯合開發 (TOD): homes, shops and offices round a station grow taller and hold more people.
 *  - 產業創新計畫: a university beside a science park with a freeway interchange nearby forms an
 *    產業聚落, whose fabs pay much more tax and whose neighbours earn more.
 *  - 升格審查: what the central government looks at; every bar met gives a standing bonus.
 */
export type PolicyKey = 'tod' | 'industry';

export interface PolicySpec {
  label: string;
  /** running cost a month, NT$ */
  cost: number;
  blurb: string;
}

export const POLICIES: Record<PolicyKey, PolicySpec> = {
  tod: {
    label: '捷運聯合開發',
    cost: 30_000_000,
    blurb: '捷運、火車、高鐵車站 400 公尺內的高密住宅、商業、辦公區可以多蓋 2 層，每棟住的人與工作多 1.5 倍；搭車的人不佔道路',
  },
  industry: {
    label: '產業創新計畫',
    cost: 50_000_000,
    blurb: '大學旁有科學園區、附近又有交流道時形成「產業聚落」：園區工作多 1.5 倍、繳 4 倍營業稅，周邊居民收入提高 40%、住宅稅加倍',
  },
};
export const POLICY_KEYS = Object.keys(POLICIES) as PolicyKey[];
/** Rank (縣轄市) at which policies and the review open. */
export const POLICY_RANK = 3;

/** TOD: how far from a station, meters; levels above a zone's usual top; people and jobs per building. */
export const TOD_REACH = 400;
export const TOD_LEVELS = 2;
export const TOD_DENSITY = 1.5;

/** 產業聚落: science park within this of a university, and an interchange within RAMP_REACH of it. */
export const CLUSTER_REACH = 1200;
export const CLUSTER_RAMP_REACH = 2000;
/** Science-park jobs near the university it takes to form a cluster. */
export const CLUSTER_MIN_JOBS = 150;
/** Jobs per fab, business tax per job and residents' pay inside a cluster, as multiples. */
export const CLUSTER_JOBS = 1.5;
export const CLUSTER_TAX = 4;
/** Residents round a cluster earn more and so pay this much more residential tax each. */
export const CLUSTER_RES_TAX = 1;
export const CLUSTER_PAY = 1.4;

export type ReviewKey = 'metro' | 'transit' | 'safety' | 'education' | 'finance' | 'industry';

export interface ReviewSpec {
  label: string;
  /** what has to be true, for the panel */
  goal: string;
  /** the standing bonus while it holds */
  bonus: string;
  /** the bar, in the units `have` is measured in */
  need: number;
  unit: 'share' | 'count';
}

/** 升格審查: each bar met gives its bonus for as long as it holds. */
export const REVIEW: Record<ReviewKey, ReviewSpec> = {
  metro: { label: '捷運涵蓋', goal: '居民住在捷運站 500 公尺內', bonus: '住宅需求 +8', need: 0.4, unit: 'share' },
  transit: { label: '大眾運輸', goal: '每天搭公車、捷運、火車的人次佔人口', bonus: '商業、辦公需求 +6', need: 0.08, unit: 'share' },
  safety: { label: '治安', goal: '居民在警察局範圍內', bonus: '滿意度 +5', need: 0.8, unit: 'share' },
  education: { label: '教育', goal: '居民在學校或大學範圍內', bonus: '居民收入 +10%', need: 0.8, unit: 'share' },
  finance: { label: '財政', goal: '每月結餘為正且市庫有錢', bonus: '中央補助 +30%', need: 1, unit: 'count' },
  industry: { label: '產業聚落', goal: '形成產業聚落', bonus: '工業需求 +8', need: 1, unit: 'count' },
};
export const REVIEW_KEYS = Object.keys(REVIEW) as ReviewKey[];
export const METRO_REACH = 500;

export interface ReviewItem {
  have: number;
  need: number;
  ok: boolean;
}
export type Review = Record<ReviewKey, ReviewItem>;

export const emptyReview = (): Review =>
  Object.fromEntries(REVIEW_KEYS.map((k) => [k, { have: 0, need: REVIEW[k].need, ok: false }])) as Review;

/** 產業聚落 round one university. */
export interface Cluster {
  /** the university */
  id: number;
  p: Vec2;
  /** science-park jobs in reach (before the cluster bonus) */
  jobs: number;
  /** a freeway interchange close enough */
  ramp: boolean;
  active: boolean;
}

/** Points bucketed on a grid, to ask "is any within r of here" without looking at them all. */
export class PointGrid {
  private readonly cells = new Map<number, Vec2[]>();
  readonly size: number;

  constructor(
    points: Iterable<Vec2>,
    private readonly r: number,
  ) {
    let n = 0;
    for (const p of points) {
      const k = this.key(Math.floor(p.x / r), Math.floor(p.y / r));
      (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(p);
      n++;
    }
    this.size = n;
  }

  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }

  /** Whether any point lies within the grid's radius of p. */
  near(p: Vec2): boolean {
    if (!this.size) return false;
    const gi = Math.floor(p.x / this.r);
    const gj = Math.floor(p.y / this.r);
    const r2 = this.r * this.r;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const q of this.cells.get(this.key(gi + i, gj + j)) ?? []) {
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          if (dx * dx + dy * dy < r2) return true;
        }
      }
    }
    return false;
  }
}

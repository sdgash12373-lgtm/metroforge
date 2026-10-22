import { type Vec2, dist } from './geometry';

/** Public services the city builds; each covers the homes within its radius. */
export type ServiceKind = 'park' | 'school' | 'police' | 'fire' | 'hospital';
/** One-of-a-kind landmarks modelled on Kaohsiung's. */
export type LandmarkKind = 'tower85' | 'cityHall' | 'dragonTiger' | 'ferrisWheel' | 'arena';
export type FacilityKind = ServiceKind | LandmarkKind;

export const SERVICE_KINDS: ServiceKind[] = ['park', 'school', 'police', 'fire', 'hospital'];
export const LANDMARK_KINDS: LandmarkKind[] = ['tower85', 'cityHall', 'dragonTiger', 'ferrisWheel', 'arena'];

export interface FacilitySpec {
  label: string;
  cost: number;
  /** per day */
  upkeep: number;
  /** footprint: along the road (w) and back from it (d), meters */
  w: number;
  d: number;
  /** service area, or the area a landmark makes more pleasant */
  radius: number;
  /** what residents say when they lack it */
  need?: string;
  /** landmarks: visitors a day per 1,000 residents, and what each spends */
  tourists?: number;
  /** colour of its coverage ring and dock swatch */
  color: number;
  blurb: string;
}

export const FACILITIES: Record<FacilityKind, FacilitySpec> = {
  park: { label: '公園', cost: 6000, upkeep: 30, w: 40, d: 40, radius: 180, need: '附近沒有公園可以散步', color: 0x5fb565, blurb: '讓附近居民更快樂，住宅升級更快' },
  school: { label: '學校', cost: 28000, upkeep: 180, w: 64, d: 44, radius: 420, need: '小孩沒有學校念', color: 0xf2b134, blurb: '高密住宅升到高等級需要學校' },
  police: { label: '警察局', cost: 22000, upkeep: 150, w: 32, d: 30, radius: 460, need: '治安不好', color: 0x4f8fd6, blurb: '維護治安，提升居民滿意度' },
  fire: { label: '消防局', cost: 22000, upkeep: 150, w: 34, d: 30, radius: 460, need: '沒有消防局很危險', color: 0xe4572e, blurb: '降低火災風險，提升居民滿意度' },
  hospital: { label: '醫院', cost: 45000, upkeep: 260, w: 54, d: 40, radius: 620, need: '看病要跑很遠', color: 0xf2f2f2, blurb: '照顧居民健康，提升居民滿意度' },
  tower85: { label: '85大樓', cost: 320000, upkeep: 600, w: 46, d: 40, radius: 900, tourists: 9, color: 0x9ad1f5, blurb: '高雄最高的地標，吸引觀光客並帶動商業與辦公' },
  cityHall: { label: '市政府', cost: 120000, upkeep: 300, w: 70, d: 44, radius: 1200, tourists: 1, color: 0xd9d4c7, blurb: '全市居民滿意度提升' },
  dragonTiger: { label: '龍虎塔', cost: 60000, upkeep: 120, w: 50, d: 44, radius: 600, tourists: 6, color: 0xf4d35e, blurb: '蓮池潭上的雙塔，觀光客最愛' },
  ferrisWheel: { label: '摩天輪', cost: 90000, upkeep: 200, w: 56, d: 46, radius: 700, tourists: 7, color: 0xf7a072, blurb: '購物中心頂樓的摩天輪，帶動商業' },
  arena: { label: '巨蛋', cost: 160000, upkeep: 350, w: 90, d: 90, radius: 800, tourists: 8, color: 0xb8e0a0, blurb: '辦演唱會和球賽，觀光收入最多' },
};

/** What each tourist spends in the city, NT$. */
export const TOURIST_SPEND = 6;

export const isLandmark = (k: FacilityKind): k is LandmarkKind => (LANDMARK_KINDS as string[]).includes(k);

export interface Facility {
  id: number;
  kind: FacilityKind;
  /** centre */
  p: Vec2;
  /** direction of the footprint's width (along the road), radians */
  angle: number;
}

/** Point in a facility's own frame: u along its width, v along its depth. */
export function toLocal(f: Pick<Facility, 'p' | 'angle'>, q: Vec2): { u: number; v: number } {
  const c = Math.cos(f.angle);
  const s = Math.sin(f.angle);
  const dx = q.x - f.p.x;
  const dy = q.y - f.p.y;
  return { u: dx * c + dy * s, v: -dx * s + dy * c };
}

export function toWorld(f: Pick<Facility, 'p' | 'angle'>, u: number, v: number): Vec2 {
  const c = Math.cos(f.angle);
  const s = Math.sin(f.angle);
  return { x: f.p.x + u * c - v * s, y: f.p.y + u * s + v * c };
}

export function footprintContains(f: Pick<Facility, 'p' | 'angle' | 'kind'>, q: Vec2, pad = 0): boolean {
  const spec = FACILITIES[f.kind];
  const l = toLocal(f, q);
  return Math.abs(l.u) <= spec.w / 2 + pad && Math.abs(l.v) <= spec.d / 2 + pad;
}

export function corners(f: Pick<Facility, 'p' | 'angle' | 'kind'>): Vec2[] {
  const { w, d } = FACILITIES[f.kind];
  return [
    toWorld(f, -w / 2, -d / 2),
    toWorld(f, w / 2, -d / 2),
    toWorld(f, w / 2, d / 2),
    toWorld(f, -w / 2, d / 2),
  ];
}

/** Points across a footprint, for checking the land under it. */
export function footprintGrid(f: Pick<Facility, 'p' | 'angle' | 'kind'>, n = 6): Vec2[] {
  const { w, d } = FACILITIES[f.kind];
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) pts.push(toWorld(f, (i / n - 0.5) * w, (j / n - 0.5) * d));
  return pts;
}

/** Whether a facility of this kind serves point p. */
export function covers(f: Facility, p: Vec2): boolean {
  return dist(f.p, p) <= FACILITIES[f.kind].radius;
}

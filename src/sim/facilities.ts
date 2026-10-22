import { type Vec2, dist } from './geometry';
import type { UNLOCK } from './levels';

/** Public services the city builds; each covers the homes within its radius. */
export type ServiceKind = 'park' | 'school' | 'police' | 'fire' | 'hospital';
/** One-of-a-kind landmarks modelled on Kaohsiung's, and the big attractions a 直轄市 can build. */
export type LandmarkKind = 'tower85' | 'cityHall' | 'dragonTiger' | 'ferrisWheel' | 'arena' | 'themePark' | 'mall';
/** 綠化建設: green buildings and open spaces that count as parks for the homes around them. */
export type GreenKind = 'greenBuilding' | 'plaza' | 'ecoPark';
export type FacilityKind = ServiceKind | LandmarkKind | GreenKind | 'footbridge';

export const SERVICE_KINDS: ServiceKind[] = ['park', 'school', 'police', 'fire', 'hospital'];
export const LANDMARK_KINDS: LandmarkKind[] = ['tower85', 'cityHall', 'dragonTiger', 'ferrisWheel', 'arena', 'themePark', 'mall'];
export const GREEN_KINDS: GreenKind[] = ['greenBuilding', 'plaza', 'ecoPark'];

export interface FacilitySpec {
  label: string;
  cost: number;
  /** per simulation step */
  upkeep: number;
  /** footprint: along the road (w) and back from it (d), meters */
  w: number;
  d: number;
  /** service area, or the area a landmark makes more pleasant */
  radius: number;
  /** what residents say when they lack it */
  need?: string;
  /** landmarks: visitors a day per 1,000 residents (plus a few from outside) */
  tourists?: number;
  /** a service it gives the homes in its radius besides its own (綠化建設 count as parks) */
  serves?: ServiceKind;
  /** the city rank it opens at */
  unlock?: keyof typeof UNLOCK;
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
  themePark: { label: '主題樂園', cost: 50_000_000, upkeep: 550, w: 150, d: 120, radius: 1500, tourists: 16, unlock: 'themePark', color: 0xff7eb6, blurb: '雲霄飛車、旋轉木馬和城堡，觀光客最多的地方' },
  mall: { label: '購物商城', cost: 30_000_000, upkeep: 400, w: 110, d: 80, radius: 1200, tourists: 11, unlock: 'mall', color: 0x7ec8e3, blurb: '大型購物中心，帶來大量觀光與消費' },
  greenBuilding: { label: '綠建築', cost: 40000, upkeep: 160, w: 36, d: 32, radius: 260, serves: 'park', unlock: 'greenery', color: 0x7fcf7a, blurb: '屋頂花園與垂直綠牆的辦公大樓，附近算有公園' },
  plaza: { label: '綠地廣場', cost: 15000, upkeep: 60, w: 36, d: 36, radius: 200, serves: 'park', unlock: 'greenery', color: 0x9bd77f, blurb: '草地、樹蔭和噴水池的市民廣場' },
  ecoPark: { label: '生態公園', cost: 60000, upkeep: 120, w: 80, d: 70, radius: 420, serves: 'park', unlock: 'greenery', color: 0x3f9a4a, blurb: '濕地、步道和大片樹林，範圍比公園大很多' },
  footbridge: { label: '天橋', cost: 8000, upkeep: 20, w: 5, d: 30, radius: 160, unlock: 'footbridge', color: 0xd9d4c7, blurb: '跨過大馬路的行人天橋，讓附近更好走' },
  arena: { label: '巨蛋', cost: 160000, upkeep: 350, w: 90, d: 90, radius: 800, tourists: 8, color: 0xb8e0a0, blurb: '辦演唱會和球賽，觀光收入最多' },
};

/** What each tourist spends in the city, NT$. */
export const TOURIST_SPEND = 400;

export const isLandmark = (k: FacilityKind): k is LandmarkKind => (LANDMARK_KINDS as string[]).includes(k);

export interface Facility {
  id: number;
  kind: FacilityKind;
  /** centre */
  p: Vec2;
  /** direction of the footprint's width (along the road), radians */
  angle: number;
  /** footbridges: kerb-to-kerb width of the road they cross, plus their stairs */
  span?: number;
}

/** Footprint of a facility: along the road (w) and back from it (d). Footbridges fit the road they cross. */
export function dims(f: Pick<Facility, 'kind' | 'span'>): { w: number; d: number } {
  const { w, d } = FACILITIES[f.kind];
  return { w, d: f.span ?? d };
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

export function footprintContains(f: Pick<Facility, 'p' | 'angle' | 'kind' | 'span'>, q: Vec2, pad = 0): boolean {
  const { w, d } = dims(f);
  const l = toLocal(f, q);
  return Math.abs(l.u) <= w / 2 + pad && Math.abs(l.v) <= d / 2 + pad;
}

export function corners(f: Pick<Facility, 'p' | 'angle' | 'kind' | 'span'>): Vec2[] {
  const { w, d } = dims(f);
  return [
    toWorld(f, -w / 2, -d / 2),
    toWorld(f, w / 2, -d / 2),
    toWorld(f, w / 2, d / 2),
    toWorld(f, -w / 2, d / 2),
  ];
}

/** Points across a footprint, for checking the land under it. */
export function footprintGrid(f: Pick<Facility, 'p' | 'angle' | 'kind' | 'span'>, n = 6): Vec2[] {
  const { w, d } = dims(f);
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) pts.push(toWorld(f, (i / n - 0.5) * w, (j / n - 0.5) * d));
  return pts;
}

/** Whether a facility of this kind serves point p. */
export function covers(f: Facility, p: Vec2): boolean {
  return dist(f.p, p) <= FACILITIES[f.kind].radius;
}

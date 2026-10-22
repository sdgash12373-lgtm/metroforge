import { angleGuides } from '../sim/angles';
import { FACILITIES, type FacilityKind, type GreenKind, type LandmarkKind, SERVICE_KINDS, type ServiceKind, corners as facilityCorners } from '../sim/facilities';
import { ntd } from '../sim/format';
import { AIRPORT_COST, type Airport, Aviation, type RunwayCount } from '../sim/airport';
import type { City, RoadStyle } from '../sim/city';
import { LEVELS, UNLOCK } from '../sim/levels';
import { type GuideLine, alignToGuides } from '../sim/guides';
import { type Vec2, dist, lerp, quadPoint } from '../sim/geometry';
import { HOUR_STEPS, ROUNDABOUT_RADIUS, type RoundaboutSize } from '../sim/city';
import { RAIL_SPECS, type RailKind } from '../sim/rail';
import { ELEVATED_HEIGHT, LEVEL_TOLERANCE, MAX_GRADE, ROAD_WIDTH, type RoadNetwork, type Snap, TUNNEL_DEPTH } from '../sim/roads';
import { LINE_COLORS, type PathPiece, type Transit } from '../sim/transit';
import { ZONES, Zone, cellCenter } from '../sim/zoning';
import type { World } from '../render/world';

export type Tool =
  | 'pan'
  | 'road'
  | 'curve'
  | 'roundabout'
  | 'upgradeRoad'
  | 'zone'
  | 'bulldoze'
  | 'traffic'
  | 'bus'
  | RailKind
  | 'airport'
  | 'streetName'
  | 'district'
  | ServiceKind
  | 'landmark'
  | 'greenery'
  | 'footbridge'
  | 'demolish';

/** Tools that place a public service, landmark, green space or footbridge. */
export const isFacilityTool = (t: Tool): t is ServiceKind | 'landmark' | 'greenery' | 'footbridge' =>
  t === 'landmark' || t === 'greenery' || t === 'footbridge' || (SERVICE_KINDS as string[]).includes(t);

/** Train tools either lay track or plan lines through stations. */
export type RailAction = 'track' | 'line';

export const isRail = (t: Tool): t is RailKind => t === 'metro' || t === 'train' || t === 'hsr';

/** District size range and default, in meters. */
export const DISTRICT_MIN = 80;
export const DISTRICT_MAX = 600;

/** Airports turn in steps of this many degrees. */
const AIRPORT_TURN = 15;

/** What the road upgrade tool turns a street into. */
export type StyleChoice = 1 | 2 | 4 | 'walk' | 'nowalk';
export const STYLE_CHOICES: [StyleChoice, string][] = [
  [1, '雙向單線道'],
  [2, '雙向雙線道'],
  [4, '雙向四線道'],
  ['walk', '加人行道'],
  ['nowalk', '移除人行道'],
];
const styleOf = (c: StyleChoice): RoadStyle => (c === 'walk' ? { walk: true } : c === 'nowalk' ? { walk: false } : { lanes: c });

/** Which level the road tools build on. */
export type RoadLevel = 'ground' | 'elevated' | 'tunnel';
const LEVEL_HEIGHT: Record<RoadLevel, number> = { ground: 0, elevated: ELEVATED_HEIGHT, tunnel: TUNNEL_DEPTH };

/** Zoning brush radius range and default, in meters. */
export const BRUSH_MIN = 6;
export const BRUSH_MAX = 60;
export const BRUSH_DEFAULT = 18;

export interface ToolEvents {
  toast(msg: string): void;
  changed(): void;
}

/** What the active tool does with taps, drags and hover on the ground. */
export class ToolController {
  tool: Tool = 'road';
  zone: Zone = Zone.ResidentialLow;
  /** 更正: painting replaces zones already there instead of only filling empty cells */
  overwriteZones = false;
  /** road being drawn: start point, then (curve tool) the bend control point */
  draft: { start: Snap | null; control: Vec2 | null } = { start: null, control: null };
  hover: Vec2 | null = null;
  brushRadius = BRUSH_DEFAULT;
  roadLevel: RoadLevel = 'ground';
  roundaboutSize: RoundaboutSize = 4;
  roadStyle: StyleChoice = 2;
  /** stops of the bus or train line being planned */
  lineDraft: number[] = [];
  private draftPath: PathPiece[] = [];
  /** line picked in the dock, to rename, recolour or delete it */
  selectedLine: number | null = null;
  /** which landmark the landmark tool builds */
  landmark: LandmarkKind = 'tower85';
  /** which green space the 綠化 tool builds */
  green: GreenKind = 'plaza';
  /** taps pick a line on the map, and a second tap on it removes it */
  removingLines = false;
  railAction: RailAction = 'track';
  /** track tools draw curves instead of straight track */
  trackCurve = false;
  trackLevel: Record<RailKind, RoadLevel> = {
    metro: RAIL_SPECS.metro.defaultLevel,
    train: RAIL_SPECS.train.defaultLevel,
    hsr: RAIL_SPECS.hsr.defaultLevel,
  };
  runways: RunwayCount = 2;
  /** airport heading, degrees */
  airportAngle = 0;
  selectedFlight: number | null = null;
  /** a segment of the street picked for naming */
  selectedStreet: number | null = null;
  selectedDistrict: number | null = null;
  districtRadius = 250;

  constructor(
    private city: City,
    private world: World,
    private events: ToolEvents,
  ) {}

  setCity(city: City): void {
    this.city = city;
    this.cancel();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.cancel();
    this.selectedLine = null;
    this.removingLines = false;
    this.selectedFlight = null;
    this.selectedStreet = null;
    this.selectedDistrict = null;
    // A train system without track starts with laying track; one with lines, with the lines
    if (isRail(tool)) this.railAction = this.city.rails[tool].transit.lines.size ? 'line' : this.city.rails[tool].net.segments.size ? this.railAction : 'track';
    this.world.setShowEmptyCells(tool === 'zone');
    this.world.setTrafficOverlay(tool === 'traffic');
    this.world.setLineOverlay(tool === 'bus' ? 'bus' : isRail(tool) ? tool : null);
    this.updateUnderground();
    this.updatePickHeight();
    this.refresh();
  }

  setRoadLevel(level: RoadLevel): void {
    if (isRail(this.tool)) this.trackLevel[this.tool] = level;
    else this.roadLevel = level;
    this.updatePickHeight();
    this.updateUnderground();
    this.events.changed();
    this.refresh();
  }

  /** Level the active drawing tool builds on. */
  get level(): RoadLevel {
    return isRail(this.tool) ? this.trackLevel[this.tool] : this.roadLevel;
  }

  setRailAction(action: RailAction): void {
    this.cancel();
    this.railAction = action;
    this.selectedLine = null;
    this.removingLines = false;
    this.updatePickHeight();
    this.updateUnderground();
    this.events.changed();
    this.refresh();
  }

  setDistrictRadius(r: number): void {
    this.districtRadius = Math.max(DISTRICT_MIN, Math.min(DISTRICT_MAX, r));
    if (this.selectedDistrict !== null) this.city.editDistrict(this.selectedDistrict, { r: this.districtRadius });
    else this.hover = { ...this.world.rig.target };
    this.refresh();
  }

  selectStreet(id: number | null): void {
    this.selectedStreet = id;
    this.events.changed();
    this.refresh();
  }

  selectDistrict(id: number | null): void {
    this.selectedDistrict = id;
    const d = id !== null ? this.city.districts.get(id) : undefined;
    if (d) this.districtRadius = d.r;
    this.events.changed();
    this.refresh();
  }

  deleteDistrict(id: number): void {
    this.city.removeDistrict(id);
    this.selectedDistrict = null;
    this.events.toast('區域已刪除');
    this.events.changed();
    this.refresh();
  }

  setTrackCurve(on: boolean): void {
    this.trackCurve = on;
    this.draft = { start: null, control: null };
    this.events.changed();
    this.refresh();
  }

  setRunways(n: RunwayCount): void {
    this.runways = n;
    this.events.changed();
    this.refresh();
  }

  turnAirport(): void {
    this.airportAngle = (this.airportAngle + AIRPORT_TURN) % 180;
    this.events.changed();
    this.refresh();
  }

  /** Adds a flight at the airport and opens it for editing. */
  addFlight(): void {
    const f = this.city.aviation.addFlight();
    if (!f) {
      this.events.toast('先蓋一座機場才能開航班');
      return;
    }
    this.selectedFlight = f.id;
    this.events.toast(`航班 ${f.name} 已開航`);
    this.events.changed();
  }

  selectFlight(id: number | null): void {
    this.selectedFlight = id;
    this.events.changed();
  }

  deleteFlight(id: number): void {
    this.city.aviation.removeFlight(id);
    this.selectedFlight = null;
    this.events.toast('航班已取消');
    this.events.changed();
  }

  setRoadStyle(c: StyleChoice): void {
    this.roadStyle = c;
    this.events.changed();
    this.refresh();
  }

  /** The street under p, for the upgrade tool. */
  private streetAt(p: Vec2) {
    const r = Math.max(ROAD_WIDTH / 2, this.world.rig.snapRadius * 0.6);
    const hit = this.city.net.segmentAt(p, r, 0);
    return hit && !hit.seg.oneway ? hit.seg : null;
  }

  private upgradeHint(): string {
    if (!this.city.unlocked('roadUpgrade')) return `城市升級為「${LEVELS[UNLOCK.roadUpgrade].name}」後開放道路升級與人行道`;
    const seg = this.hover && this.streetAt(this.hover);
    const label = STYLE_CHOICES.find(([c]) => c === this.roadStyle)![1];
    if (!seg) return `選好樣式後點一條道路：整條路（直行穿過路口的部分）改為「${label}」；拓寬會把兩旁的建築往後移`;
    const cost = this.city.restyleCost(this.city.net.street(seg), styleOf(this.roadStyle));
    return `${seg.name ?? '這條路'} → ${label} · ${cost ? `約 ${ntd(cost)}` : '免費'}　點一下套用`;
  }

  setRoundaboutSize(size: RoundaboutSize): void {
    this.roundaboutSize = size;
    this.events.changed();
    this.refresh();
  }

  /** Tools that draw roads or track by tapping a start and an end. */
  private get isRoadTool(): boolean {
    return this.tool === 'road' || this.tool === 'curve' || this.drawsTrack;
  }

  private get drawsTrack(): boolean {
    return isRail(this.tool) && this.railAction === 'track';
  }

  /** The drawing tool takes a bend control point. */
  private get curved(): boolean {
    return this.tool === 'curve' || (this.drawsTrack && this.trackCurve);
  }

  /** Network the drawing tool builds on. */
  private get net(): RoadNetwork {
    return isRail(this.tool) ? this.city.rails[this.tool].net : this.city.net;
  }

  /** Stops and lines of the active bus or train tool. */
  get transit(): Transit | null {
    if (this.tool === 'bus') return this.city.transit;
    return isRail(this.tool) ? this.city.rails[this.tool].transit : null;
  }

  /** The tool plans bus or train lines. */
  get plansLines(): boolean {
    return this.tool === 'bus' || (isRail(this.tool) && this.railAction === 'line');
  }

  /** Height new road or track ends are built at. */
  private get height(): number {
    return LEVEL_HEIGHT[this.level];
  }

  /** Taps land on the plane being built on, so the finger sits on the deck or tunnel being drawn. */
  private updatePickHeight(): void {
    this.world.rig.pickHeight = this.isRoadTool ? this.height : 0;
  }

  /** See-through ground while building tunnels or metro lines, and a cleared city for the metro; tunnels marked on the surface while bulldozing. */
  private updateUnderground(): void {
    this.world.setXray((this.isRoadTool && this.level === 'tunnel') || (this.tool === 'metro' && this.railAction === 'line'));
    this.world.setUndergroundView(this.tool === 'bulldoze');
    // Metro runs over and under the city: buildings and streets would hide the track being laid
    this.world.setDeclutter(this.tool === 'metro');
  }

  setOverwriteZones(on: boolean): void {
    this.overwriteZones = on;
    this.events.changed();
    this.refresh();
  }

  setZone(zone: Zone): void {
    this.zone = zone;
    this.events.changed();
    this.refresh();
  }

  /** Resizes the zoning brush and shows it at the middle of the view so the size can be judged. */
  setBrushRadius(r: number): void {
    this.brushRadius = Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, r));
    this.hover = { ...this.world.rig.target };
    this.refresh();
  }

  cancel(): void {
    this.draft = { start: null, control: null };
    if (this.lineDraft.length) {
      this.lineDraft = [];
      this.draftPath = [];
      for (const t of this.city.transits) t.pruneStops();
    }
    this.events.changed();
    this.refresh();
  }

  get drawing(): boolean {
    return this.draft.start !== null;
  }

  /** Opens the planned line. */
  finishLine(): void {
    const t = this.transit;
    if (!t) return;
    const r = this.city.createLine(t, this.lineDraft);
    if (!r.ok) {
      if (r.reason) this.events.toast(r.reason);
      return;
    }
    this.events.toast(`${t.mode.label}路線開通！${this.lineDraft.length} 站，花費 ${ntd(r.cost)}`);
    this.lineDraft = [];
    this.draftPath = [];
    this.events.changed();
    this.refresh();
  }

  clearLines(): void {
    const t = this.transit;
    if (!t) return;
    t.clearLines();
    t.pruneStops();
    this.selectedLine = null;
    this.events.toast(`所有${t.mode.label}路線已清除`);
    this.events.changed();
    this.refresh();
  }

  deleteLine(id: number): void {
    this.transit?.removeLine(id);
    this.selectedLine = null;
    this.events.toast('路線已刪除');
    this.events.changed();
    this.refresh();
  }

  setRemovingLines(on: boolean): void {
    this.cancel();
    this.removingLines = on;
    this.selectedLine = null;
    this.events.changed();
  }

  removeSelectedLine(): void {
    const t = this.transit;
    const line = this.selectedLine !== null ? t?.lines.get(this.selectedLine) : undefined;
    if (!t || !line) return;
    t.removeLine(line.id);
    this.selectedLine = null;
    this.events.toast(`${line.name}已拆除`);
    this.events.changed();
    this.refresh();
  }

  /** In removal mode: the first tap on a line picks it, a second tap on the same line removes it. */
  private tapRemoveLine(p: Vec2): void {
    const t = this.transit!;
    const line = t.lineAt(p, Math.max(12, this.world.rig.snapRadius));
    if (!line) {
      this.selectedLine = null;
      this.events.toast('點地圖上的路線或車站');
    } else if (this.selectedLine === line.id) {
      this.removeSelectedLine();
      return;
    } else this.selectedLine = line.id;
    this.events.changed();
    this.refresh();
  }

  selectLine(id: number | null): void {
    this.selectedLine = id;
    this.events.changed();
  }

  /** Once a road has a start, a finger drag places its end (with the ghost road following). */
  get aimsOnDrag(): boolean {
    return this.isRoadTool && this.drawing;
  }

  /** Painting tools take one-finger drags; the others use drags to move the camera. */
  get paintsOnDrag(): boolean {
    return this.tool === 'zone';
  }

  private snap(p: Vec2): Snap {
    const net = this.net;
    const r = this.world.rig.snapRadius;
    const h = this.height;
    if (h === 0) return net.snap(p, r, 0);
    // Roads on the level being drawn win, then streets at that spot (to start a ramp). Taps land on the
    // deck or tunnel plane, so the street is looked up where the finger points on the ground.
    const own = net.snap(p, r, h);
    if (own.kind !== 'free' && Math.abs(net.snapHeight(own, 0) - h) < LEVEL_TOLERANCE) return own;
    const street = net.snap(this.world.rig.toGround(p, h), r, 0);
    return street.kind !== 'free' ? street : own;
  }

  /**
   * Road-tool snap: existing roads first, then alignment with other road ends, and a free end always
   * lands in the middle of a grid square. Guides only show when that still keeps the point on them.
   */
  private snapRoad(p: Vec2): { snap: Snap; guides: GuideLine[] } {
    const s = this.snap(p);
    if (s.kind !== 'free') return { snap: s, guides: [] };
    const a = alignToGuides(this.net, p, this.world.rig.snapRadius * 0.6);
    const c = cellCenter(a.p);
    return { snap: { kind: 'free', p: c }, guides: dist(c, a.p) < 0.5 ? a.lines : [] };
  }

  hint(): string {
    switch (this.tool) {
      case 'pan':
        return '拖曳移動地圖；雙指縮放、旋轉；滑鼠右鍵旋轉視角、滾輪縮放。';
      case 'road':
      case 'curve':
        return this.drawHint('道路', '拉路');
      case 'zone':
        if (this.zone === Zone.None) return '在格子上塗抹以清除分區';
        return this.overwriteZones
          ? `更正中：塗到的格子都改成「${ZONES[this.zone].name}」，包括已經有分區的；雙指移動地圖`
          : `塗抹空的格子設為「${ZONES[this.zone].name}」，已有的分區不會被蓋掉（要改請按「更正」）；雙指移動地圖`;
      case 'upgradeRoad':
        return this.upgradeHint();
      case 'roundabout': {
        const cost = this.city.roundaboutCost(this.roundaboutSize);
        return `${this.roundaboutSize} 通圓環 · 約 ${ntd(cost)}　靠近路口或道路會自動吸附（橘色圈），壓到的道路自動接上；車輛逆時針單向繞行`;
      }
      case 'bulldoze':
        return '點道路、軌道或機場拆除，退還一半費用；藍色是地下的隧道';
      case 'traffic': {
        const v = this.city.traffic.vehicles;
        const avg = v.length ? (v.reduce((sum, x) => sum + x.speed, 0) / v.length) * 3.6 : 0;
        return `車輛 ${v.length} 台 · 平均 ${Math.round(avg)} km/h · 已完成 ${this.city.traffic.tripsCompleted.toLocaleString()} 趟　綠 = 順暢、紅 = 塞車`;
      }
      case 'bus':
        return this.lineHint();
      case 'metro':
      case 'train':
      case 'hsr':
        return this.railAction === 'track' ? this.drawHint(`${RAIL_SPECS[this.tool].mode.label}軌道`, '拉軌道') : this.lineHint();
      case 'airport':
        return this.airportHint();
      case 'park':
      case 'school':
      case 'police':
      case 'fire':
      case 'hospital':
      case 'landmark':
      case 'greenery':
      case 'footbridge':
        return this.facilityHint();
      case 'demolish': {
        const f = this.hover && this.city.facilityAt(this.hover, 2);
        if (f) return `${FACILITIES[f.kind].label}：點一下拆除，退還 ${ntd(Math.round(FACILITIES[f.kind].cost * 0.5))}`;
        return '點公共建設、綠化建設或地標拆除，退還一半費用（道路和軌道請用「拆除」）';
      }
      case 'streetName': {
        const seg = this.selectedStreet !== null ? this.city.net.segments.get(this.selectedStreet) : undefined;
        if (seg) return `${seg.name ?? '這條路'}：在上方輸入路名，整條路（直行穿過路口的部分）都會套用`;
        return '點一條道路替它取路名；路名會沿著道路顯示在地圖上';
      }
      case 'district': {
        const d = this.selectedDistrict !== null ? this.city.districts.get(this.selectedDistrict) : undefined;
        if (d) return `${d.name}：在上方改名稱與顏色，拉桿調整範圍；點空地再新增一個區域`;
        return '點地圖新增區域並命名，拉桿調整範圍；點區域中央可以修改';
      }
    }
  }

  /** The kind of facility the active tool places. */
  get facilityKind(): FacilityKind | null {
    if (this.tool === 'landmark') return this.landmark;
    if (this.tool === 'greenery') return this.green;
    return isFacilityTool(this.tool) ? this.tool : null;
  }

  setGreen(kind: GreenKind): void {
    this.green = kind;
    this.events.changed();
    this.refresh();
  }

  setLandmark(kind: LandmarkKind): void {
    this.landmark = kind;
    this.events.changed();
    this.refresh();
  }

  private facilityHint(): string {
    const kind = this.facilityKind!;
    const spec = FACILITIES[kind];
    if (this.hover) {
      const spot = this.city.facilitySpot(kind, this.hover);
      const problem = this.city.facilityProblem(kind, spot.p, spot.angle);
      if (problem) return problem;
    }
    const tour = spec.tourists ? '・吸引觀光客' : '';
    const where = kind === 'footbridge' ? '點馬路（離路口遠一點）蓋一座橫跨的天橋' : '點道路旁的空地興建';
    const park = spec.serves === 'park' ? '・算作公園' : '';
    return `${spec.label} · ${ntd(spec.cost)} · 每兩週維護 ${ntd(spec.upkeep * HOUR_STEPS)} · 範圍 ${spec.radius} 公尺${tour}${park}　${spec.blurb}；${where}`;
  }

  /** Hint for drawing a road or track: length and price of the ghost, or how to start. */
  private drawHint(what: string, verb: string): string {
    const { start, control } = this.draft;
    if (start && this.hover && (!this.curved || control)) {
      const end = this.snapRoad(this.hover).snap;
      const steep = this.city.buildProblem(start, control, end, this.height, this.net);
      if (steep) return steep;
      const len = Math.round(Math.hypot(end.p.x - start.p.x, end.p.y - start.p.y));
      const [ha, hb] = this.city.roadHeights(start, end, this.height, this.net);
      const cost = this.cost(start.p, control, end.p, ha, hb);
      const kind = ha === hb ? (ha > 0 ? '高架 ' : ha < 0 ? '隧道 ' : '') : hb < 0 || ha < 0 ? '隧道入口 ' : '匝道 ';
      return `${kind}約 ${len} 公尺 · ${ntd(cost)}　點一下完成；再點起點或按右鍵結束${verb}`;
    }
    if (this.level === 'elevated' && !start) {
      return `高架${what}：從地面接出會自動做成匝道（至少 ${Math.ceil(ELEVATED_HEIGHT / MAX_GRADE)} 公尺），跨過地面不會形成路口`;
    }
    if (this.level === 'tunnel' && !start) {
      return `地下${what}：地面變透明，看得到地底下；從地面接出會自動做成隧道入口（至少 ${Math.ceil(-TUNNEL_DEPTH / MAX_GRADE)} 公尺）`;
    }
    if (this.curved) return start ? '點一下決定彎曲的方向（控制點）' : `曲線${what}：點起點 → 控制點 → 終點`;
    return start ? '點終點，或按住拖曳預覽路徑、放開完成；雙指移動地圖' : `直線${what}：點起點，再點終點，可連續${verb}`;
  }

  private cost(a: Vec2, c: Vec2 | null, b: Vec2, ha: number, hb: number): number {
    return isRail(this.tool) ? this.city.trackCost(this.tool, a, c, b, ha, hb) : this.city.roadCost(a, c, b, ha, hb);
  }

  private lineHint(): string {
    const t = this.transit!;
    const { label } = t.mode;
    const n = this.lineDraft.length;
    if (n === 1) return `已設 1 站（每站 ${ntd(t.mode.stopCost)}）；沿著路線點下一站`;
    if (n > 1) return t.mode.reverses ? `已設 ${n} 站；點「完成路線」開通，列車在兩端折返` : `已設 ${n} 站；點第一站或「完成路線」讓公車繞回起點`;
    const picked = this.selectedLine !== null ? t.lines.get(this.selectedLine) : undefined;
    if (this.removingLines) {
      if (picked) return `${picked.name}：再點一次路線或按「確定拆除」（沒有其他路線使用的車站會一起移除）`;
      return t.lines.size ? `拆除路線：點地圖上的${label}路線或車站選取` : `沒有${label}路線可以拆除`;
    }
    if (picked) return `${picked.name}：${label} ${t.buses(picked.id).length} 列 · 載客 ${picked.riders.toLocaleString()} 人`;
    if (!t.lines.size) {
      if (t.mode.streetsOnly) return '公車：點地面道路設第一個站，依序點下一站，最後點回第一站完成路線';
      if (!t.net.segments.size) return `先用「軌道」拉${label}軌道，再到「路線」設車站`;
      return `${label}：在軌道上點一下設車站（每站 ${ntd(t.mode.stopCost)}），依序點下一站，再按「完成路線」`;
    }
    let riders = 0;
    let waiting = 0;
    for (const l of t.lines.values()) riders += l.riders;
    for (const st of t.stops.values()) waiting += t.waitingAt(st);
    return `${label} ${t.buses().length} ${t.mode.streetsOnly ? '台' : '列'} · 累計載客 ${riders.toLocaleString()} 人 · 候車 ${waiting.toLocaleString()} 人　點${t.mode.streetsOnly ? '道路' : '軌道'}開新路線`;
  }

  private airportHint(): string {
    const air = this.city.aviation;
    const f = this.selectedFlight !== null ? air.flights.get(this.selectedFlight) : undefined;
    if (f) return `${f.name}：已載客 ${f.passengers.toLocaleString()} 人　每班約 ${air.passengersPerFlight(this.city.stats.population)} 人`;
    const cost = AIRPORT_COST[this.runways];
    const base = `${this.runways === 2 ? '雙' : '四'}跑道機場 · ${ntd(cost)}　點空地蓋機場，「旋轉」調整方向`;
    if (!air.airports.size) return base;
    return `航班 ${air.flights.size} 班 · 每班約 ${air.passengersPerFlight(this.city.stats.population)} 人；按「新增航班」開航，點航班改名稱與機身顏色`;
  }

  onHover(p: Vec2 | null): void {
    this.hover = p;
    this.refresh();
  }

  onTap(p: Vec2): void {
    this.hover = p;
    if (this.isRoadTool) this.tapRoad(p);
    else if (this.plansLines) this.tapLine(p);
    else if (this.tool === 'upgradeRoad') {
      const seg = this.streetAt(p);
      if (!seg) this.events.toast('點一條道路來升級（圓環除外）');
      else {
        const r = this.city.restyleRoad(seg.id, styleOf(this.roadStyle));
        this.events.toast(r.ok ? `道路已改為「${STYLE_CHOICES.find(([c]) => c === this.roadStyle)![1]}」，花費 ${ntd(r.cost)}` : (r.reason ?? '不能升級'));
      }
    } else if (this.tool === 'streetName') {
      const net = this.city.net;
      const r = Math.max(ROAD_WIDTH / 2, this.world.rig.snapRadius * 0.6);
      const hit = net.segmentAt(p, r, 0) ?? net.segmentAt(p, r);
      if (!hit || hit.seg.oneway) this.events.toast(hit ? '圓環不能命名，請點其他道路' : '點一條道路來命名');
      this.selectedStreet = hit && !hit.seg.oneway ? hit.seg.id : null;
      this.events.changed();
    } else if (this.tool === 'district') {
      const d = this.city.districtAt(p, this.world.rig.snapRadius * 2);
      if (d) this.selectDistrict(d.id);
      else {
        const nd = this.city.addDistrict(p, this.districtRadius);
        this.selectedDistrict = nd.id;
        this.events.toast(`已新增「${nd.name}」，可在上方改名稱`);
      }
    } else if (this.facilityKind) {
      const kind = this.facilityKind;
      const spot = this.city.facilitySpot(kind, p);
      const r = this.city.buildFacility(kind, spot.p, spot.angle);
      this.events.toast(r.ok ? `${FACILITIES[kind].label}完成，花費 ${ntd(r.cost)}` : (r.reason ?? '這裡不能蓋'));
    } else if (this.tool === 'airport') {
      const r = this.city.buildAirport(p, this.radians, this.runways);
      this.events.toast(r.ok ? `機場完成，花費 ${ntd(r.cost)}；按「新增航班」開航` : (r.reason ?? '這裡不能蓋機場'));
    }
    else if (this.tool === 'roundabout') {
      const r = this.city.buildRoundabout(this.roundaboutCenter(p).p, this.roundaboutSize);
      this.events.toast(r.ok ? `圓環完成，花費 ${ntd(r.cost)}` : (r.reason ?? '這裡不能蓋圓環'));
    } else if (this.tool === 'demolish') {
      const r = this.city.demolish(p);
      this.events.toast(r.ok ? `${r.what}已拆除，退還 ${ntd(r.refund)}` : (r.reason ?? '這裡沒有建設'));
    } else if (this.tool === 'bulldoze') {
      const r = this.city.bulldoze(p, Math.max(ROAD_WIDTH / 2, this.world.rig.snapRadius * 0.6));
      if (r.ok) this.events.toast(`${r.what ?? '道路'}已拆除，退還 ${ntd(r.refund)}`);
      else if (r.reason) this.events.toast(r.reason);
    } else if (this.tool === 'zone') this.onPaint(p);
    this.events.changed();
    this.refresh();
  }

  onPaint(p: Vec2): void {
    this.hover = p;
    this.city.paint(p, this.brushRadius, this.zone, this.overwriteZones);
    this.refresh();
  }

  private tapRoad(p: Vec2): void {
    const s = this.snapRoad(p).snap;
    const { start } = this.draft;
    if (!start) {
      this.draft.start = s;
      return;
    }
    if (Math.hypot(s.p.x - start.p.x, s.p.y - start.p.y) < 2) {
      this.cancel();
      return;
    }
    if (this.curved && !this.draft.control) {
      this.draft.control = { x: p.x, y: p.y };
      return;
    }
    const r = isRail(this.tool)
      ? this.city.buildTrack(this.tool, start, this.draft.control, s, this.height)
      : this.city.buildRoad(start, this.draft.control, s, false, this.height);
    if (!r.ok) {
      if (r.reason) this.events.toast(r.reason);
      return;
    }
    // Keep drawing from where this road ended
    const end = this.net.nodes.get(r.endNode!)!;
    this.draft = { start: { kind: 'node', node: end, p: end.p }, control: null };
  }

  /**
   * Where a roundabout at p would go: onto a nearby crossroads or road end first, else centred on a
   * road it is near, so its existing roads join the ring cleanly.
   */
  private roundaboutCenter(p: Vec2): { p: Vec2; snapped: boolean } {
    const net = this.city.net;
    const ring = ROUNDABOUT_RADIUS[this.roundaboutSize];
    const street = (id: number) =>
      [...net.segments.values()].every((s) => (s.a !== id && s.b !== id) || net.isStreet(s));
    let best: { p: Vec2; d: number } | null = null;
    for (const n of net.nodes.values()) {
      if (n.h !== 0 || !street(n.id)) continue;
      // Junctions pull from the whole ring; plain bends and road ends only from closer in
      const reach = net.degree(n.id) >= 3 ? ring : ring * 0.6;
      const d = Math.hypot(n.p.x - p.x, n.p.y - p.y);
      if (d < reach && (!best || d < best.d)) best = { p: n.p, d };
    }
    if (best) return { p: { ...best.p }, snapped: true };
    const hit = net.segmentAt(p, ring * 0.6, 0);
    if (hit && net.isStreet(hit.seg)) return { p: quadPoint(net.quad(hit.seg), hit.t), snapped: true };
    return { p, snapped: false };
  }

  /** Airport heading in radians. */
  private get radians(): number {
    return (this.airportAngle * Math.PI) / 180;
  }

  private tapLine(p: Vec2): void {
    if (this.removingLines) {
      this.tapRemoveLine(p);
      return;
    }
    const transit = this.transit!;
    const r = this.world.rig.snapRadius;
    const first = this.lineDraft[0];
    // Tapping the first stop again closes the loop
    if (this.lineDraft.length >= 2 && transit.stopNear(p, r)?.id === first) {
      this.finishLine();
      return;
    }
    const stop = transit.stopAt(p, r);
    if (!stop) {
      const { label } = transit.mode;
      this.events.toast(transit.mode.streetsOnly ? '公車站要設在地面道路旁（高架道路不能設站）' : `${label}車站要設在${label}軌道上（坡道上不能設站）`);
      return;
    }
    if (stop.id === this.lineDraft[this.lineDraft.length - 1]) return;
    this.lineDraft.push(stop.id);
    this.draftPath = transit.plan(this.lineDraft, false).path;
  }

  /** Pushes the current previews (ghost road, snap ring, brush) to the 3D view. */
  refresh(): void {
    const w = this.world;
    const isRoad = this.isRoadTool;
    const road = this.hover && isRoad ? this.snapRoad(this.hover) : null;
    const hoverSnap = road?.snap ?? null;
    w.setGuideLines(road?.guides ?? []);
    // Without hover (touch), keep marking where the road being drawn starts
    const marker = hoverSnap?.p ?? (isRoad ? (this.draft.start?.p ?? null) : this.tool === 'bulldoze' ? this.hover : null);
    const net = this.net;
    const markerHeight = hoverSnap ? net.snapHeight(hoverSnap, this.height) : this.draft.start ? net.snapHeight(this.draft.start, this.height) : 0;
    w.setCursor(marker, hoverSnap ? hoverSnap.kind !== 'free' || !!road?.guides.length : isRoad, isRoad ? markerHeight : 0);
    w.setGrid(isRoad, marker, isRoad ? markerHeight : 0);
    const t = this.transit;
    if (this.plansLines && t) {
      const near = this.hover && (t.stopNear(this.hover, this.world.rig.snapRadius)?.p ?? t.locate(this.hover, this.world.rig.snapRadius)?.p);
      w.setCursor(near ?? null, true);
    }
    w.setDraftLine(this.plansLines && t ? this.draftPath : null, LINE_COLORS[((t?.nextLine ?? 1) - 1) % LINE_COLORS.length], t?.net);
    if (this.tool === 'upgradeRoad') {
      const seg = this.hover && this.city.unlocked('roadUpgrade') ? this.streetAt(this.hover) : null;
      const path = seg ? this.city.net.street(seg).map((x) => ({ seg: x.id, dir: 1 as const, from: 0, to: x.length })) : null;
      w.setDraftLine(path, 0x4cc3f2, this.city.net, 0, 6);
    }
    if (this.tool === 'streetName') {
      const seg = this.selectedStreet !== null ? this.city.net.segments.get(this.selectedStreet) : undefined;
      const path = seg ? this.city.net.street(seg).map((x) => ({ seg: x.id, dir: 1 as const, from: 0, to: x.length })) : null;
      w.setDraftLine(path, 0xf2b134, this.city.net, 0, 6);
    }
    w.setDistrictRings(this.tool === 'district' ? [...this.city.districts.values()] : null, this.selectedDistrict);
    if (this.tool === 'district') {
      const sel = this.selectedDistrict !== null ? this.city.districts.get(this.selectedDistrict) : undefined;
      w.setBrush(sel ? null : this.hover, this.districtRadius, 0xffffff);
    }
    if (this.tool === 'airport' && this.hover) {
      const plan: Airport = { id: -1, p: this.hover, angle: this.radians, runways: this.runways };
      w.setFootprint(Aviation.corners(plan), this.city.money >= AIRPORT_COST[this.runways]);
    } else if (this.facilityKind && this.hover) {
      const kind = this.facilityKind;
      const spot = this.city.facilitySpot(kind, this.hover);
      w.setFootprint(facilityCorners({ kind, ...spot }), !this.city.facilityProblem(kind, spot.p, spot.angle));
    } else if (this.tool === 'demolish' && this.hover) {
      const f = this.city.facilityAt(this.hover, 2);
      w.setFootprint(f ? facilityCorners(f) : null, false);
    } else w.setFootprint(null, true);
    // Service areas: the kind being placed, existing ones and the planned one
    const kind = this.facilityKind;
    if (kind) {
      const areas = [...this.city.facilities.values()]
        .filter((f) => f.kind === kind)
        .map((f) => ({ p: f.p, r: FACILITIES[f.kind].radius, color: FACILITIES[f.kind].color }));
      if (this.hover) areas.push({ p: this.city.facilitySpot(kind, this.hover).p, r: FACILITIES[kind].radius, color: 0xffffff });
      w.setCoverage(areas);
    } else w.setCoverage([]);
    if (this.tool === 'roundabout') {
      const c = this.hover && this.roundaboutCenter(this.hover);
      w.setBrush(c?.p ?? null, ROUNDABOUT_RADIUS[this.roundaboutSize], c?.snapped ? 0xf2b134 : 0xffffff);
    }
    else w.setBrush(this.tool === 'zone' ? this.hover : null, this.brushRadius, this.zone === Zone.None ? 0xffffff : ZONES[this.zone].color);
    const { start, control } = this.draft;
    if (isRoad && start && hoverSnap) {
      const ctrl = this.curved ? (control ?? lerp(start.p, hoverSnap.p, 0.5)) : null;
      const end = hoverSnap.p;
      const [ha, hb] = this.city.roadHeights(start, hoverSnap, this.height, net);
      const cost = this.cost(start.p, ctrl, end, ha, hb);
      const ok = cost <= this.city.money && !this.city.buildProblem(start, ctrl, hoverSnap, this.height, net);
      w.setPreview({ a: start.p, c: ctrl ?? lerp(start.p, end, 0.5), b: end }, ok, ha, hb);
      w.setAngleGuides(angleGuides(net, start, ctrl, hoverSnap));
    } else {
      w.setPreview(null, true);
      w.setAngleGuides([]);
    }
  }
}

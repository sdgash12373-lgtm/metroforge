import { angleGuides } from '../sim/angles';
import type { City } from '../sim/city';
import { type GuideLine, alignToGuides } from '../sim/guides';
import { type Vec2, lerp } from '../sim/geometry';
import { ROUNDABOUT_RADIUS, type RoundaboutSize } from '../sim/city';
import { ELEVATED_HEIGHT, LEVEL_TOLERANCE, MAX_GRADE, ROAD_WIDTH, type Snap, TUNNEL_DEPTH } from '../sim/roads';
import { LINE_COLORS, type PathPiece, STOP_COST } from '../sim/transit';
import { ZONES, Zone } from '../sim/zoning';
import type { World } from '../render/world';

export type Tool = 'pan' | 'road' | 'curve' | 'roundabout' | 'zone' | 'bulldoze' | 'traffic' | 'bus';

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
  /** road being drawn: start point, then (curve tool) the bend control point */
  draft: { start: Snap | null; control: Vec2 | null } = { start: null, control: null };
  hover: Vec2 | null = null;
  brushRadius = BRUSH_DEFAULT;
  roadLevel: RoadLevel = 'ground';
  roundaboutSize: RoundaboutSize = 4;
  /** stops of the bus line being planned */
  lineDraft: number[] = [];
  private draftPath: PathPiece[] = [];
  /** bus line picked in the dock, e.g. to delete it */
  selectedLine: number | null = null;

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
    this.world.setShowEmptyCells(tool === 'zone');
    this.world.setTrafficOverlay(tool === 'traffic');
    this.world.setLineOverlay(tool === 'bus');
    this.world.setUndergroundView((this.isRoadTool && this.roadLevel === 'tunnel') || tool === 'bulldoze');
    this.updatePickHeight();
    this.refresh();
  }

  setRoadLevel(level: RoadLevel): void {
    this.roadLevel = level;
    this.updatePickHeight();
    this.world.setUndergroundView(this.isRoadTool && level === 'tunnel');
    this.events.changed();
    this.refresh();
  }

  setRoundaboutSize(size: RoundaboutSize): void {
    this.roundaboutSize = size;
    this.events.changed();
    this.refresh();
  }

  private get isRoadTool(): boolean {
    return this.tool === 'road' || this.tool === 'curve';
  }

  /** Height new road ends are built at. */
  private get level(): number {
    return LEVEL_HEIGHT[this.roadLevel];
  }

  /** Taps land on the elevated deck plane while drawing elevated roads; tunnels are drawn from the surface. */
  private updatePickHeight(): void {
    this.world.rig.pickHeight = this.isRoadTool && this.roadLevel === 'elevated' ? ELEVATED_HEIGHT : 0;
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
      this.city.transit.pruneStops();
    }
    this.events.changed();
    this.refresh();
  }

  get drawing(): boolean {
    return this.draft.start !== null;
  }

  /** Opens the planned bus line. */
  finishLine(): void {
    const r = this.city.createBusLine(this.lineDraft);
    if (!r.ok) {
      if (r.reason) this.events.toast(r.reason);
      return;
    }
    this.events.toast(`公車路線開通！${this.lineDraft.length} 站，花費 $${r.cost.toLocaleString()}`);
    this.lineDraft = [];
    this.draftPath = [];
    this.events.changed();
    this.refresh();
  }

  clearLines(): void {
    this.city.transit.clearLines();
    this.selectedLine = null;
    this.events.toast('所有公車路線已清除');
    this.events.changed();
    this.refresh();
  }

  deleteLine(id: number): void {
    this.city.transit.removeLine(id);
    this.selectedLine = null;
    this.events.toast('路線已刪除');
    this.events.changed();
    this.refresh();
  }

  selectLine(id: number | null): void {
    this.selectedLine = id;
    this.events.changed();
  }

  /** Painting tools take one-finger drags; the others use drags to move the camera. */
  get paintsOnDrag(): boolean {
    return this.tool === 'zone';
  }

  private snap(p: Vec2): Snap {
    const net = this.city.net;
    const r = this.world.rig.snapRadius;
    const h = this.level;
    if (h === 0) return net.snap(p, r, 0);
    // Roads on the level being drawn win, then streets at that spot (to start a ramp). Elevated taps
    // land on the deck plane, so the street is looked up where the finger points on the ground.
    const own = net.snap(p, r, h);
    if (own.kind !== 'free' && Math.abs(net.snapHeight(own, 0) - h) < LEVEL_TOLERANCE) return own;
    const street = net.snap(h > 0 ? this.world.rig.toGround(p, h) : p, r, 0);
    return street.kind !== 'free' ? street : own;
  }

  /** Road-tool snap: existing roads first, then alignment with other road ends. */
  private snapRoad(p: Vec2): { snap: Snap; guides: GuideLine[] } {
    const s = this.snap(p);
    if (s.kind !== 'free') return { snap: s, guides: [] };
    const a = alignToGuides(this.city.net, p, this.world.rig.snapRadius * 0.6);
    return { snap: { kind: 'free', p: a.p }, guides: a.lines };
  }

  hint(): string {
    switch (this.tool) {
      case 'pan':
        return '拖曳移動地圖；雙指縮放、旋轉；滑鼠右鍵旋轉視角、滾輪縮放。';
      case 'road':
      case 'curve': {
        const { start, control } = this.draft;
        if (start && this.hover && (this.tool === 'road' || control)) {
          const end = this.snapRoad(this.hover).snap;
          const steep = this.city.gradeProblem(start, control, end, this.level);
          if (steep) return steep;
          const len = Math.round(Math.hypot(end.p.x - start.p.x, end.p.y - start.p.y));
          const [ha, hb] = this.city.roadHeights(start, end, this.level);
          const cost = this.city.roadCost(start.p, control, end.p, ha, hb);
          const kind = ha === hb ? (ha > 0 ? '高架 ' : ha < 0 ? '隧道 ' : '') : hb < 0 || ha < 0 ? '隧道入口 ' : '匝道 ';
          return `${kind}約 ${len} 公尺 · $${cost.toLocaleString()}　點一下完成，再點起點結束拉路`;
        }
        if (this.roadLevel === 'elevated' && !start) {
          return `高架道路：從地面道路接出會自動做成匝道（至少 ${Math.ceil(ELEVATED_HEIGHT / MAX_GRADE)} 公尺），跨過地面道路不會形成路口`;
        }
        if (this.roadLevel === 'tunnel' && !start) {
          return `地下道路：從地面道路接出會自動做成隧道入口（至少 ${Math.ceil(-TUNNEL_DEPTH / MAX_GRADE)} 公尺），藍色是地底下的道路`;
        }
        if (this.tool === 'curve') return start ? '點一下決定彎曲的方向（控制點）' : '曲線道路：點起點 → 控制點 → 終點';
        return start ? '點終點；交叉處會自動變成路口' : '直線道路：點起點，再點終點，可連續拉路';
      }
      case 'zone':
        return this.zone === Zone.None ? '在格子上塗抹以清除分區' : `塗抹道路旁的格子設為「${ZONES[this.zone].name}」；雙指移動地圖`;
      case 'roundabout': {
        const cost = this.city.roundaboutCost(this.roundaboutSize);
        return `${this.roundaboutSize} 通圓環 · 約 $${cost.toLocaleString()}　點地圖放置；壓到的道路會自動接上圓環，車輛逆時針單向繞行`;
      }
      case 'bulldoze':
        return '點一條道路拆除，退還一半費用';
      case 'traffic': {
        const v = this.city.traffic.vehicles;
        const avg = v.length ? (v.reduce((sum, x) => sum + x.speed, 0) / v.length) * 3.6 : 0;
        return `車輛 ${v.length} 台 · 平均 ${Math.round(avg)} km/h · 已完成 ${this.city.traffic.tripsCompleted.toLocaleString()} 趟　綠 = 順暢、紅 = 塞車`;
      }
      case 'bus': {
        const n = this.lineDraft.length;
        if (n === 1) return `已設 1 站（每站 $${STOP_COST}）；沿著路線點下一站`;
        if (n > 1) return `已設 ${n} 站；點第一站或「完成路線」讓公車繞回起點`;
        const t = this.city.transit;
        const picked = this.selectedLine !== null ? t.lines.get(this.selectedLine) : undefined;
        if (picked) {
          return `${picked.id} 號線：公車 ${t.buses(picked.id).length} 台 · 全長 ${Math.round(picked.length).toLocaleString()} 公尺 · 累計載客 ${picked.riders.toLocaleString()} 人`;
        }
        if (!t.lines.size) return '公車：點地面道路設第一個站，依序點下一站，最後點回第一站完成路線';
        let riders = 0;
        let waiting = 0;
        for (const l of t.lines.values()) riders += l.riders;
        for (const st of t.stops.values()) waiting += t.waitingAt(st);
        return `公車 ${t.buses().length} 台 · 累計載客 ${riders.toLocaleString()} 人 · 候車 ${waiting.toLocaleString()} 人　點道路開始新路線；點下方路線可刪除`;
      }
    }
  }

  onHover(p: Vec2 | null): void {
    this.hover = p;
    this.refresh();
  }

  onTap(p: Vec2): void {
    this.hover = p;
    if (this.isRoadTool) this.tapRoad(p);
    else if (this.tool === 'bus') this.tapBus(p);
    else if (this.tool === 'roundabout') {
      const r = this.city.buildRoundabout(p, this.roundaboutSize);
      this.events.toast(r.ok ? `圓環完成，花費 $${r.cost.toLocaleString()}` : (r.reason ?? '這裡不能蓋圓環'));
    } else if (this.tool === 'bulldoze') {
      const r = this.city.bulldoze(p, Math.max(ROAD_WIDTH / 2, this.world.rig.snapRadius * 0.6));
      if (r.ok) this.events.toast(`道路已拆除，退還 $${r.refund.toLocaleString()}`);
      else if (r.reason) this.events.toast(r.reason);
    } else if (this.tool === 'zone') this.onPaint(p);
    this.events.changed();
    this.refresh();
  }

  onPaint(p: Vec2): void {
    this.hover = p;
    this.city.paint(p, this.brushRadius, this.zone);
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
    if (this.tool === 'curve' && !this.draft.control) {
      this.draft.control = { x: p.x, y: p.y };
      return;
    }
    const r = this.city.buildRoad(start, this.draft.control, s, false, this.level);
    if (!r.ok) {
      if (r.reason) this.events.toast(r.reason);
      return;
    }
    // Keep drawing from where this road ended
    const end = this.city.net.nodes.get(r.endNode!)!;
    this.draft = { start: { kind: 'node', node: end, p: end.p }, control: null };
  }

  private tapBus(p: Vec2): void {
    const transit = this.city.transit;
    const r = this.world.rig.snapRadius;
    const first = this.lineDraft[0];
    // Tapping the first stop again closes the loop
    if (this.lineDraft.length >= 2 && transit.stopNear(p, r)?.id === first) {
      this.finishLine();
      return;
    }
    const stop = transit.stopAt(p, r);
    if (!stop) {
      this.events.toast('公車站要設在地面道路旁（高架道路不能設站）');
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
    const markerHeight = hoverSnap ? this.city.net.snapHeight(hoverSnap, this.level) : this.draft.start ? this.city.net.snapHeight(this.draft.start, this.level) : 0;
    w.setCursor(marker, hoverSnap ? hoverSnap.kind !== 'free' || !!road?.guides.length : isRoad, isRoad ? markerHeight : 0);
    if (this.tool === 'bus') {
      const t = this.city.transit;
      const near = this.hover && (t.stopNear(this.hover, this.world.rig.snapRadius)?.p ?? t.locate(this.hover, this.world.rig.snapRadius)?.p);
      w.setCursor(near ?? null, true);
    }
    w.setDraftLine(this.tool === 'bus' ? this.draftPath : null, LINE_COLORS[(this.city.transit.nextLine - 1) % LINE_COLORS.length]);
    if (this.tool === 'roundabout') w.setBrush(this.hover, ROUNDABOUT_RADIUS[this.roundaboutSize], 0xffffff);
    else w.setBrush(this.tool === 'zone' ? this.hover : null, this.brushRadius, this.zone === Zone.None ? 0xffffff : ZONES[this.zone].color);
    const { start, control } = this.draft;
    if (isRoad && start && hoverSnap) {
      const ctrl = this.tool === 'curve' ? (control ?? lerp(start.p, hoverSnap.p, 0.5)) : null;
      const end = hoverSnap.p;
      const [ha, hb] = this.city.roadHeights(start, hoverSnap, this.level);
      const cost = this.city.roadCost(start.p, ctrl, end, ha, hb);
      const ok = cost <= this.city.money && !this.city.gradeProblem(start, ctrl, hoverSnap, this.level);
      w.setPreview({ a: start.p, c: ctrl ?? lerp(start.p, end, 0.5), b: end }, ok, ha, hb);
      w.setAngleGuides(angleGuides(this.city.net, start, ctrl, hoverSnap));
    } else {
      w.setPreview(null, true);
      w.setAngleGuides([]);
    }
  }
}

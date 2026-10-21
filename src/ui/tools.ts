import { angleGuides } from '../sim/angles';
import type { City } from '../sim/city';
import { type GuideLine, alignToGuides } from '../sim/guides';
import { type Vec2, lerp } from '../sim/geometry';
import { ROAD_WIDTH, type Snap } from '../sim/roads';
import { ZONES, Zone } from '../sim/zoning';
import type { World } from '../render/world';

export type Tool = 'pan' | 'road' | 'curve' | 'zone' | 'bulldoze' | 'traffic';

export const BRUSH_RADIUS = 18;

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
    this.world.setShowEmptyCells(tool === 'zone');
    this.world.setTrafficOverlay(tool === 'traffic');
    this.refresh();
  }

  setZone(zone: Zone): void {
    this.zone = zone;
    this.events.changed();
    this.refresh();
  }

  cancel(): void {
    this.draft = { start: null, control: null };
    this.events.changed();
    this.refresh();
  }

  get drawing(): boolean {
    return this.draft.start !== null;
  }

  /** Painting tools take one-finger drags; the others use drags to move the camera. */
  get paintsOnDrag(): boolean {
    return this.tool === 'zone';
  }

  private snap(p: Vec2): Snap {
    return this.city.net.snap(p, this.world.rig.snapRadius);
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
        if (this.draft.start && this.hover && (this.tool === 'road' || this.draft.control)) {
          const end = this.snapRoad(this.hover).snap;
          const len = Math.round(Math.hypot(end.p.x - this.draft.start.p.x, end.p.y - this.draft.start.p.y));
          const cost = this.city.roadCost(this.draft.start.p, this.draft.control, end.p);
          return `約 ${len} 公尺 · $${cost.toLocaleString()}　點一下完成，再點起點結束拉路`;
        }
        if (this.tool === 'curve') return this.draft.start ? '點一下決定彎曲的方向（控制點）' : '曲線道路：點起點 → 控制點 → 終點';
        return this.draft.start ? '點終點；交叉處會自動變成路口' : '直線道路：點起點，再點終點，可連續拉路';
      }
      case 'zone':
        return this.zone === Zone.None ? '在格子上塗抹以清除分區' : `塗抹道路旁的格子設為「${ZONES[this.zone].name}」；雙指移動地圖`;
      case 'bulldoze':
        return '點一條道路拆除，退還一半費用';
      case 'traffic': {
        const v = this.city.traffic.vehicles;
        const avg = v.length ? (v.reduce((sum, x) => sum + x.speed, 0) / v.length) * 3.6 : 0;
        return `車輛 ${v.length} 台 · 平均 ${Math.round(avg)} km/h · 已完成 ${this.city.traffic.tripsCompleted.toLocaleString()} 趟　綠 = 順暢、紅 = 塞車`;
      }
    }
  }

  onHover(p: Vec2 | null): void {
    this.hover = p;
    this.refresh();
  }

  onTap(p: Vec2): void {
    this.hover = p;
    if (this.tool === 'road' || this.tool === 'curve') this.tapRoad(p);
    else if (this.tool === 'bulldoze') {
      const r = this.city.bulldoze(p, Math.max(ROAD_WIDTH / 2, this.world.rig.snapRadius * 0.6));
      if (r.ok) this.events.toast(`道路已拆除，退還 $${r.refund.toLocaleString()}`);
      else if (r.reason) this.events.toast(r.reason);
    } else if (this.tool === 'zone') this.onPaint(p);
    this.events.changed();
    this.refresh();
  }

  onPaint(p: Vec2): void {
    this.hover = p;
    this.city.paint(p, BRUSH_RADIUS, this.zone);
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
    const r = this.city.buildRoad(start, this.draft.control, s);
    if (!r.ok) {
      if (r.reason) this.events.toast(r.reason);
      return;
    }
    // Keep drawing from where this road ended
    const end = this.city.net.nodes.get(r.endNode!)!;
    this.draft = { start: { kind: 'node', node: end, p: end.p }, control: null };
  }

  /** Pushes the current previews (ghost road, snap ring, brush) to the 3D view. */
  refresh(): void {
    const w = this.world;
    const isRoad = this.tool === 'road' || this.tool === 'curve';
    const road = this.hover && isRoad ? this.snapRoad(this.hover) : null;
    const hoverSnap = road?.snap ?? null;
    w.setGuideLines(road?.guides ?? []);
    // Without hover (touch), keep marking where the road being drawn starts
    const marker = hoverSnap?.p ?? (isRoad ? (this.draft.start?.p ?? null) : this.tool === 'bulldoze' ? this.hover : null);
    w.setCursor(marker, hoverSnap ? hoverSnap.kind !== 'free' || !!road?.guides.length : isRoad);
    w.setBrush(this.tool === 'zone' ? this.hover : null, BRUSH_RADIUS, this.zone === Zone.None ? 0xffffff : ZONES[this.zone].color);
    const { start, control } = this.draft;
    if (isRoad && start && hoverSnap) {
      const ctrl = this.tool === 'curve' ? (control ?? lerp(start.p, hoverSnap.p, 0.5)) : null;
      const end = hoverSnap.p;
      const cost = this.city.roadCost(start.p, ctrl, end);
      w.setPreview({ a: start.p, c: ctrl ?? lerp(start.p, end, 0.5), b: end }, cost <= this.city.money);
      w.setAngleGuides(angleGuides(this.city.net, start, ctrl, hoverSnap));
    } else {
      w.setPreview(null, true);
      w.setAngleGuides([]);
    }
  }
}

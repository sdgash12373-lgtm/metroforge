import { MAX_AIR_FARE } from '../sim/airport';
import { type City, MAX_TAX } from '../sim/city';
import { RAIL_KINDS } from '../sim/rail';
import { ZONES, Zone } from '../sim/zoning';
import { BUS, LINE_COLORS, MODES, type Transit } from '../sim/transit';
import { EditPanel } from './editPanel';
import { BRUSH_MAX, BRUSH_MIN, DISTRICT_MAX, DISTRICT_MIN, type Tool, type ToolController, isRail } from './tools';

/** Tools that share one dock button and are picked on a second row. */
type Group = 'roads' | 'transport' | 'names';
const GROUPS: Record<Group, { id: Tool; label: string }[]> = {
  roads: [
    { id: 'road', label: '直線' },
    { id: 'curve', label: '曲線' },
    { id: 'roundabout', label: '圓環' },
  ],
  transport: [
    { id: 'bus', label: '公車' },
    { id: 'metro', label: '捷運' },
    { id: 'train', label: '火車' },
    { id: 'hsr', label: '高鐵' },
    { id: 'airport', label: '機場' },
  ],
  names: [
    { id: 'streetName', label: '路名' },
    { id: 'district', label: '區域' },
  ],
};
const groupOf = (t: Tool): Group | null => (Object.keys(GROUPS) as Group[]).find((g) => GROUPS[g].some((r) => r.id === t)) ?? null;

type DockItem = Tool | Group;
const TOOLS: { id: DockItem; label: string; key: string }[] = [
  { id: 'pan', label: '瀏覽', key: '1' },
  { id: 'roads', label: '道路', key: '2' },
  { id: 'zone', label: '分區', key: '3' },
  { id: 'bulldoze', label: '拆除', key: '4' },
  { id: 'traffic', label: '交通', key: '5' },
  { id: 'transport', label: '運輸', key: '6' },
  { id: 'names', label: '命名', key: '7' },
];

export const SPEEDS = [0, 1, 3] as const;

type Option = (label: string, on: boolean, onClick: () => void, swatch?: number) => void;

export interface HudActions {
  setSpeed(i: number): void;
  /** returns the new state */
  toggleBuildMode(): boolean;
  /** opens the in-game menu: save, load, settings, back to the start screen */
  openMenu(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** DOM overlay: city stats, demand bars, the tool dock and the hint line. */
export class Hud {
  private stats: Record<'pop' | 'jobs' | 'money' | 'day', HTMLElement>;
  private bars: Record<'R' | 'C' | 'O' | 'I', HTMLElement>;
  private hint: HTMLElement;
  private sub: HTMLElement;
  private toastEl: HTMLElement;
  private toolButtons = new Map<DockItem, HTMLButtonElement>();
  /** second row under 道路 (straight, curved, roundabout) and 運輸 (bus, metro, train, high-speed, airport) */
  private kinds: HTMLElement;
  /** tool each grouped dock button returns to */
  private lastTool: Record<Group, Tool> = { roads: 'road', transport: 'bus', names: 'streetName' };
  private speedButtons: HTMLButtonElement[] = [];
  private toastTimer = 0;
  private warning: HTMLElement;
  private budgetPanel: HTMLElement;
  private budgetRows: Record<'res' | 'biz' | 'fares' | 'air' | 'roads' | 'transit' | 'airUpkeep' | 'net', HTMLElement>;
  private taxInputs: { res: HTMLInputElement; biz: HTMLInputElement; resLabel: HTMLElement; bizLabel: HTMLElement };
  private city: City | null = null;
  private topBar: HTMLElement;
  lockButton: HTMLButtonElement;
  private clearArmed = 0;
  private fareInputs: { input: HTMLInputElement; label: HTMLElement; get(city: City): number }[] = [];
  private editPanel = new EditPanel();
  private budgetBtn!: HTMLButtonElement;
  private bottomBar!: HTMLElement;
  /** line whose editor was last opened, so picking another line can close the budget on phones */
  private editKey: string | null = null;
  speed = 1;

  constructor(
    root: HTMLElement,
    private tools: ToolController,
    actions: HudActions,
  ) {
    const top = el('header', 'hud panel');
    this.topBar = top;
    top.append(el('div', 'brand', '天際線'));
    const stat = (label: string) => {
      const box = el('div', 'stat');
      const v = el('b');
      box.append(el('span', '', label), v);
      top.append(box);
      return v;
    };
    this.stats = { pop: stat('人口'), jobs: stat('工作'), money: stat('資金'), day: stat('第') };
    const rci = el('div', 'rci');
    rci.title = '需求：住宅 / 商業 / 辦公 / 工業';
    const bar = (k: string, color: string) => {
      const wrap = el('div');
      const fill = el('i');
      fill.style.background = color;
      wrap.append(fill, el('em', '', k));
      rci.append(wrap);
      return fill;
    };
    this.bars = { R: bar('R', '#5fb565'), C: bar('C', '#4f8fd6'), O: bar('O', '#8a6fd1'), I: bar('I', '#d9a33a') };
    top.append(rci);

    const speeds = el('div', 'speeds');
    ['暫停', '▶', '▶▶'].forEach((label, i) => {
      const b = el('button', 'chip', label);
      b.type = 'button';
      b.setAttribute('aria-label', ['暫停', '正常速度', '快轉'][i]);
      b.onclick = () => actions.setSpeed(i);
      speeds.append(b);
      this.speedButtons.push(b);
    });
    top.append(speeds);

    const lock = el('button', 'chip', '建造模式');
    lock.type = 'button';
    lock.title = '鎖住視角的旋轉與傾斜，拉路時不會被手勢轉動（仍可移動、縮放）';
    lock.onclick = () => {
      const on = actions.toggleBuildMode();
      lock.setAttribute('aria-pressed', String(on));
      this.toast(on ? '建造模式：視角已鎖定，只能移動與縮放' : '已解除視角鎖定');
    };
    this.lockButton = lock;
    top.append(lock);

    const budgetBtn = el('button', 'chip', '預算');
    budgetBtn.type = 'button';
    budgetBtn.onclick = () => this.showBudget(this.budgetPanel.hidden);
    this.budgetBtn = budgetBtn;
    top.append(budgetBtn);

    const menu = el('button', 'chip', '選單');
    menu.type = 'button';
    menu.onclick = () => actions.openMenu();
    top.append(menu);

    this.warning = el('div', 'warning panel');
    this.warning.hidden = true;

    // Budget: last day's income and spending, and the two tax sliders
    this.budgetPanel = el('section', 'budget panel');
    this.budgetPanel.hidden = true;
    this.budgetPanel.append(el('h2', '', '每日收支'));
    const row = (label: string) => {
      const r = el('div', 'brow');
      const v = el('b');
      r.append(el('span', '', label), v);
      this.budgetPanel.append(r);
      return v;
    };
    this.budgetRows = {
      res: row('住宅稅'),
      biz: row('商業稅'),
      fares: row('運輸票價'),
      air: row('機場收入'),
      roads: row('道路維護'),
      transit: row('運輸營運'),
      airUpkeep: row('機場營運'),
      net: row('每日淨額'),
    };
    this.budgetRows.net.parentElement!.classList.add('total');
    const slider = (id: string, label: string, onInput: (v: number) => void, max = MAX_TAX, step = 1) => {
      const wrap = el('label', 'tax');
      wrap.htmlFor = id;
      const value = el('b');
      const input = el('input');
      input.id = id;
      input.type = 'range';
      input.min = '0';
      input.max = String(max);
      input.step = String(step);
      input.oninput = () => onInput(Number(input.value));
      const head = el('div', 'brow');
      head.append(el('span', '', label), value);
      wrap.append(head, input);
      this.budgetPanel.append(wrap);
      return { input, value };
    };
    const res = slider('tax-res', '住宅稅率', (v) => this.city && (this.city.taxes.residential = v));
    const biz = slider('tax-biz', '商業稅率', (v) => this.city && (this.city.taxes.business = v));
    this.taxInputs = { res: res.input, biz: biz.input, resLabel: res.value, bizLabel: biz.value };
    this.budgetPanel.append(el('p', 'note', '稅率越高收入越多，但需求會下降；預設 9%。'));
    // One fare per kind of transport
    const fares: { id: string; label: string; max: number; step: number; transit: (c: City) => { fare: number } }[] = [
      { id: 'bus', label: '公車票價', max: BUS.maxFare, step: 1, transit: (c) => c.transit },
      ...RAIL_KINDS.map((k) => ({ id: k, label: `${MODES[k].label}票價`, max: MODES[k].maxFare, step: 1, transit: (c: City) => c.rails[k].transit })),
      { id: 'air', label: '機票', max: MAX_AIR_FARE, step: 5, transit: (c) => c.aviation },
    ];
    for (const f of fares) {
      const s = slider(`fare-${f.id}`, f.label, (v) => this.city && (f.transit(this.city).fare = v), f.max, f.step);
      this.fareInputs.push({ input: s.input, label: s.value, get: (c) => f.transit(c).fare });
    }
    this.budgetPanel.append(el('p', 'note', '票價越高收入越多，但搭乘的人會變少。'));

    this.toastEl = el('div', 'toast panel');
    this.toastEl.setAttribute('role', 'status');

    const bottom = el('div', 'bottom');
    this.hint = el('div', 'hint panel');
    this.sub = el('div', 'dock sub panel');
    this.kinds = el('div', 'dock sub panel');
    for (const k of Object.values(GROUPS).flat()) {
      const b = el('button', 'tool');
      b.type = 'button';
      b.dataset.tool = k.id;
      b.dataset.group = groupOf(k.id)!;
      b.append(el('span', '', k.label));
      b.onclick = () => this.selectTool(k.id);
      this.kinds.append(b);
    }
    const dock = el('nav', 'dock panel');
    for (const t of TOOLS) {
      const b = el('button', 'tool');
      b.type = 'button';
      b.append(el('span', '', t.label), el('kbd', '', t.key));
      b.onclick = () => this.selectTool(this.toolFor(t.id));
      dock.append(b);
      this.toolButtons.set(t.id, b);
    }
    bottom.append(this.hint, this.sub, this.kinds, dock);
    this.bottomBar = bottom;
    root.append(top, this.warning, this.budgetPanel, this.editPanel.el, this.toastEl, bottom);

    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest?.('input, textarea') || document.body.classList.contains('menu-open')) return;
      if (e.key === 'Escape' && !this.tools.drawing && !this.tools.lineDraft.length) {
        actions.openMenu();
        return;
      }
      const t = TOOLS.find((x) => x.key === e.key);
      if (t) this.selectTool(this.toolFor(t.id));
      if (e.key === ' ') {
        e.preventDefault();
        actions.setSpeed(this.speed === 0 ? 1 : 0);
      }
    });
  }

  private toolFor(item: DockItem): Tool {
    return item === 'roads' || item === 'transport' || item === 'names' ? this.lastTool[item] : item;
  }

  selectTool(t: Tool): void {
    const g = groupOf(t);
    if (g) this.lastTool[g] = t;
    this.tools.setTool(t);
    this.render();
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 2200);
  }

  /** Tool dock, sub-options and speed state. */
  render(): void {
    const tool = this.tools.tool;
    const group = groupOf(tool);
    for (const [id, b] of this.toolButtons) b.setAttribute('aria-pressed', String(id === group || id === tool));
    this.kinds.hidden = !group;
    for (const b of this.kinds.querySelectorAll<HTMLButtonElement>('button')) {
      b.hidden = b.dataset.group !== group;
      b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    }
    this.speedButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === this.speed)));
    this.sub.replaceChildren();
    const option: Option = (label, on, onClick, swatch) => {
      const b = el('button', 'tool');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(on));
      if (swatch !== undefined) {
        const s = el('span', 'swatch');
        s.style.background = `#${swatch.toString(16).padStart(6, '0')}`;
        b.append(s);
      }
      b.append(el('span', '', label));
      b.onclick = onClick;
      this.sub.append(b);
    };
    if (this.tools.tool === 'zone') {
      const zones = [Zone.ResidentialLow, Zone.ResidentialHigh, Zone.Commercial, Zone.Office, Zone.Industrial] as const;
      for (const z of zones) {
        option(ZONES[z].name, this.tools.zone === z, () => {
          this.tools.setZone(z);
          this.render();
        }, ZONES[z].color);
      }
      option('清除分區', this.tools.zone === Zone.None, () => {
        this.tools.setZone(Zone.None);
        this.render();
      });
      // Brush size: the dock is rebuilt on every render, so the slider is too
      const size = el('label', 'brush-size');
      size.htmlFor = 'brush-size';
      const value = el('b', '', `${this.tools.brushRadius * 2} m`);
      const range = el('input');
      range.id = 'brush-size';
      range.type = 'range';
      range.min = String(BRUSH_MIN);
      range.max = String(BRUSH_MAX);
      range.step = '2';
      range.value = String(this.tools.brushRadius);
      range.setAttribute('aria-label', '塗抹範圍');
      range.oninput = () => {
        this.tools.setBrushRadius(Number(range.value));
        value.textContent = `${this.tools.brushRadius * 2} m`;
      };
      size.append(el('span', '', '範圍'), range, value);
      this.sub.append(size);
    } else if (this.tools.tool === 'road' || this.tools.tool === 'curve') {
      this.levelOptions(option, '結束拉路');
    } else if (this.tools.tool === 'roundabout') {
      option('4 通', this.tools.roundaboutSize === 4, () => this.tools.setRoundaboutSize(4));
      option('6 通', this.tools.roundaboutSize === 6, () => this.tools.setRoundaboutSize(6));
    } else if (this.tools.tool === 'bus') {
      this.renderLineDock(option);
    } else if (isRail(this.tools.tool)) {
      const t = this.tools;
      option('軌道', t.railAction === 'track', () => t.setRailAction('track'));
      option('車站路線', t.railAction === 'line', () => t.setRailAction('line'));
      this.sub.append(el('span', 'divider'));
      if (t.railAction === 'track') {
        option('直線', !t.trackCurve, () => t.setTrackCurve(false));
        option('曲線', t.trackCurve, () => t.setTrackCurve(true));
        this.levelOptions(option, '結束拉軌');
      } else this.renderLineDock(option);
    } else if (this.tools.tool === 'airport') {
      this.renderAirportDock(option);
    } else if (this.tools.tool === 'district') {
      const t = this.tools;
      const size = el('label', 'brush-size');
      size.htmlFor = 'district-size';
      const value = el('b', '', `${t.districtRadius * 2} m`);
      const range = el('input');
      range.id = 'district-size';
      range.type = 'range';
      range.min = String(DISTRICT_MIN);
      range.max = String(DISTRICT_MAX);
      range.step = '10';
      range.value = String(t.districtRadius);
      range.setAttribute('aria-label', '區域範圍');
      range.oninput = () => {
        t.setDistrictRadius(Number(range.value));
        value.textContent = `${t.districtRadius * 2} m`;
      };
      size.append(el('span', '', '範圍'), range, value);
      this.sub.append(size);
      if (t.selectedDistrict !== null) option('新增區域', false, () => t.selectDistrict(null));
    }
    this.sub.hidden = this.sub.childElementCount === 0;
    // Show the editor for a new selection straight away, not on the next frame
    if (this.city) this.updateEditor(this.city);
    this.updateHint();
  }

  /** 地面 / 高架 / 地下, and a button to stop drawing. */
  private levelOptions(option: Option, stop: string): void {
    const t = this.tools;
    option('地面', t.level === 'ground', () => t.setRoadLevel('ground'));
    option('高架', t.level === 'elevated', () => t.setRoadLevel('elevated'));
    option('地下', t.level === 'tunnel', () => t.setRoadLevel('tunnel'));
    if (t.drawing) {
      option(stop, false, () => {
        t.cancel();
        this.render();
      });
    }
  }

  private renderAirportDock(option: Option): void {
    const t = this.tools;
    option('雙跑道', t.runways === 2, () => t.setRunways(2));
    option('四跑道', t.runways === 4, () => t.setRunways(4));
    option(`旋轉 ${t.airportAngle}°`, false, () => t.turnAirport());
    const air = this.city?.aviation;
    if (!air?.airports.size) return;
    this.sub.append(el('span', 'divider'));
    for (const f of air.flights.values()) {
      option(f.name, t.selectedFlight === f.id, () => t.selectFlight(t.selectedFlight === f.id ? null : f.id), f.color);
    }
    option('＋ 新增航班', false, () => t.addFlight());
  }

  private renderLineDock(option: Option): void {
    const t = this.tools;
    const transit = t.transit;
    if (!transit) return;
    if (t.lineDraft.length) {
      option(`完成路線（${t.lineDraft.length} 站）`, false, () => t.finishLine(), LINE_COLORS[(transit.nextLine - 1) % LINE_COLORS.length]);
      option('取消', false, () => t.cancel());
      return;
    }
    // Removing lines: the controls come first so they are in reach on a phone
    if (t.removingLines) {
      option('完成拆除', true, () => t.setRemovingLines(false));
      const picked = t.selectedLine !== null ? transit.lines.get(t.selectedLine) : undefined;
      if (picked) option(`確定拆除「${picked.name}」`, false, () => t.removeSelectedLine(), picked.color);
      this.sub.append(el('span', 'divider'));
    }
    for (const line of transit.lines.values()) {
      const label = `${line.name} · ${line.stops.length} 站${line.ok ? '' : ' · 中斷'}`;
      option(label, t.selectedLine === line.id, () => t.selectLine(t.selectedLine === line.id ? null : line.id), line.color);
    }
    if (transit.lines.size && !t.removingLines) {
      this.sub.append(el('span', 'divider'));
      option('拆除路線', false, () => t.setRemovingLines(true));
    }
    if (transit.lines.size) {
      // Two taps, like 新城市, so a stray tap can't wipe every line
      option(this.clearArmed ? '確定清除全部？' : '清除全部路線', false, () => {
        if (!this.clearArmed) {
          this.clearArmed = window.setTimeout(() => {
            this.clearArmed = 0;
            this.render();
          }, 3000);
          this.render();
          return;
        }
        clearTimeout(this.clearArmed);
        this.clearArmed = 0;
        t.clearLines();
      });
    }
  }

  /** Name and colour editor for the line or flight picked in the dock. */
  private updateEditor(city: City): void {
    const t = this.tools;
    const transit = t.transit;
    // While removing lines the dock asks to confirm instead, and the map stays clear to tap
    const line = transit && t.selectedLine !== null && !t.removingLines ? transit.lines.get(t.selectedLine) : undefined;
    const flight = t.tool === 'airport' && t.selectedFlight !== null ? city.aviation.flights.get(t.selectedFlight) : undefined;
    const street = t.tool === 'streetName' && t.selectedStreet !== null ? city.net.segments.get(t.selectedStreet) : undefined;
    const district = t.tool === 'district' && t.selectedDistrict !== null ? city.districts.get(t.selectedDistrict) : undefined;
    const key = line
      ? `${transit!.mode.kind}:${line.id}`
      : flight
        ? `flight:${flight.id}`
        : street
          ? `street:${city.net.street(street).map((x) => x.id).sort((a, b) => a - b)[0]}`
          : district
            ? `district:${district.id}`
            : null;
    // Phones only have room for one panel: picking a line closes the budget, opening the budget hides the editor
    const narrow = window.innerWidth < 720;
    if (key !== this.editKey) {
      this.editKey = key;
      if (key && narrow) this.showBudget(false);
    }
    if (!key || (narrow && !this.budgetPanel.hidden)) {
      this.editPanel.hide();
      return;
    }
    if (line && transit) this.editLine(transit, line.id, key);
    else if (street) {
      const pieces = city.net.street(street);
      const length = pieces.reduce((n, x) => n + x.length, 0);
      this.editPanel.show(key, {
        title: '路名',
        name: street.name ?? '',
        placeholder: '例如：中山路',
        info: `全長 ${Math.round(length).toLocaleString()} 公尺 · ${pieces.length} 段`,
        rename: (name) => {
          city.nameStreet(street.id, name);
          this.render();
        },
      });
    } else if (district) {
      this.editPanel.show(key, {
        title: '區域',
        name: district.name,
        color: district.color,
        colorLabel: '名稱顏色',
        info: `範圍直徑 ${Math.round(district.r * 2).toLocaleString()} 公尺`,
        rename: (name) => {
          city.editDistrict(district.id, { name });
          this.render();
        },
        recolor: (color) => {
          city.editDistrict(district.id, { color });
          this.render();
        },
        remove: { label: '刪除這個區域', run: () => t.deleteDistrict(district.id) },
      });
    }
    else if (flight) {
      const air = city.aviation;
      const where = { away: '飛行中', approach: '進場中', rollout: '降落', 'taxi-in': '滑行', boarding: '登機中', 'taxi-out': '滑行', takeoff: '起飛', climb: '爬升' }[flight.state];
      this.editPanel.show(key, {
        title: '航班',
        name: flight.name,
        color: flight.color,
        colorLabel: '機身顏色',
        info: `${where} · 跑道 ${flight.runway + 1} · 累計載客 ${flight.passengers.toLocaleString()} 人`,
        rename: (name) => {
          air.editFlight(flight.id, { name });
          this.render();
        },
        recolor: (color) => {
          air.editFlight(flight.id, { color });
          this.render();
        },
        remove: { label: '取消這個航班', run: () => t.deleteFlight(flight.id) },
      });
    }
  }

  private editLine(transit: Transit, id: number, key: string): void {
    const line = transit.lines.get(id)!;
    const t = this.tools;
    const { mode } = transit;
    const unit = mode.streetsOnly ? '台' : '列';
    this.editPanel.show(key, {
      title: `${mode.label}路線`,
      name: line.name,
      color: line.color,
      info: `${line.stops.length} 站 · ${mode.label} ${transit.buses(line.id).length} ${unit} · 全長 ${Math.round(line.length).toLocaleString()} 公尺 · 累計載客 ${line.riders.toLocaleString()} 人`,
      rename: (name) => {
        transit.editLine(id, { name });
        this.render();
      },
      recolor: (color) => {
        transit.editLine(id, { color });
        this.render();
      },
      remove: { label: '刪除這條路線', run: () => t.deleteLine(id) },
    });
  }

  private showBudget(on: boolean): void {
    this.budgetPanel.hidden = !on;
    this.budgetBtn.setAttribute('aria-pressed', String(on));
  }

  updateHint(): void {
    this.hint.textContent = this.tools.hint();
  }

  update(city: City): void {
    this.city = city;
    const b = city.budget;
    const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString()}`;
    if (!this.budgetPanel.hidden) {
      this.budgetRows.res.textContent = money(b.residentialTax);
      this.budgetRows.biz.textContent = money(b.businessTax);
      this.budgetRows.fares.textContent = money(b.transitFares);
      this.budgetRows.air.textContent = money(b.airIncome);
      this.budgetRows.roads.textContent = money(-b.roadUpkeep);
      this.budgetRows.transit.textContent = money(-b.transitUpkeep);
      this.budgetRows.airUpkeep.textContent = money(-b.airUpkeep);
      const net = b.residentialTax + b.businessTax + b.transitFares + b.airIncome - b.roadUpkeep - b.transitUpkeep - b.airUpkeep;
      this.budgetRows.net.textContent = money(net);
      this.budgetRows.net.classList.toggle('neg', net < 0);
      for (const [input, label, v] of [
        [this.taxInputs.res, this.taxInputs.resLabel, city.taxes.residential],
        [this.taxInputs.biz, this.taxInputs.bizLabel, city.taxes.business],
      ] as const) {
        if (document.activeElement !== input) input.value = String(v);
        label.textContent = `${v}%`;
      }
      for (const f of this.fareInputs) {
        const v = f.get(city);
        if (document.activeElement !== f.input) f.input.value = String(v);
        f.label.textContent = `$${v}`;
      }
    }
    this.updateEditor(city);
    // The top bar wraps to more rows on narrow screens; keep the panels just below it
    const below = `${this.topBar.offsetTop + this.topBar.offsetHeight + 8}px`;
    const lost = city.stats.disconnected;
    this.warning.hidden = lost === 0;
    if (lost) this.warning.textContent = `${lost} 格分區沒有道路連到高速公路，不會發展`;
    const shift = `calc(${below} + ${this.warning.hidden ? 0 : this.warning.offsetHeight + 8}px)`;
    this.warning.style.top = below;
    this.budgetPanel.style.top = shift;
    this.editPanel.el.style.top = this.budgetPanel.hidden ? shift : `calc(${shift} + ${this.budgetPanel.offsetHeight + 8}px)`;
    this.toastEl.style.top = shift;
    // On phones the toast would sit on the editor's title: show it just below the editor
    if (window.innerWidth < 720 && !this.editPanel.el.hidden) {
      const r = this.editPanel.el.getBoundingClientRect();
      this.toastEl.style.top = `${r.bottom + 8}px`;
    }
    // Never let a panel run under the dock
    let floor = window.innerHeight;
    for (const c of this.bottomBar.children) {
      const r = c.getBoundingClientRect();
      if (r.height) floor = Math.min(floor, r.top);
    }
    floor -= 8;
    for (const p of [this.budgetPanel, this.editPanel.el]) {
      if (!p.hidden) p.style.maxHeight = `${Math.max(120, floor - p.getBoundingClientRect().top)}px`;
    }
    this.stats.pop.textContent = city.stats.population.toLocaleString();
    this.stats.jobs.textContent = city.stats.jobs.toLocaleString();
    this.stats.money.textContent = `$${Math.floor(city.money).toLocaleString()}`;
    this.stats.money.classList.toggle('neg', city.money < 0);
    this.stats.day.textContent = `${city.day.toLocaleString()} 天`;
    for (const k of ['R', 'C', 'O', 'I'] as const) this.bars[k].style.height = `${city.demand[k]}%`;
  }
}

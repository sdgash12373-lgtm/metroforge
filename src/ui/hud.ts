import { MAX_AIR_FARE } from '../sim/airport';
import logoUrl from '../assets/logo.png';
import { gameDate, ntd } from '../sim/format';
import { type City, MAX_TAX, budgetTotals } from '../sim/city';
import { LEVELS, ntdShort } from '../sim/levels';
import { FACILITIES, GREEN_KINDS, LANDMARK_KINDS, SERVICE_KINDS } from '../sim/facilities';
import { RAIL_KINDS } from '../sim/rail';
import { INCOME_BRACKETS } from '../sim/income';
import type { Conditions } from '../sim/weather';
import { ZONES, Zone } from '../sim/zoning';
import { BUS, LINE_COLORS, MODES, type Transit } from '../sim/transit';
import { EditPanel } from './editPanel';
import { BRUSH_MAX, BRUSH_MIN, DISTRICT_MAX, DISTRICT_MIN, type Tool, type ToolController, STYLE_CHOICES, isRail } from './tools';

/** Tools that share one dock button and are picked on a second row. */
type Group = 'roads' | 'transport' | 'build' | 'names';
const GROUPS: Record<Group, { id: Tool; label: string }[]> = {
  roads: [
    { id: 'road', label: '直線' },
    { id: 'curve', label: '曲線' },
    { id: 'roundabout', label: '圓環' },
    { id: 'upgradeRoad', label: '升級' },
  ],
  transport: [
    { id: 'bus', label: '公車' },
    { id: 'metro', label: '捷運' },
    { id: 'train', label: '火車' },
    { id: 'hsr', label: '高鐵' },
    { id: 'airport', label: '機場' },
  ],
  build: [
    ...SERVICE_KINDS.map((k) => ({ id: k as Tool, label: FACILITIES[k].label })),
    { id: 'landmark', label: '地標' },
    { id: 'greenery', label: '綠化' },
    { id: 'footbridge', label: '天橋' },
  ],
  names: [
    { id: 'streetName', label: '路名' },
    { id: 'district', label: '區域' },
  ],
};
const groupOf = (t: Tool): Group | null => (Object.keys(GROUPS) as Group[]).find((g) => GROUPS[g].some((r) => r.id === t)) ?? null;

type DockItem = Tool | Group;
type BudgetRow =
  | 'res' | 'biz' | 'fuel' | 'subsidy' | 'fares' | 'air' | 'tourism' | 'income'
  | 'roads' | 'transit' | 'airUpkeep' | 'services' | 'admin' | 'running' | 'construction' | 'net';
const TOOLS: { id: DockItem; label: string; key: string }[] = [
  { id: 'pan', label: '瀏覽', key: '1' },
  { id: 'roads', label: '道路', key: '2' },
  { id: 'zone', label: '分區', key: '3' },
  { id: 'transport', label: '運輸', key: '4' },
  { id: 'build', label: '建設', key: '5' },
  { id: 'traffic', label: '交通', key: '6' },
  { id: 'names', label: '命名', key: '7' },
];
/** 拆除 has its own button beside the map, and this key */
const DEMOLISH_KEY = 'x';

export const SPEEDS = [0, 1, 3] as const;

type Option = (label: string, on: boolean, onClick: () => void, swatch?: number) => void;

export interface HudActions {
  setSpeed(i: number): void;
  /** returns the new state */
  toggleBuildMode(): boolean;
  /** opens the in-game menu: save, load, settings, back to the start screen */
  openMenu(): void;
  /** first-person patrol: drive a car through the city */
  drive(): void;
  /** moves the view to a spot on the map */
  lookAt(p: { x: number; y: number }): void;
  /** turns the view so north is up */
  faceNorth(): void;
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
  private compass: HTMLButtonElement;
  private dial: HTMLElement;
  private heading = NaN;
  private sub: HTMLElement;
  private toastEl: HTMLElement;
  private toolButtons = new Map<DockItem, HTMLButtonElement>();
  private demolishBtn: HTMLButtonElement;
  private beforeDemolish: Tool = 'pan';
  private side: HTMLElement;
  /** second row under 道路 (straight, curved, roundabout) and 運輸 (bus, metro, train, high-speed, airport) */
  private kinds: HTMLElement;
  /** tool each grouped dock button returns to */
  private lastTool: Record<Group, Tool> = { roads: 'road', transport: 'bus', build: 'park', names: 'streetName' };
  private speedButtons: HTMLButtonElement[] = [];
  private toastTimer = 0;
  private warning: HTMLElement;
  private budgetPanel: HTMLElement;
  private budgetRows: Record<BudgetRow, HTMLElement>;
  private taxInputs: { res: HTMLInputElement; biz: HTMLInputElement; resLabel: HTMLElement; bizLabel: HTMLElement };
  private city: City | null = null;
  /** the cut-off zoning the warning last showed */
  private lastWarnSpot: { x: number; y: number } | null = null;
  private topBar: HTMLElement;
  lockButton: HTMLButtonElement;
  private clearArmed = 0;
  private fareInputs: { input: HTMLInputElement; label: HTMLElement; get(city: City): number }[] = [];
  private editPanel = new EditPanel();
  private budgetBtn!: HTMLButtonElement;
  private needsBtn!: HTMLButtonElement;
  private needsPanel: HTMLElement;
  private needsBody: HTMLElement;
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
    const brand = el('div', 'brand');
    const logo = el('img');
    logo.src = logoUrl;
    logo.alt = '';
    brand.append(logo, el('span', 'wide-only', 'Metroforge'));
    top.append(brand);
    const stat = (label: string) => {
      const box = el('div', 'stat');
      const v = el('b');
      box.append(el('span', '', label), v);
      top.append(box);
      return v;
    };
    this.stats = { pop: stat('人口'), jobs: stat('工作'), money: stat('資金'), day: stat('') };
    this.stats.day.parentElement!.classList.add('clock');
    this.weatherEl = el('div', 'stat weather');
    top.append(this.weatherEl);
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
    ['❚❚', '▶', '▶▶'].forEach((label, i) => {
      const b = el('button', 'chip', label);
      b.type = 'button';
      b.setAttribute('aria-label', ['暫停', '正常速度', '快轉'][i]);
      b.onclick = () => actions.setSpeed(i);
      speeds.append(b);
      this.speedButtons.push(b);
    });
    top.append(speeds);

    const levelBtn = el('button', 'chip level-chip', LEVELS[0].name);
    levelBtn.type = 'button';
    levelBtn.title = '城市等級';
    levelBtn.onclick = () => this.showLevel(this.levelPanel.hidden);
    this.levelBtn = levelBtn;
    top.append(levelBtn);

    const budgetBtn = el('button', 'chip', '預算');
    budgetBtn.type = 'button';
    budgetBtn.onclick = () => this.showBudget(this.budgetPanel.hidden);
    this.budgetBtn = budgetBtn;
    top.append(budgetBtn);

    const needsBtn = el('button', 'chip', '需求');
    needsBtn.type = 'button';
    needsBtn.onclick = () => this.showNeeds(this.needsPanel.hidden);
    this.needsBtn = needsBtn;
    top.append(needsBtn);

    const menu = el('button', 'chip menu-chip');
    menu.append(el('span', '', '☰'), el('span', 'wide-only', ' 選單'));
    menu.setAttribute('aria-label', '選單');
    menu.type = 'button';
    menu.onclick = () => actions.openMenu();
    top.append(menu);

    // Ticker across the top bar for update notices
    this.tickerEl = el('div', 'ticker');
    this.tickerEl.hidden = true;
    this.tickerEl.setAttribute('role', 'status');
    this.tickerText = el('span');
    const lane = el('div', 'lane');
    lane.append(this.tickerText);
    this.tickerAction = el('button', 'chip');
    this.tickerAction.type = 'button';
    const close = el('button', 'close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '關閉通知');
    close.onclick = () => this.endTicker();
    this.tickerEl.append(lane, this.tickerAction, close);
    top.append(this.tickerEl);

    this.warning = el('button', 'warning panel');
    (this.warning as HTMLButtonElement).type = 'button';
    this.warning.hidden = true;
    this.warning.onclick = () => {
      const city = this.city;
      if (!city) return;
      // Each tap visits the next cut-off area, starting from the nearest
      const spots = city.disconnectedLots(this.lastWarnSpot ?? { x: 0, y: 0 });
      const next = spots.find((p) => !this.lastWarnSpot || Math.hypot(p.x - this.lastWarnSpot.x, p.y - this.lastWarnSpot.y) > 150) ?? spots[0];
      if (!next) return;
      this.lastWarnSpot = next;
      actions.lookAt(next);
    };

    // Budget: last day's income and spending, and the two tax sliders
    this.budgetPanel = el('section', 'budget panel');
    this.budgetPanel.hidden = true;
    this.budgetPanel.append(el('h2', '', '每月財政'));
    const row = (label: string, cls = '') => {
      const r = el('div', `brow ${cls}`);
      const v = el('b');
      r.append(el('span', '', label), v);
      this.budgetPanel.append(r);
      return v;
    };
    const group = (label: string) => this.budgetPanel.append(el('h3', 'bgroup', label));
    group('收入');
    const income = {
      res: row('住宅稅'),
      biz: row('商業稅'),
      fuel: row('汽燃稅（開車居民）'),
      subsidy: row('中央補助'),
      fares: row('運輸票價（規費）'),
      air: row('機場規費'),
      tourism: row('觀光收入（其他）'),
      income: row('每月收入', 'sub'),
    };
    group('支出');
    this.budgetRows = {
      ...income,
      roads: row('道路維護（每兩週繳）'),
      transit: row('運輸營運（每兩週繳）'),
      airUpkeep: row('機場營運'),
      services: row('公共服務（每兩週繳）'),
      admin: row('行政人事'),
      running: row('營運支出', 'sub'),
      construction: row('建設支出（近 3 日平均）'),
      net: row('每月結餘', 'total'),
    };
    this.budgetPanel.append(el('p', 'note', '每月結餘 = 每月收入 − 營運支出 − 建設支出。收入隨人口、工作、稅率、搭乘人數與觀光客變動。'));
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

    this.levelPanel = el('section', 'budget level panel');
    this.levelPanel.hidden = true;

    // Residents' needs: happiness, how much of the city each service reaches, what people ask for
    this.needsPanel = el('section', 'budget needs panel');
    this.needsPanel.hidden = true;
    this.needsPanel.append(el('h2', '', '居民需求'));
    this.needsBody = el('div');
    this.needsPanel.append(this.needsBody, el('p', 'note', '在「建設」蓋公園、學校、警察局、消防局和醫院，讓更多居民被服務範圍涵蓋；滿意度越高，住宅需求越高、升級越快。'));

    this.toastEl = el('div', 'toast panel');
    this.toastEl.setAttribute('role', 'status');

    const bottom = el('div', 'bottom');
    this.hint = el('div', 'hint panel');
    this.sub = el('div', 'dock sub panel');
    this.kinds = el('div', 'dock sub kinds panel');
    for (const k of Object.values(GROUPS).flat()) {
      const b = el('button', 'tool');
      b.type = 'button';
      b.dataset.tool = k.id;
      b.dataset.group = groupOf(k.id)!;
      b.append(el('span', '', k.label));
      b.onclick = () => this.selectTool(k.id);
      this.kinds.append(b);
    }
    const dock = el('nav', 'dock main panel');
    for (const t of TOOLS) {
      const b = el('button', 'tool');
      b.type = 'button';
      b.append(el('span', '', t.label), el('kbd', '', t.key));
      b.onclick = () => this.selectTool(this.toolFor(t.id));
      dock.append(b);
      this.toolButtons.set(t.id, b);
    }
    // Beside the map on the right: 拆除, the view lock, driving and the compass
    const side = el('div', 'side');
    const sideButton = (icon: string, label: string, title: string, onClick: () => void, cls = '') => {
      const b = el('button', `side-btn panel ${cls}`);
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-label', label);
      b.append(el('i', '', icon), el('span', '', label));
      b.onclick = onClick;
      side.append(b);
      return b;
    };
    this.demolishBtn = sideButton('🗑', '拆除', `拆除道路、軌道、路線、建設和房子（${DEMOLISH_KEY.toUpperCase()}）`, () => this.toggleDemolish(), 'danger');
    this.lockButton = sideButton('🔒', '鎖視角', '鎖住視角的旋轉與傾斜，拉路時不會被手勢轉動（仍可移動、縮放）', () => {
      const on = actions.toggleBuildMode();
      this.lockButton.setAttribute('aria-pressed', String(on));
      this.toast(on ? '視角已鎖定，只能移動與縮放' : '已解除視角鎖定');
    });
    sideButton('🚗', '巡查', '第一人稱開車巡查城市（電腦 WASD、手機虛擬搖桿）', () => actions.drive());
    this.compass = el('button', 'compass panel');
    this.compass.type = 'button';
    this.compass.title = '方位：點一下讓北方朝上';
    this.compass.setAttribute('aria-label', '方位圖，點一下讓北方朝上');
    this.dial = el('span', 'dial');
    for (const [label, cls] of [['北', 'n'], ['東', 'e'], ['南', 's'], ['西', 'w']] as const) this.dial.append(el('span', `mark ${cls}`, label));
    this.dial.append(el('span', 'needle'));
    this.compass.append(this.dial);
    this.compass.onclick = () => actions.faceNorth();
    side.append(this.compass);
    this.side = side;
    bottom.append(this.hint, this.sub, this.kinds, dock);
    this.bottomBar = bottom;
    root.append(top, this.warning, this.budgetPanel, this.needsPanel, this.levelPanel, this.editPanel.el, this.toastEl, side, bottom);

    addEventListener('keydown', (e) => {
      const body = document.body.classList;
      if ((e.target as HTMLElement).closest?.('input, textarea') || body.contains('menu-open') || body.contains('driving')) return;
      if (e.key === 'Escape' && !this.tools.drawing && !this.tools.lineDraft.length) {
        actions.openMenu();
        return;
      }
      const t = TOOLS.find((x) => x.key === e.key);
      if (t) this.selectTool(this.toolFor(t.id));
      if (e.key.toLowerCase() === DEMOLISH_KEY || e.key === 'Delete') this.toggleDemolish();
      if (e.key === ' ') {
        e.preventDefault();
        actions.setSpeed(this.speed === 0 ? 1 : 0);
      }
    });
  }

  private toolFor(item: DockItem): Tool {
    return item in GROUPS ? this.lastTool[item as Group] : (item as Tool);
  }

  /** 拆除 on, or back to the tool used before it. */
  private toggleDemolish(): void {
    if (this.tools.tool === 'bulldoze') this.selectTool(this.beforeDemolish);
    else {
      this.beforeDemolish = this.tools.tool;
      this.selectTool('bulldoze');
    }
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
    this.demolishBtn.setAttribute('aria-pressed', String(tool === 'bulldoze'));
    // While a road or track is being drawn only its own options stay, so the dock doesn't cover the map
    document.body.classList.toggle('road-drawing', this.tools.drawing);
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
      option('更正', this.tools.overwriteZones, () => {
        this.tools.setOverwriteZones(!this.tools.overwriteZones);
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
    } else if (this.tools.tool === 'upgradeRoad') {
      const t = this.tools;
      const open = this.city?.unlocked('roadUpgrade') ?? false;
      for (const [c, label] of STYLE_CHOICES) {
        option(open ? label : `🔒 ${label}`, t.roadStyle === c, () => {
          t.setRoadStyle(c);
          this.render();
        });
      }
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
    } else if (this.tools.tool === 'bulldoze') {
      const t = this.tools;
      option('道路與建築', !t.demolishLines, () => t.setDemolishLines(false));
      option('大眾運輸路線', t.demolishLines, () => t.setDemolishLines(true));
      const d = t.doomed;
      if (d) option(`確定拆除「${d.line.name}」`, false, () => t.removeDoomedLine(), d.line.color);
    } else if (this.tools.tool === 'landmark') {
      const t = this.tools;
      const built = new Set([...(this.city?.facilities.values() ?? [])].map((f) => f.kind));
      for (const k of LANDMARK_KINDS) {
        const unlock = FACILITIES[k].unlock;
        const lock = unlock && !this.city?.unlocked(unlock) ? '🔒 ' : '';
        option(`${lock}${FACILITIES[k].label}${built.has(k) ? ' · 已興建' : ''}`, t.landmark === k, () => {
          t.setLandmark(k);
          this.render();
        }, FACILITIES[k].color);
      }
    } else if (this.tools.tool === 'greenery') {
      const t = this.tools;
      const lock = this.city?.unlocked('greenery') ? '' : '🔒 ';
      for (const k of GREEN_KINDS) {
        option(`${lock}${FACILITIES[k].label}`, t.green === k, () => {
          t.setGreen(k);
          this.render();
        }, FACILITIES[k].color);
      }
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
    for (const line of transit.lines.values()) {
      const label = `${line.name} · ${line.stops.length} 站${line.ok ? '' : ' · 中斷'}`;
      option(label, t.selectedLine === line.id, () => t.selectLine(t.selectedLine === line.id ? null : line.id), line.color);
    }
    if (transit.lines.size) {
      this.sub.append(el('span', 'divider'));
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
    const line = transit && t.selectedLine !== null ? transit.lines.get(t.selectedLine) : undefined;
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
      if (key && narrow) {
        this.showBudget(false);
        this.showNeeds(false);
        this.showLevel(false);
      }
    }
    if (!key || (narrow && (!this.budgetPanel.hidden || !this.needsPanel.hidden || !this.levelPanel.hidden))) {
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
    if (on) {
      this.showNeeds(false);
      this.showLevel(false);
    }
  }

  private showNeeds(on: boolean): void {
    this.needsPanel.hidden = !on;
    this.needsBtn.setAttribute('aria-pressed', String(on));
    if (on) {
      this.showBudget(false);
      this.showLevel(false);
    }
    if (on && this.city) this.renderNeeds(this.city);
  }

  private showLevel(on: boolean): void {
    this.levelPanel.hidden = !on;
    this.levelBtn.setAttribute('aria-pressed', String(on));
    if (on) {
      this.showBudget(false);
      this.showNeeds(false);
      this.levelShown = '';
      if (this.city) this.renderLevel(this.city);
    }
  }

  private levelBtn!: HTMLButtonElement;
  private levelPanel!: HTMLElement;
  private levelShown = '';
  /** rank the "ready to move up" notice was last shown for */
  private readyTold = -1;

  /** 城市等級: this rank, the bars for the next one and a button to move up. */
  private renderLevel(city: City): void {
    const next = city.nextLevel();
    const key = JSON.stringify([city.level, next?.checks.map((c) => [c.ok, Math.round(c.have / 1000)])]);
    if (key === this.levelShown) return;
    this.levelShown = key;
    const body: HTMLElement[] = [el('h2', '', `城市等級：${LEVELS[city.level].name}`)];
    const fmt = (label: string, v: number) => (label === '人口' ? `${Math.round(v).toLocaleString()} 人` : `NT$${ntdShort(v)}`);
    if (next) {
      body.push(el('h3', 'bgroup', `升級成「${next.level.name}」的條件`));
      for (const c of next.checks) {
        const row = el('div', `brow check${c.ok ? ' ok' : ''}`);
        row.append(el('span', '', `${c.ok ? '✓' : '○'} ${c.label}`), el('b', '', `${fmt(c.label, c.have)} / ${fmt(c.label, c.need)}`));
        body.push(row);
      }
      const up = el('button', `menu-btn${next.ready ? ' primary' : ''}`, next.ready ? `升級成${next.level.name}` : '尚未達到升級條件');
      up.type = 'button';
      up.disabled = !next.ready;
      up.onclick = () => {
        if (!city.upgrade()) return;
        const opened = LEVELS[city.level].unlocks;
        this.ticker(`🎉 恭喜！${city.name}升級為「${LEVELS[city.level].name}」${opened.length ? `，開放：${opened.join('、')}` : ''}`, { loops: 2 });
        this.levelShown = '';
        this.render();
      };
      body.push(up);
      if (next.level.unlocks.length) body.push(el('p', 'note', `升級後開放：${next.level.unlocks.join('、')}`));
    } else body.push(el('p', 'note', '已經是最高等級「直轄市」！'));
    const ladder = el('div', 'ladder');
    LEVELS.forEach((l, i) => {
      const row = el('div', `brow${i === city.level ? ' current' : ''}`);
      row.append(el('span', '', `${i === city.level ? '▶ ' : ''}${l.name}`), el('b', '', i ? `${l.population.toLocaleString()} 人 · 收入 ${ntdShort(l.income)} · 結餘 +${ntdShort(l.balance)}` : '起點'));
      ladder.append(row);
    });
    body.push(el('h3', 'bgroup', '等級一覽（每月）'), ladder);
    this.levelPanel.replaceChildren(...body);
  }

  private tickerEl: HTMLElement;
  private tickerText: HTMLElement;
  private tickerAction: HTMLButtonElement;
  private tickerDone: (() => void) | null = null;

  /**
   * Scrolls `text` across the top bar `loops` times (0 = until closed), then calls `done`.
   * `action` adds a button next to it, such as 重新整理.
   */
  ticker(text: string, opts: { loops?: number; action?: { label: string; run: () => void }; done?: () => void } = {}): void {
    this.endTicker();
    this.tickerText.textContent = text;
    this.tickerAction.hidden = !opts.action;
    if (opts.action) {
      this.tickerAction.textContent = opts.action.label;
      this.tickerAction.onclick = opts.action.run;
    }
    this.tickerDone = opts.done ?? null;
    this.tickerEl.hidden = false;
    // Same speed whatever the length: about 110 px a second
    const lane = this.tickerText.parentElement!;
    const span = lane.clientWidth + this.tickerText.scrollWidth;
    this.tickerText.style.animation = 'none';
    void this.tickerText.offsetWidth;
    this.tickerText.style.animation = `ticker ${Math.max(8, span / 110)}s linear ${opts.loops || 'infinite'}`;
    this.tickerText.onanimationend = () => this.endTicker();
  }

  private endTicker(): void {
    if (this.tickerEl.hidden) return;
    this.tickerEl.hidden = true;
    this.tickerText.style.animation = 'none';
    const done = this.tickerDone;
    this.tickerDone = null;
    done?.();
  }

  private weatherEl: HTMLElement;
  private weatherShown = '';

  /** Weather where the camera looks, next to the clock. */
  setWeather(w: Conditions): void {
    const text = `${w.icon} ${w.label} ${w.temp}°C`;
    if (text + w.region === this.weatherShown) return;
    this.weatherShown = text + w.region;
    this.weatherEl.textContent = text;
    this.weatherEl.title = `${w.region}：${w.label}，氣溫 ${w.temp}°C`;
  }

  private needsShown = '';
  private renderNeeds(city: City): void {
    const n = city.needs;
    const homes = city.households;
    const key = JSON.stringify([
      Math.round(n.happiness),
      n.wants,
      n.tourists,
      SERVICE_KINDS.map((k) => Math.round(n.coverage[k] * 100)),
      Math.round(homes.averageIncome / 1000),
      INCOME_BRACKETS.map((b) => homes.people[b.key]),
    ]);
    if (key === this.needsShown) return;
    this.needsShown = key;
    const rows: HTMLElement[] = [];
    const meter = (label: string, pct: number, color: string, text = `${Math.round(pct)}%`) => {
      const r = el('div', 'meter');
      const track = el('div', 'track');
      const fill = el('i');
      fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      fill.style.background = color;
      track.append(fill);
      r.append(el('span', '', label), track, el('b', '', text));
      rows.push(r);
    };
    const mood = n.happiness >= 70 ? '😊' : n.happiness >= 45 ? '😐' : '😟';
    meter('滿意度', n.happiness, n.happiness >= 70 ? '#5fb565' : n.happiness >= 45 ? '#e3b23c' : '#e4572e', `${mood} ${Math.round(n.happiness)}`);
    for (const k of SERVICE_KINDS) meter(FACILITIES[k].label, n.coverage[k] * 100, `#${FACILITIES[k].color.toString(16).padStart(6, '0')}`);
    rows.push(el('h3', '', '居民心聲'));
    if (!city.stats.population) rows.push(el('p', 'note', '還沒有居民。'));
    else if (!n.wants.length) rows.push(el('p', 'note', '居民對公共服務很滿意！'));
    for (const k of n.wants) rows.push(el('p', 'want', `「${FACILITIES[k].need}」 → 蓋${FACILITIES[k].label}`));
    if (n.tourists) rows.push(el('p', 'note', `每小時觀光客 ${n.tourists.toLocaleString()} 人`));
    // Income decides how residents get to work
    if (city.stats.population) {
      rows.push(el('h3', '', `居民收入：平均年收 NT$${ntdShort(homes.averageIncome)}`));
      const ride = { bike: '🚲', scooter: '🛵', car: '🚗' } as const;
      const colors = { bike: '#6a994e', scooter: '#e3b23c', car: '#2e86ab', rich: '#8a6fd1' } as const;
      for (const b of INCOME_BRACKETS) {
        const share = (homes.people[b.key] / city.stats.population) * 100;
        meter(`${ride[b.commute]} ${b.label.replace('年收 ', '').replace(/ /g, '')}`, share, colors[b.key]);
        rows[rows.length - 1].classList.add('wide');
      }
      rows.push(el('p', 'note', '🚲 腳踏車不佔馬路，🛵 機車和 🚗 汽車會上路。開車的居民要繳汽燃稅：年收 40–60 萬 3%、60 萬以上 7%。房子等級越高、公共服務越完整、城市等級越高，收入越高。'));
    }
    this.needsBody.replaceChildren(...rows);
  }

  updateHint(): void {
    this.hint.textContent = this.tools.hint();
  }

  /** `dayFraction`: how far through the current day the clock is, 0..1. */
  /**
   * Turns the compass with the camera. `yaw` is the camera's heading around the target: north (-y on
   * the map) shows that many radians clockwise from the top of the screen.
   */
  setHeading(yaw: number): void {
    if (Math.abs(yaw - this.heading) < 0.002) return;
    this.heading = yaw;
    this.dial.style.setProperty('--turn', `${yaw}rad`);
  }

  update(city: City, dayFraction = 0): void {
    this.city = city;
    const b = city.budget;
    const money = (v: number) => (Math.abs(v) >= 1e6 ? `NT$${ntdShort(v)}` : ntd(v));
    if (!this.budgetPanel.hidden) {
      const t = budgetTotals(b);
      const values: Record<BudgetRow, number> = {
        res: b.residentialTax,
        biz: b.businessTax,
        fuel: b.fuelTax,
        subsidy: b.subsidy,
        fares: b.transitFares,
        air: b.airIncome,
        tourism: b.tourism,
        income: t.income,
        roads: -b.roadUpkeep,
        transit: -b.transitUpkeep,
        airUpkeep: -b.airUpkeep,
        services: -b.servicesUpkeep,
        admin: -b.admin,
        running: -t.running,
        construction: -b.construction,
        net: t.balance,
      };
      for (const k of Object.keys(values) as BudgetRow[]) {
        this.budgetRows[k].textContent = money(values[k]);
        this.budgetRows[k].classList.toggle('neg', values[k] < 0 && (k === 'net' || k === 'income'));
      }
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
        f.label.textContent = `NT$${v}`;
      }
    }
    this.updateEditor(city);
    // The top bar wraps to more rows on narrow screens; keep the panels just below it
    const below = `${this.topBar.offsetTop + this.topBar.offsetHeight + 8}px`;
    const lost = city.stats.disconnected;
    this.warning.hidden = lost === 0;
    if (lost) this.warning.textContent = `⚠️ ${lost} 格分區沒有道路連到高速公路，不會發展。紅色是沒接上的道路，點這裡前往`;
    const shift = `calc(${below} + ${this.warning.hidden ? 0 : this.warning.offsetHeight + 8}px)`;
    this.warning.style.top = below;
    this.budgetPanel.style.top = shift;
    this.needsPanel.style.top = shift;
    this.levelPanel.style.top = shift;
    if (!this.needsPanel.hidden) this.renderNeeds(city);
    if (!this.levelPanel.hidden) this.renderLevel(city);
    // The rank chip: its name, and a glow when the city can move up
    const ready = !!city.nextLevel()?.ready;
    this.levelBtn.textContent = `${LEVELS[city.level].name}${ready ? ' ⬆' : ''}`;
    this.levelBtn.classList.toggle('ready', ready);
    if (ready && this.readyTold !== city.level) {
      this.readyTold = city.level;
      this.toast(`可以升級成「${LEVELS[city.level + 1].name}」了！點上方的等級按鈕`);
    }
    const open = [this.budgetPanel, this.needsPanel, this.levelPanel].find((p) => !p.hidden) ?? null;
    this.editPanel.el.style.top = open ? `calc(${shift} + ${open.offsetHeight + 8}px)` : shift;
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
    // The side buttons sit just above the dock, and step aside on phones while a panel is open
    this.side.style.bottom = `${window.innerHeight - floor}px`;
    this.side.classList.toggle('covered', window.innerWidth < 720 && !!(open || !this.editPanel.el.hidden));
    for (const p of [this.budgetPanel, this.needsPanel, this.levelPanel, this.editPanel.el]) {
      if (!p.hidden) p.style.maxHeight = `${Math.max(120, floor - p.getBoundingClientRect().top)}px`;
    }
    this.stats.pop.textContent = city.stats.population.toLocaleString();
    this.stats.jobs.textContent = city.stats.jobs.toLocaleString();
    this.stats.money.textContent = `${ntd(Math.floor(city.money))}`;
    this.stats.money.classList.toggle('neg', city.money < 0);
    this.stats.day.textContent = gameDate(city.day + dayFraction);
    for (const k of ['R', 'C', 'O', 'I'] as const) this.bars[k].style.height = `${city.demand[k]}%`;
  }
}

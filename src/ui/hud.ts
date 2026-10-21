import { type City, MAX_TAX } from '../sim/city';
import { ZONES, Zone } from '../sim/zoning';
import { LINE_COLORS, MAX_FARE } from '../sim/transit';
import { EditPanel } from './editPanel';
import { BRUSH_MAX, BRUSH_MIN, type Tool, type ToolController } from './tools';

/** The road tools share one dock button and are picked on a second row. */
const ROAD_TOOLS: { id: Tool; label: string }[] = [
  { id: 'road', label: '直線' },
  { id: 'curve', label: '曲線' },
  { id: 'roundabout', label: '圓環' },
];
const isRoadTool = (t: Tool) => ROAD_TOOLS.some((r) => r.id === t);

type DockItem = Tool | 'roads';
const TOOLS: { id: DockItem; label: string; key: string }[] = [
  { id: 'pan', label: '瀏覽', key: '1' },
  { id: 'roads', label: '道路', key: '2' },
  { id: 'zone', label: '分區', key: '3' },
  { id: 'bulldoze', label: '拆除', key: '4' },
  { id: 'traffic', label: '交通', key: '5' },
  { id: 'bus', label: '公車', key: '6' },
];

export const SPEEDS = [0, 1, 3] as const;

export interface HudActions {
  setSpeed(i: number): void;
  /** returns the new state */
  toggleBuildMode(): boolean;
  newCity(): void;
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
  /** second row under 道路: straight, curved, roundabout */
  private kinds: HTMLElement;
  /** road tool the 道路 button returns to */
  private lastRoadTool: Tool = 'road';
  private speedButtons: HTMLButtonElement[] = [];
  private toastTimer = 0;
  private warning: HTMLElement;
  private budgetPanel: HTMLElement;
  private budgetRows: Record<'res' | 'biz' | 'fares' | 'roads' | 'buses' | 'net', HTMLElement>;
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

    const reset = el('button', 'chip ghost', '新城市');
    reset.type = 'button';
    let armed = 0;
    reset.onclick = () => {
      if (!armed) {
        reset.textContent = '確定重來？';
        armed = window.setTimeout(() => {
          armed = 0;
          reset.textContent = '新城市';
        }, 3000);
        return;
      }
      clearTimeout(armed);
      armed = 0;
      reset.textContent = '新城市';
      actions.newCity();
    };
    top.append(reset);

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
      fares: row('公車票價'),
      roads: row('道路維護'),
      buses: row('公車營運'),
      net: row('每日淨額'),
    };
    this.budgetRows.net.parentElement!.classList.add('total');
    const slider = (id: string, label: string, onInput: (v: number) => void, max = MAX_TAX) => {
      const wrap = el('label', 'tax');
      wrap.htmlFor = id;
      const value = el('b');
      const input = el('input');
      input.id = id;
      input.type = 'range';
      input.min = '0';
      input.max = String(max);
      input.step = '1';
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
    const fare = slider('fare-bus', '公車票價', (v) => this.city && (this.city.transit.fare = v), MAX_FARE);
    this.fareInputs.push({ input: fare.input, label: fare.value, get: (c) => c.transit.fare });
    this.budgetPanel.append(el('p', 'note', '票價越高收入越多，但搭車的人會變少；預設 $1。'));

    this.toastEl = el('div', 'toast panel');
    this.toastEl.setAttribute('role', 'status');

    const bottom = el('div', 'bottom');
    this.hint = el('div', 'hint panel');
    this.sub = el('div', 'dock sub panel');
    this.kinds = el('div', 'dock sub panel');
    for (const k of ROAD_TOOLS) {
      const b = el('button', 'tool');
      b.type = 'button';
      b.dataset.tool = k.id;
      b.append(el('span', '', k.label));
      b.onclick = () => this.selectTool(k.id);
      this.kinds.append(b);
    }
    const dock = el('nav', 'dock panel');
    for (const t of TOOLS) {
      const b = el('button', 'tool');
      b.type = 'button';
      b.append(el('span', '', t.label), el('kbd', '', t.key));
      b.onclick = () => this.selectTool(t.id === 'roads' ? this.lastRoadTool : t.id);
      dock.append(b);
      this.toolButtons.set(t.id, b);
    }
    bottom.append(this.hint, this.sub, this.kinds, dock);
    this.bottomBar = bottom;
    root.append(top, this.warning, this.budgetPanel, this.editPanel.el, this.toastEl, bottom);

    addEventListener('keydown', (e) => {
      const t = TOOLS.find((x) => x.key === e.key);
      if (t) this.selectTool(t.id === 'roads' ? this.lastRoadTool : t.id);
      if (e.key === ' ') {
        e.preventDefault();
        actions.setSpeed(this.speed === 0 ? 1 : 0);
      }
    });
  }

  selectTool(t: Tool): void {
    if (isRoadTool(t)) this.lastRoadTool = t;
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
    for (const [id, b] of this.toolButtons) b.setAttribute('aria-pressed', String(id === 'roads' ? isRoadTool(tool) : id === tool));
    this.kinds.hidden = !isRoadTool(tool);
    for (const b of this.kinds.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    this.speedButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === this.speed)));
    this.sub.replaceChildren();
    const option = (label: string, on: boolean, onClick: () => void, swatch?: number) => {
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
      option('地面', this.tools.roadLevel === 'ground', () => this.tools.setRoadLevel('ground'));
      option('高架', this.tools.roadLevel === 'elevated', () => this.tools.setRoadLevel('elevated'));
      option('地下', this.tools.roadLevel === 'tunnel', () => this.tools.setRoadLevel('tunnel'));
      if (this.tools.drawing) {
        option('結束拉路', false, () => {
          this.tools.cancel();
          this.render();
        });
      }
    } else if (this.tools.tool === 'roundabout') {
      option('4 通', this.tools.roundaboutSize === 4, () => this.tools.setRoundaboutSize(4));
      option('6 通', this.tools.roundaboutSize === 6, () => this.tools.setRoundaboutSize(6));
    } else if (this.tools.tool === 'bus') {
      this.renderBusDock(option);
    }
    this.sub.hidden = this.sub.childElementCount === 0;
    this.updateHint();
  }

  private renderBusDock(option: (label: string, on: boolean, onClick: () => void, swatch?: number) => void): void {
    const t = this.tools;
    const city = this.city;
    if (t.lineDraft.length) {
      option(`完成路線（${t.lineDraft.length} 站）`, false, () => t.finishLine(), LINE_COLORS[((city?.transit.nextLine ?? 1) - 1) % LINE_COLORS.length]);
      option('取消', false, () => t.cancel());
      return;
    }
    if (!city) return;
    for (const line of city.transit.lines.values()) {
      const label = `${line.name} · ${line.stops.length} 站${line.ok ? '' : ' · 中斷'}`;
      option(label, t.selectedLine === line.id, () => t.selectLine(t.selectedLine === line.id ? null : line.id), line.color);
    }
    if (city.transit.lines.size) {
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

  /** Name and colour editor for the line picked in the dock. */
  private updateEditor(city: City): void {
    const t = this.tools;
    const line = t.tool === 'bus' && t.selectedLine !== null ? city.transit.lines.get(t.selectedLine) : undefined;
    const key = line ? `bus:${line.id}` : null;
    // Phones only have room for one panel: picking a line closes the budget, opening the budget hides the editor
    const narrow = window.innerWidth < 720;
    if (key !== this.editKey) {
      this.editKey = key;
      if (key && narrow) this.showBudget(false);
    }
    if (!line || (narrow && !this.budgetPanel.hidden)) {
      this.editPanel.hide();
      return;
    }
    const buses = city.transit.buses(line.id).length;
    this.editPanel.show(key!, {
      title: '公車路線',
      name: line.name,
      color: line.color,
      info: `${line.stops.length} 站 · 公車 ${buses} 台 · 全長 ${Math.round(line.length).toLocaleString()} 公尺 · 累計載客 ${line.riders.toLocaleString()} 人`,
      rename: (name) => {
        city.transit.editLine(line.id, { name });
        this.render();
      },
      recolor: (color) => {
        city.transit.editLine(line.id, { color });
        this.render();
      },
      remove: { label: '刪除這條路線', run: () => t.deleteLine(line.id) },
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
      this.budgetRows.fares.textContent = money(b.busFares);
      this.budgetRows.roads.textContent = money(-b.roadUpkeep);
      this.budgetRows.buses.textContent = money(-b.busUpkeep);
      const net = b.residentialTax + b.businessTax + b.busFares - b.roadUpkeep - b.busUpkeep;
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

import type { City } from '../sim/city';
import { ZONES, Zone } from '../sim/zoning';
import type { Tool, ToolController } from './tools';

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'pan', label: '瀏覽', key: '1' },
  { id: 'road', label: '直線道路', key: '2' },
  { id: 'curve', label: '曲線道路', key: '3' },
  { id: 'zone', label: '分區', key: '4' },
  { id: 'bulldoze', label: '拆除', key: '5' },
];

export const SPEEDS = [0, 1, 3] as const;

export interface HudActions {
  setSpeed(i: number): void;
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
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private speedButtons: HTMLButtonElement[] = [];
  private toastTimer = 0;
  speed = 1;

  constructor(
    root: HTMLElement,
    private tools: ToolController,
    actions: HudActions,
  ) {
    const top = el('header', 'hud panel');
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

    this.toastEl = el('div', 'toast panel');
    this.toastEl.setAttribute('role', 'status');

    const bottom = el('div', 'bottom');
    this.hint = el('div', 'hint panel');
    this.sub = el('div', 'dock sub panel');
    const dock = el('nav', 'dock panel');
    for (const t of TOOLS) {
      const b = el('button', 'tool');
      b.type = 'button';
      b.append(el('span', '', t.label), el('kbd', '', t.key));
      b.onclick = () => this.selectTool(t.id);
      dock.append(b);
      this.toolButtons.set(t.id, b);
    }
    bottom.append(this.hint, this.sub, dock);
    root.append(top, this.toastEl, bottom);

    addEventListener('keydown', (e) => {
      const t = TOOLS.find((x) => x.key === e.key);
      if (t) this.selectTool(t.id);
      if (e.key === ' ') {
        e.preventDefault();
        actions.setSpeed(this.speed === 0 ? 1 : 0);
      }
    });
  }

  selectTool(t: Tool): void {
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
    for (const [id, b] of this.toolButtons) b.setAttribute('aria-pressed', String(id === this.tools.tool));
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
    } else if (this.tools.drawing) {
      option('結束拉路', false, () => {
        this.tools.cancel();
        this.render();
      });
    }
    this.sub.hidden = this.sub.childElementCount === 0;
    this.updateHint();
  }

  updateHint(): void {
    this.hint.textContent = this.tools.hint();
  }

  update(city: City): void {
    this.stats.pop.textContent = city.stats.population.toLocaleString();
    this.stats.jobs.textContent = city.stats.jobs.toLocaleString();
    this.stats.money.textContent = `$${Math.floor(city.money).toLocaleString()}`;
    this.stats.money.classList.toggle('neg', city.money < 0);
    this.stats.day.textContent = `${city.day.toLocaleString()} 天`;
    for (const k of ['R', 'C', 'O', 'I'] as const) this.bars[k].style.height = `${city.demand[k]}%`;
  }
}

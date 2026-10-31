import type { City } from '../sim/city';
import { QUALITY_CHOICES, type Quality } from '../render/graphics';
import logoUrl from '../assets/logo.png';
import { CHANGELOG } from '../changelog';
import { seenLatest } from './updates';
import { gameDate, ntd } from '../sim/format';
import type { RegionName, TerrainName } from '../sim/terrain';
import { AUTO_SLOT, type SaveSlots, type SlotInfo, slotLabel } from '../storage/saves';

export interface Settings {
  shadows: boolean;
  /** 畫質: 自動 keeps the frame rate up by itself */
  quality: Quality;
  /** frames per second shown in the corner */
  showFps: boolean;
  /** seconds between auto-saves; 0 = off */
  autosave: number;
}

export const AUTOSAVE_CHOICES: [number, string][] = [
  [0, '關閉'],
  [30, '30 秒'],
  [60, '1 分鐘'],
  [300, '5 分鐘'],
];

export interface MenuActions {
  /** a city was loaded or made: play it */
  play(city: City, slot: string | null): void;
  /** a new city on this land, starting in this region */
  newCity(name: string, terrain: TerrainName, region: RegionName): City;
  /** saves the city being played into a slot, with a picture of the view */
  saveTo(slot: string): Promise<void>;
  /** leaves the game for the start screen (after an auto-save) */
  quit(): Promise<void>;
  settings(): Settings;
  setSettings(s: Settings): void;
  toast(msg: string): void;
  /** plays the 新手導引 tour over the game */
  tutorial(): void;
}

type View = 'home' | 'pause' | 'new' | 'load' | 'save' | 'settings';

/** Where a new city starts: the land, and the region opened first (the other opens at 縣轄市). */
const START_CHOICES: { id: string; terrain: TerrainName; region: RegionName; title: string; desc: string }[] = [
  { id: 'kaohsiung', terrain: 'kaohsiung', region: 'kaohsiung', title: '高雄', desc: '海岸、平原、河流與東北高山；屏東區之後可開通' },
  { id: 'pingtung', terrain: 'kaohsiung', region: 'pingtung', title: '屏東', desc: '屏東平原、大武山、東港與小琉球；高雄區之後可開通' },
  { id: 'flat', terrain: 'plain', region: 'kaohsiung', title: '平地', desc: '大片平原，北邊高山、河川流向大海，西南臨海' },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function button(label: string, cls: string, run: () => void): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.onclick = run;
  return b;
}


function when(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The start screen (continue, new game, load, settings) and the in-game menu (save, load, quit),
 * drawn over the map. While it is open the game is paused and the HUD hidden.
 */
export class Menu {
  readonly root = el('div', 'menu');
  private card = el('section', 'menu-card panel');
  private view: View = 'home';
  /** in a game (the pause menu) or at the start screen */
  inGame = false;
  /** a second tap confirms overwriting or deleting this slot */
  private armed: string | null = null;
  private armTimer = 0;

  constructor(
    host: HTMLElement,
    private slots: SaveSlots,
    private actions: MenuActions,
  ) {
    this.root.append(this.card);
    this.root.hidden = true;
    host.append(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(view: View = this.inGame ? 'pause' : 'home'): void {
    this.view = view;
    this.armed = null;
    this.root.hidden = false;
    document.body.classList.add('menu-open');
    void this.render();
  }

  close(): void {
    this.root.hidden = true;
    document.body.classList.remove('menu-open');
  }

  private back(): void {
    this.show(this.inGame ? 'pause' : 'home');
  }

  /** Two taps for anything that throws a save away. */
  private confirm(key: string, b: HTMLButtonElement, ask: string, run: () => void): void {
    if (this.armed !== key) {
      this.armed = key;
      b.textContent = ask;
      b.classList.add('danger');
      clearTimeout(this.armTimer);
      this.armTimer = window.setTimeout(() => {
        this.armed = null;
        void this.render();
      }, 3000);
      return;
    }
    clearTimeout(this.armTimer);
    this.armed = null;
    run();
  }

  async render(): Promise<void> {
    const view = this.view;
    const body: HTMLElement[] = [];
    if (view === 'home') body.push(...(await this.home()));
    else if (view === 'pause') body.push(...this.pause());
    else if (view === 'new') body.push(...this.newGame());
    else if (view === 'load' || view === 'save') body.push(...(await this.slotList(view)));
    else body.push(...this.settings());
    // A newer render may have started while this one waited on storage
    if (view !== this.view) return;
    this.card.replaceChildren(...body);
    this.card.dataset.view = view;
  }

  private async home(): Promise<HTMLElement[]> {
    const latest = await this.slots.latest();
    const title = el('div', 'menu-title');
    const logo = el('img', 'menu-logo');
    logo.src = logoUrl;
    logo.alt = 'Metroforge 商標';
    title.append(logo, el('h1', '', 'Metroforge'), el('p', '', '都市創造'));
    const list = el('div', 'menu-buttons');
    if (latest) {
      const cont = button('', 'menu-btn primary', () => void this.loadSlot(latest.id));
      cont.append(el('b', '', '繼續遊戲'), el('small', '', `${latest.name} · 人口 ${latest.population.toLocaleString()} · ${when(latest.savedAt)}`));
      list.append(cont);
    }
    list.append(
      button('新遊戲', `menu-btn${latest ? '' : ' primary'}`, () => this.show('new')),
      button('讀取存檔', 'menu-btn', () => this.show('load')),
      button('設定', 'menu-btn', () => this.show('settings')),
    );
    return [title, list, this.news()];
  }

  /** 更新內容: the latest release open, older ones folded away. */
  private news(): HTMLElement {
    const box = el('section', 'menu-news');
    const head = el('h2', '', '更新內容');
    if (!seenLatest()) head.append(el('span', 'badge', '新'));
    box.append(head);
    CHANGELOG.slice(0, 3).forEach((r, i) => {
      const d = el('details');
      d.open = i === 0;
      const sum = el('summary');
      sum.append(el('b', '', `v${r.version} ${r.title}`), el('small', '', r.date));
      const ul = el('ul');
      for (const n of r.notes) ul.append(el('li', '', n));
      d.append(sum, ul);
      box.append(d);
    });
    return box;
  }

  private pause(): HTMLElement[] {
    const list = el('div', 'menu-buttons');
    list.append(
      button('繼續遊戲', 'menu-btn primary', () => this.close()),
      button('存檔', 'menu-btn', () => this.show('save')),
      button('讀取存檔', 'menu-btn', () => this.show('load')),
      button('設定', 'menu-btn', () => this.show('settings')),
      button('新手導引', 'menu-btn', () => {
        this.close();
        this.actions.tutorial();
      }),
      button('回到開始畫面', 'menu-btn', async () => {
        await this.actions.quit();
        this.inGame = false;
        this.show('home');
      }),
    );
    return [el('h2', '', '選單'), list];
  }

  private newGame(): HTMLElement[] {
    let start = START_CHOICES[0];
    const name = el('input', 'menu-input');
    name.type = 'text';
    name.value = '我的城市';
    name.maxLength = 24;
    name.setAttribute('aria-label', '城市名稱');
    const label = el('label', 'menu-field');
    label.append(el('span', '', '城市名稱'), name);
    const choices = el('div', 'menu-choices');
    const pick = (c: (typeof START_CHOICES)[number]) => {
      start = c;
      for (const b of choices.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.t === c.id));
    };
    for (const c of START_CHOICES) {
      const b = button('', 'menu-choice', () => pick(c));
      b.dataset.t = c.id;
      b.append(el('b', '', c.title), el('small', '', c.desc));
      choices.append(b);
    }
    pick(start);
    const terrainField = el('div', 'menu-field');
    terrainField.append(el('span', '', '地形'), choices);
    const row = el('div', 'menu-row');
    row.append(
      button('返回', 'menu-btn', () => this.back()),
      button('開始', 'menu-btn primary', () => {
        const city = this.actions.newCity(name.value.trim().slice(0, 24) || '我的城市', start.terrain, start.region);
        this.inGame = true;
        this.close();
        this.actions.play(city, null);
        this.actions.tutorial();
      }),
    );
    return [el('h2', '', '新遊戲'), label, terrainField, row];
  }

  private async loadSlot(id: string): Promise<void> {
    try {
      const city = await this.slots.load(id);
      this.inGame = true;
      this.close();
      this.actions.play(city, id);
      this.actions.toast(`已讀取「${city.name}」`);
    } catch (err) {
      console.warn('Could not load the save', err);
      this.actions.toast('這個存檔讀取失敗');
    }
  }

  private async slotList(mode: 'load' | 'save'): Promise<HTMLElement[]> {
    const all = await this.slots.list();
    const list = el('div', 'slots');
    for (const { id, info } of all) {
      // The auto slot is written by the game, not saved into by hand
      if (mode === 'save' && id === AUTO_SLOT) continue;
      if (mode === 'load' && !info) continue;
      list.append(this.slotRow(mode, id, info));
    }
    if (!list.childElementCount) list.append(el('p', 'menu-empty', '還沒有存檔'));
    const row = el('div', 'menu-row');
    row.append(button('返回', 'menu-btn', () => this.back()));
    if (mode === 'load') row.append(button('匯入檔案', 'menu-btn', () => this.importFile()));
    return [el('h2', '', mode === 'load' ? '讀取存檔' : '存檔'), list, row];
  }

  private slotRow(mode: 'load' | 'save', id: string, info: SlotInfo | null): HTMLElement {
    const row = el('div', 'slot');
    const thumb = el('div', 'slot-thumb');
    if (info?.thumb) thumb.style.backgroundImage = `url("${info.thumb}")`;
    const text = el('div', 'slot-text');
    text.append(el('small', '', slotLabel(id)));
    if (info) {
      text.append(
        el('b', '', info.name),
        el('span', '', `人口 ${info.population.toLocaleString()} · ${ntd(info.money)} · ${gameDate(info.day, false)}`),
        el('span', '', when(info.savedAt)),
      );
    } else text.append(el('b', 'muted', '空的欄位'));
    const acts = el('div', 'slot-actions');
    if (mode === 'save') {
      const b = button(info ? '覆蓋' : '存到這裡', 'chip', () => {
        const run = async () => {
          await this.actions.saveTo(id);
          this.actions.toast(`已存到${slotLabel(id)}`);
          await this.render();
        };
        if (info) this.confirm(`save:${id}`, b, '確定覆蓋？', () => void run());
        else void run();
      });
      acts.append(b);
    } else if (info) {
      acts.append(button('讀取', 'chip primary', () => void this.loadSlot(id)));
      acts.append(
        button('改名', 'chip', async () => {
          const name = prompt('城市名稱', info.name);
          if (name === null) return;
          await this.slots.rename(id, name);
          await this.render();
        }),
      );
      acts.append(button('匯出', 'chip', () => void this.exportSlot(id)));
      const del = button('刪除', 'chip', () =>
        this.confirm(`del:${id}`, del, '確定刪除？', async () => {
          await this.slots.remove(id);
          this.actions.toast(`${slotLabel(id)}已刪除`);
          await this.render();
        }),
      );
      acts.append(del);
    }
    row.append(thumb, text, acts);
    return row;
  }

  private async exportSlot(id: string): Promise<void> {
    const file = await this.slots.exportSlot(id);
    if (!file) return;
    const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }));
    const a = el('a');
    a.href = url;
    a.download = file.filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  private importFile(): void {
    const input = el('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const slot = await this.slots.freeSlot();
      if (!slot) {
        this.actions.toast('存檔欄位已滿，請先刪除一個');
        return;
      }
      try {
        const info = await this.slots.importText(await file.text(), slot);
        this.actions.toast(`已匯入「${info.name}」到${slotLabel(slot)}`);
      } catch (err) {
        console.warn('Could not import', err);
        this.actions.toast('這不是 Metroforge 的存檔檔案');
      }
      await this.render();
    };
    input.click();
  }

  private settings(): HTMLElement[] {
    const s = this.actions.settings();
    const set = (change: Partial<Settings>) => {
      this.actions.setSettings({ ...this.actions.settings(), ...change });
      void this.render();
    };
    const shadows = el('div', 'menu-field');
    const sRow = el('div', 'menu-chips');
    for (const [on, label] of [
      [true, '開'],
      [false, '關'],
    ] as const) {
      const b = button(label, 'chip', () => set({ shadows: on }));
      b.setAttribute('aria-pressed', String(s.shadows === on));
      sRow.append(b);
    }
    shadows.append(el('span', '', '陰影（重新整理後生效，關掉手機會比較順）'), sRow);
    const quality = el('div', 'menu-field');
    const qRow = el('div', 'menu-chips');
    for (const [q, label] of QUALITY_CHOICES) {
      const b = button(label, 'chip', () => set({ quality: q }));
      b.setAttribute('aria-pressed', String(s.quality === q));
      qRow.append(b);
    }
    quality.append(el('span', '', '畫質（自動：依電腦效能調整，維持每秒 50 格以上）'), qRow);
    const fps = el('div', 'menu-field');
    const fRow = el('div', 'menu-chips');
    for (const [on, label] of [
      [true, '顯示'],
      [false, '隱藏'],
    ] as const) {
      const b = button(label, 'chip', () => set({ showFps: on }));
      b.setAttribute('aria-pressed', String(s.showFps === on));
      fRow.append(b);
    }
    fps.append(el('span', '', 'FPS（每秒畫面數）'), fRow);
    const auto = el('div', 'menu-field');
    const aRow = el('div', 'menu-chips');
    for (const [sec, label] of AUTOSAVE_CHOICES) {
      const b = button(label, 'chip', () => set({ autosave: sec }));
      b.setAttribute('aria-pressed', String(s.autosave === sec));
      aRow.append(b);
    }
    auto.append(el('span', '', '自動存檔'), aRow);
    const row = el('div', 'menu-row');
    row.append(button('返回', 'menu-btn', () => this.back()));
    return [el('h2', '', '設定'), quality, shadows, fps, auto, row];
  }
}

/**
 * 新手導引: a short tour shown when a new city starts. Each step lights up one button (found by its
 * data-tour name) and says what it does; the first and last steps explain how the game is played.
 * 略過 ends it at any step, and 選單 → 新手導引 plays it again.
 */

interface Step {
  /** data-tour name of the element to light up; none for a card in the middle of the screen */
  at?: string;
  title: string;
  body: string[];
}

const STEPS: Step[] = [
  {
    title: '歡迎來到 Metroforge！',
    body: [
      '你是這座城市的新任市長。城市從國道交流道旁的一片空地開始。',
      '玩法很簡單：拉道路 → 劃分區，居民和公司就會自己搬進來；再蓋公共設施和大眾運輸照顧他們，讓城市從「鄉村」一路升格到「城鎮」、「縣轄市」、「直轄市」。',
      '接下來帶你認識畫面上的按鈕，隨時可以按「略過」。',
    ],
  },
  {
    at: 'top',
    title: '城市資訊',
    body: [
      '上方是城市的現況：人口、工作數、資金（新台幣）、遊戲日期時間和天氣。',
      'R / C / O / I 四條是需求：住宅、商業、辦公、工業。哪條越高，就代表越缺那種分區，照著劃就對了。',
    ],
  },
  {
    at: 'speeds',
    title: '遊戲速度',
    body: ['暫停、正常速度、快轉。暫停時也可以照常蓋東西，慢慢規劃不用急。'],
  },
  {
    at: 'roads',
    title: '道路（鍵盤 2）',
    body: [
      '一切從道路開始：從交流道接出來的路口拉新馬路。可選雙向道、單行道、匝道、高速公路，地面、高架或地下，直線、曲線、圓環和交流道。',
      '點起點、再點終點就能連續拉路；手機可以拖曳瞄準、放開就蓋好。紅色的路代表還沒接到國道，車子進不來。',
    ],
  },
  {
    at: 'zone',
    title: '分區（鍵盤 3）',
    body: [
      '沿著道路刷上分區：住宅、商業、辦公和各種工業，房子會自己長出來。',
      '筆刷大小可以調；筆刷只會填空地，想改掉已經劃好的分區要打開「更正」。',
    ],
  },
  {
    at: 'transport',
    title: '運輸（鍵盤 4）',
    body: ['公車、捷運、火車、高鐵、機場、港口和 YouBike。先蓋車站，再拉路線，路線名稱和顏色都能自訂。大眾運輸能減少塞車，還有票價收入。'],
  },
  {
    at: 'build',
    title: '建設（鍵盤 5）',
    body: [
      '公園、學校、警察局、消防局、醫院等公共設施，以及地標、綠化、天橋、停車場、夜市和大學。',
      '設施要面向馬路。被服務範圍涵蓋的居民越滿意，住宅需求越高、房子升級越快。有些建設要城市升級後才開放。',
    ],
  },
  {
    at: 'traffic',
    title: '交通（鍵盤 6）',
    body: ['打開交通流量圖：綠色順暢、紅色塞車，下方會顯示車輛數和平均車速。塞車太嚴重時，試著多拉一條路、做圓環，或蓋大眾運輸分流。'],
  },
  {
    at: 'pan',
    title: '瀏覽與命名（鍵盤 1、7）',
    body: ['「瀏覽」只移動地圖，不會誤蓋東西。「命名」可以替道路取路名、劃出區域名稱。'],
  },
  {
    at: 'demolish',
    title: '拆除（鍵盤 X）',
    body: ['拆除道路、軌道、路線、建設和房子。再按一次回到原本的工具。'],
  },
  {
    at: 'undo',
    title: '上一步（Ctrl+Z）',
    body: ['蓋錯或拆錯時，按「上一步」退回剛才的動作，花掉的錢也會退回。只能退回一步，而且要在動作後不久（遊戲時間 6 小時內）使用。'],
  },
  {
    at: 'lock',
    title: '鎖視角',
    body: ['鎖住視角的旋轉與傾斜，拉路時手勢不會把畫面轉歪，仍然可以移動和縮放。手機蓋東西時很好用。'],
  },
  {
    at: 'drive',
    title: '巡查',
    body: ['開著巡邏車在自己的城市裡跑一圈，也可以切換空拍機自由飛行，還能錄影分享。'],
  },
  {
    at: 'mail',
    title: '信箱與活動',
    body: ['「信箱」收居民的來信：心情、建議和抱怨，是了解城市問題的好方法。「活動」是巨蛋的演唱會、球賽邀約，蓋了巨蛋之後就能接檔賺錢。'],
  },
  {
    at: 'compass',
    title: '指北針',
    body: ['顯示目前的方位，點一下讓北方朝上。'],
  },
  {
    at: 'level',
    title: '等級、預算、需求',
    body: [
      '等級：目前的城市等級和升級條件，升級會開放新建設。',
      '預算：收入和支出明細，可以調稅率、票價和停車費。資金變負的話要趕快開源節流。',
      '需求：居民滿意度、服務涵蓋率和就學人數，告訴你該蓋什麼。',
    ],
  },
  {
    at: 'menu',
    title: '選單',
    body: ['存檔、讀取、設定和回到開始畫面。遊戲也會自動存檔。想再看一次導引，就在選單裡按「新手導引」。'],
  },
  {
    title: '移動視角',
    body: [
      '電腦：拖曳移動地圖，右鍵拖曳旋轉，滾輪縮放；也可以用 WASD／方向鍵移動、Q／E 旋轉。',
      '手機：單指拖曳移動，雙指捏合縮放、轉動旋轉。',
    ],
  },
  {
    title: '開始建設吧！',
    body: [
      '① 從交流道接出來的路口拉一條主要道路。',
      '② 沿路劃住宅區，旁邊再劃一些商業區，離住宅遠一點的地方劃工業區。',
      '③ 看上方的 R/C/O/I 需求條，缺什麼就劃什麼。',
      '④ 人口多了以後，蓋學校、警察局、消防局、醫院和公園。',
      '⑤ 注意資金，入不敷出時到「預算」調整稅率。',
    ],
  },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Room left round the card and the lit-up button, in pixels. */
const GAP = 12;

export class Tutorial {
  private root = el('div', 'tour');
  private spot = el('div', 'tour-spot');
  private card = el('section', 'tour-card panel');
  private index = 0;
  private onResize = () => this.place();

  constructor(
    private host: HTMLElement,
    private done: () => void = () => {},
  ) {
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', '新手導引');
    this.root.append(this.spot, this.card);
  }

  get open(): boolean {
    return this.root.isConnected;
  }

  start(): void {
    this.index = 0;
    this.host.append(this.root);
    addEventListener('resize', this.onResize);
    addEventListener('keydown', this.onKey, true);
    this.render();
  }

  close(): void {
    if (!this.open) return;
    this.root.remove();
    removeEventListener('resize', this.onResize);
    removeEventListener('keydown', this.onKey, true);
    this.done();
  }

  private onKey = (e: KeyboardEvent) => {
    // Keep the game's own shortcuts from firing behind the tour
    e.stopPropagation();
    if (e.key === 'Escape') this.close();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') this.go(1);
    else if (e.key === 'ArrowLeft') this.go(-1);
  };

  private go(by: number): void {
    const next = this.index + by;
    if (next >= STEPS.length) return this.close();
    this.index = Math.max(0, next);
    this.render();
  }

  private target(): HTMLElement | null {
    const at = STEPS[this.index].at;
    if (!at) return null;
    const t = document.querySelector<HTMLElement>(`[data-tour="${at}"]`);
    // A button that is hidden right now (say on a narrow screen) gets a card in the middle instead
    return t && t.getClientRects().length ? t : null;
  }

  private render(): void {
    const step = STEPS[this.index];
    const last = this.index === STEPS.length - 1;
    this.card.replaceChildren();
    const head = el('div', 'tour-head');
    head.append(el('span', 'tour-count', `${this.index + 1} / ${STEPS.length}`));
    const skip = el('button', 'tour-skip', '略過導引');
    skip.type = 'button';
    skip.onclick = () => this.close();
    if (!last) head.append(skip);
    this.card.append(head, el('h2', '', step.title));
    for (const p of step.body) this.card.append(el('p', '', p));
    const dots = el('div', 'tour-dots');
    STEPS.forEach((_, i) => dots.append(el('i', i === this.index ? 'on' : '')));
    const row = el('div', 'tour-row');
    const back = el('button', 'tour-btn', '上一步');
    back.type = 'button';
    back.disabled = this.index === 0;
    back.onclick = () => this.go(-1);
    const next = el('button', 'tour-btn primary', last ? '開始玩！' : this.index === 0 ? '開始導覽' : '下一步');
    next.type = 'button';
    next.onclick = () => this.go(1);
    row.append(back, next);
    this.card.append(dots, row);
    this.place();
    next.focus({ preventScroll: true });
  }

  /** Lights up the target and sets the card beside it, above or below, whichever has more room. */
  private place(): void {
    const t = this.target();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.root.classList.toggle('dim', !t);
    if (!t) {
      this.spot.hidden = true;
      Object.assign(this.card.style, { left: '', top: '', bottom: '' });
      this.card.classList.add('centre');
      return;
    }
    this.card.classList.remove('centre');
    const r = t.getBoundingClientRect();
    const pad = 6;
    this.spot.hidden = false;
    Object.assign(this.spot.style, {
      left: `${r.left - pad}px`,
      top: `${r.top - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });
    const cw = Math.min(380, vw - 32);
    const left = Math.min(Math.max(16, r.left + r.width / 2 - cw / 2), vw - 16 - cw);
    this.card.style.left = `${left}px`;
    this.card.style.width = `${cw}px`;
    const below = vh - r.bottom;
    if (below >= r.top) {
      this.card.style.top = `${r.bottom + pad + GAP}px`;
      this.card.style.bottom = '';
    } else {
      this.card.style.top = '';
      this.card.style.bottom = `${vh - r.top + pad + GAP}px`;
    }
  }
}

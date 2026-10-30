import type { City } from '../sim/city';
import { EVENT_KINDS, type EventOffer, FANS_PER_CAR, clashes, delayRisk, eventNet, matchup, expectedAttendance, keenLabel } from '../sim/events';
import { gameDate } from '../sim/format';
import { ntdShort } from '../sim/levels';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

const money = (v: number) => `${v < 0 ? '−' : '+'}NT$${ntdShort(Math.abs(v))}`;

/** A 0..100 meter with its value. */
function meter(label: string, value: number, cls = ''): HTMLElement {
  const row = el('div', `ev-meter ${cls}`);
  const bar = el('span', 'ev-bar');
  const fill = el('i');
  fill.style.width = `${Math.round(value)}%`;
  fill.className = value >= 60 ? 'good' : value >= 35 ? 'mid' : 'bad';
  bar.append(fill);
  row.append(el('span', '', label), bar, el('b', '', String(Math.round(value))));
  return row;
}

/**
 * 巨蛋活動: offers to take or turn down, with how keen residents are and what the night should make,
 * the bookings ahead (warning of clashes), what past events made, and the two kinds of goodwill.
 */
export class EventsPanel {
  readonly panel = el('section', 'budget events panel');
  private shown = '';

  constructor(private readonly hooks: { changed(): void; toast(msg: string): void; lookAt(p: { x: number; y: number }): void }) {
    this.panel.hidden = true;
  }

  render(city: City, force = false): void {
    const book = city.events;
    const access = city.arenaAccess();
    const key = `${book.version}:${Math.round(book.publicFavor)}:${Math.round(book.vendorFavor)}:${access ? Math.round(access.transit * 100) : -1}:${access?.at ? 1 : 0}`;
    if (!force && key === this.shown) return;
    this.shown = key;
    const body: HTMLElement[] = [el('h2', '', '🎤 巨蛋活動')];
    if (!access) {
      body.push(el('p', 'note', '先在「建設 → 地標」蓋一座巨蛋，主辦單位就會開始來洽談演唱會、運動賽事和音樂祭。'));
      this.panel.replaceChildren(...body);
      return;
    }
    body.push(meter('民眾好感度', book.publicFavor), meter('廠商好感度', book.vendorFavor));
    body.push(el('p', 'note', '撞期、塞車會降低好感度；民眾好感度影響滿意度，廠商好感度越高，邀約越多、活動越熱門。'));
    const drive = Math.round((1 - access.transit) * 100);
    const reach = el('p', `note ${drive > 60 ? 'warn' : 'ok'}`);
    reach.textContent = access.modes.length
      ? `場館周邊：${access.modes.join('、')}，約 ${Math.round(access.transit * 100)}% 觀眾搭大眾運輸，${drive}% 開車`
      : `場館周邊沒有捷運、火車站或公車站，觀眾全部開車，會塞爆附近道路。在 500 公尺內蓋捷運或火車站、300 公尺內設公車站可以分流。`;
    body.push(reach);
    if (!access.at) body.push(el('p', 'note warn', '巨蛋門口的道路沒有接上高速公路，觀眾到不了。'));
    const go = el('button', 'chip', '看巨蛋');
    go.type = 'button';
    go.onclick = () => this.hooks.lookAt(access.p);
    body.push(go);

    body.push(el('h3', 'bgroup', `邀約（${book.offers.length}）`));
    if (!book.offers.length) body.push(el('p', 'note', '目前沒有新的邀約，主辦單位每隔一陣子會來洽談。'));
    for (const o of book.offers) body.push(this.offerCard(city, o, access.transit));

    body.push(el('h3', 'bgroup', '已排定'));
    if (!book.booked.length) body.push(el('p', 'note', '還沒有排定的活動。'));
    for (const b of book.booked) {
      const spec = EVENT_KINDS[b.kind];
      const clash = book.booked.some((o) => o !== b && clashes(o, b));
      const pair = book.backToBackWith(b).length > 0;
      const row = el('div', `brow check${clash ? ' warn' : ''}`);
      const live = b.attendance !== undefined;
      const tag = clash ? ' ⚠️撞期' : b.delayed ? ` ⏰延後${b.delayed}分` : pair ? ' 🔁同日接檔' : '';
      row.append(
        el('span', '', `${spec.icon} ${b.name}${tag}`),
        el('b', '', live ? `進行中 · ${b.attendance!.toLocaleString()} 人` : gameDate(b.start)),
      );
      body.push(row);
    }

    if (book.history.length) {
      body.push(el('h3', 'bgroup', '最近的活動'));
      for (const r of book.history.slice(0, 6)) {
        const row = el('div', 'brow');
        const v = el('b', r.net < 0 ? 'neg' : '', money(r.net));
        row.append(el('span', '', `${EVENT_KINDS[r.kind].icon} ${r.name} · ${r.attendance.toLocaleString()} 人${r.clash ? ' · 撞期' : r.delayed ? ` · 延後${r.delayed}分` : ''}`), v);
        body.push(row);
      }
    }
    this.panel.replaceChildren(...body);
  }

  private offerCard(city: City, o: EventOffer, transit: number): HTMLElement {
    const book = city.events;
    const spec = EVENT_KINDS[o.kind];
    const card = el('div', 'ev-card');
    const head = el('div', 'ev-head');
    head.append(el('b', '', `${spec.icon} ${o.name}`), el('small', '', spec.label));
    card.append(head);
    card.append(el('div', 'ev-when', `${gameDate(o.start)} 起 ${o.hours} 小時`));
    if (o.kind === 'sports') {
      const [[home], [away]] = matchup(o);
      card.append(el('div', 'ev-when', `對戰：${home} vs ${away}`));
    }
    card.append(meter(`熱衷程度：${keenLabel(o.keen)}`, o.keen, 'keen'));
    const crowd = expectedAttendance(o.capacity, o.keen);
    const net = eventNet(o, crowd);
    const rows: [string, string, string?][] = [
      ['預估觀眾', `${crowd.toLocaleString()} / ${o.capacity.toLocaleString()} 人`],
      ['市府負擔（場佈、維安、清潔）', `NT$${ntdShort(o.cost)}`],
      ['預估收支（場租、娛樂稅、觀光消費）', money(net), net < 0 ? 'neg' : ''],
      ['開車前往', `約 ${Math.round((crowd * (1 - transit)) / FANS_PER_CAR).toLocaleString()} 輛車`],
    ];
    for (const [label, value, cls] of rows) {
      const r = el('div', 'brow');
      r.append(el('span', '', label), el('b', cls ?? '', value));
      card.append(r);
    }
    const clash = book.clashesWith(o.id);
    if (clash.length) card.append(el('p', 'note warn', `⚠️ 和已排定的「${clash.map((c) => c.name).join('、')}」撞期：觀眾會分散，民眾和廠商好感度都會下降`));
    // 同日接檔: both fill up, with a chance the earlier one holds up the later
    for (const { other, gap, first } of book.backToBackWith(o)) {
      const before = first ? o : other;
      const full = expectedAttendance(before.capacity, before.keen) / before.capacity;
      const risk = delayRisk(gap, 1 - transit, full);
      const hours = gap < 1.95 ? `${Math.round(gap * 60)} 分鐘` : `${Math.round(gap * 10) / 10} 小時`;
      card.append(
        el(
          'p',
          `note ${risk.any > 0.35 ? 'warn' : ''}`,
          `🔁 和「${other.name}」同日接檔，${first ? '這場在前' : '這場在後'}，中間隔 ${hours}：觀眾不會分散，收益照算；但約 ${Math.round(risk.any * 100)}% 機率前場延遲散場或人潮疏散太慢，後場延後開演（觀眾流失、加班費、好感度下降）。場館周邊大眾運輸越方便、間隔越長，風險越低`,
        ),
      );
    }
    if (net < 0) card.append(el('p', 'note warn', '熱衷程度偏低，預估會入不敷出'));
    card.append(el('small', 'ev-expire', `請在 ${gameDate(o.expires)} 前回覆`));
    const buttons = el('div', 'ev-buttons');
    const yes = el('button', 'menu-btn primary', '接下');
    yes.type = 'button';
    yes.onclick = () => {
      const b = book.accept(o.id);
      if (b) this.hooks.toast(`已排定「${b.name}」：${gameDate(b.start)}`);
      this.render(city, true);
      this.hooks.changed();
    };
    const no = el('button', 'menu-btn', '婉拒');
    no.type = 'button';
    no.onclick = () => {
      book.decline(o.id);
      this.render(city, true);
      this.hooks.changed();
    };
    buttons.append(yes, no);
    card.append(buttons);
    return card;
  }
}


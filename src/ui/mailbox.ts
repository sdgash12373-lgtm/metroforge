import type { City } from '../sim/city';
import { gameDate } from '../sim/format';
import { type Letter, TONES, composeLetter } from '../sim/mail';

const POPUPS_KEY = 'skyline-city:mail-popups';
/** Letters kept in the box; older ones drop off the end. */
const KEEP = 40;
/** Game days between letters, at least and at most (a game hour is 1/24). */
const GAP_DAYS: [number, number] = [0.025, 0.045];
/** Never more often than this in real seconds, however fast the game runs. */
const MIN_REAL_GAP = 14;
/** How long a pop-up stays, seconds. */
const BUBBLE_SECONDS = 10;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

interface Kept extends Letter {
  day: number;
}

/**
 * 市民信箱: every so often a resident writes in with a mood, an idea, a suggestion or a complaint,
 * drawn from how the city is doing. Each pops up as a speech bubble in the bottom-right corner;
 * tapping one looks at the place it is about. All of them stay in the inbox panel.
 */
export class Mailbox {
  /** the speech bubbles, stacked bottom-right */
  readonly pop = el('div', 'mail-pop');
  readonly panel = el('section', 'budget mail panel');
  private readonly list = el('div', 'mail-list');
  private readonly toggle = el('input');
  private letters: Kept[] = [];
  private recent: string[] = [];
  private nextDay = -1;
  private lastReal = -Infinity;
  private city: City | null = null;
  private shownKey = '';
  unread = 0;
  popups = true;

  constructor(
    private readonly hooks: { lookAt(p: { x: number; y: number }): void; opened(): void; changed(): void },
  ) {
    try {
      this.popups = localStorage.getItem(POPUPS_KEY) !== '0';
    } catch {
      // Preference only
    }
    this.panel.hidden = true;
    this.panel.append(el('h2', '', '📮 市民信箱'));
    const row = el('label', 'mail-toggle');
    this.toggle.type = 'checkbox';
    this.toggle.checked = this.popups;
    this.toggle.onchange = () => {
      this.popups = this.toggle.checked;
      if (!this.popups) this.pop.replaceChildren();
      try {
        localStorage.setItem(POPUPS_KEY, this.popups ? '1' : '0');
      } catch {
        // Preference only
      }
    };
    row.append(this.toggle, el('span', '', '在右下角彈出市民的話'));
    this.panel.append(row, this.list);
  }

  /** Writes the next letter when it is due. `days` is the game clock in days; `hour` the time of day. */
  update(city: City, days: number, hour: number): void {
    if (city !== this.city) {
      this.city = city;
      this.letters = [];
      this.recent = [];
      this.unread = 0;
      this.nextDay = -1;
      this.pop.replaceChildren();
      this.hooks.changed();
    }
    if (this.nextDay < 0 || this.nextDay > days + 1) this.nextDay = days + GAP_DAYS[0] * 0.6;
    const now = performance.now() / 1000;
    if (days < this.nextDay || now - this.lastReal < MIN_REAL_GAP) return;
    this.nextDay = days + GAP_DAYS[0] + Math.random() * (GAP_DAYS[1] - GAP_DAYS[0]);
    const letter = composeLetter(city, Math.random, hour, this.recent);
    if (!letter) return;
    this.lastReal = now;
    this.recent = [letter.topic, ...this.recent].slice(0, 4);
    const kept = { ...letter, day: days };
    this.letters = [kept, ...this.letters].slice(0, KEEP);
    if (this.panel.hidden) {
      this.unread++;
      if (this.popups && !document.body.classList.contains('driving')) this.bubble(kept);
    } else this.render();
    this.hooks.changed();
  }

  private bubble(l: Kept): void {
    const b = el('div', `mail-bubble panel tone-${l.tone}`);
    b.setAttribute('role', 'status');
    const body = el('button', 'mail-body');
    body.type = 'button';
    body.title = l.at ? '點一下前往' : '點一下打開信箱';
    const head = el('span', 'mail-head');
    head.append(el('span', `mail-tag tone-${l.tone}`, `${TONES[l.tone].icon} ${TONES[l.tone].label}`), el('b', '', l.from));
    const text = el('span', 'mail-text', l.text);
    const words = el('span', 'mail-words');
    words.append(head, text);
    body.append(el('span', 'mail-face', l.face), words);
    body.onclick = () => {
      b.remove();
      if (l.at) {
        this.hooks.lookAt(l.at);
        this.unread = Math.max(0, this.unread - 1);
        this.hooks.changed();
      } else this.hooks.opened();
    };
    const close = el('button', 'mail-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '關閉');
    close.onclick = () => b.remove();
    b.append(body, close);
    this.pop.append(b);
    // Phones have room for one bubble, wider screens two
    const room = window.innerWidth < 520 ? 1 : 2;
    while (this.pop.childElementCount > room) this.pop.firstElementChild!.remove();
    setTimeout(() => {
      b.classList.add('out');
      setTimeout(() => b.remove(), 400);
    }, BUBBLE_SECONDS * 1000);
  }

  /** Shows or hides the inbox; opening it marks every letter read. */
  show(on: boolean): void {
    this.panel.hidden = !on;
    if (on) {
      this.unread = 0;
      this.pop.replaceChildren();
      this.shownKey = '';
      this.render();
    }
    this.hooks.changed();
  }

  private render(): void {
    const key = `${this.letters.length}:${this.letters[0]?.day ?? 0}`;
    if (key === this.shownKey) return;
    this.shownKey = key;
    if (!this.letters.length) {
      this.list.replaceChildren(el('p', 'note', '還沒有市民來信。城市有人住之後，居民會不時寫信告訴你他們的心情、想法、建議和抱怨。'));
      return;
    }
    this.list.replaceChildren(
      ...this.letters.map((l) => {
        const item = el('div', `mail-item tone-${l.tone}`);
        const head = el('div', 'mail-head');
        head.append(el('span', 'mail-face', l.face), el('b', '', l.from), el('span', `mail-tag tone-${l.tone}`, `${TONES[l.tone].icon} ${TONES[l.tone].label}`));
        item.append(head, el('p', 'mail-text', l.text));
        const foot = el('div', 'mail-foot');
        foot.append(el('small', '', gameDate(l.day)));
        if (l.at) {
          const go = el('button', 'chip', '前往');
          go.type = 'button';
          go.onclick = () => this.hooks.lookAt(l.at!);
          foot.append(go);
        }
        item.append(foot);
        return item;
      }),
    );
  }
}

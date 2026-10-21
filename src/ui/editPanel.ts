/** Colours offered for lines and planes; any other colour can be picked with the colour well. */
export const PALETTE = [
  0xe4572e, 0xd62828, 0xf2b134, 0xf4d35e, 0x6a994e, 0x2a9d8f, 0x2e86ab, 0x3d5a80, 0x8a6fd1, 0xa23b72, 0x8d6e63, 0x5f6b77,
];

/** Something the player can rename and recolour: a transit line or a flight. */
export interface EditTarget {
  /** what kind of thing it is, e.g. 公車路線 */
  title: string;
  name: string;
  color: number;
  /** one line of live figures */
  info: string;
  rename(name: string): void;
  recolor(color: number): void;
  remove?: { label: string; run(): void };
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Floating panel to edit the selected line's name and colour. */
export class EditPanel {
  readonly el: HTMLElement;
  private key: string | null = null;
  private info: HTMLElement;
  private body: HTMLElement;

  constructor() {
    this.el = document.createElement('section');
    this.el.className = 'budget edit panel';
    this.el.hidden = true;
    this.body = document.createElement('div');
    this.info = document.createElement('p');
    this.info.className = 'note';
    this.el.append(this.body, this.info);
  }

  /** Shows the panel for a target. It is only rebuilt when the target changes, so typing isn't interrupted. */
  show(key: string, t: EditTarget): void {
    this.el.hidden = false;
    this.info.textContent = t.info;
    if (key === this.key) return;
    this.key = key;
    const title = document.createElement('h2');
    title.textContent = t.title;

    const nameRow = document.createElement('label');
    nameRow.className = 'field';
    const name = document.createElement('input');
    name.type = 'text';
    name.value = t.name;
    name.maxLength = 20;
    name.enterKeyHint = 'done';
    name.onchange = () => t.rename(name.value);
    name.onkeydown = (e) => {
      if (e.key === 'Enter') name.blur();
    };
    nameRow.append(Object.assign(document.createElement('span'), { textContent: '名稱' }), name);

    const swatches = document.createElement('div');
    swatches.className = 'swatches';
    const mark = (c: number) => {
      for (const b of swatches.querySelectorAll<HTMLElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.c === hex(c)));
      well.value = hex(c);
    };
    for (const c of PALETTE) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.c = hex(c);
      b.style.background = hex(c);
      b.setAttribute('aria-label', hex(c));
      b.onclick = () => {
        t.recolor(c);
        mark(c);
      };
      swatches.append(b);
    }
    const well = document.createElement('input');
    well.type = 'color';
    well.setAttribute('aria-label', '自訂顏色');
    well.oninput = () => {
      const c = parseInt(well.value.slice(1), 16);
      t.recolor(c);
      mark(c);
    };
    swatches.append(well);
    mark(t.color);

    const parts: HTMLElement[] = [title, nameRow, swatches];
    if (t.remove) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'chip danger';
      del.textContent = t.remove.label;
      del.onclick = () => t.remove!.run();
      parts.push(del);
    }
    this.body.replaceChildren(...parts);
  }

  hide(): void {
    this.el.hidden = true;
    this.key = null;
  }
}

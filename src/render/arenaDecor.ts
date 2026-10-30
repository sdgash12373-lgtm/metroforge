import * as THREE from 'three';
import type { City } from '../sim/city';
import { type Booking, eventEnd, matchup } from '../sim/events';
import { type Facility, toWorld } from '../sim/facilities';
import { gameDate } from '../sim/format';
import { Builder } from './roadMesh';
import { Kit } from './facilities';
import { ArenaShow, EXIT_HOURS } from './arenaShow';

/** How long before the doors open the arena dresses up, in game days. */
const DRESS_DAYS = 1;
const FONT = "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif";
const STEEL = 0xd5d8da;

/** Where each picture sits on an event's 1024 × 1024 texture. */
interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}
const BANNER: Region = { x: 0, y: 0, w: 1024, h: 256 };
const FLAG_A: Region = { x: 0, y: 256, w: 128, h: 512 };
const FLAG_B: Region = { x: 896, y: 256, w: 128, h: 512 };
const POSTER: Region = { x: 160, y: 288, w: 704, h: 440 };
const SIGN: Region = { x: 0, y: 800, w: 1024, h: 224 };

/** "11/25 19:00" from the game's own calendar. */
function shortDate(days: number): string {
  const m = /\d+\/(\d+)\/(\d+) (\d+:\d+)/.exec(gameDate(days));
  return m ? `${Number(m[1])}/${Number(m[2])} ${m[3]}` : gameDate(days);
}

const hex = (c: string) => parseInt(c.slice(1), 16);

/** Drawing helpers on one canvas. */
class Painter {
  readonly canvas = document.createElement('canvas');
  readonly g: CanvasRenderingContext2D;

  constructor() {
    this.canvas.width = 1024;
    this.canvas.height = 1024;
    this.g = this.canvas.getContext('2d')!;
    this.g.textAlign = 'center';
    this.g.textBaseline = 'middle';
  }

  gradient(r: Region, stops: string[], vertical = false): void {
    const g = this.g;
    const grad = vertical ? g.createLinearGradient(0, r.y, 0, r.y + r.h) : g.createLinearGradient(r.x, 0, r.x + r.w, 0);
    stops.forEach((c, i) => grad.addColorStop(i / Math.max(1, stops.length - 1), c));
    g.fillStyle = grad;
    g.fillRect(r.x, r.y, r.w, r.h);
  }

  /** Text shrunk until it fits `max` pixels wide. */
  text(s: string, x: number, y: number, max: number, size: number, color: string, weight = 900): void {
    const g = this.g;
    let px = size;
    do g.font = `${weight} ${px}px ${FONT}`;
    while (g.measureText(s).width > max && --px > 10);
    g.fillStyle = color;
    g.fillText(s, x, y);
  }

  /** Characters read top to bottom down a flag. */
  vertical(s: string, r: Region, color: string): void {
    const chars = [...s];
    const step = Math.min(84, (r.h - 40) / chars.length);
    this.g.font = `900 ${Math.round(step * 0.86)}px ${FONT}`;
    this.g.fillStyle = color;
    chars.forEach((ch, i) => this.g.fillText(ch, r.x + r.w / 2, r.y + 20 + step * (i + 0.5)));
  }

  texture(): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }
}

/** Textured quads on the event's texture, each a picture facing the street (−v); +u is the viewer's left. */
class Pictures {
  private pos: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];

  constructor(private readonly f: Facility) {}

  add(r: Region, uLeft: number, uRight: number, v: number, z0: number, z1: number, vRight = v): void {
    const i = this.pos.length / 3;
    for (const [u, vv, z] of [
      [uLeft, v, z1],
      [uRight, vRight, z1],
      [uLeft, v, z0],
      [uRight, vRight, z0],
    ] as const) {
      const q = toWorld(this.f, u, vv);
      this.pos.push(q.x, z, q.y);
    }
    const u0 = r.x / 1024;
    const u1 = (r.x + r.w) / 1024;
    const v0 = 1 - r.y / 1024;
    const v1 = 1 - (r.y + r.h) / 1024;
    this.uv.push(u0, v0, u1, v0, u0, v1, u1, v1);
    this.idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
  }

  mesh(tex: THREE.Texture): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setIndex(this.idx);
    // Unlit, so the banners and screens glow at night
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  }
}

interface Dressing {
  f: Facility;
  shapes: Kit;
  pics: Pictures;
  paint: Painter;
  /** see-through light shapes (beams), in world space */
  glow: Builder;
}

/** A pop-up tent with a coloured valance and a counter. */
function tent(k: Kit, u: number, v: number, top: number, valance: number, s = 1): void {
  const h = 1.6 * s;
  for (const [du, dv] of [
    [-h, -h],
    [h, -h],
    [-h, h],
    [h, h],
  ] as const) {
    k.box(u + du - 0.06, v + dv - 0.06, u + du + 0.06, v + dv + 0.06, 0, 2.4, STEEL);
  }
  k.box(u - h - 0.1, v - h - 0.1, u + h + 0.1, v + h + 0.1, 2.4, 2.75, valance);
  k.prism(u, v, h * 1.55, 0, 2.75, 3.6, top, 4, Math.PI / 4);
  k.box(u - h + 0.2, v - h + 0.2, u + h - 0.2, v - h + 0.8, 0, 1, 0xf4f4f4);
}

/** A flagpole at (u, v) with an arm for a hanging vertical banner. */
function pole(k: Kit, u: number, v: number, h = 9.4): void {
  k.prism(u, v, 0.12, 0.1, 0, h, STEEL, 6);
  k.box(u - 0.05, v - 0.08, u + 1.8, v + 0.08, h - 1, h - 0.85, STEEL);
}

/**
 * 演唱會: a neon LED banner across the glass, lighting truss towers throwing coloured beams into the sky,
 * fan flags with the act's name, a giant standee poster and a row of merchandise tents.
 */
function concert(b: Booking, d: Dressing): void {
  const { shapes: k, pics, paint: p } = d;
  const pink = '#f0128f';
  const violet = '#6a1fd1';
  // Textures
  p.g.fillStyle = '#120a24';
  p.g.fillRect(BANNER.x, BANNER.y, BANNER.w, BANNER.h);
  p.gradient({ x: 0, y: 220, w: 1024, h: 36 }, [violet, pink, '#29d3ff']);
  p.text(b.name, 512, 100, 960, 120, '#ffffff');
  p.text(`LIVE 演唱會 · ${shortDate(b.start)} 巨蛋`, 512, 186, 900, 46, '#ff9be0', 700);
  for (const [r, s] of [
    [FLAG_A, b.name.slice(0, 5)],
    [FLAG_B, '應援到底'],
  ] as const) {
    p.gradient(r, [violet, pink], true);
    p.vertical(s, r, '#ffffff');
  }
  p.gradient(POSTER, ['#1b0b3a', violet, pink], true);
  p.g.fillStyle = 'rgba(255,255,255,0.18)';
  for (let i = 0; i < 9; i++) {
    p.g.beginPath();
    p.g.moveTo(POSTER.x + POSTER.w / 2, POSTER.y + POSTER.h);
    p.g.lineTo(POSTER.x + i * 88, POSTER.y);
    p.g.lineTo(POSTER.x + i * 88 + 30, POSTER.y);
    p.g.fill();
  }
  p.text(b.name, 512, POSTER.y + 150, 640, 92, '#ffffff');
  p.text(shortDate(b.start), 512, POSTER.y + 250, 600, 56, '#fff6c9', 700);
  p.text('全台巡迴 · 售票中', 512, POSTER.y + 350, 600, 50, '#ffd1f0', 900);
  // Big banner on the glass front
  k.box(-15.4, -35.9, 15.4, -35.6, 15.4, 15.8, STEEL);
  pics.add(BANNER, 15, -15, -35.95, 8, 15.4);
  // Fan flags along the forecourt
  [-38, -31, -24, 24, 31, 38].forEach((u, n) => {
    pole(k, u, -43);
    pics.add(n % 2 ? FLAG_B : FLAG_A, u + 1.75, u + 0.05, -43.1, 3.6, 8.4);
  });
  // Giant standee on a black frame by the entrance
  k.box(-14, -41.6, -4, -41.2, 0, 6.6, 0x1a1a1e);
  pics.add(POSTER, -4.3, -13.7, -41.7, 0.6, 6.3);
  // Truss towers with coloured heads and beams
  for (const [u, c] of [
    [-44, 0xf0128f],
    [44, 0x29d3ff],
  ] as const) {
    for (const [du, dv] of [
      [-0.6, -0.6],
      [0.6, -0.6],
      [-0.6, 0.6],
      [0.6, 0.6],
    ] as const) {
      k.box(u + du - 0.08, -40 + dv - 0.08, u + du + 0.08, -40 + dv + 0.08, 0, 14, 0xb9bcc0);
    }
    for (let z = 1; z < 14; z += 1.6) k.box(u - 0.7, -40.7, u + 0.7, -39.3, z, z + 0.1, 0xb9bcc0);
    k.box(u - 1.2, -41.2, u + 1.2, -38.8, 14, 14.6, 0x2a2a2e);
    for (const du of [-0.6, 0.6]) k.prism(u + du, -40.6, 0.4, 0.3, 14.6, 15.4, c, 8);
    // Beams: thin cones leaning out over the plaza
    const base = toWorld(d.f, u, -40.6);
    const tip = toWorld(d.f, u * 0.6, -70);
    beam(d.glow, base.x, 15.4, base.y, tip.x, 70, tip.y, 0.4, 5, c);
  }
  // Merchandise tents (周邊商品)
  for (const u of [16, 20.5]) tent(k, u, -38.6, 0x1a1a1e, 0xf0128f);
}

/**
 * 運動賽事: an inflatable arch over the entrance with the event's name, alternating flags in the two
 * teams' colours with their names, a big match board, a giant ball (by sport) and a supporters' tent.
 */
function sports(b: Booking, d: Dressing): void {
  const { shapes: k, pics, paint: p } = d;
  const [[home, hc], [away, ac]] = matchup(b);
  // Textures
  const half = { ...BANNER, w: 512 };
  p.gradient(half, [hc, hc]);
  p.gradient({ ...BANNER, x: 512, w: 512 }, [ac, ac]);
  p.g.fillStyle = '#ffffff';
  p.g.beginPath();
  p.g.moveTo(470, 0);
  p.g.lineTo(560, 0);
  p.g.lineTo(554, 256);
  p.g.lineTo(464, 256);
  p.g.fill();
  p.text(home, 250, 100, 400, 100, '#ffffff');
  p.text(away, 780, 100, 400, 100, '#ffffff');
  p.text('VS', 512, 110, 90, 70, '#111111');
  p.text(`${b.name} · ${shortDate(b.start)}`, 512, 205, 940, 44, '#ffffff', 700);
  p.gradient(FLAG_A, [hc, '#111111'], true);
  p.vertical(home, FLAG_A, '#ffffff');
  p.gradient(FLAG_B, [ac, '#111111'], true);
  p.vertical(away, FLAG_B, '#ffffff');
  p.gradient(POSTER, ['#0d1b2a', '#1b263b'], true);
  p.g.fillStyle = hc;
  p.g.fillRect(POSTER.x, POSTER.y, 24, POSTER.h);
  p.g.fillStyle = ac;
  p.g.fillRect(POSTER.x + POSTER.w - 24, POSTER.y, 24, POSTER.h);
  p.text(b.name, 512, POSTER.y + 70, 620, 60, '#ffd43b');
  p.text(home, 512, POSTER.y + 170, 600, 84, '#ffffff');
  p.text('VS', 512, POSTER.y + 245, 200, 50, '#ffd43b');
  p.text(away, 512, POSTER.y + 320, 600, 84, '#ffffff');
  p.text(`決戰 ${shortDate(b.start)}`, 512, POSTER.y + 400, 600, 40, '#adb5bd', 700);
  p.gradient(SIGN, ['#ffd43b', '#ffa94d']);
  p.text(b.name, 512, SIGN.y + SIGN.h / 2, 960, 130, '#1b263b');
  // Banner on the glass front
  k.box(-15.4, -35.9, 15.4, -35.6, 15.4, 15.8, STEEL);
  pics.add(BANNER, 15, -15, -35.95, 8, 15.4);
  // Inflatable arch: a ring of puffy segments in the two teams' colours, the name on a panel at the top
  const R = 7;
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * Math.PI;
    const u = Math.cos(a) * R;
    const z = Math.sin(a) * R * 1.1;
    k.prism(u, -44, 0.95, 0.95, Math.max(0, z - 0.7), z + 0.7, i < 13 ? hex(hc) : i > 15 ? hex(ac) : 0xffd43b, 10);
  }
  pics.add(SIGN, 5, -5, -45.05, 7.4, 9.6);
  // Team flags
  [-38, -31, -24, 24, 31, 38].forEach((u, n) => {
    pole(k, u, -43);
    pics.add(n % 2 ? FLAG_B : FLAG_A, u + 1.75, u + 0.05, -43.1, 3.6, 8.4);
  });
  // Match board on legs
  k.box(-22, -41.6, -12, -41.2, 0.8, 7.2, 0x1a1a1e);
  for (const u of [-21, -13]) k.box(u - 0.15, -41.5, u + 0.15, -41.2, 0, 0.8, 0x1a1a1e);
  pics.add(POSTER, -12.3, -21.7, -41.7, 1.1, 7);
  // A giant ball for the sport, if it has one
  const ball = /籃/.test(b.name) ? 0xe8590c : /排球/.test(b.name) ? 0xf2f2f2 : /羽球|桌球/.test(b.name) ? 0xf8f9fa : null;
  if (ball !== null) {
    const r = 3;
    for (let j = 0; j < 6; j++) {
      const z0 = (j / 6) * 2 * r;
      const z1 = ((j + 1) / 6) * 2 * r;
      const r0 = Math.sqrt(Math.max(0.05, r * r - (z0 - r) ** 2));
      const r1 = Math.sqrt(Math.max(0.05, r * r - (z1 - r) ** 2));
      k.prism(18, -40, r0, r1, z0 + 0.4, z1 + 0.4, j % 2 ? ball : /排球/.test(b.name) && j === 2 ? 0x1c7ed6 : ball, 14);
    }
    k.prism(18, -40, 1.2, 1.4, 0, 0.4, 0x495057, 10);
  }
  // Supporters' tent in the home colours
  tent(k, 13, -38.6, hex(hc), hex(ac));
}

/**
 * 音樂祭: a truss gate with the festival's name over the entrance, strings of coloured bunting across
 * the forecourt, tall feather flags, and food trucks with striped awnings.
 */
function festival(b: Booking, d: Dressing): void {
  const { shapes: k, pics, paint: p } = d;
  // Textures
  p.gradient(BANNER, ['#ff6b6b', '#f7b733', '#0e9f8a']);
  p.g.fillStyle = 'rgba(255,255,255,0.18)';
  for (let i = 0; i < 12; i++) {
    p.g.beginPath();
    p.g.arc(40 + i * 90, 40 + (i % 3) * 70, 36 + (i % 4) * 10, 0, Math.PI * 2);
    p.g.fill();
  }
  p.text(b.name, 512, 100, 960, 120, '#ffffff');
  p.text(`${shortDate(b.start)} 開唱 · 一整天嗨翻巨蛋`, 512, 192, 900, 46, '#fffbe6', 700);
  for (const [r, s, c] of [
    [FLAG_A, '音樂祭', ['#ff6b6b', '#f7b733']],
    [FLAG_B, b.name.slice(0, 5), ['#0e9f8a', '#4dabf7']],
  ] as const) {
    p.gradient(r, [...c], true);
    p.vertical(s, r, '#ffffff');
  }
  p.gradient(SIGN, ['#2b2118', '#4a3728']);
  p.g.strokeStyle = '#f7b733';
  p.g.lineWidth = 10;
  p.g.strokeRect(SIGN.x + 16, SIGN.y + 16, SIGN.w - 32, SIGN.h - 32);
  p.text(b.name, 512, SIGN.y + 100, 940, 110, '#f7b733');
  p.text('MUSIC FESTIVAL', 512, SIGN.y + 180, 600, 40, '#ffffff', 700);
  // Banner on the glass front
  k.box(-15.4, -35.9, 15.4, -35.6, 15.4, 15.8, STEEL);
  pics.add(BANNER, 15, -15, -35.95, 8, 15.4);
  // Truss gate over the entrance with the name board
  for (const u of [-8, 8]) {
    for (const [du, dv] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [-0.5, 0.5],
      [0.5, 0.5],
    ] as const) {
      k.box(u + du - 0.08, -44 + dv - 0.08, u + du + 0.08, -44 + dv + 0.08, 0, 7, 0x2a2a2e);
    }
    for (let z = 0.8; z < 7; z += 1.2) k.box(u - 0.6, -44.6, u + 0.6, -43.4, z, z + 0.08, 0x2a2a2e);
  }
  k.box(-8.6, -44.6, 8.6, -43.4, 7, 7.6, 0x2a2a2e);
  pics.add(SIGN, 7.6, -7.6, -44.7, 7.7, 10.6);
  // Bunting: zigzag strings of little triangles between tall poles
  const poles = [-42, -26, -10, 10, 26, 42];
  for (const u of poles) k.prism(u, -44, 0.1, 0.08, 0, 7, STEEL, 6);
  const colours = [0xff6b6b, 0xf7b733, 0x0e9f8a, 0x4dabf7, 0xcc5de8, 0xffffff];
  for (let i = 0; i + 1 < poles.length; i++) {
    const a = poles[i];
    const c = poles[i + 1];
    for (let t = 0; t < 1; t += 0.08) {
      const u = a + (c - a) * t;
      const sag = 6.8 - Math.sin(t * Math.PI) * 1.4;
      const col = colours[Math.round(t * 100 + i) % colours.length];
      k.color(col).quad([u, -44, sag], [u + 0.9, -44, sag], [u + 0.45, -44, sag - 0.9], [u + 0.45, -44, sag - 0.9]);
    }
  }
  // Feather flags
  for (const [u, n] of [
    [-34, 0],
    [-30, 1],
    [30, 0],
    [34, 1],
  ] as const) {
    k.prism(u, -40, 0.08, 0.06, 0, 6.6, STEEL, 5);
    pics.add(n ? FLAG_B : FLAG_A, u + 1.3, u + 0.05, -40.05, 1.6, 6.4, -40.05);
  }
  // Food trucks with striped awnings
  for (const [u, body] of [
    [-20, 0xf7b733],
    [16, 0x4dabf7],
    [22, 0xff6b6b],
  ] as const) {
    k.box(u - 2.4, -40, u + 2.4, -37.8, 0.5, 3, body);
    k.box(u - 2.4, -40.02, u + 1.2, -39.98, 1.4, 2.4, 0x2a2a2e);
    k.box(u - 2.6, -41.4, u + 1.4, -40, 2.5, 2.7, 0xffffff);
    for (let s = -2.6; s < 1.4; s += 0.8) k.box(s + u, -41.42, s + u + 0.4, -40, 2.52, 2.72, 0xff6b6b);
    for (const du of [-1.6, 1.6]) k.prism(u + du, -38.9, 0.45, 0.45, 0, 0.5, 0x222222, 8);
  }
}

/** A see-through cone of light from (x0, y0, z0) towards (x1, y1, z1), in three's axes. */
function beam(b: Builder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r0: number, r1: number, c: number): void {
  b.color = new THREE.Color(c);
  const axis = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize();
  const side = new THREE.Vector3(0, 1, 0).cross(axis).normalize();
  const up = axis.clone().cross(side).normalize();
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const ring = (x: number, y: number, z: number, r: number, a: number) => {
      const o = side.clone().multiplyScalar(Math.cos(a) * r).add(up.clone().multiplyScalar(Math.sin(a) * r));
      // Builder points are [x, z(ground), height]
      return [x + o.x, z + o.z, y + o.y];
    };
    b.quad(ring(x0, y0, z0, r0, a0), ring(x0, y0, z0, r0, a1), ring(x1, y1, z1, r1, a0), ring(x1, y1, z1, r1, a1));
  }
}

/**
 * Dresses the arena for its next event, from a day before the doors open until it ends, in a style of
 * its own for each kind: 演唱會, 運動賽事 or 音樂祭, with the show's own name, date and teams.
 */
export class ArenaDecor {
  readonly group = new THREE.Group();
  /** the crowd and the light show, which move every frame */
  private readonly show = new ArenaShow();
  private readonly dressing = new THREE.Group();
  private key = '';
  /** the event dressed for, kept a while after it ends */
  private last: Booking | undefined;

  constructor() {
    this.group.add(this.dressing, this.show.group);
  }

  /** `night` 0..1 how dark it is; `pixels` the screen's pixels per unit one unit from the camera. */
  update(city: City, dt = 0, simDt = dt, night = 0, pixels = 600): void {
    let arena: Facility | null = null;
    for (const f of city.facilities.values()) if (f.kind === 'arena') arena = arena ?? f;
    const day = city.day;
    let show = arena ? city.events.booked.find((b) => day >= b.start - DRESS_DAYS && day < eventEnd(b)) : undefined;
    // Once it is over it leaves the bookings, but the crowd still has to go home
    const last = this.last;
    if (!show && arena && last && day >= last.start && day < eventEnd(last) + EXIT_HOURS / 24) show = last;
    this.last = show;
    this.show.update(arena, show, day, dt, simDt, night, pixels);
    const key = arena && show ? `${arena.id}:${arena.p.x}:${arena.p.y}:${show.id}` : '';
    if (key === this.key) return;
    this.key = key;
    this.clear();
    if (arena && show) this.build(arena, show);
  }

  private clear(): void {
    for (const c of [...this.dressing.children]) {
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
      this.dressing.remove(c);
    }
  }

  private build(f: Facility, b: Booking): void {
    const shapes = new Builder(0);
    const d: Dressing = { f, shapes: new Kit(shapes, f), pics: new Pictures(f), paint: new Painter(), glow: new Builder(0) };
    ({ concert, sports, festival })[b.kind](b, d);
    const solid = new THREE.Mesh(shapes.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
    solid.castShadow = true;
    this.dressing.add(solid, d.pics.mesh(d.paint.texture()));
    const glow = d.glow.geometry();
    if (glow.getAttribute('position')?.count) {
      this.dressing.add(
        new THREE.Mesh(
          glow,
          new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
        ),
      );
    } else glow.dispose();
  }
}

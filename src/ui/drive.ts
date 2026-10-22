import * as THREE from 'three';
import type { City } from '../sim/city';
import type { RoadSegment } from '../sim/roads';
import type { Dir, LaneRef, Vehicle } from '../sim/traffic';
import type { World } from '../render/world';

/** Which way to go at the next junction. */
type Turn = 'left' | 'straight' | 'right';
const TURN_ICON: Record<Turn, string> = { left: '⬅', straight: '⬆', right: '➡' };
const TURN_LABEL: Record<Turn, string> = { left: '下個路口左轉', straight: '下個路口直行', right: '下個路口右轉' };

type View = 'chase' | 'driver';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/**
 * First-person patrol (第一人稱巡查): the player drives a car through the city in traffic. It keeps to
 * its lane and stops for red lights and the car ahead; the player only sets the throttle and picks the
 * way at each junction. W/S or the joystick's up/down drive and brake; A/D or left/right choose the
 * next turn (and move over to that side's lane on wide roads).
 */
export class DriveMode {
  active = false;
  private car: Vehicle | null = null;
  private city: City | null = null;
  private turn: Turn = 'straight';
  private view: View = 'chase';
  private keys = new Set<string>();
  private stick = { x: 0, y: 0 };
  /** keyboard / joystick side input last frame, so a held key sets the turn once */
  private lastSide = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private savedNear = 1;
  private readonly root = el('div', 'drive');
  private readonly speedEl = el('b', 'drive-speed', '0');
  private readonly streetEl = el('span', 'drive-street');
  private readonly turnEl = el('span', 'drive-turn');
  private readonly knob = el('div', 'knob');

  constructor(
    host: HTMLElement,
    private world: World,
    private events: { toast(msg: string): void; changed(): void },
  ) {
    const panel = el('div', 'drive-panel panel');
    const speed = el('div', 'drive-gauge');
    speed.append(this.speedEl, el('small', '', 'km/h'));
    const info = el('div', 'drive-info');
    info.append(this.streetEl, this.turnEl);
    const viewBtn = el('button', 'chip', '切換視角');
    viewBtn.type = 'button';
    viewBtn.onclick = () => {
      this.view = this.view === 'chase' ? 'driver' : 'chase';
      this.snapCamera();
    };
    const exit = el('button', 'chip danger', '離開巡查');
    exit.type = 'button';
    exit.onclick = () => this.stop();
    panel.append(speed, info, viewBtn, exit);

    // Virtual joystick for touch screens
    const pad = el('div', 'joystick');
    pad.append(this.knob);
    pad.setAttribute('aria-label', '虛擬搖桿');
    let id: number | null = null;
    const move = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      const R = r.width / 2;
      let x = (e.clientX - r.left - R) / R;
      let y = (e.clientY - r.top - R) / R;
      const l = Math.hypot(x, y);
      if (l > 1) {
        x /= l;
        y /= l;
      }
      this.stick = { x, y: -y };
      this.knob.style.transform = `translate(${x * R * 0.6}px, ${y * R * 0.6}px)`;
    };
    pad.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      move(e);
      e.stopPropagation();
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) move(e);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      this.stick = { x: 0, y: 0 };
      this.knob.style.transform = '';
    };
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);

    const hint = el('p', 'drive-hint', '電腦：W 油門、S 煞車、A／D 選擇下個路口左轉或右轉　手機：用左下角的搖桿');
    this.root.append(panel, pad, hint);
    this.root.hidden = true;
    host.append(this.root);

    addEventListener('keydown', (e) => {
      if (!this.active || (e.target as HTMLElement).closest?.('input, textarea')) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        e.stopImmediatePropagation();
        this.stop();
        return;
      }
      if (k === 'v') {
        this.view = this.view === 'chase' ? 'driver' : 'chase';
        this.snapCamera();
      }
      this.keys.add(k);
    }, true);
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  /** Starts driving from the street nearest the middle of the view. */
  start(city: City): boolean {
    const net = city.net;
    const target = this.world.rig.target;
    let best: { seg: RoadSegment; d: number } | null = null;
    for (const seg of net.segments.values()) {
      if (!net.isStreet(seg) && !seg.oneway) continue;
      const mid = seg.samples[Math.floor(seg.samples.length / 2)];
      const d = Math.hypot(mid.x - target.x, mid.y - target.y);
      if (seg.length > 12 && (!best || d < best.d)) best = { seg, d };
    }
    if (!best) {
      this.events.toast('先蓋一條道路才能開車巡查');
      return false;
    }
    this.city = city;
    const dir: Dir = 1;
    this.car = city.traffic.spawnPlayer(best.seg, dir, Math.min(6, best.seg.length / 3));
    this.turn = 'straight';
    this.active = true;
    this.world.rig.driving = true;
    this.savedNear = this.world.rig.camera.near;
    this.world.rig.camera.near = 0.3;
    this.world.rig.camera.updateProjectionMatrix();
    this.root.hidden = false;
    document.body.classList.add('driving');
    this.snapCamera();
    this.events.toast('開始巡查：遵守號誌，跟著車流前進');
    this.events.changed();
    return true;
  }

  stop(): void {
    if (!this.active) return;
    const pose = this.car && this.city?.traffic.pose(this.car);
    if (this.car && this.city) this.city.traffic.removeVehicle(this.car);
    this.car = null;
    this.active = false;
    const rig = this.world.rig;
    rig.driving = false;
    rig.camera.near = this.savedNear;
    rig.camera.updateProjectionMatrix();
    if (pose) rig.target = { x: pose.p.x, y: pose.p.y };
    rig.distance = Math.max(rig.distance, 160);
    rig.apply();
    this.root.hidden = true;
    document.body.classList.remove('driving');
    this.keys.clear();
    this.events.changed();
  }

  /** Throttle from the controls, −1..1. */
  private throttle(): number {
    let t = this.stick.y;
    if (this.keys.has('w') || this.keys.has('arrowup')) t = 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) t = -1;
    return t;
  }

  private side(): number {
    let s = Math.abs(this.stick.x) > 0.5 ? Math.sign(this.stick.x) : 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) s = -1;
    if (this.keys.has('d') || this.keys.has('arrowright')) s = 1;
    return s;
  }

  /** The lanes leaving the junction ahead, by how sharply they turn (negative = left). */
  private exits(seg: RoadSegment, dir: Dir): { lane: LaneRef; angle: number }[] {
    const city = this.city!;
    const net = city.net;
    const node = dir === 1 ? seg.b : seg.a;
    const into = city.traffic.headingAt(seg, dir, seg.length);
    const out: { lane: LaneRef; angle: number }[] = [];
    for (const o of net.segments.values()) {
      if (o.id === seg.id || (o.a !== node && o.b !== node)) continue;
      const d: Dir = o.a === node ? 1 : -1;
      if (o.oneway && d === -1) continue;
      // Tunnels and decks only join where they meet at the same level
      const h = net.node(node).h;
      if (Math.abs(net.heightAt(o, d === 1 ? 0 : 1) - h) > 0.5) continue;
      const head = city.traffic.headingAt(o, d, 0);
      // y points south on the map, so a turn to the left has a negative cross product
      const angle = Math.atan2(into.x * head.y - into.y * head.x, into.x * head.x + into.y * head.y);
      out.push({ lane: { seg: o.id, dir: d }, angle });
    }
    return out;
  }

  /** Per frame: controls, next lane, the camera and the dashboard. */
  update(dt: number): void {
    if (!this.active || !this.city || !this.car) return;
    const traffic = this.city.traffic;
    const car = this.car;
    if (!traffic.vehicles.includes(car)) {
      this.events.toast('道路被拆除，巡查結束');
      this.stop();
      return;
    }
    const seg = this.city.net.segments.get(car.seg);
    if (!seg) return;
    car.throttle = this.throttle();
    const side = this.side();
    if (side !== this.lastSide && side !== 0) {
      this.turn = side < 0 ? (this.turn === 'right' ? 'straight' : 'left') : this.turn === 'left' ? 'straight' : 'right';
    }
    this.lastSide = side;
    // Move over to the lane for the turn on wide roads
    const lanes = traffic.laneCount(seg);
    if (lanes > 1) {
      const want = this.turn === 'left' ? lanes - 1 : this.turn === 'right' ? 0 : (car.sub ?? 0);
      const sub = car.sub ?? 0;
      const next = sub + Math.sign(want - sub);
      if (next !== sub && !traffic.laneTaken(car, next)) car.sub = next;
    }
    const exits = this.exits(seg, car.dir);
    if (!exits.length) {
      car.route = [];
      car.dest = seg.length - 2;
      // Dead end: turn around once stopped
      if (car.speed < 0.3 && car.pos > seg.length - 4 && car.throttle > 0) {
        car.dir = car.dir === 1 ? -1 : 1;
        car.pos = seg.length - car.pos;
        car.sub = 0;
        this.turn = 'straight';
      }
    } else {
      const straight = exits.reduce((a, b) => (Math.abs(b.angle) < Math.abs(a.angle) ? b : a));
      const left = exits.filter((e) => e.angle < -0.35).sort((a, b) => a.angle - b.angle)[0];
      const right = exits.filter((e) => e.angle > 0.35).sort((a, b) => b.angle - a.angle)[0];
      const pick = this.turn === 'left' ? (left ?? straight) : this.turn === 'right' ? (right ?? straight) : straight;
      const before = car.route[0];
      car.route = [pick.lane];
      // The turn is done once the car has driven onto a new road
      if (before && before.seg === seg.id) this.turn = 'straight';
    }
    this.followCamera(dt);
    this.speedEl.textContent = String(Math.round(car.speed * 3.6));
    this.streetEl.textContent = seg.name ?? (seg.oneway ? '圓環' : '無名道路');
    const light = traffic.lightFor(seg, car.dir);
    const lightIcon = light === 'red' ? '🔴' : light === 'yellow' ? '🟡' : light === 'green' ? '🟢' : '';
    this.turnEl.textContent = `${TURN_ICON[this.turn]} ${exits.length ? TURN_LABEL[this.turn] : '死路，按油門迴轉'} ${lightIcon}`;
  }

  private snapCamera(): void {
    this.followCamera(1, true);
  }

  private followCamera(dt: number, snap = false): void {
    const pose = this.car && this.city?.traffic.pose(this.car);
    if (!pose) return;
    const cam = this.world.rig.camera;
    const h = Math.max(0, pose.h);
    const hx = pose.heading.x;
    const hy = pose.heading.y;
    const pos = this.view === 'driver' ? new THREE.Vector3(pose.p.x - hx * 0.3, h + 1.45, pose.p.y - hy * 0.3) : new THREE.Vector3(pose.p.x - hx * 11, h + 4.2, pose.p.y - hy * 11);
    const look = new THREE.Vector3(pose.p.x + hx * 25, h + (this.view === 'driver' ? 1.2 : 1.5), pose.p.y + hy * 25);
    // Ease the camera so junction turns and lane changes swing smoothly
    const k = snap ? 1 : 1 - Math.exp(-dt * (this.view === 'driver' ? 9 : 5));
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    if (snap) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
    }
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    // Sun shadows and fog follow the car
    this.world.rig.target = { x: pose.p.x, y: pose.p.y };
    this.world.rig.distance = 90;
  }
}

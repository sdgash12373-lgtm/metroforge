import * as THREE from 'three';
import type { City } from '../sim/city';
import type { RoadSegment } from '../sim/roads';
import type { Dir, LaneRef, Vehicle } from '../sim/traffic';
import type { World } from '../render/world';

/** Which way to go at the next junction. */
type Turn = 'left' | 'straight' | 'right';
const TURN_ICON: Record<Turn, string> = { left: '⬅', straight: '⬆', right: '➡' };
const TURN_LABEL: Record<Turn, string> = { left: '下個路口左轉', straight: '下個路口直行', right: '下個路口右轉' };
/** Closer than this to the junction ahead, left / right pick the turn there instead of changing lanes. */
const TURN_ZONE = 30;

type View = 'chase' | 'driver' | 'drone';

/** 空拍機: how fast it flies (m/s) near the ground, and how much faster per metre of height; how quickly it turns to a drag (rad/px). */
const DRONE_SPEED = 18;
const DRONE_SPEED_PER_M = 0.5;
const DRONE_LOOK = 0.005;
/** It may go anywhere (through buildings and the ground too), only kept within a few km of the city. */
const DRONE_BOUNDS = 12000;
const DRONE_FLOOR = -300;
const DRONE_CEILING = 3000;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/**
 * First-person patrol (第一人稱巡查): the player drives a car through the city in traffic, ignoring
 * its rules. W/S or the joystick's up/down drive and brake. A/D or left/right change lanes on wide
 * roads, and near a junction (or with no lane that way) pick the turn there, from any lane. Q or the
 * 迴轉 button turns round on the spot.
 *
 * 空拍機 (F) leaves the car parked and flies a free camera anywhere, through buildings and the ground: W/S or
 * the stick fly forward and back where it looks, A/D sideways, E/Q or ▲▼ up and down, Shift faster, and a drag
 * (or the arrow keys) turns it.
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
  /** 空拍機: where it is and which way it looks */
  private drone = { pos: new THREE.Vector3(), yaw: 0, pitch: -0.3 };
  /** ▲ / ▼ held on touch screens: +1 up, −1 down */
  private lift = 0;
  /** the view to go back to when the drone lands */
  private groundView: Exclude<View, 'drone'> = 'chase';
  private readonly unitEl = el('small', '', 'km/h');
  private readonly droneBtn = el('button', 'chip', '🚁 空拍機');
  private readonly viewBtn = el('button', 'chip', '切換視角');
  private readonly uturnBtn = el('button', 'chip', '↩ 迴轉');
  private readonly hintEl = el('p', 'drive-hint');
  private readonly liftPad = el('div', 'drone-lift');
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
    speed.append(this.speedEl, this.unitEl);
    const info = el('div', 'drive-info');
    info.append(this.streetEl, this.turnEl);
    const viewBtn = this.viewBtn;
    viewBtn.type = 'button';
    viewBtn.onclick = () => this.switchView();
    this.droneBtn.type = 'button';
    this.droneBtn.onclick = () => this.toggleDrone();
    const uturn = this.uturnBtn;
    uturn.type = 'button';
    uturn.onclick = () => this.uTurn();
    const exit = el('button', 'chip danger', '離開巡查');
    exit.type = 'button';
    exit.onclick = () => this.stop();
    panel.append(speed, info, uturn, viewBtn, this.droneBtn, exit);

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
      try {
        pad.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic or already-released pointer: the stick still follows moves over it
      }
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

    // ▲▼ for the drone's height on touch screens, held down
    for (const [label, dir] of [['▲', 1], ['▼', -1]] as const) {
      const b = el('button', 'chip', label);
      b.type = 'button';
      b.setAttribute('aria-label', dir > 0 ? '上升' : '下降');
      b.addEventListener('pointerdown', (e) => {
        this.lift = dir;
        e.stopPropagation();
      });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) b.addEventListener(ev, () => (this.lift = 0));
      this.liftPad.append(b);
    }
    this.liftPad.hidden = true;
    this.root.append(panel, pad, this.liftPad, this.hintEl);
    this.showHint();
    this.dragToLook();
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
      if (k === 'v') this.switchView();
      if (k === 'f' && !e.repeat) this.toggleDrone();
      if (k === 'q' && !e.repeat && this.view !== 'drone') this.uTurn();
      // Space would press the focused button; Shift-less arrows would scroll
      if (this.view === 'drone' && (k === ' ' || k.startsWith('arrow'))) e.preventDefault();
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
      if (!net.isStreet(seg) && !seg.ring) continue;
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
    this.events.toast('開始巡查：左右換車道、路口前左右轉彎，隨時可以迴轉');
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
    if (this.view === 'drone') rig.target = { x: this.drone.pos.x, y: this.drone.pos.z };
    else if (pose) rig.target = { x: pose.p.x, y: pose.p.y };
    rig.distance = Math.max(rig.distance, 160);
    if (this.view === 'drone') this.toggleDrone();
    rig.apply();
    this.root.hidden = true;
    document.body.classList.remove('driving');
    this.keys.clear();
    this.events.changed();
  }

  /** Turns the patrol car round where it is. */
  private uTurn(): void {
    if (!this.car || !this.city) return;
    if (!this.city.traffic.uTurn(this.car)) {
      this.events.toast('圓環是單行道，不能迴轉');
      return;
    }
    this.turn = 'straight';
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
    if (this.view === 'drone') {
      // The car waits where it was left while the drone flies
      car.throttle = -1;
      this.fly(dt);
      return;
    }
    car.throttle = this.throttle();
    const exits = this.exits(seg, car.dir);
    const side = this.side();
    if (side !== this.lastSide && side !== 0) {
      // Left is towards the centre line: a higher sub-lane
      const lanes = traffic.laneCount(seg);
      const sub = car.sub ?? 0;
      const to = sub - side;
      const nearJunction = exits.length > 0 && seg.length - car.pos < TURN_ZONE;
      if (this.turn !== 'straight' && (side < 0) !== (this.turn === 'left')) this.turn = 'straight';
      else if (!nearJunction && to >= 0 && to < lanes) car.sub = to;
      else if (exits.length) this.turn = side < 0 ? 'left' : 'right';
    }
    this.lastSide = side;
    if (!exits.length) {
      car.route = [];
      car.dest = seg.length - 2;
      // Dead end: turn around once stopped
      if (car.speed < 0.3 && car.pos > seg.length - 4 && car.throttle > 0) this.uTurn();
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
    this.streetEl.textContent = seg.name ?? (seg.ring ? '圓環' : '無名道路');
    const light = traffic.lightFor(seg, car.dir);
    const lightIcon = light === 'red' ? '🔴' : light === 'yellow' ? '🟡' : light === 'green' ? '🟢' : '';
    this.turnEl.textContent = `${TURN_ICON[this.turn]} ${exits.length ? TURN_LABEL[this.turn] : '死路，按油門或迴轉鍵掉頭'} ${lightIcon}`;
  }

  /** 切換視角: chase ↔ driver's seat; from the drone, back down to the car. */
  private switchView(): void {
    if (this.view === 'drone') return this.toggleDrone();
    this.view = this.view === 'chase' ? 'driver' : 'chase';
    this.snapCamera();
  }

  /** Takes off from where the camera is, or lands back at the car. */
  private toggleDrone(): void {
    if (this.view === 'drone') {
      this.view = this.groundView;
      this.lift = 0;
      this.snapCamera();
    } else {
      this.groundView = this.view;
      this.view = 'drone';
      const cam = this.world.rig.camera;
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      this.drone.pos.copy(cam.position).add(new THREE.Vector3(0, 6, 0));
      this.drone.yaw = Math.atan2(dir.x, dir.z);
      this.drone.pitch = -0.35;
    }
    const flying = this.view === 'drone';
    this.droneBtn.textContent = flying ? '🚗 回到車上' : '🚁 空拍機';
    this.droneBtn.setAttribute('aria-pressed', String(flying));
    this.viewBtn.hidden = flying;
    this.uturnBtn.hidden = flying;
    this.liftPad.hidden = !flying;
    this.unitEl.textContent = flying ? '公尺' : 'km/h';
    this.turnEl.hidden = flying;
    this.showHint();
  }

  private showHint(): void {
    const touch = matchMedia('(pointer: coarse)').matches;
    this.hintEl.textContent = this.view === 'drone'
      ? touch
        ? '空拍機：搖桿前後左右飛，▲▼ 升降，在畫面上拖曳轉頭；可以穿過建築和地面'
        : '空拍機：W／S 前後　A／D 左右　E／Q 升降　Shift 加速　拖曳或方向鍵轉頭　F 回到車上　Esc 離開'
      : touch
        ? '搖桿往上加速、往下煞車，左右換車道，靠近路口時左右選轉向'
        : 'W 油門　S 煞車　A／D 換車道（近路口選轉向）　Q 迴轉　V 切換視角　F 空拍機　Esc 離開';
  }

  /** While the drone flies, a drag on the map turns it instead of moving the map. */
  private dragToLook(): void {
    const canvas = this.world.renderer.domElement;
    let id: number | null = null;
    let last = { x: 0, y: 0 };
    const mine = (e: PointerEvent) => this.active && this.view === 'drone' && e.target === canvas;
    addEventListener('pointerdown', (e) => {
      if (!mine(e) || id !== null) return;
      id = e.pointerId;
      last = { x: e.clientX, y: e.clientY };
      e.stopImmediatePropagation();
    }, true);
    addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      this.drone.yaw -= (e.clientX - last.x) * DRONE_LOOK;
      this.drone.pitch = THREE.MathUtils.clamp(this.drone.pitch - (e.clientY - last.y) * DRONE_LOOK, -1.55, 1.55);
      last = { x: e.clientX, y: e.clientY };
      e.stopImmediatePropagation();
    }, true);
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      e.stopImmediatePropagation();
    };
    addEventListener('pointerup', end, true);
    addEventListener('pointercancel', end, true);
    canvas.addEventListener('wheel', (e) => {
      if (this.active && this.view === 'drone') e.stopImmediatePropagation();
    }, { capture: true });
  }

  /** Per frame in the drone: move and turn from the controls, no collisions. */
  private fly(dt: number): void {
    const d = this.drone;
    const k = this.keys;
    const turn = 1.6 * dt;
    if (k.has('arrowleft')) d.yaw += turn;
    if (k.has('arrowright')) d.yaw -= turn;
    if (k.has('arrowup')) d.pitch = Math.min(1.55, d.pitch + turn);
    if (k.has('arrowdown')) d.pitch = Math.max(-1.55, d.pitch - turn);
    let fwd = this.stick.y;
    let strafe = this.stick.x;
    if (k.has('w')) fwd = 1;
    if (k.has('s')) fwd = -1;
    if (k.has('a')) strafe = -1;
    if (k.has('d')) strafe = 1;
    let up = this.lift;
    if (k.has('e') || k.has(' ')) up = 1;
    if (k.has('q') || k.has('c')) up = -1;
    const speed = (DRONE_SPEED + Math.abs(d.pos.y) * DRONE_SPEED_PER_M) * (k.has('shift') ? 4 : 1);
    const look = new THREE.Vector3(Math.sin(d.yaw) * Math.cos(d.pitch), Math.sin(d.pitch), Math.cos(d.yaw) * Math.cos(d.pitch));
    const right = new THREE.Vector3(-Math.cos(d.yaw), 0, Math.sin(d.yaw));
    d.pos.addScaledVector(look, fwd * speed * dt).addScaledVector(right, strafe * speed * dt);
    d.pos.y += up * speed * dt;
    d.pos.x = THREE.MathUtils.clamp(d.pos.x, -DRONE_BOUNDS, DRONE_BOUNDS);
    d.pos.z = THREE.MathUtils.clamp(d.pos.z, -DRONE_BOUNDS, DRONE_BOUNDS);
    d.pos.y = THREE.MathUtils.clamp(d.pos.y, DRONE_FLOOR, DRONE_CEILING);
    const cam = this.world.rig.camera;
    cam.position.copy(d.pos);
    cam.lookAt(d.pos.clone().add(look));
    this.camPos.copy(d.pos);
    this.camLook.copy(d.pos).add(look);
    // Sun shadows, fog and the ground detail follow what the drone looks at
    const reach = Math.max(90, Math.abs(d.pos.y) * 1.2);
    this.world.rig.target = { x: d.pos.x + look.x * reach * 0.5, y: d.pos.z + look.z * reach * 0.5 };
    this.world.rig.distance = reach;
    this.speedEl.textContent = String(Math.round(d.pos.y));
    this.streetEl.textContent = d.pos.y < 0 ? '空拍機（地面下）' : '空拍機';
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
    const pos = this.view === 'driver' ? new THREE.Vector3(pose.p.x + hx * 0.5, h + 1.5, pose.p.y + hy * 0.5) : new THREE.Vector3(pose.p.x - hx * 11, h + 4.2, pose.p.y - hy * 11);
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

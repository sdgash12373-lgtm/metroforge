import type { Vec2 } from '../sim/geometry';
import type { CameraRig } from '../render/cameraRig';
import type { ToolController } from './tools';

const TAP_SLOP = 8;
/** Twist needed before a two-finger gesture starts rotating (~9°), so pinches don't turn the view by accident. */
const TWIST_DEADZONE = 0.16;
/**
 * Aiming a road into these screen margins scrolls the map that way, so the road can be pulled past the
 * top bar and the dock. Fractions of the screen height for top and bottom, pixels for the sides.
 */
const EDGE_TOP = 0.16;
const EDGE_BOTTOM = 0.2;
const EDGE_SIDE = 56;
/** Scroll speed at the very edge, screen pixels a second. */
const EDGE_SPEED = 520;

interface Pointer {
  x: number;
  y: number;
  startX: number;
  startY: number;
  button: number;
}

type Gesture =
  | { kind: 'pending' }
  | { kind: 'pan' }
  | { kind: 'orbit' }
  | { kind: 'paint' }
  /** a finger placing the end of the road being drawn: the ghost road follows it, lifting builds */
  | { kind: 'aim' }
  | { kind: 'pinch'; dist: number; angle: number; mid: { x: number; y: number }; twist: number; rotating: boolean }
  | { kind: 'idle' };

/**
 * Mouse and touch on the map.
 * One finger / left button: the active tool (tap), or move the map on drag. While a road is being
 * drawn, a finger drag moves the road's end instead and lifting the finger builds it.
 * Two fingers: pinch zoom, twist rotate, drag to move. Right button: orbit, or a right click to stop
 * drawing a road. Wheel: zoom.
 */
export function attachInput(el: HTMLElement, rig: CameraRig, tools: ToolController): void {
  const ptrs = new Map<number, Pointer>();
  let gesture: Gesture = { kind: 'idle' };
  const ground = (x: number, y: number): Vec2 | null => {
    const r = el.getBoundingClientRect();
    return rig.groundAt(x - r.left, y - r.top, r.width, r.height);
  };
  const pinch = () => {
    const [a, b] = [...ptrs.values()];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  el.addEventListener('contextmenu', (e) => e.preventDefault());

  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, button: e.button });
    if (ptrs.size === 2) {
      gesture = { kind: 'pinch', ...pinch(), twist: 0, rotating: false };
      return;
    }
    if (ptrs.size > 2) return;
    if (e.button === 2) gesture = { kind: 'orbit' };
    else if (e.button === 1 || tools.tool === 'pan') gesture = { kind: 'pan' };
    else if (e.pointerType !== 'mouse' && tools.aimsOnDrag) {
      gesture = { kind: 'aim' };
      tools.onHover(ground(e.clientX, e.clientY));
    } else if (tools.paintsOnDrag) {
      gesture = { kind: 'paint' };
      const p = ground(e.clientX, e.clientY);
      if (p) tools.onPaint(p);
    } else gesture = { kind: 'pending' };
  });

  el.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') tools.onHover(ground(e.clientX, e.clientY));
      return;
    }
    const prev = { x: p.x, y: p.y };
    p.x = e.clientX;
    p.y = e.clientY;
    switch (gesture.kind) {
      case 'pinch': {
        if (ptrs.size !== 2) return;
        const now = pinch();
        rig.pan(ground(gesture.mid.x, gesture.mid.y), ground(now.mid.x, now.mid.y));
        rig.zoomAt(gesture.dist / now.dist, ground(now.mid.x, now.mid.y));
        let d = now.angle - gesture.angle;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const twist = gesture.twist + d;
        const rotating = gesture.rotating || Math.abs(twist) > TWIST_DEADZONE;
        if (rotating) rig.orbit(d, 0);
        gesture = { kind: 'pinch', ...now, twist, rotating };
        return;
      }
      case 'pending':
        if (Math.hypot(p.x - p.startX, p.y - p.startY) <= TAP_SLOP) break;
        gesture = { kind: 'pan' };
        rig.pan(ground(p.startX, p.startY), ground(p.x, p.y));
        break;
      case 'pan':
        rig.pan(ground(prev.x, prev.y), ground(p.x, p.y));
        break;
      case 'orbit':
        rig.orbit(-(p.x - prev.x) * 0.005, (p.y - prev.y) * 0.004);
        break;
      case 'paint': {
        const g = ground(p.x, p.y);
        if (g) tools.onPaint(g);
        return;
      }
      case 'aim':
        break;
    }
    tools.onHover(ground(p.x, p.y));
  });

  const end = (e: PointerEvent) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    if ((gesture.kind === 'pending' || gesture.kind === 'aim') && ptrs.size === 1 && e.type === 'pointerup') {
      const g = ground(e.clientX, e.clientY);
      if (g) tools.onTap(g);
    }
    // A right click without dragging ends the road or track being drawn
    if (p.button === 2 && e.type === 'pointerup' && tools.drawing && Math.hypot(p.x - p.startX, p.y - p.startY) <= TAP_SLOP) tools.cancel();
    ptrs.delete(e.pointerId);
    // Fingers have no hover: drop the brush / snap ring once the touch ends
    if (e.pointerType !== 'mouse' && ptrs.size === 0) tools.onHover(null);
    // Lifting one finger of a pinch must not turn the other into a tap or a paint stroke
    gesture = ptrs.size === 0 ? { kind: 'idle' } : { kind: gesture.kind === 'pinch' ? 'idle' : gesture.kind } as Gesture;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !ptrs.size) tools.onHover(null);
  });

  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      rig.zoomAt(Math.exp(e.deltaY * 0.0012), ground(e.clientX, e.clientY));
    },
    { passive: false },
  );

  const keys = new Set<string>();
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest?.('input, textarea')) return;
    keys.add(e.key.toLowerCase());
    if (e.key === 'Escape') tools.cancel();
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());

  /** How far into each edge margin the aiming finger is, -1..1 on each axis. */
  const edgePush = (x: number, y: number): { x: number; y: number } => {
    const r = el.getBoundingClientRect();
    const top = r.height * EDGE_TOP;
    const bottom = r.height * EDGE_BOTTOM;
    const side = Math.min(EDGE_SIDE, r.width * 0.15);
    const lx = x - r.left;
    const ly = y - r.top;
    const px = lx < side ? -(side - lx) / side : lx > r.width - side ? (lx - (r.width - side)) / side : 0;
    const py = ly < top ? -(top - ly) / top : ly > r.height - bottom ? (ly - (r.height - bottom)) / bottom : 0;
    return { x: Math.max(-1, Math.min(1, px)), y: Math.max(-1, Math.min(1, py)) };
  };

  // Keyboard camera: WASD / arrows move, Q / E rotate
  let last = performance.now();
  const step = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (gesture.kind === 'aim' && ptrs.size === 1 && tools.aimsOnDrag) {
      const p = [...ptrs.values()][0];
      const push = edgePush(p.x, p.y);
      if (push.x || push.y) {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const v = EDGE_SPEED * dt;
        rig.pan(ground(cx, cy), ground(cx - push.x * v, cy - push.y * v));
        tools.onHover(ground(p.x, p.y));
      }
    }
    if (keys.size && !rig.driving) {
      const speed = rig.distance * 1.2 * dt;
      let fx = 0;
      let fy = 0;
      if (keys.has('w') || keys.has('arrowup')) fy -= 1;
      if (keys.has('s') || keys.has('arrowdown')) fy += 1;
      if (keys.has('a') || keys.has('arrowleft')) fx -= 1;
      if (keys.has('d') || keys.has('arrowright')) fx += 1;
      const c = Math.cos(rig.yaw);
      const s = Math.sin(rig.yaw);
      rig.target.x += (fx * c + fy * s) * speed;
      rig.target.y += (-fx * s + fy * c) * speed;
      rig.apply();
      if (keys.has('q')) rig.orbit(1.5 * dt, 0);
      if (keys.has('e')) rig.orbit(-1.5 * dt, 0);
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

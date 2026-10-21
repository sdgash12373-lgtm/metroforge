import type { Vec2 } from '../sim/geometry';
import type { CameraRig } from '../render/cameraRig';
import type { ToolController } from './tools';

const TAP_SLOP = 8;

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
  | { kind: 'pinch'; dist: number; angle: number; mid: { x: number; y: number } }
  | { kind: 'idle' };

/**
 * Mouse and touch on the map.
 * One finger / left button: the active tool (tap), or move the map on drag.
 * Two fingers: pinch zoom, twist rotate, drag to move. Right button: orbit. Wheel: zoom.
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
      gesture = { kind: 'pinch', ...pinch() };
      return;
    }
    if (ptrs.size > 2) return;
    if (e.button === 2) gesture = { kind: 'orbit' };
    else if (e.button === 1 || tools.tool === 'pan') gesture = { kind: 'pan' };
    else if (tools.paintsOnDrag) {
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
        rig.yaw += now.angle - gesture.angle;
        rig.apply();
        gesture = { kind: 'pinch', ...now };
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
        rig.yaw -= (p.x - prev.x) * 0.005;
        rig.pitch += (p.y - prev.y) * 0.004;
        rig.apply();
        break;
      case 'paint': {
        const g = ground(p.x, p.y);
        if (g) tools.onPaint(g);
        return;
      }
    }
    tools.onHover(ground(p.x, p.y));
  });

  const end = (e: PointerEvent) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    if (gesture.kind === 'pending' && ptrs.size === 1 && e.type === 'pointerup') {
      const g = ground(e.clientX, e.clientY);
      if (g) tools.onTap(g);
    }
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

  // Keyboard camera: WASD / arrows move, Q / E rotate
  let last = performance.now();
  const step = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (keys.size) {
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
      if (keys.has('q')) rig.yaw += 1.5 * dt;
      if (keys.has('e')) rig.yaw -= 1.5 * dt;
      rig.apply();
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

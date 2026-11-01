import * as THREE from 'three';
import { BORE_HALF, PORTAL_HEIGHT, type Landform } from '../sim/landform';

const CONCRETE = new THREE.Color(0xb9b6ac);
const BAND = new THREE.Color(0x8d8a80);
const MOUTH = new THREE.Color(0x101113);

/** Where a bore meets its hill coming from `from`: the first point the ground rises off the plain, and the way in. */
function portalSpot(land: Landform, from: { x: number; y: number }, to: { x: number; y: number }) {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const d = { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
  for (let s = 0; s < len; s += 2) {
    const p = { x: from.x + d.x * s, y: from.y + d.y * s };
    if (land.height(p.x, p.y) > 0.6) return { p, d };
  }
  return null;
}

/**
 * Tunnel mouths for 整地's bores: a concrete headwall across the cutting where the hill begins, with a dark
 * opening tall enough for a viaduct, and wing walls holding back the slope either side.
 */
export function buildPortalGeometry(land: Landform): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const quad = (a: number[], b: number[], c: number[], e: number[], color: THREE.Color) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...e);
    for (let k = 0; k < 6; k++) col.push(color.r, color.g, color.b);
  };
  /** A box from its centre (x, z), half sizes along the bore (dl) and across (dw), from y0 to y1. */
  const box = (cx: number, cz: number, d: { x: number; y: number }, along: number, across: number, dl: number, dw: number, y0: number, y1: number, color: THREE.Color) => {
    const n = { x: -d.y, y: d.x };
    const ox = cx + d.x * along + n.x * across;
    const oz = cz + d.y * along + n.y * across;
    const P = (l: number, w: number, y: number) => [ox + d.x * l + n.x * w, y, oz + d.y * l + n.y * w];
    const c = [P(-dl, -dw, y0), P(dl, -dw, y0), P(dl, dw, y0), P(-dl, dw, y0), P(-dl, -dw, y1), P(dl, -dw, y1), P(dl, dw, y1), P(-dl, dw, y1)];
    quad(c[4], c[5], c[6], c[7], color);
    quad(c[0], c[3], c[7], c[4], color);
    quad(c[1], c[5], c[6], c[2], color);
    quad(c[0], c[4], c[5], c[1], color);
    quad(c[3], c[2], c[6], c[7], color);
  };
  const open = BORE_HALF;
  const top = PORTAL_HEIGHT - 2;
  const wall = 2.5;
  for (const b of land.bores) {
    for (const [from, to] of [[b.a, b.b], [b.b, b.a]] as const) {
      const spot = portalSpot(land, from, to);
      if (!spot) continue;
      const { p, d } = spot;
      // Headwall: two piers and a lintel with a darker band, the opening dark behind them
      box(p.x, p.y, d, 0, -(open + wall / 2), 1.5, wall / 2, -0.5, top + 4, CONCRETE);
      box(p.x, p.y, d, 0, open + wall / 2, 1.5, wall / 2, -0.5, top + 4, CONCRETE);
      box(p.x, p.y, d, 0, 0, 1.5, open, top, top + 4, CONCRETE);
      box(p.x, p.y, d, -0.2, 0, 1.6, open + wall, top + 3, top + 3.6, BAND);
      // The opening, dark, just behind the face of the headwall
      box(p.x, p.y, d, 1.3, 0, 0.1, open, -0.5, top, MOUTH);
      // Wing walls along the cutting, stepping down away from the hill
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const h = (top + 2) * (1 - k / 3);
          box(p.x, p.y, d, -3 - k * 5, side * (open + wall / 2), 2.5, wall / 2, -0.5, h, k % 2 ? BAND : CONCRETE);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

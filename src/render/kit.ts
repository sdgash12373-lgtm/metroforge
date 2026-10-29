import * as THREE from 'three';

/** Give every vertex of a geometry one colour, for parts that keep their own colour under instancing. */
export function tint<T extends THREE.BufferGeometry>(g: T, color: number): T {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) rgb.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  return g;
}

/** A box of size w × h × d centred at (x, y, z), painted one colour (white takes the instance colour). */
export function painted(w: number, h: number, d: number, x: number, y: number, z: number, color = 0xffffff): THREE.BufferGeometry {
  return tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
}

/** A wheel of radius r and width t on the axle along z, its centre at (x, r, z). */
export function wheel(x: number, z: number, r: number, t = 0.25, color = 0x1d1f22): THREE.BufferGeometry {
  return tint(new THREE.CylinderGeometry(r, r, t, 10).rotateX(Math.PI / 2).translate(x, r, z), color);
}

/**
 * Bake shading into a vehicle's vertex colours: darker along the sills and underneath, where the body is shut off
 * from the sky and close to the road, so it looks rounded and grounded with no extra cost when drawn.
 */
export function shade<T extends THREE.BufferGeometry>(g: T, depth = 0.58): T {
  if (!g.getAttribute('color')) tint(g, 0xffffff);
  const pos = g.getAttribute('position');
  const rgb = g.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const f = 1 - depth * (1 - THREE.MathUtils.smoothstep(y, 0.15, 1.4));
    rgb.setXYZ(i, rgb.getX(i) * f, rgb.getY(i) * f, rgb.getZ(i) * f);
  }
  return g;
}

export const GLASS = 0x26323d;
export const TYRE = 0x1d1f22;
export const HEADLIGHT = 0xf4f1e2;
export const TAILLIGHT = 0xc8261e;

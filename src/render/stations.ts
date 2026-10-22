import * as THREE from 'three';
import { quadPoint, quadTangent, tAtLength } from '../sim/geometry';
import type { RailSystem } from '../sim/rail';
import { Builder } from './roadMesh';

const GLASS = 0x9ec9dc;
const CONCRETE = 0xd2d4cf;
const PLATFORM = 0xb9bbb5;

/** Boxes turned to follow the track, in station-local coordinates (u along the track, v across it). */
class Frame {
  constructor(
    private b: Builder,
    private x: number,
    private z: number,
    private dx: number,
    private dz: number,
  ) {}

  /** Box centred at (u, v), `len` along and `wid` across, from height y0 to y1. */
  box(u: number, v: number, len: number, wid: number, y0: number, y1: number, color: number): void {
    const b = this.b;
    b.color = new THREE.Color(color);
    const nx = -this.dz;
    const nz = this.dx;
    const c = (du: number, dv: number, y: number) => [
      this.x + this.dx * (u + du) + nx * (v + dv),
      this.z + this.dz * (u + du) + nz * (v + dv),
      y,
    ];
    const l = len / 2;
    const w = wid / 2;
    const corners = [c(-l, -w, 0), c(l, -w, 0), c(l, w, 0), c(-l, w, 0)];
    for (let k = 0; k < 4; k++) {
      const p = corners[k];
      const q = corners[(k + 1) % 4];
      b.quad([p[0], p[1], y1], [p[0], p[1], y0], [q[0], q[1], y1], [q[0], q[1], y0]);
    }
    const [k0, k1, k2, k3] = corners;
    b.quad([k0[0], k0[1], y1], [k1[0], k1[1], y1], [k3[0], k3[1], y1], [k2[0], k2[1], y1]);
    b.quad([k0[0], k0[1], y0], [k3[0], k3[1], y0], [k1[0], k1[1], y0], [k2[0], k2[1], y0]);
  }
}

/**
 * Station buildings for one kind of train. Metro stations underground are a hall at track level with
 * two entrances on the street above; train and high-speed stations have platforms, canopies and a
 * station building beside the track.
 */
export class StationLayer {
  readonly mesh: THREE.Mesh;

  constructor(shadows: boolean) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = true;
  }

  rebuild(sys: RailSystem): void {
    const b = new Builder(0);
    const colorOf = new Map<number, number>();
    for (const l of sys.transit.lines.values()) for (const id of l.stops) if (!colorOf.has(id)) colorOf.set(id, l.color);
    for (const stop of sys.transit.stops.values()) {
      const seg = stop.at && sys.net.segments.get(stop.at.seg);
      if (!seg || !stop.at) continue;
      const q = sys.net.quad(seg);
      const t = tAtLength(seg.samples, stop.at.s);
      const p = quadPoint(q, t);
      const d = quadTangent(q, t);
      const h = sys.net.heightAt(seg, t);
      const f = new Frame(b, p.x, p.y, d.x, d.y);
      const color = colorOf.get(stop.id) ?? 0x9aa5b1;
      if (sys.kind === 'metro') metroStation(f, h, color);
      else if (sys.kind === 'train') trainStation(f, h, color);
      else hsrStation(f, h, color);
    }
    this.mesh.geometry.dispose();
    this.mesh.geometry = b.geometry();
  }
}

/** Side platforms on both sides of the double track. */
function platforms(f: Frame, h: number, len: number): void {
  for (const side of [-1, 1]) f.box(0, side * 5.6, len, 3, h - 0.2, h + 1.1, PLATFORM);
}

function metroStation(f: Frame, h: number, color: number): void {
  platforms(f, h, 44);
  if (h < 0) {
    // Hall around the platforms, open on top so the trains show in the see-through view
    for (const side of [-1, 1]) {
      f.box(0, side * 7.6, 48, 0.6, h - 0.4, h + 5.6, CONCRETE);
      f.box(0, side * 7.25, 48, 0.1, h + 3.2, h + 3.9, color);
    }
    for (const end of [-1, 1]) f.box(end * 24, 0, 0.6, 15.8, h - 0.4, h + 5.6, CONCRETE);
    // Two small entrances on the street above, on opposite sides of the line
    for (const end of [-1, 1]) {
      const u = end * 15;
      const v = end * 11;
      f.box(u, v, 4.4, 3.2, 0, 2.5, GLASS);
      f.box(u, v, 5, 3.8, 2.5, 2.9, color);
      f.box(u + end * 3.2, v, 0.4, 0.4, 0, 3.6, 0x4a4f57);
      f.box(u + end * 3.2, v, 1, 1, 3.6, 4.6, color);
      // Stair shaft down to the hall, seen in the see-through view
      f.box(u * 0.75, end * 9, 4, 3, h + 3.9, -0.2, CONCRETE);
    }
    return;
  }
  // Above ground: a canopy over both platforms
  for (const u of [-16, 0, 16]) for (const side of [-1, 1]) f.box(u, side * 6.6, 0.5, 0.5, h + 1.1, h + 5.2, 0x7d838a);
  f.box(0, 0, 42, 15.5, h + 5.2, h + 5.7, CONCRETE);
  f.box(0, 0, 42.4, 15.9, h + 5.7, h + 6.0, color);
  // Elevated stations get a stair and lift tower down to the street
  if (h > 2) f.box(0, 10.5, 7, 4.2, 0, h + 5.7, GLASS);
}

function trainStation(f: Frame, h: number, color: number): void {
  platforms(f, h, 84);
  for (const side of [-1, 1]) {
    for (let u = -36; u <= 36; u += 18) f.box(u, side * 5.6, 0.4, 0.4, h + 1.1, h + 4.4, 0x7d838a);
    f.box(0, side * 5.6, 80, 4.2, h + 4.4, h + 4.8, color);
  }
  // Station building on one side, at street level
  const base = Math.max(0, Math.min(h, 0));
  f.box(0, 15, 32, 12, base, base + 8, 0xe9dfc9);
  f.box(0, 15, 34, 14, base + 8, base + 9, color);
  f.box(0, 9.3, 12, 0.3, base, base + 5, GLASS);
  // Clock tower
  f.box(-12, 15, 4, 4, base + 9, base + 15, 0xe9dfc9);
  f.box(-12, 15, 4.6, 4.6, base + 15, base + 15.8, color);
  if (h < 0) {
    for (const side of [-1, 1]) f.box(0, side * 7.6, 88, 0.6, h - 0.4, h + 5.6, CONCRETE);
  }
}

function hsrStation(f: Frame, h: number, color: number): void {
  platforms(f, h, 124);
  // Long roof over the tracks on slim columns
  for (let u = -54; u <= 54; u += 18) for (const side of [-1, 1]) f.box(u, side * 10, 0.6, 0.6, h + 1.1, h + 9, 0x8a9096);
  f.box(0, 0, 130, 22, h + 9, h + 9.6, 0xeef0f2);
  for (const side of [-1, 1]) f.box(0, side * 11, 130, 0.5, h + 8.4, h + 9.8, color);
  // Glass concourse beside the line
  const base = Math.max(0, Math.min(h, 0));
  f.box(0, 24, 60, 20, base, base + 12, GLASS);
  f.box(0, 24, 64, 23, base + 12, base + 13, 0xeef0f2);
  f.box(0, 24, 64.4, 23.4, base + 13, base + 13.4, color);
  if (h > 2) f.box(0, 13, 10, 6, base, h + 1, CONCRETE);
}

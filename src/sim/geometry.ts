/** 2D geometry on the ground plane. x = east, y = south (maps to Three.js z). Units are meters. */

export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function normalize(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
}

/** Quadratic Bézier: a straight road is one whose control point sits on the chord. */
export interface Quad {
  a: Vec2;
  c: Vec2;
  b: Vec2;
}

export function quadPoint(q: Quad, t: number): Vec2 {
  const u = 1 - t;
  return {
    x: u * u * q.a.x + 2 * u * t * q.c.x + t * t * q.b.x,
    y: u * u * q.a.y + 2 * u * t * q.c.y + t * t * q.b.y,
  };
}

export function quadTangent(q: Quad, t: number): Vec2 {
  return normalize({
    x: 2 * (1 - t) * (q.c.x - q.a.x) + 2 * t * (q.b.x - q.c.x),
    y: 2 * (1 - t) * (q.c.y - q.a.y) + 2 * t * (q.b.y - q.c.y),
  });
}

/** de Casteljau split of a quadratic at t. */
export function splitQuad(q: Quad, t: number): [Quad, Quad] {
  const m = quadPoint(q, t);
  return [
    { a: q.a, c: lerp(q.a, q.c, t), b: m },
    { a: m, c: lerp(q.c, q.b, t), b: q.b },
  ];
}

export interface Sample extends Vec2 {
  t: number;
  /** cumulative arc length from t = 0 */
  s: number;
}

export function sampleQuad(q: Quad, n = 32): Sample[] {
  const out: Sample[] = [];
  let s = 0;
  let prev: Vec2 | null = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = quadPoint(q, t);
    if (prev) s += dist(p, prev);
    out.push({ x: p.x, y: p.y, t, s });
    prev = p;
  }
  return out;
}

/** Parameter t at a given arc length along a sampled curve. */
export function tAtLength(samples: Sample[], s: number): number {
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].s >= s) {
      const p = samples[i - 1];
      const f = (s - p.s) / (samples[i].s - p.s || 1);
      return p.t + f * (samples[i].t - p.t);
    }
  }
  return 1;
}

/** Distance from p to segment ab, plus the fraction along ab of the closest point. */
export function pointSegment(p: Vec2, a: Vec2, b: Vec2): { d: number; f: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const f = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
  return { d: Math.hypot(p.x - a.x - dx * f, p.y - a.y - dy * f), f };
}

/** Closest point on a sampled curve: distance and curve parameter t. */
export function closestOnSamples(samples: Sample[], p: Vec2): { d: number; t: number } {
  let best = Infinity;
  let bt = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const r = pointSegment(p, a, b);
    if (r.d < best) {
      best = r.d;
      bt = a.t + r.f * (b.t - a.t);
    }
  }
  return { d: best, t: bt };
}

/** Proper intersection of segments p1p2 and p3p4; returns fractions along each. */
export function segmentIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): { u: number; v: number } | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return null;
  const u = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const v = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v };
}

/** All crossings between two sampled curves, as curve parameters (ta on A, tb on B). */
export function curveIntersections(A: Sample[], B: Sample[]): { ta: number; tb: number }[] {
  const out: { ta: number; tb: number }[] = [];
  for (let i = 1; i < A.length; i++) {
    for (let j = 1; j < B.length; j++) {
      const r = segmentIntersect(A[i - 1], A[i], B[j - 1], B[j]);
      if (!r) continue;
      const ta = A[i - 1].t + r.u * (A[i].t - A[i - 1].t);
      const tb = B[j - 1].t + r.v * (B[j].t - B[j - 1].t);
      // Adjacent sample pairs can report the same crossing twice
      if (out.some((o) => Math.abs(o.ta - ta) < 1e-4)) continue;
      out.push({ ta, tb });
    }
  }
  return out.sort((x, y) => x.ta - y.ta);
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bboxOf(pts: Vec2[]): BBox {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    b.minX = Math.min(b.minX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}

export function bboxNear(b: BBox, p: Vec2, pad: number): boolean {
  return p.x >= b.minX - pad && p.x <= b.maxX + pad && p.y >= b.minY - pad && p.y <= b.maxY + pad;
}

export function bboxOverlap(a: BBox, b: BBox, pad = 0): boolean {
  return a.minX - pad <= b.maxX && b.minX - pad <= a.maxX && a.minY - pad <= b.maxY && b.minY - pad <= a.maxY;
}

/** Small deterministic hash for per-lot variety (0..1). */
export function hash01(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

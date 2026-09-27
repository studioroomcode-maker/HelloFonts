import type { Pt } from './types';

export const pt = (x: number, y: number): Pt => ({ x, y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
export const len = (a: Pt) => Math.hypot(a.x, a.y);
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function norm(a: Pt): Pt {
  const l = len(a);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** 진행 방향의 왼쪽 법선(y 위쪽 좌표계 기준) */
export const leftNormal = (t: Pt): Pt => ({ x: -t.y, y: t.x });

export interface Cubic {
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p3: Pt;
}

export function cubicAt(c: Cubic, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return {
    x: a * c.p0.x + b * c.c1.x + d * c.c2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.c1.y + d * c.c2.y + e * c.p3.y,
  };
}

export function cubicDeriv(c: Cubic, t: number): Pt {
  const u = 1 - t;
  return {
    x: 3 * u * u * (c.c1.x - c.p0.x) + 6 * u * t * (c.c2.x - c.c1.x) + 3 * t * t * (c.p3.x - c.c2.x),
    y: 3 * u * u * (c.c1.y - c.p0.y) + 6 * u * t * (c.c2.y - c.c1.y) + 3 * t * t * (c.p3.y - c.c2.y),
  };
}

export function cubicDeriv2(c: Cubic, t: number): Pt {
  const u = 1 - t;
  return {
    x: 6 * u * (c.c2.x - 2 * c.c1.x + c.p0.x) + 6 * t * (c.p3.x - 2 * c.c2.x + c.c1.x),
    y: 6 * u * (c.c2.y - 2 * c.c1.y + c.p0.y) + 6 * t * (c.p3.y - 2 * c.c2.y + c.c1.y),
  };
}

/** 끝점에서 미분이 0이 되는 경우(조절점이 끝점과 겹침)까지 처리하는 단위 접선 */
export function cubicTangent(c: Cubic, t: number): Pt {
  const d = cubicDeriv(c, t);
  if (len(d) > 1e-6) return norm(d);
  const eps = t < 0.5 ? 1e-3 : -1e-3;
  const d2 = cubicDeriv(c, Math.min(1, Math.max(0, t + eps)));
  if (len(d2) > 1e-9) return norm(d2);
  return norm(sub(c.p3, c.p0));
}

/** 부호 있는 곡률(y 위쪽 좌표계에서 왼쪽으로 돌면 양수) */
export function cubicCurvature(c: Cubic, t: number): number {
  const d1 = cubicDeriv(c, t);
  const l = len(d1);
  if (l < 1e-6) return 0;
  return cross(d1, cubicDeriv2(c, t)) / (l * l * l);
}

export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const p01 = lerp(c.p0, c.c1, t), p12 = lerp(c.c1, c.c2, t), p23 = lerp(c.c2, c.p3, t);
  const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t);
  const m = lerp(p012, p123, t);
  return [
    { p0: c.p0, c1: p01, c2: p012, p3: m },
    { p0: m, c1: p123, c2: p23, p3: c.p3 },
  ];
}

/** t0..t1 구간을 잘라낸 3차 곡선 */
export function subCubic(c: Cubic, t0: number, t1: number): Cubic {
  if (t0 <= 0 && t1 >= 1) return c;
  const right = t0 > 0 ? splitCubic(c, t0)[1] : c;
  const tt = (t1 - t0) / (1 - t0);
  return tt >= 1 ? right : splitCubic(right, tt)[0];
}

export function cubicLength(c: Cubic, n = 16): number {
  let l = 0;
  let prev = c.p0;
  for (let i = 1; i <= n; i++) {
    const p = cubicAt(c, i / n);
    l += dist(prev, p);
    prev = p;
  }
  return l;
}

export function lineAsCubic(a: Pt, b: Pt): Cubic {
  return { p0: a, c1: lerp(a, b, 1 / 3), c2: lerp(a, b, 2 / 3), p3: b };
}

/** 두 직선(점 p + 방향 d)의 교점 */
export function lineIntersect(p1: Pt, d1: Pt, p2: Pt, d2: Pt): Pt | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(p2, p1), d2) / den;
  return add(p1, mul(d1, t));
}

/** 원을 4개의 3차 곡선으로 근사할 때 쓰는 상수 */
export const KAPPA = 0.5522847498;

import type { Contour, Pt, Seg } from '../types';
import { orient } from '../outline';

/**
 * 글자다움 값(0..1)의 등고선을 따라 외곽선을 만든다.
 *  - marching squares로 소수점 픽셀 정밀도의 닫힌 다각형을 얻고
 *  - 점을 줄인 뒤, 모서리는 살리고 나머지는 매끄러운 3차 곡선으로 잇는다
 */

export interface Field {
  w: number;
  h: number;
  v: Float32Array;
}

/** iso 값 등고선. include(x, y)가 false인 픽셀은 0으로 본다 */
export function isoPolygons(f: Field, iso: number, include?: (x: number, y: number) => boolean): Pt[][] {
  const W = f.w + 2, H = f.h + 2; // 가장자리를 0으로 둘러 모든 등고선이 닫히게 한다
  const val = (x: number, y: number) => {
    const ox = x - 1, oy = y - 1;
    if (ox < 0 || oy < 0 || ox >= f.w || oy >= f.h) return 0;
    if (include && !include(ox, oy)) return 0;
    return f.v[oy * f.w + ox];
  };
  const V = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) V[y * W + x] = val(x, y);
  const at = (x: number, y: number) => V[y * W + x];
  // 변 번호: 가로변 (x,y)-(x+1,y) = 2*(y*W+x), 세로변 (x,y)-(x,y+1) = 2*(y*W+x)+1
  const hEdge = (x: number, y: number) => 2 * (y * W + x);
  const vEdge = (x: number, y: number) => 2 * (y * W + x) + 1;
  const pointOf = new Map<number, Pt>();
  const edgePoint = (id: number): Pt => {
    let p = pointOf.get(id);
    if (p) return p;
    const cellIdx = id >> 1, x = cellIdx % W, y = Math.floor(cellIdx / W);
    if ((id & 1) === 0) {
      const a = at(x, y), b = at(x + 1, y);
      const t = (iso - a) / (b - a || 1e-9);
      p = { x: x + t - 1, y: y - 1 };
    } else {
      const a = at(x, y), b = at(x, y + 1);
      const t = (iso - a) / (b - a || 1e-9);
      p = { x: x - 1, y: y + t - 1 };
    }
    pointOf.set(id, p);
    return p;
  };
  // 다음 변으로의 연결(방향 있음: 안쪽이 늘 같은 쪽)
  const next = new Map<number, number>();
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = at(x, y) >= iso ? 1 : 0, tr = at(x + 1, y) >= iso ? 1 : 0;
      const br = at(x + 1, y + 1) >= iso ? 1 : 0, bl = at(x, y + 1) >= iso ? 1 : 0;
      const c = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (c === 0 || c === 15) continue;
      const T = hEdge(x, y), B = hEdge(x, y + 1), L = vEdge(x, y), R = vEdge(x + 1, y);
      const seg = (a: number, b: number) => next.set(a, b);
      const center = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 >= iso;
      switch (c) {
        case 1: seg(B, L); break;
        case 2: seg(R, B); break;
        case 3: seg(R, L); break;
        case 4: seg(T, R); break;
        case 5: if (center) { seg(T, L); seg(B, R); } else { seg(T, R); seg(B, L); } break;
        case 6: seg(T, B); break;
        case 7: seg(T, L); break;
        case 8: seg(L, T); break;
        case 9: seg(B, T); break;
        case 10: if (center) { seg(L, B); seg(R, T); } else { seg(L, T); seg(R, B); } break;
        case 11: seg(R, T); break;
        case 12: seg(L, R); break;
        case 13: seg(B, R); break;
        case 14: seg(L, B); break;
      }
    }
  }
  const out: Pt[][] = [];
  const used = new Set<number>();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const poly: Pt[] = [];
    let cur: number | undefined = start;
    let guard = 0;
    while (cur !== undefined && !used.has(cur) && guard++ < 1e6) {
      used.add(cur);
      poly.push(edgePoint(cur));
      cur = next.get(cur);
    }
    if (poly.length >= 3) out.push(poly);
  }
  return out;
}

function polyArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i], r = p[(i + 1) % p.length];
    a += q.x * r.y - r.x * q.y;
  }
  return a / 2;
}

/** 닫힌 다각형 점 줄이기(시작점과 가장 먼 점으로 둘로 나눠 RDP) */
function simplifyClosed(p: Pt[], eps: number): Pt[] {
  const rdp = (pts: Pt[]): Pt[] => {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1e-9;
    let bi = -1, bd = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / l;
      if (d > bd) { bd = d; bi = i; }
    }
    if (bd <= eps) return [a, b];
    return [...rdp(pts.slice(0, bi + 1)).slice(0, -1), ...rdp(pts.slice(bi))];
  };
  let far = 0, fd = -1;
  p.forEach((q, i) => {
    const d = Math.hypot(q.x - p[0].x, q.y - p[0].y);
    if (d > fd) { fd = d; far = i; }
  });
  const a = rdp(p.slice(0, far + 1));
  const b = rdp([...p.slice(far), p[0]]);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** 다각형을 매끄러운 윤곽으로: 꺾임이 큰 점은 모서리로 남기고 나머지는 캣멀-롬 곡선으로 */
function smoothContour(p: Pt[], cornerDeg: number): Contour {
  const n = p.length;
  const lim = Math.cos((cornerDeg * Math.PI) / 180);
  const corner = p.map((q, i) => {
    const a = p[(i - 1 + n) % n], b = p[(i + 1) % n];
    const v1 = { x: q.x - a.x, y: q.y - a.y }, v2 = { x: b.x - q.x, y: b.y - q.y };
    const c = (v1.x * v2.x + v1.y * v2.y) / ((Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)) || 1);
    return c < lim;
  });
  const tan = (i: number) => {
    const a = p[(i - 1 + n) % n], b = p[(i + 1) % n];
    return { x: (b.x - a.x) / 2, y: (b.y - a.y) / 2 };
  };
  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = p[i], b = p[j];
    if (corner[i] && corner[j]) {
      segs.push({ t: 'L', p: b });
      continue;
    }
    const ta = corner[i] ? { x: b.x - a.x, y: b.y - a.y } : tan(i);
    const tb = corner[j] ? { x: b.x - a.x, y: b.y - a.y } : tan(j);
    segs.push({ t: 'C', c1: { x: a.x + ta.x / 3, y: a.y + ta.y / 3 }, c2: { x: b.x - tb.x / 3, y: b.y - tb.y / 3 }, p: b });
  }
  return { start: p[0], segs };
}

export interface TraceOptions {
  /** 점 줄이기 허용 오차(픽셀) */
  eps: number;
  /** 이 각도보다 많이 꺾이면 모서리 */
  cornerDeg: number;
  /** 이보다 작은 조각(픽셀²)은 버린다 */
  minArea: number;
}

/** 등고선 → 폰트 좌표 윤곽 */
export function traceOutline(f: Field, toEm: (x: number, y: number) => Pt, opts: TraceOptions, include?: (x: number, y: number) => boolean): Contour[] {
  const polys = isoPolygons(f, 0.5, include).filter((q) => Math.abs(polyArea(q)) >= opts.minArea);
  // 몇 겹 안에 들어 있는지로 바깥선(채움)·구멍을 가려 폰트 방향(채움 반시계)으로 맞춘다
  const depth = polys.map((q, i) => polys.reduce((d, r, j) => d + (j !== i && inside(q[0], r) ? 1 : 0), 0));
  return polys.map((q, qi) => {
    const s = simplifyClosed(q, opts.eps);
    const c = smoothContour(s.length >= 3 ? s : q, opts.cornerDeg);
    const m = (pt: Pt) => toEm(pt.x, pt.y);
    return orient({
      start: m(c.start),
      segs: c.segs.map((g) => (g.t === 'L' ? { t: 'L' as const, p: m(g.p) } : { t: 'C' as const, c1: m(g.c1), c2: m(g.c2), p: m(g.p) })),
    }, depth[qi] % 2 === 1);
  });
}

function inside(p: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

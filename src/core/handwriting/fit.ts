import type { PathStroke, Pt, Seg, Stroke } from '../types';

/** 칸 좌표(폰트 단위, y 위)의 획 한 줄과 점별 반폭 */
export interface InkLine {
  pts: Pt[];
  hw: number[];
  closed?: boolean;
  /** 같은 잉크 덩어리(연결 성분) 번호 — 자모 나누기에 쓴다 */
  blob?: number;
}

/** 잉크 덩어리: 자모 자리를 정할 때 덩어리 전체의 위치를 본다 */
export interface InkBlob {
  id: number;
  /** 덩어리 픽셀을 성기게 뽑은 점(칸 좌표) */
  samples: Pt[];
}

/** 칸 하나에 쓴 글씨 */
export interface CellInk {
  text: string;
  lines: InkLine[];
  blobs?: InkBlob[];
}

export interface CleanupOptions {
  /** 0..1 부드럽게(점 줄이기) */
  smooth: number;
  /** 0..1 가로·세로에 가까운 획을 곧게 바로잡는 정도 */
  straighten: number;
  /** 굵기를 고르게(필압 무시) */
  evenWidth: boolean;
  /** 0..1 쓴 글씨를 안내 상자에 맞춰 키우는 정도 */
  fill: number;
}

export const DEFAULT_CLEANUP: CleanupOptions = { smooth: 0.53, straighten: 0.5, evenWidth: false, fill: 0.78 };

/** "개성 유지(0) ↔ 반듯하게(1)" 한 슬라이더를 세부 옵션으로 */
export function cleanupFromTidy(t: number): CleanupOptions {
  return { smooth: 0.15 + t * 0.75, straighten: t, evenWidth: t > 0.8, fill: 0.55 + t * 0.45 };
}

// ───────────────────────── 점 줄이기 ─────────────────────────

function rdp(pts: Pt[], eps: number): number[] {
  if (pts.length <= 2) return pts.map((_, i) => i);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = pts[a], B = pts[b];
    const dx = B.x - A.x, dy = B.y - A.y;
    const l = Math.hypot(dx, dy) || 1e-9;
    let best = -1, bd = 0;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i].x - A.x) * dy - (pts[i].y - A.y) * dx) / l;
      if (d > bd) { bd = d; best = i; }
    }
    if (bd > eps && best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => k && out.push(i));
  return out;
}

/** 이동 평균으로 손떨림 줄이기 */
function smoothPts(pts: Pt[], k: number, closed: boolean): Pt[] {
  if (k <= 0 || pts.length < 5) return pts;
  const n = pts.length;
  return pts.map((_, i) => {
    if (!closed && (i < k || i >= n - k)) return pts[i];
    let sx = 0, sy = 0, c = 0;
    for (let j = -k; j <= k; j++) {
      const q = pts[(i + j + n) % n];
      sx += q.x; sy += q.y; c++;
    }
    return { x: sx / c, y: sy / c };
  });
}

// ───────────────────────── 곧게 바로잡기 ─────────────────────────

function straightenPts(pts: Pt[], maxDeg: number): Pt[] {
  if (maxDeg <= 0) return pts;
  const out = pts.map((p) => ({ ...p }));
  const lim = (maxDeg * Math.PI) / 180;
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i], b = out[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.hypot(dx, dy) < 30) continue;
    const ang = Math.atan2(Math.abs(dy), Math.abs(dx));
    if (ang < lim) out[i + 1].y = a.y;
    else if (Math.PI / 2 - ang < lim) out[i + 1].x = a.x;
  }
  return out;
}

// ───────────────────────── 곡선 맞추기 ─────────────────────────

function toPath(pts: Pt[], ws: (number | undefined)[], closed: boolean): PathStroke {
  const n = pts.length;
  const corner = pts.map((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) return true;
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const v1 = { x: p.x - a.x, y: p.y - a.y }, v2 = { x: b.x - p.x, y: b.y - p.y };
    const l1 = Math.hypot(v1.x, v1.y) || 1, l2 = Math.hypot(v2.x, v2.y) || 1;
    const cos = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
    return cos < Math.cos((38 * Math.PI) / 180);
  });
  const tangent = (i: number): Pt => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    return { x: (b.x - a.x) / 2, y: (b.y - a.y) / 2 };
  };
  const segs: Seg[] = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n;
    const p0 = pts[i], p1 = pts[j];
    const w = ws[j];
    if (corner[i] && corner[j]) {
      segs.push({ t: 'L', p: p1, ...(w !== undefined ? { w } : {}) });
      continue;
    }
    const t0 = corner[i] ? { x: (p1.x - p0.x) / 1, y: (p1.y - p0.y) / 1 } : tangent(i);
    const t1 = corner[j] ? { x: (p1.x - p0.x) / 1, y: (p1.y - p0.y) / 1 } : tangent(j);
    segs.push({
      t: 'C',
      c1: { x: p0.x + t0.x / 3, y: p0.y + t0.y / 3 },
      c2: { x: p1.x - t1.x / 3, y: p1.y - t1.y / 3 },
      p: p1,
      ...(w !== undefined ? { w } : {}),
    });
  }
  const stroke: PathStroke = { kind: 'path', start: pts[0], segs };
  if (ws[0] !== undefined) stroke.startW = ws[0];
  if (closed) stroke.closed = true;
  return stroke;
}

export function medianHalfWidth(lines: InkLine[]): number {
  const all = lines.flatMap((l) => l.hw).filter((v) => v > 0).sort((a, b) => a - b);
  return all.length ? all[Math.floor(all.length / 2)] : 0;
}

/**
 * 손글씨 획들을 뼈대 획으로 정리한다.
 * @param map 칸 좌표(폰트 단위) → 뼈대 좌표(자모 상자 0..100 또는 라틴 기준 좌표)
 * @param refHW 굵기 배율의 기준 반폭(폰트 단위)
 */
export function inkToStrokes(lines: InkLine[], map: (p: Pt) => Pt, opts: CleanupOptions, refHW: number): Stroke[] {
  const out: Stroke[] = [];
  const eps = 4 + opts.smooth * 26;
  for (const line of lines) {
    if (line.pts.length === 1) {
      // 점(i의 점, 마침표): 길이 없는 획 → 둥근 점으로 그려진다
      const p = map(line.pts[0]);
      const w = refHW && !opts.evenWidth ? Math.round(Math.max(0.6, Math.min(2, line.hw[0] / refHW)) * 100) / 100 : undefined;
      out.push({ kind: 'path', start: p, ...(w ? { startW: w } : {}), segs: [] });
      continue;
    }
    if (line.pts.length < 2) continue;
    const closed = !!line.closed;
    const sm = smoothPts(line.pts, Math.round(opts.smooth * 3), closed);
    let keep: number[];
    if (closed) {
      // 고리는 시작점과 가장 먼 점에서 둘로 나눠 줄인다(시작=끝이면 점 줄이기가 퇴화한다)
      let far = 0, fd = -1;
      sm.forEach((p, i) => {
        const d = Math.hypot(p.x - sm[0].x, p.y - sm[0].y);
        if (d > fd) { fd = d; far = i; }
      });
      const first = rdp(sm.slice(0, far + 1), eps);
      const second = rdp([...sm.slice(far), sm[0]], eps).map((i) => i + far).filter((i) => i < sm.length);
      keep = [...new Set([...first, ...second])].sort((a, b) => a - b);
    } else {
      keep = rdp(sm, eps);
    }
    let pts = keep.map((i) => sm[i]);
    const hws = keep.map((i) => line.hw[i] ?? refHW);
    if (pts.length < 2) continue;
    pts = straightenPts(pts, opts.straighten * 12);
    const ws = hws.map((h) => {
      if (opts.evenWidth || !refHW) return undefined;
      const w = Math.max(0.4, Math.min(1.8, h / refHW));
      return Math.abs(w - 1) < 0.08 ? undefined : Math.round(w * 100) / 100;
    });
    out.push(toPath(pts.map(map), ws, closed && pts.length >= 3));
  }
  return out;
}

/** 뼈대 좌표(0..100)의 획을 상자에 맞춰 키운다. fill 0 = 그대로, 1 = 상자를 꽉 채움 */
export function fitToBox(strokes: Stroke[], fill: number): Stroke[] {
  if (fill <= 0 || !strokes.length) return strokes;
  const xs: number[] = [], ys: number[] = [];
  for (const s of strokes) {
    if (s.kind === 'ellipse') { xs.push(s.c.x - s.rx, s.c.x + s.rx); ys.push(s.c.y - s.ry, s.c.y + s.ry); continue; }
    xs.push(s.start.x); ys.push(s.start.y);
    for (const g of s.segs) { xs.push(g.p.x); ys.push(g.p.y); }
  }
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  // 한쪽으로 납작한 획(ㅡ, ㅣ)은 그 방향으로 늘리지 않는다
  const axis = (a: number, b: number) => {
    const ext = b - a;
    if (ext < 25) return { k: 1, off: 0 };
    const k = 1 + (100 / ext - 1) * fill;
    const c = (a + b) / 2;
    // 가운데는 원래 위치에서 상자 가운데(50)로 fill만큼 옮긴다
    const off = c + (50 - c) * fill - c * k;
    return { k, off };
  };
  const ax = axis(x0, x1), ay = axis(y0, y1);
  // 한쪽으로 상자를 벗어나면(안내선 밖에 쓴 경우) 안쪽으로 밀어 넣는다
  const contain = (a: { k: number; off: number }, lo: number, hi: number) => {
    const nlo = lo * a.k + a.off, nhi = hi * a.k + a.off;
    if (nhi - nlo > 100) return a;
    if (nlo < 0) return { ...a, off: a.off - nlo };
    if (nhi > 100) return { ...a, off: a.off - (nhi - 100) };
    return a;
  };
  const cx = contain(ax, x0, x1), cy = contain(ay, y0, y1);
  const f = (p: Pt): Pt => ({ x: p.x * cx.k + cx.off, y: p.y * cy.k + cy.off });
  return strokes.map((s) =>
    s.kind === 'ellipse'
      ? { ...s, c: f(s.c), rx: s.rx * cx.k, ry: s.ry * cy.k }
      : { ...s, start: f(s.start), segs: s.segs.map((g) => (g.t === 'L' ? { ...g, p: f(g.p) } : { ...g, c1: f(g.c1), c2: f(g.c2), p: f(g.p) })) },
  );
}

import type { Params, Stroke } from './types';
import type { EmBox } from './compose';

/**
 * 음절 단위 획 간격 맞추기.
 *
 * 자모마다 칸이 따로 있으면 자모 사이 간격이 자모 속 획 사이보다 넓어 세로 공간이 낭비되고,
 * 굵은 글꼴에서는 ㅋ·ㅡ·ㄹ처럼 가로획이 여럿 쌓인 음절이 막히거나(보정 없음) 지나치게 가늘어진다(자모별 보정).
 * 여기서는 음절 전체의 가로획 높이(세로 기둥은 가로 위치)를 모아,
 *  1. 서로 겹쳐 쌓인 획 사이에 "획 굵기 × strokeGap" 이상의 틈이 남도록 위치를 다시 잡고(글자 칸 안에서)
 *  2. 칸이 모자랄 때만 그 쌓임에 속한 자모를 가늘게 하며
 *  3. 옮긴 위치를 구간별 선형 변환으로 음절의 모든 획에 적용한다(세로획은 사이를 따라 늘어나 자모 모양이 유지된다).
 */

export interface Warp {
  fwd: (v: number) => number;
  inv: (v: number) => number;
}

export interface Balance {
  wx: Warp;
  wy: Warp;
  /** 자모(배치)별 굵기 배율 */
  factor: number[];
}

interface Bar {
  pos: number;
  a: number;
  b: number;
  owner: number;
}

const IDENTITY: Warp = { fwd: (v) => v, inv: (v) => v };

/** 한 축의 획 모으기: axis 'y'는 가로획(높이 pos, 가로 범위 a..b), 'x'는 세로 기둥 */
function collectBars(strokes: Stroke[], owner: number, axis: 'x' | 'y', minLen: number): Bar[] {
  const out: Bar[] = [];
  const along = axis === 'y' ? 'x' : 'y';
  for (const s of strokes) {
    if (s.kind === 'ellipse') {
      // 이응 고리의 위·아래(또는 왼쪽·오른쪽)도 가로획처럼 다른 획과 부딪힌다
      const r = axis === 'y' ? s.ry : s.rx, q = axis === 'y' ? s.rx : s.ry;
      const c = s.c[axis], m = s.c[along];
      out.push({ pos: c - r, a: m - q * 0.7, b: m + q * 0.7, owner }, { pos: c + r, a: m - q * 0.7, b: m + q * 0.7, owner });
      continue;
    }
    let prev = s.start;
    const segs = s.closed ? [...s.segs, { t: 'L' as const, p: s.start }] : s.segs;
    for (const g of segs) {
      const dAlong = Math.abs(g.p[along] - prev[along]), dAcross = Math.abs(g.p[axis] - prev[axis]);
      if (dAlong >= minLen && dAcross <= dAlong * 0.3) {
        out.push({ pos: (g.p[axis] + prev[axis]) / 2, a: Math.min(g.p[along], prev[along]), b: Math.max(g.p[along], prev[along]), owner });
      }
      prev = g.p;
    }
  }
  return out;
}

function piecewise(v: number, xs: number[], ys: number[]): number {
  if (xs.length < 2) return v;
  let i = 0;
  if (v >= xs[xs.length - 1]) i = xs.length - 2;
  else while (i < xs.length - 2 && v > xs[i + 1]) i++;
  const t = (v - xs[i]) / (xs[i + 1] - xs[i] || 1);
  return ys[i] + (ys[i + 1] - ys[i]) * t;
}

interface AxisResult {
  warp: Warp;
  f: number;
  members: Set<number>;
}

/** 두 무리 사이의 간격 제약: z[j] − z[i] ≥ 2·hw·f·(1+ratio)(쌓임) 또는 고정값(순서 유지) */
interface Edge {
  i: number;
  j: number;
  stacked: boolean;
  fixed: number;
}

/**
 * 한 축 풀기. lo..hi는 쓸 수 있는 범위, hw는 획 반폭.
 * 각 무리는 아래쪽에서 겹치는(다른 축으로 겹치는) 가장 가까운 무리와 2·hw·(1+ratio) 이상 떨어져야 한다.
 * 이웃한 무리끼리는 순서만 지키면 된다(원래 간격의 일부). 사이에 다른 자모의 획이 끼어 있어도(ㅎ 고리 위·아래 사이의 ㅓ 곁줄기)
 * 겹치는 획끼리의 제약은 살아 있다.
 */
function solveAxis(bars: Bar[], lo: number, hi: number, hw: number, ratio: number, density: number): AxisResult {
  const none: AxisResult = { warp: IDENTITY, f: 1, members: new Set() };
  if (bars.length < 2 || hw <= 0) return none;
  bars.sort((p, q) => p.pos - q.pos);
  // 거의 같은 높이의 획은 한 무리
  const groups: Bar[][] = [];
  for (const b of bars) {
    const g = groups[groups.length - 1];
    if (g && b.pos - g[g.length - 1].pos < hw * 0.15) g.push(b);
    else groups.push([b]);
  }
  if (groups.length < 2) return none;
  const n = groups.length;
  const pos = groups.map((g) => g.reduce((s, b) => s + b.pos, 0) / g.length);
  const overlaps = (g: Bar[], h: Bar[]) => g.some((p) => h.some((q) => p.a - hw < q.b && q.a - hw < p.b));
  const edges: Edge[] = [];
  for (let j = 1; j < n; j++) {
    const d = pos[j] - pos[j - 1];
    edges.push({ i: j - 1, j, stacked: false, fixed: Math.min(d, 0.3 * d + 2) });
    for (let i = j - 1; i >= 0; i--) {
      if (overlaps(groups[i], groups[j])) { edges.push({ i, j, stacked: true, fixed: 0 }); break; }
    }
  }
  const gapFor = (f: number) => 2 * hw * f * (1 + ratio);
  const needOf = (e: Edge, f: number) => (e.stacked ? gapFor(f) : e.fixed);
  if (edges.every((e) => pos[e.j] - pos[e.i] >= needOf(e, 1) - 0.5)) return none;

  // 가장 긴 제약 사슬의 길이(아래 끝 무리부터)
  const chain = (f: number) => {
    const L = new Array(n).fill(0);
    for (const e of edges.sort((a, b) => a.j - b.j)) L[e.j] = Math.max(L[e.j], L[e.i] + needOf(e, f));
    return Math.max(...L);
  };
  const span = (f: number) => Math.max(hi - hw * f, pos[n - 1]) - Math.min(lo + hw * f, pos[0]);

  // 칸이 모자라면 쌓인 획을 가늘게(밀도 보정 강도만큼): 사슬이 칸에 들어가는 가장 굵은 값
  let f = 1;
  if (chain(1) > span(1)) {
    let a = 0.45, b = 1;
    for (let it = 0; it < 30; it++) {
      const m = (a + b) / 2;
      if (chain(m) <= span(m)) a = m; else b = m;
    }
    f = 1 - (1 - a) * Math.min(1, Math.max(0, density));
  }
  const members = new Set<number>();
  for (const e of edges) if (e.stacked) [...groups[e.i], ...groups[e.j]].forEach((b) => members.add(b.owner));
  // 가늘게 해도 칸에 다 들어가지 않으면(굵은 글꼴의 ㄶ 등) 억지로 밀지 않는다 — 자모가 찌그러지고 늘어나므로 가늘게만
  if (chain(f) > span(f) + 0.5) return { warp: IDENTITY, f, members };
  const lim0 = Math.min(lo + hw * f, pos[0]), lim1 = Math.max(hi - hw * f, pos[n - 1]);

  // 가까운 해: 모자란 틈만큼 양쪽으로 밀어내기를 되풀이한 뒤, 칸 안으로 앞뒤로 한 번씩 정리
  const z = [...pos];
  for (let it = 0; it < 80; it++) {
    let moved = false;
    for (const e of edges) {
      const d = needOf(e, f) - (z[e.j] - z[e.i]);
      if (d > 0.01) { z[e.i] -= d / 2; z[e.j] += d / 2; moved = true; }
    }
    for (let k = 0; k < n; k++) z[k] = Math.min(lim1, Math.max(lim0, z[k]));
    if (!moved) break;
  }
  const into = new Map<number, Edge[]>(), outOf = new Map<number, Edge[]>();
  for (const e of edges) {
    into.set(e.j, [...(into.get(e.j) ?? []), e]);
    outOf.set(e.i, [...(outOf.get(e.i) ?? []), e]);
  }
  z[0] = Math.max(z[0], lim0);
  for (let k = 1; k < n; k++) for (const e of into.get(k) ?? []) z[k] = Math.max(z[k], z[e.i] + needOf(e, f));
  z[n - 1] = Math.min(z[n - 1], lim1);
  for (let k = n - 2; k >= 0; k--) for (const e of outOf.get(k) ?? []) z[k] = Math.min(z[k], z[e.j] - needOf(e, f));

  // 무리 위치를 옮기는 구간별 선형 변환. 칸 끝(lo·hi)은 제자리에 두어,
  // 맨 위·아래 무리 바깥의 획(ㅅ 꼭지 등)이 칸 밖으로 밀려 나가지 않고 그 사이에서 줄어들게 한다
  const xs = [lo - 1000], ys = [lo - 1000];
  if (pos[0] > lo && z[0] > lo) { xs.push(lo); ys.push(lo); }
  xs.push(...pos); ys.push(...z);
  if (pos[n - 1] < hi && z[n - 1] < hi) { xs.push(hi); ys.push(hi); }
  xs.push(hi + 1000); ys.push(hi + 1000);
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] <= xs[i - 1]) xs[i] = xs[i - 1] + 1e-3;
    if (ys[i] <= ys[i - 1]) ys[i] = ys[i - 1] + 1e-3;
  }
  return { warp: { fwd: (v) => piecewise(v, xs, ys), inv: (v) => piecewise(v, ys, xs) }, f, members };
}

export function balanceSyllable(placements: { strokes: Stroke[] }[], cell: EmBox, p: Params, half: { h: number; v: number }): Balance | null {
  const minX = (cell.x1 - cell.x0) * 0.08, minY = (cell.yTop - cell.yBottom) * 0.08;
  const barsY = placements.flatMap((pl, i) => collectBars(pl.strokes, i, 'y', minX));
  const barsX = placements.flatMap((pl, i) => collectBars(pl.strokes, i, 'x', minY));
  const ratio = p.strokeGap;
  const ry = solveAxis(barsY, cell.yBottom, cell.yTop, half.h, ratio, p.density);
  const rx = solveAxis(barsX, cell.x0, cell.x1, half.v, ratio, p.density);
  if (ry.warp === IDENTITY && rx.warp === IDENTITY && ry.f === 1 && rx.f === 1) return null;
  const factor = placements.map((_, i) => Math.min(ry.members.has(i) ? ry.f : 1, rx.members.has(i) ? rx.f : 1));
  return { wx: rx.warp, wy: ry.warp, factor };
}

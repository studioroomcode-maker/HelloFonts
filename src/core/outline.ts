import type { CapStyle, Contour, EllipseStroke, JoinStyle, PathStroke, Pt, Seg, SerifStyle, Stroke } from './types';
import {
  add, cross, cubicAt, cubicCurvature, cubicTangent, dist, dot, KAPPA, leftNormal, lineAsCubic, lineIntersect, mul, sub,
  cubicLength, type Cubic,
} from './geom';
import { endDecoration, type EndDeco, type StrokeEnd } from './serif';

export interface StrokeStyle {
  weight: number;
  cap: CapStyle;
  join: JoinStyle;
  contrast: number;
  penAngle: number;
  pressureStart: number;
  pressureMid: number;
  pressureEnd: number;
  serif: SerifStyle;
  serifSize: number;
  /** 라틴 글자인지(명조 장식 대신 세리프를 쓴다) */
  latin: boolean;
  /** 글자 세로 중심(세리프 방향 판단용) */
  centerY: number;
}

type EndType = CapStyle;

const MITER_LIMIT = 3;

// ───────────────────────── 굵기 함수 ─────────────────────────

/** 진행 방향에 따른 굵기 배율: 펜 각도 방향이 가장 가늘다 */
export function dirFactor(t: Pt, s: Pick<StrokeStyle, 'contrast' | 'penAngle'>): number {
  const thin = 1 - s.contrast;
  const a = (s.penAngle * Math.PI) / 180;
  const across = Math.abs(t.y * Math.cos(a) - t.x * Math.sin(a));
  return thin + (1 - thin) * across;
}

/** 가로획·세로획의 반폭 */
export function stemHalfWidths(s: Pick<StrokeStyle, 'weight' | 'contrast' | 'penAngle'>) {
  return {
    h: (s.weight / 2) * dirFactor({ x: 1, y: 0 }, s),
    v: (s.weight / 2) * dirFactor({ x: 0, y: 1 }, s),
  };
}

const smooth = (x: number) => x * x * (3 - 2 * x);

function pressureAt(u: number, s: StrokeStyle): number {
  if (u < 0.5) return s.pressureStart + (s.pressureMid - s.pressureStart) * smooth(u / 0.5);
  return s.pressureMid + (s.pressureEnd - s.pressureMid) * smooth((u - 0.5) / 0.5);
}

// ───────────────────────── 윤곽 유틸 ─────────────────────────

export function contourArea(c: Contour): number {
  const pts: Pt[] = [c.start];
  let prev = c.start;
  for (const s of c.segs) {
    if (s.t === 'L') pts.push(s.p);
    else {
      const cb: Cubic = { p0: prev, c1: s.c1, c2: s.c2, p3: s.p };
      for (let i = 1; i <= 6; i++) pts.push(cubicAt(cb, i / 6));
    }
    prev = s.p;
  }
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function reverseContour(c: Contour): Contour {
  const nodes = [c.start, ...c.segs.map((s) => s.p)];
  const segs: Seg[] = [];
  for (let i = c.segs.length - 1; i >= 0; i--) {
    const s = c.segs[i];
    const to = nodes[i];
    segs.push(s.t === 'L' ? { t: 'L', p: to } : { t: 'C', c1: s.c2, c2: s.c1, p: to });
  }
  return { start: nodes[nodes.length - 1], segs };
}

/** 채움 윤곽은 반시계(y 위 기준), 구멍은 시계 방향으로 맞춘다 */
export function orient(c: Contour, hole = false): Contour {
  const a = contourArea(c);
  return (a < 0) !== hole ? reverseContour(c) : c;
}

export function polygon(pts: Pt[]): Contour {
  return { start: pts[0], segs: pts.slice(1).map((p) => ({ t: 'L' as const, p })) };
}

export function ellipseContour(c: Pt, rx: number, ry: number): Contour {
  const kx = rx * KAPPA, ky = ry * KAPPA;
  const E = { x: c.x + rx, y: c.y }, N = { x: c.x, y: c.y + ry };
  const W = { x: c.x - rx, y: c.y }, S = { x: c.x, y: c.y - ry };
  return {
    start: E,
    segs: [
      { t: 'C', c1: { x: E.x, y: E.y + ky }, c2: { x: N.x + kx, y: N.y }, p: N },
      { t: 'C', c1: { x: N.x - kx, y: N.y }, c2: { x: W.x, y: W.y + ky }, p: W },
      { t: 'C', c1: { x: W.x, y: W.y - ky }, c2: { x: S.x - kx, y: S.y }, p: S },
      { t: 'C', c1: { x: S.x + kx, y: S.y }, c2: { x: E.x, y: E.y - ky }, p: E },
    ],
  };
}

/** 타원 획을 4개의 3차 곡선으로 된 닫힌 획으로 바꾼다 */
export function ellipseAsPath(e: EllipseStroke): PathStroke {
  const c = ellipseContour(e.c, e.rx, e.ry);
  if (e.w === undefined || e.w === 1) return { kind: 'path', start: c.start, segs: c.segs, closed: true };
  return { kind: 'path', start: c.start, startW: e.w, segs: c.segs.map((g) => ({ ...g, w: e.w })), closed: true };
}

/** 중심 c를 기준으로 a에서 b까지(직각) 도는 1/4 원호 */
function quarterArc(c: Pt, a: Pt, b: Pt): Seg {
  return { t: 'C', c1: add(a, mul(sub(b, c), KAPPA)), c2: add(b, mul(sub(a, c), KAPPA)), p: b };
}

// ───────────────────────── 획 → 윤곽 ─────────────────────────

interface SegGeom {
  cubic: Cubic;
  line: boolean;
  /** 양 끝 점의 굵기 배율 */
  w0: number;
  w1: number;
  /** 획 전체에서의 위치(0..1) */
  u0: number;
  u1: number;
}

function segGeoms(st: PathStroke): SegGeom[] {
  const raw: { cubic: Cubic; line: boolean; w0: number; w1: number }[] = [];
  let prev = st.start;
  let prevW = st.startW ?? 1;
  const push = (s: Seg) => {
    const cubic = s.t === 'L' ? lineAsCubic(prev, s.p) : { p0: prev, c1: s.c1, c2: s.c2, p3: s.p };
    const extent = Math.max(dist(prev, s.p), s.t === 'C' ? Math.max(dist(prev, s.c1), dist(prev, s.c2)) : 0);
    const w1 = s.w ?? 1;
    if (extent > 0.01) raw.push({ cubic, line: s.t === 'L', w0: prevW, w1 });
    prev = s.p;
    prevW = w1;
  };
  for (const s of st.segs) push(s);
  if (st.closed && dist(prev, st.start) > 0.01) push({ t: 'L', p: st.start, w: st.startW });
  const lens = raw.map((g) => (g.line ? dist(g.cubic.p0, g.cubic.p3) : cubicLength(g.cubic, 12)));
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return raw.map((g, i) => {
    const u0 = acc / total;
    acc += lens[i];
    return { ...g, u0, u1: acc / total };
  });
}

interface Ctx {
  s: StrokeStyle;
  closed: boolean;
  /** 획 전체 길이 */
  L: number;
  /** 획 끝 장식(폭 변화) */
  decoStart?: EndDeco;
  decoEnd?: EndDeco;
}

/**
 * 구간 g의 t 위치에서 한쪽 옆(side)의 반폭.
 *  - 끝 장식(부리·맺음·세리프)은 옆별 폭 변화로 더해진다
 *  - 곡선 안쪽은 곡률 반지름보다 두꺼워지지 않게 줄여 외곽선이 접히지 않게 한다
 */
function hwSide(g: SegGeom, t: number, tan: Pt, side: 1 | -1, ctx: Ctx): number {
  let hw = hwAt(g, t, tan, ctx);
  if (ctx.decoStart || ctx.decoEnd) {
    const u = g.u0 + (g.u1 - g.u0) * t;
    const extra = (ctx.decoStart?.bump(side, u * ctx.L) ?? 0) + (ctx.decoEnd?.bump(side, (1 - u) * ctx.L) ?? 0);
    hw *= 1 + extra;
  }
  if (!g.line) {
    const k = cubicCurvature(g.cubic, t);
    if (side * k > 1e-9) hw = Math.min(hw, 0.92 / Math.abs(k));
  }
  return hw;
}

/** 이 구간이 끝 장식의 영향을 받는지 */
function decorated(g: SegGeom, ctx: Ctx): boolean {
  return (!!ctx.decoStart && g.u0 * ctx.L < ctx.decoStart.reach) || (!!ctx.decoEnd && (1 - g.u1) * ctx.L < ctx.decoEnd.reach);
}

/** 구간 g의 t 위치 반폭 */
function hwAt(g: SegGeom, t: number, tan: Pt, ctx: Ctx): number {
  const u = g.u0 + (g.u1 - g.u0) * t;
  const p = ctx.closed ? ctx.s.pressureMid : pressureAt(u, ctx.s);
  const w = g.w0 + (g.w1 - g.w0) * t;
  return Math.max(0.5, (ctx.s.weight / 2) * dirFactor(tan, ctx.s) * w * p);
}

/** 굵기가 구간 안에서 변하는지(직선을 쪼개야 하는지) */
function widthVaries(g: SegGeom, ctx: Ctx): boolean {
  if (Math.abs(g.w0 - g.w1) > 1e-3) return true;
  if (ctx.closed) return false;
  const s = ctx.s;
  return Math.abs(pressureAt(g.u0, s) - pressureAt(g.u1, s)) > 1e-3 || Math.abs(pressureAt((g.u0 + g.u1) / 2, s) - pressureAt(g.u0, s)) > 1e-3;
}

function turningAngle(c: Cubic): number {
  let total = 0;
  let prev = cubicTangent(c, 0);
  for (let i = 1; i <= 12; i++) {
    const t = cubicTangent(c, i / 12);
    total += Math.acos(Math.max(-1, Math.min(1, dot(prev, t))));
    prev = t;
  }
  return total;
}

/**
 * 가장자리 곡선 E(t) = B(t) + 법선·반폭(t) 를 구간별 3차 에르미트 곡선으로 근사한다.
 * 굵기가 변해도(필압) 가장자리의 기울기가 정확히 반영된다.
 */
function offsetEdge(g: SegGeom, sign: 1 | -1, ctx: Ctx): Cubic[] {
  const c = g.cubic;
  const deco = decorated(g, ctx);
  const varies = deco || widthVaries(g, ctx);
  if (g.line && !varies) {
    const t0 = cubicTangent(c, 0);
    const n = mul(leftNormal(t0), sign);
    const a = add(c.p0, mul(n, hwSide(g, 0, t0, sign, ctx))), b = add(c.p3, mul(n, hwSide(g, 1, t0, sign, ctx)));
    return [lineAsCubic(a, b)];
  }
  const turns = g.line ? 0 : turningAngle(c);
  const segLen = g.line ? dist(c.p0, c.p3) : cubicLength(c, 12);
  // 장식이 있는 구간은 폭 변화를 따라가도록 잘게 나눈다
  const fine = deco ? Math.min(48, Math.max(6, Math.ceil(segLen / (ctx.s.weight * 0.3)))) : 0;
  const n = Math.max(varies ? 4 : 1, fine, Math.min(16, Math.ceil(turns / (Math.PI / 8))));
  const E = (t: number): Pt => {
    const tt = Math.min(1, Math.max(0, t));
    const tan = cubicTangent(c, tt);
    return add(cubicAt(c, tt), mul(leftNormal(tan), sign * hwSide(g, tt, tan, sign, ctx)));
  };
  const dE = (t: number): Pt => {
    const h = 1e-4;
    const a = Math.max(0, t - h), b = Math.min(1, t + h);
    return mul(sub(E(b), E(a)), 1 / (b - a));
  };
  const out: Cubic[] = [];
  for (let i = 0; i < n; i++) {
    const ta = i / n, tb = (i + 1) / n, k = (tb - ta) / 3;
    const A = E(ta), B = E(tb);
    out.push({ p0: A, c1: add(A, mul(dE(ta), k)), c2: sub(B, mul(dE(tb), k)), p3: B });
  }
  return out;
}

function pushCubics(segs: Seg[], cs: Cubic[], line: boolean) {
  for (const k of cs) segs.push(line ? { t: 'L', p: k.p3 } : { t: 'C', c1: k.c1, c2: k.c2, p: k.p3 });
}

function segmentBody(g: SegGeom, startEnd: EndSpec, endEnd: EndSpec, ctx: Ctx): Contour {
  const c = g.cubic;
  const t0 = cubicTangent(c, 0), t1 = cubicTangent(c, 1);
  const hw0 = hwAt(g, 0, t0, ctx), hw1 = hwAt(g, 1, t1, ctx);
  const left = offsetEdge(g, 1, ctx);
  const right = offsetEdge(g, -1, ctx);
  const straight = g.line && left.length === 1;
  const segs: Seg[] = [];
  const L0 = left[0].p0;
  pushCubics(segs, left, straight);
  const L1 = left[left.length - 1].p3;
  const R1 = right[right.length - 1].p3;
  appendEnd(segs, c.p3, t1, hw1, L1, R1, endEnd, ctx.s, 1);
  const rev = right.map((k) => ({ p0: k.p3, c1: k.c2, c2: k.c1, p3: k.p0 })).reverse();
  pushCubics(segs, rev, straight);
  const R0 = right[0].p0;
  appendEnd(segs, c.p0, mul(t0, -1), hw0, R0, L0, startEnd, ctx.s, -1);
  return { start: L0, segs };
}

/** 획 끝 모양: 기본 끝 모양 또는 장식의 자름선 */
type EndSpec = EndType | { cut: EndDeco };

/**
 * from에서 to까지 끝 모양을 그린다. out은 획 바깥쪽 방향.
 * fromSide: from 점이 놓인 옆(+1 왼쪽 / -1 오른쪽)
 */
function appendEnd(segs: Seg[], p: Pt, out: Pt, hw: number, from: Pt, to: Pt, spec: EndSpec, s: StrokeStyle, fromSide: 1 | -1) {
  if (typeof spec === 'object') {
    // 장식 끝: 옆마다 바깥으로 나가는 길이가 달라 비스듬한 자름선이 된다
    const toSide = (fromSide === 1 ? -1 : 1) as 1 | -1;
    const eFrom = spec.cut.ext[fromSide], eTo = spec.cut.ext[toSide];
    segs.push({ t: 'L', p: add(from, mul(out, eFrom)) }, { t: 'L', p: add(to, mul(out, eTo)) }, { t: 'L', p: to });
    return;
  }
  const type = spec;
  if (type === 'round') {
    const tip = add(p, mul(out, hw));
    segs.push(quarterArc(p, from, tip), quarterArc(p, tip, to));
    return;
  }
  if (type === 'soft') {
    // 반듯한 끝이되 두 모서리만 둥글린다(굵은 고딕의 부드러운 끝)
    const r = hw * 0.42;
    const across = sub(to, from);
    const al = Math.hypot(across.x, across.y) || 1;
    const u = { x: across.x / al, y: across.y / al };
    const a1 = add(from, mul(out, r)), a2 = add(a1, mul(u, r));
    const b1 = add(to, mul(out, r)), b2 = add(b1, mul(u, -r));
    segs.push(
      { t: 'C', c1: add(from, mul(out, r * KAPPA)), c2: add(a2, mul(u, -r * KAPPA)), p: a2 },
      { t: 'L', p: b2 },
      { t: 'C', c1: add(b2, mul(u, r * KAPPA)), c2: add(to, mul(out, r * KAPPA)), p: to },
    );
    return;
  }
  if (type === 'square') {
    segs.push({ t: 'L', p: add(from, mul(out, hw)) }, { t: 'L', p: add(to, mul(out, hw)) }, { t: 'L', p: to });
    return;
  }
  if (type === 'angled') {
    // 붓 각도(가장 가는 방향)를 따라 비스듬히 자른다
    const a = (s.penAngle * Math.PI) / 180;
    const d = { x: Math.cos(a), y: Math.sin(a) };
    const fa = lineIntersect(from, out, p, d);
    const ta = lineIntersect(to, out, p, d);
    // 가는 가로획에서 사선이 길게 늘어나 뾰족한 조각이 생기지 않도록 연장 길이를 제한한다
    if (fa && ta && dist(fa, from) < 1.3 * hw && dist(ta, to) < 1.3 * hw) {
      segs.push({ t: 'L', p: fa }, { t: 'L', p: ta }, { t: 'L', p: to });
      return;
    }
  }
  segs.push({ t: 'L', p: to });
}

function joinPatch(p: Pt, tin: Pt, tout: Pt, hwIn: number, hwOut: number, join: JoinStyle): Contour | null {
  const turn = cross(tin, tout);
  const outer = turn > 0 ? -1 : 1; // 왼쪽으로 꺾이면 바깥은 오른쪽
  const a = add(p, mul(leftNormal(tin), outer * hwIn));
  const b = add(p, mul(leftNormal(tout), outer * hwOut));
  if (join === 'miter') {
    const m = lineIntersect(a, tin, b, tout);
    if (m && dist(m, p) <= MITER_LIMIT * Math.max(hwIn, hwOut)) return orient(polygon([p, a, m, b]));
  }
  return orient(polygon([p, a, b]));
}

function dot0(st: PathStroke, s: StrokeStyle): Contour {
  const r = (s.weight / 2) * (st.startW ?? 1) * s.pressureMid;
  if (s.cap === 'round') return orient(ellipseContour(st.start, r, r));
  const p = st.start;
  const rh = r * dirFactor({ x: 1, y: 0 }, s), rv = r * dirFactor({ x: 0, y: 1 }, s);
  return orient(polygon([
    { x: p.x - rv, y: p.y - rh }, { x: p.x + rv, y: p.y - rh }, { x: p.x + rv, y: p.y + rh }, { x: p.x - rv, y: p.y + rh },
  ]));
}

interface EndDecos {
  start?: EndDeco;
  end?: EndDeco;
}

function strokeLength(geoms: SegGeom[]): number {
  return geoms.reduce((acc, g) => acc + (g.line ? dist(g.cubic.p0, g.cubic.p3) : cubicLength(g.cubic, 12)), 0);
}

function strokePath(st: PathStroke, s: StrokeStyle, decos: EndDecos = {}): Contour[] {
  const geoms = segGeoms(st);
  if (geoms.length === 0) return [dot0(st, s)];
  const closed = !!st.closed;
  const ctx: Ctx = { s, closed, L: strokeLength(geoms), decoStart: closed ? undefined : decos.start, decoEnd: closed ? undefined : decos.end };
  const n = geoms.length;
  const out: Contour[] = [];
  const smoothAt: boolean[] = [];
  for (let i = 0; i < n; i++) {
    if (i === n - 1 && !closed) {
      smoothAt.push(false);
      continue;
    }
    const next = geoms[(i + 1) % n];
    smoothAt.push(dot(cubicTangent(geoms[i].cubic, 1), cubicTangent(next.cubic, 0)) > 0.9995);
  }
  const joinEnd = (i: number): EndType => (smoothAt[i] ? 'flat' : s.join === 'round' ? 'round' : 'flat');
  const startCap: EndSpec = ctx.decoStart ? { cut: ctx.decoStart } : s.cap;
  const endCap: EndSpec = ctx.decoEnd ? { cut: ctx.decoEnd } : s.cap;
  for (let i = 0; i < n; i++) {
    const startEnd: EndSpec = i === 0 ? (closed ? joinEnd(n - 1) : startCap) : joinEnd(i - 1);
    const endEnd: EndSpec = i === n - 1 ? (closed ? joinEnd(n - 1) : endCap) : joinEnd(i);
    out.push(orient(segmentBody(geoms[i], startEnd, endEnd, ctx)));
  }
  if (s.join !== 'round') {
    const joins = closed ? n : n - 1;
    for (let i = 0; i < joins; i++) {
      if (smoothAt[i]) continue;
      const ga = geoms[i], gb = geoms[(i + 1) % n];
      const tin = cubicTangent(ga.cubic, 1), tout = cubicTangent(gb.cubic, 0);
      const patch = joinPatch(ga.cubic.p3, tin, tout, hwAt(ga, 1, tin, ctx), hwAt(gb, 0, tout, ctx), s.join);
      if (patch) out.push(patch);
    }
  }
  return out;
}

/** 열린 획의 두 끝 정보(장식 판단용) */
function pathEnds(st: PathStroke, s: StrokeStyle): StrokeEnd[] {
  if (st.closed) return [];
  const geoms = segGeoms(st);
  if (!geoms.length) return [];
  const ctx: Ctx = { s, closed: false, L: strokeLength(geoms) };
  const first = geoms[0], last = geoms[geoms.length - 1];
  const tStart = cubicTangent(first.cubic, 0), tEnd = cubicTangent(last.cubic, 1);
  const length = geoms.reduce((a, g) => a + (g.line ? dist(g.cubic.p0, g.cubic.p3) : cubicLength(g.cubic, 8)), 0);
  return [
    { p: first.cubic.p0, dir: tStart, hw: hwAt(first, 0, tStart, ctx), at: 'start', length, straight: first.line },
    { p: last.cubic.p3, dir: tEnd, hw: hwAt(last, 1, tEnd, ctx), at: 'end', length, straight: last.line },
  ];
}

/** 획 중심선을 점열로 */
function samplePath(st: PathStroke): Pt[] {
  const pts: Pt[] = [st.start];
  let prev = st.start;
  for (const g of st.segs) {
    if (g.t === 'L') pts.push(g.p);
    else {
      const c = { p0: prev, c1: g.c1, c2: g.c2, p3: g.p };
      for (let i = 1; i <= 8; i++) pts.push(cubicAt(c, i / 8));
    }
    prev = g.p;
  }
  if (st.closed) pts.push(st.start);
  return pts;
}

function distToPolyline(q: Pt, pts: Pt[]): number {
  if (pts.length === 1) return dist(q, pts[0]);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2));
    best = Math.min(best, dist(q, add(a, mul(ab, t))));
  }
  return best;
}

/**
 * 획들을 외곽선으로.
 * 장식(부리·맺음·세리프)은 다른 획에 붙어 있지 않은 "자유로운 끝"에만 붙이고,
 * 장식이 붙는 끝은 반듯하게 잘라 장식이 획 끝과 매끄럽게 이어지게 한다.
 */
export function strokesToContours(strokes: Stroke[], s: StrokeStyle): Contour[] {
  const out: Contour[] = [];
  const paths = strokes.map((st) => (st.kind === 'ellipse' ? ellipseAsPath(st) : st));
  const decos: EndDecos[] = paths.map(() => ({}));
  const styles: StrokeStyle[] = paths.map(() => s);
  const pressured = s.pressureStart !== s.pressureMid || s.pressureEnd !== s.pressureMid;
  if (s.serif !== 'none' || pressured) {
    const lines = paths.map(samplePath);
    paths.forEach((st, i) => {
      for (const end of pathEnds(st, s)) {
        const attached = lines.some((pts, j) => j !== i && distToPolyline(end.p, pts) <= s.weight * 0.55);
        if (attached) {
          // 다른 획에서 뻗어 나오거나 닿는 끝은 붓을 새로 누르거나 떼는 곳이 아니므로 필압을 주지 않는다
          styles[i] = { ...styles[i], [end.at === 'start' ? 'pressureStart' : 'pressureEnd']: s.pressureMid };
          continue;
        }
        const deco = endDecoration(end, s);
        if (deco) decos[i][end.at] = deco;
      }
    });
  }
  paths.forEach((st, i) => out.push(...strokePath(st, styles[i], decos[i])));
  return out;
}

/** 모든 윤곽을 기울인다(이탤릭). 기준선 y0를 중심으로 */
export function slantContours(cs: Contour[], deg: number, y0: number): Contour[] {
  if (!deg) return cs;
  const k = Math.tan((deg * Math.PI) / 180);
  const f = (p: Pt): Pt => ({ x: p.x + (p.y - y0) * k, y: p.y });
  return cs.map((c) => ({
    start: f(c.start),
    segs: c.segs.map((g) => (g.t === 'L' ? { t: 'L' as const, p: f(g.p) } : { t: 'C' as const, c1: f(g.c1), c2: f(g.c2), p: f(g.p) })),
  }));
}

export function contoursToSvgPath(contours: Contour[], digits = 1): string {
  const f = (n: number) => {
    const k = 10 ** digits;
    return String(Math.round(n * k) / k);
  };
  let d = '';
  for (const c of contours) {
    d += `M${f(c.start.x)} ${f(c.start.y)}`;
    for (const s of c.segs) {
      d += s.t === 'L'
        ? `L${f(s.p.x)} ${f(s.p.y)}`
        : `C${f(s.c1.x)} ${f(s.c1.y)} ${f(s.c2.x)} ${f(s.c2.y)} ${f(s.p.x)} ${f(s.p.y)}`;
    }
    d += 'Z';
  }
  return d;
}

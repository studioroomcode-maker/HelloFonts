import type { Contour, GlyphDef, GlyphOutline, LayoutDef, Params, Project, Pt, Rect, Role, Stroke } from './types';
import {
  bulOf, COMPOUND_VOWEL, decompose, DOUBLE_CONSONANT, isJamo, isVowelJamo, vowelClass,
  type LayoutKey,
} from './hangul';
import { resolveJamoKey, type JamoCtx, type Scope } from './project';
import { slantContours, stemHalfWidths, strokesToContours } from './outline';
import { strokeStyle, stylizeStrokes } from './style';
import { balanceSyllable, type Balance } from './balance';

export interface EmBox {
  x0: number;
  x1: number;
  yTop: number;
  yBottom: number;
}

export interface Placement {
  /** 뼈대가 그려지는 자모(겹자모라면 구성 자모) */
  jamo: string;
  /** 음절 속 자리에 들어간 원래 자모(ㄲ, ㅘ 등) */
  owner: string;
  role: Role;
  part: number | null;
  ctx: JamoCtx;
  key: string | null;
  scope: Scope | null;
  slot: EmBox;
  box: EmBox;
  toEm: (p: Pt) => Pt;
  fromEm: (p: Pt) => Pt;
  skeleton: Stroke[];
  strokes: Stroke[];
  /** 이미지에서 따 온 외곽선 자모(폰트 좌표) */
  outline?: Contour[];
}

export interface Composition {
  kind: 'hangul' | 'latin' | 'space';
  ch: string;
  advance: number;
  placements: Placement[];
  cell?: EmBox;
  layout?: LayoutKey;
  /** 자모 조합과 별도로 그대로 쓰는 외곽선(이미지에서 따 온 음절·라틴 글자) */
  extraOutline?: Contour[];
}

function mapContours(cs: Contour[], f: (p: Pt) => Pt): Contour[] {
  return cs.map((c) => ({
    start: f(c.start),
    segs: c.segs.map((g) => (g.t === 'L' ? { t: 'L' as const, p: f(g.p) } : { t: 'C' as const, c1: f(g.c1), c2: f(g.c2), p: f(g.p) })),
  }));
}

// ───────────────────────── 좌표 변환 ─────────────────────────

function cellBox(p: Params): EmBox {
  return { x0: p.hangulSide, x1: p.hangulAdvance - p.hangulSide, yTop: p.hangulTop, yBottom: p.hangulBottom };
}

export function fracToEm(cell: EmBox, r: Rect): EmBox {
  const w = cell.x1 - cell.x0, h = cell.yTop - cell.yBottom;
  return { x0: cell.x0 + r.x0 * w, x1: cell.x0 + r.x1 * w, yTop: cell.yTop - r.y0 * h, yBottom: cell.yTop - r.y1 * h };
}

/** 필압이 1보다 크면 획이 그만큼 굵어지므로 여유를 더 둔다 */
function maxPressure(p: Params) {
  return Math.max(1, p.pressureStart, p.pressureMid, p.pressureEnd);
}

/** 자리(slot)에서 획 반폭 + 간격/2 만큼 안쪽이 뼈대 상자 */
export function inset(b: EmBox, p: Params): EmBox {
  const half = stemHalfWidths(p);
  const mp = maxPressure(p);
  const ix = half.v * mp + p.gap / 2;
  const iy = half.h * mp + p.gap / 2;
  let { x0, x1, yTop, yBottom } = b;
  x0 += ix; x1 -= ix; yTop -= iy; yBottom += iy;
  // 굵은 글꼴의 좁은 칸(ㅃ의 반쪽 등)에서 뼈대 상자가 찌그러져 기둥이 한 막대로 겹치지 않도록
  // 칸의 45%는 남긴다 — 넘치는 획은 음절 단위 간격 맞추기가 밀어내고 가늘게 한다
  const minW = Math.max(4, (b.x1 - b.x0) * 0.45), minH = Math.max(4, (b.yTop - b.yBottom) * 0.45);
  if (x1 - x0 < minW) { const m = (b.x0 + b.x1) / 2; x0 = m - minW / 2; x1 = m + minW / 2; }
  if (yTop - yBottom < minH) { const m = (b.yTop + b.yBottom) / 2; yTop = m + minH / 2; yBottom = m - minH / 2; }
  return { x0, x1, yTop, yBottom };
}

export function boxMaps(b: EmBox) {
  const sx = (b.x1 - b.x0) / 100, sy = (b.yTop - b.yBottom) / 100;
  return {
    sx, sy,
    toEm: (p: Pt): Pt => ({ x: b.x0 + p.x * sx, y: b.yTop - p.y * sy }),
    fromEm: (p: Pt): Pt => ({ x: (p.x - b.x0) / sx, y: (b.yTop - p.y) / sy }),
  };
}

/** 뼈대 좌표 → 폰트 좌표. 원의 반지름은 변환된 점으로 잰다(음절 획 간격 맞추기의 비선형 변환에도 맞도록) */
function mapStrokes(strokes: Stroke[], toEm: (p: Pt) => Pt, ieung = false, wf = 1): Stroke[] {
  const W = (w: number | undefined) => (wf === 1 ? w : (w ?? 1) * wf);
  return strokes.map((s): Stroke => {
    if (s.kind === 'ellipse') {
      const c = toEm(s.c);
      const l = toEm({ x: s.c.x - s.rx, y: s.c.y }), r = toEm({ x: s.c.x + s.rx, y: s.c.y });
      const t = toEm({ x: s.c.x, y: s.c.y - s.ry }), b = toEm({ x: s.c.x, y: s.c.y + s.ry });
      let rx = Math.abs(r.x - l.x) / 2, ry = Math.abs(t.y - b.y) / 2;
      const k = s.keep ?? 0;
      if (k > 0) {
        const m = Math.min(rx, ry);
        rx += (m - rx) * k;
        ry += (m - ry) * k;
      }
      return { kind: 'ellipse', c: { x: (l.x + r.x) / 2, y: (t.y + b.y) / 2 }, rx, ry, ieung, ...(wf !== 1 ? { w: wf } : {}) };
    }
    return {
      kind: 'path',
      closed: s.closed,
      start: toEm(s.start),
      startW: W(s.startW),
      segs: s.segs.map((g) => (g.t === 'L' ? { ...g, p: toEm(g.p), w: W(g.w) } : { ...g, c1: toEm(g.c1), c2: toEm(g.c2), p: toEm(g.p), w: W(g.w) })),
    };
  });
}

function makePlacement(
  project: Project, jamo: string, owner: string, role: Role, part: number | null,
  ctx: JamoCtx, slot: EmBox,
): Placement {
  const found = resolveJamoKey(project.glyphs, jamo, role, ctx);
  const box = inset(slot, project.params);
  const m = boxMaps(box);
  const def = found ? project.glyphs[found.key] : undefined;
  const skeleton = def && !def.outline ? def.strokes : [];
  const outline = def?.outline
    ? mapContours(def.outline, (q) => ({ x: slot.x0 + (q.x / 100) * (slot.x1 - slot.x0), y: slot.yTop - (q.y / 100) * (slot.yTop - slot.yBottom) }))
    : undefined;
  return {
    jamo, owner, role, part, ctx, slot, box,
    key: found?.key ?? null,
    scope: found?.scope ?? null,
    toEm: m.toEm,
    fromEm: m.fromEm,
    skeleton,
    strokes: mapStrokes(skeleton, m.toEm, jamo === 'ㅇ'),
    outline,
  };
}

// ───────────────────────── 음절 획 간격 맞추기 ─────────────────────────

/** 음절 전체의 획 간격 맞추기 결과를 자모 배치에 입힌다(편집 화면의 좌표 변환도 같이) */
function applyBalance(pl: Placement, bal: Balance, i: number): Placement {
  if (!pl.skeleton.length) return pl;
  const warp = (q: Pt): Pt => ({ x: bal.wx.fwd(q.x), y: bal.wy.fwd(q.y) });
  const toEm = (q: Pt) => warp(pl.toEm(q));
  const fromEm = (e: Pt) => pl.fromEm({ x: bal.wx.inv(e.x), y: bal.wy.inv(e.y) });
  const wb = (b: EmBox): EmBox => ({ x0: bal.wx.fwd(b.x0), x1: bal.wx.fwd(b.x1), yTop: bal.wy.fwd(b.yTop), yBottom: bal.wy.fwd(b.yBottom) });
  return { ...pl, toEm, fromEm, box: wb(pl.box), slot: wb(pl.slot), strokes: mapStrokes(pl.skeleton, toEm, pl.jamo === 'ㅇ', bal.factor[i]) };
}

function balanced(project: Project, out: Placement[], cell: EmBox): Placement[] {
  const p = project.params;
  if (!out.length) return out;
  const half = stemHalfWidths(p), mp = maxPressure(p);
  // 배치 틀이 정한 자모 칸들의 범위 안에서만 옮긴다(다른 음절과 바깥선이 맞도록, 칸 끝에서 자모 간격 절반 안쪽)
  const g = p.gap / 2;
  const slots = out.map((pl) => pl.slot);
  const inner: EmBox = {
    x0: Math.max(cell.x0, Math.min(...slots.map((b) => b.x0))) + g,
    x1: Math.min(cell.x1, Math.max(...slots.map((b) => b.x1))) - g,
    yTop: Math.min(cell.yTop, Math.max(...slots.map((b) => b.yTop))) - g,
    yBottom: Math.max(cell.yBottom, Math.min(...slots.map((b) => b.yBottom))) + g,
  };
  const bal = balanceSyllable(out, inner, p, { h: half.h * mp, v: half.v * mp });
  return bal ? out.map((pl, i) => applyBalance(pl, bal, i)) : out;
}

function splitH(b: EmBox, ratio: number): [EmBox, EmBox] {
  const mid = b.x0 + (b.x1 - b.x0) * ratio;
  return [{ ...b, x1: mid }, { ...b, x0: mid }];
}

function placeConsonant(project: Project, jamo: string, role: Role, ctx: JamoCtx, slot: EmBox, out: Placement[]) {
  const whole = resolveJamoKey(project.glyphs, jamo, role, ctx);
  const parts = DOUBLE_CONSONANT[jamo];
  if (whole || !parts) {
    out.push(makePlacement(project, jamo, jamo, role, null, ctx, slot));
    return;
  }
  const halves = splitH(slot, project.pairRatio?.[jamo] ?? 0.5);
  parts.forEach((pj, i) => out.push(makePlacement(project, pj, jamo, role, i, ctx, halves[i])));
}

function placeVowel(project: Project, jamo: string, ctx: JamoCtx, slots: { jung: EmBox; jungH?: EmBox; jungV?: EmBox }, out: Placement[]) {
  const whole = resolveJamoKey(project.glyphs, jamo, 'jung', ctx);
  const parts = COMPOUND_VOWEL[jamo];
  if (whole || !parts || !slots.jungH || !slots.jungV) {
    out.push(makePlacement(project, jamo, jamo, 'jung', null, ctx, slots.jung));
    return;
  }
  out.push(makePlacement(project, parts[0], jamo, 'jung', 0, ctx, slots.jungH));
  out.push(makePlacement(project, parts[1], jamo, 'jung', 1, ctx, slots.jungV));
}

/** 배치 틀 키: 음절 전용('!각') → 모음 전용('Ho_F:ㅡ') → 기본('Ho_F') 순서로 찾는다 */
export function layoutKeyFor(project: Project, ch: string, layout: LayoutKey, jung: string): string {
  if (project.layouts[`!${ch}`]) return `!${ch}`;
  if (project.layouts[`${layout}:${jung}`]) return `${layout}:${jung}`;
  return layout;
}

export function layoutFor(project: Project, ch: string, layout: LayoutKey, jung = ''): LayoutDef {
  return project.layouts[layoutKeyFor(project, ch, layout, jung)];
}

// ───────────────────────── 한글 ─────────────────────────

export function composeHangul(project: Project, ch: string): Composition | null {
  const d = decompose(ch);
  if (!d) return null;
  const p = project.params;
  const cell = cellBox(p);
  // 이미지에서 따 온 음절은 원본 외곽선을 그대로 쓴다
  const syl = project.glyphs[`syl:${ch}`];
  if (syl?.outline) return { kind: 'hangul', ch, advance: syl.width ?? p.hangulAdvance, placements: [], cell, layout: d.layout, extraOutline: syl.outline };
  const L = layoutFor(project, ch, d.layout, d.jung);
  const out: Placement[] = [];
  const ctx = (bul: string): JamoCtx => ({ layout: d.layout, bul, syllable: ch });
  placeConsonant(project, d.cho, 'cho', ctx(d.bul.cho), fracToEm(cell, L.cho), out);
  placeVowel(project, d.jung, ctx(d.bul.jung), {
    jung: fracToEm(cell, L.jung),
    jungH: L.jungH && fracToEm(cell, L.jungH),
    jungV: L.jungV && fracToEm(cell, L.jungV),
  }, out);
  if (d.jong && L.jong) placeConsonant(project, d.jong, 'jong', ctx(d.bul.jong), fracToEm(cell, L.jong), out);
  return { kind: 'hangul', ch, advance: p.hangulAdvance, placements: balanced(project, out, cell), cell, layout: d.layout };
}

/** 낱자(ㄱ, ㅏ …)를 한 칸에 단독으로 */
function composeSoloJamo(project: Project, ch: string): Composition {
  const p = project.params;
  const cell = cellBox(p);
  const out: Placement[] = [];
  const r = (x0: number, y0: number, x1: number, y1: number) => fracToEm(cell, { x0, y0, x1, y1 });
  if (!isVowelJamo(ch)) {
    placeConsonant(project, ch, 'cho', { layout: 'Ho', bul: bulOf('cho', ch, 'ㅗ', false) }, r(0.12, 0.1, 0.88, 0.9), out);
  } else {
    const cls = vowelClass(ch);
    const ctx: JamoCtx = { layout: cls, bul: 'b1' };
    const slots =
      cls === 'V' || cls === 'VL' || cls === 'VV' ? { jung: r(0.22, 0, 0.82, 1) }
      : cls === 'Ho' || cls === 'Hu' ? { jung: r(0, 0.15, 1, 0.85) }
      : { jung: r(0, 0, 1, 1), jungH: r(0, 0.3, 0.7, 0.95), jungV: r(0.7, 0, 1, 1) };
    placeVowel(project, ch, ctx, slots, out);
  }
  return { kind: 'hangul', ch, advance: p.hangulAdvance, placements: out, cell };
}

// ───────────────────────── 라틴 ─────────────────────────

/** 기본 데이터가 가정하는 세로 기준값 */
const SRC_BANDS = [-200, 0, 500, 700, 740];

function latinYMap(p: Params) {
  const hv = stemHalfWidths(p).h * maxPressure(p);
  const dst = [p.descender + hv, hv, p.xHeight - hv, p.capHeight - hv, p.ascender - hv];
  const fwd = (y: number) => piecewise(y, SRC_BANDS, dst);
  const inv = (y: number) => piecewise(y, dst, SRC_BANDS);
  return { fwd, inv };
}

function piecewise(v: number, xs: number[], ys: number[]): number {
  let i = 0;
  if (v >= xs[xs.length - 1]) i = xs.length - 2;
  else while (i < xs.length - 2 && v > xs[i + 1]) i++;
  const t = (v - xs[i]) / (xs[i + 1] - xs[i] || 1);
  return ys[i] + (ys[i + 1] - ys[i]) * t;
}

export function latinScaleX(p: Params) {
  return p.latinWidthScale * (p.capHeight / 700);
}

export function composeLatin(project: Project, ch: string, def: GlyphDef): Composition {
  const p = project.params;
  if (def.outline) {
    const dx = p.latinSide;
    return {
      kind: 'latin', ch, advance: Math.round((def.width ?? 0) + p.latinSide * 2), placements: [],
      extraOutline: mapContours(def.outline, (q) => ({ x: q.x + dx, y: q.y })),
    };
  }
  const sx = latinScaleX(p);
  const hv = stemHalfWidths(p).v * maxPressure(p);
  const x0 = p.latinSide + hv;
  const ym = latinYMap(p);
  const toEm = (q: Pt): Pt => ({ x: x0 + q.x * sx, y: ym.fwd(q.y) });
  const fromEm = (q: Pt): Pt => ({ x: (q.x - x0) / sx, y: ym.inv(q.y) });
  const strokes = def.strokes.map((s): Stroke => {
    if (s.kind === 'ellipse') {
      const top = ym.fwd(s.c.y + s.ry), bottom = ym.fwd(s.c.y - s.ry);
      return { kind: 'ellipse', c: { x: x0 + s.c.x * sx, y: (top + bottom) / 2 }, rx: s.rx * sx, ry: (top - bottom) / 2 };
    }
    return mapStrokes([s], toEm)[0];
  });
  const width = def.width ?? 0;
  const advance = Math.round(p.latinSide * 2 + hv * 2 + width * sx);
  const box: EmBox = { x0, x1: x0 + width * sx, yTop: p.capHeight, yBottom: 0 };
  return {
    kind: 'latin',
    ch,
    advance,
    placements: [{
      jamo: ch, owner: ch, role: 'cho', part: null, ctx: { layout: 'V', bul: 'b1' },
      key: ch, scope: 'base', slot: box, box, toEm, fromEm, skeleton: def.strokes, strokes,
    }],
  };
}

// ───────────────────────── 공통 진입점 ─────────────────────────

export function composeChar(project: Project, ch: string): Composition | null {
  if (ch === ' ') return { kind: 'space', ch, advance: project.params.spaceWidth, placements: [] };
  const hangul = composeHangul(project, ch);
  if (hangul) return hangul;
  if (isJamo(ch)) return composeSoloJamo(project, ch);
  const def = project.glyphs[ch];
  if (def && def.kind === 'latin') return composeLatin(project, ch, def);
  return null;
}

/** 이탤릭·흔들림 회전의 기준 */
function styleCenter(project: Project, comp: Composition): Pt {
  const p = project.params;
  if (comp.kind === 'hangul') return { x: comp.advance / 2, y: (p.hangulTop + p.hangulBottom) / 2 };
  return { x: comp.advance / 2, y: p.xHeight / 2 };
}

const SLANT_ORIGIN = 330;

/** 뼈대 목록(폰트 단위)에 스타일을 입혀 외곽선으로 */
export function renderStrokes(project: Project, comp: Composition, strokes: Stroke[], strokeOffset = 0): Contour[] {
  const p = project.params;
  const latin = comp.kind === 'latin';
  const center = styleCenter(project, comp);
  const styled = stylizeStrokes(strokes, p, { ch: comp.ch, latin, center, strokeOffset });
  const contours = strokesToContours(styled, strokeStyle(p, latin, center.y));
  return slantContours(contours, p.slant, SLANT_ORIGIN);
}

export function compositionContours(project: Project, comp: Composition): Contour[] {
  const stroked = renderStrokes(project, comp, comp.placements.flatMap((pl) => pl.strokes));
  const traced = [...comp.placements.flatMap((pl) => pl.outline ?? []), ...(comp.extraOutline ?? [])];
  return traced.length ? [...stroked, ...traced] : stroked;
}

/** 자모 하나만 그린 외곽선(편집 화면 강조용) — 전체 글자와 같은 흔들림을 쓴다 */
export function placementContours(project: Project, comp: Composition, pl: Placement): Contour[] {
  if (pl.outline) return pl.outline;
  let offset = 0;
  for (const q of comp.placements) {
    if (q === pl) break;
    offset += q.strokes.length;
  }
  return renderStrokes(project, comp, pl.strokes, offset);
}

const cache = new WeakMap<Project, Map<string, GlyphOutline | null>>();

export function glyphOutline(project: Project, ch: string): GlyphOutline | null {
  let m = cache.get(project);
  if (!m) {
    m = new Map();
    cache.set(project, m);
  }
  if (m.has(ch)) return m.get(ch)!;
  const comp = composeChar(project, ch);
  const res = comp ? { contours: compositionContours(project, comp), advance: comp.advance } : null;
  m.set(ch, res);
  return res;
}

/** 폰트에 들어갈 라틴/기호 문자 목록 */
export function latinChars(project: Project): string[] {
  return Object.entries(project.glyphs)
    .filter(([, g]) => g.kind === 'latin')
    .map(([k]) => k);
}

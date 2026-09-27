import type { Contour, LayoutDef, Project, Pt, Rect, Role } from '../types';
import { distanceTransform, removeSpecks } from '../handwriting/raster';
import { vectorizeMask } from '../handwriting/scan';
import type { InkLine } from '../handwriting/fit';
import { composeChar, type EmBox } from '../compose';
import { decompose, layoutGroup, type LayoutKey } from '../hangul';
import { cropScale, splitGlyphs, subMask, textMask, type Box, type RGBA } from './image';
import { traceOutline, type Field, type TraceOptions } from './contour';

/**
 * 이미지 속 글씨체로 글꼴 만들기(외곽선 방식).
 *  1. 낱말을 글자로 자르고, 글자마다 중심선(뼈대)을 딴다
 *  2. 뼈대 픽셀마다 배치 틀의 자모 칸을 기준으로 자모를 정하고(비터비),
 *     잉크 픽셀은 가장 가까운 뼈대의 자모를 따른다(잉크 안에서만 퍼지는 거리)
 *  3. 자모별 잉크 범위로 배치 틀을 학습한다 — 2와 3을 번갈아 되풀이
 *  4. 글자 전체와 자모별 외곽선을 등고선으로 따 온다
 *     - 이미지에 있던 음절은 원본 외곽선 그대로('syl:클')
 *     - 나머지 음절은 자모 외곽선을 학습한 배치 틀에 넣어 조합
 */

export interface WordSample {
  text: string;
  box: Box;
}

export interface GlyphSample {
  ch: string;
  word: number;
  kind: 'hangul' | 'latin';
  lines: InkLine[];
  /** lines와 같은 순서의 픽셀 좌표 */
  pixels: { x: number; y: number }[][];
  field: Field;
  toEm: (x: number, y: number) => Pt;
  /** 픽셀 하나의 폰트 단위 크기 */
  emPerPx: number;
  /** 원본 한 픽셀 = 늘린 이미지의 몇 픽셀 */
  scale: number;
  /** 잉크 폭(폰트 단위) */
  inkW: number;
  /** 이웃 글자와의 틈 절반(폰트 단위). 낱말 끝·띄어쓰기 쪽은 NaN */
  gapL: number;
  gapR: number;
}

const isHangul = (ch: string) => {
  const c = ch.codePointAt(0) ?? 0;
  return c >= 0xac00 && c <= 0xd7a3;
};
const DESCENDERS = new Set([...'gjpqy,;']);
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

/**
 * 낱말 상자의 왼쪽·오른쪽 끝에 닿은 작은 잉크 덩어리(옆 그림·리본 조각 등)를 지운다.
 * 글자는 보통 상자 안쪽에 있고, 닿더라도 큰 덩어리라 남는다.
 */
function dropBorderPieces(m: { w: number; h: number; data: Uint8Array }, field: Float32Array) {
  const { w, h, data } = m;
  const seen = new Uint8Array(w * h);
  let total = 0;
  for (let i = 0; i < w * h; i++) total += data[i];
  for (let i = 0; i < w * h; i++) {
    if (!data[i] || seen[i]) continue;
    const comp: number[] = [i];
    seen[i] = 1;
    let border = false;
    for (let qi = 0; qi < comp.length; qi++) {
      const k = comp[qi], x = k % w, y = (k / w) | 0;
      if (x === 0 || x === w - 1) border = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nk = ny * w + nx;
        if (data[nk] && !seen[nk]) { seen[nk] = 1; comp.push(nk); }
      }
    }
    if (!border || comp.length > total * 0.25) continue;
    // 덩어리와 그 둘레(흐린 가장자리)까지 지운다
    for (const k of comp) {
      const x = k % w, y = (k / w) | 0;
      data[k] = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && !data[ny * w + nx]) field[ny * w + nx] = 0;
      }
      field[k] = 0;
    }
  }
}

/** 낱말들을 읽어 글자별 획·등고선 재료로 */
export function readWords(img: RGBA, words: WordSample[], project: Project, pitches: number[] = []): GlyphSample[] {
  const p = project.params;
  const out: GlyphSample[] = [];
  words.forEach((word, wi) => {
    const hPx = word.box.y1 - word.box.y0;
    const scale = Math.max(1, Math.min(10, 220 / hPx));
    // 좌우로 조금 넓혀 끝 글자가 상자 끝에 닿지 않게 한다(닿은 조각은 다른 그림으로 보고 지우므로)
    const crop = cropScale(img, { ...word.box, x0: Math.max(0, word.box.x0 - 2), x1: Math.min(img.w, word.box.x1 + 2) }, scale);
    const { mask: raw, field } = textMask(crop, scale);
    const mask = removeSpecks(raw, Math.round(6 * scale));
    dropBorderPieces(mask, field);
    const cuts = splitGlyphs(mask, word.text);
    const han = cuts.filter((c) => isHangul(c.ch));
    const lat = cuts.filter((c) => !isHangul(c.ch));
    const top = han.length ? Math.min(...han.map((c) => c.box.y0)) : 0;
    const bottom = han.length ? Math.max(...han.map((c) => c.box.y1)) : 1;
    const hs = (p.hangulTop - p.hangulBottom) / Math.max(1, bottom - top);
    const caps = lat.filter((c) => /[A-Z0-9!?]/.test(c.ch));
    const capTop = caps.length ? median(caps.map((c) => c.box.y0)) : lat.length ? Math.min(...lat.map((c) => c.box.y0)) : 0;
    const base = lat.filter((c) => !DESCENDERS.has(c.ch)).map((c) => c.box.y1);
    const baseline = base.length ? median(base) : lat.length ? Math.max(...lat.map((c) => c.box.y1)) : 1;
    // 한글과 한 낱말에 있는 라틴·숫자·기호는 한글과 같은 비율·높이로 옮겨 원본의 크기 관계를 지킨다
    const withHangul = han.length > 0;
    const ls = withHangul ? hs : p.capHeight / Math.max(1, baseline - capTop);
    // 붙어 있는 한글 글자 사이의 중심 거리 = 원본의 글자 칸 폭
    const at = [...word.text].map((c, i) => (c === ' ' ? -1 : i)).filter((i) => i >= 0);
    /** cuts[i]와 cuts[i+1]이 띄어쓰기 없이 붙은 글자인지 */
    const adjacent = (i: number) => cuts.length === at.length && at[i + 1] === at[i] + 1;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i], b = cuts[i + 1];
      if (!isHangul(a.ch) || !isHangul(b.ch) || !adjacent(i)) continue;
      pitches.push((((b.box.x0 + b.box.x1) - (a.box.x0 + a.box.x1)) / 2) * hs);
    }

    cuts.forEach((c, ci) => {
      const { mask: m, ox, oy } = subMask(mask, c.box, 3);
      // 같은 범위의 글자다움 값(글자 경계 밖은 0)
      const f = new Float32Array(m.w * m.h);
      for (let y = 0; y < m.h; y++) {
        for (let x = 0; x < m.w; x++) {
          const sx = ox + x, sy = oy + y;
          if (sx >= c.box.x0 && sx < c.box.x1) f[y * m.w + x] = field[sy * crop.w + sx];
        }
      }
      const hangul = isHangul(c.ch);
      const s = hangul ? hs : ls;
      const gcx = (c.box.x0 + c.box.x1) / 2;
      const toEm = hangul
        ? (x: number, y: number): Pt => ({ x: project.params.hangulAdvance / 2 + (ox + x + 0.5 - gcx) * hs, y: p.hangulTop - (oy + y + 0.5 - top) * hs })
        : withHangul
          ? (x: number, y: number): Pt => ({ x: (ox + x + 0.5 - c.box.x0) * ls, y: p.hangulTop - (oy + y + 0.5 - top) * hs })
          : (x: number, y: number): Pt => ({ x: (ox + x + 0.5 - c.box.x0) * ls, y: (baseline - (oy + y + 0.5)) * ls });
      const v = vectorizeMask(m, toEm, s);
      out.push({
        ch: c.ch, word: wi, kind: hangul ? 'hangul' : 'latin',
        lines: v.lines, pixels: v.pixels, field: { w: m.w, h: m.h, v: f }, toEm, emPerPx: s, scale,
        inkW: (c.box.x1 - c.box.x0) * s,
        gapL: ci > 0 && adjacent(ci - 1) ? ((c.box.x0 - cuts[ci - 1].box.x1) / 2) * s : NaN,
        gapR: ci + 1 < cuts.length && adjacent(ci) ? ((cuts[ci + 1].box.x0 - c.box.x1) / 2) * s : NaN,
      });
    });
  });
  return out;
}

// ───────────────────────── 자모별 잉크 나누기 ─────────────────────────

type SlotName = 'cho' | 'jung' | 'jungH' | 'jungV' | 'jong';
const CODE: Record<SlotName, number> = { cho: 1, jung: 2, jungH: 2, jungV: 3, jong: 4 };

interface SlotBox {
  code: number;
  box: EmBox;
}

/** 음절을 지금 배치 틀로 조합했을 때 자모 자리들(겹자음 조각은 합친다). 이미지 음절 외곽선은 빼고 조합 */
function slotBoxes(project: Project, ch: string): SlotBox[] {
  const saved = project.glyphs[`syl:${ch}`];
  delete project.glyphs[`syl:${ch}`];
  const comp = composeChar(project, ch);
  if (saved) project.glyphs[`syl:${ch}`] = saved;
  if (!comp) return [];
  const union = (bs: EmBox[]): EmBox => ({
    x0: Math.min(...bs.map((b) => b.x0)), x1: Math.max(...bs.map((b) => b.x1)),
    yTop: Math.max(...bs.map((b) => b.yTop)), yBottom: Math.min(...bs.map((b) => b.yBottom)),
  });
  const out: SlotBox[] = [];
  const of = (role: Role) => comp.placements.filter((q) => q.role === role);
  if (of('cho').length) out.push({ code: CODE.cho, box: union(of('cho').map((q) => q.slot)) });
  const jung = of('jung');
  if (jung.length === 2 && jung[0].part === 0 && jung[1].part === 1) {
    out.push({ code: CODE.jungH, box: jung[0].slot }, { code: CODE.jungV, box: jung[1].slot });
  } else if (jung.length) out.push({ code: CODE.jung, box: union(jung.map((q) => q.slot)) });
  if (of('jong').length) out.push({ code: CODE.jong, box: union(of('jong').map((q) => q.slot)) });
  return out;
}

/**
 * 뼈대 픽셀마다 자모를 정한다. 각 픽셀은 가까운(칸 중심 기준으로 정규화한 거리) 자모 칸을 좋아하고,
 * 한 선 안에서 자모가 바뀔 때마다 벌점을 받는다(비터비). 선 하나가 두 자모에 걸쳐 있어도
 * 가장 그럴듯한 곳에서 나뉜다.
 */
function labelSkeleton(s: GlyphSample, slots: SlotBox[]): Map<number, number> {
  const seeds = new Map<number, number>();
  if (!slots.length) return seeds;
  const cost = (x: number, y: number) => {
    const e = s.toEm(x, y);
    return slots.map(({ box: b }) => {
      const cx = (b.x0 + b.x1) / 2, cy = (b.yTop + b.yBottom) / 2;
      const hw = Math.max(1, (b.x1 - b.x0) / 2), hh = Math.max(1, (b.yTop - b.yBottom) / 2);
      return Math.max(Math.abs(e.x - cx) / hw, Math.abs(e.y - cy) / hh);
    });
  };
  const SWITCH = 2.5 * s.scale;
  s.pixels.forEach((ps) => {
    if (!ps?.length) return;
    const n = ps.length, K = slots.length;
    const acc: Float64Array[] = [];
    const back: Int8Array[] = [];
    let prev = Float64Array.from(cost(ps[0].x, ps[0].y));
    acc.push(prev);
    back.push(new Int8Array(K));
    for (let i = 1; i < n; i++) {
      const c = cost(ps[i].x, ps[i].y);
      const cur = new Float64Array(K), bk = new Int8Array(K);
      for (let k = 0; k < K; k++) {
        let best = Infinity, bi = 0;
        for (let j = 0; j < K; j++) {
          const v = prev[j] + (j === k ? 0 : SWITCH);
          if (v < best) { best = v; bi = j; }
        }
        cur[k] = best + c[k];
        bk[k] = bi;
      }
      acc.push(cur);
      back.push(bk);
      prev = cur;
    }
    let k = 0;
    for (let j = 1; j < K; j++) if (prev[j] < prev[k]) k = j;
    for (let i = n - 1; i >= 0; i--) {
      seeds.set(ps[i].y * s.field.w + ps[i].x, slots[k].code);
      k = back[i][k];
    }
  });
  return seeds;
}

/**
 * 잉크 픽셀마다 자모 번호를 붙인다. 뼈대 픽셀에서 출발해 잉크 안으로만 퍼져 나가므로(측지 거리),
 * 서로 붙어 쓴 자모도 획을 따라 나뉜다. 뼈대에서 잘려 나간 짧은 획의 잉크도 제 자모로 돌아간다.
 */
export function labelInk(s: GlyphSample, seeds: Map<number, number>): Uint8Array {
  const { w, h, v } = s.field;
  const label = new Uint8Array(w * h);
  const queue: number[] = [];
  for (const [k, code] of seeds) {
    label[k] = code;
    queue.push(k);
  }
  // 1) 진한 잉크(0.5 이상) 안에서만 퍼진다 → 옆 자모의 번진 가장자리를 타고 넘어가지 않는다
  // 2) 번진 가장자리(0 < 값 < 0.5)는 가장 가까운 잉크의 자모를 따른다
  const spread = (min: number) => {
    for (let qi = 0; qi < queue.length; qi++) {
      const k = queue[qi], x = k % w, y = (k / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nk = ny * w + nx;
          if (label[nk] || v[nk] < min) continue;
          label[nk] = label[k];
          queue.push(nk);
        }
      }
    }
  };
  spread(0.5);
  queue.length = 0;
  for (let k = 0; k < w * h; k++) if (label[k]) queue.push(k);
  spread(1e-3);
  return label;
}

// ───────────────────────── 배치 틀 학습 ─────────────────────────

/** 같은 계열 배치 틀 — 관찰이 없는 틀을 채울 때 쓴다 */
const FAMILY: Record<string, string[]> = {
  V: ['VL', 'VV'], VL: ['V', 'VV'], VV: ['V', 'VL'],
  Ho: ['Hu'], Hu: ['Ho'],
  Co: ['Cu', 'CCo', 'CCu'], Cu: ['Co', 'CCu', 'CCo'], CCo: ['CCu', 'Co', 'Cu'], CCu: ['CCo', 'Cu', 'Co'],
};

function inkBox(s: GlyphSample, label: Uint8Array, code: number) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const { w, h, v } = s.field;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (label[k] !== code || v[k] < 0.5) continue;
      const e = s.toEm(x, y);
      x0 = Math.min(x0, e.x); x1 = Math.max(x1, e.x); y0 = Math.min(y0, e.y); y1 = Math.max(y1, e.y);
    }
  }
  const pad = s.emPerPx / 2;
  return x0 === Infinity ? null : { x0: x0 - pad, x1: x1 + pad, y0: y0 - pad, y1: y1 + pad };
}

function learnLayouts(project: Project, samples: { s: GlyphSample; label: Uint8Array }[]): string[] {
  const p = project.params;
  const cell = { x0: p.hangulSide, x1: p.hangulAdvance - p.hangulSide, yTop: p.hangulTop, yBottom: p.hangulBottom };
  const W = cell.x1 - cell.x0, H = cell.yTop - cell.yBottom;
  const acc = new Map<string, { sum: Rect; n: number }>();
  const add = (layout: string, slot: SlotName, b: { x0: number; x1: number; y0: number; y1: number } | null) => {
    if (!b) return;
    const r: Rect = { x0: (b.x0 - cell.x0) / W, x1: (b.x1 - cell.x0) / W, y0: (cell.yTop - b.y1) / H, y1: (cell.yTop - b.y0) / H };
    const k = `${layout}|${slot}`;
    const a = acc.get(k) ?? { sum: { x0: 0, y0: 0, x1: 0, y1: 0 }, n: 0 };
    a.sum.x0 += r.x0; a.sum.y0 += r.y0; a.sum.x1 += r.x1; a.sum.y1 += r.y1; a.n++;
    acc.set(k, a);
  };
  for (const { s, label } of samples) {
    const L = decompose(s.ch)!.layout;
    add(L, 'cho', inkBox(s, label, CODE.cho));
    if (label.includes(CODE.jungV)) {
      const bh = inkBox(s, label, CODE.jungH), bv = inkBox(s, label, CODE.jungV);
      add(L, 'jungH', bh);
      add(L, 'jungV', bv);
      if (bh && bv) add(L, 'jung', { x0: Math.min(bh.x0, bv.x0), x1: Math.max(bh.x1, bv.x1), y0: Math.min(bh.y0, bv.y0), y1: Math.max(bh.y1, bv.y1) });
    } else add(L, 'jung', inkBox(s, label, CODE.jung));
    add(L, 'jong', inkBox(s, label, CODE.jong));
  }
  const observed = new Set([...acc.keys()].map((k) => k.split('|')[0]));
  for (const layout of observed) {
    const next: LayoutDef = { ...project.layouts[layout] };
    for (const slot of ['cho', 'jung', 'jungH', 'jungV', 'jong'] as SlotName[]) {
      const a = acc.get(`${layout}|${slot}`);
      if (a) next[slot] = { x0: a.sum.x0 / a.n, y0: a.sum.y0 / a.n, x1: a.sum.x1 / a.n, y1: a.sum.y1 / a.n };
    }
    project.layouts[layout] = next;
    delete project.layouts[`${layout}:ㅡ`];
  }
  for (const layout of Object.keys(project.layouts)) {
    if (observed.has(layout) || layout.includes(':') || layout.startsWith('!')) continue;
    const [base, f] = layout.split('_');
    const sib = (FAMILY[base] ?? []).map((b) => (f ? `${b}_${f}` : b)).find((k) => observed.has(k));
    if (!sib) continue;
    const src = project.layouts[sib], dst = { ...project.layouts[layout] };
    for (const slot of ['cho', 'jung', 'jungH', 'jungV', 'jong'] as SlotName[]) {
      const a = src[slot], b = dst[slot];
      // 같은 계열에서 배운 칸을 빌린다: 자음 칸은 통째로(이 글꼴의 자모 크기·자리), 모음 칸은 높이만(모음 폭은 계열 안에서도 다르다)
      if (a && b) dst[slot] = slot === 'cho' || slot === 'jong' ? { ...a } : { ...b, y0: a.y0, y1: a.y1 };
    }
    project.layouts[layout] = dst;
  }
  return [...observed];
}

// ───────────────────────── 전체 ─────────────────────────

export interface ExtractReport {
  weight: number;
  hangul: { ch: string; ok: boolean }[];
  latin: string[];
  layouts: string[];
  keys: string[];
}

function traceOpts(s: GlyphSample): TraceOptions {
  // 원본 한 픽셀이 늘린 이미지에서 몇 픽셀인지에 맞춰 점 줄이기·잡티 기준을 잡는다
  return { eps: 0.3 * s.scale, cornerDeg: 55, minArea: 1.5 * s.scale * s.scale };
}

/**
 * 자모 하나의 영역(열림 연산): 원본 한 픽셀보다 얇은 띠(옆 자모와의 경계를 따라 붙은 조각)는 걷어 낸다.
 * 남은 잉크에서 반폭 r 원이 들어가는 중심만 남기고 다시 r만큼 부풀린 뒤, 번진 가장자리 폭만큼 더 허용한다.
 */
function jamoRegion(s: GlyphSample, label: Uint8Array, code: number): (x: number, y: number) => boolean {
  const { w, h, v } = s.field;
  const ink = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) ink[k] = label[k] === code && v[k] >= 0.5 ? 1 : 0;
  const r = 0.6 * s.scale;
  const dt = distanceTransform({ w, h, data: ink });
  const notCenter = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) notCenter[k] = dt[k] >= r ? 0 : 1;
  const toCenter = distanceTransform({ w, h, data: notCenter });
  const reach = r + 0.6 * s.scale;
  const own = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) own[k] = label[k] === code && toCenter[k] <= reach ? 1 : 0;
  // 닫힘 연산: 옆 자모가 붙어 있던 자리의 홈(V자로 파인 곳)을 옆 자모 잉크 쪽으로 메운다
  const R = 1.6 * s.scale;
  const outside = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) outside[k] = own[k] ? 0 : 1;
  const toOwn = distanceTransform({ w, h, data: outside });
  const grown = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) grown[k] = toOwn[k] <= R ? 1 : 0;
  const inGrown = distanceTransform({ w, h, data: grown });
  for (let k = 0; k < w * h; k++) {
    if (!own[k] && inGrown[k] > R && label[k] && label[k] !== code && v[k] >= 0.5) own[k] = 1;
  }
  return (x, y) => own[y * w + x] === 1;
}

function shiftContours(cs: Contour[], dx: number): Contour[] {
  const f = (q: Pt): Pt => ({ x: q.x + dx, y: q.y });
  return cs.map((c) => ({
    start: f(c.start),
    segs: c.segs.map((g) => (g.t === 'L' ? { t: 'L' as const, p: f(g.p) } : { t: 'C' as const, c1: f(g.c1), c2: f(g.c2), p: f(g.p) })),
  }));
}

function normalizeToSlot(cs: Contour[], slot: { x0: number; x1: number; yTop: number; yBottom: number }): Contour[] {
  const f = (q: Pt): Pt => ({ x: ((q.x - slot.x0) / (slot.x1 - slot.x0)) * 100, y: ((slot.yTop - q.y) / (slot.yTop - slot.yBottom)) * 100 });
  return cs.map((c) => ({
    start: f(c.start),
    segs: c.segs.map((g) => (g.t === 'L' ? { t: 'L' as const, p: f(g.p) } : { t: 'C' as const, c1: f(g.c1), c2: f(g.c2), p: f(g.p) })),
  }));
}

export function extractFont(img: RGBA, words: WordSample[], base: Project): { project: Project; samples: GlyphSample[]; labels: { s: GlyphSample; label: Uint8Array }[]; report: ExtractReport } {
  const project: Project = structuredClone(base);
  const pitches: number[] = [];
  const samples = readWords(img, words, project, pitches);
  if (pitches.length) project.params = { ...project.params, hangulAdvance: Math.round(median(pitches)) };
  // 이미지에 없는 자모는 기존 뼈대로 그리므로, 그 굵기를 이미지의 획 굵기에 맞춘다
  const refHW = median(samples.flatMap((s) => s.lines.flatMap((l) => l.hw))) || project.params.weight / 2;
  project.params = { ...project.params, weight: Math.round(refHW * 2 * 0.92), gap: Math.round(refHW * 0.45), density: 0.6 };

  // 자모 나누기 ↔ 배치 틀 학습을 번갈아 되풀이한다(처음엔 프리셋의 배치 틀이 기준)
  const han = samples.filter((s) => s.kind === 'hangul').map((s) => ({ s, label: new Uint8Array(0) as Uint8Array }));
  let layouts: string[] = [];
  for (let round = 0; round < 3; round++) {
    for (const h of han) h.label = labelInk(h.s, labelSkeleton(h.s, slotBoxes(project, h.s.ch)));
    layouts = learnLayouts(project, han);
  }
  const report: ExtractReport = {
    weight: project.params.weight,
    hangul: han.map(({ s, label }) => ({ ch: s.ch, ok: label.some((c) => c > 0) })),
    latin: [],
    layouts,
    keys: [],
  };
  const written = new Set<string>();
  const observedRole = new Set<string>();
  const write = (key: string, outline: Contour[]) => {
    if (written.has(key)) return;
    project.glyphs[key] = { kind: 'jamo', strokes: [], outline };
    written.add(key);
    report.keys.push(key);
  };

  // 이미지에 있던 음절: 원본 외곽선과 원본 글자 폭(옆 글자와의 틈) 그대로
  const hanS = samples.filter((x) => x.kind === 'hangul');
  const halfGap = median(hanS.flatMap((x) => [x.gapL, x.gapR]).filter((g) => Number.isFinite(g))) || project.params.hangulAdvance * 0.05;
  for (const s of hanS) {
    if (project.glyphs[`syl:${s.ch}`]) continue;
    const whole = traceOutline(s.field, s.toEm, traceOpts(s));
    if (!whole.length) continue;
    const lb = Number.isFinite(s.gapL) ? s.gapL : halfGap, rb = Number.isFinite(s.gapR) ? s.gapR : halfGap;
    const dx = lb + s.inkW / 2 - project.params.hangulAdvance / 2;
    project.glyphs[`syl:${s.ch}`] = { kind: 'jamo', strokes: [], width: Math.round(lb + s.inkW + rb), outline: shiftContours(whole, dx) };
  }

  // 자모 외곽선: 학습한 배치 틀의 자리에 맞춰 저장
  for (const { s, label } of han) {
    const d = decompose(s.ch)!;
    const saved = project.glyphs[`syl:${s.ch}`];
    delete project.glyphs[`syl:${s.ch}`];
    const comp = composeChar(project, s.ch);
    if (saved) project.glyphs[`syl:${s.ch}`] = saved;
    if (!comp) continue;
    const L = d.layout as LayoutKey;
    const group = layoutGroup(L);
    const put = (role: Role, jamo: string, code: number, part: number | null) => {
      // 겹자음(ㄲ·ㅆ…)은 두 조각 자리를 합친 칸을 쓴다
      const pls = comp.placements.filter((q) => q.role === role && (part === null || q.part === part));
      if (!pls.length) return;
      const slot = {
        x0: Math.min(...pls.map((q) => q.slot.x0)), x1: Math.max(...pls.map((q) => q.slot.x1)),
        yTop: Math.max(...pls.map((q) => q.slot.yTop)), yBottom: Math.min(...pls.map((q) => q.slot.yBottom)),
      };
      const cs = traceOutline(s.field, s.toEm, traceOpts(s), jamoRegion(s, label, code));
      if (!cs.length) return;
      const outline = normalizeToSlot(cs, slot);
      observedRole.add(`${jamo}@${role}`);
      write(`${jamo}@${role}.${L}`, outline);
      if (role !== 'jung') write(`${jamo}@${role}.${group}`, outline);
      write(`${jamo}@${role}`, outline);
      if (role === 'cho' || !written.has(jamo)) write(jamo, outline);
    };
    put('cho', d.cho, CODE.cho, null);
    if (label.includes(CODE.jungV)) {
      const parts = comp.placements.filter((q) => q.role === 'jung');
      if (parts.length === 2) {
        put('jung', parts[0].jamo, CODE.jungH, 0);
        put('jung', parts[1].jamo, CODE.jungV, 1);
      }
    } else put('jung', d.jung, CODE.jung, null);
    if (d.jong) put('jong', d.jong, CODE.jong, null);
  }
  // 관찰한 자모의 다른 기존 변형(프리셋 뼈대)은 지워 관찰한 모양이 쓰이게 한다
  for (const key of Object.keys(project.glyphs)) {
    const m = key.match(/^(.+)@(cho|jung|jong)[.!]/);
    if (m && observedRole.has(`${m[1]}@${m[2]}`) && !written.has(key)) delete project.glyphs[key];
  }

  // 라틴·숫자·기호: 외곽선 그대로, 옆 여백은 원본 글자 사이 틈으로
  const latGaps = samples.filter((x) => x.kind === 'latin').flatMap((x) => [x.gapL, x.gapR]).filter((g) => Number.isFinite(g));
  if (latGaps.length) project.params = { ...project.params, latinSide: Math.round(median(latGaps)) };
  for (const s of samples.filter((x) => x.kind === 'latin')) {
    const cs = traceOutline(s.field, s.toEm, traceOpts(s));
    if (!cs.length) continue;
    const xs = cs.flatMap((c) => [c.start.x, ...c.segs.map((g) => g.p.x)]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    project.glyphs[s.ch] = { kind: 'latin', width: Math.round(x1 - x0), strokes: [], outline: shiftContours(cs, -x0) };
    report.latin.push(s.ch);
  }
  return { project, samples, labels: han, report };
}

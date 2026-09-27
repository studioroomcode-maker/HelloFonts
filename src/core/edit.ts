import type { GlyphDef, PathStroke, Project, Pt, Role, Seg, Stroke } from './types';
import { boxMaps, composeChar, inset, type Composition, type EmBox, type Placement } from './compose';
import { CHO, compose, COMPOUND_VOWEL, decompose, DOUBLE_CONSONANT, isVowelJamo, JONG, type LayoutKey } from './hangul';
import { resolveJamoKey } from './project';
import { cubicAt, dist, lerp, splitCubic } from './geom';

export type NodeRef =
  | { stroke: number; at: 'start' }
  | { stroke: number; at: 'seg'; seg: number; handle: 'p' | 'c1' | 'c2' }
  | { stroke: number; at: 'center' | 'rx' | 'ry' };

export interface EditTarget {
  comp: Composition;
  placement: Placement | null;
}

export function findTarget(project: Project, sample: string, role: Role, part: number | null): EditTarget | null {
  const comp = composeChar(project, sample);
  if (!comp) return null;
  if (comp.kind !== 'hangul') return { comp, placement: comp.placements[0] ?? null };
  const byRole = comp.placements.filter((p) => p.role === role);
  const placement =
    byRole.find((p) => p.part === part) ?? byRole[0] ?? comp.placements[0] ?? null;
  return { comp, placement };
}

// ───────────────────────── 프로젝트 갱신 ─────────────────────────

export function setGlyph(project: Project, key: string, def: GlyphDef): Project {
  return { ...project, glyphs: { ...project.glyphs, [key]: def } };
}

export function removeGlyph(project: Project, key: string): Project {
  const glyphs = { ...project.glyphs };
  delete glyphs[key];
  return { ...project, glyphs };
}

export function updateStrokes(project: Project, key: string, fn: (s: Stroke[]) => Stroke[]): Project {
  const def = project.glyphs[key];
  if (!def) return project;
  return setGlyph(project, key, { ...def, strokes: fn(def.strokes) });
}

// ───────────────────────── 점 조작 ─────────────────────────

const replaceAt = <T,>(arr: T[], i: number, v: T) => arr.map((x, j) => (j === i ? v : x));

export function nodePos(s: Stroke, ref: NodeRef): Pt | null {
  if (s.kind === 'ellipse') {
    if (ref.at === 'center') return s.c;
    if (ref.at === 'rx') return { x: s.c.x + s.rx, y: s.c.y };
    if (ref.at === 'ry') return { x: s.c.x, y: s.c.y + s.ry };
    return null;
  }
  if (ref.at === 'start') return s.start;
  if (ref.at === 'seg') {
    const g = s.segs[ref.seg];
    if (!g) return null;
    if (ref.handle === 'p') return g.p;
    return g.t === 'C' ? g[ref.handle] : null;
  }
  return null;
}

export function moveNode(strokes: Stroke[], ref: NodeRef, to: Pt): Stroke[] {
  const s = strokes[ref.stroke];
  if (!s) return strokes;
  if (s.kind === 'ellipse') {
    if (ref.at === 'center') return replaceAt(strokes, ref.stroke, { ...s, c: to });
    if (ref.at === 'rx') return replaceAt(strokes, ref.stroke, { ...s, rx: Math.max(1, Math.abs(to.x - s.c.x)) });
    if (ref.at === 'ry') return replaceAt(strokes, ref.stroke, { ...s, ry: Math.max(1, Math.abs(to.y - s.c.y)) });
    return strokes;
  }
  const segs = [...s.segs];
  let start = s.start;
  const shiftC1 = (i: number, dx: number, dy: number) => {
    const g = segs[i];
    if (g && g.t === 'C') segs[i] = { ...g, c1: { x: g.c1.x + dx, y: g.c1.y + dy } };
  };
  if (ref.at === 'start') {
    shiftC1(0, to.x - start.x, to.y - start.y);
    start = to;
  } else if (ref.at === 'seg') {
    const g = segs[ref.seg];
    if (!g) return strokes;
    if (ref.handle === 'p') {
      const dx = to.x - g.p.x, dy = to.y - g.p.y;
      segs[ref.seg] = g.t === 'C' ? { ...g, p: to, c2: { x: g.c2.x + dx, y: g.c2.y + dy } } : { ...g, p: to };
      shiftC1(ref.seg + 1, dx, dy);
    } else if (g.t === 'C') {
      segs[ref.seg] = { ...g, [ref.handle]: to };
    }
  }
  return replaceAt(strokes, ref.stroke, { ...s, start, segs });
}

export function deleteNode(strokes: Stroke[], ref: NodeRef): Stroke[] {
  const s = strokes[ref.stroke];
  if (!s) return strokes;
  if (s.kind === 'ellipse') return strokes.filter((_, i) => i !== ref.stroke);
  if (ref.at === 'start') {
    if (!s.segs.length) return strokes.filter((_, i) => i !== ref.stroke);
    const [first, ...rest] = s.segs;
    return replaceAt(strokes, ref.stroke, { ...s, start: first.p, segs: rest });
  }
  if (ref.at === 'seg') {
    if (ref.handle !== 'p') return toggleCurve(strokes, ref.stroke, ref.seg);
    return replaceAt(strokes, ref.stroke, { ...s, segs: s.segs.filter((_, i) => i !== ref.seg) });
  }
  return strokes;
}

function segStart(s: PathStroke, i: number): Pt {
  return i === 0 ? s.start : s.segs[i - 1].p;
}

export function toggleCurve(strokes: Stroke[], strokeIdx: number, segIdx: number): Stroke[] {
  const s = strokes[strokeIdx];
  if (!s || s.kind !== 'path' || !s.segs[segIdx]) return strokes;
  const g = s.segs[segIdx];
  const a = segStart(s, segIdx);
  const next: Seg = g.t === 'L' ? { t: 'C', c1: lerp(a, g.p, 1 / 3), c2: lerp(a, g.p, 2 / 3), p: g.p } : { t: 'L', p: g.p };
  return replaceAt(strokes, strokeIdx, { ...s, segs: replaceAt(s.segs, segIdx, next) });
}

export function insertNode(strokes: Stroke[], strokeIdx: number, segIdx: number, t: number): Stroke[] {
  const s = strokes[strokeIdx];
  if (!s || s.kind !== 'path') return strokes;
  const a = segStart(s, segIdx);
  const g = s.segs[segIdx];
  let parts: Seg[];
  if (!g) {
    // 닫힌 획의 마지막 변(끝점→시작점)
    const b = s.start;
    const m = lerp(a, b, t);
    return replaceAt(strokes, strokeIdx, { ...s, segs: [...s.segs, { t: 'L', p: m }] });
  }
  if (g.t === 'L') {
    parts = [{ t: 'L', p: lerp(a, g.p, t) }, g];
  } else {
    const [l, r] = splitCubic({ p0: a, c1: g.c1, c2: g.c2, p3: g.p }, t);
    parts = [{ t: 'C', c1: l.c1, c2: l.c2, p: l.p3 }, { t: 'C', c1: r.c1, c2: r.c2, p: r.p3 }];
  }
  const segs = [...s.segs.slice(0, segIdx), ...parts, ...s.segs.slice(segIdx + 1)];
  return replaceAt(strokes, strokeIdx, { ...s, segs });
}

/** 점 q에서 획 위의 가장 가까운 지점(구간 번호와 매개변수 t) */
export function nearestOnStroke(s: PathStroke, q: Pt): { seg: number; t: number; d: number } {
  let best = { seg: 0, t: 0, d: Infinity };
  const n = s.segs.length + (s.closed ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = segStart(s, i);
    const g = s.segs[i] ?? ({ t: 'L', p: s.start } as Seg);
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      const p = g.t === 'L' ? lerp(a, g.p, t) : cubicAt({ p0: a, c1: g.c1, c2: g.c2, p3: g.p }, t);
      const d = dist(p, q);
      if (d < best.d) best = { seg: i, t, d };
    }
  }
  return best;
}

// ───────────────────────── 겹자모 통째로 굽기 ─────────────────────────

function unionBox(boxes: EmBox[]): EmBox {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    yTop: Math.max(...boxes.map((b) => b.yTop)),
    yBottom: Math.min(...boxes.map((b) => b.yBottom)),
  };
}

/**
 * 구성 자모로 합성된 겹자모(ㄲ, ㅘ …)를 하나의 뼈대로 합쳐 `${owner}@${role}` 키로 돌려준다.
 * 겹모음은 음절 배치의 전체 모음 자리(jung)에 맞춰 굽는다.
 */
export function bakeCompound(project: Project, comp: Composition, owner: string, role: Role): { key: string; def: GlyphDef } | null {
  const parts = comp.placements.filter((p) => p.owner === owner && p.role === role && p.part !== null);
  if (parts.length < 2) return null;
  let slot = unionBox(parts.map((p) => p.slot));
  if (role === 'jung' && comp.layout) {
    const L = project.layouts[comp.layout];
    const cell = comp.cell!;
    const w = cell.x1 - cell.x0, h = cell.yTop - cell.yBottom;
    slot = { x0: cell.x0 + L.jung.x0 * w, x1: cell.x0 + L.jung.x1 * w, yTop: cell.yTop - L.jung.y0 * h, yBottom: cell.yTop - L.jung.y1 * h };
  }
  const box = inset(slot, project.params);
  const owner2 = boxMaps(box);
  const strokes: Stroke[] = [];
  for (const p of parts) {
    const t = (q: Pt) => owner2.fromEm(p.toEm(q));
    for (const s of p.skeleton) {
      if (s.kind === 'ellipse') {
        const c = t(s.c);
        const ex = t({ x: s.c.x + s.rx, y: s.c.y });
        const ey = t({ x: s.c.x, y: s.c.y + s.ry });
        strokes.push({ kind: 'ellipse', c, rx: Math.abs(ex.x - c.x), ry: Math.abs(ey.y - c.y), keep: s.keep });
      } else {
        strokes.push({
          kind: 'path',
          closed: s.closed,
          start: t(s.start),
          segs: s.segs.map((g): Seg => (g.t === 'L' ? { t: 'L', p: t(g.p) } : { t: 'C', c1: t(g.c1), c2: t(g.c2), p: t(g.p) })),
        });
      }
    }
  }
  return { key: `${owner}@${role}`, def: { kind: 'jamo', strokes } };
}

// ───────────────────────── 키 → 대표 글자 ─────────────────────────

const LAYOUT_VOWEL: Record<string, string> = {
  V: 'ㅏ', VL: 'ㅓ', VV: 'ㅐ', Ho: 'ㅗ', Hu: 'ㅜ', Co: 'ㅘ', Cu: 'ㅝ', CCo: 'ㅙ', CCu: 'ㅞ', vert: 'ㅏ', horz: 'ㅗ',
};
/** 벌 번호 → [모음, 받침 유무, 초성] */
const BUL_SAMPLE: Record<string, Record<string, [string, boolean, string]>> = {
  cho: {
    b1: ['ㅏ', false, ''], b2: ['ㅗ', false, ''], b3: ['ㅜ', false, ''], b4: ['ㅘ', false, ''],
    b5: ['ㅝ', false, ''], b6: ['ㅏ', true, ''], b7: ['ㅗ', true, ''], b8: ['ㅘ', true, ''],
  },
  jung: { b1: ['', false, 'ㅇ'], b2: ['', false, 'ㄱ'], b3: ['', true, 'ㅇ'], b4: ['', true, 'ㄱ'] },
  jong: { b1: ['ㅏ', true, 'ㅇ'], b2: ['ㅓ', true, 'ㅇ'], b3: ['ㅐ', true, 'ㅇ'], b4: ['ㅗ', true, 'ㅇ'] },
};

/** 'ㄱ@cho.vert', 'ㄱ@cho.b6', 'ㄱ@cho!각' 같은 키가 실제로 쓰이는 대표 음절 */
export function sampleForKey(key: string): string {
  const [jamo, rest] = key.split('@');
  if (!rest) {
    if (isVowelJamo(jamo)) return compose('ㅇ', jamo);
    if (CHO.includes(jamo)) return compose(jamo, 'ㅏ');
    if (JONG.includes(jamo)) return compose('ㅇ', 'ㅏ', jamo);
    return jamo;
  }
  if (rest.includes('!')) return rest.split('!')[1];
  const [role, scope] = rest.split('.');
  if (scope && /^b\d$/.test(scope)) {
    const [v, f, c] = BUL_SAMPLE[role]?.[scope] ?? ['ㅏ', false, 'ㅇ'];
    if (role === 'cho') return compose(jamo, v, f ? 'ㄴ' : '') || jamo;
    if (role === 'jung') return compose(c, jamo, f ? 'ㄴ' : '') || jamo;
    return compose(c, v, jamo) || jamo;
  }
  const base = scope?.replace('_F', '') ?? 'V';
  const withFinal = scope?.endsWith('_F') ?? false;
  const vowel = LAYOUT_VOWEL[base] ?? 'ㅏ';
  if (role === 'cho') return compose(jamo, vowel, withFinal ? 'ㄴ' : '') || compose('ㅇ', 'ㅏ', jamo);
  if (role === 'jung') return compose('ㅇ', jamo, withFinal ? 'ㄴ' : '');
  return compose('ㅇ', vowel, jamo) || compose('ㅇ', 'ㅏ', jamo);
}

// ───────────────────────── 사용처 찾기 ─────────────────────────

/** 음절 ch를 그릴 때 key 정의가 쓰이는지 */
export function syllableUsesKey(project: Project, ch: string, key: string): boolean {
  const d = decompose(ch);
  if (!d) return false;
  const uses = (jamo: string, role: Role, bul: string): boolean => {
    const ctx = { layout: d.layout, bul, syllable: ch };
    const found = resolveJamoKey(project.glyphs, jamo, role, ctx);
    if (found) return found.key === key;
    const parts = role === 'jung' ? COMPOUND_VOWEL[jamo] : DOUBLE_CONSONANT[jamo];
    return !!parts && parts.some((pj) => resolveJamoKey(project.glyphs, pj, role, ctx)?.key === key);
  };
  return uses(d.cho, 'cho', d.bul.cho) || uses(d.jung, 'jung', d.bul.jung) || (!!d.jong && uses(d.jong, 'jong', d.bul.jong));
}

export function usageSamples(project: Project, key: string, pool: string[], max: number): { list: string[]; total: number } {
  const list: string[] = [];
  let total = 0;
  for (const ch of pool) {
    if (syllableUsesKey(project, ch, key)) {
      total++;
      if (list.length < max) list.push(ch);
    }
  }
  return { list, total };
}

export const isLayoutKey = (k: string): k is LayoutKey => /^(V|VL|VV|Ho|Hu|Co|Cu|CCo|CCu)(_F)?$/.test(k);

// ───────────────────────── 점별 굵기(필압) ─────────────────────────

export function nodeWidth(strokes: Stroke[], ref: NodeRef): number | null {
  const s = strokes[ref.stroke];
  if (!s || s.kind !== 'path') return null;
  if (ref.at === 'start') return s.startW ?? 1;
  if (ref.at === 'seg' && ref.handle === 'p') return s.segs[ref.seg]?.w ?? 1;
  return null;
}

export function setNodeWidth(strokes: Stroke[], ref: NodeRef, w: number): Stroke[] {
  const s = strokes[ref.stroke];
  if (!s || s.kind !== 'path') return strokes;
  if (ref.at === 'start') return replaceAt(strokes, ref.stroke, { ...s, startW: w });
  if (ref.at === 'seg' && ref.handle === 'p' && s.segs[ref.seg]) {
    return replaceAt(strokes, ref.stroke, { ...s, segs: replaceAt(s.segs, ref.seg, { ...s.segs[ref.seg], w }) });
  }
  return strokes;
}

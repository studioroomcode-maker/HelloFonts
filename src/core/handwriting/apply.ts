import type { GlyphDef, Project, Pt, Role, Stroke } from '../types';
import { composeChar, type EmBox, type Placement } from '../compose';
import { fitToBox, inkToStrokes, medianHalfWidth, type CellInk, type CleanupOptions, type InkLine } from './fit';
import type { TemplateCell } from './template';
import { segmentByStructure } from './segment';

export interface HandwritingInput {
  cell: TemplateCell;
  ink: CellInk;
}

export interface ApplyReport {
  applied: string[];
  empty: string[];
  weight: number;
}

const ROLE_OF: Record<string, Role> = { 'cho-v': 'cho', 'cho-h': 'cho', jung: 'jung', jong: 'jong' };

/** 자리 가운데까지의 거리(자리 크기로 나눈 값) */
function slotDistance(p: Pt, b: EmBox): number {
  const cx = (b.x0 + b.x1) / 2, cy = (b.yTop + b.yBottom) / 2;
  const w = Math.max(1, b.x1 - b.x0), h = Math.max(1, b.yTop - b.yBottom);
  return ((p.x - cx) / w) ** 2 + ((p.y - cy) / h) ** 2;
}

function nearestSlot(p: Pt, placements: Placement[]): number {
  let best = 0, bd = Infinity;
  placements.forEach((pl, i) => {
    const d = slotDistance(p, pl.slot);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

const centroid = (pts: Pt[]): Pt => ({
  x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
  y: pts.reduce((a, p) => a + p.y, 0) / pts.length,
});

/** 덩어리의 테두리 상자가 자리를 가로·세로 모두 크게 덮는지 */
function covers(pts: Pt[], b: EmBox): boolean {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const ox = Math.max(0, Math.min(b.x1, Math.max(...xs)) - Math.max(b.x0, Math.min(...xs))) / Math.max(1, b.x1 - b.x0);
  const oy = Math.max(0, Math.min(b.yTop, Math.max(...ys)) - Math.max(b.yBottom, Math.min(...ys))) / Math.max(1, b.yTop - b.yBottom);
  return ox > 0.5 && oy > 0.5;
}

/**
 * 획을 자모 자리에 나눠 담고, 원하는 자리의 획만 돌려준다.
 * 손글씨는 안내 상자를 벗어나기 쉬우므로 잉크 덩어리(대개 자모 하나)의 무게중심으로 자리를 정한다.
 * 덩어리가 두 자리 이상을 크게 덮으면(자모끼리 붙여 씀) 획마다 따로 정한다.
 */
function linesForPlacement(ink: CellInk, placements: Placement[], target: Placement): InkLine[] {
  const blobSlot = new Map<number, number>();
  for (const b of ink.blobs ?? []) {
    if (!b.samples.length) continue;
    const spanning = placements.filter((pl) => covers(b.samples, pl.slot)).length >= 2;
    if (!spanning) blobSlot.set(b.id, nearestSlot(centroid(b.samples), placements));
  }
  return ink.lines.filter((line) => {
    const byBlob = line.blob !== undefined ? blobSlot.get(line.blob) : undefined;
    const winner = byBlob ?? nearestSlot(centroid(line.pts), placements);
    return placements[winner] === target;
  });
}

function keysFor(cell: TemplateCell): string[] {
  const j = cell.jamo;
  switch (cell.take) {
    case 'cho-v': return [`${j}@cho.vert`];
    case 'cho-h': return [`${j}@cho.horz`, j];
    case 'jung': return [j];
    case 'jong': return [`${j}@jong`];
    default: return [j];
  }
}

/** 손글씨가 쓰일 수 있도록 같은 자모·자리의 더 구체적인 기존 변형을 지운다 */
function clearShadowing(glyphs: Record<string, GlyphDef>, jamo: string, role: Role, keep: Set<string>) {
  for (const k of Object.keys(glyphs)) {
    if (keep.has(k)) continue;
    if (k.startsWith(`${jamo}@${role}.`) || k.startsWith(`${jamo}@${role}!`) || k === `${jamo}@${role}`) delete glyphs[k];
  }
}

function strokesBounds(strokes: Stroke[]) {
  const xs: number[] = [];
  for (const s of strokes) {
    if (s.kind === 'ellipse') { xs.push(s.c.x - s.rx, s.c.x + s.rx); continue; }
    xs.push(s.start.x, ...s.segs.map((g) => g.p.x));
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs) };
}

function shiftX(strokes: Stroke[], dx: number): Stroke[] {
  const f = (p: Pt): Pt => ({ x: p.x + dx, y: p.y });
  return strokes.map((s) =>
    s.kind === 'ellipse'
      ? { ...s, c: f(s.c) }
      : { ...s, start: f(s.start), segs: s.segs.map((g) => (g.t === 'L' ? { ...g, p: f(g.p) } : { ...g, c1: f(g.c1), c2: f(g.c2), p: f(g.p) })) },
  );
}

/**
 * 손글씨 칸들을 글꼴에 입힌다.
 * @param setWeight 손글씨 펜 굵기를 글꼴 굵기로 쓸지
 */
export function applyHandwriting(
  base: Project,
  inputs: HandwritingInput[],
  opts: CleanupOptions,
  setWeight = true,
): { project: Project; report: ApplyReport } {
  const project: Project = structuredClone(base);
  const refHW = medianHalfWidth(inputs.flatMap((i) => i.ink.lines)) || project.params.weight / 2;
  if (setWeight) {
    project.params = { ...project.params, weight: Math.round(Math.min(200, Math.max(16, refHW * 2))), contrast: 0, cap: 'round', join: 'round' };
  }
  const report: ApplyReport = { applied: [], empty: [], weight: project.params.weight };
  const written = new Set<string>();
  const cleared = new Set<string>();

  for (const { cell, ink } of inputs) {
    if (!ink.lines.length) {
      report.empty.push(cell.text);
      continue;
    }
    const comp = composeChar(project, cell.text);
    if (!comp) continue;

    if (cell.take === 'latin') {
      const pl = comp.placements[0];
      if (!pl) continue;
      let strokes = inkToStrokes(ink.lines, pl.fromEm, opts, refHW);
      if (!strokes.length) continue;
      const b = strokesBounds(strokes);
      strokes = shiftX(strokes, -b.x0);
      project.glyphs[cell.jamo] = { kind: 'latin', width: Math.max(0, Math.round(b.x1 - b.x0)), strokes };
      report.applied.push(cell.text);
      continue;
    }

    const role = ROLE_OF[cell.take];
    const target = comp.placements.find((p) => p.role === role && p.jamo === cell.jamo);
    if (!target) continue;
    // 원고지 칸은 어떤 글자인지 알므로 글자 구조로 먼저 나누고, 안 되면 위치로 나눈다
    const lines = segmentByStructure(ink.lines, cell.take) ?? linesForPlacement(ink, comp.placements, target);
    if (!lines.length) {
      report.empty.push(cell.text);
      continue;
    }
    const strokes = fitToBox(inkToStrokes(lines, target.fromEm, opts, refHW), opts.fill);
    const keys = keysFor(cell);
    const clearKey = `${cell.jamo}:${role}`;
    if (!cleared.has(clearKey)) {
      clearShadowing(project.glyphs, cell.jamo, role, new Set([...written, ...keys]));
      cleared.add(clearKey);
    }
    for (const k of keys) {
      project.glyphs[k] = { kind: 'jamo', strokes };
      written.add(k);
    }
    report.applied.push(cell.text);
  }
  return { project, report };
}

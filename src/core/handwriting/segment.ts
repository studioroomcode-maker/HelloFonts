import type { Pt } from '../types';
import type { InkLine } from './fit';
import type { Take } from './template';

/**
 * 원고지 칸의 획들을 자모별로 나눈다.
 * 칸마다 어떤 글자를 썼는지 알고 있으므로(가·고·아·악 …), 글자 구조로 모음·ㅇ을 먼저 찾아낸다.
 *   가 줄: 오른쪽의 긴 세로획 + 그에 붙은 짧은 가로획 = ㅏ, 나머지 = 초성
 *   고 줄: 맨 아래의 긴 가로획 + 그 위에 선 짧은 세로획 = ㅗ, 나머지 = 초성
 *   아 줄: 닫힌 고리 = ㅇ, 나머지 = 모음
 *   악 줄: 위쪽 고리 = ㅇ, 오른쪽 세로획 = ㅏ, 나머지 = 받침
 * 구조로 찾지 못하면 null을 돌려 위치 기반 판단에 맡긴다.
 */

interface Info {
  line: InkLine;
  len: number;
  x0: number; x1: number; y0: number; y1: number;
  cx: number; cy: number;
  loop: boolean;
}

function info(line: InkLine, pen: number): Info {
  const xs = line.pts.map((p) => p.x), ys = line.pts.map((p) => p.y);
  let len = 0;
  for (let i = 1; i < line.pts.length; i++) len += Math.hypot(line.pts[i].x - line.pts[i - 1].x, line.pts[i].y - line.pts[i - 1].y);
  const a = line.pts[0], b = line.pts[line.pts.length - 1];
  const nearlyClosed = line.pts.length > 3 && Math.hypot(a.x - b.x, a.y - b.y) < pen * 3 && len > pen * 10;
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return {
    line, len, x0, x1, y0, y1,
    cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
    loop: !!line.closed || nearlyClosed,
  };
}

const isVertical = (i: Info) => i.y1 - i.y0 > 2 * (i.x1 - i.x0);
const isHorizontal = (i: Info) => i.x1 - i.x0 > 2 * (i.y1 - i.y0);

function near(p: Pt, i: Info, tol: number) {
  return p.x >= i.x0 - tol && p.x <= i.x1 + tol && p.y >= i.y0 - tol && p.y <= i.y1 + tol;
}

/** 세로 기둥 + 오른쪽으로 붙은 짧은 곁줄기(ㅏ) */
function findA(items: Info[], pen: number, inkH: number): Info[] | null {
  const stems = items.filter((i) => isVertical(i) && i.y1 - i.y0 > inkH * 0.45 && !i.loop);
  if (!stems.length) return null;
  const stem = stems.reduce((a, b) => (b.cx > a.cx ? b : a));
  const ticks = items.filter((i) => i !== stem && !i.loop && isHorizontal(i) && i.x0 >= stem.cx - pen * 3 && (near(i.line.pts[0], stem, pen * 3) || near(i.line.pts[i.line.pts.length - 1], stem, pen * 3)));
  return [stem, ...ticks];
}

/** 맨 아래 가로 막대 + 그 위에 선 기둥(ㅗ) */
function findO(items: Info[], pen: number, inkW: number): Info[] | null {
  const bars = items.filter((i) => isHorizontal(i) && i.x1 - i.x0 > inkW * 0.45 && !i.loop);
  if (!bars.length) return null;
  const bar = bars.reduce((a, b) => (b.cy < a.cy ? b : a)); // y 위쪽이 큼 → 가장 아래
  const stems = items.filter((i) => i !== bar && !i.loop && isVertical(i) && i.cy > bar.cy && (near(i.line.pts[0], bar, pen * 3) || near(i.line.pts[i.line.pts.length - 1], bar, pen * 3)));
  return [bar, ...stems];
}

export function segmentByStructure(lines: InkLine[], take: Take): InkLine[] | null {
  if (!lines.length || take === 'latin') return null;
  const pen = Math.max(8, median(lines.flatMap((l) => l.hw)) * 2);
  const items = lines.filter((l) => l.pts.length >= 2).map((l) => info(l, pen));
  if (!items.length) return null;
  const inkW = Math.max(...items.map((i) => i.x1)) - Math.min(...items.map((i) => i.x0));
  const inkH = Math.max(...items.map((i) => i.y1)) - Math.min(...items.map((i) => i.y0));
  const minus = (a: Info[], b: Info[]) => a.filter((x) => !b.includes(x)).map((x) => x.line);

  switch (take) {
    case 'cho-v': {
      const a = findA(items, pen, inkH);
      return a ? minus(items, a) : null;
    }
    case 'cho-h': {
      const o = findO(items, pen, inkW);
      return o ? minus(items, o) : null;
    }
    case 'jung': {
      const loops = items.filter((i) => i.loop);
      if (!loops.length) {
        // ㅇ이 모음에 붙어 고리가 끊긴 경우: 꺾이는 곳에서 자른 뒤 굽은 조각(ㅇ)과 곧은 조각(모음)으로 나눈다
        const pieces = items.flatMap((i) => splitAtCorners(i.line, pen).map((l) => info(l, pen)));
        return vowelFromPieces(pieces, pen);
      }
      // ㅇ은 초성 자리(왼쪽 또는 위쪽)의 고리
      const ieung = loops.reduce((a, b) => (b.cx - b.cy < a.cx - a.cy ? b : a));
      return minus(items, [ieung]);
    }
    case 'jong': {
      const loops = items.filter((i) => i.loop);
      if (!loops.length) return null;
      const ieung = loops.reduce((a, b) => (b.cy > a.cy ? b : a)); // 가장 위쪽 고리
      const upper = items.filter((i) => i !== ieung && i.cy > ieung.y0 - pen);
      const a = findA(upper.length ? upper : items.filter((i) => i !== ieung), pen, ieung.y1 - ieung.y0);
      if (!a) return null;
      return minus(items, [ieung, ...a]);
    }
  }
  return null;
}

/**
 * 굽은 조각들(= ㅇ)의 테두리 상자를 구하고, 그 밖에 놓인 곧은 조각들을 모음으로 돌려준다.
 */
function vowelFromPieces(pieces: Info[], pen: number): InkLine[] | null {
  const curved = pieces.filter((i) => straightness(i.line) < 0.9 && i.len >= pen);
  if (!curved.length) return null;
  const m = pen * 0.5;
  const ring = {
    x0: Math.min(...curved.map((c) => c.x0)) - m, x1: Math.max(...curved.map((c) => c.x1)) + m,
    y0: Math.min(...curved.map((c) => c.y0)) - m, y1: Math.max(...curved.map((c) => c.y1)) + m,
  };
  const inside = (p: Pt) => p.x >= ring.x0 && p.x <= ring.x1 && p.y >= ring.y0 && p.y <= ring.y1;
  const vowel = pieces.filter((i) => !curved.includes(i) && i.len >= pen * 0.8 && i.line.pts.filter(inside).length / i.line.pts.length < 0.5);
  return vowel.length ? vowel.map((i) => i.line) : null;
}

/** 방향이 크게 꺾이는 곳(펜 굵기 정도의 구간에서 35° 넘게)에서 획을 자른다 */
function splitAtCorners(l: InkLine, pen: number): InkLine[] {
  const n = l.pts.length;
  if (n < 5 || l.closed) return [l];
  // 누적 길이
  const acc = [0];
  for (let i = 1; i < n; i++) acc.push(acc[i - 1] + Math.hypot(l.pts[i].x - l.pts[i - 1].x, l.pts[i].y - l.pts[i - 1].y));
  const at = (d: number) => {
    let k = 0;
    while (k < n - 1 && acc[k] < d) k++;
    return l.pts[k];
  };
  const turn: number[] = l.pts.map((p, i) => {
    if (acc[i] < pen || acc[n - 1] - acc[i] < pen) return 0;
    const a = at(acc[i] - pen), b = at(acc[i] + pen);
    const v1 = { x: p.x - a.x, y: p.y - a.y }, v2 = { x: b.x - p.x, y: b.y - p.y };
    const c = (v1.x * v2.x + v1.y * v2.y) / ((Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)) || 1);
    return Math.acos(Math.max(-1, Math.min(1, c)));
  });
  const cuts: number[] = [];
  const lim = (35 * Math.PI) / 180;
  for (let i = 1; i < n - 1; i++) {
    if (turn[i] > lim && turn[i] >= turn[i - 1] && turn[i] >= turn[i + 1] && (!cuts.length || acc[i] - acc[cuts[cuts.length - 1]] > pen)) cuts.push(i);
  }
  if (!cuts.length) return [l];
  const out: InkLine[] = [];
  let s = 0;
  for (const c of [...cuts, n - 1]) {
    if (c - s >= 1) out.push({ ...l, pts: l.pts.slice(s, c + 1), hw: l.hw.slice(s, c + 1) });
    s = c;
  }
  return out;
}

/** 양 끝 직선 거리 ÷ 획 길이(1 = 곧은 획) */
function straightness(l: InkLine): number {
  let len = 0;
  for (let i = 1; i < l.pts.length; i++) len += Math.hypot(l.pts[i].x - l.pts[i - 1].x, l.pts[i].y - l.pts[i - 1].y);
  const a = l.pts[0], b = l.pts[l.pts.length - 1];
  return len ? Math.hypot(a.x - b.x, a.y - b.y) / len : 0;
}

function median(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

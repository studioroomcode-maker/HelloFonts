import type { Params } from '../types';
import { compose } from '../hangul';

/**
 * 손글씨 원고지.
 * 한글 56자로 모든 자모의 모양을 받는다:
 *   자음 14 × (세로모음 앞 초성 · 가로모음 앞 초성 · 받침) + 기본 모음 14
 * 나머지 11,172자는 조합 엔진이 만든다.
 */

export type Take = 'cho-v' | 'cho-h' | 'jung' | 'jong' | 'latin';

export interface TemplateCell {
  text: string;
  take: Take;
  /** 이 칸에서 가져올 자모(라틴은 글자 자체) */
  jamo: string;
}

const CONSONANTS = [...'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'];
const VOWELS = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅛㅜㅠㅡㅣ'];
const LATIN = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?-()\'":/'];

export const HANGUL_CELLS: TemplateCell[] = [
  ...CONSONANTS.map((c) => ({ text: compose(c, 'ㅏ'), take: 'cho-v' as const, jamo: c })),
  ...CONSONANTS.map((c) => ({ text: compose(c, 'ㅗ'), take: 'cho-h' as const, jamo: c })),
  ...VOWELS.map((v) => ({ text: compose('ㅇ', v), take: 'jung' as const, jamo: v })),
  ...CONSONANTS.map((c) => ({ text: compose('ㅇ', 'ㅏ', c), take: 'jong' as const, jamo: c })),
];

export const LATIN_CELLS: TemplateCell[] = LATIN.map((ch) => ({ text: ch, take: 'latin', jamo: ch }));

export const TAKE_LABEL: Record<Take, string> = {
  'cho-v': '초성(세로모음 앞)',
  'cho-h': '초성(가로모음 앞)',
  jung: '모음',
  jong: '받침',
  latin: '영문·숫자',
};

export interface TemplatePage {
  id: 'hangul' | 'latin';
  title: string;
  cells: TemplateCell[];
}

export const PAGES: TemplatePage[] = [
  { id: 'hangul', title: '한글 원고지 (56자)', cells: HANGUL_CELLS },
  { id: 'latin', title: '영문·숫자 원고지 (73자)', cells: LATIN_CELLS },
];

// ───────────────────────── 종이 위치(mm, A4 세로) ─────────────────────────

export const SHEET = {
  w: 210,
  h: 297,
  marker: 8,
  cols: 8,
  rows: 10,
  left: 20,
  top: 32,
  pitchX: 21.25,
  pitchY: 24.4,
  box: 18,
  label: 4.4,
};

/** 네 모서리 표식의 중심: 왼쪽 위, 오른쪽 위, 왼쪽 아래, 오른쪽 아래 */
export const MARKERS_MM = [
  { x: 12, y: 12 },
  { x: SHEET.w - 12, y: 12 },
  { x: 12, y: SHEET.h - 12 },
  { x: SHEET.w - 12, y: SHEET.h - 12 },
];

export function cellBoxMM(index: number) {
  const col = index % SHEET.cols, row = Math.floor(index / SHEET.cols);
  const x = SHEET.left + col * SHEET.pitchX + (SHEET.pitchX - SHEET.box) / 2;
  const y = SHEET.top + row * SHEET.pitchY + SHEET.label;
  return { x, y, size: SHEET.box };
}

/** 칸(정사각형)이 나타내는 폰트 좌표 범위 */
export interface EmFrame {
  x0: number;
  yTop: number;
  size: number;
}

export function cellFrame(cell: TemplateCell, p: Params): EmFrame {
  if (cell.take === 'latin') {
    const size = 1200;
    const cy = (p.ascender + p.descender) / 2;
    return { x0: 450 - size / 2, yTop: cy + size / 2, size };
  }
  const size = 1100;
  const cy = (p.hangulTop + p.hangulBottom) / 2;
  return { x0: p.hangulAdvance / 2 - size / 2, yTop: cy + size / 2, size };
}

/** 칸 안의 상대 위치(0..1, y 아래로) → 폰트 좌표 */
export function frameToEm(f: EmFrame, u: number, v: number) {
  return { x: f.x0 + u * f.size, y: f.yTop - v * f.size };
}

/** 폰트 좌표 → 칸 안의 상대 위치(0..1) */
export function emToFrame(f: EmFrame, x: number, y: number) {
  return { u: (x - f.x0) / f.size, v: (f.yTop - y) / f.size };
}

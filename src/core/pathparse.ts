import type { EllipseStroke, PathStroke, Pt, Stroke } from './types';
import { lerp } from './geom';

/**
 * 뼈대 기술 문법(SVG path의 절대좌표 부분집합 + 타원)
 *   M x y         새 획 시작
 *   L x y         직선
 *   H x / V y     수평·수직 직선
 *   Q cx cy x y   2차 곡선(3차로 변환됨)
 *   C x1 y1 x2 y2 x y
 *   Z             획 닫기
 *   O cx cy rx ry 타원 획
 *   K k           직전 타원의 원형 유지 정도(0..1)
 *   W w           직전 점의 굵기 배율(필압, 1 = 기본)
 */
export function parseSkeleton(src: string): Stroke[] {
  const tokens = src.match(/[MLHVQCZOKW]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const strokes: Stroke[] = [];
  let i = 0;
  let cur: PathStroke | null = null;
  let lastEllipse: EllipseStroke | null = null;
  let pos: Pt = { x: 0, y: 0 };
  const num = () => {
    const v = parseFloat(tokens[i++]);
    if (Number.isNaN(v)) throw new Error(`뼈대 구문 오류: ${src}`);
    return v;
  };
  const needPath = (): PathStroke => {
    if (!cur) throw new Error(`M 없이 선이 시작됨: ${src}`);
    return cur;
  };
  while (i < tokens.length) {
    const cmd = tokens[i++].toUpperCase();
    switch (cmd) {
      case 'M': {
        pos = { x: num(), y: num() };
        cur = { kind: 'path', start: pos, segs: [] };
        strokes.push(cur);
        break;
      }
      case 'L': {
        pos = { x: num(), y: num() };
        needPath().segs.push({ t: 'L', p: pos });
        break;
      }
      case 'H': {
        pos = { x: num(), y: pos.y };
        needPath().segs.push({ t: 'L', p: pos });
        break;
      }
      case 'V': {
        pos = { x: pos.x, y: num() };
        needPath().segs.push({ t: 'L', p: pos });
        break;
      }
      case 'Q': {
        const q = { x: num(), y: num() };
        const p = { x: num(), y: num() };
        needPath().segs.push({ t: 'C', c1: lerp(pos, q, 2 / 3), c2: lerp(p, q, 2 / 3), p });
        pos = p;
        break;
      }
      case 'C': {
        const c1 = { x: num(), y: num() };
        const c2 = { x: num(), y: num() };
        const p = { x: num(), y: num() };
        needPath().segs.push({ t: 'C', c1, c2, p });
        pos = p;
        break;
      }
      case 'Z': {
        needPath().closed = true;
        cur = null;
        break;
      }
      case 'O': {
        lastEllipse = { kind: 'ellipse', c: { x: num(), y: num() }, rx: num(), ry: num() };
        strokes.push(lastEllipse);
        cur = null;
        break;
      }
      case 'K': {
        if (lastEllipse) lastEllipse.keep = num();
        else num();
        break;
      }
      case 'W': {
        const w = num();
        const path = needPath();
        if (path.segs.length) path.segs[path.segs.length - 1].w = w;
        else path.startW = w;
        break;
      }
      default:
        throw new Error(`알 수 없는 명령 ${cmd}`);
    }
  }
  return strokes;
}

const f = (n: number) => String(Math.round(n * 10) / 10);

export function serializeSkeleton(strokes: Stroke[]): string {
  return strokes
    .map((s) => {
      if (s.kind === 'ellipse') {
        return `O ${f(s.c.x)} ${f(s.c.y)} ${f(s.rx)} ${f(s.ry)}` + (s.keep ? ` K ${f(s.keep)}` : '');
      }
      const w = (v: number | undefined) => (v !== undefined && v !== 1 ? ` W ${Math.round(v * 100) / 100}` : '');
      let out = `M ${f(s.start.x)} ${f(s.start.y)}${w(s.startW)}`;
      for (const g of s.segs) {
        out += g.t === 'L'
          ? ` L ${f(g.p.x)} ${f(g.p.y)}`
          : ` C ${f(g.c1.x)} ${f(g.c1.y)} ${f(g.c2.x)} ${f(g.c2.y)} ${f(g.p.x)} ${f(g.p.y)}`;
        out += w(g.w);
      }
      return s.closed ? out + ' Z' : out;
    })
    .join(' ');
}

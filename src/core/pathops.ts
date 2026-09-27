import type { Contour, Pt, Seg } from './types';
import { contourArea, reverseContour } from './outline';
import { cubicAt } from './geom';

/**
 * 겹친 외곽선 합치기(불리언 합집합). Skia PathOps(WASM)를 쓴다.
 * 환경마다 WASM을 불러오는 방법이 달라 초기화는 호출하는 쪽에서 한다.
 */

interface PKPath {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  cubicTo(a: number, b: number, c: number, d: number, e: number, f: number): void;
  close(): void;
  setFillType(t: unknown): void;
  simplify(): PKPath | null;
  toCmds(): number[][];
  delete(): void;
}

export interface PathKit {
  NewPath(): PKPath;
  FillType: { WINDING: unknown };
  MOVE_VERB: number;
  LINE_VERB: number;
  QUAD_VERB: number;
  CONIC_VERB: number;
  CUBIC_VERB: number;
  CLOSE_VERB: number;
}

let kit: PathKit | null = null;

export function setPathKit(pk: PathKit) {
  kit = pk;
}

export const hasPathKit = () => kit !== null;

/** 윤곽들을 합쳐 겹침 없는 윤곽으로. 채움은 반시계, 구멍은 시계 방향으로 정리 */
export function removeOverlaps(contours: Contour[]): Contour[] {
  if (!kit || contours.length === 0) return contours;
  const pk = kit;
  const path = pk.NewPath();
  for (const c of contours) {
    path.moveTo(c.start.x, c.start.y);
    for (const s of c.segs) {
      if (s.t === 'L') path.lineTo(s.p.x, s.p.y);
      else path.cubicTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.p.x, s.p.y);
    }
    path.close();
  }
  path.setFillType(pk.FillType.WINDING);
  const ok = path.simplify();
  if (!ok) {
    path.delete();
    return contours;
  }
  const cmds = path.toCmds();
  path.delete();
  const out: Contour[] = [];
  let cur: Contour | null = null;
  let last: Pt = { x: 0, y: 0 };
  const flush = () => {
    if (cur && cur.segs.length) out.push(cur);
    cur = null;
  };
  for (const c of cmds) {
    const v = c[0];
    if (v === pk.MOVE_VERB) {
      flush();
      last = { x: c[1], y: c[2] };
      cur = { start: last, segs: [] };
    } else if (!cur) {
      continue;
    } else if (v === pk.LINE_VERB) {
      last = { x: c[1], y: c[2] };
      cur.segs.push({ t: 'L', p: last });
    } else if (v === pk.CUBIC_VERB) {
      const seg: Seg = { t: 'C', c1: { x: c[1], y: c[2] }, c2: { x: c[3], y: c[4] }, p: { x: c[5], y: c[6] } };
      cur.segs.push(seg);
      last = seg.p;
    } else if (v === pk.QUAD_VERB || v === pk.CONIC_VERB) {
      // 2차(원뿔) 곡선은 3차로 올린다
      const q = { x: c[1], y: c[2] }, p = { x: c[3], y: c[4] };
      cur.segs.push({
        t: 'C',
        c1: { x: last.x + (2 / 3) * (q.x - last.x), y: last.y + (2 / 3) * (q.y - last.y) },
        c2: { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) },
        p,
      });
      last = p;
    } else if (v === pk.CLOSE_VERB) {
      flush();
    }
  }
  flush();
  return orientByNesting(out);
}

function samplePolygon(c: Contour): Pt[] {
  const pts: Pt[] = [c.start];
  let prev = c.start;
  for (const s of c.segs) {
    if (s.t === 'L') pts.push(s.p);
    else {
      const cb = { p0: prev, c1: s.c1, c2: s.c2, p3: s.p };
      for (let i = 1; i <= 4; i++) pts.push(cubicAt(cb, i / 4));
    }
    prev = s.p;
  }
  return pts;
}

function insidePolygon(q: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** 포함 깊이로 채움(짝수)과 구멍(홀수)을 가려 방향을 맞춘다 */
function orientByNesting(cs: Contour[]): Contour[] {
  const polys = cs.map(samplePolygon);
  return cs.map((c, i) => {
    const probe = polys[i][0];
    let depth = 0;
    for (let j = 0; j < cs.length; j++) if (j !== i && insidePolygon(probe, polys[j])) depth++;
    const hole = depth % 2 === 1;
    const a = contourArea(c);
    return (a < 0) !== hole ? reverseContour(c) : c;
  });
}

import type { Mask } from './raster';

/**
 * 세선화된 중심선(한 픽셀 두께)을 획(점열)으로 추적한다.
 *  - 끝점·갈림점 사이를 따라가 선분을 만든다
 *  - 짧은 곁가지(세선화 잡음)는 잘라 낸다
 *  - 갈림점에서 곧게 이어지는 두 선분은 한 획으로 잇는다(ㅏ의 기둥이 곁줄기에서 끊기지 않도록)
 */

export interface PixelPath {
  pts: { x: number; y: number }[];
  closed: boolean;
}

/** 가로·세로 이웃을 먼저 본다(대각선을 먼저 가면 계단 모서리 픽셀을 건너뛰어 획이 끊긴다) */
const N8 = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]] as const;

interface Edge {
  pts: { x: number; y: number }[];
  /** 양 끝이 닿은 갈림점 무리 번호(-1 = 끝점) */
  a: number;
  b: number;
  alive: boolean;
}

export function traceSkeleton(sk: Mask, spur: number): PixelPath[] {
  const { w, h } = sk;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && sk.data[y * w + x] === 1;
  /** 교차수: 둘레 8칸을 돌며 0→1로 바뀌는 횟수. 1 = 끝점, 2 = 선 위, 3 이상 = 갈림점.
   *  이웃 수로 세면 계단 모양 대각선 픽셀이 갈림점으로 잘못 잡힌다. */
  const RING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0]] as const;
  const deg = (x: number, y: number) => {
    let n = 0, t = 0;
    for (let k = 0; k < 8; k++) {
      const a = on(x + RING[k][0], y + RING[k][1]), b = on(x + RING[k + 1][0], y + RING[k + 1][1]);
      if (a) n++;
      if (!a && b) t++;
    }
    if (n <= 1) return n;
    return t === 0 ? 2 : t;
  };

  // 갈림점 픽셀을 무리로 묶는다
  const junctionId = new Int32Array(w * h).fill(-1);
  let nj = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y) || deg(x, y) < 3 || junctionId[y * w + x] >= 0) continue;
      const stack = [[x, y]];
      junctionId[y * w + x] = nj;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        for (const [dx, dy] of N8) {
          const nx = cx + dx, ny = cy + dy;
          if (on(nx, ny) && deg(nx, ny) >= 3 && junctionId[ny * w + nx] < 0) {
            junctionId[ny * w + nx] = nj;
            stack.push([nx, ny]);
          }
        }
      }
      nj++;
    }
  }
  const isJ = (x: number, y: number) => junctionId[y * w + x] >= 0;

  // 끝점·갈림점에서 출발해 다음 끝점·갈림점까지 따라간다
  const used = new Uint8Array(w * h);
  const edges: Edge[] = [];
  const walk = (sx: number, sy: number, fx: number, fy: number, startJ: number) => {
    const pts = [{ x: sx, y: sy }, { x: fx, y: fy }];
    let px = sx, py = sy, cx = fx, cy = fy;
    used[cy * w + cx] = 1;
    for (let guard = 0; guard < w * h; guard++) {
      if (isJ(cx, cy)) break;
      let next: [number, number] | null = null;
      for (const [dx, dy] of N8) {
        const nx = cx + dx, ny = cy + dy;
        if (!on(nx, ny) || (nx === px && ny === py)) continue;
        if (isJ(nx, ny)) { next = [nx, ny]; break; }
        if (!used[ny * w + nx] && !next) next = [nx, ny];
      }
      if (!next) break;
      px = cx; py = cy;
      [cx, cy] = next;
      pts.push({ x: cx, y: cy });
      if (!isJ(cx, cy)) used[cy * w + cx] = 1;
    }
    const endJ = isJ(cx, cy) ? junctionId[cy * w + cx] : -1;
    edges.push({ pts, a: startJ, b: endJ, alive: true });
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      const d = deg(x, y);
      const j = isJ(x, y);
      if (d !== 1 && !j) continue;
      if (d === 1 && used[y * w + x]) continue;
      if (d === 1) used[y * w + x] = 1;
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy;
        if (!on(nx, ny) || used[ny * w + nx] || (j && isJ(nx, ny))) continue;
        walk(x, y, nx, ny, j ? junctionId[y * w + x] : -1);
      }
    }
  }
  // 남은 픽셀은 갈림점 없는 고리(ㅇ)
  const loops: PixelPath[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y) || used[y * w + x] || isJ(x, y)) continue;
      const pts = [{ x, y }];
      used[y * w + x] = 1;
      let cx = x, cy = y;
      for (let guard = 0; guard < w * h; guard++) {
        let moved = false;
        for (const [dx, dy] of N8) {
          const nx = cx + dx, ny = cy + dy;
          if (on(nx, ny) && !used[ny * w + nx] && !isJ(nx, ny)) {
            used[ny * w + nx] = 1;
            pts.push({ x: nx, y: ny });
            cx = nx; cy = ny;
            moved = true;
            break;
          }
        }
        if (!moved) break;
      }
      // 출발점 곁으로 돌아왔을 때만 닫힌 고리
      const back = pts.length > 4 && Math.abs(cx - x) <= 1 && Math.abs(cy - y) <= 1;
      if (pts.length > 4) loops.push({ pts, closed: back });
    }
  }

  // 짧은 곁가지 자르기(한쪽이 끝점인 짧은 선분)
  for (const e of edges) {
    if (e.pts.length < spur && (e.a < 0) !== (e.b < 0)) e.alive = false;
  }

  // 갈림점에서 곧게 이어지는 선분끼리 잇기
  const dirAt = (e: Edge, atStart: boolean) => {
    const n = Math.min(e.pts.length - 1, 6);
    const p0 = atStart ? e.pts[0] : e.pts[e.pts.length - 1];
    const p1 = atStart ? e.pts[n] : e.pts[e.pts.length - 1 - n];
    const l = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    return { x: (p1.x - p0.x) / l, y: (p1.y - p0.y) / l };
  };
  for (let j = 0; j < nj; j++) {
    let merged = true;
    while (merged) {
      merged = false;
      const inc = edges.filter((e) => e.alive && (e.a === j || e.b === j));
      let best: [Edge, Edge, number] | null = null;
      for (let i = 0; i < inc.length; i++) {
        for (let k = i + 1; k < inc.length; k++) {
          const e1 = inc[i], e2 = inc[k];
          if (e1 === e2) continue;
          const d1 = dirAt(e1, e1.a === j), d2 = dirAt(e2, e2.a === j);
          const dot = d1.x * d2.x + d1.y * d2.y;
          if (dot < -0.75 && (!best || dot < best[2])) best = [e1, e2, dot];
        }
      }
      if (best) {
        const [e1, e2] = best;
        const p1 = e1.b === j ? e1.pts : [...e1.pts].reverse();
        const p2 = e2.a === j ? e2.pts : [...e2.pts].reverse();
        const other1 = e1.b === j ? e1.a : e1.b;
        const other2 = e2.a === j ? e2.b : e2.a;
        e1.alive = false;
        e2.alive = false;
        edges.push({ pts: [...p1, ...p2.slice(1)], a: other1, b: other2, alive: true });
        merged = true;
      }
    }
  }

  const out: PixelPath[] = edges.filter((e) => e.alive && e.pts.length >= 2).map((e) => ({ pts: e.pts, closed: false }));
  return [...out, ...loops];
}

import type { Pt } from '../types';
import { binarize, distanceTransform, otsu, removeSpecks, thin, type Gray, type Mask } from './raster';
import { traceSkeleton } from './trace';
import { cellBoxMM, frameToEm, MARKERS_MM, type EmFrame } from './template';
import type { InkBlob, InkLine } from './fit';

// ───────────────────────── 원근 보정(호모그래피) ─────────────────────────

/** 네 점 쌍으로 src → dst 호모그래피(3×3, 행 우선) */
export function homography(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // 가우스 소거
  const n = 8;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    const d = A[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / d;
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [...h, 1];
}

export function applyH(H: number[], p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

function sample(g: Gray, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= g.w || y0 + 1 >= g.h) return 255;
  const fx = x - x0, fy = y - y0;
  const i = y0 * g.w + x0;
  const a = g.data[i], b = g.data[i + 1], c = g.data[i + g.w], d = g.data[i + g.w + 1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

// ───────────────────────── 모서리 표식 찾기 ─────────────────────────

/**
 * 인쇄된 네 모서리의 검은 네모를 찾는다. 사진의 네 귀퉁이에 가장 가까운 네모 후보를 고른다.
 * 찾지 못하면 null — 사용자가 손으로 맞춘다.
 */
export function detectMarkers(g: Gray): Pt[] | null {
  const scale = Math.min(1, 900 / Math.max(g.w, g.h));
  const w = Math.max(1, Math.round(g.w * scale)), h = Math.max(1, Math.round(g.h * scale));
  const small = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) small[y * w + x] = sample(g, x / scale, y / scale);
  const sg: Gray = { w, h, data: small };
  const t = otsu(sg);
  const seen = new Uint8Array(w * h);
  const cands: { cx: number; cy: number; size: number }[] = [];
  const minDim = Math.min(w, h);
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || small[i] > t) continue;
    const stack = [i];
    seen[i] = 1;
    let area = 0, sx = 0, sy = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p / w) | 0;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || seen[q] || small[q] > t) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const fillRatio = area / (bw * bh);
    const aspect = bw / bh;
    if (fillRatio > 0.7 && aspect > 0.6 && aspect < 1.6 && bw > minDim * 0.012 && bw < minDim * 0.1) {
      cands.push({ cx: sx / area, cy: sy / area, size: bw });
    }
  }
  if (cands.length < 4) return null;
  const corners = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: 0, y: h }, { x: w, y: h }];
  const picked = corners.map((c) => {
    let best = cands[0], bd = Infinity;
    for (const k of cands) {
      const d = Math.hypot(k.cx - c.x, k.cy - c.y);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  });
  if (new Set(picked).size < 4) return null;
  return picked.map((k) => ({ x: k.cx / scale, y: k.cy / scale }));
}

/** 종이(mm) → 사진(px) 호모그래피 */
export function sheetToImage(markersPx: Pt[]): number[] {
  return homography(MARKERS_MM, markersPx);
}

// ───────────────────────── 칸 잘라내기 · 벡터화 ─────────────────────────

export const PX_PER_MM = 9;
/** 칸 테두리(연한 안내선)를 피하려고 안쪽으로 줄이는 폭(mm) */
const BORDER_MM = 0.7;

export function extractCell(g: Gray, H: number[], index: number): Gray {
  const box = cellBoxMM(index);
  const n = Math.round(box.size * PX_PER_MM);
  const data = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / PX_PER_MM, v = (j + 0.5) / PX_PER_MM;
      const inBorder = u < BORDER_MM || v < BORDER_MM || u > box.size - BORDER_MM || v > box.size - BORDER_MM;
      const p = applyH(H, { x: box.x + u, y: box.y + v });
      data[j * n + i] = inBorder ? 255 : sample(g, p.x, p.y);
    }
  }
  return { w: n, h: n, data };
}

/** 8방향 연결 성분 번호(0 = 배경, 1.. = 덩어리) */
function label(m: Mask): { ids: Int32Array; count: number } {
  const { w, h } = m;
  const ids = new Int32Array(w * h);
  let count = 0;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!m.data[i] || ids[i]) continue;
    count++;
    ids[i] = count;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (m.data[q] && !ids[q]) {
            ids[q] = count;
            stack.push(q);
          }
        }
      }
    }
  }
  return { ids, count };
}

/** 칸 이미지 → 칸 좌표(폰트 단위)의 획들 */
export function vectorizeCell(cell: Gray, frame: EmFrame): { lines: InkLine[]; blobs: InkBlob[]; mask: Mask; skeleton: Mask } {
  const toEm = (x: number, y: number) => frameToEm(frame, (x + 0.5) / cell.w, (y + 0.5) / cell.h);
  return vectorizeMask(binarize(cell), toEm, frame.size / cell.w);
}

/**
 * 잉크 마스크 → 획(중심선)·잉크 덩어리.
 * @param toEm 픽셀 좌표 → 폰트 좌표
 * @param emPerPx 픽셀 하나의 폰트 단위 크기(획 반폭 환산용)
 */
export function vectorizeMask(raw: Mask, toEm: (x: number, y: number) => Pt, emPerPx: number): { lines: InkLine[]; blobs: InkBlob[]; mask: Mask; skeleton: Mask; pixels: { x: number; y: number }[][] } {
  const cell = { w: raw.w, h: raw.h };
  // 1차: 아주 작은 잡티만 지운 뒤 펜 굵기를 잰다
  let mask = removeSpecks(raw, 4);
  let dt = distanceTransform(mask);
  let skeleton = thin(mask);
  const skDt: number[] = [];
  for (let i = 0; i < skeleton.data.length; i++) if (skeleton.data[i]) skDt.push(dt[i]);
  skDt.sort((a, b) => a - b);
  const medHW = skDt.length ? skDt[Math.floor(skDt.length / 2)] : 1;
  // 2차: 펜으로 찍은 점보다 작은 것만 잡티로 본다
  mask = removeSpecks(raw, Math.max(4, Math.round(Math.PI * medHW * medHW * 0.5)));
  dt = distanceTransform(mask);
  skeleton = thin(mask);
  const { ids, count } = label(mask);

  const paths = traceSkeleton(skeleton, Math.max(3, Math.round(medHW * 1.3)));
  // 끝이 거의 맞닿은 긴 획은 닫힌 고리(ㅇ·ㅁ)로 본다
  for (const p of paths) {
    const a = p.pts[0], b = p.pts[p.pts.length - 1];
    if (!p.closed && p.pts.length > medHW * 10 && Math.hypot(a.x - b.x, a.y - b.y) < medHW * 3) {
      p.closed = true;
      p.pts.pop();
    }
  }
  const kept = paths.filter((p) => p.closed || p.pts.length >= 3);
  /** 획마다 원래 픽셀 좌표(자모별로 잉크를 나눌 때 씨앗으로 쓴다) */
  const pixels: { x: number; y: number }[][] = kept.map((p) => p.pts);
  const lines: InkLine[] = kept
    .map((p) => ({
      closed: p.closed,
      blob: ids[p.pts[0].y * cell.w + p.pts[0].x] || undefined,
      pts: p.pts.map((q) => toEm(q.x, q.y)),
      hw: p.pts.map((q) => Math.max(0.5, dt[q.y * cell.w + q.x]) * emPerPx),
    }));

  // 선이 하나도 나오지 않은 작은 덩어리는 점으로
  const blobsWithLine = new Set(lines.map((l) => l.blob));
  const sums = new Map<number, { sx: number; sy: number; n: number; maxDt: number }>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id) continue;
    const s = sums.get(id) ?? { sx: 0, sy: 0, n: 0, maxDt: 0 };
    s.sx += i % cell.w; s.sy += (i / cell.w) | 0; s.n++; s.maxDt = Math.max(s.maxDt, dt[i]);
    sums.set(id, s);
  }
  for (const [id, s] of sums) {
    if (blobsWithLine.has(id)) continue;
    const c = toEm(s.sx / s.n, s.sy / s.n);
    lines.push({ blob: id, pts: [c], hw: [Math.max(0.5, s.maxDt) * emPerPx] });
    pixels.push([{ x: Math.round(s.sx / s.n), y: Math.round(s.sy / s.n) }]);
  }

  // 덩어리마다 픽셀을 성기게 뽑아 둔다(자모 자리 판단용)
  const blobs: InkBlob[] = [];
  const step = Math.max(1, Math.round(medHW));
  const samples = new Map<number, Pt[]>();
  for (let y = 0; y < cell.h; y += step) {
    for (let x = 0; x < cell.w; x += step) {
      const id = ids[y * cell.w + x];
      if (!id) continue;
      if (!samples.has(id)) samples.set(id, []);
      samples.get(id)!.push(toEm(x, y));
    }
  }
  for (let id = 1; id <= count; id++) if (samples.has(id)) blobs.push({ id, samples: samples.get(id)! });
  return { lines, blobs, mask, skeleton, pixels };
}

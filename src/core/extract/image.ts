import type { Mask } from '../handwriting/raster';

/**
 * 이미지 속 글씨를 뽑기 위한 전처리.
 *  - 낱말 영역을 잘라 크게 늘리고
 *  - 색 묶음으로 배경·글자·테두리를 가려 글자만 잉크로 남긴다(흰 글자 + 분홍 테두리 같은 경우도)
 *  - 낱말을 음절(글자) 단위로 자른다
 */

export interface RGBA {
  w: number;
  h: number;
  /** RGBA 순서, 픽셀당 4바이트 */
  data: Uint8ClampedArray | Uint8Array;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 영역을 잘라 scale배로 늘린다(쌍선형 보간) */
export function cropScale(img: RGBA, b: Box, scale: number): RGBA {
  const w = Math.max(1, Math.round((b.x1 - b.x0) * scale));
  const h = Math.max(1, Math.round((b.y1 - b.y0) * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.h - 1.001, Math.max(0, b.y0 + (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sy), fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.w - 1.001, Math.max(0, b.x0 + (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sx), fx = sx - x0;
      const i00 = (y0 * img.w + x0) * 4, i10 = i00 + 4, i01 = i00 + img.w * 4, i11 = i01 + 4;
      for (let c = 0; c < 4; c++) {
        out[(y * w + x) * 4 + c] =
          img.data[i00 + c] * (1 - fx) * (1 - fy) + img.data[i10 + c] * fx * (1 - fy) +
          img.data[i01 + c] * (1 - fx) * fy + img.data[i11 + c] * fx * fy;
      }
    }
  }
  return { w, h, data: out };
}

type RGB = [number, number, number];
const SHARPEN_AMOUNT = 1.2;
const dist2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/**
 * 글자 잉크 마스크.
 * 테두리 픽셀로 배경색을 잡고, 색 묶음(k=3) 중 배경과 가장 먼 묶음을 글자색으로 본다.
 * 배경→글자색 축으로 절반 넘게 다가간 픽셀만 잉크로 남겨, 테두리·그림자·안티앨리어싱을 걸러 낸다.
 */
/** 분리형 가우시안 흐림 */
function gaussBlur(v: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r] * v[y * w + Math.min(w - 1, Math.max(0, x + i))];
      tmp[y * w + x] = a;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x];
      out[y * w + x] = a;
    }
  }
  return out;
}

/**
 * @param sharpen 원본 한 픽셀의 크기(늘린 이미지 픽셀). 주면 그 크기로 언샤프 마스크를 걸어,
 *   흐린 이미지에서 회색으로 메워진 좁은 틈(ㅐ의 두 기둥 사이 등)을 되살린다.
 */
export function textMask(img: RGBA, sharpen = 0): { mask: Mask; field: Float32Array; text: RGB; bg: RGB } {
  const { w, h, data } = img;
  const px = (i: number): RGB => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
  const border: RGB[] = [];
  for (let x = 0; x < w; x++) border.push(px(x), px((h - 1) * w + x));
  for (let y = 0; y < h; y++) border.push(px(y * w), px(y * w + w - 1));
  const med = (k: 0 | 1 | 2) => border.map((c) => c[k]).sort((a, b) => a - b)[border.length >> 1];
  const bg: RGB = [med(0), med(1), med(2)];

  // 배경에서 가장 먼 색으로 글자색 초기값, 그 중간을 세 번째 묶음으로
  let far: RGB = bg, fd = -1;
  for (let i = 0; i < w * h; i += 3) {
    const c = px(i);
    const d = dist2(c, bg);
    if (d > fd) { fd = d; far = c; }
  }
  let cents: RGB[] = [bg, far, [(bg[0] + far[0]) / 2, (bg[1] + far[1]) / 2, (bg[2] + far[2]) / 2]];
  for (let it = 0; it < 8; it++) {
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < w * h; i += 2) {
      const c = px(i);
      let bi = 0, bd = Infinity;
      cents.forEach((k, j) => { const d = dist2(c, k); if (d < bd) { bd = d; bi = j; } });
      acc[bi][0] += c[0]; acc[bi][1] += c[1]; acc[bi][2] += c[2]; acc[bi][3]++;
    }
    cents = cents.map((k, j) => (acc[j][3] ? [acc[j][0] / acc[j][3], acc[j][1] / acc[j][3], acc[j][2] / acc[j][3]] as RGB : k));
    cents[0] = bg; // 배경은 고정
  }
  const counts = cents.map(() => 0);
  for (let i = 0; i < w * h; i += 2) {
    const c = px(i);
    let bi = 0, bd = Infinity;
    cents.forEach((k, j) => { const d = dist2(c, k); if (d < bd) { bd = d; bi = j; } });
    counts[bi]++;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  let text = cents[1], td = -1;
  cents.forEach((k, j) => {
    if (j === 0 || counts[j] < total * 0.03) return;
    const d = dist2(k, bg);
    if (d > td) { td = d; text = k; }
  });

  // 묶음 평균은 번진 가장자리까지 섞여 실제 글자색보다 옅다 → 글자 속(진한 쪽 상위값)으로 다시 잡는다
  {
    const a0 = [text[0] - bg[0], text[1] - bg[1], text[2] - bg[2]];
    const n2 = a0[0] ** 2 + a0[1] ** 2 + a0[2] ** 2 || 1;
    const ts: number[] = [];
    for (let i = 0; i < w * h; i++) {
      const c = px(i);
      const t = ((c[0] - bg[0]) * a0[0] + (c[1] - bg[1]) * a0[1] + (c[2] - bg[2]) * a0[2]) / n2;
      if (t > 0.6) ts.push(t);
    }
    if (ts.length > 20) {
      ts.sort((a, b) => a - b);
      const k = ts[Math.floor(ts.length * 0.7)];
      if (k > 1) text = [bg[0] + a0[0] * k, bg[1] + a0[1] * k, bg[2] + a0[2] * k];
    }
  }
  const ax = [text[0] - bg[0], text[1] - bg[1], text[2] - bg[2]];
  const l2 = ax[0] ** 2 + ax[1] ** 2 + ax[2] ** 2 || 1;
  const mask = new Uint8Array(w * h);
  // 글자다움(0 = 배경, 1 = 글자색): 외곽선을 소수점 픽셀 단위로 딸 때 쓴다
  let field = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const c = px(i);
    field[i] = Math.max(-0.2, Math.min(1.2, ((c[0] - bg[0]) * ax[0] + (c[1] - bg[1]) * ax[1] + (c[2] - bg[2]) * ax[2]) / l2));
  }
  if (sharpen > 0) {
    const b = gaussBlur(field, w, h, sharpen);
    const sh = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) sh[i] = field[i] + SHARPEN_AMOUNT * (field[i] - b[i]);
    field = sh;
  }
  for (let i = 0; i < w * h; i++) {
    mask[i] = field[i] >= 0.5 ? 1 : 0;
    field[i] = Math.max(0, Math.min(1, field[i]));
  }
  return { mask: { w, h, data: mask }, field, text, bg };
}

/** 글자 하나의 가로 폭 비율(자르기 위치 추정용) */
function expectedWidth(ch: string): number {
  const c = ch.codePointAt(0)!;
  if (c >= 0xac00 && c <= 0xd7a3) return 1;
  if (/[A-Z]/.test(ch)) return 0.68;
  if (/[a-z]/.test(ch)) return 0.55;
  if (/[0-9]/.test(ch)) return 0.58;
  return 0.3;
}

export interface GlyphCut {
  ch: string;
  /** 글자 잉크의 테두리 상자(잘라 늘린 이미지 좌표) */
  box: Box;
}

/**
 * 낱말 마스크를 글자로 자른다. 띄어쓰기는 가장 넓은 빈 틈으로 먼저 나누고,
 * 각 덩어리 안에서는 글자 수와 대략의 폭 비율로 예상 경계를 잡아
 * 그 근처의 빈 세로줄(없으면 잉크가 가장 적은 세로줄)에서 자른다.
 */
export function splitGlyphs(m: Mask, text: string): GlyphCut[] {
  const cols = new Array(m.w).fill(0);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) cols[x] += m.data[y * m.w + x];
  let xmin = 0, xmax = m.w - 1;
  while (xmin < m.w && cols[xmin] === 0) xmin++;
  while (xmax > 0 && cols[xmax] === 0) xmax--;
  if (xmin >= xmax) return [];
  const chunks = text.trim().split(/ +/);
  // 빈 세로줄 구간들 중 가장 넓은 (띄어쓰기 수)개
  const runs: { a: number; b: number }[] = [];
  for (let x = xmin; x <= xmax; x++) {
    if (cols[x] !== 0) continue;
    let e = x;
    while (e + 1 <= xmax && cols[e + 1] === 0) e++;
    runs.push({ a: x, b: e });
    x = e;
  }
  const spaces = runs.sort((p, q) => q.b - q.a - (p.b - p.a)).slice(0, chunks.length - 1).sort((p, q) => p.a - q.a);
  if (spaces.length < chunks.length - 1) return splitRange(m, cols, [...text.replace(/ /g, '')], xmin, xmax);
  const out: GlyphCut[] = [];
  chunks.forEach((chunk, i) => {
    const a = i === 0 ? xmin : spaces[i - 1].b + 1;
    const b = i === chunks.length - 1 ? xmax : spaces[i].a - 1;
    out.push(...splitRange(m, cols, [...chunk], a, b));
  });
  return out;
}

function splitRange(m: Mask, cols: number[], chars: string[], xmin: number, xmax: number): GlyphCut[] {
  const n = chars.length;
  const widths = chars.map(expectedWidth);
  const total = widths.reduce((a, b) => a + b, 0);
  const avg = (xmax - xmin + 1) / total;
  const peak = Math.max(1, ...cols.slice(xmin, xmax + 1));
  // 자를 위치 비용: 빈 세로줄은 0, 잉크가 있으면 양에 비례
  const cutCost = (x: number) => (cols[x] === 0 ? 0 : 1 + (cols[x] / peak) * 4);
  // 글자 폭 비용: 예상 폭에서 벗어난 비율(폭 짐작은 거칠어서 약하게)
  const widthCost = (i: number, len: number) => {
    const e = avg * widths[i];
    return 1.2 * ((len - e) / e) ** 2;
  };
  // 동적 계획법: best[i][x] = 앞 i글자를 xmin..x-1에 넣고 x에서 자를 때의 최소 비용
  const W = xmax - xmin + 2;
  const INF = 1e18;
  let prev = new Float64Array(W).fill(INF);
  prev[0] = 0;
  const from: Int32Array[] = [];
  for (let i = 0; i < n; i++) {
    const cur = new Float64Array(W).fill(INF);
    const back = new Int32Array(W).fill(-1);
    const last = i === n - 1;
    for (let b = 1; b < W; b++) {
      if (last && b !== W - 1) continue;
      const cb = last ? 0 : cutCost(xmin + b);
      for (let a = 0; a < b; a++) {
        if (prev[a] >= INF) continue;
        const v = prev[a] + widthCost(i, b - a) + cb;
        if (v < cur[b]) { cur[b] = v; back[b] = a; }
      }
    }
    from.push(back);
    prev = cur;
  }
  const edges = new Array(n + 1);
  edges[n] = W - 1;
  for (let i = n - 1; i >= 0; i--) edges[i] = from[i][edges[i + 1]];
  for (let i = 0; i <= n; i++) edges[i] = xmin + Math.max(0, edges[i]);
  const out: GlyphCut[] = [];
  chars.forEach((ch, i) => {
    const x0 = edges[i], x1 = edges[i + 1];
    let y0 = m.h, y1 = -1, gx0 = x1, gx1 = x0 - 1;
    for (let y = 0; y < m.h; y++) {
      for (let x = x0; x < x1; x++) {
        if (!m.data[y * m.w + x]) continue;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (x < gx0) gx0 = x;
        if (x > gx1) gx1 = x;
      }
    }
    if (y1 >= y0) out.push({ ch, box: { x0: gx0, y0, x1: gx1 + 1, y1: y1 + 1 } });
  });
  return out;
}

/** 마스크의 일부 영역만 남긴 사본(영역 밖은 0) */
export function subMask(m: Mask, b: Box, pad = 2): { mask: Mask; ox: number; oy: number } {
  const x0 = Math.max(0, b.x0 - pad), y0 = Math.max(0, b.y0 - pad);
  const x1 = Math.min(m.w, b.x1 + pad), y1 = Math.min(m.h, b.y1 + pad);
  const w = x1 - x0, h = y1 - y0;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x0 + x, sy = y0 + y;
      data[y * w + x] = sx >= b.x0 && sx < b.x1 ? m.data[sy * m.w + sx] : 0;
    }
  }
  return { mask: { w, h, data }, ox: x0, oy: y0 };
}

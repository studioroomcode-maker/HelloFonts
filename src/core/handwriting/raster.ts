/**
 * 손글씨 이미지 처리: 회색조 → 이진화 → 잡티 제거 → 거리 변환 → 세선화(중심선)
 * 브라우저·Node 어디서나 돌도록 순수 배열 연산만 쓴다.
 */

export interface Gray {
  w: number;
  h: number;
  /** 0(검정)..255(흰색) */
  data: Uint8Array;
}

export interface Mask {
  w: number;
  h: number;
  /** 1 = 잉크 */
  data: Uint8Array;
}

/** RGBA → 회색조. 연한 색 안내선(채도가 높고 밝은 색)은 종이로 본다 */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    // 밝고 색이 뚜렷한 픽셀(분홍·하늘색 안내선)은 흰색 쪽으로 민다
    out[i] = sat > 40 && y > 150 ? 255 : Math.round(y);
  }
  return { w, h, data: out };
}

/** 오츠 방법으로 잉크/종이 경계값 */
export function otsu(g: Gray): number {
  const hist = new Array(256).fill(0);
  for (const v of g.data) hist[v]++;
  const total = g.data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

/**
 * 이진화. 칸에 잉크가 거의 없으면(대비가 약하면) 빈 마스크를 돌려준다.
 */
export function binarize(g: Gray, minContrast = 60): Mask {
  const t = otsu(g);
  let dark = 0, light = 0, nd = 0, nl = 0;
  for (const v of g.data) {
    if (v <= t) { dark += v; nd++; } else { light += v; nl++; }
  }
  const out = new Uint8Array(g.w * g.h);
  const contrast = (nl ? light / nl : 255) - (nd ? dark / nd : 0);
  if (nd === 0 || contrast < minContrast || nd > g.data.length * 0.5) return { w: g.w, h: g.h, data: out };
  // 경계값을 종이 쪽으로 살짝 옮겨 가는 획 끝을 살린다
  const thr = Math.min(t + contrast * 0.1, 235);
  for (let i = 0; i < out.length; i++) out[i] = g.data[i] <= thr ? 1 : 0;
  return { w: g.w, h: g.h, data: out };
}

/** 8방향 연결 성분 중 작은 것(잡티) 제거 */
export function removeSpecks(m: Mask, minArea: number): Mask {
  const { w, h } = m;
  const out = new Uint8Array(m.data);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!out[i] || seen[i]) continue;
    const comp: number[] = [];
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (out[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    if (comp.length < minArea) for (const p of comp) out[p] = 0;
  }
  return { w, h, data: out };
}

/** 가장 가까운 종이까지의 거리(체스판 거리의 근사: 3-4 챔퍼) — 획 반폭 측정용 */
export function distanceTransform(m: Mask): Float32Array {
  const { w, h } = m;
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = m.data[i] ? INF : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  for (let i = 0; i < w * h; i++) d[i] /= 3;
  return d;
}

/** Zhang–Suen 세선화: 잉크를 한 픽셀 두께의 중심선으로 */
export function thin(m: Mask): Mask {
  const { w, h } = m;
  const img = new Uint8Array(m.data);
  const P = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]);
  let changed = true;
  const del: number[] = [];
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!img[y * w + x]) continue;
          const p2 = P(x, y - 1), p3 = P(x + 1, y - 1), p4 = P(x + 1, y), p5 = P(x + 1, y + 1);
          const p6 = P(x, y + 1), p7 = P(x - 1, y + 1), p8 = P(x - 1, y), p9 = P(x - 1, y - 1);
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let a = 0;
          for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) a++;
          if (a !== 1) continue;
          if (pass === 0 ? p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0 : p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
          del.push(y * w + x);
        }
      }
      if (del.length) changed = true;
      for (const i of del) img[i] = 0;
    }
  }
  return { w, h, data: img };
}

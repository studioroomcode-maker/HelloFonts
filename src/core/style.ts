import type { Params, PathStroke, Pt, Seg, Stroke } from './types';
import type { StrokeStyle } from './outline';
import { cubicTangent, lineAsCubic } from './geom';

export function strokeStyle(p: Params, latin: boolean, centerY: number): StrokeStyle {
  return {
    weight: p.weight,
    cap: p.cap,
    join: p.join,
    contrast: p.contrast,
    penAngle: p.penAngle,
    pressureStart: p.pressureStart,
    pressureMid: p.pressureMid,
    pressureEnd: p.pressureEnd,
    serif: p.serif,
    serifSize: p.serifSize,
    latin,
    centerY,
  };
}

// ───────────────────────── 재현 가능한 난수 ─────────────────────────

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────── 변형 도우미 ─────────────────────────

function mapStroke(s: Stroke, f: (p: Pt) => Pt): Stroke {
  if (s.kind === 'ellipse') return { ...s, c: f(s.c) };
  return {
    ...s,
    start: f(s.start),
    segs: s.segs.map((g) => (g.t === 'L' ? { ...g, p: f(g.p) } : { ...g, c1: f(g.c1), c2: f(g.c2), p: f(g.p) })),
  };
}

function endTangent(s: PathStroke): Pt | null {
  const n = s.segs.length;
  if (!n) return null;
  const g = s.segs[n - 1];
  const a = n > 1 ? s.segs[n - 2].p : s.start;
  const c = g.t === 'L' ? lineAsCubic(a, g.p) : { p0: a, c1: g.c1, c2: g.c2, p3: g.p };
  return cubicTangent(c, 1);
}

export interface StylizeCtx {
  /** 글자(흔들림 난수의 씨앗) */
  ch: string;
  /** strokes[0]이 글자 전체에서 몇 번째 획인지(부분만 그릴 때 흔들림을 맞추기 위해) */
  strokeOffset?: number;
  latin: boolean;
  /** 글자 중심(흔들림 회전 기준) */
  center: Pt;
}

/**
 * 외곽선을 만들기 전에 뼈대(폰트 단위)에 스타일을 입힌다.
 *  - 명조: 꼭지이응, 사선 획 끝의 삐침(가늘어짐)
 *  - 손글씨: 점 흔들림, 글자별 기울어짐
 */
export function stylizeStrokes(strokes: Stroke[], p: Params, ctx: StylizeCtx): Stroke[] {
  let out = strokes;
  const S = p.serifSize * p.weight;

  if (p.serif === 'myeongjo' && !ctx.latin) {
    const extra: Stroke[] = [];
    out = out.map((s) => {
      if (s.kind === 'ellipse') {
        if (!p.kkokji || !s.ieung) return s;
        // 꼭지이응: 원을 조금 줄이고 위에 짧은 꼭지를 세운다
        const shrink = Math.min(S * 0.4, s.ry * 0.3);
        const e = { ...s, c: { x: s.c.x, y: s.c.y - shrink }, ry: s.ry - shrink };
        const top = e.c.y + e.ry;
        extra.push({ kind: 'path', start: { x: e.c.x + S * 0.06, y: top + shrink * 2 }, startW: 0.8, segs: [{ t: 'L', p: { x: e.c.x, y: top } }] });
        return e;
      }
      // 아래로 비껴 내려가는 획 끝(삐침)은 가늘게
      const t = endTangent(s);
      if (!t || t.y > -0.25 || Math.abs(t.x) < 0.3) return s;
      const segs = [...s.segs];
      const last = segs[segs.length - 1];
      segs[segs.length - 1] = { ...last, w: (last.w ?? 1) * 0.35 } as Seg;
      return { ...s, segs };
    });
    out = [...out, ...extra];
  }

  if (p.jitter > 0 || p.wobble > 0) {
    const j = p.jitter;
    const base = ctx.strokeOffset ?? 0;
    out = out.map((s, si) => {
      // 획마다 따로 씨앗을 두어, 일부 획만 그려도 같은 모양이 나오게 한다
      const r = rng(hashString(`${p.seed}:${ctx.ch}:${base + si}`));
      const jit = () => (r() - 0.5) * 2 * j;
      if (s.kind === 'ellipse') {
        return { ...s, c: { x: s.c.x + jit(), y: s.c.y + jit() }, rx: Math.max(4, s.rx + jit() * 0.6), ry: Math.max(4, s.ry + jit() * 0.6) };
      }
      const moveBy = () => ({ x: jit(), y: jit() });
      let d = moveBy();
      const start = { x: s.start.x + d.x, y: s.start.y + d.y };
      let prevD = d;
      const segs = s.segs.map((g): Seg => {
        d = moveBy();
        const wj = j > 0 ? 1 + (r() - 0.5) * 0.3 : 1;
        const w = (g.w ?? 1) * wj;
        if (g.t === 'L') return { ...g, p: { x: g.p.x + d.x, y: g.p.y + d.y }, w };
        const out: Seg = {
          ...g,
          c1: { x: g.c1.x + prevD.x, y: g.c1.y + prevD.y },
          c2: { x: g.c2.x + d.x, y: g.c2.y + d.y },
          p: { x: g.p.x + d.x, y: g.p.y + d.y },
          w,
        };
        prevD = d;
        return out;
      });
      return { ...s, start, segs };
    });
    if (p.wobble > 0) {
      const r = rng(hashString(`${p.seed}:${ctx.ch}:wobble`));
      const a = ((r() - 0.5) * 2 * p.wobble * Math.PI) / 180;
      const dy = (r() - 0.5) * j;
      const { x: cx, y: cy } = ctx.center;
      const cos = Math.cos(a), sin = Math.sin(a);
      out = out.map((s) =>
        mapStroke(s, (q) => ({ x: cx + (q.x - cx) * cos - (q.y - cy) * sin, y: cy + (q.x - cx) * sin + (q.y - cy) * cos + dy })),
      );
    }
  }
  return out;
}

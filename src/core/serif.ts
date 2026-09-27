import type { Pt, SerifStyle } from './types';

/**
 * 획 끝 장식(부리·맺음·세리프)을 "획의 폭 변화"로 표현한다.
 *
 * 따로 그린 도형을 획 끝에 붙이는 방식은 획이 조금만 기울거나 굵기가 변해도 어긋난다.
 * 여기서는 장식을 획 자신의 좌우 폭 함수와 끝 자름선으로 나타낸다.
 *  - 획의 진행 방향을 기준으로 정의하므로 획이 기울면 장식도 함께 기운다.
 *  - 획 외곽선과 한 몸으로 계산되므로 이음새·계단이 생기지 않는다.
 *  - 가로획용 장식과 세로획용 장식을 획의 각도에 따라 부드럽게 섞는다(경계에서 갑자기 바뀌지 않음).
 */

/** 획 끝 하나의 정보 */
export interface StrokeEnd {
  p: Pt;
  /** 획이 진행하는 방향(단위 벡터) */
  dir: Pt;
  /** 끝점에서 획의 반폭 */
  hw: number;
  at: 'start' | 'end';
  /** 획 전체 길이 */
  length: number;
  /** 끝 구간이 직선인지 */
  straight: boolean;
}

export interface SerifStyleInput {
  serif: SerifStyle;
  serifSize: number;
  weight: number;
  latin: boolean;
  centerY: number;
}

/** side: +1 = 진행 방향의 왼쪽(왼쪽 법선 쪽), -1 = 오른쪽 */
export type Side = 1 | -1;

export interface EndDeco {
  /** 끝에서 거리 d(폰트 단위)인 곳에서 그 옆의 반폭에 곱해 더할 비율(0 = 변화 없음) */
  bump: (side: Side, d: number) => number;
  /** 끝 자름선: 각 옆 가장자리가 바깥쪽으로 더 나가는 길이(폰트 단위, 음수면 덜 나감) */
  ext: Record<Side, number>;
  /** 폭 변화가 미치는 거리(이보다 멀면 0) */
  reach: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** 끝에서 가장 크고 안쪽으로 오목하게 줄어드는 모양(부리·브래킷) */
const falloff = (d: number, len: number) => (d >= len ? 0 : (1 - d / len) ** 2);
/** 끝에서 조금 안쪽에 솟는 봉우리(맺음) */
const bell = (d: number, c: number, w: number) => Math.exp(-(((d - c) / w) ** 2));

const leftNormal = (t: Pt): Pt => ({ x: -t.y, y: t.x });

interface Profile {
  bump: (side: Side, d: number) => number;
  ext: Record<Side, number>;
  reach: number;
}

const NONE: Profile = { bump: () => 0, ext: { 1: 0, [-1]: 0 } as Record<Side, number>, reach: 0 };

function blend(a: Profile, wa: number, b: Profile, wb: number): EndDeco | null {
  if (wa < 0.01 && wb < 0.01) return null;
  return {
    bump: (s, d) => wa * a.bump(s, d) + wb * b.bump(s, d),
    ext: { 1: wa * a.ext[1] + wb * b.ext[1], [-1]: wa * a.ext[-1] + wb * b.ext[-1] } as Record<Side, number>,
    reach: Math.max(wa > 0.01 ? a.reach : 0, wb > 0.01 ? b.reach : 0),
  };
}

/** 이 끝에 붙일 장식. 없으면 null */
export function endDecoration(e: StrokeEnd, s: SerifStyleInput): EndDeco | null {
  if (s.serif === 'none') return null;
  const t = e.dir;
  const out = e.at === 'start' ? { x: -t.x, y: -t.y } : t;
  const n = leftNormal(t);
  const W = e.hw * 2; // 끝에서의 획 굵기
  const h = e.hw;
  // 옆 고르기: 위쪽 옆(가로획), 보는 사람 기준 왼쪽 옆(세로획)
  const upper: Side = n.y >= 0 ? 1 : -1;
  const viewerLeft: Side = n.x <= 0 ? 1 : -1;
  const side = (target: Side, v: number) => (sd: Side) => (sd === target ? v : 0);
  const ext = (a: number, b: number, first: Side): Record<Side, number> =>
    ({ [first]: a, [-first]: b }) as Record<Side, number>;
  // 가로·세로 정도(0..1). 그 사이 각도에서는 두 장식이 부드럽게 섞이며 옅어진다
  const wH = smooth((Math.abs(t.x) - 0.6) / 0.3);
  const wV = smooth((Math.abs(t.y) - 0.6) / 0.3);
  const A = s.serifSize;

  if (s.serif === 'myeongjo' && !s.latin) {
    let H: Profile = NONE;
    if (out.x < 0) {
      // 가로획 시작(왼쪽 끝) — 부리: 위쪽 옆이 끝으로 갈수록 솟는다
      const len = W * 1.3;
      H = { bump: (sd, d) => side(upper, 1.25 * A * falloff(d, len))(sd), ext: ext(h * 0.25, 0, upper), reach: len };
    } else if (e.length > 2.2 * s.weight) {
      // 가로획 끝(오른쪽) — 맺음: 끝 조금 안쪽에 위로 솟는 봉우리 + 비스듬한 끝
      const c = W * 0.75, w = W * 0.5;
      H = { bump: (sd, d) => side(upper, 1.1 * A * bell(d, c, w))(sd), ext: ext(h * 0.3, -h * 0.6, upper), reach: c + w * 2.5 };
    }
    let V: Profile = NONE;
    if (out.y > 0) {
      // 세로획 위 끝 — 부리: 왼쪽 옆이 위로 갈수록 솟고, 머리가 왼쪽 위로 비스듬하다
      const len = W * 1.1;
      V = { bump: (sd, d) => side(viewerLeft, 0.9 * A * falloff(d, len))(sd), ext: ext(h * 0.5, -h * 0.05, viewerLeft), reach: len };
    } else {
      // 세로획 아래 끝 — 왼쪽 아래로 비스듬히 맺는다
      V = { bump: () => 0, ext: ext(h * 0.6, -h * 0.15, viewerLeft), reach: 0 };
    }
    return blend(H, wH, V, wV);
  }

  // 라틴 세리프: 줄기 끝에서 양옆으로 벌어지는 받침(브래킷) / 계단(슬래브)
  const slab = s.serif === 'slab';
  const flare = slab ? A * 1.9 : A * 1.7;
  const len = slab ? W * 0.55 : W * 0.9;
  const prof = slab
    ? (d: number) => flare * (1 - smooth((d - len * 0.6) / (len * 0.4)))
    : (d: number) => flare * falloff(d, len);
  const V: Profile = { bump: (_sd, d) => (e.straight ? prof(d) : 0), ext: { 1: 0, [-1]: 0 } as Record<Side, number>, reach: len };
  // 가로 팔 끝: 글자 가운데 쪽으로 짧게 내민 부리
  const towardCenter: Side = (s.centerY - e.p.y) * n.y >= 0 ? 1 : -1;
  const armLen = W * 0.6;
  const H: Profile = e.straight && Math.abs(s.centerY - e.p.y) > s.weight
    ? { bump: (sd, d) => side(towardCenter, A * 1.3 * falloff(d, armLen))(sd), ext: { 1: 0, [-1]: 0 } as Record<Side, number>, reach: armLen }
    : NONE;
  void out;
  return blend(H, wH, V, wV);
}

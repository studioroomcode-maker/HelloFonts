import type { LayoutDef } from '../types';

const r = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

/**
 * 글자 칸(0..1, y 아래로) 안에서 각 자모가 차지하는 자리.
 * 자리 경계에서 (획 두께 + 자모 간격)/2 만큼 안쪽이 뼈대 상자(0..100)가 된다.
 */
const V_ROWS = { top: r(0, 0.02, 0.6, 0.56), vowel: r(0.6, 0, 1, 0.6), jong: r(0.14, 0.6, 0.86, 1) };

export const DEFAULT_LAYOUTS: Record<string, LayoutDef> = {
  // 세로모음: 초성 왼쪽, 모음 오른쪽
  V: { cho: r(0, 0.08, 0.6, 0.92), jung: r(0.6, 0, 1, 1) },
  V_F: { cho: V_ROWS.top, jung: V_ROWS.vowel, jong: V_ROWS.jong },
  VL: { cho: r(0, 0.08, 0.54, 0.92), jung: r(0.54, 0, 1, 1) },
  VL_F: { cho: r(0, 0.02, 0.54, 0.56), jung: r(0.54, 0, 1, 0.6), jong: V_ROWS.jong },
  VV: { cho: r(0, 0.08, 0.52, 0.92), jung: r(0.52, 0, 1, 1) },
  VV_F: { cho: r(0, 0.02, 0.52, 0.56), jung: r(0.52, 0, 1, 0.6), jong: V_ROWS.jong },
  // 가로모음: 초성 위, 모음 아래 (ㅜㅠ는 기둥이 아래로 내려가 모음 자리를 더 준다)
  Ho: { cho: r(0.1, 0, 0.9, 0.6), jung: r(0, 0.6, 1, 1) },
  Ho_F: { cho: r(0.12, 0, 0.88, 0.35), jung: r(0, 0.35, 1, 0.6), jong: r(0.12, 0.6, 0.88, 1) },
  Hu: { cho: r(0.1, 0, 0.9, 0.56), jung: r(0, 0.56, 1, 1) },
  Hu_F: { cho: r(0.12, 0, 0.88, 0.33), jung: r(0, 0.33, 1, 0.63), jong: r(0.12, 0.63, 0.88, 1) },
  // 섞임모음: 초성 왼쪽 위, 가로 부분 아래, 세로 부분 오른쪽
  Co: { cho: r(0, 0, 0.62, 0.56), jung: r(0, 0, 1, 1), jungH: r(0, 0.56, 0.74, 1), jungV: r(0.74, 0, 1, 1) },
  Co_F: {
    cho: r(0, 0, 0.62, 0.35), jung: r(0, 0, 1, 0.6), jungH: r(0, 0.35, 0.74, 0.6), jungV: r(0.74, 0, 1, 0.6),
    jong: r(0.12, 0.6, 0.88, 1),
  },
  Cu: { cho: r(0, 0, 0.62, 0.52), jung: r(0, 0, 1, 1), jungH: r(0, 0.52, 0.72, 1), jungV: r(0.72, 0, 1, 1) },
  Cu_F: {
    cho: r(0, 0, 0.62, 0.33), jung: r(0, 0, 1, 0.63), jungH: r(0, 0.33, 0.72, 0.63), jungV: r(0.72, 0, 1, 0.63),
    jong: r(0.12, 0.63, 0.88, 1),
  },
  CCo: { cho: r(0, 0, 0.56, 0.56), jung: r(0, 0, 1, 1), jungH: r(0, 0.56, 0.66, 1), jungV: r(0.66, 0, 1, 1) },
  CCo_F: {
    cho: r(0, 0, 0.56, 0.35), jung: r(0, 0, 1, 0.6), jungH: r(0, 0.35, 0.66, 0.6), jungV: r(0.66, 0, 1, 0.6),
    jong: r(0.12, 0.6, 0.88, 1),
  },
  CCu: { cho: r(0, 0, 0.56, 0.52), jung: r(0, 0, 1, 1), jungH: r(0, 0.52, 0.64, 1), jungV: r(0.64, 0, 1, 1) },
  CCu_F: {
    cho: r(0, 0, 0.56, 0.33), jung: r(0, 0, 1, 0.63), jungH: r(0, 0.33, 0.64, 0.63), jungV: r(0.64, 0, 1, 0.63),
    jong: r(0.12, 0.63, 0.88, 1),
  },
};

/**
 * 탈네모꼴: 자모 자리가 모음·받침에 따라 늘거나 줄지 않고 고정된다.
 * 받침이 없는 글자는 아래가 비어 글자 높이가 들쭉날쭉해진다(손글씨·디자인 글씨에 어울림).
 */
export function talnemoLayouts(): Record<string, LayoutDef> {
  const vCho = r(0, 0.02, 0.58, 0.56), vJung = r(0.58, 0, 1, 0.62);
  const hCho = r(0.14, 0, 0.86, 0.36), hJung = r(0, 0.36, 1, 0.62);
  const cCho = r(0, 0, 0.6, 0.36), cJung = r(0, 0, 1, 0.62), cH = r(0, 0.36, 0.72, 0.62), cV = r(0.72, 0, 1, 0.62);
  const jong = r(0.12, 0.62, 0.88, 1);
  const out: Record<string, LayoutDef> = {};
  for (const k of ['V', 'VL', 'VV']) {
    out[k] = { cho: vCho, jung: vJung };
    out[`${k}_F`] = { cho: vCho, jung: vJung, jong };
  }
  for (const k of ['Ho', 'Hu']) {
    out[k] = { cho: hCho, jung: hJung };
    out[`${k}_F`] = { cho: hCho, jung: hJung, jong };
  }
  for (const k of ['Co', 'Cu', 'CCo', 'CCu']) {
    out[k] = { cho: cCho, jung: cJung, jungH: cH, jungV: cV };
    out[`${k}_F`] = { cho: cCho, jung: cJung, jungH: cH, jungV: cV, jong };
  }
  return out;
}

/**
 * 자모 뼈대 기본값 (0..100 상자, y 아래로). 상자 가장자리까지 써도 획 두께만큼의 여유는 자동으로 확보된다.
 * 키 형식: 'ㄱ' 기본형 / 'ㄱ@cho' 초성 전용 / 'ㄱ@cho.vert' 세로모음 배치의 초성 / 'ㄱ@cho.V_F' 특정 배치
 */
export const DEFAULT_JAMO: Record<string, string> = {
  ㄱ: 'M 0 0 L 100 0 L 100 100',
  'ㄱ@cho.vert': 'M 0 2 L 92 2 C 92 45 76 76 22 100',
  ㄴ: 'M 0 0 L 0 100 L 100 100',
  ㄷ: 'M 100 0 L 0 0 L 0 100 L 100 100',
  ㄹ: 'M 0 0 L 100 0 L 100 50 L 0 50 L 0 100 L 100 100',
  ㅁ: 'M 0 0 L 100 0 L 100 100 L 0 100 Z',
  ㅂ: 'M 0 0 L 0 100 L 100 100 L 100 0 M 0 50 L 100 50',
  ㅅ: 'M 50 0 Q 48 60 0 100 M 43 40 Q 58 76 100 100',
  ㅇ: 'O 50 50 50 50 K 0.5',
  ㅈ: 'M 0 0 L 100 0 M 50 0 Q 48 62 0 100 M 43 40 Q 58 78 100 100',
  ㅊ: 'M 50 0 L 50 24 M 0 24 L 100 24 M 50 24 Q 48 70 0 100 M 43 54 Q 58 82 100 100',
  ㅋ: 'M 0 0 L 100 0 L 100 100 M 0 60 L 100 60',
  'ㅋ@cho.vert': 'M 0 2 L 92 2 C 92 45 76 76 22 100 M 4 48 L 83 48',
  ㅌ: 'M 100 0 L 0 0 L 0 100 L 100 100 M 0 50 L 95 50',
  ㅍ: 'M 0 0 L 100 0 M 28 0 L 28 100 M 72 0 L 72 100 M 0 100 L 100 100',
  ㅎ: 'M 50 0 L 50 18 M 6 18 L 94 18 O 50 68 36 32 K 0.4',

  ㅏ: 'M 5 0 L 5 100 M 5 48 L 100 48',
  ㅑ: 'M 5 0 L 5 100 M 5 33 L 100 33 M 5 64 L 100 64',
  ㅣ: 'M 22 0 L 22 100',
  ㅓ: 'M 8 48 L 88 48 M 88 0 L 88 100',
  ㅕ: 'M 8 33 L 88 33 M 8 64 L 88 64 M 88 0 L 88 100',
  ㅐ: 'M 8 6 L 8 94 M 8 48 L 90 48 M 90 0 L 90 100',
  ㅒ: 'M 8 6 L 8 94 M 8 33 L 90 33 M 8 64 L 90 64 M 90 0 L 90 100',
  ㅔ: 'M 0 48 L 45 48 M 45 6 L 45 94 M 92 0 L 92 100',
  ㅖ: 'M 0 33 L 45 33 M 0 64 L 45 64 M 45 6 L 45 94 M 92 0 L 92 100',
  ㅗ: 'M 50 35 L 50 100 M 0 100 L 100 100',
  ㅛ: 'M 30 35 L 30 100 M 70 35 L 70 100 M 0 100 L 100 100',
  ㅜ: 'M 0 0 L 100 0 M 50 0 L 50 70',
  ㅠ: 'M 0 0 L 100 0 M 30 0 L 30 70 M 70 0 L 70 70',
  ㅡ: 'M 0 50 L 100 50',
};

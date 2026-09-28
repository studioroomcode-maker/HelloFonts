import type { LayoutDef, Params, Project, Rect } from './types';
import { createDefaultProject, DEFAULT_PARAMS } from './project';
import { parseSkeleton } from './pathparse';

export interface Preset {
  id: string;
  name: string;
  description: string;
  params: Partial<Params>;
  /** 이 스타일에 맞게 바꾼 뼈대(키 → 뼈대 문법) */
  jamo?: Record<string, string>;
  latin?: [string, number, string][];
  /** 이 스타일에 맞게 바꾼 배치 틀(일부만) */
  layouts?: Record<string, LayoutDef>;
  sampleText: string;
}

const r = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1 });
/** 게임 UI 글씨(폰트샘플): ㅎ 꼭지는 짧은 가로 점, ㄱ·ㅋ 다리는 거의 곧게 내려와 끝만 살짝 휜다 */
const GAME_JAMO: Record<string, string> = {
  ㅎ: 'M 30 0 L 70 0 M 2 25 L 98 25 O 50 71 36 29 K 0.3',
  'ㄱ@cho.vert': 'M 0 4 L 86 4 C 88 42 82 72 58 100',
  'ㅋ@cho.vert': 'M 0 4 L 86 4 C 88 42 82 72 58 100 M 4 51 L 83 51',
  // 굵은 가로획에 기둥이 묻히지 않도록 기둥을 모음 자리 맨 위 가까이에서 시작한다
  ㅗ: 'M 50 8 L 50 100 M 0 100 L 100 100',
  ㅛ: 'M 30 8 L 30 100 M 70 8 L 70 100 M 0 100 L 100 100',
};

/** 아주 굵은 글꼴: 가운데 모음 줄(ㅡ·ㅗ)을 얇게 하고 초성·받침에 높이를 더 준다 */
const HEAVY_LAYOUTS: Record<string, LayoutDef> = {
  // ㅗ·ㅛ는 기둥이 들어갈 높이가 필요하고, ㅡ는 획 하나뿐이라 얇게 두어 초성·받침에 높이를 준다
  Ho_F: { cho: r(0.1, 0, 0.9, 0.3), jung: r(0, 0.3, 1, 0.64), jong: r(0.1, 0.64, 0.9, 1) },
  'Ho_F:ㅡ': { cho: r(0.1, 0, 0.9, 0.41), jung: r(0, 0.41, 1, 0.57), jong: r(0.1, 0.57, 0.9, 1) },
  Hu_F: { cho: r(0.1, 0, 0.9, 0.35), jung: r(0, 0.35, 1, 0.62), jong: r(0.1, 0.62, 0.9, 1) },
  V_F: { cho: r(0, 0.02, 0.6, 0.55), jung: r(0.6, 0, 1, 0.57), jong: r(0.1, 0.57, 0.9, 1) },
  VL_F: { cho: r(0, 0.02, 0.54, 0.55), jung: r(0.54, 0, 1, 0.57), jong: r(0.1, 0.57, 0.9, 1) },
  VV_F: { cho: r(0, 0.02, 0.52, 0.55), jung: r(0.52, 0, 1, 0.57), jong: r(0.1, 0.57, 0.9, 1) },
  // 섞임모음: 획이 굵으면 세로 모음(ㅏ·ㅓ·ㅣ)의 곁줄기가 기둥에 묻히지 않게 자리를 넓힌다
  Co: { cho: r(0, 0, 0.58, 0.55), jung: r(0, 0, 1, 1), jungH: r(0, 0.55, 0.64, 1), jungV: r(0.64, 0, 1, 1) },
  Co_F: { cho: r(0, 0, 0.58, 0.36), jung: r(0, 0, 1, 0.6), jungH: r(0, 0.36, 0.64, 0.6), jungV: r(0.64, 0, 1, 0.6), jong: r(0.1, 0.6, 0.9, 1) },
  Cu: { cho: r(0, 0, 0.58, 0.5), jung: r(0, 0, 1, 1), jungH: r(0, 0.5, 0.62, 1), jungV: r(0.62, 0, 1, 1) },
  Cu_F: { cho: r(0, 0, 0.58, 0.34), jung: r(0, 0, 1, 0.62), jungH: r(0, 0.34, 0.62, 0.62), jungV: r(0.62, 0, 1, 0.62), jong: r(0.1, 0.62, 0.9, 1) },
  CCo: { cho: r(0, 0, 0.52, 0.55), jung: r(0, 0, 1, 1), jungH: r(0, 0.55, 0.56, 1), jungV: r(0.56, 0, 1, 1) },
  CCo_F: { cho: r(0, 0, 0.52, 0.36), jung: r(0, 0, 1, 0.6), jungH: r(0, 0.36, 0.56, 0.6), jungV: r(0.56, 0, 1, 0.6), jong: r(0.1, 0.6, 0.9, 1) },
  CCu: { cho: r(0, 0, 0.52, 0.5), jung: r(0, 0, 1, 1), jungH: r(0, 0.5, 0.54, 1), jungV: r(0.54, 0, 1, 1) },
  CCu_F: { cho: r(0, 0, 0.52, 0.34), jung: r(0, 0, 1, 0.62), jungH: r(0, 0.34, 0.54, 0.62), jungV: r(0.54, 0, 1, 0.62), jong: r(0.1, 0.62, 0.9, 1) },
};

/** 세리프 글꼴용 두 층 a, g */
const SERIF_LATIN: [string, number, string][] = [
  ['a', 390, 'M 40 400 C 80 470 140 500 210 500 C 320 500 380 440 380 330 L 380 60 C 380 20 395 0 420 0 M 380 270 C 280 262 0 240 0 110 C 0 35 60 0 140 0 C 250 0 330 60 380 140'],
  ['g', 420, 'O 190 330 170 170 M 330 460 C 360 490 390 500 420 500 M 120 180 C 60 150 40 110 60 80 C 80 50 150 50 230 50 C 350 50 420 10 420 -70 C 420 -160 330 -200 210 -200 C 90 -200 0 -160 0 -90 C 0 -40 40 -10 100 0'],
];

export const PRESETS: Preset[] = [
  {
    id: 'gothic',
    name: '고딕',
    description: '획 끝이 반듯하고 굵기가 고른 기본 민부리 글꼴',
    params: { weight: 84, gap: 28, cap: 'flat', join: 'miter', contrast: 0.12, penAngle: 0 },
    sampleText: '다람쥐 헌 쳇바퀴에 타고파 Gothic 123',
  },
  {
    id: 'round',
    name: '둥근고딕',
    description: '획 끝과 모서리가 둥근 부드러운 글꼴',
    params: { weight: 88, gap: 26, cap: 'round', join: 'round', contrast: 0 },
    sampleText: '다람쥐 헌 쳇바퀴에 타고파 Rounded 123',
  },
  {
    id: 'myeongjo',
    name: '명조',
    description: '가로획이 가늘고 세로획이 굵으며 부리·맺음·꼭지이응이 있는 본문용 글꼴',
    params: {
      weight: 96, gap: 34, cap: 'flat', join: 'miter', contrast: 0.66, penAngle: 0,
      serif: 'myeongjo', serifSize: 0.55, kkokji: true,
    },
    jamo: {
      ㅊ: 'M 42 0 L 58 14 M 0 30 L 100 30 M 50 30 Q 48 72 0 100 M 43 58 Q 58 84 100 100',
      ㅎ: 'M 42 0 L 58 12 M 6 24 L 94 24 O 50 68 36 30 K 0.4',
    },
    latin: SERIF_LATIN,
    sampleText: '다람쥐 헌 쳇바퀴에 타고파 Serif 123',
  },
  {
    id: 'handwriting',
    name: '손글씨',
    description: '살짝 기울고 글자마다 흔들림과 필압이 있는 손글씨',
    params: {
      weight: 62, gap: 32, cap: 'round', join: 'round', contrast: 0.12, penAngle: 30,
      pressureStart: 0.85, pressureMid: 1, pressureEnd: 0.7, jitter: 14, wobble: 3, slant: 3,
    },
    sampleText: '다람쥐 헌 쳇바퀴에 타고파 Handwriting 123',
  },
  {
    id: 'brush',
    name: '붓글씨',
    description: '기필은 무겁고 수필은 가늘게 빠지는 붓 느낌의 글꼴',
    params: {
      weight: 104, gap: 30, cap: 'angled', join: 'round', contrast: 0.55, penAngle: 35,
      pressureStart: 1.15, pressureMid: 0.85, pressureEnd: 0.5, jitter: 7, wobble: 2,
    },
    sampleText: '다람쥐 헌 쳇바퀴에 타고파 Brush 123',
  },
  {
    id: 'game-title',
    name: '게임 제목',
    description: '아주 굵고 둥글며 글자마다 살짝 기울어 통통 튀는 게임 제목·배너용',
    params: {
      weight: 210, gap: 4, strokeGap: 0.15, cap: 'round', join: 'round', contrast: 0, wobble: 4, seed: 3, density: 1,
      hangulAdvance: 920, hangulSide: 0, hangulTop: 910, hangulBottom: -150, latinSide: 20,
    },
    jamo: { ...GAME_JAMO, ㅇ: 'O 50 50 50 50' },
    layouts: HEAVY_LAYOUTS,
    sampleText: '클리어! 설정 레벨 업 Lv.1',
  },
  {
    id: 'game-body',
    name: '게임 본문',
    description: '굵고 반듯한 게임 버튼·메뉴용 고딕',
    params: {
      weight: 166, gap: 22, cap: 'soft', join: 'miter', contrast: 0.05, density: 0.7,
      hangulAdvance: 940, hangulSide: 0, hangulTop: 880, hangulBottom: -120, latinSide: 20,
    },
    jamo: GAME_JAMO,
    layouts: HEAVY_LAYOUTS,
    sampleText: '다시 하기 다음 스테이지 배경음악',
  },
  {
    id: 'display',
    name: '제목용',
    description: '아주 굵고 둥근 제목·로고용 글꼴',
    params: { weight: 136, gap: 22, cap: 'round', join: 'round', contrast: 0, hangulTop: 850, hangulBottom: -110 },
    sampleText: '클리어! 레벨 업 DISPLAY 123',
  },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[1];

export function createProjectFromPreset(id: string, familyName?: string, familyNameKo?: string): Project {
  const preset = presetById(id);
  const project = createDefaultProject();
  project.preset = preset.id;
  project.params = { ...project.params, ...preset.params };
  for (const [key, src] of Object.entries(preset.jamo ?? {})) {
    project.glyphs[key] = { kind: 'jamo', strokes: parseSkeleton(src) };
  }
  for (const [ch, width, src] of preset.latin ?? []) {
    project.glyphs[ch] = { kind: 'latin', width, strokes: parseSkeleton(src) };
  }
  for (const [k, l] of Object.entries(preset.layouts ?? {})) project.layouts[k] = structuredClone(l);
  if (familyName) project.info.familyName = familyName;
  if (familyNameKo) project.info.familyNameKo = familyNameKo;
  return project;
}

/** 프리셋이 정하는 '스타일' 항목(글자 칸·라틴 비율 같은 치수는 건드리지 않는다) */
const STYLE_KEYS = [
  'weight', 'gap', 'cap', 'join', 'contrast', 'penAngle', 'pressureStart', 'pressureMid', 'pressureEnd',
  'serif', 'serifSize', 'kkokji', 'jitter', 'wobble', 'slant', 'density', 'strokeGap',
] as const;

/**
 * 지금 글꼴에 프리셋 스타일을 입힌다. 스타일 항목은 먼저 기본값으로 되돌린 뒤 프리셋 값을 얹어,
 * 앞서 쓰던 스타일(예: 명조의 부리)이 남아 섞이지 않게 한다.
 */
export function applyPresetStyle(params: Params, id: string): Params {
  const preset = presetById(id);
  const reset = Object.fromEntries(STYLE_KEYS.map((k) => [k, DEFAULT_PARAMS[k]])) as Partial<Params>;
  return { ...params, ...reset, ...preset.params };
}

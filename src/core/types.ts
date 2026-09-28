// 뼈대(skeleton) 좌표계
//  - 한글 자모: 0..100 정사각 상자, y는 아래로 증가
//  - 라틴/숫자/기호: 폰트 단위(기준선 0, 대문자 높이 700), y는 위로 증가
// 외곽선(outline) 좌표계: 폰트 단위(1000 em), y는 위로 증가

export interface Pt {
  x: number;
  y: number;
}

/** w: 그 점에서의 굵기 배율(필압). 없으면 1 */
export type Seg =
  | { t: 'L'; p: Pt; w?: number }
  | { t: 'C'; c1: Pt; c2: Pt; p: Pt; w?: number };

export interface PathStroke {
  kind: 'path';
  start: Pt;
  startW?: number;
  segs: Seg[];
  closed?: boolean;
}

export interface EllipseStroke {
  kind: 'ellipse';
  c: Pt;
  rx: number;
  ry: number;
  /** 0..1 — 상자 비율에 늘어나도 원 모양을 얼마나 유지할지 */
  keep?: number;
  /** 자모 ㅇ의 원(명조 꼭지이응 대상) — 조합 과정에서 붙는다 */
  ieung?: boolean;
  /** 굵기 배율(밀도 보정 등) — 조합 과정에서 붙는다 */
  w?: number;
}

export type Stroke = PathStroke | EllipseStroke;

export type GlyphKind = 'jamo' | 'latin';

export interface GlyphDef {
  kind: GlyphKind;
  strokes: Stroke[];
  /** 라틴 글리프의 뼈대 폭(폰트 단위). 획 두께와 옆 여백은 자동으로 더해짐. 음절('syl:각')은 글자 폭 그대로 */
  width?: number;
  /**
   * 이미지에서 따 온 외곽선(있으면 뼈대 대신 쓴다).
   *  - 자모: 자모 자리(slot) 기준 0..100, y 아래로
   *  - 음절('syl:각'): 글자 칸의 폰트 좌표
   *  - 라틴: 폰트 좌표(왼쪽 끝 x = 0, 기준선 y = 0)
   */
  outline?: Contour[];
}

/** 획 끝 모양: 둥글게 / 평평하게 / 살짝 둥글게(모서리만) / 네모로 연장 / 붓 각도로 비스듬히 */
export type CapStyle = 'round' | 'flat' | 'soft' | 'square' | 'angled';
export type JoinStyle = 'round' | 'miter' | 'bevel';
/** 획 끝 장식: 없음 / 명조(부리·맺음) / 브래킷 세리프 / 슬래브 세리프 */
export type SerifStyle = 'none' | 'myeongjo' | 'bracket' | 'slab';

export interface Params {
  // ── 획 ──
  weight: number;
  gap: number;
  cap: CapStyle;
  join: JoinStyle;
  /** 굵기 대비 0..0.9 — 펜 각도 방향의 획이 (1-대비)배로 가늘어진다 */
  contrast: number;
  /** 가장 가는 획의 방향(도). 0 = 가로획이 가늘다(명조·세리프) */
  penAngle: number;
  /** 필압: 획 시작(기필)·가운데(행필)·끝(수필)의 굵기 배율 */
  pressureStart: number;
  pressureMid: number;
  pressureEnd: number;
  // ── 장식 ──
  serif: SerifStyle;
  /** 부리·맺음·세리프 크기(굵기 대비 배율) */
  serifSize: number;
  /** 명조의 꼭지이응 */
  kkokji: boolean;
  // ── 손글씨 ──
  /** 점 흔들림(폰트 단위) */
  jitter: number;
  /** 글자마다 기울어지는 정도(도) */
  wobble: number;
  seed: number;
  /** 전체 기울기(도, 이탤릭) */
  slant: number;
  /** 밀도 보정 0..1: 음절 칸이 모자라면 쌓인 획을 얼마나 가늘게 할지 */
  density: number;
  /** 획 사이 최소 틈(획 굵기 대비). 쌓인 가로획·나란한 세로 기둥 사이를 이만큼 벌린다 — 뚱뚱한 글씨는 작게 */
  strokeGap: number;
  // ── 한글 칸 ──
  hangulAdvance: number;
  hangulSide: number;
  hangulTop: number;
  hangulBottom: number;
  // ── 라틴 ──
  capHeight: number;
  xHeight: number;
  ascender: number;
  descender: number;
  latinSide: number;
  latinWidthScale: number;
  spaceWidth: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type Role = 'cho' | 'jung' | 'jong';

export interface LayoutDef {
  cho: Rect;
  jung: Rect;
  /** 겹모음의 가로 부분(ㅗ·ㅜ·ㅡ) */
  jungH?: Rect;
  /** 겹모음의 세로 부분(ㅏ·ㅓ·ㅣ…) */
  jungV?: Rect;
  jong?: Rect;
}

export interface ReferenceImage {
  src: string;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  visible: boolean;
}

export interface FontInfo {
  /** 영문 글꼴 이름(파일·시스템 표준 이름) */
  familyName: string;
  /** 한글 글꼴 이름(윈도우 한국어 환경 등에 표시) */
  familyNameKo: string;
  designer: string;
  version: string;
  copyright: string;
  license: string;
}

export interface Project {
  version: 2;
  info: FontInfo;
  /** 새로 만들 때 고른 프리셋(참고용) */
  preset?: string;
  params: Params;
  layouts: Record<string, LayoutDef>;
  glyphs: Record<string, GlyphDef>;
  /** 겹자음·겹받침을 좌우로 나누는 비율(왼쪽 몫). 없으면 0.5 */
  pairRatio: Record<string, number>;
  reference?: ReferenceImage;
}

export interface Contour {
  start: Pt;
  segs: Seg[];
}

export interface GlyphOutline {
  contours: Contour[];
  advance: number;
}

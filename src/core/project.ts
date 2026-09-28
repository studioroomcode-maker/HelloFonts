import type { FontInfo, GlyphDef, Params, Project, Role } from './types';
import { DEFAULT_JAMO, DEFAULT_LAYOUTS } from './defaults/hangul';
import { DEFAULT_LATIN } from './defaults/latin';
import { parseSkeleton } from './pathparse';
import { layoutGroup, type LayoutKey } from './hangul';

export const DEFAULT_PARAMS: Params = {
  weight: 88,
  gap: 26,
  cap: 'round',
  join: 'round',
  contrast: 0,
  penAngle: 0,
  pressureStart: 1,
  pressureMid: 1,
  pressureEnd: 1,
  serif: 'none',
  serifSize: 0.55,
  kkokji: false,
  jitter: 0,
  wobble: 0,
  seed: 1,
  slant: 0,
  density: 1,
  strokeGap: 0.35,
  hangulAdvance: 1000,
  hangulSide: 40,
  hangulTop: 830,
  hangulBottom: -90,
  capHeight: 700,
  xHeight: 510,
  ascender: 750,
  descender: -190,
  latinSide: 45,
  latinWidthScale: 1,
  spaceWidth: 300,
};

export const DEFAULT_INFO: FontInfo = {
  familyName: 'HelloFont',
  familyNameKo: '헬로폰트',
  designer: '',
  version: '1.000',
  copyright: '',
  license: 'SIL Open Font License 1.1',
};

export function defaultGlyphs(): Record<string, GlyphDef> {
  const glyphs: Record<string, GlyphDef> = {};
  for (const [key, src] of Object.entries(DEFAULT_JAMO)) {
    glyphs[key] = { kind: 'jamo', strokes: parseSkeleton(src) };
  }
  for (const [ch, width, src] of DEFAULT_LATIN) {
    glyphs[ch] = { kind: 'latin', width, strokes: parseSkeleton(src) };
  }
  return glyphs;
}

export function createDefaultProject(): Project {
  return {
    version: 2,
    info: { ...DEFAULT_INFO },
    params: { ...DEFAULT_PARAMS },
    layouts: structuredClone(DEFAULT_LAYOUTS),
    glyphs: defaultGlyphs(),
    pairRatio: {},
    reference: {
      src: '/sample-reference.png',
      // 샘플 이미지의 ‘클리어!’가 글자 칸에 겹치도록 맞춘 위치
      x: -9800,
      y: 4070,
      scale: 24,
      opacity: 0.35,
      visible: false,
    },
  };
}

// ───────────────────────── 적용 범위 ─────────────────────────

/** 적용 범위: 좁은 것부터 넓은 것 순서 */
export type Scope = 'syllable' | 'layout' | 'bul' | 'group' | 'role' | 'base';
export const SCOPES: Scope[] = ['syllable', 'layout', 'bul', 'group', 'role', 'base'];

export const SCOPE_LABEL: Record<Scope, string> = {
  syllable: '이 글자에서만',
  layout: '이 배치 틀에서만',
  bul: '같은 벌(8·4·4벌 문맥)에서만',
  group: '같은 모음 방향 배치에서만',
  role: '이 자리(초·중·종성) 전체에서만',
  base: '모든 곳에서',
};

/** 자모 하나가 놓이는 문맥 */
export interface JamoCtx {
  layout: LayoutKey;
  /** 8×4×4벌 번호(b1…) */
  bul: string;
  /** 음절(낱자 단독일 때는 없음) */
  syllable?: string;
}

export function jamoKey(jamo: string, role: Role, ctx: JamoCtx, scope: Scope): string | null {
  switch (scope) {
    case 'syllable':
      return ctx.syllable ? `${jamo}@${role}!${ctx.syllable}` : null;
    case 'layout':
      return `${jamo}@${role}.${ctx.layout}`;
    case 'bul':
      return `${jamo}@${role}.${ctx.bul}`;
    case 'group':
      return `${jamo}@${role}.${layoutGroup(ctx.layout)}`;
    case 'role':
      return `${jamo}@${role}`;
    case 'base':
      return jamo;
  }
}

/** 가장 구체적인 정의부터 찾아 첫 번째로 존재하는 키를 돌려준다 */
export function resolveJamoKey(
  glyphs: Record<string, GlyphDef>,
  jamo: string,
  role: Role,
  ctx: JamoCtx,
): { key: string; scope: Scope } | null {
  for (const scope of SCOPES) {
    const key = jamoKey(jamo, role, ctx, scope);
    if (key && glyphs[key]) return { key, scope };
  }
  return null;
}

// ───────────────────────── 불러오기 · 이전 형식 변환 ─────────────────────────

const OLD_LAYOUT_RENAME: Record<string, string> = { H: 'Ho', H_F: 'Ho_F', C: 'Co', C_F: 'Co_F', CC: 'CCo', CC_F: 'CCo_F' };

export function mergeProject(raw: unknown): Project {
  const base = createDefaultProject();
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Record<string, unknown> & Partial<Project>;
  const oldParams = (p.params ?? {}) as Record<string, unknown>;
  const params: Params = { ...base.params, ...(oldParams as Partial<Params>) };
  // v1: horizontalRatio → contrast, butt → flat
  if (typeof oldParams.horizontalRatio === 'number' && oldParams.contrast === undefined) {
    params.contrast = Math.max(0, Math.min(0.9, 1 - (oldParams.horizontalRatio as number)));
  }
  if ((params.cap as string) === 'butt') params.cap = 'flat';
  delete (params as unknown as Record<string, unknown>).horizontalRatio;

  const layouts = { ...base.layouts };
  for (const [k, v] of Object.entries((p.layouts ?? {}) as Record<string, unknown>)) {
    layouts[OLD_LAYOUT_RENAME[k] ?? k] = v as Project['layouts'][string];
  }
  const glyphs: Record<string, GlyphDef> = {};
  for (const [k, v] of Object.entries((p.glyphs ?? base.glyphs) as Record<string, GlyphDef>)) {
    const m = k.match(/^(.+@\w+)\.(H|H_F|C|C_F|CC|CC_F)$/);
    glyphs[m ? `${m[1]}.${OLD_LAYOUT_RENAME[m[2]]}` : k] = v;
  }
  const info: FontInfo = { ...base.info, ...((p.info ?? {}) as Partial<FontInfo>) };
  if (typeof p.familyName === 'string') info.familyName = p.familyName as string;
  return {
    version: 2,
    info,
    preset: typeof p.preset === 'string' ? p.preset : undefined,
    params,
    layouts,
    glyphs,
    pairRatio: (p.pairRatio ?? {}) as Record<string, number>,
    reference: p.reference ?? base.reference,
  };
}

/** 폰트 이름 테이블에 넣을 수 있는 영문 이름 */
export function sanitizeFamilyName(name: string): string {
  const ascii = name.replace(/[^A-Za-z0-9 \-]/g, '').trim();
  return ascii || 'HelloFont';
}

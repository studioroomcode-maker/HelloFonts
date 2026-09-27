import opentype from 'opentype.js';
import type { Contour, Project } from './types';
import { glyphOutline, latinChars } from './compose';
import { allSyllables, COMPAT_JAMO, ksx1001Syllables } from './hangul';
import { sanitizeFamilyName } from './project';
import { removeOverlaps, hasPathKit } from './pathops';
import { buildTTF, type NameSet, type TTGlyph } from './ttf';

export type Charset = 'ks' | 'all';
export type FontFormat = 'ttf' | 'otf';

export interface WeightSpec {
  name: string;
  weightClass: number;
  /** 획 굵기 배율 */
  scale: number;
}

export const WEIGHTS: WeightSpec[] = [
  { name: 'Thin', weightClass: 100, scale: 0.4 },
  { name: 'Light', weightClass: 300, scale: 0.7 },
  { name: 'Regular', weightClass: 400, scale: 1 },
  { name: 'Medium', weightClass: 500, scale: 1.18 },
  { name: 'Bold', weightClass: 700, scale: 1.45 },
  { name: 'Black', weightClass: 900, scale: 1.8 },
];

export const REGULAR = WEIGHTS[2];

export interface BuildOptions {
  charset: Charset;
  format: FontFormat;
  weight?: WeightSpec;
  /** 겹친 외곽선 합치기(기본: 켬, PathKit이 준비된 경우) */
  removeOverlap?: boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface BuiltFont {
  bytes: Uint8Array;
  fileName: string;
  familyName: string;
  styleName: string;
}

/** 한자 em 상자와 줄 간격(윈도우·맥·웹에서 같게) */
export const VMETRICS = { typoAscender: 880, typoDescender: -120, typoLineGap: 250 };

export function fontCharList(project: Project, charset: Charset): string[] {
  const syllables = charset === 'all' ? allSyllables() : ksx1001Syllables();
  return [' ', ...latinChars(project), ...COMPAT_JAMO, ...syllables];
}

function glyphName(ch: string): string {
  if (ch === ' ') return 'space';
  return `uni${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
}

function notdefContours(project: Project): Contour[] {
  const y1 = project.params.capHeight;
  const box = (x0: number, y0: number, x1: number, yy1: number, ccw: boolean): Contour => {
    const pts = ccw
      ? [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: yy1 }, { x: x0, y: yy1 }]
      : [{ x: x0, y: y0 }, { x: x0, y: yy1 }, { x: x1, y: yy1 }, { x: x1, y: y0 }];
    return { start: pts[0], segs: pts.slice(1).map((p) => ({ t: 'L' as const, p })) };
  };
  return [box(80, 0, 520, y1, true), box(130, 50, 470, y1 - 50, false)];
}

/** 굵기 패밀리 규칙에 맞는 이름들 */
export function namesFor(project: Project, w: WeightSpec): NameSet {
  const fam = sanitizeFamilyName(project.info.familyName);
  const ko = project.info.familyNameKo.trim();
  const ribbi = w.name === 'Regular' || w.name === 'Bold';
  const family = ribbi ? fam : `${fam} ${w.name}`;
  return {
    family,
    subfamily: ribbi ? w.name : 'Regular',
    typoFamily: fam,
    typoSubfamily: w.name,
    fullName: `${fam} ${w.name}`,
    postScriptName: `${fam.replace(/\s+/g, '')}-${w.name}`.slice(0, 63),
    version: project.info.version || '1.000',
    designer: project.info.designer || undefined,
    copyright: project.info.copyright || undefined,
    license: project.info.license || undefined,
    ko: ko ? { family: ribbi ? ko : `${ko} ${w.name}`, fullName: `${ko} ${w.name}`, typoFamily: ko } : undefined,
  };
}

/** 굵기 배율을 적용한 프로젝트 */
export function withWeight(project: Project, w: WeightSpec): Project {
  if (w.scale === 1) return project;
  return { ...project, params: { ...project.params, weight: project.params.weight * w.scale } };
}

export function buildFontFile(base: Project, opts: BuildOptions): BuiltFont {
  const weight = opts.weight ?? REGULAR;
  const project = withWeight(base, weight);
  const p = project.params;
  const chars = fontCharList(project, opts.charset);
  const merge = (opts.removeOverlap ?? true) && hasPathKit();
  const glyphs: TTGlyph[] = [{ name: '.notdef', advance: 600, contours: notdefContours(project) }];
  const total = chars.length;
  chars.forEach((ch, i) => {
    const o = glyphOutline(project, ch);
    if (o) {
      glyphs.push({
        name: glyphName(ch),
        unicode: ch.codePointAt(0)!,
        advance: o.advance,
        contours: merge ? removeOverlaps(o.contours) : o.contours,
      });
    }
    if (opts.onProgress && (i % 200 === 0 || i === total - 1)) opts.onProgress(i + 1, total);
  });
  const names = namesFor(project, weight);
  const bold = weight.name === 'Bold';
  const fileName = `${names.postScriptName}.${opts.format}`;
  const common = { names, bold, italicAngle: -p.slant, weightClass: weight.weightClass };
  const bytes =
    opts.format === 'ttf'
      ? buildTTF(glyphs, {
          ...common,
          unitsPerEm: 1000,
          ...VMETRICS,
          xHeight: p.xHeight,
          capHeight: p.capHeight,
          italic: false,
          overlapping: !merge,
          johab: opts.charset === 'all',
        })
      : buildOTF(glyphs, project, common, opts.charset === 'all');
  return { bytes, fileName, familyName: names.typoFamily ?? names.family, styleName: weight.name };
}

function buildOTF(
  glyphs: TTGlyph[],
  project: Project,
  c: { names: NameSet; bold: boolean; italicAngle: number; weightClass: number },
  johab: boolean,
): Uint8Array {
  const p = project.params;
  const r = Math.round;
  const otGlyphs = glyphs.map((g) => {
    const path = new opentype.Path();
    for (const ct of g.contours) {
      path.moveTo(r(ct.start.x), r(ct.start.y));
      for (const s of ct.segs) {
        if (s.t === 'L') path.lineTo(r(s.p.x), r(s.p.y));
        else path.curveTo(r(s.c1.x), r(s.c1.y), r(s.c2.x), r(s.c2.y), r(s.p.x), r(s.p.y));
      }
      path.close();
    }
    return new opentype.Glyph({ name: g.name, unicode: g.unicode, advanceWidth: r(g.advance), path });
  });
  const n = c.names;
  const hheaAsc = VMETRICS.typoAscender + VMETRICS.typoLineGap / 2;
  const hheaDesc = VMETRICS.typoDescender - VMETRICS.typoLineGap / 2;
  const fsSelection = (c.bold ? 1 << 5 : 1 << 6) | (1 << 7);
  const font = new opentype.Font({
    familyName: n.family,
    styleName: n.subfamily,
    unitsPerEm: 1000,
    ascender: hheaAsc,
    descender: hheaDesc,
    designer: n.designer,
    copyright: n.copyright,
    license: n.license,
    version: n.version,
    weightClass: c.weightClass,
    fsSelection,
    italicAngle: c.italicAngle,
    glyphs: otGlyphs,
    tables: {
      os2: {
        usWeightClass: c.weightClass,
        fsSelection,
        fsType: 0,
        sTypoAscender: VMETRICS.typoAscender,
        sTypoDescender: VMETRICS.typoDescender,
        sTypoLineGap: VMETRICS.typoLineGap,
        usWinAscent: Math.max(hheaAsc, p.hangulTop + 150),
        usWinDescent: Math.max(-hheaDesc, -p.hangulBottom + 150),
        ulCodePageRange1: 1 | (1 << 19) | (johab ? 1 << 21 : 0),
        sxHeight: p.xHeight,
        sCapHeight: p.capHeight,
        achVendID: 'HELO',
      },
    },
  } as unknown as ConstructorParameters<typeof opentype.Font>[0]);
  const win = (font.names as unknown as { windows: Record<string, Record<string, string>> }).windows;
  win.fontFamily = { en: n.family, ...(n.ko?.family ? { ko: n.ko.family } : {}) };
  win.fontSubfamily = { en: n.subfamily };
  win.fullName = { en: n.fullName, ...(n.ko?.fullName ? { ko: n.ko.fullName } : {}) };
  win.postScriptName = { en: n.postScriptName };
  if (n.typoFamily) win.preferredFamily = { en: n.typoFamily, ...(n.ko?.typoFamily ? { ko: n.ko.typoFamily } : {}) };
  if (n.typoSubfamily) win.preferredSubfamily = { en: n.typoSubfamily };
  return new Uint8Array(font.toArrayBuffer());
}

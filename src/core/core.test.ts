import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import opentype from 'opentype.js';
import { compose, decompose, ksx1001Syllables } from './hangul';
import { parseSkeleton, serializeSkeleton } from './pathparse';
import { createDefaultProject, mergeProject } from './project';
import { composeChar, glyphOutline } from './compose';
import { buildFontFile, WEIGHTS } from './fontBuild';
import { PRESETS, createProjectFromPreset } from './presets';
import { removeOverlaps, setPathKit, type PathKit } from './pathops';
import { makeZip } from './zip';
import type { Contour } from './types';

const finite = (cs: Contour[]) =>
  cs.every((c) => Number.isFinite(c.start.x) && c.segs.every((s) => Number.isFinite(s.p.x) && Number.isFinite(s.p.y)));

const toBuffer = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
type WinNames = { windows: Record<string, Record<string, string>> };

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const init = require('pathkit-wasm/bin/pathkit.js');
  const wasm = readFileSync(require.resolve('pathkit-wasm/bin/pathkit.wasm'));
  setPathKit((await init({ wasmBinary: wasm })) as PathKit);
});

describe('hangul', () => {
  it('음절을 분해하고 배치 틀·벌을 정한다', () => {
    expect(decompose('각')).toMatchObject({ cho: 'ㄱ', jung: 'ㅏ', jong: 'ㄱ', layout: 'V_F' });
    expect(decompose('구')?.layout).toBe('Hu');
    expect(decompose('고')?.layout).toBe('Ho');
    expect(decompose('궈')?.layout).toBe('Cu');
    expect(decompose('괙')?.layout).toBe('CCo_F');
    expect(decompose('구')?.bul).toEqual({ cho: 'b3', jung: 'b2', jong: 'b4' });
    expect(decompose('한')?.bul).toEqual({ cho: 'b6', jung: 'b3', jong: 'b1' });
    expect(compose('ㅎ', 'ㅏ', 'ㄴ')).toBe('한');
  });
  it('KS X 1001 완성형은 2,350자', () => {
    expect(ksx1001Syllables()).toHaveLength(2350);
  });
});

describe('skeleton', () => {
  it('뼈대 문법(점별 굵기 포함)을 읽고 다시 쓴다', () => {
    const s = parseSkeleton('M 0 0 W 0.5 L 10 0 C 15 0 20 5 20 10 W 1.2 Z O 50 50 10 20 K 0.5');
    expect(s).toHaveLength(2);
    expect(parseSkeleton(serializeSkeleton(s))).toEqual(s);
  });
});

describe('compose', () => {
  const project = createDefaultProject();
  it('겹자음과 겹모음은 구성 자모로 합성된다', () => {
    const c = composeChar(project, compose('ㄲ', 'ㅘ', 'ㄼ'))!;
    expect(c.placements.map((p) => p.jamo).join('')).toBe('ㄱㄱㅗㅏㄹㅂ');
    expect(c.placements.every((p) => p.key)).toBe(true);
  });
  it('음절 전용 변형이 가장 먼저 쓰인다', () => {
    const p = { ...project, glyphs: { ...project.glyphs, 'ㄱ@cho!각': { kind: 'jamo' as const, strokes: parseSkeleton('M 0 0 L 100 100') } } };
    expect(composeChar(p, '각')!.placements[0].key).toBe('ㄱ@cho!각');
    expect(composeChar(p, '간')!.placements[0].key).not.toBe('ㄱ@cho!각');
  });
  it('11,172자 모두 유한한 외곽선을 만든다', () => {
    for (let code = 0xac00; code <= 0xd7a3; code += 7) {
      const o = glyphOutline(project, String.fromCharCode(code))!;
      expect(o.contours.length).toBeGreaterThan(0);
      expect(finite(o.contours)).toBe(true);
    }
  });
  it('모든 프리셋이 한글·라틴을 만든다', () => {
    for (const preset of PRESETS) {
      const p = createProjectFromPreset(preset.id);
      for (const ch of '가뷁쀍한ㅎAgQ9!') {
        const o = glyphOutline(p, ch);
        expect(o, `${preset.id} ${ch}`).not.toBeNull();
        expect(finite(o!.contours), `${preset.id} ${ch}`).toBe(true);
      }
    }
  });
  it('이전 형식 프로젝트를 불러온다', () => {
    const old = {
      familyName: 'Old',
      params: { weight: 70, horizontalRatio: 0.7, cap: 'butt' },
      layouts: { H: createDefaultProject().layouts.Ho },
      glyphs: { ㄱ: project.glyphs['ㄱ'], 'ㄱ@cho.H': project.glyphs['ㄱ'] },
    };
    const p = mergeProject(old);
    expect(p.info.familyName).toBe('Old');
    expect(p.params.contrast).toBeCloseTo(0.3);
    expect(p.params.cap).toBe('flat');
    expect(p.glyphs['ㄱ@cho.Ho']).toBeDefined();
  });
});

describe('overlap', () => {
  it('겹친 윤곽을 합친다', () => {
    const o = glyphOutline(createDefaultProject(), '클')!;
    const merged = removeOverlaps(o.contours);
    expect(merged.length).toBeLessThan(o.contours.length);
    expect(finite(merged)).toBe(true);
  });
});

describe('font file', () => {
  const out = process.env.HELLOFONTS_OUT_DIR;
  for (const format of ['ttf', 'otf'] as const) {
    it(`${format.toUpperCase()}를 만들고 다시 읽을 수 있다`, () => {
      const project = createProjectFromPreset('myeongjo', 'Hello Myeongjo', '헬로명조');
      const built = buildFontFile(project, { charset: 'ks', format });
      const font = opentype.parse(toBuffer(built.bytes));
      expect(font.charToGlyph('클').unicode).toBe('클'.codePointAt(0));
      expect(font.charToGlyph('ㄱ').unicode).toBe(0x3131);
      expect(font.glyphs.length).toBeGreaterThan(2350 + 51);
      const names = (font.names as unknown as WinNames).windows;
      expect(names.fontFamily.en).toBe('Hello Myeongjo');
      expect(names.fontFamily.ko).toBe('헬로명조');
      expect(built.fileName).toBe(`HelloMyeongjo-Regular.${format}`);
      if (out) writeFileSync(`${out}/${built.fileName}`, built.bytes);
    }, 120_000);
  }
  it('굵기 패밀리 이름 규칙', () => {
    const project = createProjectFromPreset('gothic', 'Hello Gothic', '헬로고딕');
    const files = [WEIGHTS[1], WEIGHTS[2], WEIGHTS[4]].map((w) => buildFontFile(project, { charset: 'ks', format: 'ttf', weight: w }));
    const parsed = files.map((f) => opentype.parse(toBuffer(f.bytes)));
    const fam = parsed.map((f) => (f.names as unknown as WinNames).windows);
    expect(fam.map((n) => n.fontFamily.en)).toEqual(['Hello Gothic Light', 'Hello Gothic', 'Hello Gothic']);
    expect(fam.map((n) => n.fontSubfamily.en)).toEqual(['Regular', 'Regular', 'Bold']);
    expect(fam.map((n) => n.preferredFamily?.en)).toEqual(['Hello Gothic', 'Hello Gothic', 'Hello Gothic']);
    expect(parsed.map((f) => f.tables.os2.usWeightClass)).toEqual([300, 400, 700]);
    const zip = makeZip(files.map((f) => ({ name: f.fileName, data: f.bytes })));
    expect(zip.length).toBeGreaterThan(files.reduce((a, f) => a + f.bytes.length, 0));
    if (out) {
      for (const f of files) writeFileSync(`${out}/${f.fileName}`, f.bytes);
      writeFileSync(`${out}/family.zip`, zip);
    }
  }, 180_000);
});

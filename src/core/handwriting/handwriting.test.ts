import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { detectMarkers, extractCell, sheetToImage, vectorizeCell } from './scan';
import { cellFrame, HANGUL_CELLS, LATIN_CELLS, type TemplateCell } from './template';
import { applyHandwriting, type HandwritingInput } from './apply';
import { cleanupFromTidy } from './fit';
import { binarize, thin, type Gray } from './raster';
import { traceSkeleton } from './trace';
import { createProjectFromPreset } from '../presets';
import { glyphOutline } from '../compose';
import { buildFontFile } from '../fontBuild';
import type { Params } from '../types';

function readPGM(path: string): Gray {
  const buf = readFileSync(path);
  const header = buf.subarray(0, 64).toString('latin1');
  const m = header.match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/)!;
  const off = m[0].length;
  return { w: +m[1], h: +m[2], data: new Uint8Array(buf.subarray(off, off + +m[1] * +m[2])) };
}

function recognize(g: Gray, cells: TemplateCell[], params: Params): HandwritingInput[] {
  const markers = detectMarkers(g);
  expect(markers).not.toBeNull();
  const H = sheetToImage(markers!);
  return cells.map((cell, i) => {
    const { lines, blobs } = vectorizeCell(extractCell(g, H, i), cellFrame(cell, params));
    return { cell, ink: { text: cell.text, lines, blobs } };
  });
}

describe('세선화·추적', () => {
  it('ㅏ 모양은 기둥 한 획 + 곁줄기 한 획이 된다', () => {
    const w = 60, h = 60;
    const data = new Uint8Array(w * h).fill(255);
    const fill = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[y * w + x] = 0;
    };
    fill(20, 5, 27, 55); // 기둥
    fill(27, 27, 45, 33); // 곁줄기
    const paths = traceSkeleton(thin(binarize({ w, h, data })), 6);
    expect(paths.length).toBe(2);
    const lens = paths.map((p) => p.pts.length).sort((a, b) => b - a);
    expect(lens[0]).toBeGreaterThan(35);
  });
});

const DIR = process.env.HELLOFONTS_SHEETS;
describe.skipIf(!DIR || !existsSync(`${DIR}/sheet_hangul.pgm`))('원고지 사진 인식', () => {
  it('한글·영문 원고지로 손글씨 글꼴을 만든다', () => {
    const base = createProjectFromPreset('handwriting', 'My Hand', '내 손글씨');
    base.params = { ...base.params, jitter: 0, wobble: 0, slant: 0 };
    const hangul = recognize(readPGM(`${DIR}/sheet_hangul.pgm`), HANGUL_CELLS, base.params);
    const latin = recognize(readPGM(`${DIR}/sheet_latin.pgm`), LATIN_CELLS, base.params);
    const withInk = [...hangul, ...latin].filter((x) => x.ink.lines.length > 0).length;
    expect(withInk).toBeGreaterThan(120);

    const { project, report } = applyHandwriting(base, [...hangul, ...latin], cleanupFromTidy(0.5));
    expect(report.applied.length).toBe(HANGUL_CELLS.length + LATIN_CELLS.length);
    expect(report.empty).toEqual([]);
    expect(report.weight).toBeGreaterThan(20);
    for (const ch of '가나다한글뷁괄호AbZ9') {
      const o = glyphOutline(project, ch);
      expect(o && o.contours.length, ch).toBeTruthy();
    }
    const out = process.env.HELLOFONTS_OUT_DIR;
    if (out) {
      const f = buildFontFile(project, { charset: 'ks', format: 'ttf' });
      writeFileSync(`${out}/${f.fileName}`, f.bytes);
      writeFileSync(`${out}/handwriting-report.json`, JSON.stringify(report, null, 1));
    }
  }, 120_000);
});

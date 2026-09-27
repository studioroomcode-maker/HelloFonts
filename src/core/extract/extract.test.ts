import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setPathKit, type PathKit } from '../pathops';
import { createProjectFromPreset } from '../presets';
import { extractFont } from './fitFont';
import { SAMPLE_BODY_WORDS, SAMPLE_TITLE_WORDS } from './sampleWords';
import { buildFontFile } from '../fontBuild';
import type { RGBA } from './image';

// 겹친 외곽선 합치기(앱의 내보내기와 같게)
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const init = require('pathkit-wasm/bin/pathkit.js');
  const wasm = readFileSync(require.resolve('pathkit-wasm/bin/pathkit.wasm'));
  setPathKit((await init({ wasmBinary: wasm })) as PathKit);
});

const DIR = process.env.HELLOFONTS_EXTRACT;
function readRGBA(path: string): RGBA {
  const buf = readFileSync(path);
  const nl = buf.indexOf(10);
  const [w, h] = buf.subarray(0, nl).toString().split(' ').map(Number);
  return { w, h, data: new Uint8Array(buf.subarray(nl + 1)) };
}

describe.skipIf(!DIR || !existsSync(`${DIR}/sample.rgba`))('샘플 이미지에서 글꼴 뽑기', () => {
  it('본문·제목 글씨', () => {
    const img = readRGBA(`${DIR}/sample.rgba`);
    const out: Record<string, unknown> = {};
    for (const [name, words, preset] of [['body', SAMPLE_BODY_WORDS, 'game-body'], ['title', SAMPLE_TITLE_WORDS, 'game-title']] as const) {
      const { project, report } = extractFont(img, words, createProjectFromPreset(preset, `Sample ${name}`));
      out[name] = report;
      writeFileSync(`${DIR}/ex-${name}.otf`, buildFontFile(project, { charset: 'all', format: 'otf' }).bytes);
      expect(report.hangul.filter((h) => h.ok).length).toBeGreaterThan(0);
    }
    writeFileSync(`${DIR}/report.json`, JSON.stringify(out, null, 1));
  }, 300_000);
});

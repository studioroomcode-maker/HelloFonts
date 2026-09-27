import PathKitInit from 'pathkit-wasm/bin/pathkit.js';
import wasmUrl from 'pathkit-wasm/bin/pathkit.wasm?url';
import { buildFontFile, type Charset, type FontFormat, type WeightSpec } from '../core/fontBuild';
import { setPathKit, type PathKit } from '../core/pathops';
import { makeZip } from '../core/zip';
import type { Project } from '../core/types';

export interface ExportRequest {
  project: Project;
  charset: Charset;
  format: FontFormat;
  weights: WeightSpec[];
  removeOverlap: boolean;
}

export interface ExportedFile {
  fileName: string;
  styleName: string;
  bytes: Uint8Array;
}

export type ExportMessage =
  | { type: 'progress'; done: number; total: number; label: string }
  | { type: 'done'; files: ExportedFile[]; zip: Uint8Array | null; zipName: string }
  | { type: 'error'; message: string };

// 겹침 제거 엔진(WASM) 준비 — 실패하면 겹친 채로 내보낸다
const ready = PathKitInit({ locateFile: () => wasmUrl })
  .then((pk) => setPathKit(pk as PathKit))
  .catch(() => undefined);

const post = (m: ExportMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<ExportRequest>) => {
  const { project, charset, format, weights, removeOverlap } = e.data;
  try {
    await ready;
    const files: ExportedFile[] = [];
    weights.forEach((weight, wi) => {
      const built = buildFontFile(project, {
        charset,
        format,
        weight,
        removeOverlap,
        onProgress: (done, total) => post({ type: 'progress', done: wi * total + done, total: weights.length * total, label: weight.name }),
      });
      files.push({ fileName: built.fileName, styleName: built.styleName, bytes: built.bytes });
    });
    const family = files[0]?.fileName.split('-')[0] ?? 'Font';
    const zip = files.length > 1 ? makeZip(files.map((f) => ({ name: f.fileName, data: f.bytes }))) : null;
    post({ type: 'done', files, zip, zipName: `${family}-${format.toUpperCase()}.zip` });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message });
  }
};

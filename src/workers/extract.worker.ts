import { extractFont, type ExtractReport, type WordSample } from '../core/extract/fitFont';
import type { RGBA } from '../core/extract/image';
import type { Project } from '../core/types';

export interface ExtractRequest {
  img: RGBA;
  words: WordSample[];
  base: Project;
}

export type ExtractMessage =
  | { type: 'done'; project: Project; report: ExtractReport }
  | { type: 'error'; message: string };

const post = (m: ExtractMessage) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<ExtractRequest>) => {
  try {
    const { project, report } = extractFont(e.data.img, e.data.words, e.data.base);
    post({ type: 'done', project, report });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message });
  }
};

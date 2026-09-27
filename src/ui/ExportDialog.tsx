import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { WEIGHTS, type Charset, type FontFormat } from '../core/fontBuild';
import { sanitizeFamilyName } from '../core/project';
import type { ExportedFile, ExportMessage, ExportRequest } from '../workers/export.worker';
import { downloadBytes } from './download';

type Status =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number; label: string }
  | { kind: 'done'; files: ExportedFile[]; zip: Uint8Array | null; zipName: string; testFamily: string }
  | { kind: 'error'; message: string };

const MIME: Record<FontFormat, string> = { ttf: 'font/ttf', otf: 'font/otf' };

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const [format, setFormat] = useState<FontFormat>('ttf');
  const [charset, setCharset] = useState<Charset>('all');
  const [weights, setWeights] = useState<string[]>(['Regular']);
  const [removeOverlap, setRemoveOverlap] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const workerRef = useRef<Worker | null>(null);
  const family = sanitizeFamilyName(project.info.familyName);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      workerRef.current?.terminate();
    };
  }, [onClose]);

  const toggleWeight = (name: string) =>
    setWeights((ws) => (ws.includes(name) ? ws.filter((w) => w !== name) : [...ws, name]));

  const saveAll = (s: Extract<Status, { kind: 'done' }>) => {
    if (s.zip) downloadBytes(s.zip, s.zipName, 'application/zip');
    else if (s.files[0]) downloadBytes(s.files[0].bytes, s.files[0].fileName, MIME[format]);
  };

  const start = () => {
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../workers/export.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setStatus({ kind: 'running', done: 0, total: 1, label: '' });
    worker.onmessage = async (e: MessageEvent<ExportMessage>) => {
      const m = e.data;
      if (m.type === 'progress') setStatus({ kind: 'running', done: m.done, total: m.total, label: m.label });
      else if (m.type === 'error') setStatus({ kind: 'error', message: m.message });
      else {
        // 방금 만든 파일을 브라우저에 올려 실제로 그려지는지 확인한다
        const testFamily = `hf-test-${Date.now()}`;
        const sample = m.files.find((f) => f.styleName === 'Regular') ?? m.files[0];
        try {
          const face = new FontFace(testFamily, sample.bytes.slice().buffer);
          await face.load();
          document.fonts.add(face);
        } catch {
          // 미리보기 실패는 내보내기 자체와 무관
        }
        const done = { kind: 'done' as const, files: m.files, zip: m.zip, zipName: m.zipName, testFamily };
        setStatus(done);
        saveAll(done);
        worker.terminate();
      }
    };
    worker.onerror = (e) => setStatus({ kind: 'error', message: e.message || '알 수 없는 오류' });
    const req: ExportRequest = {
      project,
      charset,
      format,
      weights: WEIGHTS.filter((w) => weights.includes(w.name)),
      removeOverlap,
    };
    worker.postMessage(req);
  };

  const running = status.kind === 'running';
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <h2 id="export-title">폰트 파일로 저장</h2>
        <p className="muted small">
          만든 파일을 윈도우·맥에서 열어 <b>설치</b>하면 워드·한글·포토샵 등 모든 프로그램에서 쓸 수 있습니다. 웹·앱·게임 엔진에는 파일을 그대로 넣으면 됩니다.
        </p>
        <div className="field">
          <span>글꼴 이름</span>
          <code>{family}</code>
          {project.info.familyNameKo && <code>{project.info.familyNameKo}</code>}
        </div>

        <fieldset className="radio-list">
          <legend>파일 형식</legend>
          <label>
            <input type="radio" checked={format === 'ttf'} onChange={() => setFormat('ttf')} />
            TTF <span className="muted small">— 가장 널리 호환(윈도우·오피스·게임 엔진 권장)</span>
          </label>
          <label>
            <input type="radio" checked={format === 'otf'} onChange={() => setFormat('otf')} />
            OTF <span className="muted small">— 곡선이 원본 그대로(디자인·인쇄 프로그램)</span>
          </label>
        </fieldset>

        <fieldset className="radio-list">
          <legend>굵기 (여러 개 고르면 같은 패밀리로 묶여 ZIP 하나로 저장)</legend>
          <div className="weight-row">
            {WEIGHTS.map((w) => (
              <label key={w.name} className="check">
                <input type="checkbox" checked={weights.includes(w.name)} onChange={() => toggleWeight(w.name)} />
                {w.name}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="radio-list">
          <legend>포함할 한글</legend>
          <label>
            <input type="radio" checked={charset === 'all'} onChange={() => setCharset('all')} />
            현대 한글 전체 11,172자 <span className="muted small">— 어떤 한글도 입력 가능</span>
          </label>
          <label>
            <input type="radio" checked={charset === 'ks'} onChange={() => setCharset('ks')} />
            완성형 2,350자 <span className="muted small">— 자주 쓰는 글자만, 파일이 작음(웹용)</span>
          </label>
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={removeOverlap} onChange={(e) => setRemoveOverlap(e.target.checked)} />
          겹친 획 합치기 <span className="muted small">(권장 — 호환성이 좋아지고 파일이 작아짐)</span>
        </label>
        <p className="muted small">라틴 문자·숫자·기호와 한글 낱자(ㄱ~ㅣ)는 항상 들어갑니다.</p>

        {status.kind === 'running' && (
          <div className="progress" role="progressbar" aria-valuenow={status.done} aria-valuemax={status.total}>
            <div className="progress-bar" style={{ width: `${(status.done / status.total) * 100}%` }} />
            <span>{status.label} 만드는 중… {Math.round((status.done / status.total) * 100)}%</span>
          </div>
        )}
        {status.kind === 'error' && <div className="error">저장에 실패했습니다: {status.message}</div>}
        {status.kind === 'done' && (
          <div className="done-box">
            <div>
              {status.zip ? (
                <b>{status.zipName}</b>
              ) : (
                <b>{status.files[0]?.fileName}</b>
              )}{' '}
              ({((status.zip?.length ?? status.files[0]?.bytes.length ?? 0) / 1024 / 1024).toFixed(2)}MB) 저장됨 ·{' '}
              <button className="link" onClick={() => saveAll(status)}>다시 받기</button>
            </div>
            {status.zip && <div className="muted small">{status.files.map((f) => f.fileName).join(', ')}</div>}
            <div className="font-test" style={{ fontFamily: `'${status.testFamily}', monospace` }}>
              다람쥐 헌 쳇바퀴에 타고파 Hello 123
            </div>
            <div className="muted small">↑ 방금 만든 폰트 파일을 브라우저에 설치해 그린 글자입니다.</div>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={running}>닫기</button>
          <button className="btn primary" onClick={start} disabled={running || weights.length === 0}>
            {status.kind === 'done' ? '다시 만들기' : '만들어 저장하기'}
          </button>
        </div>
      </div>
    </div>
  );
}

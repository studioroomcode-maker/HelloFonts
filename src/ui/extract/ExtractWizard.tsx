import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';
import type { Project, Pt } from '../../core/types';
import { PRESETS, createProjectFromPreset } from '../../core/presets';
import type { ExtractReport, WordSample } from '../../core/extract/fitFont';
import type { Box, RGBA } from '../../core/extract/image';
import { SAMPLE_BODY_WORDS, SAMPLE_TITLE_WORDS } from '../../core/extract/sampleWords';
import type { ExtractMessage, ExtractRequest } from '../../workers/extract.worker';
import { GlyphLine } from '../glyphs';
import { capture } from '../pointer';

interface Loaded {
  url: string;
  img: RGBA;
}

interface WordBox {
  id: number;
  box: Box;
  text: string;
}

interface Result {
  project: Project;
  report: ExtractReport;
  /** 이 결과를 만든 입력(상자·글자·바탕) — 입력이 바뀌면 결과가 낡았음을 알린다 */
  key: string;
}

type Drag =
  | { mode: 'draw'; id: number; start: Pt; last: Box }
  | { mode: 'move'; id: number; start: Pt; orig: Box }
  | { mode: 'resize'; id: number; corner: number; orig: Box };

const MAX_SIDE = 4000;
const ZOOMS = [0, 2, 3, 4] as const;
const PREVIEW_LINES = ['다람쥐 헌 쳇바퀴에 타고파', '안녕하세요 반갑습니다', '게임을 시작합니다 준비됐나요', 'The quick brown fox 0123'];

async function loadImage(blob: Blob): Promise<Loaded> {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const url = k === 1 ? URL.createObjectURL(blob) : canvas.toDataURL('image/png');
  return { url, img: { w, h, data } };
}

const norm = (b: Box): Box => ({
  x0: Math.min(b.x0, b.x1), x1: Math.max(b.x0, b.x1), y0: Math.min(b.y0, b.y1), y1: Math.max(b.y0, b.y1),
});
const round = (b: Box): Box => ({ x0: Math.round(b.x0), y0: Math.round(b.y0), x1: Math.round(b.x1), y1: Math.round(b.y1) });
const countChars = (t: string) => [...t].filter((c) => c !== ' ').length;

let nextId = 1;
const toBoxes = (ws: WordSample[]): WordBox[] => ws.map((w) => ({ id: nextId++, box: w.box, text: w.text }));

export function ExtractWizard() {
  const fontId = useStore((s) => s.fontId);
  const current = useStore((s) => s.project);
  const createFont = useStore((s) => s.createFont);
  const commit = useStore((s) => s.commit);
  const set = useStore((s) => s.set);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [boxes, setBoxes] = useState<WordBox[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(0);
  const [presetId, setPresetId] = useState('round');
  const [target, setTarget] = useState<'new' | 'current'>('new');
  const [nameKo, setNameKo] = useState('이미지 글씨');
  const [nameEn, setNameEn] = useState('Image Font');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [pxPerUnit, setPxPerUnit] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<Drag | null>(null);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const workerRef = useRef<Worker | null>(null);

  const words = useMemo<WordSample[]>(
    () => boxes.filter((b) => b.text.trim() && b.box.x1 - b.box.x0 > 2 && b.box.y1 - b.box.y0 > 2).map((b) => ({ text: b.text.trim(), box: round(b.box) })),
    [boxes],
  );
  const inputKey = JSON.stringify([words, target === 'current' && fontId ? `current:${fontId}` : presetId]);
  const fresh = result?.key === inputKey;
  /** 지금 입력과 맞는 결과(없으면 null) */
  const done = fresh ? result : null;

  // 화면 1픽셀이 이미지 몇 픽셀인지(손잡이·글자 크기를 화면 기준으로 맞춘다)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !loaded) return;
    // 맞춤 보기에서는 빈 여백이 생길 수 있어 상자 폭 대신 실제 변환 배율을 쓴다
    const update = () => setPxPerUnit(svg.getScreenCTM()?.a || svg.getBoundingClientRect().width / loaded.img.w || 1);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [loaded, zoom]);

  useEffect(() => () => workerRef.current?.terminate(), []);
  // 이미지를 바꾸거나 화면을 떠나면 이전 이미지 주소를 풀어 준다
  useEffect(() => () => { if (loaded?.url.startsWith('blob:')) URL.revokeObjectURL(loaded.url); }, [loaded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sel === null || (e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        setBoxes((bs) => bs.filter((b) => b.id !== sel));
        setSel(null);
      } else if (e.key === 'Escape') setSel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

  const open = async (blob: Blob, preset?: { boxes: WordSample[]; presetId: string; ko: string; en: string }) => {
    setError(null);
    setBusy('이미지를 읽는 중…');
    try {
      const l = await loadImage(blob);
      setLoaded(l);
      setResult(null);
      setSel(null);
      setBoxes(preset ? toBoxes(preset.boxes) : []);
      if (preset) {
        setPresetId(preset.presetId);
        setNameKo(preset.ko);
        setNameEn(preset.en);
        setZoom(0);
      }
    } catch {
      setError('이미지를 읽을 수 없습니다. PNG·JPG 파일인지 확인해 주세요.');
    }
    setBusy(null);
  };

  const openExample = async (kind: 'body' | 'title') => {
    setBusy('예시 이미지를 불러오는 중…');
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sample-game-ui.png`);
      const blob = await res.blob();
      await open(blob, kind === 'body'
        ? { boxes: SAMPLE_BODY_WORDS, presetId: 'game-body', ko: '샘플 본문', en: 'Sample Body' }
        : { boxes: SAMPLE_TITLE_WORDS, presetId: 'game-title', ko: '샘플 제목', en: 'Sample Title' });
    } catch {
      setBusy(null);
      setError('예시 이미지를 불러오지 못했습니다.');
    }
  };

  const run = () => {
    if (!loaded || !words.length) return;
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../../workers/extract.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const base = target === 'current' && fontId ? current : createProjectFromPreset(presetId);
    const key = inputKey;
    setBusy('글씨체를 뽑는 중… (글자 수에 따라 몇 초 걸립니다)');
    setError(null);
    worker.onmessage = (e: MessageEvent<ExtractMessage>) => {
      const m = e.data;
      if (m.type === 'done') setResult({ project: m.project, report: m.report, key });
      else setError(`뽑지 못했습니다: ${m.message}`);
      setBusy(null);
      worker.terminate();
      workerRef.current = null;
    };
    worker.onerror = () => {
      setError('뽑는 중 문제가 생겼습니다.');
      setBusy(null);
    };
    const req: ExtractRequest = { img: loaded.img, words, base };
    worker.postMessage(req);
  };

  const save = async () => {
    if (!result) return;
    if (target === 'new') {
      const p = structuredClone(result.project);
      p.info = { ...p.info, familyName: nameEn.trim() || 'Image Font', familyNameKo: nameKo.trim() };
      await createFont(p);
    } else {
      commit(() => result.project);
      set({ tab: 'edit' });
    }
  };

  const toImage = (e: React.PointerEvent): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const r = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: Math.max(0, Math.min(loaded!.img.w, r.x)), y: Math.max(0, Math.min(loaded!.img.h, r.y)) };
  };

  const updateBox = (id: number, box: Box) => setBoxes((bs) => bs.map((b) => (b.id === id ? { ...b, box } : b)));

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const q = toImage(e);
    const el = e.target as Element;
    const handle = el.closest('[data-corner]');
    const boxEl = el.closest('[data-box]');
    if (handle && sel !== null) {
      const b = boxes.find((x) => x.id === sel)!;
      drag.current = { mode: 'resize', id: sel, corner: Number(handle.getAttribute('data-corner')), orig: b.box };
    } else if (boxEl) {
      const id = Number(boxEl.getAttribute('data-box'));
      setSel(id);
      drag.current = { mode: 'move', id, start: q, orig: boxes.find((x) => x.id === id)!.box };
    } else {
      const id = nextId++;
      setBoxes((bs) => [...bs, { id, box: { x0: q.x, y0: q.y, x1: q.x, y1: q.y }, text: '' }]);
      setSel(id);
      drag.current = { mode: 'draw', id, start: q, last: { x0: q.x, y0: q.y, x1: q.x, y1: q.y } };
    }
    capture(e.currentTarget, e.pointerId);
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || !loaded) return;
    const q = toImage(e);
    if (d.mode === 'draw') {
      d.last = norm({ x0: d.start.x, y0: d.start.y, x1: q.x, y1: q.y });
      updateBox(d.id, d.last);
    }
    else if (d.mode === 'move') {
      const dx = Math.max(-d.orig.x0, Math.min(loaded.img.w - d.orig.x1, q.x - d.start.x));
      const dy = Math.max(-d.orig.y0, Math.min(loaded.img.h - d.orig.y1, q.y - d.start.y));
      updateBox(d.id, { x0: d.orig.x0 + dx, x1: d.orig.x1 + dx, y0: d.orig.y0 + dy, y1: d.orig.y1 + dy });
    } else {
      const b = { ...d.orig };
      if (d.corner === 0 || d.corner === 3) b.x0 = q.x; else b.x1 = q.x;
      if (d.corner === 0 || d.corner === 1) b.y0 = q.y; else b.y1 = q.y;
      updateBox(d.id, norm(b));
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.mode !== 'draw') return;
    // 거의 끌지 않았으면 상자 대신 선택 해제로 본다(화면이 다시 그려지기 전이어도 끌기 상태의 상자로 판단)
    if (d.last.x1 - d.last.x0 < 4 / pxPerUnit || d.last.y1 - d.last.y0 < 4 / pxPerUnit) {
      setBoxes((bs) => bs.filter((x) => x.id !== d.id));
      setSel(null);
      return;
    }
    setTimeout(() => inputs.current.get(d.id)?.focus(), 0);
  };

  const u = 1 / pxPerUnit; // 화면 1픽셀
  const selBox = boxes.find((b) => b.id === sel);
  const cutsByWord = useMemo(() => {
    const m = new Map<number, number>();
    done?.report.cuts.forEach((c) => m.set(c.word, (m.get(c.word) ?? 0) + 1));
    return m;
  }, [done]);
  const short = done ? words.map((w, i) => ({ i, w, got: cutsByWord.get(i) ?? 0 })).filter((x) => x.got < countChars(x.w.text)) : [];
  const failed = done ? done.report.hangul.filter((h) => !h.ok).map((h) => h.ch) : [];
  const step = !loaded ? 1 : done ? 3 : 2;

  return (
    <div className="hw">
      <div className="hw-head">
        <h1>이미지 속 글씨체로 글꼴 만들기</h1>
        <ol className="hw-steps">
          <li className={step === 1 ? 'active' : ''}>1. 이미지 올리기</li>
          <li className={step === 2 ? 'active' : ''}>2. 낱말 상자 그리기</li>
          <li className={step === 3 ? 'active' : ''}>3. 확인하고 저장</li>
        </ol>
      </div>

      {!loaded ? (
        <div className="drop-zone">
          <p><b>글씨가 들어 있는 이미지</b>(스크린샷·사진·포스터 등)를 올려 주세요.</p>
          <p className="muted small">
            낱말마다 상자를 그리고 글자를 적으면, 그 글자들의 외곽선을 따고 자모를 배워 11,172자 전체를 조합합니다.
            같은 글씨체의 글자가 많을수록, 글씨가 크고 선명할수록 잘 나옵니다.
          </p>
          <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={!!busy}>이미지 고르기</button>
          <div className="btn-row">
            <span className="muted small">예시로 해 보기:</span>
            <button className="btn small" onClick={() => openExample('body')} disabled={!!busy}>게임 화면 · 본문 글씨</button>
            <button className="btn small" onClick={() => openExample('title')} disabled={!!busy}>게임 화면 · 제목 글씨</button>
          </div>
          {busy && <p className="muted small">{busy}</p>}
          {error && <p className="error small">{error}</p>}
        </div>
      ) : (
        <div className="ex-work">
          <div className="ex-left">
            <div className="hw-toolbar">
              <div className="seg-group" role="radiogroup" aria-label="확대">
                {ZOOMS.map((z) => (
                  <button key={z} role="radio" aria-checked={zoom === z} className={zoom === z ? 'seg active' : 'seg'} onClick={() => setZoom(z)}>
                    {z === 0 ? '맞춤' : `${z}×`}
                  </button>
                ))}
              </div>
              <span className="muted small">글씨 위를 끌어 낱말 상자를 그리세요. 상자를 누르면 옮기거나 모서리로 크기를 바꿀 수 있고, Delete로 지웁니다.</span>
            </div>
            <div className="ex-frame">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${loaded.img.w} ${loaded.img.h}`}
                style={zoom ? { width: loaded.img.w * zoom } : undefined}
                className={zoom ? 'zoomed' : ''}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              >
                <image href={loaded.url} width={loaded.img.w} height={loaded.img.h} />
                {done?.report.cuts.map((c, i) => (
                  <g key={`c${i}`} className="ex-cut">
                    <rect x={c.box.x0} y={c.box.y0} width={c.box.x1 - c.box.x0} height={c.box.y1 - c.box.y0} strokeWidth={u} />
                    <text x={(c.box.x0 + c.box.x1) / 2} y={c.box.y1 + 12 * u} fontSize={11 * u}>{c.ch}</text>
                  </g>
                ))}
                {boxes.map((b, i) => (
                  <g key={b.id} data-box={b.id} className={b.id === sel ? 'ex-box sel' : b.text.trim() ? 'ex-box' : 'ex-box empty'}>
                    <rect x={b.box.x0} y={b.box.y0} width={b.box.x1 - b.box.x0} height={b.box.y1 - b.box.y0} strokeWidth={2 * u} />
                    <text x={b.box.x0} y={b.box.y0 - 4 * u} fontSize={12 * u}>{i + 1}{b.text.trim() ? ` ${b.text.trim()}` : ''}</text>
                  </g>
                ))}
                {selBox && [[selBox.box.x0, selBox.box.y0], [selBox.box.x1, selBox.box.y0], [selBox.box.x1, selBox.box.y1], [selBox.box.x0, selBox.box.y1]].map(([x, y], k) => (
                  <rect key={k} data-corner={k} className="ex-handle" x={x - 5 * u} y={y - 5 * u} width={10 * u} height={10 * u} strokeWidth={1.5 * u} />
                ))}
              </svg>
            </div>
          </div>

          <aside className="hw-options ex-side">
            <h3>낱말 상자 {boxes.length ? `(${boxes.length})` : ''}</h3>
            {boxes.length === 0 && <p className="muted small">아직 상자가 없습니다. 왼쪽 이미지에서 낱말 하나를 감싸도록 끌어 보세요.</p>}
            <ol className="ex-list">
              {boxes.map((b, i) => (
                <li key={b.id} className={b.id === sel ? 'sel' : ''} onClick={() => setSel(b.id)}>
                  <span className="ex-num">{i + 1}</span>
                  <input
                    ref={(el) => { if (el) inputs.current.set(b.id, el); else inputs.current.delete(b.id); }}
                    value={b.text}
                    placeholder="상자 속 글자 그대로"
                    aria-label={`${i + 1}번 상자의 글자`}
                    onFocus={() => setSel(b.id)}
                    onChange={(e) => setBoxes((bs) => bs.map((x) => (x.id === b.id ? { ...x, text: e.target.value } : x)))}
                  />
                  <button className="btn small ghost" aria-label={`${i + 1}번 상자 지우기`} onClick={(e) => { e.stopPropagation(); setBoxes((bs) => bs.filter((x) => x.id !== b.id)); if (sel === b.id) setSel(null); }}>×</button>
                </li>
              ))}
            </ol>
            <p className="muted small">띄어쓰기까지 이미지와 똑같이 적어 주세요. 한 번에 한 가지 글씨체만 넣습니다(제목과 본문처럼 다르면 따로 만드세요).</p>

            <h3>바탕 글꼴</h3>
            <label className="field-grid one">
              <span className="small muted">이미지에 없는 자모와 영문·숫자는 이 글꼴의 모양을 씁니다.</span>
              <select value={presetId} onChange={(e) => setPresetId(e.target.value)} disabled={target === 'current'}>
                {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <fieldset className="radio-list">
              <label>
                <input type="radio" checked={target === 'new'} onChange={() => setTarget('new')} />
                새 글꼴로 만들기
              </label>
              <label>
                <input type="radio" checked={target === 'current'} disabled={!fontId} onChange={() => setTarget('current')} />
                지금 연 글꼴에 입히기 {fontId ? `(${current.info.familyNameKo || current.info.familyName})` : ''}
              </label>
            </fieldset>

            <div className="btn-row">
              <button className="btn primary" onClick={run} disabled={!words.length || !!busy}>{result && !fresh ? '다시 뽑기' : '글씨체 뽑기'}</button>
              <button className="btn" onClick={() => fileRef.current?.click()} disabled={!!busy}>다른 이미지</button>
            </div>
            {busy && <p className="muted small">{busy}</p>}
            {error && <p className="error small">{error}</p>}
            {result && !fresh && <p className="muted small">상자나 글자를 바꿨습니다. 다시 뽑으면 반영됩니다.</p>}
            {done && (
              <>
                <p className="small">
                  한글 {done.report.hangul.length}자 · 영문·숫자·기호 {done.report.latin.length}자를 읽었습니다.
                  이미지 위 가는 칸이 글자마다 자른 자리입니다.
                </p>
                {short.length > 0 && (
                  <p className="error small">
                    {short.map((x) => `${x.i + 1}번 상자(${x.w.text})`).join(', ')}: 적은 글자 수보다 잘린 글자가 적습니다. 상자가 글씨를 다 감싸는지, 글자를 맞게 적었는지 확인하세요.
                  </p>
                )}
                {failed.length > 0 && <p className="muted small">자모를 나누지 못한 글자: {failed.join(' ')} (원본 모양은 그대로 쓰고, 조합용 자모로는 배우지 않았습니다)</p>}
              </>
            )}
          </aside>
        </div>
      )}

      {done && (
        <div className="hw-tidy ex-result">
          <aside className="hw-options">
            <h3>저장</h3>
            {target === 'new' ? (
              <div className="field-grid one">
                <label><span>한글 이름</span><input value={nameKo} onChange={(e) => setNameKo(e.target.value)} /></label>
                <label><span>영문 이름</span><input value={nameEn} onChange={(e) => setNameEn(e.target.value)} /></label>
              </div>
            ) : (
              <p className="small">지금 연 글꼴에 입힙니다. 되돌리기(Ctrl+Z)로 취소할 수 있습니다.</p>
            )}
            <div className="btn-row">
              <button className="btn primary" onClick={save}>{target === 'new' ? '글꼴 만들기' : '입히기'}</button>
            </div>
            <p className="muted small">
              이미지에 있던 글자는 원본 외곽선을 그대로 쓰고, 나머지 글자는 배운 자모를 조합합니다.
              이미지에 없던 자모는 바탕 글꼴의 모양이라 느낌이 조금 다를 수 있습니다.
            </p>
          </aside>
          <section className="hw-preview">
            <h4>이미지에 있던 글자</h4>
            <div className="ex-words">
              {[...new Set(words.map((w) => w.text))].map((t) => (
                <GlyphLine key={t} project={done.project} text={t} size={44} />
              ))}
            </div>
            <h4>이미지에 없던 글자(조합)</h4>
            {PREVIEW_LINES.map((t) => (
              <div key={t} className="preview-line">
                <GlyphLine project={done.project} text={t} size={44} />
              </div>
            ))}
          </section>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) open(f);
        }}
      />
    </div>
  );
}

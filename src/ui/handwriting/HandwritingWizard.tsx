import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import type { Project } from '../../core/types';
import { createProjectFromPreset } from '../../core/presets';
import { PAGES } from '../../core/handwriting/template';
import { applyHandwriting } from '../../core/handwriting/apply';
import { cleanupFromTidy, type CellInk, type CleanupOptions } from '../../core/handwriting/fit';
import { GlyphLine } from '../glyphs';
import { PhotoStep } from './PhotoStep';
import { DrawStep } from './DrawStep';
import { InkThumb } from './InkThumb';
import { printSheets, templateSvg } from './templateSvg';

type Method = 'paper' | 'screen';
type Step = 'method' | 'collect' | 'tidy';

/** 손글씨용 기본 바탕: 흔들림·기울기 없이(실제 손글씨의 개성을 그대로 쓴다) */
function handwritingBase(): Project {
  const p = createProjectFromPreset('handwriting', 'My Handwriting', '내 손글씨');
  p.params = { ...p.params, jitter: 0, wobble: 0, slant: 0, pressureStart: 1, pressureMid: 1, pressureEnd: 1 };
  return p;
}

export function HandwritingWizard() {
  const fontId = useStore((s) => s.fontId);
  const current = useStore((s) => s.project);
  const createFont = useStore((s) => s.createFont);
  const commit = useStore((s) => s.commit);
  const set = useStore((s) => s.set);
  const [step, setStep] = useState<Step>('method');
  const [method, setMethod] = useState<Method>('paper');
  const [pageIdx, setPageIdx] = useState(0);
  const [inks, setInks] = useState<Record<string, (CellInk | undefined)[]>>({ hangul: [], latin: [] });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [tidy, setTidy] = useState(0.5);
  const [advanced, setAdvanced] = useState<CleanupOptions | null>(null);
  const [useWeight, setUseWeight] = useState(true);
  const [target, setTarget] = useState<'new' | 'current'>('new');
  const [nameKo, setNameKo] = useState('내 손글씨');
  const [nameEn, setNameEn] = useState('My Handwriting');

  const base = useMemo(() => (target === 'current' && fontId ? current : handwritingBase()), [target, fontId, current]);
  const page = PAGES[pageIdx];
  const opts = useMemo(() => advanced ?? cleanupFromTidy(tidy), [advanced, tidy]);

  const inputs = useMemo(
    () =>
      PAGES.flatMap((pg) =>
        pg.cells
          .map((cell, i) => ({ cell, ink: inks[pg.id][i] }))
          .filter((x): x is { cell: typeof x.cell; ink: CellInk } => !!x.ink && x.ink.lines.length > 0 && !excluded.has(`${pg.id}:${x.cell.text}`)),
      ),
    [inks, excluded],
  );
  const result = useMemo(() => (inputs.length ? applyHandwriting(base, inputs, opts, useWeight) : null), [base, inputs, opts, useWeight]);
  const collected = inputs.length;

  const setPageInks = (id: string, list: (CellInk | undefined)[]) => setInks((m) => ({ ...m, [id]: list }));

  const save = async () => {
    if (!result) return;
    if (target === 'new') {
      const p = structuredClone(result.project);
      p.info = { ...p.info, familyName: nameEn.trim() || 'My Handwriting', familyNameKo: nameKo.trim() };
      await createFont(p);
    } else {
      commit(() => result.project);
      set({ tab: 'edit' });
    }
  };

  return (
    <div className="hw">
      <div className="hw-head">
        <h1>내 손글씨로 글꼴 만들기</h1>
        <ol className="hw-steps">
          <li className={step === 'method' ? 'active' : ''}>1. 방법 고르기</li>
          <li className={step === 'collect' ? 'active' : ''}>2. {method === 'paper' ? '원고지 사진 올리기' : '화면에 쓰기'}</li>
          <li className={step === 'tidy' ? 'active' : ''}>3. 정리하고 저장</li>
        </ol>
      </div>

      {step === 'method' && (
        <div className="hw-methods">
          <button className="method-card" onClick={() => { setMethod('paper'); setStep('collect'); }}>
            <b>종이에 써서 사진 올리기</b>
            <span className="muted small">원고지를 인쇄해 펜으로 쓰고, 휴대폰으로 찍어 올립니다. 평소 손글씨 그대로 나옵니다.</span>
          </button>
          <button className="method-card" onClick={() => { setMethod('screen'); setStep('collect'); }}>
            <b>화면에 직접 쓰기</b>
            <span className="muted small">마우스나 펜 태블릿으로 칸마다 씁니다. 태블릿 필압이 획 굵기로 들어갑니다.</span>
          </button>
          <div className="hw-note small muted">
            한글 56자(자음 14자 × 3자리 + 모음 14자)만 쓰면 조합 엔진이 <b>11,172자 전체</b>를 만듭니다. 영문·숫자 73자는 원하면 추가로 씁니다.
          </div>
        </div>
      )}

      {step === 'collect' && (
        <div className="hw-collect">
          <div className="hw-toolbar">
            <div className="seg-group" role="radiogroup" aria-label="원고지">
              {PAGES.map((pg, i) => (
                <button key={pg.id} role="radio" aria-checked={pageIdx === i} className={pageIdx === i ? 'seg active' : 'seg'} onClick={() => setPageIdx(i)}>
                  {pg.title}
                  {inks[pg.id].some((x) => x?.lines.length) && ' ✓'}
                </button>
              ))}
            </div>
            {method === 'paper' && (
              <>
                <button className="btn" onClick={() => printSheets(PAGES.map((pg, i) => templateSvg(pg, base, i + 1, PAGES.length)))}>원고지 인쇄</button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    const svg = templateSvg(page, base, pageIdx + 1, PAGES.length);
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
                    a.download = `hellofonts-원고지-${page.id}.svg`;
                    a.click();
                  }}
                >
                  이 장을 SVG로 저장
                </button>
              </>
            )}
            <div className="topbar-spacer" />
            <button className="btn" onClick={() => setStep('method')}>← 방법 다시 고르기</button>
            <button className="btn primary" onClick={() => setStep('tidy')} disabled={!collected}>정리하기 → ({collected}칸)</button>
          </div>

          {method === 'paper' ? (
            <>
              <PhotoStep page={page} project={base} onRecognized={(list) => setPageInks(page.id, list)} />
              {inks[page.id].length > 0 && (
                <RecognizedGrid pageId={page.id} inks={inks[page.id]} project={base} excluded={excluded} onToggle={(k) => setExcluded((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />
              )}
            </>
          ) : (
            <DrawStep
              page={page}
              project={base}
              inks={inks[page.id]}
              onChange={(i, ink) => setInks((m) => {
                const list = [...m[page.id]];
                list[i] = ink;
                return { ...m, [page.id]: list };
              })}
            />
          )}
        </div>
      )}

      {step === 'tidy' && (
        <div className="hw-tidy">
          <aside className="hw-options">
            <h3>정리</h3>
            <label className="tidy-slider">
              <span>개성 유지</span>
              <input type="range" min={0} max={1} step={0.05} value={tidy} disabled={!!advanced} onChange={(e) => setTidy(+e.target.value)} aria-label="정리 정도" />
              <span>반듯하게</span>
            </label>
            <label className="check small">
              <input type="checkbox" checked={!!advanced} onChange={(e) => setAdvanced(e.target.checked ? cleanupFromTidy(tidy) : null)} />
              세부 조절
            </label>
            {advanced && (
              <div className="expert">
                {([['smooth', '부드럽게'], ['straighten', '가로·세로 바로잡기'], ['fill', '자리 채우기']] as const).map(([k, label]) => (
                  <label key={k} className="slider">
                    <span className="slider-label">{label}</span>
                    <input type="range" min={0} max={1} step={0.05} value={advanced[k]} onChange={(e) => setAdvanced({ ...advanced, [k]: +e.target.value })} />
                    <span className="slider-num">{Math.round(advanced[k] * 100)}</span>
                  </label>
                ))}
                <label className="check small">
                  <input type="checkbox" checked={advanced.evenWidth} onChange={(e) => setAdvanced({ ...advanced, evenWidth: e.target.checked })} />
                  굵기 고르게(필압 무시)
                </label>
              </div>
            )}
            <label className="check small">
              <input type="checkbox" checked={useWeight} onChange={(e) => setUseWeight(e.target.checked)} />
              내 펜 굵기를 글꼴 굵기로 쓰기
            </label>
            <h3>저장</h3>
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
            {target === 'new' && (
              <div className="field-grid one">
                <label><span>한글 이름</span><input value={nameKo} onChange={(e) => setNameKo(e.target.value)} /></label>
                <label><span>영문 이름</span><input value={nameEn} onChange={(e) => setNameEn(e.target.value)} /></label>
              </div>
            )}
            <div className="btn-row">
              <button className="btn" onClick={() => setStep('collect')}>← 돌아가기</button>
              <button className="btn primary" onClick={save} disabled={!result}>{target === 'new' ? '글꼴 만들기' : '입히기'}</button>
            </div>
            {result && (
              <p className="muted small">
                {result.report.applied.length}칸 반영 · 글꼴 굵기 {result.report.weight}
                {result.report.empty.length > 0 && ` · 자모를 찾지 못한 칸: ${result.report.empty.join(' ')}`}
              </p>
            )}
          </aside>
          <section className="hw-preview">
            {result ? (
              <>
                {['다람쥐 헌 쳇바퀴에 타고파', '키스의 고유 조건은 입술끼리', '만나야 하고 특별한 기술은 필요치 않다', 'The quick brown fox 0123'].map((t) => (
                  <div key={t} className="preview-line">
                    <GlyphLine project={result.project} text={t} size={46} />
                  </div>
                ))}
                <div className="hw-waterfall">
                  {[16, 24].map((s) => (
                    <GlyphLine key={s} project={result.project} text="손글씨로 만든 나만의 글꼴입니다. Hello!" size={s} />
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">읽은 글씨가 없습니다.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function RecognizedGrid({
  pageId, inks, project, excluded, onToggle,
}: {
  pageId: string;
  inks: (CellInk | undefined)[];
  project: Project;
  excluded: Set<string>;
  onToggle: (key: string) => void;
}) {
  const page = PAGES.find((p) => p.id === pageId)!;
  const empty = inks.filter((x) => !x?.lines.length).length;
  return (
    <div className="recognized">
      <p className="small">
        읽은 결과입니다. 잘못 읽힌 칸은 눌러서 <b>빼기</b>(기본 모양 사용)로 바꿀 수 있습니다.
        {empty > 0 && <span className="muted"> 비어 있는 칸 {empty}개</span>}
      </p>
      <div className="cell-grid">
        {page.cells.map((cell, i) => {
          const key = `${pageId}:${cell.text}`;
          const ink = inks[i];
          const off = excluded.has(key);
          return (
            <button key={i} className={`cell-btn ${ink?.lines.length ? 'done' : 'empty'} ${off ? 'off' : ''}`} onClick={() => onToggle(key)} title={off ? '빼기 취소' : '이 칸 빼기'}>
              <span className="cell-label">{cell.text}</span>
              {ink?.lines.length ? <InkThumb cell={cell} project={project} ink={ink} /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

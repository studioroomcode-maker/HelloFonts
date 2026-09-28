import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { CapStyle, JoinStyle, Params, Project, Rect, Role, SerifStyle } from '../core/types';
import {
  bakeCompound, findTarget, nodeWidth, removeGlyph, setGlyph, setNodeWidth, toggleCurve, updateStrokes,
} from '../core/edit';
import { jamoKey, SCOPE_LABEL, SCOPES, createDefaultProject, type Scope } from '../core/project';
import { parseSkeleton, serializeSkeleton } from '../core/pathparse';
import { BUL_LABEL, decompose, DOUBLE_CONSONANT, LAYOUT_LABEL, type LayoutKey } from '../core/hangul';
import { layoutKeyFor } from '../core/compose';
import { DEFAULT_LAYOUTS, talnemoLayouts } from '../core/defaults/hangul';
import { applyPresetStyle, PRESETS } from '../core/presets';

const ROLE_LABEL: Record<Role, string> = { cho: '초성', jung: '중성', jong: '종성' };

export function Inspector() {
  return (
    <div className="inspector">
      <TargetSection />
      <StyleSection />
      <LayoutSection />
      <MetricsSection />
      <ReferenceSection />
    </div>
  );
}

function Group({ title, children, open = true }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="group" open={open}>
      <summary>{title}</summary>
      <div className="group-body">{children}</div>
    </details>
  );
}

// ───────────────────────── 슬라이더 ─────────────────────────

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  onChange: (v: number) => void;
}

function Slider({ label, value, min, max, step = 1, unit, hint, onChange }: SliderProps) {
  const beginGesture = useStore((s) => s.beginGesture);
  const nudge = (d: number) => {
    beginGesture();
    onChange(Math.min(max, Math.max(min, Math.round((value + d) / step) * step)));
  };
  return (
    <div className="slider" title={hint}>
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onPointerDown={beginGesture}
        onKeyDown={beginGesture}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <input
        className="slider-num"
        type="number"
        min={min}
        max={max}
        step={step}
        aria-label={`${label} 값`}
        value={Number.isInteger(step) ? Math.round(value) : Math.round(value * 100) / 100}
        onFocus={beginGesture}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
      />
      <span className="stepper">
        <button type="button" onClick={() => nudge(-step)} aria-label={`${label} 줄이기`}>−</button>
        <button type="button" onClick={() => nudge(step)} aria-label={`${label} 늘리기`}>+</button>
      </span>
      {unit && <span className="slider-unit">{unit}</span>}
    </div>
  );
}

function useParam() {
  const live = useStore((s) => s.live);
  return <K extends keyof Params>(k: K, v: Params[K]) => live((p) => ({ ...p, params: { ...p.params, [k]: v } }));
}

function useTarget() {
  const project = useStore((s) => s.project);
  const sample = useStore((s) => s.sample);
  const role = useStore((s) => s.role);
  const part = useStore((s) => s.part);
  return { project, target: useMemo(() => findTarget(project, sample, role, part), [project, sample, role, part]) };
}

function scopeText(scope: Scope, role: Role, bul: string): string {
  if (scope === 'bul') return `${BUL_LABEL[role][bul] ?? bul}에서만`;
  return SCOPE_LABEL[scope];
}

// ───────────────────────── 편집 대상 ─────────────────────────

function TargetSection() {
  const { project, target } = useTarget();
  const sample = useStore((s) => s.sample);
  const selStroke = useStore((s) => s.selStroke);
  const selNode = useStore((s) => s.selNode);
  const set = useStore((s) => s.set);
  const commit = useStore((s) => s.commit);
  const live = useStore((s) => s.live);
  const pl = target?.placement ?? null;
  const comp = target?.comp;

  if (!target || !pl) {
    return (
      <Group title="편집 대상">
        <p className="muted">왼쪽에서 글자를 고르거나 입력하세요.</p>
      </Group>
    );
  }

  const key = pl.key;
  const def = key ? project.glyphs[key] : null;
  const stroke = selStroke !== null ? pl.skeleton[selStroke] : undefined;
  const scopeIdx = pl.scope ? SCOPES.indexOf(pl.scope) : SCOPES.length;
  const narrower = comp?.kind === 'hangul'
    ? SCOPES.slice(0, scopeIdx).filter((s) => jamoKey(pl.jamo, pl.role, pl.ctx, s) !== null)
    : [];
  const width = key && selNode ? nodeWidth(pl.skeleton, selNode) : null;

  const fork = (scope: Scope) => {
    const k = jamoKey(pl.jamo, pl.role, pl.ctx, scope);
    if (k) commit((p) => setGlyph(p, k, { kind: 'jamo', strokes: structuredClone(pl.skeleton) }));
  };

  return (
    <Group title="편집 대상">
      {comp?.kind === 'hangul' ? (
        <div className="target-head">
          <span className="target-jamo">{pl.jamo}</span>
          <div>
            <div>
              <b>{ROLE_LABEL[pl.role]}</b>
              {pl.part !== null && <span className="muted"> · ‘{pl.owner}’의 {pl.part + 1}번째 조각</span>}
            </div>
            <div className="muted small">
              {comp.layout ? LAYOUT_LABEL[comp.layout] : '낱자'}
              {comp.layout && ` · ${BUL_LABEL[pl.role][pl.ctx.bul] ?? ''}`}
            </div>
          </div>
        </div>
      ) : (
        <div className="target-head">
          <span className="target-jamo latin">{sample}</span>
          <div className="muted small">라틴 · 숫자 · 기호</div>
        </div>
      )}

      {comp?.kind === 'hangul' && (
        <div className="scope-box">
          {key ? (
            <>
              <div className="small">
                지금 쓰는 모양: <b>{scopeText(pl.scope!, pl.role, pl.ctx.bul)}</b> <code>{key}</code>
              </div>
              {narrower.length > 0 && (
                <div className="btn-col">
                  {narrower.map((s) => (
                    <button key={s} className="btn small ghost" onClick={() => fork(s)}>
                      ＋ {scopeText(s, pl.role, pl.ctx.bul)} 따로 만들기
                    </button>
                  ))}
                </div>
              )}
              {pl.scope !== 'base' && (
                <button className="btn small danger ghost" onClick={() => commit((p) => removeGlyph(p, key))}>
                  이 변형 지우기 (넓은 범위 모양으로 되돌림)
                </button>
              )}
            </>
          ) : (
            <div className="small">
              아직 정의가 없습니다. 펜이나 타원 도구로 그리면 <b>모든 곳에서</b> 쓰는 기본형이 만들어집니다.
            </div>
          )}
          {pl.part !== null && comp && (
            <button
              className="btn small ghost"
              onClick={() => {
                const baked = bakeCompound(project, comp, pl.owner, pl.role);
                if (!baked) return;
                commit((p) => setGlyph(p, baked.key, baked.def));
                set({ part: null, selNode: null, selStroke: null });
              }}
            >
              ‘{pl.owner}’ 통째로 따로 그리기
            </button>
          )}
        </div>
      )}

      {comp?.kind === 'latin' && def && (
        <Slider
          label="글자 폭"
          value={def.width ?? 0}
          min={0}
          max={1200}
          step={5}
          onChange={(v) => live((p) => setGlyph(p, key!, { ...def, width: v }))}
        />
      )}

      {key && stroke && (
        <div className="stroke-tools">
          <div className="small muted">선택한 획 #{selStroke! + 1} · {stroke.kind === 'ellipse' ? '타원' : `점 ${stroke.segs.length + 1}개`}</div>
          <div className="btn-row">
            {stroke.kind === 'path' && (
              <button
                className="btn small"
                onClick={() => commit((p) => updateStrokes(p, key, (ss) => ss.map((s, i) => (i === selStroke && s.kind === 'path' ? { ...s, closed: !s.closed } : s))))}
              >
                {stroke.closed ? '열린 획으로' : '닫힌 획으로'}
              </button>
            )}
            {selNode && selNode.at === 'seg' && (
              <button className="btn small" onClick={() => commit((p) => updateStrokes(p, key, (ss) => toggleCurve(ss, selNode.stroke, selNode.seg)))}>
                곡선 ↔ 직선 <kbd>C</kbd>
              </button>
            )}
            <button
              className="btn small danger"
              onClick={() => {
                commit((p) => updateStrokes(p, key, (ss) => ss.filter((_, i) => i !== selStroke)));
                set({ selStroke: null, selNode: null });
              }}
            >
              획 삭제
            </button>
          </div>
          {width !== null && selNode && (
            <Slider
              label="이 점 굵기"
              hint="필압: 이 점에서 획이 얼마나 굵어지거나 가늘어질지"
              value={width}
              min={0.1}
              max={2.5}
              step={0.05}
              onChange={(v) => live((p) => updateStrokes(p, key, (ss) => setNodeWidth(ss, selNode, v)))}
            />
          )}
          {stroke.kind === 'ellipse' && comp?.kind === 'hangul' && (
            <Slider
              label="원형 유지"
              value={stroke.keep ?? 0}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => live((p) => updateStrokes(p, key, (ss) => ss.map((s, i) => (i === selStroke && s.kind === 'ellipse' ? { ...s, keep: v } : s))))}
            />
          )}
        </div>
      )}

      {key && <SkeletonCode glyphKey={key} project={project} />}
    </Group>
  );
}

function SkeletonCode({ glyphKey, project }: { glyphKey: string; project: Project }) {
  const commit = useStore((s) => s.commit);
  const def = project.glyphs[glyphKey];
  const code = def ? serializeSkeleton(def.strokes) : '';
  const [draft, setDraft] = useState(code);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(code);
  }, [code]);

  return (
    <details className="code-box">
      <summary>뼈대 코드</summary>
      <textarea
        value={draft}
        spellCheck={false}
        rows={4}
        aria-label="뼈대 코드"
        onFocus={() => (focused.current = true)}
        onBlur={() => (focused.current = false)}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
      />
      <div className="btn-row">
        <button
          className="btn small"
          onClick={() => {
            try {
              const strokes = parseSkeleton(draft);
              commit((p) => setGlyph(p, glyphKey, { ...def, strokes }));
              setError(null);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          적용
        </button>
        <span className="muted small">M·L·C·Q·Z 경로, O 타원, W 점 굵기</span>
      </div>
      {error && <div className="error small">{error}</div>}
    </details>
  );
}

// ───────────────────────── 스타일 ─────────────────────────

function StyleSection() {
  const params = useStore((s) => s.project.params);
  const commit = useStore((s) => s.commit);
  const setParam = useParam();
  const [expert, setExpert] = useState(false);
  const setSelect = <K extends keyof Params>(k: K, v: Params[K]) => commit((p) => ({ ...p, params: { ...p.params, [k]: v } }));

  return (
    <Group title="스타일">
      <div className="style-head">
        <select
          aria-label="스타일 프리셋 적용"
          value=""
          onChange={(e) => {
            const id = e.target.value;
            if (id) commit((p) => ({ ...p, preset: id, params: applyPresetStyle(p.params, id) }));
          }}
        >
          <option value="">프리셋 스타일 입히기…</option>
          {PRESETS.map((x) => (
            <option key={x.id} value={x.id}>{x.name}</option>
          ))}
        </select>
        <label className="check small">
          <input type="checkbox" checked={expert} onChange={(e) => setExpert(e.target.checked)} />
          세부 설정
        </label>
      </div>

      <Slider label="굵기" value={params.weight} min={10} max={320} onChange={(v) => setParam('weight', v)} />
      <Slider label="자모 간격" value={params.gap} min={0} max={160} onChange={(v) => setParam('gap', v)} />
      <Slider label="획 사이 틈" hint="겹쳐 쌓인 가로획·나란한 세로 기둥 사이의 최소 틈(획 굵기 대비). 뚱뚱한 글씨는 작게" value={params.strokeGap} min={0.05} max={1.5} step={0.05} onChange={(v) => setParam('strokeGap', v)} />
      <Slider label="굵기 대비" hint="0이면 모든 획이 같은 굵기, 클수록 가로획이 가늘어짐(명조)" value={params.contrast} min={0} max={0.9} step={0.01} onChange={(v) => setParam('contrast', v)} />
      <div className="field-row three">
        <label>
          <span>획 끝</span>
          <select value={params.cap} onChange={(e) => setSelect('cap', e.target.value as CapStyle)}>
            <option value="round">둥글게</option>
            <option value="flat">반듯하게</option>
            <option value="soft">살짝 둥글게</option>
            <option value="square">네모로</option>
            <option value="angled">붓 각도로</option>
          </select>
        </label>
        <label>
          <span>꺾임</span>
          <select value={params.join} onChange={(e) => setSelect('join', e.target.value as JoinStyle)}>
            <option value="round">둥글게</option>
            <option value="miter">뾰족하게</option>
            <option value="bevel">깎기</option>
          </select>
        </label>
        <label>
          <span>장식</span>
          <select value={params.serif} onChange={(e) => setSelect('serif', e.target.value as SerifStyle)}>
            <option value="none">없음(민부리)</option>
            <option value="myeongjo">명조 부리·맺음</option>
            <option value="bracket">세리프(받침)</option>
            <option value="slab">슬래브 세리프</option>
          </select>
        </label>
      </div>

      {expert && (
        <div className="expert">
          <h4>펜</h4>
          <Slider label="펜 각도" hint="가장 가는 획의 방향. 0° = 가로획이 가늘다" value={params.penAngle} min={-90} max={90} unit="°" onChange={(v) => setParam('penAngle', v)} />
          {params.serif !== 'none' && (
            <Slider label="장식 크기" value={params.serifSize} min={0.1} max={1.5} step={0.05} onChange={(v) => setParam('serifSize', v)} />
          )}
          {params.serif === 'myeongjo' && (
            <label className="check small">
              <input type="checkbox" checked={params.kkokji} onChange={(e) => setSelect('kkokji', e.target.checked)} />
              꼭지이응 (ㅇ 위의 꼭지)
            </label>
          )}
          <h4>필압 — 획의 시작·가운데·끝 굵기</h4>
          <Slider label="기필(시작)" value={params.pressureStart} min={0.2} max={2} step={0.05} onChange={(v) => setParam('pressureStart', v)} />
          <Slider label="행필(가운데)" value={params.pressureMid} min={0.2} max={2} step={0.05} onChange={(v) => setParam('pressureMid', v)} />
          <Slider label="수필(끝)" value={params.pressureEnd} min={0.2} max={2} step={0.05} onChange={(v) => setParam('pressureEnd', v)} />
          <h4>손글씨</h4>
          <Slider label="밀도 보정" hint="획이 빽빽한 음절에서 칸이 모자랄 때 쌓인 획을 가늘게 하는 정도. 0이면 굵기를 지키고 틈이 좁아진다" value={params.density} min={0} max={1} step={0.05} onChange={(v) => setParam('density', v)} />
          <Slider label="흔들림" value={params.jitter} min={0} max={50} onChange={(v) => setParam('jitter', v)} />
          <Slider label="글자 기울어짐" value={params.wobble} min={0} max={12} step={0.5} unit="°" onChange={(v) => setParam('wobble', v)} />
          <Slider label="전체 기울기" hint="이탤릭처럼 모든 글자를 기울임" value={params.slant} min={-20} max={20} step={0.5} unit="°" onChange={(v) => setParam('slant', v)} />
          {(params.jitter > 0 || params.wobble > 0) && (
            <button className="btn small ghost" onClick={() => commit((p) => ({ ...p, params: { ...p.params, seed: p.params.seed + 1 } }))}>
              흔들림 다시 섞기
            </button>
          )}
        </div>
      )}
    </Group>
  );
}

// ───────────────────────── 배치 틀 ─────────────────────────

const SLOT_LABEL: Record<string, string> = { cho: '초성', jung: '중성', jungH: '중성(가로)', jungV: '중성(세로)', jong: '종성' };

function LayoutSection() {
  const { project, target } = useTarget();
  const sample = useStore((s) => s.sample);
  const live = useStore((s) => s.live);
  const commit = useStore((s) => s.commit);
  const layout = target?.comp.layout as LayoutKey | undefined;
  if (!layout) return null;
  const ownKey = `!${sample}`;
  const own = !!project.layouts[ownKey];
  const jung = decompose(sample)?.jung ?? '';
  const layoutKey = layoutKeyFor(project, sample, layout, jung);
  const vowelOwn = !own && layoutKey !== layout;
  const L = project.layouts[layoutKey];
  const slots = (['cho', 'jung', 'jungH', 'jungV', 'jong'] as const).filter((k) => L[k] && !(k === 'jung' && L.jungH));
  const pl = target?.placement;
  const pair = pl && pl.part !== null && DOUBLE_CONSONANT[pl.owner] ? pl.owner : null;

  const setRect = (slot: (typeof slots)[number], k: keyof Rect, v: number) =>
    live((p) => {
      const cur = p.layouts[layoutKey];
      return { ...p, layouts: { ...p.layouts, [layoutKey]: { ...cur, [slot]: { ...cur[slot]!, [k]: v / 100 } } } };
    });

  return (
    <Group title={own ? `배치 틀 · ‘${sample}’ 전용` : vowelOwn ? `배치 틀 · ${LAYOUT_LABEL[layout]} · ${jung} 전용` : `배치 틀 · ${LAYOUT_LABEL[layout]}`}>
      <p className="muted small">글자 칸을 100으로 볼 때 각 자리의 왼쪽·위·오른쪽·아래 위치</p>
      {slots.map((slot) => (
        <div key={slot} className="rect-row">
          <span className="rect-label">{SLOT_LABEL[slot]}</span>
          {(['x0', 'y0', 'x1', 'y1'] as const).map((k) => (
            <NumberCell key={k} value={Math.round(L[slot]![k] * 1000) / 10} onChange={(v) => setRect(slot, k, v)} label={`${SLOT_LABEL[slot]} ${k}`} />
          ))}
        </div>
      ))}
      {pair && (
        <Slider
          label={`${pair} 나누기`}
          hint="겹자음을 좌우로 나누는 비율(왼쪽 몫)"
          value={project.pairRatio[pair] ?? 0.5}
          min={0.3}
          max={0.7}
          step={0.01}
          onChange={(v) => live((p) => ({ ...p, pairRatio: { ...p.pairRatio, [pair]: v } }))}
        />
      )}
      <div className="btn-row">
        {own ? (
          <button className="btn small danger ghost" onClick={() => commit((p) => {
            const layouts = { ...p.layouts };
            delete layouts[ownKey];
            return { ...p, layouts };
          })}>
            ‘{sample}’ 전용 틀 지우기
          </button>
        ) : (
          <>
            <button className="btn small ghost" onClick={() => commit((p) => ({ ...p, layouts: { ...p.layouts, [ownKey]: structuredClone(p.layouts[layout]) } }))}>
              ‘{sample}’만 따로 조정
            </button>
            <button className="btn small ghost" onClick={() => commit((p) => ({ ...p, layouts: { ...p.layouts, [layout]: structuredClone(DEFAULT_LAYOUTS[layout]) } }))}>
              기본값으로
            </button>
          </>
        )}
      </div>
      <div className="layout-mode">
        <span className="muted small">모든 배치 틀 한꺼번에</span>
        <div className="btn-row">
          <button className="btn small" onClick={() => commit((p) => ({ ...p, layouts: { ...keepSyllableLayouts(p.layouts), ...structuredClone(DEFAULT_LAYOUTS) } }))}>
            네모꼴
          </button>
          <button className="btn small" onClick={() => commit((p) => ({ ...p, layouts: { ...keepSyllableLayouts(p.layouts), ...talnemoLayouts() } }))}>
            탈네모꼴
          </button>
        </div>
      </div>
    </Group>
  );
}

/** 글자 전용 틀('!각' 등)만 남긴다 */
function keepSyllableLayouts(layouts: Project['layouts']): Project['layouts'] {
  return Object.fromEntries(Object.entries(layouts).filter(([k]) => k.startsWith('!')));
}

function NumberCell({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const beginGesture = useStore((s) => s.beginGesture);
  return (
    <input
      className="num-cell"
      type="number"
      step={0.5}
      min={-20}
      max={120}
      value={value}
      aria-label={label}
      onFocus={beginGesture}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isNaN(v)) onChange(v);
      }}
    />
  );
}

// ───────────────────────── 글자 칸 · 라틴 ─────────────────────────

function MetricsSection() {
  const params = useStore((s) => s.project.params);
  const setParam = useParam();
  return (
    <Group title="글자 칸 · 라틴 비율" open={false}>
      <h4>한글</h4>
      <Slider label="글자 폭" value={params.hangulAdvance} min={600} max={1400} step={5} onChange={(v) => setParam('hangulAdvance', v)} />
      <Slider label="옆 여백" value={params.hangulSide} min={-40} max={200} onChange={(v) => setParam('hangulSide', v)} />
      <Slider label="칸 위" value={params.hangulTop} min={500} max={1000} step={5} onChange={(v) => setParam('hangulTop', v)} />
      <Slider label="칸 아래" value={params.hangulBottom} min={-300} max={200} step={5} onChange={(v) => setParam('hangulBottom', v)} />
      <h4>라틴 · 숫자</h4>
      <Slider label="대문자 높이" value={params.capHeight} min={400} max={900} step={5} onChange={(v) => setParam('capHeight', v)} />
      <Slider label="소문자 높이" value={params.xHeight} min={300} max={700} step={5} onChange={(v) => setParam('xHeight', v)} />
      <Slider label="어센더" value={params.ascender} min={500} max={950} step={5} onChange={(v) => setParam('ascender', v)} />
      <Slider label="디센더" value={params.descender} min={-400} max={-50} step={5} onChange={(v) => setParam('descender', v)} />
      <Slider label="옆 여백" value={params.latinSide} min={0} max={200} onChange={(v) => setParam('latinSide', v)} />
      <Slider label="폭 배율" value={params.latinWidthScale} min={0.5} max={1.6} step={0.01} onChange={(v) => setParam('latinWidthScale', v)} />
      <Slider label="띄어쓰기 폭" value={params.spaceWidth} min={100} max={800} step={5} onChange={(v) => setParam('spaceWidth', v)} />
    </Group>
  );
}

// ───────────────────────── 참조 이미지 ─────────────────────────

function ReferenceSection() {
  const ref = useStore((s) => s.project.reference);
  const live = useStore((s) => s.live);
  const commit = useStore((s) => s.commit);
  const set = useStore((s) => s.set);
  const fileRef = useRef<HTMLInputElement>(null);
  const r = ref ?? createDefaultProject().reference!;

  const update = (patch: Partial<typeof r>) => live((p) => ({ ...p, reference: { ...r, ...(p.reference ?? {}), ...patch } }));

  return (
    <Group title="참조 이미지" open={false}>
      <p className="muted small">따라 그릴 글자 이미지를 뒤에 깔아 둡니다. <b>참조 이미지 도구(R)</b>로 끌어 옮기고 휠로 크기를 맞추세요.</p>
      <div className="btn-row">
        <button className="btn small" onClick={() => fileRef.current?.click()}>이미지 불러오기</button>
        <button className="btn small ghost" onClick={() => commit((p) => ({ ...p, reference: { ...createDefaultProject().reference!, visible: true } }))}>
          샘플 이미지
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => {
              commit((p) => ({ ...p, reference: { ...r, src: String(reader.result), visible: true } }));
              set({ tool: 'reference' });
            };
            reader.readAsDataURL(f);
            e.target.value = '';
          }}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={r.visible} onChange={(e) => commit((p) => ({ ...p, reference: { ...r, visible: e.target.checked } }))} />
        보이기
      </label>
      <Slider label="불투명도" value={r.opacity} min={0.05} max={1} step={0.05} onChange={(v) => update({ opacity: v })} />
      <Slider label="크기" value={Math.log2(r.scale)} min={-3} max={6} step={0.01} onChange={(v) => update({ scale: 2 ** v })} />
    </Group>
  );
}

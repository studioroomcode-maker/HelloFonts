import { useDeferredValue, useMemo } from 'react';
import { useStore, type Tool } from '../store';
import { EditorCanvas } from './EditorCanvas';
import { GlyphPicker } from './GlyphPicker';
import { Inspector } from './Inspector';
import { findTarget, setGlyph, usageSamples } from '../core/edit';
import { GlyphIcon } from './glyphs';
import { ksx1001Syllables } from '../core/hangul';
import type { Role } from '../core/types';

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'select', label: '선택', key: 'V', hint: '점을 끌어 옮기기 · 획을 두 번 눌러 점 추가 · Delete로 삭제 · C로 곡선 전환' },
  { id: 'pen', label: '펜', key: 'P', hint: '눌러서 점 찍기 · 두 번 누르거나 Enter로 끝내기 · 첫 점을 누르면 닫기 · Esc 취소' },
  { id: 'ellipse', label: '타원', key: 'O', hint: '중심에서 끌어 타원 획 만들기' },
  { id: 'reference', label: '참조 이미지', key: 'R', hint: '끌어서 참조 이미지 옮기기 · 휠로 크기 조절' },
];

const ROLE_LABEL: Record<Role, string> = { cho: '초성', jung: '중성', jong: '종성' };

export function Editor() {
  return (
    <div className="editor">
      <aside className="panel left">
        <GlyphPicker />
      </aside>
      <section className="stage">
        <Toolbar />
        <EditorCanvas />
        <UsageStrip />
      </section>
      <aside className="panel right">
        <Inspector />
      </aside>
    </div>
  );
}

function Toolbar() {
  const tool = useStore((s) => s.tool);
  const snap = useStore((s) => s.snap);
  const set = useStore((s) => s.set);
  const project = useStore((s) => s.project);
  const sample = useStore((s) => s.sample);
  const role = useStore((s) => s.role);
  const part = useStore((s) => s.part);
  const target = useMemo(() => findTarget(project, sample, role, part), [project, sample, role, part]);
  const hint = TOOLS.find((t) => t.id === tool)?.hint;
  const comp = target?.comp;

  return (
    <div className="toolbar">
      <div className="seg-group" role="radiogroup" aria-label="도구">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={tool === t.id}
            className={tool === t.id ? 'seg active' : 'seg'}
            onClick={() => set({ tool: t.id })}
            title={`${t.label} (${t.key})`}
          >
            {t.label}
            <kbd>{t.key}</kbd>
          </button>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={snap} onChange={(e) => set({ snap: e.target.checked })} />
        격자 맞춤 <kbd>G</kbd>
      </label>
      {comp?.kind === 'hangul' && (
        <div className="seg-group parts" aria-label="편집할 자모">
          {comp.placements.map((pl, i) => {
            const active = target?.placement === pl;
            return (
              <button
                key={i}
                className={active ? 'seg active' : 'seg'}
                onClick={() => set({ role: pl.role, part: pl.part, selNode: null, selStroke: null })}
                title={`${ROLE_LABEL[pl.role]} ${pl.owner}${pl.part !== null ? ` (${pl.part + 1}번째)` : ''}`}
              >
                <span className="jamo">{pl.jamo}</span>
                <small>{ROLE_LABEL[pl.role]}</small>
              </button>
            );
          })}
        </div>
      )}
      <div className="toolbar-hint">{hint}</div>
    </div>
  );
}

function UsageStrip() {
  const project = useDeferredValue(useStore((s) => s.project));
  const sample = useStore((s) => s.sample);
  const role = useStore((s) => s.role);
  const part = useStore((s) => s.part);
  const set = useStore((s) => s.set);
  const commit = useStore((s) => s.commit);
  const target = useMemo(() => findTarget(project, sample, role, part), [project, sample, role, part]);
  const key = target?.placement?.key ?? null;
  const pool = useMemo(() => ksx1001Syllables(), []);
  const usage = useMemo(
    () => (key && target?.comp.kind === 'hangul' ? usageSamples(project, key, pool, 28) : null),
    [project, key, pool, target?.comp.kind],
  );

  if (!target) {
    return (
      <div className="usage empty">
        <span>“{sample}”은(는) 아직 정의되지 않은 글자입니다.</span>
        <button
          className="btn small"
          onClick={() => commit((p) => setGlyph(p, sample, { kind: 'latin', width: 400, strokes: [] }))}
        >
          새 글자로 만들기
        </button>
      </div>
    );
  }
  if (!usage) return <div className="usage" />;
  return (
    <div className="usage">
      <div className="usage-label">
        이 모양을 쓰는 글자 <b>{usage.total.toLocaleString()}</b>자 <small>(완성형 2,350자 중)</small>
      </div>
      <div className="usage-list">
        {usage.list.map((ch) => (
          <button key={ch} className={ch === sample ? 'usage-item active' : 'usage-item'} onClick={() => set({ sample: ch })} title={ch}>
            <GlyphIcon project={project} ch={ch} size={34} />
          </button>
        ))}
      </div>
    </div>
  );
}

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { allSyllables, COMPAT_JAMO, ksx1001Syllables } from '../core/hangul';
import { latinChars } from '../core/compose';
import { GlyphIcon } from './glyphs';

type CharGroup = 'ks' | 'all' | 'jamo' | 'latin';

const SETS: { id: CharGroup; label: string }[] = [
  { id: 'ks', label: '완성형 2,350자' },
  { id: 'all', label: '현대 한글 11,172자' },
  { id: 'jamo', label: '낱자' },
  { id: 'latin', label: '라틴 · 숫자 · 기호' },
];

const CELL = 76;

export function GlyphTable() {
  const project = useDeferredValue(useStore((s) => s.project));
  const set = useStore((s) => s.set);
  const [which, setWhich] = useState<CharGroup>('ks');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 800, width: 1000 });

  const chars = useMemo(() => {
    if (which === 'ks') return ksx1001Syllables();
    if (which === 'all') return allSyllables();
    if (which === 'jamo') return COMPAT_JAMO;
    return latinChars(project);
  }, [which, project]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewport({ top: el.scrollTop, height: el.clientHeight, width: el.clientWidth });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [which]);

  const cols = Math.max(1, Math.floor(viewport.width / CELL));
  const rows = Math.ceil(chars.length / cols);
  const first = Math.max(0, Math.floor(viewport.top / CELL) - 2);
  const last = Math.min(rows, Math.ceil((viewport.top + viewport.height) / CELL) + 2);
  const visible: { ch: string; i: number }[] = [];
  for (let r = first; r < last; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i < chars.length) visible.push({ ch: chars[i], i });
    }
  }

  return (
    <div className="table-view">
      <div className="table-head">
        <div className="seg-group" role="radiogroup" aria-label="글자 모음">
          {SETS.map((s) => (
            <button key={s.id} role="radio" aria-checked={which === s.id} className={which === s.id ? 'seg active' : 'seg'} onClick={() => setWhich(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <span className="muted small">{chars.length.toLocaleString()}자 · 글자를 누르면 편집 화면으로 갑니다</span>
      </div>
      <div ref={scrollRef} className="table-scroll">
        <div style={{ height: rows * CELL, position: 'relative' }}>
          {visible.map(({ ch, i }) => (
            <button
              key={i}
              className="table-cell"
              style={{ left: (i % cols) * CELL, top: Math.floor(i / cols) * CELL, width: CELL, height: CELL }}
              onClick={() => set({ sample: ch, tab: 'edit', selNode: null, selStroke: null })}
              title={`${ch} U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`}
            >
              <GlyphIcon project={project} ch={ch} size={48} />
              <span>{ch}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

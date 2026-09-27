import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import type { Project } from '../core/types';
import { GlyphLine, glyphPath } from './glyphs';

type Theme = 'plain' | 'game' | 'dark';

const THEMES: Record<Theme, { label: string; bg: string; fg: string; outline: string | null }> = {
  plain: { label: '기본', bg: 'var(--paper)', fg: 'var(--ink)', outline: null },
  game: { label: '게임 UI', bg: '#ee6f95', fg: '#fff8ee', outline: '#b93a64' },
  dark: { label: '어둡게', bg: '#1f1b2b', fg: '#f4efe6', outline: null },
};

/** 폭에 맞춰 줄바꿈(가능하면 띄어쓰기에서) */
function wrap(project: Project, text: string, maxEm: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    let width = 0;
    for (const word of para.split(/(?<= )/)) {
      const w = [...word].reduce((a, ch) => a + (glyphPath(project, ch)?.advance ?? 600), 0);
      if (line && width + w > maxEm) {
        out.push(line.trimEnd());
        line = '';
        width = 0;
      }
      line += word;
      width += w;
    }
    out.push(line);
  }
  return out;
}

export function Preview() {
  const project = useDeferredValue(useStore((s) => s.project));
  const text = useStore((s) => s.previewText);
  const set = useStore((s) => s.set);
  const [size, setSize] = useState(56);
  const [tracking, setTracking] = useState(0);
  const [theme, setTheme] = useState<Theme>('plain');
  const [outlineW, setOutlineW] = useState(60);
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const t = THEMES[theme];
  const lines = wrap(project, text, ((width - 64) / size) * 1000);

  return (
    <div className="preview">
      <div className="preview-controls">
        <textarea value={text} onChange={(e) => set({ previewText: e.target.value })} rows={4} aria-label="미리보기 문장" />
        <div className="preview-options">
          <label className="slider">
            <span className="slider-label">크기</span>
            <input type="range" min={12} max={200} value={size} onChange={(e) => setSize(+e.target.value)} />
            <span className="slider-num">{size}px</span>
          </label>
          <label className="slider">
            <span className="slider-label">자간</span>
            <input type="range" min={-150} max={300} value={tracking} onChange={(e) => setTracking(+e.target.value)} />
            <span className="slider-num">{tracking}</span>
          </label>
          <div className="seg-group" role="radiogroup" aria-label="배경">
            {(Object.keys(THEMES) as Theme[]).map((k) => (
              <button key={k} role="radio" aria-checked={theme === k} className={theme === k ? 'seg active' : 'seg'} onClick={() => setTheme(k)}>
                {THEMES[k].label}
              </button>
            ))}
          </div>
          {theme === 'game' && (
            <label className="slider">
              <span className="slider-label">테두리</span>
              <input type="range" min={0} max={160} value={outlineW} onChange={(e) => setOutlineW(+e.target.value)} />
              <span className="slider-num">{outlineW}</span>
            </label>
          )}
        </div>
      </div>
      <div ref={boxRef} className="preview-sheet" style={{ background: t.bg, color: t.fg }}>
        {lines.map((line, i) => (
          <div key={i} className="preview-line">
            <GlyphLine
              project={project}
              text={line || ' '}
              size={size}
              tracking={tracking}
              fill={t.fg}
              outline={t.outline && outlineW > 0 ? { color: t.outline, width: outlineW } : null}
            />
          </div>
        ))}
      </div>
      <div className="waterfall">
        {[12, 16, 24, 36].map((s) => (
          <div key={s} className="waterfall-row">
            <span className="muted small">{s}px</span>
            <GlyphLine project={project} text={text.split('\n')[0] || '가나다라'} size={s} />
          </div>
        ))}
      </div>
    </div>
  );
}

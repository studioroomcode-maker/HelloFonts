import { useEffect, useMemo, useRef, useState } from 'react';
import { capture } from '../pointer';
import type { Project, Pt } from '../../core/types';
import { composeChar } from '../../core/compose';
import { cellFrame, emToFrame, frameToEm, type TemplateCell, type TemplatePage } from '../../core/handwriting/template';
import type { CellInk, InkLine } from '../../core/handwriting/fit';
import { InkThumb } from './InkThumb';

/** 화면에 한 칸씩 직접 쓰기 */
export function DrawStep({
  page, project, inks, onChange,
}: {
  page: TemplatePage;
  project: Project;
  inks: (CellInk | undefined)[];
  onChange: (index: number, ink: CellInk) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const done = inks.filter((x) => x && x.lines.length).length;
  return (
    <div className="draw-step">
      <p className="small">
        칸을 눌러 글자를 쓰세요. <b>{done}</b> / {page.cells.length}칸 완료 — 다 쓰지 않아도 되고, 안 쓴 자모는 기본 모양을 씁니다.
      </p>
      <div className="cell-grid">
        {page.cells.map((cell, i) => (
          <button key={i} className={inks[i]?.lines.length ? 'cell-btn done' : 'cell-btn'} onClick={() => setOpen(i)} title={cell.text}>
            <span className="cell-label">{cell.text}</span>
            {inks[i]?.lines.length ? <InkThumb cell={cell} project={project} ink={inks[i]!} /> : null}
          </button>
        ))}
      </div>
      {open !== null && (
        <DrawPad
          key={open}
          cell={page.cells[open]}
          project={project}
          initial={inks[open]}
          onSave={(ink) => onChange(open, ink)}
          onNext={() => setOpen((o) => (o !== null && o + 1 < page.cells.length ? o + 1 : null))}
          onPrev={() => setOpen((o) => (o !== null && o > 0 ? o - 1 : o))}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function DrawPad({
  cell, project, initial, onSave, onNext, onPrev, onClose,
}: {
  cell: TemplateCell;
  project: Project;
  initial?: CellInk;
  onSave: (ink: CellInk) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const frame = cellFrame(cell, project.params);
  const [lines, setLinesState] = useState<InkLine[]>(initial?.lines ?? []);
  // 빠르게 이어 그려도 획이 사라지지 않도록 최신 목록을 ref로 들고 있는다
  const linesRef = useRef<InkLine[]>(lines);
  const setLines = (next: InkLine[]) => {
    linesRef.current = next;
    setLinesState(next);
  };
  const [pen, setPen] = useState(34);
  const current = useRef<InkLine | null>(null);
  const [, force] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const SIZE = 1000;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        const n = linesRef.current.slice(0, -1);
        setLines(n);
        onSave({ text: cell.text, lines: n });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onSave, cell.text]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (ls: InkLine[]) => onSave({ text: cell.text, lines: ls });

  const toEm = (e: React.PointerEvent): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const r = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return frameToEm(frame, r.x / SIZE, r.y / SIZE);
  };
  const hwFor = (e: React.PointerEvent) => {
    const pressure = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5;
    return pen * (0.55 + pressure * 0.9);
  };
  const toView = (p: Pt) => {
    const r = emToFrame(frame, p.x, p.y);
    return { x: r.u * SIZE, y: r.v * SIZE };
  };

  const guides = useMemo(() => {
    const out: React.ReactNode[] = [];
    const p = project.params;
    if (cell.take === 'latin') {
      [0, p.xHeight, p.capHeight, p.descender].forEach((y, i) => {
        const v = toView({ x: 0, y });
        out.push(<line key={i} x1={0} x2={SIZE} y1={v.y} y2={v.y} className={i === 0 ? 'pad-guide strong' : 'pad-guide'} />);
      });
    } else {
      const comp = composeChar(project, cell.text);
      const role = cell.take === 'jung' ? 'jung' : cell.take === 'jong' ? 'jong' : 'cho';
      comp?.placements.forEach((pl, i) => {
        const a = toView({ x: pl.slot.x0, y: pl.slot.yTop }), b = toView({ x: pl.slot.x1, y: pl.slot.yBottom });
        out.push(<rect key={i} x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} className={pl.role === role ? 'pad-slot target' : 'pad-slot'} />);
      });
    }
    return out;
  }, [cell, project]); // eslint-disable-line react-hooks/exhaustive-deps

  const pathOf = (l: InkLine) => l.pts.map((p, i) => { const v = toView(p); return `${i ? 'L' : 'M'}${v.x} ${v.y}`; }).join('');
  const avgHW = (l: InkLine) => l.hw.reduce((a, b) => a + b, 0) / Math.max(1, l.hw.length);
  const emToView = SIZE / frame.size;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal pad-modal" role="dialog" aria-modal="true" aria-label={`${cell.text} 쓰기`}>
        <div className="pad-head">
          <h2>“{cell.text}” 쓰기</h2>
          <span className="muted small">진한 분홍 자리의 자모를 받아 갑니다. 나머지도 함께 써 주세요.</span>
        </div>
        <svg
          ref={svgRef}
          className="pad"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          onPointerDown={(e) => {
            capture(e.currentTarget as Element, e.pointerId);
            current.current = { pts: [toEm(e)], hw: [hwFor(e)] };
            force((n) => n + 1);
          }}
          onPointerMove={(e) => {
            const c = current.current;
            if (!c) return;
            const q = toEm(e);
            const last = c.pts[c.pts.length - 1];
            if (Math.hypot(q.x - last.x, q.y - last.y) < 6) return;
            c.pts.push(q);
            c.hw.push(hwFor(e));
            force((n) => n + 1);
          }}
          onPointerUp={() => {
            const c = current.current;
            current.current = null;
            if (!c) return;
            const next = [...linesRef.current, c];
            setLines(next);
            save(next);
          }}
        >
          <rect width={SIZE} height={SIZE} className="pad-bg" />
          {guides}
          {[...lines, ...(current.current ? [current.current] : [])].map((l, i) => (
            l.pts.length === 1
              ? <circle key={i} cx={toView(l.pts[0]).x} cy={toView(l.pts[0]).y} r={avgHW(l) * emToView} className="pad-dot" />
              : <path key={i} d={pathOf(l)} className="pad-ink" strokeWidth={avgHW(l) * 2 * emToView} />
          ))}
        </svg>
        <div className="pad-tools">
          <label className="slider">
            <span className="slider-label">펜 굵기</span>
            <input type="range" min={12} max={80} value={pen} onChange={(e) => setPen(+e.target.value)} />
          </label>
          <div className="btn-row">
            <button className="btn small" onClick={() => { const n = linesRef.current.slice(0, -1); setLines(n); save(n); }} disabled={!lines.length}>한 획 지우기</button>
            <button className="btn small" onClick={() => { setLines([]); save([]); }} disabled={!lines.length}>모두 지우기</button>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={onPrev}>← 이전</button>
            <button className="btn primary" onClick={onNext}>다음 →</button>
            <button className="btn" onClick={onClose}>닫기</button>
          </div>
        </div>
      </div>
    </div>
  );
}

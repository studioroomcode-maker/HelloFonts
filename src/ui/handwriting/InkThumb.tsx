import { memo } from 'react';
import type { Project } from '../../core/types';
import { cellFrame, emToFrame, type TemplateCell } from '../../core/handwriting/template';
import type { CellInk } from '../../core/handwriting/fit';

/** 칸에서 읽은(또는 쓴) 획을 작게 보여 준다 */
export const InkThumb = memo(function InkThumb({ cell, project, ink }: { cell: TemplateCell; project: Project; ink: CellInk }) {
  const frame = cellFrame(cell, project.params);
  const S = 100;
  const v = (x: number, y: number) => {
    const r = emToFrame(frame, x, y);
    return `${(r.u * S).toFixed(1)} ${(r.v * S).toFixed(1)}`;
  };
  const w = Math.max(1.5, ((ink.lines[0]?.hw[0] ?? 30) * 2 * S) / frame.size);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="ink-thumb" aria-hidden="true">
      {ink.lines.map((l, i) =>
        l.pts.length === 1 ? (
          <circle key={i} cx={v(l.pts[0].x, l.pts[0].y).split(' ')[0]} cy={v(l.pts[0].x, l.pts[0].y).split(' ')[1]} r={w / 2} />
        ) : (
          <path key={i} d={`M${l.pts.map((p) => v(p.x, p.y)).join('L')}${l.closed ? 'Z' : ''}`} strokeWidth={w} />
        ),
      )}
    </svg>
  );
});

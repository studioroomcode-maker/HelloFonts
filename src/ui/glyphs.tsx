import { memo } from 'react';
import type { Project } from '../core/types';
import { glyphOutline } from '../core/compose';
import { contoursToSvgPath } from '../core/outline';

const pathCache = new WeakMap<Project, Map<string, { d: string; advance: number } | null>>();

export function glyphPath(project: Project, ch: string): { d: string; advance: number } | null {
  let m = pathCache.get(project);
  if (!m) {
    m = new Map();
    pathCache.set(project, m);
  }
  if (m.has(ch)) return m.get(ch)!;
  const o = glyphOutline(project, ch);
  const r = o ? { d: contoursToSvgPath(o.contours, 0), advance: o.advance } : null;
  m.set(ch, r);
  return r;
}

/** 표시용 세로 범위(폰트 단위) */
export const VIEW_TOP = 920;
export const VIEW_BOTTOM = -180;

interface IconProps {
  project: Project;
  ch: string;
  size?: number;
  className?: string;
}

/** 글자 하나를 정사각형 칸에 그린다 */
export const GlyphIcon = memo(function GlyphIcon({ project, ch, size = 40, className }: IconProps) {
  const g = glyphPath(project, ch);
  const h = VIEW_TOP - VIEW_BOTTOM;
  const adv = g?.advance ?? 600;
  const x0 = adv / 2 - h / 2;
  return (
    <svg className={className} width={size} height={size} viewBox={`${x0} ${-VIEW_TOP} ${h} ${h}`} aria-hidden="true">
      {g ? (
        <path d={g.d} transform="scale(1,-1)" fill="currentColor" />
      ) : (
        <rect x={80} y={-700} width={440} height={700} fill="none" stroke="currentColor" strokeWidth={30} opacity={0.3} />
      )}
    </svg>
  );
});

interface LineProps {
  project: Project;
  text: string;
  size: number;
  fill?: string;
  outline?: { color: string; width: number } | null;
  tracking?: number;
}

/** 한 줄의 글자를 폰트처럼 이어서 그린다(size = 1em의 픽셀 크기) */
export function GlyphLine({ project, text, size, fill = 'currentColor', outline, tracking = 0 }: LineProps) {
  const items: { ch: string; x: number; d: string | null; adv: number }[] = [];
  let x = 0;
  for (const ch of text) {
    const g = glyphPath(project, ch);
    const adv = g?.advance ?? 600;
    items.push({ ch, x, d: g?.d ?? null, adv });
    x += adv + tracking;
  }
  const pad = outline ? outline.width * 1.2 : 0;
  const top = VIEW_TOP + pad, bottom = VIEW_BOTTOM - pad;
  const width = Math.max(1, x + pad * 2);
  const h = top - bottom;
  return (
    <svg
      className="glyph-line"
      width={(width / 1000) * size}
      height={(h / 1000) * size}
      viewBox={`${-pad} ${-top} ${width} ${h}`}
      role="img"
      aria-label={text}
    >
      {items.map((it, i) =>
        it.d ? (
          <path
            key={i}
            d={it.d}
            transform={`translate(${it.x},0) scale(1,-1)`}
            fill={fill}
            stroke={outline?.color}
            strokeWidth={outline ? outline.width * 2 : undefined}
            strokeLinejoin="round"
            paintOrder="stroke"
          />
        ) : it.ch === ' ' ? null : (
          <rect key={i} x={it.x + 80} y={-700} width={it.adv - 160} height={700} fill="none" stroke={fill} strokeWidth={20} opacity={0.35} />
        ),
      )}
    </svg>
  );
}

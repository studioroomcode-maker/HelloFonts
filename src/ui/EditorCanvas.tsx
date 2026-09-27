import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { capture } from './pointer';
import type { PathStroke, Project, Pt, Stroke } from '../core/types';
import { useStore } from '../store';
import {
  deleteNode, findTarget, insertNode, moveNode, nearestOnStroke, nodePos, setGlyph, toggleCurve, updateStrokes,
  type NodeRef,
} from '../core/edit';
import { compositionContours, placementContours, type EmBox, type Placement } from '../core/compose';
import { contoursToSvgPath } from '../core/outline';
import { jamoKey } from '../core/project';

interface View {
  zoom: number;
  panX: number;
  panY: number;
}

type Drag =
  | { kind: 'node'; ref: NodeRef; key: string; fromEm: (p: Pt) => Pt; began: boolean }
  | { kind: 'pan'; x: number; y: number; view: View }
  | { kind: 'ellipse'; key: string; fromEm: (p: Pt) => Pt; center: Pt; cur: Pt }
  | { kind: 'ref'; start: Pt; x0: number; y0: number };

function useImageSize(src: string | undefined) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    const img = new Image();
    img.onload = () => alive && setSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src]);
  return size;
}

function strokesPathD(strokes: Stroke[]): string {
  let d = '';
  for (const s of strokes) {
    if (s.kind === 'ellipse') {
      const { c, rx, ry } = s;
      d += `M${c.x + rx} ${c.y}A${rx} ${ry} 0 1 0 ${c.x - rx} ${c.y}A${rx} ${ry} 0 1 0 ${c.x + rx} ${c.y}`;
      continue;
    }
    d += `M${s.start.x} ${s.start.y}`;
    for (const g of s.segs) d += g.t === 'L' ? `L${g.p.x} ${g.p.y}` : `C${g.c1.x} ${g.c1.y} ${g.c2.x} ${g.c2.y} ${g.p.x} ${g.p.y}`;
    if (s.closed) d += 'Z';
  }
  return d;
}

const rectOf = (b: EmBox) => ({ x: b.x0, y: b.yBottom, width: Math.max(0, b.x1 - b.x0), height: Math.max(0, b.yTop - b.yBottom) });

const sameRef = (a: NodeRef | null, b: NodeRef) => !!a && JSON.stringify(a) === JSON.stringify(b);

export function EditorCanvas() {
  const project = useStore((s) => s.project);
  const sample = useStore((s) => s.sample);
  const role = useStore((s) => s.role);
  const part = useStore((s) => s.part);
  const tool = useStore((s) => s.tool);
  const snap = useStore((s) => s.snap);
  const selNode = useStore((s) => s.selNode);
  const selStroke = useStore((s) => s.selStroke);
  const set = useStore((s) => s.set);
  const commit = useStore((s) => s.commit);
  const live = useStore((s) => s.live);
  const beginGesture = useStore((s) => s.beginGesture);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [size, setSize] = useState({ w: 800, h: 800 });
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const [pen, setPen] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [ellipseDraft, setEllipseDraft] = useState<{ c: Pt; rx: number; ry: number } | null>(null);
  const spaceDown = useRef(false);

  const target = useMemo(() => findTarget(project, sample, role, part), [project, sample, role, part]);
  const comp = target?.comp ?? null;
  const pl = target?.placement ?? null;
  const p = project.params;
  const isLatin = comp?.kind === 'latin';

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 글자를 바꾸면 펜 초안과 선택을 비운다
  useEffect(() => {
    setPen([]);
    setEllipseDraft(null);
  }, [sample, role, part]);

  // ── 화면 범위 ──
  const base = useMemo(() => {
    const adv = comp?.advance ?? p.hangulAdvance;
    if (isLatin) {
      const top = p.ascender + 120, bottom = p.descender - 120;
      const w = Math.max(adv, 700) + 200;
      return { cx: adv / 2, cy: (top + bottom) / 2, span: Math.max(w, top - bottom) };
    }
    const top = p.hangulTop + 140, bottom = p.hangulBottom - 140;
    return { cx: adv / 2, cy: (top + bottom) / 2, span: Math.max(adv + 240, top - bottom) };
  }, [comp?.advance, isLatin, p.ascender, p.descender, p.hangulAdvance, p.hangulTop, p.hangulBottom]);

  const aspect = size.w / Math.max(1, size.h);
  const vh = base.span / view.zoom;
  const vw = vh * Math.max(1, aspect);
  const vhh = vh * Math.max(1, 1 / aspect);
  const cx = base.cx + view.panX, cy = base.cy + view.panY;
  const viewBox = `${cx - vw / 2} ${-cy - vhh / 2} ${vw} ${vhh}`;
  const upp = vw / Math.max(1, size.w); // 화면 1px당 폰트 단위

  // ── 좌표 변환 ──
  const clientToEm = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!, g = gRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const r = pt.matrixTransform(g.getScreenCTM()!.inverse());
    return { x: r.x, y: r.y };
  }, []);

  const snapPt = useCallback(
    (q: Pt): Pt => {
      if (!snap) return { x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 };
      const step = isLatin ? 10 : 2.5;
      return { x: Math.round(q.x / step) * step, y: Math.round(q.y / step) * step };
    },
    [snap, isLatin],
  );

  /** 편집 대상 키를 보장(정의가 없으면 새로 만든다)하고 돌려준다 */
  const ensureKey = useCallback((): string | null => {
    if (!pl) return null;
    if (pl.key) return pl.key;
    const key = jamoKey(pl.jamo, pl.role, pl.ctx, 'base')!;
    commit((proj) => setGlyph(proj, key, { kind: 'jamo', strokes: [] }));
    return key;
  }, [pl, commit]);

  const addStroke = useCallback(
    (s: Stroke) => {
      const key = ensureKey();
      if (!key) return;
      let index = 0;
      commit((proj: Project) => {
        const def = proj.glyphs[key];
        index = def ? def.strokes.length : 0;
        return updateStrokes(proj, key, (ss) => [...ss, s]);
      });
      set({ selStroke: index, selNode: null });
    },
    [ensureKey, commit, set],
  );

  const finishPen = useCallback(
    (close = false) => {
      if (pen.length === 0) return;
      const [start, ...rest] = pen;
      const stroke: PathStroke = { kind: 'path', start, segs: rest.map((q) => ({ t: 'L', p: q })) };
      if (close && rest.length >= 2) stroke.closed = true;
      addStroke(stroke);
      setPen([]);
    },
    [pen, addStroke],
  );

  // ── 키보드 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === ' ') spaceDown.current = e.type === 'keydown';
      if (e.type !== 'keydown') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'v') set({ tool: 'select' });
      else if (k === 'p') set({ tool: 'pen' });
      else if (k === 'o') set({ tool: 'ellipse' });
      else if (k === 'r') set({ tool: 'reference' });
      else if (k === 'g') set({ snap: !snap });
      else if (k === 'enter') finishPen(false);
      else if (k === 'escape') {
        setPen([]);
        set({ selNode: null, selStroke: null });
      } else if ((k === 'delete' || k === 'backspace') && pl?.key) {
        e.preventDefault();
        const key = pl.key;
        if (selNode) {
          commit((proj) => updateStrokes(proj, key, (ss) => deleteNode(ss, selNode)));
          set({ selNode: null });
        } else if (selStroke !== null) {
          commit((proj) => updateStrokes(proj, key, (ss) => ss.filter((_, i) => i !== selStroke)));
          set({ selStroke: null });
        }
      } else if (k === 'c' && pl?.key && selNode && selNode.at === 'seg') {
        const key = pl.key;
        commit((proj) => updateStrokes(proj, key, (ss) => toggleCurve(ss, selNode.stroke, selNode.seg)));
      } else if (k === '0') setView({ zoom: 1, panX: 0, panY: 0 });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [set, snap, finishPen, pl, selNode, selStroke, commit]);

  // ── 포인터 ──
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, view };
      capture(e.currentTarget as Element, e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const em = clientToEm(e);
    if (tool === 'reference' && project.reference) {
      drag.current = { kind: 'ref', start: em, x0: project.reference.x, y0: project.reference.y };
      beginGesture();
      capture(e.currentTarget as Element, e.pointerId);
      return;
    }
    if (!pl) return;
    if (tool === 'pen') {
      const q = snapPt(pl.fromEm(em));
      if (pen.length >= 3) {
        const first = pl.toEm(pen[0]);
        if (Math.hypot(first.x - em.x, first.y - em.y) < 10 * upp) {
          finishPen(true);
          return;
        }
      }
      setPen((ps) => [...ps, q]);
      return;
    }
    if (tool === 'ellipse') {
      const key = ensureKey();
      if (!key) return;
      const c = snapPt(pl.fromEm(em));
      drag.current = { kind: 'ellipse', key, fromEm: pl.fromEm, center: c, cur: c };
      setEllipseDraft({ c, rx: 0, ry: 0 });
      capture(e.currentTarget as Element, e.pointerId);
      return;
    }
    // 선택 도구: 빈 곳을 누르면 선택 해제
    set({ selNode: null, selStroke: null });
  };

  const onNodeDown = (e: React.PointerEvent, ref: NodeRef) => {
    if (tool !== 'select' || e.button !== 0 || spaceDown.current || !pl) return;
    e.stopPropagation();
    const key = ensureKey();
    if (!key) return;
    set({ selNode: ref, selStroke: ref.stroke });
    drag.current = { kind: 'node', ref, key, fromEm: pl.fromEm, began: false };
    if (svgRef.current) capture(svgRef.current, e.pointerId);
  };

  const onStrokeDown = (e: React.PointerEvent, i: number) => {
    if (tool !== 'select' || e.button !== 0 || spaceDown.current) return;
    e.stopPropagation();
    set({ selStroke: i, selNode: null });
  };

  const onStrokeDouble = (e: React.MouseEvent, i: number) => {
    if (!pl?.key) return;
    const s = pl.skeleton[i];
    if (!s || s.kind !== 'path') return;
    e.stopPropagation();
    const q = pl.fromEm(clientToEm(e));
    const hit = nearestOnStroke(s, q);
    const key = pl.key;
    commit((proj) => updateStrokes(proj, key, (ss) => insertNode(ss, i, hit.seg, hit.t)));
    set({ selNode: { stroke: i, at: 'seg', seg: hit.seg, handle: 'p' }, selStroke: i });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const em = clientToEm(e);
    if (tool === 'pen' && pl) setHover(snapPt(pl.fromEm(em)));
    if (!d) return;
    if (d.kind === 'pan') {
      const scale = upp;
      setView({ ...d.view, panX: d.view.panX - (e.clientX - d.x) * scale, panY: d.view.panY + (e.clientY - d.y) * scale });
      return;
    }
    if (d.kind === 'ref') {
      const dx = em.x - d.start.x, dy = em.y - d.start.y;
      live((proj) => (proj.reference ? { ...proj, reference: { ...proj.reference, x: d.x0 + dx, y: d.y0 + dy } } : proj));
      return;
    }
    if (d.kind === 'ellipse') {
      const cur = snapPt(d.fromEm(em));
      d.cur = cur;
      setEllipseDraft({ c: d.center, rx: Math.abs(cur.x - d.center.x), ry: Math.abs(cur.y - d.center.y) });
      return;
    }
    if (d.kind === 'node') {
      if (!d.began) {
        beginGesture();
        d.began = true;
      }
      const q = snapPt(d.fromEm(em));
      live((proj) => updateStrokes(proj, d.key, (ss) => moveNode(ss, d.ref, q)));
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'ellipse') {
      let rx = Math.abs(d.cur.x - d.center.x), ry = Math.abs(d.cur.y - d.center.y);
      const dflt = isLatin ? 120 : 25;
      if (rx < 1 && ry < 1) rx = ry = dflt;
      rx = Math.max(rx, 1);
      ry = Math.max(ry, 1);
      setEllipseDraft(null);
      addStroke({ kind: 'ellipse', c: d.center, rx, ry, keep: isLatin ? 0 : 0.4 });
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (tool === 'reference' && project.reference) {
      const em = clientToEm(e);
      const k = e.deltaY < 0 ? 1.05 : 1 / 1.05;
      const r = project.reference;
      // 포인터 위치를 고정한 채로 확대/축소
      live((proj) => ({
        ...proj,
        reference: { ...r, scale: r.scale * k, x: em.x - (em.x - r.x) * k, y: em.y - (em.y - r.y) * k },
      }));
      return;
    }
    const em = clientToEm(e);
    const k = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setView((v) => {
      const zoom = Math.min(12, Math.max(0.4, v.zoom * k));
      const f = v.zoom / zoom;
      const ccx = base.cx + v.panX, ccy = base.cy + v.panY;
      return { zoom, panX: em.x - (em.x - ccx) * f - base.cx, panY: em.y - (em.y - ccy) * f - base.cy };
    });
  };

  // ── 그리기 ──
  const fullD = useMemo(() => (comp ? contoursToSvgPath(compositionContours(project, comp)) : ''), [project, comp]);
  const currentD = useMemo(() => (comp && pl ? contoursToSvgPath(placementContours(project, comp, pl)) : ''), [project, comp, pl]);

  const ref = project.reference;
  const refSize = useImageSize(ref?.src);
  const hr = 5.5 * upp; // 점 반지름
  const L = comp?.layout ? project.layouts[comp.layout] : null;

  const slotRects: EmBox[] = [];
  if (comp?.kind === 'hangul' && comp.cell && L) {
    const cell = comp.cell;
    const w = cell.x1 - cell.x0, h = cell.yTop - cell.yBottom;
    const f = (r: { x0: number; y0: number; x1: number; y1: number }): EmBox => ({
      x0: cell.x0 + r.x0 * w, x1: cell.x0 + r.x1 * w, yTop: cell.yTop - r.y0 * h, yBottom: cell.yTop - r.y1 * h,
    });
    slotRects.push(f(L.cho));
    if (L.jungH && L.jungV) slotRects.push(f(L.jungH), f(L.jungV));
    else slotRects.push(f(L.jung));
    if (L.jong) slotRects.push(f(L.jong));
  }

  const handles = pl ? renderHandles(pl, selNode, hr, onNodeDown) : null;

  return (
    <div
      ref={wrapRef}
      className={`canvas-wrap tool-${tool}`}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg
        ref={svgRef}
        className="canvas"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onWheel={onWheel}
        onDoubleClick={() => tool === 'pen' && finishPen(false)}
      >
        {ref && ref.visible && refSize && (
          <image
            href={ref.src}
            x={ref.x}
            y={-ref.y}
            width={refSize.w * ref.scale}
            height={refSize.h * ref.scale}
            opacity={ref.opacity}
            preserveAspectRatio="none"
            style={{ pointerEvents: 'none', imageRendering: ref.scale > 8 ? 'pixelated' : 'auto' }}
          />
        )}
        <g ref={gRef} transform="scale(1,-1)">
          {/* 가이드 */}
          {comp && (
            <g className="guides">
              <line x1={-4000} x2={4000} y1={0} y2={0} className="guide baseline" />
              <line x1={0} x2={0} y1={-3000} y2={3000} className="guide" />
              <line x1={comp.advance} x2={comp.advance} y1={-3000} y2={3000} className="guide" />
              {isLatin
                ? [p.xHeight, p.capHeight, p.ascender, p.descender].map((y, i) => (
                    <line key={i} x1={-4000} x2={4000} y1={y} y2={y} className="guide" />
                  ))
                : comp.cell && <rect {...rectOf(comp.cell)} className="guide cell" />}
              {slotRects.map((b, i) => (
                <rect key={i} {...rectOf(b)} className="slot" />
              ))}
            </g>
          )}
          {/* 전체 글자 */}
          <path d={fullD} className="glyph-fill" />
          {pl && <path d={currentD} className="glyph-current" />}
          {pl && <rect {...rectOf(pl.slot)} className="slot active" />}
          {pl && <rect {...rectOf(pl.box)} className="box active" />}
          {/* 다른 자모의 뼈대 — 누르면 그 자모로 전환 */}
          {comp?.placements.map((q, i) =>
            q === pl ? null : (
              <g key={i}>
                <path
                  d={strokesPathD(q.strokes)}
                  className="skeleton-hit other"
                  onPointerDown={(e) => {
                    if (tool !== 'select') return;
                    e.stopPropagation();
                    set({ role: q.role, part: q.part, selNode: null, selStroke: null });
                  }}
                >
                  <title>{`${q.jamo} 편집하기`}</title>
                </path>
                <path d={strokesPathD(q.strokes)} className="skeleton other" />
              </g>
            ),
          )}
          {/* 현재 자모의 뼈대 */}
          {pl?.strokes.map((s, i) => (
            <g key={i}>
              <path d={strokesPathD([s])} className="skeleton-hit" onPointerDown={(e) => onStrokeDown(e, i)} onDoubleClick={(e) => onStrokeDouble(e, i)} />
              <path d={strokesPathD([s])} className={selStroke === i ? 'skeleton selected' : 'skeleton'} />
            </g>
          ))}
          {tool === 'select' && handles}
          {/* 펜 초안 */}
          {pl && pen.length > 0 && (
            <g className="pen-draft">
              <path d={'M' + [...pen, ...(hover ? [hover] : [])].map((q) => { const e = pl.toEm(q); return `${e.x} ${e.y}`; }).join('L')} className="skeleton selected" />
              {pen.map((q, i) => {
                const e = pl.toEm(q);
                return <circle key={i} cx={e.x} cy={e.y} r={hr} className={i === 0 ? 'node first' : 'node'} />;
              })}
            </g>
          )}
          {pl && ellipseDraft && (() => {
            const c = pl.toEm(ellipseDraft.c);
            const e2 = pl.toEm({ x: ellipseDraft.c.x + ellipseDraft.rx, y: ellipseDraft.c.y + ellipseDraft.ry });
            return <ellipse cx={c.x} cy={c.y} rx={Math.abs(e2.x - c.x)} ry={Math.abs(e2.y - c.y)} className="skeleton selected" />;
          })()}
          {pl && tool !== 'select' && tool !== 'reference' && hover && (() => {
            const e = pl.toEm(hover);
            return <circle cx={e.x} cy={e.y} r={hr * 0.7} className="cursor-dot" />;
          })()}
        </g>
      </svg>
      <div className="canvas-hud">
        <span>{Math.round(view.zoom * 100)}%</span>
        {pl && hover && tool !== 'select' && <span>{hover.x}, {hover.y}</span>}
      </div>
    </div>
  );
}

function renderHandles(
  pl: Placement,
  selNode: NodeRef | null,
  r: number,
  onDown: (e: React.PointerEvent, ref: NodeRef) => void,
) {
  const out: React.ReactNode[] = [];
  /** 보이는 점 + 그보다 넓은 투명 터치 영역 */
  const handle = (key: string, e: Pt, ref: NodeRef, cls: string, square = false, scale = 1) => {
    const rr = r * scale;
    const c = `node ${cls} ${sameRef(selNode, ref) ? 'sel' : ''}`;
    out.push(
      <g key={key} onPointerDown={(ev) => onDown(ev, ref)} className="handle">
        <circle cx={e.x} cy={e.y} r={r * 2.4} className="node-hit" />
        {square ? (
          <rect x={e.x - rr * 0.75} y={e.y - rr * 0.75} width={rr * 1.5} height={rr * 1.5} className={c} />
        ) : (
          <circle cx={e.x} cy={e.y} r={rr} className={c} />
        )}
      </g>,
    );
  };
  pl.skeleton.forEach((s, si) => {
    if (s.kind === 'ellipse') {
      const refs: NodeRef[] = [{ stroke: si, at: 'center' }, { stroke: si, at: 'rx' }, { stroke: si, at: 'ry' }];
      refs.forEach((ref, k) => {
        const q = nodePos(s, ref);
        if (q) handle(`e${si}-${k}`, pl.toEm(q), ref, k === 0 ? '' : 'ctrl', false, k === 0 ? 1 : 0.8);
      });
      return;
    }
    let prev = s.start;
    s.segs.forEach((g, gi) => {
      if (g.t === 'C') {
        const a = pl.toEm(prev), b = pl.toEm(g.p), c1 = pl.toEm(g.c1), c2 = pl.toEm(g.c2);
        out.push(
          <line key={`l1-${si}-${gi}`} x1={a.x} y1={a.y} x2={c1.x} y2={c1.y} className="ctrl-line" />,
          <line key={`l2-${si}-${gi}`} x1={b.x} y1={b.y} x2={c2.x} y2={c2.y} className="ctrl-line" />,
        );
        handle(`c1-${si}-${gi}`, c1, { stroke: si, at: 'seg', seg: gi, handle: 'c1' }, 'ctrl', true);
        handle(`c2-${si}-${gi}`, c2, { stroke: si, at: 'seg', seg: gi, handle: 'c2' }, 'ctrl', true);
      }
      prev = g.p;
    });
    handle(`s${si}`, pl.toEm(s.start), { stroke: si, at: 'start' }, 'start');
    s.segs.forEach((g, gi) => handle(`p${si}-${gi}`, pl.toEm(g.p), { stroke: si, at: 'seg', seg: gi, handle: 'p' }, ''));
  });
  return out;
}

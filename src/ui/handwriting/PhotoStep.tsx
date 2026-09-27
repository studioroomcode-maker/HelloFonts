import { useEffect, useRef, useState } from 'react';
import { capture } from '../pointer';
import type { Project, Pt } from '../../core/types';
import { toGray, type Gray } from '../../core/handwriting/raster';
import { applyH, detectMarkers, extractCell, sheetToImage, vectorizeCell } from '../../core/handwriting/scan';
import { cellBoxMM, cellFrame, type TemplatePage } from '../../core/handwriting/template';
import type { CellInk } from '../../core/handwriting/fit';

interface Loaded {
  gray: Gray;
  url: string;
  corners: Pt[];
  found: boolean;
}

const MAX_SIDE = 2400;

async function loadPhoto(file: File): Promise<{ gray: Gray; url: string }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  return { gray: toGray(data, w, h), url: canvas.toDataURL('image/jpeg', 0.85) };
}

const defaultCorners = (g: Gray): Pt[] => [
  { x: g.w * 0.06, y: g.h * 0.05 }, { x: g.w * 0.94, y: g.h * 0.05 },
  { x: g.w * 0.06, y: g.h * 0.95 }, { x: g.w * 0.94, y: g.h * 0.95 },
];

const CORNER_LABEL = ['왼쪽 위', '오른쪽 위', '왼쪽 아래', '오른쪽 아래'];

export function PhotoStep({
  page, project, onRecognized,
}: {
  page: TemplatePage;
  project: Project;
  onRecognized: (inks: CellInk[]) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoaded(null);
    setError(null);
  }, [page.id]);

  const onFile = async (file: File) => {
    setError(null);
    setBusy('사진을 읽는 중…');
    try {
      const { gray, url } = await loadPhoto(file);
      const found = detectMarkers(gray);
      setLoaded({ gray, url, corners: found ?? defaultCorners(gray), found: !!found });
    } catch {
      setError('사진을 읽을 수 없습니다. JPG·PNG 사진인지 확인해 주세요.');
    }
    setBusy(null);
  };

  const recognize = async () => {
    if (!loaded) return;
    const H = sheetToImage(loaded.corners);
    const out: CellInk[] = [];
    for (let i = 0; i < page.cells.length; i++) {
      if (i % 6 === 0) {
        setBusy(`글씨를 읽는 중… ${i}/${page.cells.length}`);
        await new Promise((r) => setTimeout(r, 0));
      }
      const cell = page.cells[i];
      const { lines, blobs } = vectorizeCell(extractCell(loaded.gray, H, i), cellFrame(cell, project.params));
      out.push({ text: cell.text, lines, blobs });
    }
    setBusy(null);
    onRecognized(out);
  };

  const toImage = (e: React.PointerEvent): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const r = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: r.x, y: r.y };
  };

  const H = loaded ? sheetToImage(loaded.corners) : null;
  const handleR = loaded ? Math.max(loaded.gray.w, loaded.gray.h) * 0.018 : 10;

  return (
    <div className="photo-step">
      {!loaded ? (
        <div className="drop-zone">
          <p>
            <b>{page.title}</b>에 쓴 종이를 사진으로 찍어 올려 주세요.
          </p>
          <p className="muted small">네 모서리의 검은 네모가 모두 보이게, 그림자 없이 밝은 곳에서 찍으면 가장 잘 읽힙니다. 스캔 파일도 됩니다.</p>
          <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={!!busy}>
            사진 고르기
          </button>
          {busy && <p className="muted small">{busy}</p>}
          {error && <p className="error small">{error}</p>}
        </div>
      ) : (
        <div className="photo-work">
          <div className="photo-frame">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${loaded.gray.w} ${loaded.gray.h}`}
              onPointerMove={(e) => {
                if (dragging.current === null) return;
                const q = toImage(e);
                setLoaded((l) => l && { ...l, corners: l.corners.map((c, i) => (i === dragging.current ? q : c)) });
              }}
              onPointerUp={() => (dragging.current = null)}
              onPointerLeave={() => (dragging.current = null)}
            >
              <image href={loaded.url} width={loaded.gray.w} height={loaded.gray.h} />
              {H && page.cells.map((_, i) => {
                const b = cellBoxMM(i);
                const pts = [
                  applyH(H, { x: b.x, y: b.y }), applyH(H, { x: b.x + b.size, y: b.y }),
                  applyH(H, { x: b.x + b.size, y: b.y + b.size }), applyH(H, { x: b.x, y: b.y + b.size }),
                ];
                return <polygon key={i} points={pts.map((q) => `${q.x},${q.y}`).join(' ')} className="cell-overlay" />;
              })}
              {loaded.corners.map((c, i) => (
                <g key={i} onPointerDown={(e) => { dragging.current = i; capture(e.currentTarget.ownerSVGElement as Element, e.pointerId); }}>
                  <circle cx={c.x} cy={c.y} r={handleR} className="corner-handle" />
                  <title>{CORNER_LABEL[i]} 검은 네모</title>
                </g>
              ))}
            </svg>
          </div>
          <div className="photo-side">
            <p className="small">
              {loaded.found
                ? '네 모서리 표식을 찾았습니다. 분홍 칸이 종이의 칸과 잘 겹치는지 확인하세요.'
                : '모서리 표식을 자동으로 찾지 못했습니다. 동그라미 네 개를 종이의 검은 네모 가운데로 끌어 맞춰 주세요.'}
            </p>
            <div className="btn-col">
              <button className="btn primary" onClick={recognize} disabled={!!busy}>글씨 읽기</button>
              <button className="btn" onClick={() => fileRef.current?.click()} disabled={!!busy}>다른 사진</button>
            </div>
            {busy && <p className="muted small">{busy}</p>}
          </div>
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
          if (f) onFile(f);
        }}
      />
    </div>
  );
}

import type { Project } from '../../core/types';
import { composeChar } from '../../core/compose';
import {
  cellBoxMM, cellFrame, emToFrame, MARKERS_MM, SHEET, TAKE_LABEL, type TemplatePage,
} from '../../core/handwriting/template';

/** 인쇄용 원고지 한 장을 SVG 문자열로 (단위 mm, A4 세로) */
export function templateSvg(page: TemplatePage, project: Project, pageNo: number, pageCount: number): string {
  const p = project.params;
  const out: string[] = [];
  const f = (n: number) => Math.round(n * 100) / 100;
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET.w}mm" height="${SHEET.h}mm" viewBox="0 0 ${SHEET.w} ${SHEET.h}">`);
  out.push(`<rect width="${SHEET.w}" height="${SHEET.h}" fill="#fff"/>`);
  for (const m of MARKERS_MM) out.push(`<rect x="${m.x - SHEET.marker / 2}" y="${m.y - SHEET.marker / 2}" width="${SHEET.marker}" height="${SHEET.marker}" fill="#000"/>`);
  out.push(`<text x="105" y="14" text-anchor="middle" font-size="5" font-family="sans-serif" fill="#333">HelloFonts 손글씨 원고지 · ${page.title} (${pageNo}/${pageCount})</text>`);
  out.push(`<text x="105" y="21" text-anchor="middle" font-size="3" font-family="sans-serif" fill="#777">검은 펜으로 연분홍 안내 상자에 맞춰 또박또박 써 주세요. 사진을 찍을 때는 네 모서리의 검은 네모가 모두 나오게 해 주세요.</text>`);
  out.push(`<text x="105" y="25.5" text-anchor="middle" font-size="3" font-family="sans-serif" fill="#777">진하게 표시된 자리가 이 칸에서 받아 갈 자모입니다. 나머지도 함께 써야 크기와 위치가 자연스럽게 잡힙니다.</text>`);

  page.cells.forEach((cell, i) => {
    const box = cellBoxMM(i);
    const frame = cellFrame(cell, p);
    const toMM = (x: number, y: number) => {
      const r = emToFrame(frame, x, y);
      return { x: box.x + r.u * box.size, y: box.y + r.v * box.size };
    };
    out.push(`<text x="${f(box.x)}" y="${f(box.y - 1)}" font-size="3" font-family="sans-serif" fill="#999">${cell.text}</text>`);
    if (cell.take === 'latin') {
      for (const [y, strong] of [[0, true], [p.xHeight, false], [p.capHeight, false], [p.descender, false]] as const) {
        const a = toMM(frame.x0, y);
        out.push(`<line x1="${f(box.x)}" x2="${f(box.x + box.size)}" y1="${f(a.y)}" y2="${f(a.y)}" stroke="${strong ? '#f2a7b8' : '#f8d2dc'}" stroke-width="${strong ? 0.35 : 0.25}"/>`);
      }
    } else {
      const comp = composeChar(project, cell.text);
      const role = cell.take === 'jung' ? 'jung' : cell.take === 'jong' ? 'jong' : 'cho';
      for (const pl of comp?.placements ?? []) {
        const a = toMM(pl.slot.x0, pl.slot.yTop), b = toMM(pl.slot.x1, pl.slot.yBottom);
        const target = pl.role === role;
        out.push(`<rect x="${f(a.x)}" y="${f(a.y)}" width="${f(b.x - a.x)}" height="${f(b.y - a.y)}" fill="${target ? '#fdeef2' : 'none'}" stroke="${target ? '#f2a7b8' : '#f8d2dc'}" stroke-width="0.25" stroke-dasharray="${target ? '' : '1 0.8'}"/>`);
      }
    }
    out.push(`<rect x="${f(box.x)}" y="${f(box.y)}" width="${box.size}" height="${box.size}" fill="none" stroke="#f2a7b8" stroke-width="0.3"/>`);
  });
  const takes = [...new Set(page.cells.map((c) => c.take))].map((t) => TAKE_LABEL[t]).join(' · ');
  out.push(`<text x="105" y="${SHEET.h - 20}" text-anchor="middle" font-size="2.6" font-family="sans-serif" fill="#aaa">${takes}</text>`);
  out.push('</svg>');
  return out.join('');
}

/** 원고지 여러 장을 인쇄 창으로 */
export function printSheets(svgs: string[]) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>HelloFonts 손글씨 원고지</title>
<style>@page { size: A4 portrait; margin: 0 } html, body { margin: 0 } .page { width: 210mm; height: 297mm; page-break-after: always; overflow: hidden } svg { display: block }</style>
</head><body>${svgs.map((s) => `<div class="page">${s}</div>`).join('')}</body></html>`);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 2000);
  }, 300);
}

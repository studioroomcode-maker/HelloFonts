import type { Contour, Pt } from './types';

/**
 * TrueType(.ttf) 파일 작성기.
 * 3차 곡선 외곽선을 2차(TrueType)로 바꿔 glyf/loca에 쓰고, 필수 테이블을 모두 만든다.
 */

export interface TTGlyph {
  name: string;
  unicode?: number;
  advance: number;
  contours: Contour[];
}

export interface NameSet {
  /** nameID 1 — RIBBI 패밀리 이름 */
  family: string;
  /** nameID 2 — Regular / Bold / Italic / Bold Italic */
  subfamily: string;
  /** nameID 16/17 — 굵기가 여럿일 때의 대표 패밀리/스타일 */
  typoFamily?: string;
  typoSubfamily?: string;
  fullName: string;
  postScriptName: string;
  version: string;
  designer?: string;
  copyright?: string;
  license?: string;
  /** 한국어 이름(0x0412) */
  ko?: { family?: string; fullName?: string; typoFamily?: string };
}

export interface FontMeta {
  names: NameSet;
  unitsPerEm: number;
  /** 한자 em 상자 기준 위·아래(보통 880 / -120) */
  typoAscender: number;
  typoDescender: number;
  typoLineGap: number;
  xHeight: number;
  capHeight: number;
  weightClass: number;
  bold: boolean;
  italic: boolean;
  italicAngle: number;
  /** 윤곽이 겹칠 수 있음(겹침 제거를 못 했을 때) */
  overlapping: boolean;
  /** 조합형 코드페이지 비트도 켤지(11,172자 전체일 때) */
  johab: boolean;
}

// ───────────────────────── 바이트 쓰기 ─────────────────────────

class Writer {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private ensure(n: number) {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) { this.ensure(1); this.view.setUint8(this.length, v); this.length += 1; }
  i8(v: number) { this.ensure(1); this.view.setInt8(this.length, v); this.length += 1; }
  u16(v: number) { this.ensure(2); this.view.setUint16(this.length, v); this.length += 2; }
  i16(v: number) { this.ensure(2); this.view.setInt16(this.length, v); this.length += 2; }
  u32(v: number) { this.ensure(4); this.view.setUint32(this.length, v >>> 0); this.length += 4; }
  i32(v: number) { this.ensure(4); this.view.setInt32(this.length, v); this.length += 4; }
  fixed(v: number) { this.i32(Math.round(v * 65536)); }
  bytes(b: Uint8Array) { this.ensure(b.length); this.buf.set(b, this.length); this.length += b.length; }
  tag(s: string) { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i)); }
  pad4() { while (this.length % 4) this.u8(0); }
  setU32(at: number, v: number) { this.view.setUint32(at, v >>> 0); }
  toBytes() { return this.buf.slice(0, this.length); }
}

// ───────────────────────── 3차 → 2차 곡선 ─────────────────────────

interface TTPoint { x: number; y: number; on: boolean }

/** 3차 곡선을 허용 오차 안의 2차 곡선들로 나눈다 */
export function cubicToQuads(p0: Pt, c1: Pt, c2: Pt, p3: Pt, tol = 0.5): { q: Pt; p: Pt }[] {
  for (let n = 1; n <= 24; n++) {
    const pieces: { q: Pt; p: Pt }[] = [];
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const [a, b, c, d] = splitRange(p0, c1, c2, p3, i / n, (i + 1) / n);
      // 오차 상한: √3/36 · |d − 3c + 3b − a|
      const ex = d.x - 3 * c.x + 3 * b.x - a.x, ey = d.y - 3 * c.y + 3 * b.y - a.y;
      if ((Math.sqrt(3) / 36) * Math.hypot(ex, ey) > tol && n < 24) ok = false;
      pieces.push({ q: { x: (3 * (b.x + c.x) - a.x - d.x) / 4, y: (3 * (b.y + c.y) - a.y - d.y) / 4 }, p: d });
    }
    if (ok) return pieces;
  }
  return [{ q: { x: (3 * (c1.x + c2.x) - p0.x - p3.x) / 4, y: (3 * (c1.y + c2.y) - p0.y - p3.y) / 4 }, p: p3 }];
}

function at(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
  };
}

function deriv(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: 3 * u * u * (c1.x - p0.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (p3.x - c2.x),
    y: 3 * u * u * (c1.y - p0.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (p3.y - c2.y),
  };
}

/** t0..t1 구간의 3차 곡선 조절점 */
function splitRange(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t0: number, t1: number): [Pt, Pt, Pt, Pt] {
  const a = at(p0, c1, c2, p3, t0), d = at(p0, c1, c2, p3, t1);
  const k = (t1 - t0) / 3;
  const da = deriv(p0, c1, c2, p3, t0), dd = deriv(p0, c1, c2, p3, t1);
  return [a, { x: a.x + da.x * k, y: a.y + da.y * k }, { x: d.x - dd.x * k, y: d.y - dd.y * k }, d];
}

function contourToTT(c: Contour): TTPoint[] {
  const pts: TTPoint[] = [{ x: Math.round(c.start.x), y: Math.round(c.start.y), on: true }];
  let prev = c.start;
  for (const s of c.segs) {
    if (s.t === 'L') pts.push({ x: Math.round(s.p.x), y: Math.round(s.p.y), on: true });
    else {
      for (const q of cubicToQuads(prev, s.c1, s.c2, s.p)) {
        pts.push({ x: Math.round(q.q.x), y: Math.round(q.q.y), on: false });
        pts.push({ x: Math.round(q.p.x), y: Math.round(q.p.y), on: true });
      }
    }
    prev = s.p;
  }
  // 닫는 점(시작점과 같은 마지막 점) 제거
  const last = pts[pts.length - 1];
  if (pts.length > 1 && last.on && last.x === pts[0].x && last.y === pts[0].y) pts.pop();
  // 연속으로 겹친 점 제거
  const dedup: TTPoint[] = [];
  for (const p of pts) {
    const q = dedup[dedup.length - 1];
    if (q && q.x === p.x && q.y === p.y && q.on === p.on) continue;
    dedup.push(p);
  }
  // 두 조절점의 정확한 중점인 곡선 위 점은 생략(암시적 점)
  const out: TTPoint[] = [];
  for (let i = 0; i < dedup.length; i++) {
    const p = dedup[i];
    const a = dedup[(i - 1 + dedup.length) % dedup.length], b = dedup[(i + 1) % dedup.length];
    if (i !== 0 && p.on && !a.on && !b.on && a.x + b.x === 2 * p.x && a.y + b.y === 2 * p.y) continue;
    out.push(p);
  }
  return out.length >= 2 ? out : [];
}

interface EncodedGlyph {
  data: Uint8Array;
  xMin: number; yMin: number; xMax: number; yMax: number;
  points: number;
  contours: number;
}

function encodeGlyph(contours: Contour[], overlapping: boolean): EncodedGlyph {
  const cs = contours.map(contourToTT).filter((c) => c.length >= 2);
  if (!cs.length) return { data: new Uint8Array(0), xMin: 0, yMin: 0, xMax: 0, yMax: 0, points: 0, contours: 0 };
  const all = cs.flat();
  const xMin = Math.min(...all.map((p) => p.x)), xMax = Math.max(...all.map((p) => p.x));
  const yMin = Math.min(...all.map((p) => p.y)), yMax = Math.max(...all.map((p) => p.y));
  const w = new Writer();
  w.i16(cs.length);
  w.i16(xMin); w.i16(yMin); w.i16(xMax); w.i16(yMax);
  let end = -1;
  for (const c of cs) {
    end += c.length;
    w.u16(end);
  }
  w.u16(0); // 명령어 길이
  const flags: number[] = [];
  const xs = new Writer(), ys = new Writer();
  let px = 0, py = 0;
  all.forEach((p, i) => {
    let f = p.on ? 0x01 : 0;
    if (i === 0 && overlapping) f |= 0x40;
    const dx = p.x - px, dy = p.y - py;
    if (dx === 0) f |= 0x10;
    else if (Math.abs(dx) < 256) { f |= 0x02; if (dx > 0) f |= 0x10; xs.u8(Math.abs(dx)); }
    else xs.i16(dx);
    if (dy === 0) f |= 0x20;
    else if (Math.abs(dy) < 256) { f |= 0x04; if (dy > 0) f |= 0x20; ys.u8(Math.abs(dy)); }
    else ys.i16(dy);
    flags.push(f);
    px = p.x;
    py = p.y;
  });
  // 같은 플래그 반복은 REPEAT로 압축
  for (let i = 0; i < flags.length; ) {
    let run = 1;
    while (i + run < flags.length && flags[i + run] === flags[i] && run < 256) run++;
    if (run > 1) {
      w.u8(flags[i] | 0x08);
      w.u8(run - 1);
    } else w.u8(flags[i]);
    i += run;
  }
  w.bytes(xs.toBytes());
  w.bytes(ys.toBytes());
  return { data: w.toBytes(), xMin, yMin, xMax, yMax, points: all.length, contours: cs.length };
}

// ───────────────────────── 테이블 ─────────────────────────

function utf16be(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i * 2] = c >> 8;
    out[i * 2 + 1] = c & 0xff;
  }
  return out;
}

function makeName(n: NameSet): Uint8Array {
  type Rec = { platform: number; encoding: number; lang: number; id: number; bytes: Uint8Array };
  const recs: Rec[] = [];
  const ascii = (s: string) => Uint8Array.from([...s].map((ch) => (ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : 63)));
  const en: [number, string | undefined][] = [
    [0, n.copyright], [1, n.family], [2, n.subfamily], [3, `${n.version};HELO;${n.postScriptName}`], [4, n.fullName],
    [5, `Version ${n.version}`], [6, n.postScriptName], [9, n.designer], [13, n.license],
    [16, n.typoFamily], [17, n.typoSubfamily],
  ];
  for (const [id, v] of en) {
    if (!v) continue;
    recs.push({ platform: 3, encoding: 1, lang: 0x0409, id, bytes: utf16be(v) });
    if (id <= 6) recs.push({ platform: 1, encoding: 0, lang: 0, id, bytes: ascii(v) });
  }
  if (n.ko) {
    const ko: [number, string | undefined][] = [[1, n.ko.family], [4, n.ko.fullName], [16, n.ko.typoFamily]];
    for (const [id, v] of ko) if (v) recs.push({ platform: 3, encoding: 1, lang: 0x0412, id, bytes: utf16be(v) });
  }
  recs.sort((a, b) => a.platform - b.platform || a.encoding - b.encoding || a.lang - b.lang || a.id - b.id);
  const w = new Writer();
  w.u16(0);
  w.u16(recs.length);
  w.u16(6 + recs.length * 12);
  let off = 0;
  for (const r of recs) {
    w.u16(r.platform); w.u16(r.encoding); w.u16(r.lang); w.u16(r.id); w.u16(r.bytes.length); w.u16(off);
    off += r.bytes.length;
  }
  for (const r of recs) w.bytes(r.bytes);
  return w.toBytes();
}

function makeCmap(map: [number, number][]): Uint8Array {
  // 연속된 코드·글리프 번호를 한 구간으로 묶는다(format 4, idDelta)
  const segs: { start: number; end: number; delta: number }[] = [];
  for (const [code, gid] of map) {
    if (code > 0xfffe) continue;
    const last = segs[segs.length - 1];
    if (last && code === last.end + 1 && gid - code === last.delta) last.end = code;
    else segs.push({ start: code, end: code, delta: gid - code });
  }
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const segX2 = segs.length * 2;
  const search = 2 * 2 ** Math.floor(Math.log2(segs.length));
  const sub = new Writer();
  sub.u16(4);
  sub.u16(16 + segs.length * 8);
  sub.u16(0);
  sub.u16(segX2);
  sub.u16(search);
  sub.u16(Math.log2(search / 2));
  sub.u16(segX2 - search);
  for (const s of segs) sub.u16(s.end);
  sub.u16(0);
  for (const s of segs) sub.u16(s.start);
  for (const s of segs) sub.u16((s.delta + 65536) % 65536);
  for (let i = 0; i < segs.length; i++) sub.u16(0);
  const w = new Writer();
  w.u16(0);
  w.u16(2);
  w.u16(0); w.u16(3); w.u32(20); // 유니코드 플랫폼
  w.u16(3); w.u16(1); w.u32(20); // 윈도우 유니코드 BMP
  w.bytes(sub.toBytes());
  return w.toBytes();
}

function unicodeRanges(codes: number[]): [number, number, number, number] {
  const r = [0, 0, 0, 0];
  const set = (bit: number) => (r[bit >> 5] |= 1 << (bit & 31));
  for (const c of codes) {
    if (c <= 0x7f) set(0);
    else if (c <= 0xff) set(1);
    else if (c >= 0x1100 && c <= 0x11ff) set(28);
    else if (c >= 0x3000 && c <= 0x303f) set(48);
    else if (c >= 0x3130 && c <= 0x318f) set(52);
    else if (c >= 0xac00 && c <= 0xd7af) set(56);
  }
  return r.map((v) => v >>> 0) as [number, number, number, number];
}

function checksum(b: Uint8Array): number {
  let sum = 0;
  const n = Math.ceil(b.length / 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    sum = (sum + (((b[o] << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0)) >>> 0;
  }
  return sum;
}

/** .notdef + 글리프들로 TTF 파일을 만든다 */
export function buildTTF(glyphs: TTGlyph[], meta: FontMeta): Uint8Array {
  const enc = glyphs.map((g) => encodeGlyph(g.contours, meta.overlapping));
  const n = glyphs.length;

  // glyf / loca
  const glyf = new Writer();
  const loca = new Writer();
  for (const e of enc) {
    loca.u32(glyf.length);
    glyf.bytes(e.data);
    glyf.pad4();
  }
  loca.u32(glyf.length);

  const nonEmpty = enc.filter((e) => e.contours > 0);
  const xMin = Math.min(0, ...nonEmpty.map((e) => e.xMin)), yMin = Math.min(0, ...nonEmpty.map((e) => e.yMin));
  const xMax = Math.max(0, ...nonEmpty.map((e) => e.xMax)), yMax = Math.max(0, ...nonEmpty.map((e) => e.yMax));
  const advances = glyphs.map((g) => Math.max(0, Math.round(g.advance)));
  const lsbs = enc.map((e) => (e.contours ? e.xMin : 0));
  const rsbs = enc.map((e, i) => (e.contours ? advances[i] - e.xMax : advances[i]));

  const hheaAsc = meta.typoAscender + Math.round(meta.typoLineGap / 2);
  const hheaDesc = meta.typoDescender - Math.round(meta.typoLineGap / 2);

  // head
  const head = new Writer();
  head.fixed(1);
  head.fixed(parseFloat(meta.names.version) || 1);
  head.u32(0); // checkSumAdjustment(나중에 채움)
  head.u32(0x5f0f3cf5);
  head.u16(0x000b);
  head.u16(meta.unitsPerEm);
  const secs = Math.floor(Date.now() / 1000) + 2082844800;
  for (let i = 0; i < 2; i++) { head.u32(Math.floor(secs / 4294967296)); head.u32(secs % 4294967296); }
  head.i16(xMin); head.i16(yMin); head.i16(xMax); head.i16(yMax);
  head.u16((meta.bold ? 1 : 0) | (meta.italic ? 2 : 0));
  head.u16(8);
  head.i16(2);
  head.i16(1); // loca: long
  head.i16(0);

  // hhea
  const hhea = new Writer();
  hhea.fixed(1);
  hhea.i16(hheaAsc);
  hhea.i16(hheaDesc);
  hhea.i16(0);
  hhea.u16(Math.max(...advances));
  hhea.i16(Math.min(...lsbs));
  hhea.i16(Math.min(...rsbs));
  hhea.i16(Math.max(...enc.map((e, i) => (e.contours ? lsbs[i] + (e.xMax - e.xMin) : 0))));
  const slope = Math.tan((-meta.italicAngle * Math.PI) / 180);
  hhea.i16(1000); hhea.i16(Math.round(slope * 1000)); hhea.i16(0);
  for (let i = 0; i < 4; i++) hhea.i16(0);
  hhea.i16(0);
  hhea.u16(n);

  // maxp
  const maxp = new Writer();
  maxp.fixed(1);
  maxp.u16(n);
  maxp.u16(Math.max(0, ...enc.map((e) => e.points)));
  maxp.u16(Math.max(0, ...enc.map((e) => e.contours)));
  maxp.u16(0); maxp.u16(0);
  maxp.u16(2);
  for (let i = 0; i < 8; i++) maxp.u16(0);

  // hmtx
  const hmtx = new Writer();
  advances.forEach((a, i) => { hmtx.u16(a); hmtx.i16(lsbs[i]); });

  // cmap
  const map: [number, number][] = [];
  glyphs.forEach((g, i) => { if (g.unicode !== undefined) map.push([g.unicode, i]); });
  map.sort((a, b) => a[0] - b[0]);
  const cmap = makeCmap(map);

  // OS/2 (버전 4)
  const codes = map.map((m) => m[0]);
  const ranges = unicodeRanges(codes);
  const os2 = new Writer();
  os2.u16(4);
  const nz = advances.filter((a) => a > 0);
  os2.i16(Math.round(nz.reduce((a, b) => a + b, 0) / Math.max(1, nz.length)));
  os2.u16(meta.weightClass);
  os2.u16(5);
  os2.u16(0); // fsType: 설치 가능(임베딩 제한 없음)
  os2.i16(650); os2.i16(600); os2.i16(0); os2.i16(75);
  os2.i16(650); os2.i16(600); os2.i16(0); os2.i16(350);
  os2.i16(50); os2.i16(300);
  os2.i16(0);
  for (let i = 0; i < 10; i++) os2.u8(0);
  for (const r of ranges) os2.u32(r);
  os2.tag('HELO');
  const fsSelection = (meta.italic ? 1 : 0) | (meta.bold ? 1 << 5 : 0) | (!meta.italic && !meta.bold ? 1 << 6 : 0) | (1 << 7);
  os2.u16(fsSelection);
  os2.u16(Math.min(0xffff, codes[0] ?? 0));
  os2.u16(Math.min(0xffff, codes[codes.length - 1] ?? 0));
  os2.i16(meta.typoAscender);
  os2.i16(meta.typoDescender);
  os2.i16(meta.typoLineGap);
  os2.u16(Math.max(yMax, hheaAsc));
  os2.u16(Math.max(-yMin, -hheaDesc));
  os2.u32((1 << 0) | (1 << 19) | (meta.johab ? 1 << 21 : 0));
  os2.u32(0);
  os2.i16(meta.xHeight);
  os2.i16(meta.capHeight);
  os2.u16(0);
  os2.u16(32);
  os2.u16(0);

  // post (버전 3: 글리프 이름 없음)
  const post = new Writer();
  post.fixed(3);
  post.fixed(-meta.italicAngle);
  post.i16(-100);
  post.i16(50);
  post.u32(0);
  for (let i = 0; i < 4; i++) post.u32(0);

  // gasp: 힌팅 없는 글꼴은 모든 크기에서 부드럽게
  const gasp = new Writer();
  gasp.u16(1); gasp.u16(1); gasp.u16(0xffff); gasp.u16(0x000a);

  const tables: [string, Uint8Array][] = [
    ['OS/2', os2.toBytes()],
    ['cmap', cmap],
    ['gasp', gasp.toBytes()],
    ['glyf', glyf.toBytes()],
    ['head', head.toBytes()],
    ['hhea', hhea.toBytes()],
    ['hmtx', hmtx.toBytes()],
    ['loca', loca.toBytes()],
    ['maxp', maxp.toBytes()],
    ['name', makeName(meta.names)],
    ['post', post.toBytes()],
  ];
  tables.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const out = new Writer();
  const num = tables.length;
  const sr = 16 * 2 ** Math.floor(Math.log2(num));
  out.u32(0x00010000);
  out.u16(num);
  out.u16(sr);
  out.u16(Math.log2(sr / 16));
  out.u16(num * 16 - sr);
  let offset = 12 + num * 16;
  let headOffset = 0;
  for (const [tag, data] of tables) {
    out.tag(tag);
    out.u32(checksum(data));
    out.u32(offset);
    out.u32(data.length);
    if (tag === 'head') headOffset = offset;
    offset += Math.ceil(data.length / 4) * 4;
  }
  for (const [, data] of tables) {
    out.bytes(data);
    out.pad4();
  }
  const bytes = out.toBytes();
  const adj = (0xb1b0afba - checksum(bytes)) >>> 0;
  new DataView(bytes.buffer).setUint32(headOffset + 8, adj);
  return bytes;
}

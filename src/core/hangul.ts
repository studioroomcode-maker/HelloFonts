export const CHO = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
export const JUNG = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
export const JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];

export const BASIC_CONSONANTS = [...'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'];
export const BASIC_VOWELS = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅛㅜㅠㅡㅣ'];

/** 겹자음 → 구성 자음 */
export const DOUBLE_CONSONANT: Record<string, [string, string]> = {
  ㄲ: ['ㄱ', 'ㄱ'], ㄸ: ['ㄷ', 'ㄷ'], ㅃ: ['ㅂ', 'ㅂ'], ㅆ: ['ㅅ', 'ㅅ'], ㅉ: ['ㅈ', 'ㅈ'],
  ㄳ: ['ㄱ', 'ㅅ'], ㄵ: ['ㄴ', 'ㅈ'], ㄶ: ['ㄴ', 'ㅎ'], ㄺ: ['ㄹ', 'ㄱ'], ㄻ: ['ㄹ', 'ㅁ'],
  ㄼ: ['ㄹ', 'ㅂ'], ㄽ: ['ㄹ', 'ㅅ'], ㄾ: ['ㄹ', 'ㅌ'], ㄿ: ['ㄹ', 'ㅍ'], ㅀ: ['ㄹ', 'ㅎ'],
  ㅄ: ['ㅂ', 'ㅅ'],
};

/** 겹모음 → [가로 부분, 세로 부분] */
export const COMPOUND_VOWEL: Record<string, [string, string]> = {
  ㅘ: ['ㅗ', 'ㅏ'], ㅙ: ['ㅗ', 'ㅐ'], ㅚ: ['ㅗ', 'ㅣ'],
  ㅝ: ['ㅜ', 'ㅓ'], ㅞ: ['ㅜ', 'ㅔ'], ㅟ: ['ㅜ', 'ㅣ'], ㅢ: ['ㅡ', 'ㅣ'],
};

/**
 * 모음에 따른 배치 틀 분류
 *  V ㅏㅑㅣ · VL ㅓㅕ · VV ㅐㅒㅔㅖ · Ho ㅗㅛㅡ · Hu ㅜㅠ · Co ㅘㅚㅢ · Cu ㅝㅟ · CCo ㅙ · CCu ㅞ
 */
export type VowelClass = 'V' | 'VL' | 'VV' | 'Ho' | 'Hu' | 'Co' | 'Cu' | 'CCo' | 'CCu';

const CLASS_OF: Record<string, VowelClass> = {};
const setClass = (vs: string, c: VowelClass) => {
  for (const v of vs) CLASS_OF[v] = c;
};
setClass('ㅏㅑㅣ', 'V');
setClass('ㅓㅕ', 'VL');
setClass('ㅐㅒㅔㅖ', 'VV');
setClass('ㅗㅛㅡ', 'Ho');
setClass('ㅜㅠ', 'Hu');
setClass('ㅘㅚㅢ', 'Co');
setClass('ㅝㅟ', 'Cu');
setClass('ㅙ', 'CCo');
setClass('ㅞ', 'CCu');

export const vowelClass = (v: string): VowelClass => CLASS_OF[v];

export const VOWEL_CLASSES: VowelClass[] = ['V', 'VL', 'VV', 'Ho', 'Hu', 'Co', 'Cu', 'CCo', 'CCu'];
export const LAYOUT_KEYS = VOWEL_CLASSES.flatMap((c) => [c, `${c}_F`]) as LayoutKey[];
export type LayoutKey = VowelClass | `${VowelClass}_F`;

const CLASS_LABEL: Record<VowelClass, string> = {
  V: 'ㅏㅑㅣ', VL: 'ㅓㅕ', VV: 'ㅐㅒㅔㅖ', Ho: 'ㅗㅛㅡ', Hu: 'ㅜㅠ', Co: 'ㅘㅚㅢ', Cu: 'ㅝㅟ', CCo: 'ㅙ', CCu: 'ㅞ',
};
const CLASS_SAMPLE: Record<VowelClass, [string, string]> = {
  V: ['가', '각'], VL: ['거', '걱'], VV: ['개', '객'], Ho: ['고', '곡'], Hu: ['구', '국'],
  Co: ['과', '곽'], Cu: ['궈', '궉'], CCo: ['괘', '괙'], CCu: ['궤', '궥'],
};

export const LAYOUT_LABEL = Object.fromEntries(
  VOWEL_CLASSES.flatMap((c) => [
    [c, `${CLASS_LABEL[c]} (${CLASS_SAMPLE[c][0]})`],
    [`${c}_F`, `${CLASS_LABEL[c]} + 받침 (${CLASS_SAMPLE[c][1]})`],
  ]),
) as Record<LayoutKey, string>;

/** 배치 틀마다 편집 화면에서 보여 줄 대표 글자 */
export const LAYOUT_SAMPLE = Object.fromEntries(
  VOWEL_CLASSES.flatMap((c) => [[c, CLASS_SAMPLE[c][0]], [`${c}_F`, CLASS_SAMPLE[c][1]]]),
) as Record<LayoutKey, string>;

/** 모음이 오른쪽에 서는 배치인지(세로 그룹) 아래에 눕는 배치인지(가로 그룹) */
export const layoutGroup = (k: LayoutKey): 'vert' | 'horz' => (k.startsWith('H') ? 'horz' : 'vert');

/**
 * 8×4×4벌 문맥 (조합형 표준)
 *  초성 8벌: 받침 없음 — 1 세로모음 · 2 ㅗㅛㅡ · 3 ㅜㅠ · 4 ㅘㅙㅚㅢ · 5 ㅝㅞㅟ / 받침 있음 — 6 세로 · 7 가로 · 8 섞임
 *  중성 4벌: 1 받침 없음 · 2 ㄱ·ㅋ 뒤 받침 없음 · 3 받침 있음 · 4 ㄱ·ㅋ 뒤 받침 있음
 *  종성 4벌: 1 ㅏㅑㅘ · 2 ㅓㅕㅚㅝㅟㅢㅣ · 3 ㅐㅒㅔㅖㅙㅞ · 4 ㅗㅛㅜㅠㅡ
 */
export function bulOf(role: 'cho' | 'jung' | 'jong', cho: string, jung: string, hasFinal: boolean): string {
  const c = vowelClass(jung);
  if (role === 'cho') {
    if (!hasFinal) {
      if (c === 'V' || c === 'VL' || c === 'VV') return 'b1';
      if (c === 'Ho') return 'b2';
      if (c === 'Hu') return 'b3';
      if (c === 'Co' || c === 'CCo') return 'b4';
      return 'b5';
    }
    if (c === 'V' || c === 'VL' || c === 'VV') return 'b6';
    if (c === 'Ho' || c === 'Hu') return 'b7';
    return 'b8';
  }
  if (role === 'jung') {
    const k = 'ㄱㅋㄲ'.includes(cho);
    return hasFinal ? (k ? 'b4' : 'b3') : k ? 'b2' : 'b1';
  }
  if ('ㅏㅑㅘ'.includes(jung)) return 'b1';
  if ('ㅐㅒㅔㅖㅙㅞ'.includes(jung)) return 'b3';
  if ('ㅗㅛㅜㅠㅡ'.includes(jung)) return 'b4';
  return 'b2';
}

export const BUL_LABEL: Record<'cho' | 'jung' | 'jong', Record<string, string>> = {
  cho: {
    b1: '초성 1벌 (세로모음)', b2: '초성 2벌 (ㅗㅛㅡ)', b3: '초성 3벌 (ㅜㅠ)', b4: '초성 4벌 (ㅘㅙㅚㅢ)',
    b5: '초성 5벌 (ㅝㅞㅟ)', b6: '초성 6벌 (세로모음+받침)', b7: '초성 7벌 (가로모음+받침)', b8: '초성 8벌 (섞임모음+받침)',
  },
  jung: { b1: '중성 1벌', b2: '중성 2벌 (ㄱ·ㅋ 뒤)', b3: '중성 3벌 (받침 있음)', b4: '중성 4벌 (ㄱ·ㅋ 뒤+받침)' },
  jong: { b1: '종성 1벌 (ㅏㅑㅘ)', b2: '종성 2벌 (ㅓㅕㅣ…)', b3: '종성 3벌 (ㅐㅔ…)', b4: '종성 4벌 (ㅗㅜㅡ…)' },
};

export const isSyllable = (ch: string) => {
  const c = ch.codePointAt(0) ?? 0;
  return c >= 0xac00 && c <= 0xd7a3;
};

export const isJamo = (ch: string) => {
  const c = ch.codePointAt(0) ?? 0;
  return c >= 0x3131 && c <= 0x3163;
};

export const isVowelJamo = (ch: string) => JUNG.includes(ch);

export interface Decomposed {
  cho: string;
  jung: string;
  jong: string;
  layout: LayoutKey;
  bul: { cho: string; jung: string; jong: string };
}

export function decompose(ch: string): Decomposed | null {
  if (!isSyllable(ch)) return null;
  const i = (ch.codePointAt(0) as number) - 0xac00;
  const cho = CHO[Math.floor(i / 588)];
  const jung = JUNG[Math.floor((i % 588) / 28)];
  const jong = JONG[i % 28];
  const layout = (vowelClass(jung) + (jong ? '_F' : '')) as LayoutKey;
  const f = !!jong;
  return { cho, jung, jong, layout, bul: { cho: bulOf('cho', cho, jung, f), jung: bulOf('jung', cho, jung, f), jong: bulOf('jong', cho, jung, f) } };
}

export function compose(cho: string, jung: string, jong = ''): string {
  const a = CHO.indexOf(cho), b = JUNG.indexOf(jung), c = JONG.indexOf(jong);
  if (a < 0 || b < 0 || c < 0) return '';
  return String.fromCharCode(0xac00 + a * 588 + b * 28 + c);
}


let ks: string[] | null = null;
/** KS X 1001 완성형 2,350자(EUC-KR 디코딩으로 생성) */
export function ksx1001Syllables(): string[] {
  if (ks) return ks;
  const dec = new TextDecoder('euc-kr');
  const out: string[] = [];
  for (let hi = 0xb0; hi <= 0xc8; hi++) {
    for (let lo = 0xa1; lo <= 0xfe; lo++) {
      const s = dec.decode(new Uint8Array([hi, lo]));
      if (isSyllable(s)) out.push(s);
    }
  }
  ks = out;
  return out;
}

export function allSyllables(): string[] {
  const out: string[] = [];
  for (let c = 0xac00; c <= 0xd7a3; c++) out.push(String.fromCharCode(c));
  return out;
}

export const COMPAT_JAMO = (() => {
  const out: string[] = [];
  for (let c = 0x3131; c <= 0x3163; c++) out.push(String.fromCharCode(c));
  return out;
})();

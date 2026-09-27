import type { WordSample } from './fitFont';

/** public/sample-game-ui.png(970×853)의 낱말 영역 — 제목 글씨 / 본문 글씨 */
export const SAMPLE_TITLE_WORDS: WordSample[] = [
  { text: '클리어!', box: { x0: 628, y0: 203, x1: 882, y1: 268 } },
  { text: '설정', box: { x0: 196, y0: 190, x1: 282, y1: 236 } },
];

export const SAMPLE_BODY_WORDS: WordSample[] = [
  { text: '배경음악', box: { x0: 138, y0: 286, x1: 222, y1: 311 } },
  { text: '효과음', box: { x0: 138, y0: 358, x1: 198, y1: 382 } },
  { text: '목소리', box: { x0: 138, y0: 430, x1: 198, y1: 454 } },
  { text: '진동', box: { x0: 138, y0: 502, x1: 183, y1: 526 } },
  { text: '한국어', box: { x0: 134, y0: 576, x1: 188, y1: 599 } },
  { text: '오프닝 다시 보기', box: { x0: 177, y0: 654, x1: 343, y1: 684 } },
  { text: '다시 하기', box: { x0: 594, y0: 612, x1: 696, y1: 639 } },
  { text: '다음 스테이지', box: { x0: 745, y0: 612, x1: 878, y1: 639 } },
  { text: '보너스 클로버', box: { x0: 663, y0: 490, x1: 777, y1: 515 } },
  { text: '스테이지 1-3', box: { x0: 663, y0: 303, x1: 792, y1: 326 } },
  { text: 'English', box: { x0: 283, y0: 577, x1: 347, y1: 598 } },
];

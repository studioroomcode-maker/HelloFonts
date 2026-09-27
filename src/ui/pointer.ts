/** 포인터 캡처(끌기 중 요소 밖으로 나가도 이벤트를 받음). 지원하지 않는 포인터면 조용히 넘어간다 */
export function capture(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // 합성 이벤트 등 활성 포인터가 아닌 경우
  }
}

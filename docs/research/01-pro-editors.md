# 전문가용 폰트 편집기 조사

공개 문서·핸드북·릴리스 노트 기준 조사 (직접 사용 검증 아님).

## Glyphs 3 (macOS) — 독립 폰트 회사·CJK 폰트 회사의 사실상 표준
- **스마트 컴포넌트**: 부품에 Width/Height 같은 보간 축을 정의 → 획 두께를 유지한 채 늘고 줄어듦. 원래 CJK 획용으로 만들어졌고, 한글 기본 글리프는 자동으로 스마트 컴포넌트 취급. https://handbook.glyphsapp.com/components/smart/
- **코너·캡·세그먼트·브러시 컴포넌트**: 점에 세리프·획 끝·잉크 트랩을 붙이고 경로를 따라 모양을 휘게 함. https://handbook.glyphsapp.com/components/corner/
- **라이브 스트로크**: 폭·높이·위치, 이음·끝 모양, 경로 위 "펜 포인트"마다 폭·각도 지정. Expand Outline 전까지 계속 수정 가능. https://handbook.glyphsapp.com/strokes/
- **마스터·가변 폰트**: 중간 레이어, 대체(브래킷) 레이어, 마스터 간 점 선택 동기화
- **필터**: Offset Curve, Round Corners, Roughen, Hatch Outline, Remove Overlap, Add Extremes
- **자간**: 메트릭 키(`=n` 같은 방식으로 다른 글자 여백 연결), 커닝 그룹, 컴포넌트 자동 정렬
- **한글 지원**
  - 기본 세트 2,780자 또는 11,172자 전체
  - 자모로 음절 자동 생성, 자모 변형에 붙인 접미사로 자리 구분
  - 변형을 고치면 쓰는 모든 음절에 즉시 반영
  - Hangeul Composition Groups로 "어떤 자리에 어떤 변형" 규칙을 지정. 단 문서화가 거의 안 되어 있음 https://glyphsapp.com/learn/creating-a-hangeul-font
- **UX**: 편집 화면 안에서 끌어 볼 수 있는 미리보기, 텍스트 미리보기 창, 경로 잠금, 단축키 사용자 지정

## FontLab 8 (윈도우·맥) — 가장 완성도 높은 상용 종합 편집기
- **스트로크 엔진(뼈대 기반, 우리 방식과 가장 비슷)** https://help.fontlab.com/fontlab/8/whats-new/whats-new-02-draft-draw/
  - Power Stroke: 뼈대에서 가상 외곽선을 만들고, 좌우 두께를 따로 줄 수 있음
  - Power Brush: 각도·폭·대비가 있는 캘리그래피 펜
  - 두께 도구: 전체 두께 + 점별 두께 덮어쓰기, 스냅·수치 입력
  - 획 끝: Flat / Square / Round / Horizontal / Vertical / Fixed-Angle
  - 이음: Miter / Bevel / Round
- **Rapid 도구**: 핸들 없이 곡선 하나에 장력 점 하나. Smart Pencil(모양 인식·단순화)
- **Genius 노드**: 곡률이 매끄럽게 유지됨. Power Nudge: 딸린 점이 함께 움직임. Smart Corners: 모서리 둥글림·잉크 트랩
- **비파괴 필터**: Skin(세그먼트·대시·코너·캡), Glue(점·선분에 모양 붙이기)
- **가변 폰트**: 슬라이더와 재생 기능, Matchmaker(마스터 호환성 자동 수정), 조건부 대체
- **품질 검사**
  - 자동 측정: 줄기·속공간·각도 수치 표시
  - FontAudit: 고르지 않은 줄기, 짧은 선분 등을 검사하고 일괄 수정
  - Tunni 선: 곡선 장력 조절
- **미리보기**: 크기별 나열(워터폴), 현재 선택 글자 반복 표시(에코), 다크·라이트 확인, HarfBuzz 렌더링
- **내보내기**: 가변 TTF / CFF2, COLRv1, WOFF2, 내보내기 프로필, 자동 힌팅

## RoboFont (macOS) — 파이썬 중심, 확장 기능 생태계
- Prepolator: 보간 호환성 검사·자동 수정(빨강·노랑 신호등)
- Batch: 정적·가변 폰트 일괄 생성
- Skateboard: 편집 화면에서 디자인 공간 실시간 미리보기
- MetricsMachine: 커닝 전용 편집기
- **Glyph Construction**: 텍스트 규칙으로 조합 글리프 생성
  - 예: `aacute = a + acute@center,{top_lc}`
  - Glyph Builder에서 규칙을 고치는 대로 실시간 미리보기
- Outliner: 모노라인 뼈대를 외곽선으로 변환
- 한글 전용 기능은 없어 제작사마다 스크립트를 직접 씀

## FontForge (무료, 여러 운영체제) — 오픈소스 표준
- Expand Stroke: 원형·캘리그래피·다각형 펜, 안쪽·바깥쪽 외곽선 제거 옵션
- Change Weight(CJK 전용 모드 있음), Condense/Extend, 진짜 이탤릭 변환, 폰트 간 보간
- **Spiro 곡선**: 곡선 위 점만 찍으면 매끄러운 곡선이 됨 → 손글씨·뼈대 입력에 적합
- Find Problems(8가지 검사), Validate, 자동 힌팅, 파이썬 스크립트

## FontCreator 15 — 쉬운 상용 편집기
- **실시간 검증**: 문제가 있는 점으로 바로 이동. 방향 오류, 자기 교차, 중복·과소 윤곽선 등 검사
- 조합 글리프 생성기, 손글씨 이미지 추적, 자동 커닝
- 데스크톱 폰트 임시 설치 테스트, 웹폰트 테스트 페이지 생성

## BirdFont (무료) — 가벼운 취미용
- 자동 굵게(획 폭), 래스터 이미지 자동 추적, 배경 이미지 회전·자르기, 여백 클래스
- 단순함 자체가 초보자 입문에 좋은 모델

## 가져올 아이디어 (우선순위순)
1. 전체 두께 + 점별 두께, 캔버스 위 레버로 조절 (FontLab 두께 도구 / Glyphs 펜 포인트)
2. 펜 프리셋: 납작 붓(각도 + 대비)과 모노라인, 좌우 비대칭 폭 (FontLab Power Brush / Power Stroke)
3. 뼈대 점에 붙이는 획 끝·모서리 장식 부품 (Glyphs 코너·캡 컴포넌트, FontLab Skin / Glue)
4. 획 두께를 유지한 채 배치 틀에 맞춰 늘고 주는 자모 변형 (Glyphs 스마트 컴포넌트)
5. UI에서 편집하는 규칙 기반 자모 변형 그룹 (Glyphs Hangeul Composition Groups)
6. 음절별 예외·영문 악센트 글자를 텍스트 규칙으로 (RoboFont Glyph Construction)
7. 내보낼 때까지 획을 비파괴로 유지 (Glyphs 라이브 스트로크)
8. 완성형 세트를 기본으로 두고 11,172자 전체는 선택 사항으로
9. 실시간 검증 패널 (FontCreator, FontForge, FontLab)
10. 줄기·속공간 두께 자동 측정 (FontLab 자동 측정)
11. 크기별 나열·선택 글자 반복·예문이 있는 미리보기 패널
12. 굵기 축 슬라이더와 가변 폰트 내보내기 (같은 뼈대라 마스터 호환이 자동으로 보장됨)
13. 여백 연결과 커닝 그룹 (Glyphs 메트릭 키, BirdFont 여백 클래스)
14. 핸들 없는 곡선 입력 (FontForge Spiro, FontLab Rapid)
15. 내보내기 품질 처리: 겹침 제거, 극점 추가, 정수 좌표, 자동 힌팅(ttfautohint), 웹폰트 테스트 페이지

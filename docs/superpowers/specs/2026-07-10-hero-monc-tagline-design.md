# 대문(창문 인트로) 태그라인 + MONC 조립 애니메이션 — 설계 (2026-07-10, 승인됨)

## 배경 / 목표

첫 화면(비행기 창밖 노을, `.hero-window-intro`)이 글자 없이 비어 있어 썰렁하다는 오너 피드백.
MONC = **M**oment **O**f **N**ew **C**areer 아크로님을 첫 화면에서 브랜딩한다.
노을(동틀녘) = "새로운 커리어가 밝아오는 순간"이라는 비주얼-카피 일치가 핵심.

오너 확정 사항 (데모 아티팩트 7차 반복으로 확정):
- 정중앙·대형 포스터 타이포 (하늘 가림 OK, 글자가 주인공)
- 스크롤 연동(스크러빙) 조립 애니메이션 — 되감기 가능
- 서브라인도 조립에 참여 (자간 조임 + 필요시 축소)
- 조립된 MONC는 창문 개구부 **안쪽**에 들어와야 함
- 스크롤 큐는 화살표만 (SCROLL 텍스트 없음)
- 모바일(375px) 우선

## 구성

`index.html`만 수정. `scroll-fx.js`·`tokens.css`는 건드리지 않는다.

### 1. 마크업 — `.hero-window-intro` 섹션 안, `.zoom-exit-pin` **밖**(형제)

핀은 스크롤 시 scale(3.2)로 확대되므로 글자를 핀 안에 넣으면 같이 확대되어 흐려진다.
오버레이는 섹션 직속 자식으로 두고 JS가 `position: fixed`로 승격한다.

```
<div class="hero-tagline" id="heroTagline">
  .ht-scrim                          ← 중앙 원형 비네트 + 하단 그라데이션 (가독성)
  .ht-inner                          ← 플라이아웃(확대+페이드) 대상 그룹
    .ht-stack
      .ht-phrase                     ← "Moment Of New Career" 글자별 span (M·O·N·C = .ht-hl 오렌지)
      .ht-target                     ← 네이티브 크기로 렌더된 "MONC" (평소 visibility:hidden)
    .ht-subko                        ← "새로운 커리어가 밝아오는 순간"
  .ht-cue                            ← 바운스 화살표 (텍스트 없음)
```

- 글자 span은 HTML에 정적으로 존재 (JS 실패 시에도 풀 문장은 보임)
- 스크린리더: `.ht-phrase`에 `aria-label`, 글자 래퍼는 `aria-hidden`

### 2. 스크롤 타임라인 (진행률 p = 창문 줌과 동일한 계산식, 독립 IIFE로 산출)

| p | 동작 |
|---|---|
| 0 | 풀 문장 + 서브라인(문장 폭 락업) + 화살표 |
| 0→6% | 화살표 페이드아웃 |
| 0→30% | 소문자 페이드아웃, M·O·N·C FLIP 이동으로 조립. 서브라인 자간 g0→g1 조임 |
| 30% | **선명도 스왑**: transform 확대 글자(래스터 흐림) → 네이티브 렌더 `.ht-target` 교체. 역스크롤 시 복귀 |
| 30→50% | 완성된 "MONC + 서브라인" 락업 유지 (창틀 페이드와 겹침) |
| 50→75% | 비네트 스크림 페이드아웃 |
| 52→78% | `.ht-inner` 확대(×1.9)+페이드 — 로고를 뚫고 지나가는 연출 |
| ≥99% | 오버레이 visibility:hidden (이후 기존 캐러셀 구간) |

### 3. 락업 수학 (데모 검증 완료)

- **시작 자간 g0**: 서브라인 잉크 폭이 문장 폭과 일치하도록 `(phraseW − natural) / (n−1)`
- **끝 자간 g1**: 조립된 MONC의 **잉크 폭**(advance 박스 − C 뒤 letter-spacing 팬텀 − M/C 사이드베어링, 캔버스 `measureText`로 측정)에 서브라인 자체 베어링을 되더한 목표 폭으로 계산. 자간 0으로도 넘치면 `scale(s1)`로 축소
- 마지막 글자 뒤 잉여 자간은 `margin-right: -g`로 보정(중앙 유지)
- MONC가 커지며 서브라인을 침범하는 만큼 `translateY(dy·u)`로 밀어냄
- 리사이즈 시 재측정, `window.load`에서 재측정(폰트 스왑 대비)

### 4. 크기 (창문 안쪽 제약)

- 문장: `clamp(34px, 7.5vw, 96px)` weight 300, M·O·N·C만 800 + `#FFB27A`
- 조립 MONC: `clamp(72px, min(17vw, 18vh), 220px)` — 개구부가 **뷰포트 높이**에 비례하므로 vh 제약이 창틀 침범을 방지
- 서브라인: `clamp(15px, 2.2vw, 22px)` weight 500

### 5. 폴백

- `prefers-reduced-motion`: 조립 없이 풀 문장+서브라인 정적 표시, `fixed` 승격 안 함(absolute 유지 — 기존 줌도 이 조건에서 꺼져 정적 레이아웃과 일치)
- JS 실패: CSS 기본 상태(absolute, 풀 문장)가 그대로 보임
- 성능: transform/opacity만 갱신(자간 애니메이션은 서브라인 한 요소만 리플로), rAF 스로틀

## 검증

- 로컬 프리뷰(`wkon-static`)에서 375px·데스크톱 각각 스크롤 구간별 스크린샷 확인
- 배포: main 푸시(= GitHub Pages 배포)

## 2026-07-10 추가 수정 (배포 후 오너 피드백 — 데모 완전 정합)

1. **하늘/구름**: 세로 패닝(130vh + JS translateY) 제거, 이미지 전체 높이(구름 포함)를 100vh로 표시. 타일 주기 780vh→600vh.
2. **정면 돌파 줌**: `data-zoom-start="0.5"`(scroll-fx.js에 attr 추가) — 전반 50%는 scale 1 정지, 후반 50%에 확대 집중. `data-zoom-scale` 3.2→2.2(최대 1+2.2=3.2배, 데모 동일). 창틀 페이드 30~55%→55~75%, 하늘 페이드 70~100%→80~100%.
3. **서서히 조립**: `data-zoom-runway` 220→340(모바일 170→300) — 조립 구간이 데모와 같은 ~72vh 스크롤로 확장.
4. **모바일 한 줄**: `fitPhrase()` — 문장이 줄바꿈되면 폰트 비율 축소(375px에서 34→30.95px). 로고 크기 `min(17vw,18vh)`→`min(16vw,18vh)`+floor 56px(375px에서 60px, 개구부 안쪽).
5. **⚠️ sticky 버그 수정(치명)**: `body { overflow-x: hidden }`이 body를 스크롤 컨테이너로 만들어 `.zoom-exit-pin` sticky가 뷰포트에 고정되지 않던 문제 → `overflow-x: clip`(hidden은 구형 폴백)으로 교체. 이 버그로 라이브에서 창문 장면이 고정되지 않고 스크롤에 밀려 올라갔음("하단으로 빠지는" 체감의 실원인).

## 참고

- 데모 아티팩트: https://claude.ai/code/artifact/3a7d128d-4ff7-4d0a-a1af-430fdf0e3dce (assemble-v7-ink-fit)
- 시안 비교 아티팩트: https://claude.ai/code/artifact/e4e2e0a8-93d6-4eea-bfe1-1bd57ae8faf8

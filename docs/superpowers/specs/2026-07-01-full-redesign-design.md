# MONC 전체 디자인 리디자인

## 배경 및 목표

MONC 랜딩 사이트(index.html + 4개 챌린지 상세페이지 + 약관/개인정보 페이지)의 전체 비주얼을 새로 잡는다. 레퍼런스는 [jeskojets.com](https://jeskojets.com/)(프라이빗 제트 차터 사이트)의 **연출 방식과 레이아웃 구조**이며, 색상/무드는 그대로 가져오지 않는다.

- **타겟**: 항공승무원 지원생(20대 초반 다수) — 럭셔리/차터 고객이 아니므로 톤은 "조용한 럭셔리"가 아니라 **밝고 동기부여되는, 깔끔하고 전문적인** 방향
- **트래픽 특성**: 모바일 유입이 메인. 스크롤 연출은 가볍게(2D transform/opacity), 무거운 3D/WebGL 연출은 배제
- **범위**: index.html, 4개 상세페이지(보신각/영합각/스피닝/승자각), 신청 모달(2곳), 약관/개인정보 페이지(톤만)

## 레퍼런스에서 차용하는 것 / 차용하지 않는 것

**차용**: 스크롤텔링 연출 방식(스크롤에 따라 텍스트/이미지가 리빌되는 구조), 초대형 타이포그래피, 미니멀한 레이아웃(얇은 헤어라인 구분선, 여백 중심 구성), 통계를 큰 숫자로 강조하는 패턴, 플로팅 알약형 CTA

**차용하지 않음**: 다크/무디한 톤, 3D 항공기 렌더 같은 무거운 비주얼, 럭셔리 정적 무드

## 1. 디자인 토큰

### 컬러 — "Warm Sunrise"

| 토큰 | 값 | 용도 |
|---|---|---|
| `--bg-base` | `#FFFAF3` | 기본 배경 (크림) |
| `--bg-alt` | `#FFF3E6` | 섹션 교차용 밝은 배경 |
| `--bg-dark` | `#241A12` | 다크 대비 섹션 배경 (웜톤 다크, `community` 섹션 한 곳에만 사용) |
| `--text-primary` | `#241A12` | 본문/제목 텍스트 |
| `--text-on-dark` | `#FFFAF3` | 다크 섹션 위 텍스트 |
| `--text-muted` | `#9A5B1E` | 라벨/eyebrow 텍스트, 보조 카피 |
| `--accent` | `#FF6B35` | 전환 CTA 전용 (기존 틸 `#0C8091`의 역할을 코랄이 이어받음) |
| `--border-hairline` | `#241A12` at 12% opacity | 얇은 구분선 |

기존 8px 스페이싱 스케일, 8/14/20/24 라운드 스케일은 유지. 히어로/스탯용 초대형 타이포 스케일을 신규 추가 (`--fs-display: clamp(40px, 9vw, 120px)` 등 유동형).

### 타이포그래피

Pretendard 단일 패밀리(가변 폰트, 100~900). 굵기 전략:
- 대형 헤드라인: 기본 **300(라이트)**, 핵심 단어 1~2개만 **700**으로 강조 — 균일한 블랙 웨이트보다 여백감 있고 정제된 인상을 주며 "깔끔·세련·전문적" 톤에 부합
- 본문: 400/500
- 라벨/eyebrow: 500, 자간 넓게

### 모션

- `IntersectionObserver` 기반 리빌: fade + 8~16px slide-up
- 스크롤 연동 요소는 `position: sticky` + 스크롤 진행률 기반 `transform`/`opacity`만 사용 (레이아웃 리플로우 없음)
- `prefers-reduced-motion` 존중 — 해당 시 트랜지션 없이 즉시 표시
- 별도의 기기 성능 감지/분기 로직은 두지 않음 (가벼운 2D 기법만 사용하므로 불필요)

## 2. 공용 스크롤 이펙트 컴포넌트 (`scroll-fx.js`)

index.html과 상세페이지 4개가 공유하는 단일 JS 모듈. 컴포넌트 3종:

1. **`reveal`** — `data-reveal` 속성이 붙은 요소가 뷰포트에 들어오면 fade + slide-up. 기본 리빌, 가장 널리 사용.
2. **`sticky-panel`** — 텍스트/이미지 블록을 `position: sticky`로 고정, 스크롤 진행률에 따라 `opacity`/`transform` 변화. `before-after` 섹션(전/후 비교와 개념적으로 맞음)과 `community`(다크 대비 섹션)에서 사용.
3. **`count-up`** — 뷰포트 진입 시 0에서 목표값까지 숫자 카운트업. 통계 카드(합격생 수, 후기 평점 등)에 사용.

세 컴포넌트 모두 `prefers-reduced-motion` 체크를 내장. `recruit.js`와 동일하게 `<script src="scroll-fx.js">` 한 줄로 공유하여, `application-modal.js`가 겪고 있는 "로직이 파일마다 따로 노는" 문제를 반복하지 않는다.

## 3. index.html 섹션별 적용

실제 섹션 순서 기준(`hero-scene` → `before-after` → `how` → `testimonials` → `challenges` → `instructors` → `community` → `categories` → `cta-section`):

| 섹션 | 처리 |
|---|---|
| `hero-scene` | 기존 4슬라이드 캐러셀 기능(오디오/영상/다이어그램) 유지, 톤·타이포만 교체 |
| `before-after` | `sticky-panel` — 스크롤에 따라 전(前) 텍스트가 흐려지고 후(後)가 선명해지는 연출 |
| `how` | `reveal`, 스텝 숫자는 라이트 300 + 강조 700 대비 |
| `testimonials` | 기존 마퀴 로직 유지, 톤만 교체. 평균 평점에 `count-up` |
| `challenges` | 카드 그리드 `reveal`, 호버 시 미세한 lift 인터랙션 |
| `instructors` | `reveal` 카드 그리드 |
| `community` | **유일한 다크 대비 섹션** (`--bg-dark` + 크림 텍스트). 합격생 수·누적 훈련시간 등 통계에 `count-up`. 전체 톤은 밝게 유지하되 임팩트 있는 순간 하나를 여기 집중 |
| `categories` | `reveal` |
| `cta-section` | 기존 틸 톤 → 코랄(`--accent`) 톤. 모바일 하단 고정바(`.mobile-cta-bar`)는 전체 폭 바 대신 플로팅 알약형 버튼으로 변경 |

## 4. 상세페이지 + 신청 모달

**공용 토큰 파일**: 신규 `tokens.css`를 만들어 index.html + 상세페이지 4개가 `<link>`로 공유. 지금처럼 각 페이지가 인라인 `:root`를 따로 들고 있으면 색상표를 5곳에 옮겨적다 오타/누락이 생기기 쉬우므로, 색상·타이포 토큰만 단일 소스로 통합한다.

**주의**: JS 로직(가격, 계좌번호, `submitApplication()`/`copyAccount()` 중복)은 이번 스코프에 포함하지 않음 — 기존 관행대로 `application-modal.js`와 index.html 인라인 모달 양쪽에 계속 반영해야 한다. 이번 변경은 **색상/타이포 토큰 공유**로 범위를 한정.

**상세페이지 4개**: 고유 콘텐츠(오디오 전/후, 유튜브 쇼츠, 다이어그램)는 유지, 배경/타이포/버튼만 새 토큰으로 교체, 히어로 영역에 `reveal` 적용.

**신청 모달(2곳)**: 배경/버튼을 코랄 CTA로, 폼 필드를 새 토큰 기준으로 교체. 로직은 변경 없음.

## 5. 약관/개인정보 페이지

`terms.html`, `privacy.html`은 톤(색상/타이포)만 새 토큰에 맞추고, 스크롤 이펙트(`scroll-fx.js`)는 적용하지 않는다.

## 6. 구현 파일 구성

- **신규**: `tokens.css`, `scroll-fx.js`
- **수정**: `index.html`, `challenge-voice.html`, `challenge-expression.html`, `challenge-spinning.html`, `challenge-answer.html`, `application-modal.js`, `terms.html`, `privacy.html`
- **미변경**: `recruit.js`, Google Apps Script 연동, `challenge-express.html`/`challenge-speech.html`(레거시/미사용, CLAUDE.md 기준 라이브 아님)

## 검증 계획

- 로컬 프리뷰 서버로 각 페이지 렌더링 확인 (`python -m http.server` / `wkon-static`)
- 모바일 뷰포트(375px 등)에서 `reveal`/`sticky-panel`/`count-up` 동작 확인
- `prefers-reduced-motion` 활성화 시 애니메이션 없이 즉시 표시되는지 확인
- 신청 모달 2곳(index.html, 상세페이지)이 시각적으로 동일하게 보이는지 확인
- 기존 기능(모집 상태 배지, 후기 로딩, 오디오 재생, YouTube 임베드) 회귀 없는지 확인

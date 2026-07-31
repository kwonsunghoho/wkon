# 기타 페이지(후기·연구진·상세 4종·오디오) — 상세 기록

> 2026-07-30 CLAUDE.md 다이어트로 이관한 기능별 상세 기록·의사결정 원장이다.
> 매 작업 공통 규칙은 CLAUDE.md 에 있고, 이 문서는 해당 기능을 고칠 때 읽는다.
> 본문 속 '위/아래 ○○ 절 참조'는 구 CLAUDE.md 기준 표현이라, 그 절은 docs/notes/ 의 다른 문서에 있을 수 있다.

## reviews.html(구 CLAUDE.md Pages 항목)

- `reviews.html` — **후기 모음(홈 '후기 더 보기' + nav '후기'의 목적지).** Supabase `reviews`(visible=true)를 매스너리 그리드 + 챌린지·기수 필터칩(데이터 존재값만 동적 생성). `select('*')`이라 분류 컬럼 미적용에도 무에러(필터바 숨김). 후기 스크린샷에 **실명 노출**(공개 카페 후기·오너 승인).

### reviews 테이블 분류 컬럼
`reviews`에 `challenge`(보신각/영합각/스피닝/승자각)·`cohort`(smallint, NULL=미상)·`reviewer_name`·`review_date`·`quote` 컬럼 (migration `20260710130000_reviews_classify.sql` + 기존 108건 백필, owner 실행). reviews.html 필터·커뮤니티 카드에 사용. admin '후기 관리'에서 수정. `quote`는 저장만(미표시).

### 커뮤니티/후기 (홈 섹션은 2026-07-29 삭제)
구 `#community`(지표 카운트업 · 롤링 배너 · 대표 후기 카드 · 라이트박스)는 홈 개편으로 삭제. **후기 소비처는 reviews.html 하나**(nav '후기'). ⚠️ **admin '홈 커뮤니티' 탭은 2026-07-30 admin 개편에서 삭제**(소비처 없는 죽은 탭 — 오너 확정). `site_config`의 `community_stats`/`community_phrases` 데이터와 admin '후기 관리'의 대표 번호(`sort_order≥1`)·한줄평(quote)은 **데이터로만 잔존** — 홈에 사회적 증거를 되살리면 그때 편집 UI를 다시 만든다(후기 관리 탭 안내문이 이 상태를 고지).

## researchers.html(구 CLAUDE.md Pages 항목)

- `researchers.html` — **연구진 소개 전용(2026-07-14 신설).** 구 `#instructors`(mi-section)를 분리. `tokens.css` + 인라인 `.mi-*` CSS·`researchers` 배열·탭 IIFE로 완전 동작. 진입: `#researchers-strip` 티저 + nav '연구진'. **연구원 이력의 소스오브트루스** — ⚠️ index의 `.ts-cred` 스트립 카드와 **별도 소스라 이력 변경 시 양쪽 동기화 필요**(아래 스트립 항목).

### 연구진 (홈 스트립·성장 리포트 목업은 2026-07-29 삭제)
구 `#researchers-strip`(포트레이트 마퀴 + rAF 물리 IIFE)과 `#member-appeal`(성장 리포트 목업 `.db-root`)은 홈 개편으로 **통째로 삭제**(`.ts-*`/`.db-*`/`.ma-*` CSS 포함). 연구진 소개는 `researchers.html` 단독 — 이력의 소스오브트루스는 **`researchers-data.js`(`window.MONC_RESEARCHERS`) 하나**(2026-07-31 `lab.html` 연구진 섹션과 공유하려고 인라인 배열에서 이관 — 페이지에 배열을 다시 복사해 넣지 말 것. 렌더러는 페이지별로 다르고 데이터만 공유).
- **⚠️ 현형빈은 챌린지를 지도하지 않는다(2026-07-24 오너 확인).** researchers.html에만 노출하고 apply.html·terms.html의 '담당 코치' 명단에는 넣지 않는다(약관상 실제 지도자 명단). '연구진 전원 = 챌린지 담당 코치'를 전제한 문구 금지.
- **카드 순서 = 직급 순**(수석 권성호·박새암 → 책임 고은지 → 선임 최보민·김유리·현형빈) — 직급이 바뀌면 자리도 같이 옮긴다. 사진 `images/instructor-<kwon|park|hyun|koh|choi|kim>.webp`(800px 폭 webp q78).

## 챌린지 상세 4종 · legacy 페이지(구 CLAUDE.md Pages 항목)

- Active detail pages (challenges.html 카드에서 링크, 신청은 `apply.html?c=<id>`로): `challenge-voice.html`(보신각), `challenge-expression.html`(영합각), `challenge-spinning.html`(스피닝), `challenge-answer.html`(승자각). ⚠️ 블라인드 퀴즈는 2026-07-30 허브(challenges.html) 하단으로 이사 — 상세엔 없다.
  - **⚠️ 상세 4종의 인라인 `<style>` 공통 블록(`*` 리셋 ~ `.footer-copy`)은 네 파일이 글자 그대로 같다** — 한 곳만 고치면 넷이 어긋난다. 고칠 땐 네 파일을 같이 바꿀 것(`@media (max-width:600px)` 블록만 페이지별로 다르다: 영합각은 오버뷰가 '한 줄 바', 나머지 셋은 3칸 그리드).
  - **2026-07-30 확정 팔레트 적용 완료(오너 "가독성 자체가 말이 안 된다 / 홈 색에 맞춰라").** 되돌리지 말 것: ① CTA = `--action` 네이비 면 + 흰 글씨(구 갈색→네이비 그라디언트) ② 마무리 `.cta-box` = `--accent`→`--accent-dark` 네이비 배경 + **흰 알약 + 네이비 글씨** 버튼 ③ 챌린저 아바타 원은 **전부 같은 네이비 단색**(구 6종 갈색·오렌지 그라디언트 — 그중 `#FF6B35→#FFB088` 은 흰 글씨 대비가 2:1 대였다) ④ BEFORE = 종이색 / AFTER = `--action-tint` ⑤ 섹션 배경 워시(구 오렌지·갈색 반투명 그라디언트) → `--bg2` 단색.
  - **활자 하한 정리(9대 원칙 1)**: 본문·설명줄 **15px**(구 13/13.5), 카드 제목 16px, 라벨·캡션 **12px 하한**(구 11px 섹션 라벨·BEFORE/AFTER 라벨, 10px 오버뷰 라벨, 11px 푸터 사업자 정보). **히어로 제목은 500**(구 300 `--fw-light` 은 한글 SUIT 에서 획이 얇아 큰 글씨가 본문보다 흐리게 읽혔다) — 강조 span 700 과의 대비로 위계는 살아 있다.
  - **스피닝 비포&애프터 카드엔 후기 인용 칸이 없다(2026-07-31).** 보신각 구조를 복사할 때 들어온 빈 `""` 자리표시자 4개를 삭제했다(오너 "올릴 내용 없으면 칸 자체를 삭제"). 스피닝 챌린저 후기 문구가 생기면 보신각 카드의 인용 블록(`--surface2` + `--action` 왼 보더) 패턴을 다시 붙인다.
- `challenge-express.html`, `challenge-speech.html` — **legacy/unused**, index 미링크. 라이브 아니니 편집 금지.

### Audio (detail pages)
`audio/`의 before/after 클립, 위치 기반 네이밍: `challenger-a-before.mp3`…(voice), `spinning-a-before.m4a`…(spinning). Windows에서 추가 시 이중 확장자 주의(`*.mp3.m4a`). **클립은 음성이라 mono ~80kbps로 최적화**(스테레오·128k+ 불필요) — 새 클립도 `-ac 1 -b:a 80k`로 맞출 것. 전·후는 동일 설정으로 인코딩해 대비를 왜곡하지 않는다.

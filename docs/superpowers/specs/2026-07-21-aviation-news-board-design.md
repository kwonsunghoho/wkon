# 항공 뉴스 게시판 + 회원 스크랩 — 설계 스펙

- 날짜: 2026-07-21
- 상태: 오너 설계 승인 완료 (구현 계획 작성 전)
- 관련: mypage.html(스크랩 카드), reviews.html(필터칩 패턴 재사용), supabase-config.js

## 1. 배경·목표

승무원 준비생이 항공산업·항공사 뉴스를 한곳에서 보고, 유용한 기사를 스크랩하면
회원 대시보드에 **항공사별·주제별로 쌓이는** 구조를 만든다.

**스크랩의 목적(오너 확정)**: 단순 북마크가 아니라 **면접 답변 재료함** — 답변에 기사
내용을 인용해 "이 회사를 이만큼 알고 있다"는 인상을 주기 위한 것. 그래서 스크랩에는
**활용 메모**(어느 답변에 어떻게 쓸지 한 줄)를 붙일 수 있고, 내 스크랩 뷰는
**항공사별 그룹핑을 우선**한다(특정 항공사 면접 준비 시 그 회사 재료만 모아 보는 흐름).

- 게시판은 **공개**(비회원 열람 가능) — 준비생 유입 장치.
- **스크랩은 회원 전용** — 비로그인 스크랩 시도 → login.html 유도(가입 전환 장치).
- 뉴스 수집은 **전자동**(운영 손 없이 돌아감). 3시간 주기(뉴스 속보성이 목적이 아니라
  아카이브 용도라 충분; cron 숫자 하나로 조정 가능).
- 소재(sojae) 답변 시스템과의 직접 연동은 **추후 단계**(이번 비범위).

## 2. 확정 결정 (오너 승인)

| 항목 | 결정 |
|---|---|
| 수집 방식 | 자동 수집 — GitHub Actions 스케줄 + 구글뉴스 RSS |
| 접근 범위 | 게시판 공개, 스크랩 회원 전용 |
| 항공사 축 | 국내 항공사 전체 (~10개사) |
| 주제 축 | 채용 중심 5분류 |
| 스크랩 UI | mypage 요약 카드 + news.html '내 스크랩' 탭 |
| 파이프라인 | A안: GitHub Actions (B안 Edge Function 기각 — 오너 배포 부담) |

### 항공사 슬러그 (고정 리스트)

`kal`(대한항공) · `asiana`(아시아나항공) · `jinair`(진에어) · `jejuair`(제주항공) ·
`twayair`(티웨이항공) · `airbusan`(에어부산) · `airseoul`(에어서울) ·
`eastarjet`(이스타항공) · `airpremia`(에어프레미아) · `aerok`(에어로케이)

### 주제 5분류 (topic 슬러그)

| 슬러그 | 표시명 | 키워드(제목 매칭) |
|---|---|---|
| `recruit` | 채용·모집 | 채용, 공채, 모집, 채용설명회, 신입, 승무원 선발 |
| `route` | 신규 취항·노선 | 취항, 노선, 증편, 재운항, 복항, 단항 |
| `biz` | 경영·실적 | 실적, 영업이익, 매출, 인수, 합병, 유상증자, 흑자, 적자 |
| `service` | 서비스·기내 | 기내, 서비스, 유니폼, 라운지, 기내식, 좌석 |
| `policy` | 정책·공항·안전 | 국토부, 공항, 안전, 사고, 규제, 지연, 결항, 항공법 |

- 항공사: 제목에서 **사명 첫 매칭** 1개(별칭 포함: 대한항공/KAL, 아시아나 등). 없으면 null.
- 주제: 키워드 규칙 첫 매칭. 미매칭 시 null → UI에선 '전체' 목록에만 노출(주제 필터에는 안 잡힘).

## 3. 데이터 모델 (마이그레이션 1개 — 오너 SQL Editor 실행)

`supabase/migrations/20260721120000_news_board.sql`

### news_articles
- `id` uuid PK default gen_random_uuid()
- `title` text not null
- `url` text not null **unique** ← 중복 수집 방지의 핵심
- `source` text — 언론사명
- `published_at` timestamptz
- `airline` text null — 위 슬러그
- `topic` text null — 위 슬러그
- `created_at` timestamptz default now()
- 인덱스: `published_at desc`, `airline`, `topic`
- RLS: **SELECT는 anon 포함 공개**. INSERT/UPDATE/DELETE 정책 없음 = service role만 가능.

### news_scraps
- `id` uuid PK
- `member_id` uuid not null → members(id) on delete cascade
- `article_id` uuid not null → news_articles(id) on delete cascade
- `note` text null — **활용 메모**("신규 취항 → 지원동기에 연결" 등, 선택 입력)
- `created_at` timestamptz default now()
- **unique(member_id, article_id)**
- RLS: 본인 것만 SELECT/INSERT/UPDATE/DELETE (`member_id = auth.uid()`). UPDATE는 메모 수정용.

### 미적용 폴백 (기존 관례)
- news.html: `news_articles` 조회 실패 감지 → "뉴스 준비 중" 안내 카드만 표시, 콘솔 에러 없이 조용히.
- mypage: `news_scraps` 조회 실패 시 스크랩 카드 자체를 숨김.
- ⚠️ `getMyProfile()` 공용 셀렉트에 아무것도 추가하지 않음(기존 major/consent 방어 원칙과 동일 — 이 기능은 members 컬럼을 건드리지 않으므로 해당 없음).

## 4. 수집기

### 파일
- `scripts/fetch-news.mjs` — Node 스크립트(외부 의존성 0, fetch + 정규식/간단 XML 파싱)
- `.github/workflows/news.yml` — 스케줄 실행

### 동작
1. 구글뉴스 RSS 검색 쿼리 실행:
   - 항공사별: `https://news.google.com/rss/search?q=<사명>&hl=ko&gl=KR&ceid=KR:ko` × 10
   - 산업 일반: `항공사 채용`, `국내 항공` 등 2~3개
2. 각 item에서 제목·링크·pubDate·source 파싱. 구글뉴스 링크 그대로 저장(클릭 시 원문 리다이렉트).
3. 제목 키워드로 airline/topic 분류(§2 규칙).
4. **중복 방어 2중**:
   - 같은 기사 재수집 → `url` unique 충돌 시 무시(`Prefer: resolution=ignore-duplicates`).
   - 같은 사건의 받아쓰기 기사(언론사만 다르고 제목 동일) → **제목 정규화**(공백·특수문자
     제거, 언론사 접미 제거) 후 기존 기사와 완전 일치하면 스킵. 제목이 다른 동일 사건
     기사는 허용(관점이 다른 기사라 준비생에게 유용).
5. `published_at`이 90일 지난 기사 delete(스크랩된 기사도 cascade로 스크랩이 사라지므로 **스크랩된 기사는 삭제 제외** — `not exists (select 1 from news_scraps ...)` 조건. REST로는 스크랩 없는 오래된 기사만 조회 후 삭제).
6. 실행 결과(수집 n건/신규 n건/삭제 n건) 콘솔 출력 → Actions 로그로 확인.

### 워크플로
- `schedule: cron '0 */3 * * *'` (3시간마다) + `workflow_dispatch`(수동 버튼)
- env: `SUPABASE_URL`(공개값 — supabase-config.js에 이미 공개된 것과 동일, 워크플로에 평문 가능하나 관례상 vars로), `SUPABASE_SERVICE_ROLE_KEY`(**GitHub Secrets — 유일한 비밀**)
- 공개 리포 60일 비활성 시 GitHub가 스케줄을 자동 중지(메일 통지, 버튼으로 재활성) — 알려진 제약, 수용.

### 오너 할 일 (1회)
1. 마이그레이션 SQL Editor 실행
2. GitHub 리포 Settings → Secrets and variables → Actions → `SUPABASE_SERVICE_ROLE_KEY` 등록

## 5. news.html (신규 공개 페이지)

- tokens.css + Noto Serif KR 링크(명조 타이틀 규칙). 375px 우선. nav·footer는 기존 서브페이지(reviews.html) 패턴.
- `supabase-config.js` 로드(익명 조회 + 로그인 감지 + 스크랩).

### 구조
1. 히어로 미니: 페이지 타이틀("항공 뉴스") + 한 줄 설명.
2. 탭: **전체 뉴스 / 내 스크랩** — '내 스크랩'은 로그인 시에만 렌더. `?tab=scraps` 딥링크(mypage에서 진입).
3. 필터 칩 2줄(reviews.html 패턴): 항공사(전체 + 데이터 존재값만), 주제(전체 + 데이터 존재값만). 두 축 AND 결합.
4. 기사 카드 리스트(최신순): 제목(2줄 클램프) · 언론사 · 상대시각("3시간 전") · 항공사 칩 · 주제 칩 · **북마크 토글 버튼**(우상단, 44px 터치 타겟).
   - 카드 본체 클릭 → 원문 새탭(`rel="noopener"`).
   - 북마크: 회원이면 즉시 insert/delete + 아이콘 토글(낙관적 업데이트, 실패 시 롤백). 비회원이면 안내 후 login.html 이동.
5. '더 보기' 버튼 — 20개씩 range 페이지네이션.
6. '내 스크랩' 탭: `news_scraps` join `news_articles`. **항공사별 그룹핑 우선** —
   항공사 섹션 헤더(예: "대한항공 4건") 아래 그 회사 기사가 모임(미분류는 '기타' 그룹,
   맨 뒤). 주제 필터 칩은 유지, 북마크 해제 시 목록에서 제거.
   - 카드마다 **활용 메모** 표시·수정: 메모 없으면 "메모 남기기" 버튼, 있으면 메모 텍스트
     (클릭 시 인라인 편집 → blur/저장 시 UPDATE). 스크랩 시점엔 메모 입력을 강요하지
     않음(북마크 한 번 누르는 흐름을 무겁게 하지 않기 위해 — 메모는 내 스크랩에서 추가).

### 디자인 규칙 준수
- 소형 텍스트 강조는 `--accent-ink`(4.5:1), 칩·링크 규칙은 tokens.css 관례.
- 활성 탭·칩은 reviews.html 활성칩 스타일과 통일.

## 6. mypage 스크랩 카드

기존 카드 스택에 `#sec-news` 카드 추가(카드 순서: 신청 내역 카드 근처, 구현 시 자연스러운 위치):
- 헤더 "내 뉴스 스크랩" + 총 개수.
- 최근 3건: 제목 1줄 + 항공사 칩. 클릭 → 원문 새탭.
- 항공사별 개수 요약 한 줄(예: "대한항공 4 · 아시아나 2 · 진에어 1").
- '전체 보기' → `news.html?tab=scraps`.
- 0건: "항공 뉴스를 스크랩하면 여기에 쌓여요" + '뉴스 보러 가기' → news.html.
- 테이블 미적용 시 카드 숨김(§3 폴백).

## 7. 내비게이션

- index.html 데스크톱 nav + 모바일 메뉴에 '뉴스' 링크 추가.
- 서브페이지(reviews·researchers·detail 4종·apply·mypage) nav에도 추가 — nav는 페이지별 하드코딩이므로 각각 수정.
- 모바일 메뉴 링크는 최근 수정한 `.mobile-menu` 스코프 규칙(6982b8b) 하에서 추가 — 버튼 아닌 일반 링크이므로 ul 안에 추가하면 끝.

## 8. 비범위 (YAGNI)

- 댓글·좋아요·조회수 없음.
- 기사 본문 저장 없음(제목+링크만 — 저작권·저장 비용 회피, 원문은 언론사에서).
- 검색창 없음(필터 칩으로 충분, 수요 확인 후).
- 소재(sojae) 답변 시스템 연동 없음 — 스크랩을 답변 초안에 붙이는 흐름은 추후 단계.
- admin 뉴스 관리 탭 없음(전자동; 오분류 정정 수요가 생기면 추후).
- 푸시·알림 없음.
- 외항사 없음(국내 10개사 확정).

## 9. 리스크·완화

| 리스크 | 완화 |
|---|---|
| 구글뉴스 RSS 포맷 변경·차단 | 파서 실패 시 해당 쿼리만 스킵하고 로그. 수집 0건이 이어지면 Actions 로그에서 확인 가능 |
| 오분류(키워드 한계) | 미분류는 null 허용으로 '전체'에만 노출 — 틀린 칩보다 무칩. 규칙은 스크립트 상수라 수정 쉬움 |
| 60일 비활성 시 스케줄 중지 | GitHub 메일 통지 → 재활성 버튼. 수용 |
| service role 키 유출 | GitHub Secrets에만 존재, 코드·로그 비노출. 리포 커밋 권한자는 오너뿐 |

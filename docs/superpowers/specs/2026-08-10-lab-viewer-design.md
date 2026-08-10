# 연구실 자료 읽기 화면(뷰어) 설계 — 2026-08-10

오너 요청: "읽기랑 다운 둘 중 선택이 아니라, 그냥 읽기로 화면에 띄우고 저장하는 기능을 따로 거기에 넣자."
2026-08-10 대화에서 아래 설계로 승인됨.

## 결정 요약

| 항목 | 결정 |
|---|---|
| 화면 형태 | 새 페이지가 아니라 **lab-shelf.html 위에 덮이는 전체 화면 뷰어**(상단 바: 제목·저장·닫기, 본문: 세로 연속 페이지) |
| PDF 그리기 | **pdf.js(pdfjs-dist legacy 빌드)를 `vendor/pdfjs/` 에 벤더링** — 외부 CDN 안 씀, 뷰어를 여는 순간에만 로드 |
| 저장 버튼 | **`delivery !== 'view'` 자료에만 노출.** 누르면 lab-file `mode:'download'` 재호출 → `location.href` (현행 받기와 동일 — 워터마크·기록·파일명 그대로) |
| 동작 변화 | '받기' 자료 클릭 시 즉시 다운로드 → **읽기 화면이 먼저 열리고 저장은 그 안에서** |
| 서버 | **lab-file 무변경** — mode:'view'/'download' 를 이미 다 지원. 재배포 없음 |
| 화면 전용 정책 | 그대로 — 서버가 view 전용의 download 를 계속 막는다(`view_only`). 뷰어는 버튼만 숨김 |

## 왜 새 페이지가 아닌가

비밀번호 입력·구매 결제·파일 고르기(상·하편)·미결 결제 재확인이 전부 lab-shelf 안의 흐름이다.
덮개 방식이면 이 흐름과 `lastPw`(방금 통과한 비밀번호)를 그대로 재사용한다. 새 페이지로 빼면
이 상태를 페이지 넘어로 옮겨야 하고, 새 페이지 규칙(og 메타·nav·inapp·scroll-keep·bfcache)이 전부 딸려온다.

## 구성 요소

- `vendor/pdfjs/` — pdfjs-dist **4.10.38 legacy** 빌드의 core(`pdf.min.mjs`)·worker(`pdf.worker.min.mjs`)·`cmaps/`·`standard_fonts/`. cmaps·standard_fonts 는 한글/비내장 글꼴 PDF 대비 — pdf.js 가 필요할 때만 낱개로 받아간다.
- `lab-viewer.js` — 모듈 스크립트. 덮개 DOM·CSS 를 스스로 만들고 `window.MONC_LAB_VIEWER = { open(opts) }` 를 노출. `open()` 은 Promise — 그리기 실패 시 reject(호출 쪽이 폴백).
- `lab-shelf.html` — openDoc 라우팅 + 뷰어 로더 + 저장 배선(아래).

## 동작 흐름

1. 자료 클릭 → **뷰어 대상 판별**: `!is_link && ext === 'pdf'`. ext 는 목록의 `row.file_ext`, 상·하편이면 파일 고르기 시트의 `files[].ext` 에서 안다. **ext 를 모르면(레거시 행) 현행 경로.**
2. 대상이면 delivery 와 무관하게 `mode:'view'` 로 lab-file 호출(비밀번호·구매·파일 고르기 분기는 현행 그대로 통과).
3. 응답 URL(서명 60초)을 뷰어에 넘겨 즉시 로드. 열람 기록 `kind:'view'` 는 서버가 이미 남긴다(환불 판정 근거 유지).
4. 저장 버튼(= `delivery !== 'view'` 일 때만) → lab-file `mode:'download'`(lastPw·fileId 동반) → `location.href`. 기록 `kind:'download'`.
5. 닫기: X 버튼·폰 뒤로가기(`pushState`+`popstate`)·Esc. 목록으로 복귀.

## 조용한 degrade(전부 현행 동작으로)

| 상황 | 동작 |
|---|---|
| PDF 아님(한글 hwp 등)·ext 미상 | 현행 그대로(받기 or 새 탭) |
| 모듈 스크립트 미지원 구형 폰 | 로더 8초 대기 후 현행 `openUrl` 폴백 |
| pdf.js 로드·파싱·렌더 실패 | `open()` reject → `direct` 플래그로 openDoc 재호출(새 서명 URL 로 현행 경로) |
| 영상(외부 링크) | 현행 그대로(유튜브) |
| 인앱(인스타·카톡) | 읽기는 정상 동작(신규 이득). 저장 클릭 시 토스트로 외부 브라우저 안내(현행 상단 배너 정책과 동일 취지) |

## 전송량 예산

pdf.js 는 **읽기 화면을 여는 순간에만** 로드(다른 페이지 영향 0). 첫 로드 후 브라우저 캐시.
구현 시 실측치를 `docs/notes/lab.md` 에 기록한다(코어+워커 gzip 전송량 목표 ≤ 1MB 안팎).

## 실측으로 확인한 전제(2026-08-10)

- GitHub Pages 는 `.mjs` 를 `text/javascript` + `access-control-allow-origin: *` 로 서빙(scripts/fetch-news.mjs 실측).
- Supabase Storage 응답에 `access-control-allow-origin: *` — pdf.js 가 서명 URL 을 교차 출처로 받을 수 있다.

## 하지 않는 것(YAGNI)

- 자체 핀치 줌 구현(1차는 폭 맞춤 + dpr≤2 선명도, 브라우저 확대에 맡김)
- 이미지·한글(hwp) 등 PDF 외 형식의 뷰어 표시
- 서버(lab-file)·admin 화면 변경, delivery 정책 변경
- 새 주소/새 HTML 페이지

## 검증 계획

- 스크래치패드 미러 + 한글 다페이지 테스트 PDF(fpdf2·AppleGothic)로 375px 실측: 렌더·저장 버튼 노출 조건·뒤로가기 닫기·폴백 경로.
- 라이브 최종 확인은 실제 자료(서명 URL·워터마크 포함)로 오너 폰에서 1회.

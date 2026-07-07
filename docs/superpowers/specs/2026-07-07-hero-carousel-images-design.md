# 히어로 캐러셀 4슬라이드 이미지 세트 — 디자인 스펙

- 날짜: 2026-07-07
- 상태: 사용자 승인 대기
- 범위: `index.html` 히어로 캐러셀(`.hs-card` 4장)의 미디어 영역만. **창문 인트로(`hero-window-intro`)는 완료된 작업으로 건드리지 않는다.**

## 배경 / 문제

- 캐러셀 4칸은 현재 `<video data-src="video/hero-*.mp4">`를 참조하지만 `video/` 폴더 자체가 없어 **웜톤 플레이스홀더 그라데이션만 표시**되는 상태.
- 챌린지 카드용 사진(`chx-*.webp`) 4장 중 voice/answer는 따뜻한 톤으로 온브랜드지만, expression/spinning은 차가운 회색 배경으로 사이트 팔레트(베이지 `#E9E4D8` / 오렌지 `#F27945` / 네이비 `#194192`)와 충돌.
- 결정: **히어로 전용 이미지 4장을 하나의 통일 세트로 AI 생성**하여 캐러셀에 적용.

## 확정된 방향 (사용자 승인)

| 항목 | 결정 |
|---|---|
| 작업 범위 | 새 세트 4장 전부 재생성 (기존 `chx-*`는 챌린지 카드에 그대로 둠) |
| 컨셉 | 면접·연습 현장 다큐 |
| 인물 | **같은 인물 1명 — 한국인 20대 여성** |
| 확보 방식 | AI 생성 |

## 공통 룩북

- **인물**: 한국인 20대 여성 지원자 1명, 4장 모두 동일 인물. 단정한 로우번 헤어, **네이비 정장 재킷 + 화이트 블라우스** (네이비 액센트 `--accent #194192`와 연결).
- **공간**: 따뜻한 우드 패널 면접실/스튜디오 (기존 `chx-voice.webp`의 룸 느낌). 4장 모두 같은 공간.
- **조명/색온도**: 부드러운 창측 골든 자연광, 웜 ~5200K. 베이지·크림·앰버 팔레트. **차가운 회색/블루 캐스트 금지.**
- **구도**: 세로 3:4 (권장 1200×1600px). 인물은 가로 중앙, 세로 상단 배치. **하단 45%는 단순한 배경으로 비운다** — 크림 오버레이 + 헤드라인 + CTA가 얹히는 텍스트존.
- **파일명**: `images/hero-voice.webp`, `images/hero-expression.webp`, `images/hero-spinning.webp`, `images/hero-answer.webp` (카드용 `chx-*`와 분리).
- **포맷**: webp, 소스 1200×1600 (데스크톱 카드 560×600 및 모바일 78vw 크롭 모두 커버).

## 슬라이드별 촬영 순간

같은 인물·같은 룸에서 "순간"만 달라진다.

| # | 챌린지 | 순간 | 포즈/표정 | 프레이밍 |
|---|---|---|---|---|
| 0 | 보신각 (목소리) | 발화 | 면접 테이블에 앉아 살짝 앞으로 기울고, 입을 벌려 또렷이 말하는 중 | 웨이스트업 |
| 1 | 영합각 (표정) | 밝은 미소 | 눈웃음까지 번지는 자연스러운 미소, 릴랙스한 어깨 | 체스트업(타이트) |
| 2 | 스피닝 (말·호흡) | 말·호흡 | 문장 중간, 차분한 오픈핸드 제스처, 안정된 호흡감 | 웨이스트업, 약한 동세 |
| 3 | 승자각 (답변) | 확신의 답변 | 또렷한 시선, 요점을 짚는 손동작, 확신 있는 표정 | 미디엄 |

## AI 생성 프롬프트

얼굴 일관성 전략: **슬라이드 0을 먼저 생성 → 그 이미지를 캐릭터 레퍼런스로 삼아 1·2·3 생성** (Midjourney `--cref <img0-url> --cw 100`, 나노바나나/Gemini는 이미지 첨부 후 "the exact same woman" 지시, DALL-E 계열은 seed 고정 + 동일 캐릭터 블록).

### 공통 캐릭터/스타일 블록 (모든 프롬프트 끝에 붙임)

```
A Korean woman in her early-to-mid 20s, neat low bun hairstyle, natural
makeup, wearing a navy blazer over a white blouse. Warm wood-paneled
interview room, soft golden window light from the left, warm color
temperature around 5200K, beige and cream tones, shallow depth of field,
professional photography, photorealistic. Vertical 3:4 composition,
subject centered horizontally in the upper half of the frame, lower 45%
of the frame is simple soft-focus background with no important detail.
No cool gray or blue color cast. No text, no watermark.
```

### 슬라이드 0 — 보신각 (발화)

```
Documentary-style photo of a job interview in progress. The candidate
sits at an interview table, leaning slightly forward, mouth open
mid-sentence, speaking clearly and confidently to interviewers who are
out of frame. Waist-up framing.
+ [공통 블록]
```

### 슬라이드 1 — 영합각 (밝은 미소)

```
Documentary-style photo of an interview practice session. Tight
chest-up portrait of the candidate breaking into a genuine warm smile
that reaches her eyes, shoulders relaxed, facing slightly off-camera.
+ [공통 블록] (+ 캐릭터 레퍼런스: 슬라이드 0)
```

### 슬라이드 2 — 스피닝 (말·호흡)

```
Documentary-style photo of a speech training session. The candidate is
mid-sentence with a calm open-hand gesture, composed posture conveying
steady breathing and controlled pace. Waist-up framing with slight
sense of motion in the hands.
+ [공통 블록] (+ 캐릭터 레퍼런스: 슬라이드 0)
```

### 슬라이드 3 — 승자각 (확신의 답변)

```
Documentary-style photo of a mock interview. Medium shot of the
candidate delivering a confident answer: clear direct gaze, one hand
making a precise point, assured expression.
+ [공통 블록] (+ 캐릭터 레퍼런스: 슬라이드 0)
```

## 코드 변경 (index.html)

1. **마크업**: 각 `.hs-media`의 `<video class="hs-video" data-src="video/hero-*.mp4" ...>` →
   `<img class="hs-img" src="images/hero-*.webp" alt="" width="1200" height="1600" loading="eager"(카드0) / "lazy"(카드1~3) decoding="async">`.
   - CSS: `.hs-img { width:100%; height:100%; object-fit:cover; object-position:center top; display:block; }` (얼굴이 상단에 오도록 `top`).
2. **JS**: `heroUpdateVideos()`의 video src 승격/`.play()` 로직 제거 또는 no-op화. `_heroReduce`(reduced-motion) 분기도 이미지에는 불필요.
3. **오버레이 튜닝**: `.hs-card-overlay`의 크림 베일 `rgba(255,243,230,.60)`은 어두운 영상 가정치 → **`.35~.40`로 낮춤**. 하단 베이지 페이드(`--bg2`→`--bg`)는 유지. 최종값은 브라우저에서 실제 이미지 얹어 보고 확정.
4. **플레이스홀더 그라데이션**(`.hs-card[data-idx] .hs-media` background)은 이미지 로드 전 폴백으로 유지.
5. 검증: 375px 모바일 우선(카드 78vw), 데스크톱 1280px. 헤드라인 `--text` 대비 4.5:1, 오렌지 CTA `--action-ink` 조합 유지 확인.

## 하지 않는 것 (YAGNI)

- 창문 인트로(`hero-window-intro`) 수정 없음.
- 챌린지 카드(`chx-*.webp`) 교체 없음 — 별도 후속 작업 후보(회색 2장 톤 불일치).
- 비디오 제작/`video/` 폴더 생성 없음. `<video>` 경로는 이미지로 대체.
- 전/후 오디오 토글(보신각·스피닝 카드)은 기존 동작 그대로.

## 성공 기준

- 4슬라이드 모두 실제 이미지가 표시되고, 4장이 같은 인물·같은 공간·같은 색온도로 한 세트로 읽힌다.
- 히어로와 사이트 팔레트(베이지/오렌지/네이비)가 톤에서 충돌하지 않는다.
- 375px·1280px에서 인물 얼굴이 잘리지 않고, 하단 텍스트/CTA 가독성이 유지된다.

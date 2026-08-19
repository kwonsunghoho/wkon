# 카카오페이 결제 채널 추가 — 설계 (2026-08-19)

> 오너 확정: 결제 7곳 전부 적용, 화면은 '섞인 방식'(신청·특강=버튼 나란히 / 충전·구매 5곳=고르는 창).
> 현행 규칙 원장은 docs/notes/apply-and-payment.md — 이 문서는 설계 시점 기록.

## 배경

- 카카오페이 가맹 심사 완료. 포트원(V2)에서 카카오페이 채널을 만들면 채널 키가 나온다(작성 시점 미발급).
- 지금은 토스페이 채널 하나가 7개 페이지(apply·lecture·mypage·ai-killer·polish·program·lab-shelf)에 각각 하드코딩돼 있다.

## 설계

1. **새 공용 파일 `pay-methods.js`** — 상점 ID + 채널 키 2개(토스·카카오)를 한 곳에 모은다.
   - `window.moncPay = { storeId, channels: { toss, kakao }, kakaoReady(), choose() }`
   - **카카오 키가 빈 문자열이면 카카오페이는 화면 어디에도 안 나온다**(기존과 동일 동작). 키만 채우면 켜진다.
   - `choose()`: 결제수단 바텀시트. 카카오 키가 없으면 시트 없이 토스 키를 즉시 돌려준다.
     닫으면 `null` — 부르는 쪽은 아무것도 하지 않는다(미결 기록·버튼 잠금 없음).
     bfcache 복귀(pageshow persisted) 시 열려 있던 시트는 null 로 닫는다.
2. **신청(apply)·특강(lecture)**: 토스페이 버튼 아래 카카오페이 버튼(노랑 `#FFEB00` + 먹색 `#191919`, 브랜드 기능색 — 팔레트 통일 대상 아님). `payWithToss()` → `payEasy(provider)` 로 일반화, 채널 키만 갈아끼운다.
3. **충전·구매 5곳(mypage·ai-killer·polish·program·lab-shelf)**: 기존 버튼 클릭 → `choose()` 시트 → 고른 채널로 기존 흐름 그대로. 시트는 버튼 잠금·미결 기록(pends.add)보다 **앞**에 온다.
4. **서버 무변경**: verify-payment·portone-webhook·cancel-payment 는 금액을 포트원+DB 로 재확인하는 구조라 채널과 무관. customData·redirectUrl·pay-pending 흐름도 전부 기존 그대로.

## 하지 않는 것

- 카카오페이 공식 로고 이미지(자산 없음 — 글자 버튼으로 시작, 오너가 파일 주면 추가)
- 결제수단별 계측 분리, 서버 함수 수정, 채널별 금액 차등

## 배포 순서

코드(카카오 키 빈 값) → 375px 렌더 확인 → 오너가 채널 키 전달 → 키 채워 main 반영 → 소액 실결제 1건 + 환불로 최종 확인.

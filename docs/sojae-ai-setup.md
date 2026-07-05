# 소재 발굴 AI 연결 — 오너 배포 가이드 (1회)

sojae.html 채팅을 진짜 AI(Claude)로 켜는 절차. **이걸 하기 전까지 채팅은 canned 폴백으로만 동작**한다
(에러 없이 돌아가지만, 답변이 미리 써둔 목록을 순환함).

## 1. Anthropic API 키 발급
1. https://console.anthropic.com 가입/로그인
2. **API Keys → Create Key** → 키 복사 (`sk-ant-...`)
3. 결제 수단 등록(사용량만큼 과금). 예상 비용: 되묻기 1회 ≈ 원화 몇 원 미만
   (Haiku 4.5 = $1/$5 per 1M tokens, Sonnet 5 = 현재 $2/$10 인트로가).

## 2. Edge Function 배포 (Supabase 콘솔)
1. https://supabase.com/dashboard → **apzwauiumhmsvrgffjis** 프로젝트
2. 왼쪽 **Edge Functions** → **Deploy a new function** (콘솔 에디터 사용)
3. 함수 이름: `sojae-chat` (정확히 이 이름 — 클라이언트가 이 이름으로 호출)
4. 에디터 내용을 전부 지우고 저장소의
   [`supabase/functions/sojae-chat/index.ts`](../supabase/functions/sojae-chat/index.ts) 내용을 붙여넣기
5. **Deploy**. ⚠️ "Verify JWT" 설정은 기본(켜짐) 그대로 둘 것 — 로그인 회원만 호출 가능해야
   API 키 남용을 막는다.

## 3. API 키 시크릿 등록
1. **Edge Functions → Secrets** (또는 Project Settings → Edge Functions)
2. **Add secret**: 이름 `ANTHROPIC_API_KEY`, 값 = 1에서 복사한 키

## 4. 확인
1. monc.ai.kr 에 **로그인** 후 마이페이지 → 오늘의 문제 → 채팅
2. 아무 답이나 보내보기:
   - ✅ 연결됨: 내 답 내용을 실제로 물고 늘어지는 되묻기가 옴
   - ❌ 미연결(폴백): 답 내용과 무관하게 정해진 질문 순서로만 진행
3. 문제 생기면: Edge Functions → `sojae-chat` → **Logs** 확인
   - `ANTHROPIC_API_KEY 미설정` → 3번 다시
   - `401` → 로그인 안 된 상태로 호출됨(정상 차단)
   - `anthropic error 401` → API 키 값이 잘못됨

## 참고
- 프롬프트 수정: 원본은 [docs/prompts/sojae-ask.md](prompts/sojae-ask.md),
  [docs/prompts/sojae-refine.md](prompts/sojae-refine.md). 실제 반영은
  `supabase/functions/sojae-chat/index.ts` 안의 상수를 고쳐 **재배포**해야 함(둘을 같이 수정).
- 모델: 되묻기 = `claude-haiku-4-5`, 다듬기 = `claude-sonnet-5`. prompt caching 적용
  (system 안정 프리픽스에 cache_control).
- 포인트 차감(추후)은 이 함수 안에 붙이는 것이 정석(클라이언트 차감 금지).

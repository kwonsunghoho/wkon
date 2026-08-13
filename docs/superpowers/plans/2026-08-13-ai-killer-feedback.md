# AI킬러 판정 피드백(만족/보통/불만족) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI킬러 결과의 지적(밑줄) 하나하나에 "만족/보통/불만족"을 한 번 탭으로 남기게 하고, admin AI킬러 탭(구 감점 사전 — 2026-08-13 개명)에서 집계를 본다. 2026-08-12 판정 전면 교체 직후, 새 판정이 어디서 헛짚는지 데이터로 확인하는 계기판이다. (문구·3단계는 2026-08-13 오너 확정 — 목업 검수 완료.)

**Architecture:** 새 테이블 `ai_killer_feedback`(회원 직접 insert + RLS)에 브라우저가 바로 쓴다 — **Edge Function 은 건드리지 않는다**(FN_VERSION 그대로, 오너 콘솔 재배포 불필요). 화면은 펼침 카드(.acc) 맨 아래 한 줄, admin 은 panel-terms 맨 위 섹션(탭 이름은 AI킬러로 개명). 마이그레이션 미적용이면 화면이 첫 오류에서 피드백 줄을 조용히 숨긴다(graceful degrade).

**Tech Stack:** 손 HTML/JS(빌드 없음) · supabase-js(`MONC.sb`) · Supabase RLS · 검증은 스크래치패드 rsync 미러 + 375px 브라우저 실측(이 레포에 테스트 시스템 없음 — CLAUDE.md '명령·검증').

## Global Constraints

- 오너가 SQL Editor 에서 실행해야 테이블이 생긴다 — **미적용 상태에서도 화면·admin 이 조용히 degrade** 해야 한다(에러·빈 화면 금지). 테이블 미생성 판정은 `PGRST205`.
- SQL 본문은 파일 경로가 아니라 **대화창에 ```sql 코드로** 오너에게 전달한다.
- 피드백은 **관리자 참고 데이터일 뿐** — 판정·감점사전·첨삭 프롬프트에 자동 반영하지 않는다(사전 오염 방지 — expression_reports 의 "[사전 등록]은 폼에 채워 줄 뿐" 원칙과 동일). ⚠️ **자동 주입 금지는 오너와 합의된 결정이다(2026-08-13)**: 만족도에는 '지적이 틀렸다'와 '쓴소리라 싫었다'가 섞여 있어, 자동 반영하면 킬러가 점점 무뎌진다. 반영 루틴은 수동 — 불만족이 몰린 갈래·사례를 정리해 보고하면 지침(KILLER_VOICE) 수정은 오너가 결정한다.
- 피드백 줄은 **새 판정 결과에서만**(probability 있는 결과) 나온다 — 구 규칙 판정 기록(배열 result)에는 묻지 않는다(검증 대상이 아니다).
- v1 은 고칠 곳(레드) 카드에만 — 살릴 곳(그린) 카드는 제외(오너가 원하면 후속).
- 디자인 원칙: 터치 44px+, 활자 12px+, 실제 `<button>`(카드 안 블록이라 인라인 span 제약 없음), 상태를 단정하지 않기(저장 성공 후에만 선택 표시).
- 문구 확정(2026-08-13 오너): 질문 "이 피드백에 만족하시나요?" / 버튼 "만족"·"보통"·"불만족"(세 개 등폭 한 줄) / 실패 시 "저장하지 못했어요 — 잠시 뒤 다시 눌러 주세요."
- 커밋 메시지·주석 한국어. dead code 금지.

## 왜 회원 직접 insert 인가 (expression_reports 와 다른 결정)

`expression_reports` 는 회원 insert 를 안 열었다 — 그 표는 감점 사전 후보라 오염이 첨삭 AI 프롬프트까지 번진다. 이 표는 **관리자 대시보드에서 끝나는 참고 데이터**라 오염 반경이 화면 하나다. 대신 세 겹으로 묶는다: ① `unique(member_id, check_id, hit_n)` — 검사 1건당 지적당 1행(재탭은 update) ② `hit_n between 1 and 10` — 서버 MAX_FINDINGS 와 동일 상한 ③ insert 정책에 **check_id 소유 검증**(남의 검사에 못 붙인다). 검사 자체가 유료(3크레딧)라 행 수는 결제로 이미 묶여 있다.

---

### Task 1: 마이그레이션 파일

**Files:**
- Create: `supabase/migrations/20260813120000_ai_killer_feedback.sql`

**Interfaces:**
- Produces: 테이블 `public.ai_killer_feedback(id, member_id, check_id, hit_n, verdict('good'|'neutral'|'bad'), quote, kind, created_at, updated_at)` + RLS(본인 select/insert/update, 관리자 전체). Task 2 의 upsert `onConflict: 'member_id,check_id,hit_n'` 가 unique 제약에 의존한다.

- [ ] **Step 1: 파일 작성** — 아래 내용 그대로.

```sql
-- =============================================================================
-- MONC AI킬러 — 판정 피드백(만족/보통/불만족) (2026-08-13)
-- =============================================================================
-- 목적: 2026-08-12 종합 판정 교체 직후, 지적(밑줄)마다 누른 만족/보통/불만족을 모아
--       새 판정이 어디서 헛짚는지 본다. admin 감점 사전 탭 하단 계기판이 읽는다.
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260703120000(members·is_admin·set_updated_at) · 20260725150000(ai_killer_checks)
--
-- ⚠️ 미적용이어도 사이트는 정상 — 화면이 첫 오류(PGRST205)에서 피드백 줄을 숨긴다.
-- ⚠️ expression_reports 와 달리 **회원 직접 insert 를 연다** — 이 표는 관리자 화면에서
--    끝나는 참고 데이터라 오염이 판정·첨삭 프롬프트로 번지지 않는다. 대신
--    unique + hit_n 상한 + 소유 검증 세 겹으로 묶는다(계획서 '왜 직접 insert' 절).
create table if not exists public.ai_killer_feedback (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members(id) on delete cascade,
  check_id   uuid not null references public.ai_killer_checks(id) on delete cascade,
  -- 지적 번호(밑줄 n). 서버 상한(MAX_FINDINGS=10)과 같다 — 상한을 올리면 여기도 올린다.
  hit_n      int  not null check (hit_n between 1 and 10),
  -- good=만족 / neutral=보통 / bad=불만족 (2026-08-13 오너 확정 3단계)
  verdict    text not null check (verdict in ('good','neutral','bad')),
  -- 조회 편의용 사본(원장은 ai_killer_checks.result 의 그 지적) — 관리자 목록이 조인 없이 읽는다.
  quote      text,
  kind       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, check_id, hit_n)
);

comment on table public.ai_killer_feedback is
  'AI킬러 지적별 만족/보통/불만족. 관리자 참고용 — 판정·프롬프트에 자동 반영되지 않는다.';

create index if not exists ai_killer_feedback_recent_idx
  on public.ai_killer_feedback (created_at desc);

drop trigger if exists trg_ai_killer_feedback_updated on public.ai_killer_feedback;
create trigger trg_ai_killer_feedback_updated before update on public.ai_killer_feedback
  for each row execute function public.set_updated_at();

alter table public.ai_killer_feedback enable row level security;

drop policy if exists aik_fb_select_own on public.ai_killer_feedback;
drop policy if exists aik_fb_insert_own on public.ai_killer_feedback;
drop policy if exists aik_fb_update_own on public.ai_killer_feedback;
drop policy if exists aik_fb_admin_all  on public.ai_killer_feedback;

create policy aik_fb_select_own on public.ai_killer_feedback
  for select to authenticated using (member_id = auth.uid());
-- 본인 검사에만 남긴다 — check_id 소유 검증이 없으면 남의 검사 id 에 행을 붙일 수 있다.
create policy aik_fb_insert_own on public.ai_killer_feedback
  for insert to authenticated with check (
    member_id = auth.uid()
    and exists (select 1 from public.ai_killer_checks c
                where c.id = check_id and c.member_id = auth.uid())
  );
-- 마음 바꾸기(만족 ↔ 보통 ↔ 불만족) — 화면 upsert 가 이 정책을 쓴다.
create policy aik_fb_update_own on public.ai_killer_feedback
  for update to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy aik_fb_admin_all on public.ai_killer_feedback
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 적용 확인 — true 1행이면 정상
-- select to_regclass('public.ai_killer_feedback') is not null as 적용됨;
```

- [ ] **Step 2: 문법 눈검사** — `create policy` 4개, `drop policy` 4개 짝, 세미콜론, `is_admin()` 스키마 접두(public.) 확인. 실행 검증은 오너 몫이라 여기서 끝.

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/20260813120000_ai_killer_feedback.sql
git commit -m "feat: AI킬러 판정 피드백 테이블 — 지적별 맞아요/아니에요(관리자 참고용)"
```

---

### Task 2: ai-killer.html — 펼침 카드에 피드백 줄

**Files:**
- Modify: `ai-killer.html` — CSS `.acc-fix b` 규칙 뒤(~345행), 상태 변수(~598행 부근), `accHtml`(~797행), `showResult`(~861행 끝부분), 진입 IIFE(~1305행), 클릭 핸들러 근처(~1240행 뒤)

**Interfaces:**
- Consumes: Task 1 의 테이블·unique 제약. 기존 `_res`(showResult 가 저장), `MONC.sb`, `esc()`, 문서 클릭 핸들러의 `.acc` 조기 return(펼침 로직과 충돌하지 않는 근거).
- Produces: `paintVote(n, verdict)`, `loadFbVotes(checkId)`, 상태 `_fbEligible`/`_uid`, body 클래스 `fb-on`(성공 시 표시 — 기본 숨김). Task 4 미러 검증이 `.acc-fb` 선택자를 쓴다.

- [ ] **Step 1: CSS 추가** — `.acc-fix b { color: var(--accent-ink); }` 규칙 바로 뒤에:

```css
    /* 피드백 줄 — 만족/보통/불만족 한 번 탭(2026-08-13 오너 확정). 새 판정(지수 있는 결과)에서만.
       표 미적용·오류면 body.fb-off 로 통째 숨긴다 — 마이그레이션 전 라이브에서도 안전. */
    .acc-fb { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border-soft); }
    .acc-fb .q { display: block; font-size: 12.5px; color: var(--text-dim); margin-bottom: 8px; }
    .acc-fb .bs { display: flex; gap: 8px; }
    .acc-fb button { flex: 1; min-width: 0; min-height: 44px; padding: 0 6px; border-radius: 999px;
      font-size: 13px; font-weight: 700; border: 1px solid var(--border); background: #fff;
      color: var(--text-muted); cursor: pointer; }
    .acc-fb button.on { border-color: var(--accent-ink); background: var(--accent-ink); color: #fff; }
    .acc-fb button:disabled { opacity: .55; cursor: default; }
    .acc-fb .fb-note { display: block; margin-top: 6px; font-size: 12px; color: var(--text-dim); }
    body.fb-off .acc-fb { display: none; }
```

- [ ] **Step 2: 상태 변수** — `let _source = 'paste';` 블록 근처에:

```js
    let _uid = null;          // 피드백 upsert 의 member_id — 진입에서 세션으로 채운다
    let _fbEligible = false;  // 피드백 줄은 새 판정(지수 있는 결과)에서만
```

진입 IIFE 의 `const session = await MONC.requireSession();` 다음 줄에 `_uid = session.user && session.user.id;` 추가.

- [ ] **Step 3: accHtml 에 줄 삽입** — 그린 분기는 그대로 두고, 일반 return 을:

```js
      // 피드백 줄(2026-08-13) — 새 판정 결과에서만. 구 기록(배열 result)은 검증 대상이 아니다.
      const fb = _fbEligible
        ? '<div class="acc-fb" data-fb="' + m.n + '"><span class="q">이 피드백에 만족하시나요?</span>'
          + '<div class="bs"><button type="button" data-v="good">만족</button>'
          + '<button type="button" data-v="neutral">보통</button>'
          + '<button type="button" data-v="bad">불만족</button></div></div>'
        : '';
      return '<div class="acc" id="acc-n-' + m.n + '">'
        + '<span class="acc-tag">' + KLABEL[m.kind] + '</span>'
        + '<div class="acc-why">' + esc(m.why) + '</div>'
        + '<div class="acc-fix"><b>이렇게</b> — ' + esc(m.fix) + '</div>' + fb + '</div>';
```

- [ ] **Step 4: showResult 연결** — `const hasP = typeof r.probability === 'number';` 바로 뒤에 `_fbEligible = hasP && !!r.id;` 추가. 함수 끝(`document.documentElement.scrollTop = 0;` 앞)에 `loadFbVotes(r.id);` 추가(await 없이 — 그리기를 막지 않는다).

- [ ] **Step 5: 저장·복원 함수 + 탭 핸들러** — 키보드 핸들러(~1250행) 아래에:

```js
    // ── 판정 피드백(2026-08-13) — 지적별 만족/보통/불만족. 표에 직접 upsert(RLS) ──
    // ⚠️ Edge Function 경유가 아니다 — 관리자 참고 데이터라 함수 재배포 없이 굴린다.
    //    표 미적용(PGRST205)·오류면 fb-off 로 줄을 통째 숨긴다(마이그레이션 전 라이브 안전).
    function paintVote(n, verdict) {
      const row = document.querySelector('.acc-fb[data-fb="' + n + '"]');
      if (!row) return;
      row.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === verdict));
    }
    async function loadFbVotes(checkId) {
      if (!_fbEligible || !checkId || document.body.classList.contains('fb-off')) return;
      try {
        const { data, error } = await MONC.sb.from('ai_killer_feedback')
          .select('hit_n, verdict').eq('check_id', checkId);
        if (error) throw error;
        (data || []).forEach((v) => paintVote(v.hit_n, v.verdict));
      } catch (_) { document.body.classList.add('fb-off'); }
    }
    document.addEventListener('click', async (e) => {
      // .acc 안이라 펼침 핸들러와 안 부딪친다 — 그쪽은 .acc 에서 조기 return 한다.
      const btn = e.target.closest('.acc-fb button');
      if (!btn || !_res || !_res.id || !_uid) return;
      const row = btn.closest('.acc-fb');
      const n = Number(row.dataset.fb);
      const verdict = btn.dataset.v;   // good | neutral | bad
      const hit = (_res.hits || []).find((h) => h.n === n);
      row.querySelectorAll('button').forEach((b) => { b.disabled = true; });  // 이중 탭 방지
      try {
        const { error } = await MONC.sb.from('ai_killer_feedback').upsert({
          member_id: _uid, check_id: _res.id, hit_n: n, verdict,
          quote: hit ? hit.quote : null, kind: hit ? hit.kind : null,
        }, { onConflict: 'member_id,check_id,hit_n' });
        if (error) throw error;
        paintVote(n, verdict);   // 성공 후에만 칠한다 — 상태를 단정하지 않기
      } catch (_) {
        let note = row.querySelector('.fb-note');
        if (!note) { note = document.createElement('span'); note.className = 'fb-note'; row.appendChild(note); }
        note.textContent = '저장하지 못했어요 — 잠시 뒤 다시 눌러 주세요.';
      } finally {
        row.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      }
    });
```

- [ ] **Step 6: 커밋**

```bash
git add ai-killer.html
git commit -m "feat: AI킬러 지적 카드에 판정 피드백(맞아요/아니에요) 한 줄"
```

---

### Task 3: admin.html — 탭을 AI킬러로 개명 + 집계 섹션(맨 위)

**Files:**
- Modify: `admin.html` — `#qfRepWrap` 닫는 `</div>`(~1728행) 뒤 마크업, 감점 사전 로더(`ai_killer_terms` CRUD, ~4526행 부근) 옆 JS

**Interfaces:**
- Consumes: Task 1 테이블(관리자 전체 select 는 `aik_fb_admin_all`), 기존 admin `esc()` 헬퍼(감점 사전 CRUD 가 쓰는 것 확인 후 동일 사용), 탭 로더 호출 지점(감점 사전 탭을 열 때 qfRep 를 불러오는 자리 — 구현 시 `loadTerms` 호출부를 grep 해 같은 자리에 건다).
- Produces: `loadKfb()` — 감점 사전 탭 로드 시 1회 호출.

- [ ] **Step 1: 마크업** — `#qfRepWrap` 닫힌 뒤에:

```html
      <!-- ── 판정 피드백(ai_killer_feedback) — 종합 판정 검증 계기판 (2026-08-13) ──
           지적(밑줄)마다 누른 맞아요/아니에요. 판정·사전·첨삭 프롬프트에 자동 반영되지 않는다 —
           지침(KILLER_VOICE)을 어디를 손볼지 사람이 보고 정하는 참고 데이터다. -->
      <div id="kfbWrap" style="margin-top:32px;">
        <h3 style="font-size:16px;font-weight:800;margin-bottom:6px;">판정 피드백 — 새 판정, 만족스러운가</h3>
        <p style="font-size:13px;color:var(--text-muted);line-height:1.6;margin-bottom:12px;">
          AI킬러 결과의 지적마다 누른 <b>만족/보통/불만족</b>이 쌓여요.
          <b>'불만족'이 몰리는 갈래</b>가 판정 지침을 손볼 자리예요.
          자동 반영은 없어요 — 만족도에는 '틀린 지적'과 '아픈 지적'이 섞여 있어서,
          지침 수정은 이 표를 보고 사람이 정해요.</p>
        <div id="kfbSummary" style="font-size:13px;line-height:1.7;margin-bottom:10px;"></div>
        <div class="round-list" id="kfbList"><div class="loading">불러오는 중…</div></div>
      </div>
```

- [ ] **Step 2: JS** — 감점 사전 CRUD 블록 옆에:

```js
    // ── 판정 피드백(ai_killer_feedback) 집계 — 종합 판정 검증 계기판 (2026-08-13) ──
    // 자동 반영 없음 — '아니에요'가 몰리는 갈래를 보고 지침(KILLER_VOICE)을 사람이 고친다.
    const KFB_LABEL = { cliche: '상투어·번역투', structure: '기계적 구조', neutral: '과도한 중립', rhythm: '리듬·인간미' };
    async function loadKfb() {
      const list = document.getElementById('kfbList'), sum = document.getElementById('kfbSummary');
      try {
        const { data, error } = await MONC.sb.from('ai_killer_feedback')
          .select('check_id, hit_n, verdict, quote, kind, created_at')
          .order('created_at', { ascending: false }).limit(300);
        if (error) throw error;
        const rows = data || [];
        if (!rows.length) {
          sum.textContent = '';
          list.innerHTML = '<div class="loading">아직 피드백이 없어요 — AI킬러 결과에서 지적을 펼치면 버튼이 보여요.</div>';
          return;
        }
        const V = { good: '만족', neutral: '보통', bad: '불만족' };
        const tot = { good: 0, neutral: 0, bad: 0 }; const byKind = {};
        rows.forEach((r) => {
          const v = V[r.verdict] ? r.verdict : 'neutral';
          tot[v]++;
          const k = r.kind || '기타';
          byKind[k] = byKind[k] || { good: 0, neutral: 0, bad: 0 };
          byKind[k][v]++;
        });
        sum.innerHTML = '최근 ' + rows.length + '건 — 만족 <b>' + tot.good + '</b> · 보통 <b>' + tot.neutral
          + '</b> · 불만족 <b style="color:#B3261E;">' + tot.bad + '</b><br>'
          + Object.keys(byKind).map((k) =>
              (KFB_LABEL[k] || k) + ' <b>' + byKind[k].good + '</b>:<b>' + byKind[k].neutral
              + '</b>:<b style="color:#B3261E;">' + byKind[k].bad + '</b>'
            ).join(' · ') + ' <span style="color:var(--text-muted);">(만족:보통:불만족)</span>';
        list.innerHTML = rows.slice(0, 60).map((r) => {
          const d = new Date(r.created_at);
          const when = (d.getMonth() + 1) + '/' + d.getDate();
          const pill = r.verdict === 'good'
            ? 'background:rgba(46,125,79,.12);color:#2E7D4F;'
            : r.verdict === 'bad'
              ? 'background:rgba(179,38,30,.1);color:#B3261E;'
              : 'background:rgba(23,42,71,.08);color:var(--text-muted);';
          return '<div class="round-item" style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;">'
            + '<span style="flex:0 0 auto;font-size:12px;font-weight:800;padding:3px 8px;border-radius:999px;'
            + pill + '">' + (V[r.verdict] || '보통') + '</span>'
            + '<span style="flex:1;min-width:180px;font-size:13px;line-height:1.6;">'
            + '<em>' + esc(r.quote || '(인용 없음)') + '</em>'
            + '<span style="color:var(--text-muted);"> — ' + (KFB_LABEL[r.kind] || r.kind || '기타') + ' · ' + when + '</span></span>'
            + '<a href="ai-killer.html?check=' + encodeURIComponent(r.check_id) + '" target="_blank" rel="noopener"'
            + ' style="flex:0 0 auto;font-size:12px;">검사 보기</a></div>';
        }).join('');
      } catch (_) {
        sum.textContent = '';
        list.innerHTML = '<div class="loading">표가 아직 없어요 — 마이그레이션(20260813120000)을 실행하면 여기 쌓여요.</div>';
      }
    }
```

호출: 감점 사전 탭 로더가 `loadTerms()`(와 qfRep 로더)를 부르는 자리를 grep 으로 찾아 `loadKfb()` 를 같은 자리에 추가. admin 에 `esc()` 가 없으면 감점 사전 목록이 쓰는 이스케이프 방식을 그대로 따른다(구현 시 확인 — 임의로 새 헬퍼를 만들지 않는다).

- [ ] **Step 3: 커밋**

```bash
git add admin.html
git commit -m "feat: admin 감점 사전 탭에 판정 피드백 집계 — 갈래별 맞아요:아니에요"
```

---

### Task 4: 검증 · 문서 · 배포

**Files:**
- Modify: `docs/superpowers/specs/2026-07-24-ai-killer-design.md`(맨 위 교체 이력에 5차 항목), `docs/notes/implementation-status.md`(마이그레이션 대기 행)
- 미러: 스크래치패드 `site/` rsync 재동기화(+ 미러 전용 sed 패치 — 커밋 금지)

**Interfaces:**
- Consumes: Task 2 의 `.acc-fb` 마크업, `fb-on` 동작. 미러의 `window.__showResult` 훅(rsync 후 다시 심는다 — 커밋본에는 없다).

- [ ] **Step 1: 미러 갱신 + 훅** — rsync 후 미러 `ai-killer.html` 에만 ① `window.__showResult = showResult` 노출 ② `fb-off` 를 켜는 줄(`classList.add('fb-off')`)을 `void 0` 으로 sed(라이브 supabase 에 표가 없어도 줄이 보이게 — **미러 한정, 커밋 금지**).

- [ ] **Step 2: 375px 실측** — `preview_start`(wkon-mirror) → localhost 탭에서 fixture(`id` 포함, probability·hits 3건·greens)로 `__showResult` 호출. 확인 항목:
  - 지적 카드 펼침 맨 아래 "이 피드백에 만족하시나요? [만족][보통][불만족]" 렌더 — 세 버튼 등폭 한 줄, 버튼 높이 ≥44px(`getBoundingClientRect`)
  - 그린 카드에는 줄이 **없음**
  - probability 없는 fixture(구 기록)에는 줄이 **없음**
  - 버튼 탭 → (미러는 비로그인이라 insert 실패) "저장하지 못했어요…" 문구, 버튼 재활성, 펼침이 닫히지 않음(포커스 모드 무간섭)
  - `fb-off` sed 를 되돌린 원본 미러에서: 렌더 직후 줄이 사라짐(미적용 라이브 안전 확인)
  - 콘솔 에러 0(잡은 오류 제외)
- [ ] **Step 3: admin 섹션 확인** — 미러에서 admin 게이트를 통과할 수 없으면(로그인 필요) 코드 대칭(qfRep 패턴)과 미적용 fallback 문구까지만 확인하고, 실동작은 마이그레이션 후 오너 계정 확인으로 넘긴다(계획서 '오너 확인 절차').
- [ ] **Step 4: 문서 갱신** — spec 문서 교체 이력에 "5차(2026-08-13): 판정 피드백(만족/보통/불만족) 신설 — ai_killer_feedback 직접 upsert(함수 무관), 새 판정 결과만, admin 감점 사전 탭 집계, 자동 반영 없음(만족도≠정확도 — 수동 반영이 오너 합의)" 추가. implementation-status 에 마이그레이션 20260813120000 **작성됨·미적용(오너 실행 대기)** 행 추가.
- [ ] **Step 5: 커밋·병합·푸시**

```bash
git add docs/superpowers/specs/2026-07-24-ai-killer-design.md docs/notes/implementation-status.md
git commit -m "docs: AI킬러 판정 피드백 5차 이력 + 마이그레이션 대기 기록"
```

레포 루트에서 `git merge --ff-only` 로 main 병합 후 push(마이그레이션 미적용에서도 화면이 스스로 숨어 라이브 안전).

- [ ] **Step 6: 오너 전달** — 대화창에 ```sql 로 마이그레이션 본문 전달 + 확인 절차: ① SQL Editor 실행 ② monc.ai.kr/ai-killer.html 강력 새로고침(관리자) → 검사 1회 → 지적 펼쳐 맞아요/아니에요 탭 ③ admin > AI킬러 탭 상단 '판정 피드백'에 그 표가 뜨는지.

---

## Self-Review 결과

- 스펙 커버리지: 수집(Task 1·2), 열람(Task 3), degrade·검증·문서(전 Task) — 빠짐 없음. 살릴 곳(그린) 피드백은 의도적 제외(Global Constraints).
- 타입 일치: upsert 컬럼(member_id, check_id, hit_n, verdict, quote, kind) = 테이블 정의 = admin select 컬럼. verdict 세 값(good/neutral/bad)은 화면 `data-v` = 마이그레이션 check 제약 = admin `V` 표가 같다. `onConflict` 세 컬럼 = unique 제약. `KFB_LABEL` 4갈래 = 서버 `CRIT_KIND` 산출값(structure/cliche/neutral/rhythm).
- 미정 항목 2건은 구현 시 grep 으로 확정(placeholder 아님 — 기존 코드를 따르라는 지시): admin 탭 로더의 `loadKfb()` 호출 지점, admin 의 esc 헬퍼 이름.

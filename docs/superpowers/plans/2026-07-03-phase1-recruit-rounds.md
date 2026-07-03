# Phase 1 — 모집일정/기수 (challenge_rounds) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 챌린지별 기수·모집일정을 Supabase `challenge_rounds` 테이블로 옮기고, 관리자 페이지에서 관리하며, `recruit.js`가 시트 대신 Supabase에서 읽게 한다.

**Architecture:** `recruit.js`의 `loadRecruitData()` 내부만 Supabase 조회로 교체하고 반환 형태(`{challenge:{start,end,round}}`)를 유지해 소비 함수(applyIndexRecruit 등)는 그대로 둔다. Supabase 실패 시 기존 RECRUIT_CSV로 폴백(안전 전환). 관리자에 탭 구조를 도입하고 "모집일정" 탭을 추가한다.

**Tech Stack:** 순수 HTML/CSS/JS, Supabase JS v2. 테스트 없음 → 브라우저 렌더링 검증(375px 우선).

**설계 문서:** `docs/superpowers/specs/2026-07-03-applications-reviews-supabase-design.md`

---

## 검증 공통

`preview_start`(wkon-static) → `preview_resize mobile` → `preview_console_logs error` → `preview_screenshot`/`preview_eval`. 관리자·회원 상태는 로그인 세션 필요 → 로그아웃 가능한 부분만 검증하고 나머지는 배포 후 사용자 확인.

---

### Task 1: `challenge_rounds` 테이블 + RLS + 초기 데이터 (Supabase 콘솔 — 사용자)

**Files:** Supabase SQL Editor (repo 밖).

- [ ] **Step 1: 테이블 + RLS 생성**

```sql
create table if not exists challenge_rounds (
  id uuid primary key default gen_random_uuid(),
  challenge text not null check (challenge in ('voice','expression','spinning','answer')),
  round int not null,
  recruit_start date not null,
  recruit_end date not null,
  program_start date,
  created_at timestamptz not null default now(),
  unique (challenge, round)
);
alter table challenge_rounds enable row level security;

-- 공개 읽기(사이트에서 모집상태 렌더)
create policy "public read rounds" on challenge_rounds
  for select using (true);

-- 관리자만 쓰기
create policy "admin write rounds" on challenge_rounds
  for all using (is_admin()) with check (is_admin());
```

- [ ] **Step 2: 현재 모집 데이터 시드 (날짜·기수는 실제 값으로 수정)**

```sql
insert into challenge_rounds (challenge, round, recruit_start, recruit_end) values
  ('voice',      1, '2026-06-01', '2026-06-28'),
  ('expression', 1, '2026-06-08', '2026-07-05'),
  ('spinning',   1, '2026-06-02', '2026-06-29'),
  ('answer',     1, '2026-06-09', '2026-07-06')
on conflict (challenge, round) do nothing;
```

- [ ] **Step 3: 검증**

SQL Editor에서 `select challenge, round, recruit_start, recruit_end from challenge_rounds order by challenge;` → 4행 반환.

---

### Task 2: 상세페이지 4곳에 Supabase 로드 추가

**Files:** Modify `challenge-voice.html`, `challenge-expression.html`, `challenge-spinning.html`, `challenge-answer.html`

- [ ] **Step 1: 각 파일에서 `<script src="recruit.js"></script>` 앞에 Supabase 로드 삽입**

각 파일의 `<script src="scroll-fx.js"></script>` 줄을 찾아, 그 **앞**에 삽입:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="supabase-config.js"></script>
```

(4개 파일 모두 동일. 결과 순서: supabase-js → supabase-config.js → scroll-fx.js → recruit.js → application-modal.js)

- [ ] **Step 2: 검증**

`preview_start` → 각 상세페이지 로드 → `preview_console_logs error` 에 `MONC`/supabase 에러 없음. (recruit.js는 아직 Supabase 안 씀 → 정상.)

- [ ] **Step 3: Commit**

```bash
git add challenge-voice.html challenge-expression.html challenge-spinning.html challenge-answer.html
git commit -m "feat(detail): 상세페이지에 Supabase 로드 추가 (recruit 전환 준비)"
```
커밋 메시지 본문 끝에:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

### Task 3: `recruit.js` — Supabase에서 모집일정 읽기

**Files:** Modify `recruit.js`

- [ ] **Step 1: `loadRecruitData()` 를 Supabase 우선 + CSV 폴백으로 교체**

`recruit.js:4-21` 의 `loadRecruitData()` 함수 전체를 아래로 교체:

```javascript
/* challenge_rounds(Supabase)에서 챌린지별 "현재 기수"를 읽어
   {challenge: {start, end, round}} 형태로 반환. 실패 시 구글 시트로 폴백. */
async function loadRecruitDataFromSupabase() {
  if (!window.MONC || !window.MONC.sb) return null;
  const { data, error } = await window.MONC.sb
    .from('challenge_rounds')
    .select('challenge, round, recruit_start, recruit_end')
    .order('recruit_end', { ascending: true });
  if (error || !data) { console.warn('[MONC 모집] Supabase 조회 실패:', error); return null; }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const byChallenge = {};
  data.forEach(r => { (byChallenge[r.challenge] = byChallenge[r.challenge] || []).push(r); });

  const out = {};
  Object.entries(byChallenge).forEach(([ch, rounds]) => {
    // 현재 기수 = recruit_end >= 오늘 중 가장 이른 것, 없으면 가장 최근(마지막) 것
    const upcoming = rounds.filter(r => new Date(r.recruit_end) >= today);
    const chosen = upcoming.length ? upcoming[0] : rounds[rounds.length - 1];
    out[ch] = { start: chosen.recruit_start, end: chosen.recruit_end, round: chosen.round };
  });
  console.log('[MONC 모집] Supabase 데이터:', out);
  return out;
}

async function loadRecruitDataFromCsv() {
  try {
    const res = await fetch(RECRUIT_CSV + '&_=' + Date.now());
    const text = await res.text();
    const rows = text.trim().split('\n').slice(1);
    const data = {};
    rows.forEach(row => {
      const cols = row.match(/(".*?"|[^,]+)(?=,|$)/g) || row.split(',');
      const clean = cols.map(s => s.trim().replace(/^"|"$/g, '').trim());
      if (clean[0]) data[clean[0]] = { start: clean[1], end: clean[2] };
    });
    console.log('[MONC 모집] 구글 시트 데이터(폴백):', data);
    return data;
  } catch (e) {
    console.warn('모집 데이터 로드 실패 (하드코딩 값 사용):', e);
    return null;
  }
}

async function loadRecruitData() {
  const sb = await loadRecruitDataFromSupabase();
  if (sb) return sb;
  return await loadRecruitDataFromCsv();  // 전환 검증 기간 폴백
}
```

- [ ] **Step 2: 챌린지별 기수를 모달용으로 노출 (`applyIndexRecruit` 내)**

`recruit.js` 의 `applyIndexRecruit()` 안, `window._challengeStatuses[id] = status;` 다음 줄에 삽입:

```javascript
    window._challengeRounds = window._challengeRounds || {};
    if (d && d.round != null) window._challengeRounds[id] = d.round;
```

- [ ] **Step 3: `loadChallengeStatuses()` 도 기수 노출**

`recruit.js` 의 `loadChallengeStatuses()` 안, `window._challengeStatuses[id] = getStatus(start, end);` 다음 줄에 삽입:

```javascript
    window._challengeRounds = window._challengeRounds || {};
    if (d && d.round != null) window._challengeRounds[id] = d.round;
```

- [ ] **Step 4: 검증 (모바일 375px)**

`preview_start` → index 로드 → `preview_console_logs error` 없음, `[MONC 모집] Supabase 데이터` 로그 확인 → 챌린지 카드 배지(모집중/예정/마감)·D-day가 시드 데이터대로 렌더되는지 `preview_screenshot`. `preview_eval` 로 `window._challengeRounds` 값 확인.

- [ ] **Step 5: Commit**

```bash
git add recruit.js
git commit -m "feat(recruit): 모집일정을 Supabase challenge_rounds에서 읽기 (CSV 폴백)"
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

### Task 4: 관리자 탭 구조 + "모집일정" 탭

**Files:** Modify `admin.html`

- [ ] **Step 1: 탭 CSS 추가**

`admin.html` 인라인 `<style>` 의 `.topbar { ... }` 규칙 다음에 삽입:

```css
    .tabs { display: flex; gap: 4px; padding: 0 22px; background: var(--surface); border-bottom: 1px solid var(--border-soft); position: sticky; top: 57px; z-index: 9; overflow-x: auto; }
    .tabbtn { border: 0; background: none; padding: 12px 16px; font-size: 14px; font-weight: 700; color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; }
    .tabbtn.active { color: var(--action); border-bottom-color: var(--action); }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    /* 모집일정 */
    .rounds-wrap { padding: 24px; max-width: 900px; }
    .round-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; align-items: end; background: var(--surface); border: 1px solid var(--border-soft); border-radius: var(--radius); padding: 16px; margin-bottom: 20px; box-shadow: var(--shadow); }
    .round-form .field label { font-size: 12px; color: var(--text-muted); }
    .round-form input, .round-form select { padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-xs); font-size: 14px; width: 100%; }
    .round-list { display: flex; flex-direction: column; gap: 8px; }
    .round-item { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; background: var(--surface); border: 1px solid var(--border-soft); border-radius: var(--radius-sm); padding: 12px 14px; }
    .round-item .ri-main { font-weight: 700; font-size: 15px; }
    .round-item .ri-sub { font-size: 13px; color: var(--text-muted); }
    .round-item .ri-del { font-size: 12px; color: var(--action-dark); background: none; border: 1px solid var(--border); border-radius: 999px; padding: 6px 12px; cursor: pointer; }
```

- [ ] **Step 2: 탭 바 + 패널 래핑 마크업**

`admin.html` 의 `<div class="loading" id="loading">확인 중…</div>` **앞**에 탭 바 삽입:

```html
  <div class="tabs" id="tabs" style="display:none;">
    <button class="tabbtn active" data-tab="members">회원 관리</button>
    <button class="tabbtn" data-tab="rounds">모집일정</button>
  </div>
```

그리고 기존 `<div class="layout" id="layout" style="display:none;">` 를 여는 태그를 아래로 교체(패널로 감쌈):

```html
  <div class="tab-panel active" id="panel-members">
  <div class="layout" id="layout" style="display:none;">
```

그리고 `id="layout"` div를 닫는 `</div>`(현재 `<div class="toast" id="toast"></div>` 바로 앞) 다음에 패널 닫기 + 모집일정 패널 추가. 즉 `<div class="toast" id="toast"></div>` **앞**에 삽입:

```html
  </div><!-- /panel-members -->

  <div class="tab-panel" id="panel-rounds">
    <div class="rounds-wrap">
      <form class="round-form" id="roundForm">
        <div class="field"><label>챌린지</label>
          <select id="rfChallenge">
            <option value="voice">보이스</option>
            <option value="expression">표현력</option>
            <option value="spinning">스피닝</option>
            <option value="answer">답변</option>
          </select></div>
        <div class="field"><label>기수</label><input id="rfRound" type="number" min="1" placeholder="예: 3"></div>
        <div class="field"><label>모집 시작</label><input id="rfStart" type="date"></div>
        <div class="field"><label>모집 마감</label><input id="rfEnd" type="date"></div>
        <div class="field"><label>프로그램 시작(선택)</label><input id="rfProgram" type="date"></div>
        <button class="btn btn-action" type="submit">추가/수정</button>
      </form>
      <div class="round-list" id="roundList"><div class="loading">불러오는 중…</div></div>
    </div>
  </div>
```

- [ ] **Step 3: 탭 전환 + 모집일정 CRUD JS**

`admin.html` 인라인 `<script>` 의 최상단 진입 IIFE `(async () => { const admin = await MONC.requireAdmin(); ... })();` 안에서 `document.getElementById('layout').style.display = 'grid';` 다음 줄에 삽입:

```javascript
      document.getElementById('tabs').style.display = 'flex';
      initTabs();
      loadRounds();
```

그리고 같은 `<script>` 의 아무 함수 정의 위치(예: 파일 끝 `})();` 직전, IIFE 밖)에 아래 함수들 추가:

```javascript
  // ── 탭 전환 ──
  function initTabs() {
    document.querySelectorAll('.tabbtn').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.tabbtn').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      document.getElementById('panel-' + b.dataset.tab).classList.add('active');
    }));
  }

  // ── 모집일정(challenge_rounds) CRUD ──
  const CH_LABEL = { voice:'보이스', expression:'표현력', spinning:'스피닝', answer:'답변' };

  async function loadRounds() {
    const listEl = document.getElementById('roundList');
    const { data, error } = await MONC.sb.from('challenge_rounds')
      .select('*').order('challenge').order('round');
    if (error) { listEl.innerHTML = '<div class="empty">불러오기 실패: ' + esc(error.message) + '</div>'; return; }
    if (!data.length) { listEl.innerHTML = '<div class="empty" style="color:var(--text-dim);padding:20px">등록된 모집일정이 없습니다.</div>'; return; }
    listEl.innerHTML = data.map(r => `
      <div class="round-item">
        <div>
          <div class="ri-main">${esc(CH_LABEL[r.challenge] || r.challenge)} ${r.round}기</div>
          <div class="ri-sub">모집 ${r.recruit_start} ~ ${r.recruit_end}${r.program_start ? ' · 시작 ' + r.program_start : ''}</div>
        </div>
        <button class="ri-del" data-id="${r.id}">삭제</button>
      </div>`).join('');
    listEl.querySelectorAll('.ri-del').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('이 기수를 삭제할까요?')) return;
      const { error } = await MONC.sb.from('challenge_rounds').delete().eq('id', b.dataset.id);
      if (error) { alert('삭제 실패: ' + error.message); return; }
      toast('삭제됨'); loadRounds();
    }));
  }

  document.getElementById('roundForm').addEventListener('submit', async e => {
    e.preventDefault();
    const row = {
      challenge: document.getElementById('rfChallenge').value,
      round: parseInt(document.getElementById('rfRound').value, 10),
      recruit_start: document.getElementById('rfStart').value,
      recruit_end: document.getElementById('rfEnd').value,
      program_start: document.getElementById('rfProgram').value || null,
    };
    if (!row.round || !row.recruit_start || !row.recruit_end) { alert('기수·모집 시작·마감을 입력하세요.'); return; }
    // (challenge, round) 유니크 → upsert
    const { error } = await MONC.sb.from('challenge_rounds')
      .upsert(row, { onConflict: 'challenge,round' });
    if (error) { alert('저장 실패: ' + error.message); return; }
    toast('저장됨');
    document.getElementById('rfRound').value = '';
    loadRounds();
  });
```

- [ ] **Step 4: 검증 (로그인 필요 — 배포 후 사용자 확인)**

관리자 로그인 후 admin.html → "모집일정" 탭 → 기수 추가/삭제가 반영되고, index 챌린지 카드 상태가 그 값대로 바뀌는지 확인. 로컬에선 세션이 없어 탭/폼 마크업 렌더만 확인 가능.

- [ ] **Step 5: Commit**

```bash
git add admin.html
git commit -m "feat(admin): 탭 구조 도입 + 모집일정(기수) 관리 탭"
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## Self-Review (작성자 확인)

- **스펙 커버리지:** challenge_rounds 테이블/RLS=Task1 / recruit.js Supabase 전환=Task3 / 상세페이지 로드=Task2 / admin 모집일정 탭=Task4. 설계의 Phase 1 항목 모두 커버.
- **플레이스홀더:** 없음(시드 날짜는 사용자가 실제 값으로 대체하는 의도된 템플릿).
- **이름 일관성:** `challenge_rounds`, `_challengeRounds`, `loadRounds`, `panel-members`/`panel-rounds`, `is_admin()`(기존 헬퍼), `esc`/`toast`(admin.html 기존 함수) — 일치.
- **의존성:** Task2(상세페이지 로드)가 Task3(recruit.js Supabase) 전에 와야 상세페이지에서 MONC 사용 가능. 순서 OK.
- **안전:** recruit.js는 Supabase 실패 시 CSV 폴백 → 전환 중 사이트 안 끊김.

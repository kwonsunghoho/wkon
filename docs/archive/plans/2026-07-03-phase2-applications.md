# Phase 2 — 신청을 Supabase로 (applications) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 신청 모달을 Apps Script/시트 대신 Supabase `applications` 테이블에 저장하고(비로그인 가능), 전화번호로 회원과 자동 연결하며, 관리자에 "신청자 현황" 탭을 추가한다.

**Architecture:** 신청 모달(2곳)의 `submitApplication()`이 `MONC.sb.from('applications').insert(...)` 를 호출한다. 선택 챌린지의 현재 기수는 Phase 1에서 노출한 `window._challengeRounds[data-recruit-id]` 에서 읽어 `challenges` jsonb에 스냅샷한다. INSERT 트리거가 전화번호로 members를 찾아 `member_id`를 자동 세팅한다. 관리자 탭에서 조회/입금·환급 토글/CSV.

**Tech Stack:** 순수 HTML/CSS/JS, Supabase JS v2. 테스트 없음 → 브라우저 렌더링 검증(375px 우선).

**설계 문서:** `docs/superpowers/specs/2026-07-03-applications-reviews-supabase-design.md`
**의존:** Phase 1(challenge_rounds, `window._challengeRounds`, 상세페이지 Supabase 로드, admin 탭 구조) 완료·배포됨.

---

### Task 1: `applications` 테이블 + RLS + 자동연결 트리거 (Supabase 콘솔 — 사용자)

**Files:** Supabase SQL Editor (repo 밖).

- [ ] **Step 1: 테이블 + RLS + 트리거 생성**

```sql
create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  phone text not null,
  refund_account text,
  challenges jsonb not null default '[]',
  total_price int,
  paid boolean not null default false,
  refunded boolean not null default false,
  member_id uuid references members(id) on delete set null,
  memo text
);
alter table applications enable row level security;

-- 누구나(비로그인 포함) 신청
create policy "anyone can apply" on applications
  for insert to anon, authenticated with check (true);
-- 관리자 전체 관리
create policy "admin manage applications" on applications
  for all using (is_admin()) with check (is_admin());
-- 회원 본인 신청 조회(마이페이지용)
create policy "member reads own applications" on applications
  for select using (member_id = auth.uid());

-- 전화번호 정규화(숫자만)
create or replace function normalize_phone(p text) returns text
  language sql immutable as $$ select regexp_replace(coalesce(p,''), '\D', '', 'g') $$;

-- 신청 INSERT 시 전화번호로 회원 자동 연결
create or replace function link_application_member() returns trigger
  language plpgsql security definer as $$
begin
  if new.member_id is null then
    select id into new.member_id from members
      where normalize_phone(phone) = normalize_phone(new.phone) limit 1;
  end if;
  return new;
end $$;
drop trigger if exists trg_link_application_member on applications;
create trigger trg_link_application_member
  before insert on applications
  for each row execute function link_application_member();

-- 회원 phone 설정/변경 시 기존 신청 백필
create or replace function backfill_member_applications() returns trigger
  language plpgsql security definer as $$
begin
  if new.phone is not null and new.phone <> '' then
    update applications set member_id = new.id
      where member_id is null
        and normalize_phone(phone) = normalize_phone(new.phone);
  end if;
  return new;
end $$;
drop trigger if exists trg_backfill_member_applications on members;
create trigger trg_backfill_member_applications
  after insert or update of phone on members
  for each row execute function backfill_member_applications();
```

- [ ] **Step 2: 검증**

SQL Editor: `insert into applications (name, phone, challenges, total_price) values ('테스트','010-1234-5678','[{"challenge":"voice","round":1,"price":30000}]', 60000);` → 에러 없이 삽입. `select id, name, phone, member_id, created_at from applications;` 로 확인 후 `delete from applications where name='테스트';` 로 정리.

---

### Task 2: 신청 모달 2곳 → Supabase insert

**Files:** Modify `index.html` (submitApplication ~3107) + `application-modal.js` (submitApplication ~329)

- [ ] **Step 1: `index.html` 의 `submitApplication()` 교체**

`index.html` 의 `async function submitApplication() { ... }` (여는 `{` 부터 닫는 `}` 까지, 대략 3107-3176) 전체를 아래로 교체:

```javascript
  async function submitApplication() {
    if (_isSubmitting) return;

    const name = document.getElementById('appName').value.trim();
    const phone = document.getElementById('appPhone').value.trim();
    const account = document.getElementById('appAccount').value.trim();

    if (!name || !phone || !account) {
      alert('이름, 전화번호, 보증금 환급 계좌를 모두 입력해주세요.');
      return;
    }
    const checkboxes = document.querySelectorAll('.challenge-checkbox:checked');
    if (checkboxes.length === 0) {
      alert('신청할 챌린지를 선택해주세요.');
      return;
    }
    if (!window.MONC || !window.MONC.sb) {
      alert('신청 모듈을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.');
      return;
    }

    _isSubmitting = true;
    const btn = document.querySelector('.modal-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '신청 중...';
    btn.style.opacity = '0.7';
    btn.style.cursor = 'not-allowed';

    // 선택 챌린지의 현재 기수 스냅샷 (Phase 1: window._challengeRounds)
    try { if (typeof loadChallengeStatuses === 'function') await loadChallengeStatuses(); } catch (e) {}
    const rounds = window._challengeRounds || {};
    const challenges = Array.from(checkboxes).map(cb => ({
      challenge: cb.dataset.recruitId,
      name: cb.dataset.name,
      round: (rounds[cb.dataset.recruitId] != null ? rounds[cb.dataset.recruitId] : null),
      price: parseInt(cb.dataset.price)
    }));
    let totalPrice = 0;
    checkboxes.forEach(cb => { totalPrice += parseInt(cb.dataset.price) + parseInt(cb.dataset.deposit); });

    try {
      const { error } = await window.MONC.sb.from('applications').insert({
        name: name, phone: phone, refund_account: account,
        challenges: challenges, total_price: totalPrice
      });
      if (error) throw error;
      alert('신청이 완료되었습니다! 확인 후 안내드리겠습니다.');
      closeApplicationModal();
      document.getElementById('appName').value = '';
      document.getElementById('appPhone').value = '';
      document.getElementById('appAccount').value = '';
      document.querySelectorAll('.challenge-checkbox').forEach(cb => cb.checked = false);
      updateTotalPrice();
    } catch (error) {
      console.error('신청 오류:', error);
      alert('오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      _isSubmitting = false;
      btn.disabled = false;
      btn.textContent = originalText;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    }
  }
```

- [ ] **Step 2: `application-modal.js` 의 `submitApplication()` 교체**

`application-modal.js` 의 `async function submitApplication() { ... }` (대략 329-386) 전체를 아래로 교체 (index 버전과 동일하되 **버튼 셀렉터만 `.app-modal-btn`**):

```javascript
async function submitApplication() {
  if (_isSubmitting) return;

  const name    = document.getElementById('appName').value.trim();
  const phone   = document.getElementById('appPhone').value.trim();
  const account = document.getElementById('appAccount').value.trim();

  if (!name || !phone || !account) {
    alert('이름, 전화번호, 보증금 환급 계좌를 모두 입력해주세요.');
    return;
  }
  const checkboxes = document.querySelectorAll('.challenge-checkbox:checked');
  if (checkboxes.length === 0) {
    alert('신청할 챌린지를 선택해주세요.');
    return;
  }
  if (!window.MONC || !window.MONC.sb) {
    alert('신청 모듈을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.');
    return;
  }

  _isSubmitting = true;
  const btn = document.querySelector('.app-modal-btn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '신청 중...';
  btn.style.opacity = '0.7';
  btn.style.cursor  = 'not-allowed';

  try { if (typeof loadChallengeStatuses === 'function') await loadChallengeStatuses(); } catch (e) {}
  const rounds = window._challengeRounds || {};
  const challenges = Array.from(checkboxes).map(cb => ({
    challenge: cb.dataset.recruitId,
    name: cb.dataset.name,
    round: (rounds[cb.dataset.recruitId] != null ? rounds[cb.dataset.recruitId] : null),
    price: parseInt(cb.dataset.price)
  }));
  let totalPrice = 0;
  checkboxes.forEach(cb => { totalPrice += parseInt(cb.dataset.price) + parseInt(cb.dataset.deposit); });

  try {
    const { error } = await window.MONC.sb.from('applications').insert({
      name: name, phone: phone, refund_account: account,
      challenges: challenges, total_price: totalPrice
    });
    if (error) throw error;
    alert('신청이 완료되었습니다! 확인 후 안내드리겠습니다.');
    closeApplicationModal();
    document.getElementById('appName').value    = '';
    document.getElementById('appPhone').value   = '';
    document.getElementById('appAccount').value = '';
    document.querySelectorAll('.challenge-checkbox').forEach(cb => cb.checked = false);
    updateTotalPrice();
  } catch (error) {
    console.error('신청 오류:', error);
    alert('오류가 발생했습니다. 다시 시도해주세요.');
  } finally {
    _isSubmitting = false;
    btn.disabled = false;
    btn.textContent = originalText;
    btn.style.opacity = '1';
    btn.style.cursor  = 'pointer';
  }
}
```

- [ ] **Step 3: 검증 (모바일 375px)**

`preview_start` → index 로드 → 신청 모달 열고(신청하기 버튼) 이름/전화/계좌 입력 + 챌린지 체크 → 신청 → "신청이 완료되었습니다" alert. `preview_console_logs error` 없음. Supabase에 행 생성됐는지 `preview_eval` 로 `MONC.sb.from('applications').select('name,phone,challenges,member_id').order('created_at',{ascending:false}).limit(1)` 확인. 상세페이지(challenge-voice.html)에서도 동일 확인. (⚠️ recruit.js/모달 JS 캐시 주의 — 필요 시 `fetch(cache:'no-store')` 로 최신 확인.) 확인 후 테스트 행 삭제.

- [ ] **Step 4: Commit**

```bash
git add index.html application-modal.js
git commit -m "feat(apply): 신청을 Supabase applications에 저장 (기수 스냅샷·자동연결)"
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

### Task 3: 관리자 "신청자 현황" 탭

**Files:** Modify `admin.html`

- [ ] **Step 1: 탭 버튼 추가**

`admin.html` 의 탭 바(`<div class="tabs" id="tabs" ...>`) 안, `<button class="tabbtn" data-tab="rounds">모집일정</button>` **다음**에 삽입:

```html
    <button class="tabbtn" data-tab="apps">신청자 현황</button>
```

- [ ] **Step 2: 신청자 현황 CSS 추가**

인라인 `<style>` 의 `.round-item .ri-del { ... }` 규칙 다음에 삽입:

```css
    .apps-wrap { padding: 20px; max-width: 900px; }
    .apps-toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
    .apps-toolbar .search { flex: 1; min-width: 160px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-xs); font-size: 14px; }
    .apps-count { font-size: 13px; color: var(--text-muted); }
    .app-card { background: var(--surface); border: 1px solid var(--border-soft); border-radius: var(--radius-sm); padding: 14px 16px; margin-bottom: 10px; box-shadow: var(--shadow); }
    .app-card .ac-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .app-card .ac-name { font-weight: 800; font-size: 16px; }
    .app-card .ac-date { font-size: 12px; color: var(--text-dim); white-space: nowrap; }
    .app-card .ac-phone { font-size: 14px; color: var(--text-muted); margin-top: 2px; }
    .app-card .ac-ch { font-size: 13px; color: var(--text); margin: 8px 0; }
    .app-card .ac-linked { font-size: 11px; font-weight: 700; color: #1a7f37; }
    .app-card .ac-unlinked { font-size: 11px; color: var(--text-dim); }
    .app-card .ac-toggles { display: flex; gap: 8px; margin-top: 8px; }
    .app-card .ac-tg { border: 1px solid var(--border); background: #fff; border-radius: 999px; padding: 8px 14px; font-size: 13px; font-weight: 700; cursor: pointer; color: var(--text-muted); }
    .app-card .ac-tg.on { background: #1a7f37; color: #fff; border-color: #1a7f37; }
    .app-card .ac-tg.on-refund { background: var(--action); color: #fff; border-color: var(--action); }
```

- [ ] **Step 3: 신청자 현황 패널 마크업 추가**

`#panel-rounds` 를 닫는 `</div>`(즉 `<div class="toast" id="toast"></div>` 바로 앞) **앞**에 삽입:

```html
  <div class="tab-panel" id="panel-apps">
    <div class="apps-wrap">
      <div class="apps-toolbar">
        <input type="text" class="search" id="appSearch" placeholder="이름·전화·챌린지 검색">
        <span class="apps-count" id="appCount"></span>
        <button class="btn btn-ghost btn-sm" id="appRefresh">새로고침</button>
        <button class="btn btn-action btn-sm" id="appCsv">CSV</button>
      </div>
      <div id="appsBody"><div class="loading">불러오는 중…</div></div>
    </div>
  </div>
```

- [ ] **Step 4: 신청자 현황 JS 추가**

(a) 진입 IIFE 의 `loadRounds();` 다음 줄에 삽입:

```javascript
      loadApplications();
```

(b) `loadRounds` 함수 정의 뒤(모듈 스코프)에 삽입:

```javascript
  // ── 신청자 현황(applications) ──
  let _apps = [];
  function fmtDate(iso) { const d = new Date(iso); return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
  function chSummary(challenges) {
    if (!Array.isArray(challenges)) return '';
    return challenges.map(c => `${CH_LABEL[c.challenge] || c.challenge || ''}${c.round ? ' ' + c.round + '기' : ''}`).join(', ');
  }

  async function loadApplications() {
    const body = document.getElementById('appsBody');
    const { data, error } = await MONC.sb.from('applications')
      .select('*').order('created_at', { ascending: false });
    if (error) { body.innerHTML = '<div class="empty">불러오기 실패: ' + esc(error.message) + '</div>'; return; }
    _apps = data || [];
    renderApps();
  }

  function renderApps() {
    const q = (document.getElementById('appSearch').value || '').trim().toLowerCase();
    const list = _apps.filter(a => !q
      || (a.name && a.name.toLowerCase().includes(q))
      || (a.phone && a.phone.includes(q))
      || chSummary(a.challenges).toLowerCase().includes(q));
    document.getElementById('appCount').textContent = `${list.length} / ${_apps.length}건`;
    const body = document.getElementById('appsBody');
    if (!list.length) { body.innerHTML = '<div class="empty" style="color:var(--text-dim);padding:24px">신청 내역이 없습니다.</div>'; return; }
    body.innerHTML = list.map(a => `
      <div class="app-card" data-id="${a.id}">
        <div class="ac-top">
          <span class="ac-name">${esc(a.name)}</span>
          <span class="ac-date">${fmtDate(a.created_at)}</span>
        </div>
        <div class="ac-phone">${esc(a.phone)} ${a.member_id ? '<span class="ac-linked">● 회원연결됨</span>' : '<span class="ac-unlinked">○ 미연결</span>'}</div>
        <div class="ac-ch">${esc(chSummary(a.challenges))} · ${(a.total_price||0).toLocaleString()}원</div>
        <div class="ac-toggles">
          <button class="ac-tg ${a.paid ? 'on' : ''}" data-field="paid">입금 ${a.paid ? '✓' : ''}</button>
          <button class="ac-tg ${a.refunded ? 'on on-refund' : ''}" data-field="refunded">환급 ${a.refunded ? '✓' : ''}</button>
        </div>
      </div>`).join('');
    body.querySelectorAll('.ac-tg').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.closest('.app-card').dataset.id;
      const field = btn.dataset.field;
      const app = _apps.find(x => x.id === id);
      const next = !app[field];
      const { error } = await MONC.sb.from('applications').update({ [field]: next }).eq('id', id);
      if (error) { alert('저장 실패: ' + error.message); return; }
      app[field] = next; renderApps(); toast('저장됨');
    }));
  }

  function appsToCsv() {
    const head = ['신청일자','이름','전화','챌린지/기수','총액','입금','환급','회원연결'];
    const rows = _apps.map(a => [
      new Date(a.created_at).toLocaleString('ko-KR'), a.name, a.phone,
      chSummary(a.challenges), a.total_price || 0, a.paid ? 'Y':'N', a.refunded ? 'Y':'N', a.member_id ? 'Y':'N'
    ]);
    const csv = [head, ...rows].map(r => r.map(c => `"${String(c==null?'':c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `신청자_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  document.getElementById('appSearch').addEventListener('input', renderApps);
  document.getElementById('appRefresh').addEventListener('click', loadApplications);
  document.getElementById('appCsv').addEventListener('click', appsToCsv);
```

- [ ] **Step 5: 검증 (관리자 로그인 필요 — 배포 후 사용자 확인)**

관리자 로그인 → admin.html → "신청자 현황" 탭 → Task 2에서 만든 테스트 신청이 보이고, 신청일자·기수·전화 표시, 입금/환급 토글 저장, CSV 다운로드, 검색 동작. 로컬(미로그인)에선 마크업 파싱만 확인.

- [ ] **Step 6: Commit**

```bash
git add admin.html
git commit -m "feat(admin): 신청자 현황 탭 (Supabase applications 조회·입금환급·CSV)"
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## Self-Review (작성자 확인)

- **스펙 커버리지:** applications 테이블/RLS/트리거=Task1 / 모달 2곳 Supabase insert=Task2 / 신청일자·기수 스냅샷=Task2(challenges) / 자동연결=Task1 트리거 / admin 신청자현황(조회·입금환급·CSV·검색)=Task3. 설계 Phase 2 항목 모두 커버.
- **플레이스홀더:** 없음.
- **이름 일관성:** 테이블 `applications`, 컬럼 `refund_account`/`total_price`/`paid`/`refunded`/`member_id`, `window._challengeRounds`(Phase 1), `CH_LABEL`/`esc`/`toast`(admin 기존), `data-recruit-id`(모달 기존). 일치.
- **의존성:** Phase 1의 `window._challengeRounds` 와 상세페이지 Supabase 로드에 의존 — 이미 배포됨. `is_admin()`·`members.phone` 기존.
- **모바일:** 신청자 카드 레이아웃(테이블 아님)으로 375px 대응.

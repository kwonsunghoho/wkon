# 회원 시스템 통합 & 디자인 다듬기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 랜딩(index)에 로그인/마이페이지 진입점과 회원 혜택 어필 섹션을 통합하고, login/mypage/admin 페이지를 모바일 퍼스트 + 10대 UI 원칙에 맞춰 다듬는다.

**Architecture:** 두 백엔드(신청=구글 시트, 결과=Supabase)를 그대로 두고 UI에서만 통합한다. index가 `supabase-config.js`를 로드해 세션을 감지하고 내비 상태를 전환한다. 회원↔신청은 전화번호로 느슨하게 연결한다.

**Tech Stack:** 순수 HTML/CSS/JS(빌드 없음), Supabase JS v2 CDN, `tokens.css`(Warm Sunrise 팔레트). 테스트 스위트 없음 → **검증은 브라우저 렌더링(375px 모바일 우선)**.

---

## 최우선 제약

- **모바일 퍼스트 (99% 모바일 유입).** 모든 태스크를 375px에서 먼저 검증한다. 데스크톱은 회귀 확인 수준.
- 터치 영역 ≥44px. 색은 Warm Sunrise(브라운 텍스트, **코랄 `--action`=CTA 전용**, 크림 배경). 명도 대비 4.5:1+.
- 10대 원칙 중 7번(하단 탭)만 제외.

## 검증 공통 방법

각 태스크의 "검증" 단계는 다음을 사용한다(테스트 프레임워크 없음):

1. `preview_start` 로 `wkon-static` 서버 실행(`.claude/launch.json` 정의됨).
2. `preview_resize` preset `mobile`(375×812)로 전환.
3. `preview_console_logs` level `error` 로 JS 에러 확인(특히 Supabase 로드).
4. `preview_snapshot` / `preview_screenshot` 로 결과 확인.

## 파일 구조

- `index.html` — Phase 1 전부(내비 CSS/마크업, 세션 감지 스크립트, 어필 섹션). 인라인 스타일/스크립트 패턴 유지.
- `supabase-config.js` — `getMyProfile` select에 `phone` 추가(Task 6).
- `mypage.html` — 연락처 입력 UI + 시각 폴리시(Phase 2).
- `login.html` — 혜택 안내 블록(Phase 3).
- `admin.html` — 모바일 레이아웃/편집기 폴리시(Phase 4).
- `CLAUDE.md` — 팔레트 문서 갱신(Task 11).
- **Supabase(콘솔에서 수행, repo 밖):** `members.phone` 컬럼 + RLS 정책(Task 5).

---

# Phase 1 — index.html 통합 (최우선)

### Task 1: Supabase 로드 + 로그아웃 상태 내비 마크업/CSS

**Files:**
- Modify: `index.html` (스크립트 로드 ~2063, 내비 CSS ~163, nav-right 1408-1410, mobile-menu-cta 1425-1427)

- [ ] **Step 1: Supabase 스크립트 로드 추가**

`index.html:2063` 의 `<script src="scroll-fx.js"></script>` **바로 앞**에 삽입:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="supabase-config.js"></script>
```

- [ ] **Step 2: 내비 버튼 CSS 추가**

`index.html:163` 의 `.nav-cta { ... }` 규칙 **바로 다음 줄**에 삽입:

```css
    /* 로그인/회원가입 아웃라인 버튼 (코랄) */
    .btn-login-outline {
      background: transparent; color: var(--action);
      border: 1.5px solid var(--action); font-weight: 700;
      padding: 10px 20px; font-size: 14px; border-radius: 999px;
      text-decoration: none; transition: background .2s;
    }
    .btn-login-outline:hover { background: var(--action-tint); }
    /* 로그인 상태: 아바타 + 마이페이지 알약 */
    .mypage-pill {
      display: inline-flex; align-items: center; gap: 8px;
      border: 1.5px solid var(--border); border-radius: 999px;
      padding: 5px 14px 5px 5px; font-size: 14px; font-weight: 700;
      color: var(--text); text-decoration: none; transition: border-color .2s;
    }
    .mypage-pill:hover { border-color: var(--action); }
    .nav-avatar {
      width: 28px; height: 28px; border-radius: 50%;
      background: var(--action); color: #fff; flex: 0 0 auto;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 700;
    }
    /* 투명 내비(히어로 위)에서 밝은 텍스트로 */
    nav.nav-transparent .btn-login-outline { color: #fff; border-color: rgba(255,255,255,.7); }
    nav.nav-transparent .btn-login-outline:hover { background: rgba(255,255,255,.15); }
    nav.nav-transparent .mypage-pill { color: #fff; border-color: rgba(255,255,255,.5); }
    /* 모바일 햄버거 메뉴 회원 카드 */
    .mm-member-card {
      display: flex; align-items: center; gap: 12px;
      padding: 16px; margin-bottom: 16px;
      background: var(--surface2); border-radius: var(--radius-sm);
      text-decoration: none;
    }
    .mm-avatar {
      width: 44px; height: 44px; border-radius: 50%;
      background: var(--action); color: #fff; flex: 0 0 auto;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 700;
    }
    .mm-member-text { font-size: 15px; color: var(--text); line-height: 1.4; }
    .mm-member-text b { font-weight: 800; }
    .mm-go { display: block; font-size: 13px; color: var(--action); font-weight: 700; margin-top: 2px; }
```

- [ ] **Step 3: 데스크톱 nav-right에 로그인 버튼 추가(로그아웃 기본 상태)**

`index.html:1408-1410` 을 아래로 교체:

```html
    <div class="nav-right">
      <a class="btn btn-login-outline nav-login" href="login.html">로그인/회원가입</a>
      <a class="btn btn-action nav-cta" href="#" onclick="openApplicationModal(); return false;">신청하기</a>
    </div>
```

- [ ] **Step 4: 모바일 메뉴에 로그인 버튼 추가(로그아웃 기본 상태)**

`index.html:1425-1427` 의 `.mobile-menu-cta` 블록을 아래로 교체:

```html
  <div class="mobile-menu-cta">
    <a class="btn btn-login-outline mm-login" href="login.html" style="width:100%; justify-content:center; text-align:center; font-size:16px; padding:16px; margin-bottom:12px; display:block;">로그인 / 회원가입</a>
    <a class="btn btn-action" href="#" onclick="openApplicationModal(); return false;" style="width:100%; justify-content:center; font-size:16px; padding:16px;">챌린지 시작하기</a>
  </div>
```

- [ ] **Step 5: 검증 (모바일 375px)**

`preview_start` → `preview_resize mobile` → `preview_screenshot`.
기대: 히어로 위에서 내비 로그인 버튼이 밝게 보이고, 햄버거 열면 "로그인/회원가입"(코랄 아웃라인) + "챌린지 시작하기"(코랄 채움)가 풀폭으로 보임. `preview_console_logs error` 에 Supabase 관련 에러 없음.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(nav): 로그인/회원가입 진입점 추가 + Supabase 로드 (로그아웃 상태)"
```

---

### Task 2: 세션 감지 → 로그인 상태 내비 전환

**Files:**
- Modify: `index.html` (인라인 스크립트, `/* ── 햄버거 ── */` 블록 근처 2246 이후)

- [ ] **Step 1: 세션 감지 스크립트 추가**

`index.html:2258` (햄버거 `mm.querySelectorAll(...)` 블록의 닫는 `}));`) **바로 다음**에 삽입:

```javascript

  /* ── 로그인 세션 → 내비 상태 반영 (로그인 시 로그인버튼→마이페이지) ── */
  (async function initAuthNav() {
    if (!window.MONC) return; // supabase-config 로드 실패 시 로그아웃 UI 유지
    function escH(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

    let session = null;
    try { session = await MONC.getSession(); } catch (e) { return; }
    if (!session) return; // 로그아웃: 기본 마크업 유지

    let profile = null;
    try { profile = await MONC.getMyProfile(); } catch (e) {}
    const name = (profile && profile.name) ? profile.name : '회원';
    const initial = (name.trim().charAt(0)) || '·';

    // 데스크톱 nav-right 교체
    const navRight = document.querySelector('.nav-right');
    if (navRight) {
      navRight.innerHTML =
        '<a class="mypage-pill" href="mypage.html"><span class="nav-avatar">' + escH(initial) +
        '</span>마이페이지</a>' +
        '<a class="btn btn-action nav-cta" href="#" onclick="openApplicationModal(); return false;">신청하기</a>';
    }

    // 모바일 메뉴: 최상단 회원 카드 삽입 + 로그인 버튼 제거
    const mmEl = document.getElementById('mobileMenu');
    if (mmEl) {
      const card = document.createElement('a');
      card.className = 'mm-member-card';
      card.href = 'mypage.html';
      card.innerHTML =
        '<span class="mm-avatar">' + escH(initial) + '</span>' +
        '<span class="mm-member-text"><b>' + escH(name) + '</b> 님' +
        '<span class="mm-go">마이페이지 가기 →</span></span>';
      mmEl.insertBefore(card, mmEl.firstElementChild);
      const loginBtn = mmEl.querySelector('.mm-login');
      if (loginBtn) loginBtn.remove();
    }
  })();
```

- [ ] **Step 2: 검증 — 로그아웃 상태**

`preview_resize mobile` → `preview_screenshot`. 로그인 안 한 상태이므로 내비는 여전히 "로그인/회원가입" 표시. `preview_console_logs error` 에러 없음.

- [ ] **Step 3: 검증 — 로그인 상태 (수동)**

로컬에서 `login.html`로 구글 로그인 후 `index.html`로 이동 → 데스크톱은 아바타+"마이페이지" 알약, 모바일 햄버거는 최상단 회원 카드(이름+"마이페이지 가기 →"), 로그인 버튼은 사라짐. (실제 세션이 필요하므로 브라우저에서 직접 확인.)

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(nav): 로그인 세션 감지해 마이페이지/회원카드로 전환"
```

---

### Task 3: 회원 혜택 어필 섹션 (마이페이지 미리보기)

**Files:**
- Modify: `index.html` (`<section class="cta-section">` 2027 직전에 섹션 삽입, CSS는 인라인 `<style>` 내)

- [ ] **Step 1: 어필 섹션 CSS 추가**

`index.html` 인라인 `<style>` 의 `.mobile-cta-bar` 규칙 앞(예: `index.html:75` 근처, 마지막 컴포넌트 CSS 뒤 아무 위치)에 삽입:

```css
    /* ── 회원 혜택 어필 (마이페이지 미리보기) ── */
    .member-appeal { padding: var(--section-y-mobile) 0; background: var(--bg2); }
    .ma-head { text-align: center; max-width: 560px; margin: 0 auto 28px; }
    .ma-title { font-size: var(--fs-h2); font-weight: 800; line-height: var(--lh-tight); letter-spacing: var(--ls-tight); color: var(--text); }
    .ma-title span { color: var(--action); }
    .ma-sub { margin-top: 12px; font-size: var(--fs-body); color: var(--text-muted); line-height: var(--lh-body); }
    .ma-preview {
      max-width: 420px; margin: 0 auto; background: var(--surface);
      border: 1px solid var(--border-soft); border-radius: var(--radius);
      box-shadow: var(--shadow); padding: 18px;
    }
    .ma-mp-head { font-weight: 800; font-size: 16px; margin-bottom: 14px; color: var(--text); }
    .ma-mp-head span { color: var(--action); }
    .ma-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin-bottom: 16px; }
    .ma-day { aspect-ratio: 1; border-radius: var(--radius-xs); display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 700; border: 1px solid var(--border-soft); color: var(--text-dim); }
    .ma-day.ok { background: #eaf6ec; border-color: #bfe3c6; color: #1a7f37; }
    .ma-day.no { background: var(--action-tint); border-color: #f2c9b8; color: var(--action-dark); }
    .ma-ba { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .ma-slot { background: var(--surface2); border-radius: var(--radius-sm); padding: 12px; }
    .ma-slot.after { outline: 2px solid var(--action); outline-offset: -2px; }
    .ma-tag { font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px; }
    .ma-slot.after .ma-tag { color: var(--action); }
    .ma-audio { height: 28px; background: #e9e4dc; border-radius: 999px; display: flex; align-items: center; padding: 0 10px; gap: 8px; }
    .ma-play { width: 14px; height: 14px; border-radius: 50%; background: var(--action); flex: 0 0 auto; }
    .ma-wave { flex: 1; height: 3px; background: #cbc2b6; border-radius: 2px; }
    .ma-cta { text-align: center; margin-top: 24px; }
    .ma-cta .btn-action { font-size: 16px; padding: 16px 28px; }
    .ma-note { margin-top: 12px; font-size: 13px; color: var(--text-dim); }
    .ma-note a { color: var(--action); font-weight: 700; }
    @media (min-width: 768px) { .member-appeal { padding: var(--section-y) 0; } }
```

- [ ] **Step 2: 어필 섹션 HTML 삽입**

`index.html:2027` 의 `<section class="cta-section">` **바로 앞**에 삽입:

```html
<!-- 회원 혜택 어필: 마이페이지 미리보기 -->
<section class="member-appeal" id="member-appeal">
  <div class="container">
    <div class="ma-head reveal">
      <h2 class="ma-title">참여하면 <span>나만의 성장 기록</span>이 생겨요</h2>
      <p class="ma-sub">2주 동안 매일 코치 피드백을 받고, 수료 후 달라진 내 목소리를 직접 비교해요.</p>
    </div>
    <div class="ma-preview reveal">
      <div class="ma-mp-head"><span>홍길동</span>님의 챌린지</div>
      <div class="ma-days">
        <div class="ma-day ok">1</div><div class="ma-day ok">2</div><div class="ma-day no">3</div><div class="ma-day ok">4</div><div class="ma-day ok">5</div><div class="ma-day ok">6</div><div class="ma-day ok">7</div>
        <div class="ma-day ok">8</div><div class="ma-day ok">9</div><div class="ma-day ok">10</div><div class="ma-day no">11</div><div class="ma-day">12</div><div class="ma-day">13</div><div class="ma-day">14</div>
      </div>
      <div class="ma-ba">
        <div class="ma-slot"><div class="ma-tag">Before · 입과 전</div><div class="ma-audio"><span class="ma-play"></span><span class="ma-wave"></span></div></div>
        <div class="ma-slot after"><div class="ma-tag">After · 수료 후</div><div class="ma-audio"><span class="ma-play"></span><span class="ma-wave"></span></div></div>
      </div>
    </div>
    <div class="ma-cta reveal">
      <a class="btn btn-action" href="#" onclick="openApplicationModal(); return false;">지금 신청하고 내 기록 시작하기</a>
      <p class="ma-note">이미 참여하셨다면 <a href="login.html">로그인</a>하면 바로 내 결과가 보여요.</p>
    </div>
  </div>
</section>
```

- [ ] **Step 3: 검증 (모바일 375px)**

`preview_resize mobile` → `#member-appeal` 로 스크롤 후 `preview_screenshot`.
기대: 헤드라인 → 마이페이지 미리보기 카드(14일 그리드 안 깨짐, Before/After 2열, After 슬롯에 코랄 아웃라인) → 코랄 CTA + 로그인 보조 링크. `reveal` 페이드인 동작.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(index): 회원 혜택 어필 섹션(마이페이지 미리보기) 추가"
```

---

# Phase 2 — mypage.html 다듬기

### Task 4: `members.phone` 컬럼 + RLS (Supabase 콘솔)

**Files:** Supabase SQL 편집기(repo 밖). 실행 후 이 태스크 체크.

- [ ] **Step 1: 기존 정책 확인**

Supabase 콘솔 → Authentication/Policies 또는 SQL:
```sql
select policyname, cmd from pg_policies where tablename = 'members';
```
"본인 행 update" 정책이 이미 있으면 Step 3의 policy 생성은 건너뛴다.

- [ ] **Step 2: 컬럼 추가**

```sql
alter table members add column if not exists phone text;
```

- [ ] **Step 3: 본인 phone 수정 허용 정책 (없을 때만)**

```sql
create policy "members update own row" on members
  for update using (auth.uid() = id) with check (auth.uid() = id);
```

- [ ] **Step 4: 검증**

SQL 편집기에서 `select id, phone from members limit 1;` 가 에러 없이 실행되면 완료.

---

### Task 5: `getMyProfile`에 phone 포함

**Files:**
- Modify: `supabase-config.js:58-64`

- [ ] **Step 1: select에 phone 추가**

`supabase-config.js:60` 의
```javascript
      .select('id, name, email, role, cohort_id')
```
를
```javascript
      .select('id, name, email, role, cohort_id, phone')
```
로 교체.

- [ ] **Step 2: 검증**

`login.html`로 로그인 → `mypage.html` 진입 시 `preview_console_logs error` 에 `phone` 관련 400/컬럼 에러 없음(Task 4 완료 후여야 함).

- [ ] **Step 3: Commit**

```bash
git add supabase-config.js
git commit -m "feat(auth): 프로필 조회에 전화번호 포함"
```

---

### Task 6: mypage 연락처 입력 UI

**Files:**
- Modify: `mypage.html` (콘텐츠 카드 영역 116 근처, 스크립트 129 이후)

- [ ] **Step 1: 연락처 카드 마크업 추가**

`mypage.html:116` 의 Before/After 카드(`</div>`로 닫히는 마지막 `.card`) **다음**, `</div>`(id=content) 앞에 삽입:

```html
      <div class="card">
        <h2>연락처</h2>
        <p class="hint">신청 내역과 결과를 연결하려면 신청 시 사용한 전화번호를 입력해 주세요.</p>
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          <input id="phoneInput" type="tel" inputmode="numeric" placeholder="010-0000-0000"
            style="flex:1; min-width:180px; padding:14px; font-size:16px; border:1px solid var(--border); border-radius:var(--radius-xs);">
          <button id="phoneSave" class="logout" style="padding:14px 20px; font-size:15px;">저장</button>
        </div>
        <div id="phoneMsg" style="font-size:13px; color:var(--text-dim); margin-top:8px; min-height:16px;"></div>
      </div>
```

- [ ] **Step 2: 연락처 저장 로직 추가**

`mypage.html:140` 의 `document.getElementById('hMeta').textContent = metaBits.join(' · ');` **다음 줄**에 삽입:

```javascript

      // 연락처(phone) 로드 + 저장
      const phoneInput = document.getElementById('phoneInput');
      const phoneMsg = document.getElementById('phoneMsg');
      if (profile && profile.phone) phoneInput.value = profile.phone;
      document.getElementById('phoneSave').addEventListener('click', async () => {
        const phone = phoneInput.value.trim();
        phoneMsg.textContent = '저장 중…';
        const { error } = await MONC.sb.from('members').update({ phone }).eq('id', me);
        phoneMsg.textContent = error ? ('저장 실패: ' + error.message) : '저장됐어요.';
      });
```

- [ ] **Step 3: 검증 (모바일 375px)**

로그인 후 `mypage.html` → `preview_resize mobile` → 연락처 카드 입력창 터치 영역 ≥44px, 저장 시 "저장됐어요." 표시, 재진입 시 값 유지.

- [ ] **Step 4: Commit**

```bash
git add mypage.html
git commit -m "feat(mypage): 전화번호 입력·저장 UI 추가 (신청 매칭용)"
```

---

### Task 7: mypage 시각 폴리시 (모바일 퍼스트)

**Files:**
- Modify: `mypage.html` (CSS 8-74, 마크업 일부)

- [ ] **Step 1: 계층·터치·하이라이트 CSS 교체**

`mypage.html:22-24` 의 `.hello`/`.meta` 규칙과 `.day`/Before-After 관련 규칙을 아래 값으로 조정:

- `.hello { ... font-size: 28px; }` → `font-size: 30px; font-weight: 800;`
- `.day { ... padding: 8px 4px; }` → `min-height: 46px; padding: 8px 4px; display:flex; flex-direction:column; align-items:center; justify-content:center;` (터치 영역 확보)
- Before/After 카드를 감정적 하이라이트로: `mypage.html:66` 의 `.ba .slot.after { ... }` 가 없다면 추가
```css
    .ba .slot.after { outline: 2px solid var(--action); outline-offset: -2px; }
```

- [ ] **Step 2: 빈 상태 문구 개선**

`mypage.html:199` 의
```javascript
          slot.innerHTML = '<div class="empty">아직 등록된 파일이 없어요.</div>';
```
를
```javascript
          slot.innerHTML = '<div class="empty">챌린지를 수료하면 여기에서 비교할 수 있어요.</div>';
```
로 교체.

- [ ] **Step 3: Before/After 카드를 진행 요약 바로 다음으로 이동(보상 강조)**

`mypage.html` 의 Before/After 카드(`<div class="card"> … Before / After …`) 블록을 잘라 "진행 요약" 카드(87-95) **다음**으로 이동. (날짜별/코멘트 카드보다 위로.)

- [ ] **Step 4: 검증 (모바일 375px)**

`preview_resize mobile` → `preview_screenshot`. 인사말이 크고 굵게, 14일 셀이 넉넉(≥44px), Before/After가 상단에 코랄 아웃라인으로 강조, 빈 상태 문구 갱신 확인.

- [ ] **Step 5: Commit**

```bash
git add mypage.html
git commit -m "style(mypage): 모바일 퍼스트 계층·터치·Before/After 강조 폴리시"
```

---

# Phase 3 — login.html 다듬기

### Task 8: 로그인 전 혜택 안내 블록

**Files:**
- Modify: `login.html` (CSS 43 근처, 마크업 50 이후)

- [ ] **Step 1: 혜택 리스트 CSS 추가**

`login.html:44` 의 `.foot a { ... }` **다음**에 삽입:

```css
    .perks { list-style: none; text-align: left; margin: 22px auto 4px; max-width: 300px; display: flex; flex-direction: column; gap: 12px; }
    .perks li { font-size: 14px; color: var(--text); display: flex; gap: 10px; align-items: flex-start; line-height: 1.5; }
    .perks li .em { font-size: 17px; flex: 0 0 auto; }
```

- [ ] **Step 2: 혜택 리스트 마크업 추가**

`login.html:50` 의 `<p class="sub">…</p>` **다음**에 삽입:

```html
    <ul class="perks">
      <li><span class="em">📈</span>2주 진행 과정을 매일 확인</li>
      <li><span class="em">🎧</span>Before/After로 달라진 내 목소리 비교</li>
      <li><span class="em">💬</span>코치의 개별 피드백 열람</li>
    </ul>
```

- [ ] **Step 3: 검증 (모바일 375px)**

`preview_start` → 로그인 페이지 `preview_resize mobile` → `preview_screenshot`. 혜택 3줄이 로그인 버튼 위에 보이고, 버튼 터치 영역 넉넉, 명도 대비 OK.

- [ ] **Step 4: Commit**

```bash
git add login.html
git commit -m "style(login): 로그인 전 회원 혜택 안내 블록 추가"
```

---

# Phase 4 — admin.html 다듬기 (우선순위 낮음)

### Task 9: admin 모바일 편집기 폴리시

**Files:**
- Modify: `admin.html` (CSS 57-69, 22-23)

- [ ] **Step 1: dirty 상태 강조 강화**

`admin.html:69` 의
```css
    .drow.dirty { background: #fffaf0; }
```
를
```css
    .drow.dirty { background: #fffaf0; box-shadow: inset 3px 0 0 var(--action); }
```
로 교체.

- [ ] **Step 2: 모바일 편집 행 터치 영역 확대**

`admin.html:60` 의 640px 미디어쿼리 `.drow` 규칙에 세그먼트/입력 높이 확보:
```css
    @media (max-width: 640px) {
      .drow { grid-template-columns: 44px 1fr; row-gap: 8px; padding: 12px 0; }
      .drow .d-comment, .drow .d-save { grid-column: 1 / -1; }
      .seg button { padding: 10px 12px; }
      .d-comment input { padding: 12px 10px; font-size: 15px; }
    }
```

- [ ] **Step 3: 검증 (모바일 375px)**

로그인(관리자) 후 `admin.html` → 회원 선택 → `preview_resize mobile` → `preview_screenshot`. 편집 행 버튼/입력이 누르기 편하고, 값 바꾸면 dirty 행에 코랄 좌측 바가 보임.

- [ ] **Step 4: Commit**

```bash
git add admin.html
git commit -m "style(admin): 모바일 편집기 터치 영역·dirty 상태 강조"
```

---

### Task 10: admin 모바일 회원 목록 ↔ 편집 전환

**Files:**
- Modify: `admin.html` (CSS 22-25, selectMember 150 근처)

- [ ] **Step 1: 모바일에서 회원 선택 시 편집 화면으로 스크롤**

`admin.html:155` 의 `detail.style.display = 'block';` **다음 줄**에 삽입:

```javascript
      if (window.matchMedia('(max-width: 820px)').matches) {
        document.querySelector('.main').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
```

- [ ] **Step 2: 검증 (모바일 375px)**

`preview_resize mobile` → 좌측(위) 회원 리스트에서 회원 탭 → 편집 영역으로 부드럽게 스크롤 이동 확인.

- [ ] **Step 3: Commit**

```bash
git add admin.html
git commit -m "feat(admin): 모바일에서 회원 선택 시 편집 화면으로 스크롤"
```

---

# 마무리

### Task 11: CLAUDE.md 팔레트 문서 갱신

**Files:**
- Modify: `CLAUDE.md` (디자인 시스템 섹션의 핑크/틸 서술)

- [ ] **Step 1: 팔레트 서술 교체**

CLAUDE.md 의 "Pink (`--primary` #D63384) is the brand color; teal (`--action` #0C8091)…" 문장을 현재 `feature/full-redesign` 실제와 맞게 수정:

```markdown
- **`feature/full-redesign` 브랜치는 Warm Sunrise 팔레트(`tokens.css`)를 사용한다:** 브라운 텍스트(`--primary #241A12`), 크림 배경(`--bg #FFFAF3`), **코랄(`--action #C9471E`)은 전환 CTA 전용**. 코랄이면 "신청/시작/참여"를 뜻한다. 장식용으로 쓰지 말 것. (main의 구 핑크/틸 서술은 이 브랜치에 적용되지 않음.)
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md 팔레트 서술을 Warm Sunrise로 갱신"
```

---

## Self-Review 결과 (작성자 확인)

- **스펙 커버리지:** 아키텍처(전화번호 연결)=Task 4·5·6 / index 내비 B안=Task 1·2 / 모바일 메뉴=Task 1·2 / 어필 섹션 A안=Task 3 / mypage 폴리시=Task 7 / login 폴리시=Task 8 / admin 폴리시=Task 9·10 / CLAUDE.md 갱신=Task 11. 누락 없음.
- **플레이스홀더:** 없음(모든 코드 블록 실코드).
- **타입/이름 일관성:** `.btn-login-outline`, `.mm-login`, `.mm-member-card`, `.mypage-pill`, `.nav-avatar`, `phoneInput/phoneSave/phoneMsg`, `.member-appeal/.ma-*` — 태스크 간 이름 일치 확인.
- **모바일 퍼스트:** 모든 검증이 375px 우선.

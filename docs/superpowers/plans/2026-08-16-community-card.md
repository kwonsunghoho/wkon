# 커뮤니티 모집 카드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카카오톡 오픈채팅 모집 카드를 서가·뉴스·도구 허브 3곳에 싣고, 입장 주소·참여코드는 로그인 회원만 받게 한다.

**Architecture:** 공용 `community-card.js` 하나가 카드 렌더·회원 게이트·펼침을 전담하고, 세 페이지는 마운트 한 줄 + 스크립트 태그만 싣는다. 주소·코드는 새 표 `community_config`(RLS: authenticated 전용)에만 있다.

**Tech Stack:** 손 HTML/JS(빌드 없음) + Supabase(supabase-js v2, `MONC` 전역).

**Spec:** `docs/superpowers/specs/2026-08-16-community-card-design.md`

## Global Constraints

- ⚠️ **오픈챗 주소·참여코드는 레포 어디에도 쓰지 않는다**(HTML·JS·마이그레이션·문서·커밋 메시지). 값 insert SQL 은 대화창으로만 전달.
- 이 레포에 lint/build/테스트 시스템 없음 — 검증은 **브라우저 실측(375px 우선, 320px 넘침 0)** 뿐. 존재하지 않는 명령 금지.
- 조회는 `select('*')`(컬럼 나열 금지), 표 미생성 판정은 **PGRST205**, 실패는 조용히 degrade(콘솔 에러 노출 금지).
- 계측 이벤트명은 `^[a-z][a-z0-9_]{2,63}$` 규칙(page_events CHECK) — `community_card_click` 사용.
- 활자 12px+, 터치 44px+, 새 색 금지(카카오 노랑 #FEE500 은 기존 `.kakao-ask` 와 같은 기능색 취급).
- `community-card.js` 수정 시 세 페이지의 `?v=` 동반 상향.
- 커밋 메시지 한국어. **main 병합·푸시는 마지막에 오너 확인 후**(마이그레이션이 낀 작업 — 브랜치 규칙).
- 마이그레이션은 오너가 콘솔에서 실행해야 반영된다 — 미적용 상태에서도 화면이 깨지면 안 된다.

---

### Task 1: 마이그레이션 파일 + 적용 현황 기록

**Files:**
- Create: `supabase/migrations/20260816120000_community_config.sql`
- Modify: `docs/notes/implementation-status.md` (마이그레이션 대기 목록에 한 줄)

**Interfaces:**
- Produces: 표 `public.community_config(key text pk, value jsonb, updated_at)` — Task 2 가 `key='open_chat'`, `value={"url":…,"code":…}` 형태로 읽는다.

- [ ] **Step 1: 마이그레이션 파일 작성** — 값 insert 없음(구조·RLS만). `site_config` 마이그레이션(20260710120000)과 같은 골격.

```sql
-- 커뮤니티 오픈채팅 설정 저장소 (2026-08-16)
--   오픈채팅 입장 주소·참여코드를 **로그인 회원에게만** 내려주는 표.
--   ⚠️ 값(insert)은 이 파일에 없다 — 레포가 공개라 주소를 커밋하면 게이트가 무의미해진다.
--     실제 값은 오너가 대화창으로 받은 SQL 을 콘솔에서 실행해 넣는다.
--   기존 site_config 를 안 쓰는 이유: select 정책이 anon 포함 전체 허용이라 비회원도 읽는다.
--   is_admin() / set_updated_at() 은 기존 마이그레이션(20260703120000)에서 생성됨. 재사용.
--   ⚠️ 이 파일은 오너가 Supabase SQL Editor 에서 직접 실행해야 적용된다.
--     (미적용 상태에서도 카드는 "아직 준비 중" 안내로 조용히 동작 — PGRST205 degrade)

create table if not exists public.community_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_community_config_updated on public.community_config;
create trigger trg_community_config_updated before update on public.community_config
  for each row execute function public.set_updated_at();

alter table public.community_config enable row level security;

drop policy if exists community_config_select_members on public.community_config;
drop policy if exists community_config_admin_all      on public.community_config;

-- ⚠️ anon 정책 없음 — 비로그인은 0건. '회원 전용'이 이 표의 존재 이유다. anon select 를 열지 말 것.
create policy community_config_select_members on public.community_config
  for select to authenticated using (true);
create policy community_config_admin_all on public.community_config
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

comment on table public.community_config is
  '커뮤니티 오픈채팅 설정(open_chat: {url, code}). 읽기는 로그인 회원만, 쓰기는 관리자만. 값은 콘솔에서 직접 insert — 레포 커밋 금지.';

-- 적용 확인
-- 1) 비회원 차단: anon apikey 로 GET /rest/v1/community_config?select=* → [] (0건)
-- 2) 회원 열람: 값 insert 후 라이브 카드에서 '입장' → 코드·링크 펼침 확인
```

- [ ] **Step 2: `docs/notes/implementation-status.md` 에 대기 항목 추가** — 기존 문서 형식을 보고 같은 꼴로 한 줄: `20260816120000_community_config.sql — 미적용(오너 콘솔 실행 필요). 적용 전에도 카드는 '준비 중' 안내로 동작.` 값 insert SQL 은 별도(대화창 전달)라는 말도 붙인다.

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/20260816120000_community_config.sql docs/notes/implementation-status.md
git commit -m "feat: community_config 표 — 오픈챗 주소·코드 회원 전용 저장소(값은 콘솔 insert)"
```

---

### Task 2: 공용 `community-card.js`

**Files:**
- Create: `community-card.js`

**Interfaces:**
- Consumes: `window.MONC`(`supabase-config.js` — `MONC.getSession()`, `MONC.sb`), 표 `community_config`(Task 1).
- Produces: 페이지가 쓰는 계약 — 본문에 `<div data-community-card></div>` 를 두고 `<script src="community-card.js?v=1" defer></script>` 를 실으면 카드가 그려진다(Task 3 이 사용).

- [ ] **Step 1: 파일 작성** — 아래 전체를 그대로 만든다.

```js
/* =============================================================================
   커뮤니티 오픈채팅 모집 카드 — lab-shelf·news·tools 3곳 공용 (2026-08-16)
   -----------------------------------------------------------------------------
   - 쓰는 법: 본문에 <div data-community-card></div> + 이 파일 로드(supabase-config 뒤).
   - ⚠️ 입장 주소·참여코드는 이 파일에도, 레포 어디에도 없다(공개 레포).
     로그인 회원만 community_config(RLS: authenticated 전용)에서 받는다.
   - 비회원 클릭 → login.html?returnTo=<현재>. 회원 클릭 → 코드+입장 링크 펼침.
   - 표 미생성(PGRST205)·조회 실패·행 없음 → "아직 준비 중" 한 줄로 조용히 degrade.
   - bfcache: lab-shelf 는 통째 reload 예외 페이지라(결제 복귀 — CLAUDE.md)
     pageshow(persisted)에서 카드를 초기 상태로 되돌린다 — 공용 기기에서
     로그아웃 뒤 뒤로가기로 남의 참여코드가 되살아나는 것 방지.
   - 파일을 고치면 세 페이지의 ?v= 도 같이 올린다.
   - 설계: docs/superpowers/specs/2026-08-16-community-card-design.md
   ============================================================================= */
(function () {
  'use strict';
  var mount = document.querySelector('[data-community-card]');
  if (!mount) return;

  var css = ''
    + '.cmc-wrap{max-width:720px;margin:36px auto 8px;padding:0 20px}'
    + '.cmc{display:flex;align-items:center;gap:12px;background:#fff;'
    +   'border:1px solid var(--border-soft,rgba(23,42,71,.12));border-radius:14px;'
    +   'box-shadow:var(--shadow,0 4px 20px rgba(20,32,52,.10));padding:14px;letter-spacing:-.015em}'
    + '.cmc-ico{flex:0 0 auto;width:40px;height:40px;border-radius:12px;background:#FEE500;'
    +   'color:#191919;display:flex;align-items:center;justify-content:center}'
    + '.cmc-txt{flex:1 1 auto;min-width:0}'
    + '.cmc-tit{display:block;font-size:14.5px;font-weight:800;color:var(--ink,#1C2A3A)}'
    + '.cmc-sub{display:block;font-size:12.5px;color:var(--text-muted,#545C68);margin-top:2px}'
    + '.cmc-btn{flex:0 0 auto;min-height:44px;padding:0 16px;border:0;border-radius:10px;'
    +   'background:var(--action,#1B3A6B);color:#fff;font-size:14px;font-weight:800;'
    +   'font-family:inherit;letter-spacing:inherit;cursor:pointer}'
    + '.cmc-btn:disabled{opacity:.6;cursor:default}'
    + '.cmc-note{margin:8px 2px 0;font-size:12.5px;color:var(--text-muted,#545C68)}'
    + '.cmc-panel{margin-top:10px;background:#fff;border:1px solid var(--border-soft,rgba(23,42,71,.12));'
    +   'border-radius:12px;padding:14px}'
    + '.cmc-code-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}'
    + '.cmc-code-label{font-size:12.5px;color:var(--text-muted,#545C68)}'
    + '.cmc-code{font-size:16px;font-weight:800;color:var(--ink,#1C2A3A);'
    +   'user-select:all;-webkit-user-select:all}'
    + '.cmc-copy{min-height:44px;padding:0 14px;border:1px solid var(--border-soft,rgba(23,42,71,.12));'
    +   'border-radius:10px;background:#fff;color:var(--ink,#1C2A3A);font-size:13px;font-weight:700;'
    +   'font-family:inherit;cursor:pointer}'
    + '.cmc-go{display:flex;align-items:center;justify-content:center;gap:8px;min-height:48px;'
    +   'margin-top:12px;border-radius:12px;background:#FEE500;color:#191919;'
    +   'font-size:14.5px;font-weight:800;text-decoration:none}'
    + '@media (max-width:359px){.cmc{flex-wrap:wrap}.cmc-btn{flex:1 1 100%}}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var KAKAO_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">'
    + '<path d="M12 3C6.9 3 2.8 6.2 2.8 10.2c0 2.5 1.7 4.7 4.2 6l-1 3.6c-.1.3.3.6.6.4l4.3-2.8c.4 0 '
    + '.7.1 1.1.1 5.1 0 9.2-3.2 9.2-7.2S17.1 3 12 3z"/></svg>';

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function render() {
    mount.innerHTML = ''
      + '<div class="cmc-wrap">'
      +   '<div class="cmc">'
      +     '<span class="cmc-ico" aria-hidden="true">' + KAKAO_SVG + '</span>'
      +     '<span class="cmc-txt">'
      +       '<span class="cmc-tit">승무원 준비생 커뮤니티</span>'
      +       '<span class="cmc-sub">채용 소식 · 정보 교류 · '
      +         '몬크 답변 — 회원 전용</span>'
      +     '</span>'
      +     '<button type="button" class="cmc-btn">입장</button>'
      +   '</div>'
      +   '<div class="cmc-extra"></div>'
      + '</div>';
    mount.querySelector('.cmc-btn').addEventListener('click', onEnter);
  }

  function extra() { return mount.querySelector('.cmc-extra'); }
  function note(msg) { extra().innerHTML = '<p class="cmc-note">' + msg + '</p>'; }

  /* 계측 — index.html 의 moncTrack 과 같은 모양(실패 조용히 무시) */
  function beacon() {
    if (!window.MONC || !window.MONC.sb) return;
    try {
      window.MONC.sb.from('page_events').insert({
        event: 'community_card_click',
        path: location.pathname,
        meta: { viewport: window.matchMedia('(max-width: 768px)').matches ? 'mobile' : 'desktop' }
      }).then(function () {}, function () {});
    } catch (e) {}
  }

  function toLogin() {
    /* lab-shelf.html 의 기존 로그인 유도와 같은 꼴 — login 이 returnTo 로 되돌려 보낸다 */
    location.href = 'login.html?returnTo=' + encodeURIComponent(location.pathname + location.search);
  }

  async function onEnter() {
    beacon();
    if (!window.MONC || !window.MONC.sb) { toLogin(); return; }
    var btn = mount.querySelector('.cmc-btn');
    btn.disabled = true;
    btn.textContent = '확인 중…';
    try {
      var session = await window.MONC.getSession();
      if (!session) { toLogin(); return; }
      var res = await window.MONC.sb.from('community_config')
        .select('*').eq('key', 'open_chat').maybeSingle();
      var v = (!res.error && res.data && res.data.value) || null;
      if (!v || !v.url) {
        note('아직 준비 중이에요. 잠시 뒤 다시 눌러 주세요.');
        return;
      }
      openPanel(v);
    } catch (e) {
      note('아직 준비 중이에요. 잠시 뒤 다시 눌러 주세요.');
    } finally {
      btn.disabled = false;
      btn.textContent = '입장';
    }
  }

  function openPanel(v) {
    var code = v.code ? String(v.code) : '';
    extra().innerHTML = ''
      + '<div class="cmc-panel">'
      + (code
        ? '<div class="cmc-code-row">'
          + '<span class="cmc-code-label">참여코드</span>'
          + '<span class="cmc-code">' + escHtml(code) + '</span>'
          + '<button type="button" class="cmc-copy">복사</button>'
          + '</div>'
        : '')
      + '<a class="cmc-go" href="' + escHtml(v.url) + '" target="_blank" rel="noopener">'
      +   KAKAO_SVG + '카카오톡으로 입장하기</a>'
      + (code
        ? '<p class="cmc-note">입장할 때 위 참여코드를 입력해 주세요.</p>'
        : '')
      + '</div>';
    var copy = extra().querySelector('.cmc-copy');
    if (copy) copy.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(code);
        copy.textContent = '복사됨';
      } catch (e) {
        note('복사가 막혔어요. 코드를 길게 눌러 복사해 주세요.');
      }
    });
  }

  /* bfcache 복귀 — 펼쳐진 코드까지 통째로 초기화 */
  window.addEventListener('pageshow', function (e) { if (e.persisted) render(); });

  render();
})();
```

주의: 화면 문자열은 **한글 리터럴 그대로 둔다.** `\uXXXX` 이스케이프 규칙은 inapp.js 전용(그 파일의 실사고 대응)이고, 같은 세 페이지에 실리는 nav.js 가 한글 리터럴로 인앱 포함 전 환경에서 동작 중이다.

- [ ] **Step 2: 문법 확인** — `node` 로더 규칙대로 실행해 파싱만 확인:

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --check community-card.js
```

Expected: 출력 없음(문법 통과).

- [ ] **Step 3: 커밋**

```bash
git add community-card.js
git commit -m "feat: 커뮤니티 오픈챗 모집 카드 공용 스크립트 — 회원 게이트·참여코드 펼침"
```

---

### Task 3: 세 페이지 연결

**Files:**
- Modify: `lab-shelf.html`(`</main>` 직전 + supabase-config 스크립트 뒤)
- Modify: `news.html`(`</main>` 직전 + supabase-config 스크립트 뒤)
- Modify: `tools.html`(`</main>` 직전 + supabase-js CDN·supabase-config 신규 추가)

**Interfaces:**
- Consumes: Task 2 의 마운트 계약(`<div data-community-card></div>` + `community-card.js?v=1`).

- [ ] **Step 1: lab-shelf.html** — `</main>`(현재 492행 부근, `</section>` 다음) 바로 앞에 마운트 추가:

```html
  <!-- 커뮤니티 오픈챗 모집 카드(공용 community-card.js — 회원 전용 게이트) -->
  <div data-community-card></div>
```

`<script src="supabase-config.js"></script>`(539행 부근) 바로 다음 줄에:

```html
<script src="community-card.js?v=1" defer></script>
```

- [ ] **Step 2: news.html** — `</main>`(278행 부근) 바로 앞에 같은 마운트 2줄, `<script src="supabase-config.js"></script>`(295행 부근) 다음 줄에 같은 스크립트 태그.

- [ ] **Step 3: tools.html** — `</main>`(209행 부근, `.bf-foot` 다음) 바로 앞에 같은 마운트 2줄. tools 는 Supabase 를 아직 안 실으므로 본문 끝 인라인 `<script>`(bfcache reload, 211행 부근) **앞에** 세 줄을 추가:

```html
<!-- 커뮤니티 카드의 회원 확인용 — 이 페이지는 원래 Supabase 를 안 실었다(2026-08-16 카드와 함께 추가) -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="supabase-config.js"></script>
<script src="community-card.js?v=1" defer></script>
```

- [ ] **Step 4: 커밋**

```bash
git add lab-shelf.html news.html tools.html
git commit -m "feat: 커뮤니티 카드 3곳 탑재 — 서가·뉴스·도구 허브(tools 에 supabase 로드 추가)"
```

---

### Task 4: 브라우저 실측(미러 프리뷰)

**Files:** 수정 없음(발견 시 해당 파일 수정 후 커밋)

- [ ] **Step 1: 미러 갱신 후 프리뷰 기동** — 스크래치패드에 rsync 미러를 만들고(`~/Documents` TCC 제한 — CLAUDE.md '명령·검증'), `.claude/launch.json` 의 `wkon-mirror` `runtimeArgs` 경로를 이 세션 미러로 갱신한 뒤 `preview_start({name:"wkon-mirror"})`. 소스를 고치면 rsync 재실행.

- [ ] **Step 2: 375px 렌더 3종** — `resize_window` 375×812 후 `tools.html`·`news.html`·`lab-shelf.html?shelf=docs`(실존 shelf 값은 lab-shelf 소스의 SHELF 표에서 확인) 각각: 카드가 본문 맨 아래에 뜨는지, 제목/부제 잘림 없는지, 콘솔 에러 0. 스크린샷 확보.

- [ ] **Step 3: 320px 넘침 0** — 320×700 에서 세 페이지 `document.documentElement.scrollWidth <= 320` 확인(카드 버튼이 아랫줄로 내려가는 `flex-wrap` 동작 확인).

- [ ] **Step 4: 비회원 흐름** — 시크릿 상태(로그아웃)에서 '입장' 클릭 → `login.html?returnTo=<페이지>` 로 이동하는지. tools 처럼 supabase 를 새로 실은 페이지도 동일한지.

- [ ] **Step 5: 회원 degrade 흐름** — 콘솔에서 `MONC.getSession` 을 임시로 세션 있는 척 바꾸고(`MONC.getSession = async () => ({user:{id:'t'}})`) '입장' 클릭 → 실제 조회는 익명이라 0건/실패 → "아직 준비 중이에요" 한 줄이 뜨는지(콘솔 에러 0). ⚠️ 이것은 미적용 환경 degrade 의 대역 검증이다 — 진짜 회원 성공 흐름은 Task 6 라이브에서.

- [ ] **Step 6: 터치·활자 실측** — '입장' 버튼 높이 ≥44px, 카드 활자 최소 12.5px 확인(`getBoundingClientRect`/`getComputedStyle`).

- [ ] **Step 7: 발견 사항 수정 → rsync → 재확인 → 커밋** (없으면 생략)

---

### Task 5: 문서화

**Files:**
- Modify: `docs/notes/pages.md`(카드 절 추가)

- [ ] **Step 1: pages.md 에 절 추가** — 아래 내용을 문서 형식에 맞춰:

```markdown
## 커뮤니티 오픈챗 모집 카드 — community-card.js 공용 (2026-08-16)

- 싣는 곳 3곳: lab-shelf·news·tools 본문 맨 아래(`<div data-community-card>` + `community-card.js?v=`).
  홈·nav 소셜 줄에는 넣지 않는다(오너 확정 — 회원 전용 취지와 충돌, 홈 커뮤니티 섹션은 부활 금지 목록).
- **주소·참여코드는 레포 반입 금지** — `community_config`(RLS: authenticated 전용)에서 회원만 받는다.
  비회원 클릭은 login.html?returnTo, 미적용/실패는 '아직 준비 중' degrade. 값 변경은 콘솔 SQL(대화창 전달).
- 파일 수정 시 세 페이지 `?v=` 동반 상향. 화면 문자열은 한글 리터럴(\uXXXX 이스케이프는 inapp.js 전용 규칙).
- tools.html 은 이 카드 때문에 supabase-js+supabase-config 를 싣기 시작했다(2026-08-16 이전엔 없었음).
- 참여 인원수 표시 없음(카카오가 숫자를 안 내려줌 — 손 관리 = 거짓 숫자 위험). 계측은 community_card_click 하나.
- 설계 원장: docs/superpowers/specs/2026-08-16-community-card-design.md
```

- [ ] **Step 2: 커밋**

```bash
git add docs/notes/pages.md
git commit -m "docs: 커뮤니티 모집 카드 규칙 — pages.md 절 추가"
```

---

### Task 6: 마무리 — 오너 전달물

**Files:** 없음(대화창 전달 + 오너 확인)

- [ ] **Step 1: 값 insert SQL 을 대화창에 제시** — 오픈챗 주소(대화에서 받은 값)와 참여코드 자리(오너가 카톡 방에 코드를 건 뒤 그 값으로 교체)를 넣은 upsert. ⚠️ 파일로 저장 금지, 채팅으로만.

- [ ] **Step 2: 순서 안내** — ① 마이그레이션 SQL 실행 → ② 카톡 방에 참여코드 걸기 → ③ 값 insert SQL(코드 포함) 실행 → ④ main 병합·푸시(오너 확인 후) → ⑤ 라이브에서 폰으로 회원 흐름 확인(로그인 → 입장 → 코드·링크). anon 프로브(`/rest/v1/community_config?select=*` → `[]`)로 비회원 차단도 확인.

- [ ] **Step 3: 병합 여부 오너 확인** — 마이그레이션이 낀 작업이라 브랜치에 있다. 오너 승인 후 main 병합·푸시(푸시가 곧 배포).

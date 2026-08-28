/* =============================================================================
   미니 다듬기(quickfix) — "AI 느낌이 나는 구간, 붙여넣으면 다듬어드려요" (2026-07-31)

   자기 주입 공용 컴포넌트(nav.js·waitlist.js·blind-quiz.js 패턴). 쓰는 법:
     <div id="quickfix-mount"></div>          ← 티저 한 줄이 이 자리에 그려진다
     <script src="quickfix.js" defer></script>
   sojae 처럼 자리가 좁은 화면은 <div id="quickfix-mount" data-compact></div> 로
   글자 링크형 티저를 쓴다. 시트는 어느 쪽이든 같다.

   무엇인가: 회원이 짧은 구간(300자)을 붙여넣으면 서버(ai-killer 함수의
   mode:'quickfix' 분기, Haiku 4.5)가 무료로 다듬어 준다 — 하루 3번.
   동시에 서버가 "AI 같다고 짚은 표현"(spotted)을 expression_reports 에 쌓는다.
   **사용자에겐 미니 도구, 우리에겐 감점 사전(coach)의 재료 수집 창구다.**

   ⚠️⚠️ 프로브 게이트를 지우지 말 것 — 구버전 ai-killer 함수는 mode:'quickfix' 를
      몰라서 요청이 **킬러 검사로 흘러가 3크레딧이 깎인다**(polish.html checkReady 와
      같은 함정). 그래서 시트를 열 때 features.includes('quickfix') 를 확인하고,
      아니면 입력칸 자체를 보여주지 않는다.
   ⚠️ 시트 등장에서 투명도를 애니메이션하지 말 것 — waitlist.js 에서 실측으로 두 번
      밟은 자리(백그라운드 탭에서 첫 프레임(투명)에 멈춰 안 보인다). 배경막은 처음부터
      불투명, 움직임은 상자 위치만.
   ⚠️ 수집 고지 한 줄("남긴 문장은 …에 쓰여요")을 지우지 말 것 — 제출물을 검사 기준
      개선에 쓰는 데 대한 고지다. 12px 하한(9대 원칙 1).
   ⚠️ 로그인 회원 전용(서버가 JWT 로 판정). 서버 재배포 + 마이그레이션
      20260731120000 이 안 된 환경에서는 '준비 중'으로 degrade — 페이지는 영향 없다.
============================================================================= */
(function () {
  'use strict';
  if (window.MONC && window.MONC.openQuickfix) return;   // 중복 주입 방지

  var QF_MAX = 300;   // ⚠️ 서버(QF_MAX_CHARS)와 같은 값 — 화면만 늘리면 서버가 자른다
  var QF_MIN = 10;

  var CSS = [
    /* 티저 — 흐름 속 한 줄. 기본형(카드 줄)과 compact(글자 링크형) */
    '.qf-tease{display:flex;align-items:center;justify-content:space-between;gap:10px;',
    '  width:100%;box-sizing:border-box;min-height:48px;padding:12px 14px;margin-top:14px;',
    '  background:var(--bg2,#F4F7FC);border:1px solid var(--border-soft,#DDE3EB);',
    '  border-radius:12px;cursor:pointer;font:inherit;text-align:left;color:var(--text,#1E2229)}',
    '.qf-tease-t{font-size:14px;font-weight:700;line-height:1.5;word-break:keep-all}',
    '.qf-tease-go{flex:none;font-size:14px;font-weight:800;color:var(--accent-ink,#1B3A6B)}',
    '.qf-tease.compact{background:none;border:none;justify-content:center;min-height:44px;',
    '  padding:6px 0 0;margin-top:2px}',
    '.qf-tease.compact .qf-tease-t{font-size:12.5px;font-weight:700;color:var(--text-muted,#545C68)}',
    '.qf-tease.compact .qf-tease-go{font-size:12.5px}',
    /* 시트 — waitlist.js 와 같은 등장 규칙(배경막 불투명, 움직임은 위치만) */
    '.qf-back{position:fixed;inset:0;z-index:9000;background:rgba(20,32,46,.55);',
    '  display:flex;align-items:flex-end;justify-content:center;transition:opacity .18s ease}',
    '.qf-back.closing{opacity:0}',
    '@media (min-width:600px){.qf-back{align-items:center;padding:24px}}',
    '.qf-box{background:var(--surface,#fff);color:var(--text,#1E2229);width:100%;max-width:460px;',
    '  border-radius:20px 20px 0 0;padding:22px 20px calc(20px + env(safe-area-inset-bottom));',
    '  box-sizing:border-box;max-height:92vh;overflow-y:auto;animation:qf-rise .2s ease;font-family:inherit}',
    '@media (min-width:600px){.qf-box{border-radius:20px}}',
    '@keyframes qf-rise{from{transform:translateY(14px)}to{transform:none}}',
    '@media (prefers-reduced-motion:reduce){.qf-back{transition:none}.qf-box{animation:none}}',
    '.qf-eyebrow{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;',
    '  color:var(--accent-ink,#1B3A6B);margin:0 0 8px}',
    '.qf-box h3{font-size:20px;font-weight:800;line-height:1.35;margin:0 0 8px;letter-spacing:-.02em;word-break:keep-all}',
    '.qf-lede{font-size:14px;line-height:1.65;color:var(--text-muted,#545C68);margin:0 0 14px;word-break:keep-all}',
    '.qf-ta{width:100%;box-sizing:border-box;font:inherit;font-size:16px;line-height:1.6;',
    '  padding:12px 13px;border:1px solid var(--border-soft,#DDE3EB);border-radius:12px;',
    '  background:var(--bg2,#F4F7FC);color:inherit;min-height:110px;resize:vertical}',
    '.qf-ta:focus{outline:2px solid var(--accent-dark,#142C52);outline-offset:1px;border-color:transparent}',
    '.qf-cnt{text-align:right;font-size:12px;color:var(--text-muted,#545C68);margin:6px 0 0}',
    /* ⚠️ 수집 고지 — 12px 하한. 지우지 말 것 */
    '.qf-fine{font-size:12px;line-height:1.6;color:var(--text-muted,#545C68);margin:10px 0 14px}',
    '.qf-go{width:100%;font:inherit;font-size:16px;font-weight:800;padding:14px;border:none;',
    '  border-radius:12px;background:var(--action,#1B3A6B);color:var(--action-ink,#fff);',
    '  cursor:pointer;min-height:52px}',
    '.qf-go:disabled{opacity:.45;cursor:not-allowed}',
    '.qf-cancel{width:100%;font:inherit;font-size:14px;font-weight:700;padding:12px;margin-top:6px;',
    '  border:none;background:none;color:var(--text-muted,#545C68);cursor:pointer;min-height:44px}',
    '.qf-msg{font-size:13.5px;line-height:1.6;margin:10px 0 0;text-align:center}',
    '.qf-msg.err{color:#9E3B34;font-weight:700}',
    /* 결과 — '지금 → 이렇게' */
    '.qf-lbl{font-size:12px;font-weight:800;letter-spacing:.08em;color:var(--text-muted,#545C68);margin:14px 0 5px}',
    '.qf-lbl.fix{color:var(--accent-ink,#1B3A6B)}',
    '.qf-was{font-size:14px;line-height:1.65;color:var(--text-muted,#545C68);background:var(--bg2,#F4F7FC);',
    '  border-radius:10px;padding:10px 12px;white-space:pre-wrap;word-break:break-word}',
    '.qf-now{font-size:15px;line-height:1.7;background:var(--accent-tint,#EDF2FA);',
    '  border:1.5px solid var(--accent-dark,#142C52);border-radius:10px;padding:11px 12px;',
    '  white-space:pre-wrap;word-break:break-word}',
    /* (괄호 빈칸) = 학생이 제 사실로 채울 자리 — sojae·polish 와 같은 표시 */
    '.qf-blank{background:var(--action-tint,#E4ECF8);border-radius:4px;padding:0 2px;font-weight:700}',
    '.qf-spots{margin:12px 0 0;padding:0;list-style:none}',
    '.qf-spots li{font-size:13px;line-height:1.6;color:var(--text,#1E2229);margin-top:6px}',
    '.qf-spots b{color:var(--accent-ink,#1B3A6B)}',
    '.qf-left{font-size:12.5px;color:var(--text-muted,#545C68);text-align:center;margin:14px 0 0}',
    '.qf-acts{display:flex;gap:8px;margin-top:12px}',
    '.qf-acts button{flex:1;font:inherit;font-size:14px;font-weight:800;min-height:48px;',
    '  border-radius:12px;cursor:pointer;background:var(--surface,#fff);',
    '  color:var(--accent-ink,#1B3A6B);border:1.5px solid var(--accent-dark,#142C52)}',
    '.qf-links{margin-top:14px;padding-top:12px;border-top:1px dashed var(--border-soft,#DDE3EB)}',
    '.qf-links a{display:block;font-size:13.5px;font-weight:800;color:var(--accent-ink,#1B3A6B);',
    '  text-decoration:none;padding:8px 0;min-height:24px}',
  ].join('\n');

  function injectCss() {
    if (document.getElementById('qf-style')) return;
    var s = document.createElement('style');
    s.id = 'qf-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  /* (괄호 빈칸) 강조 — 학생이 채울 자리라는 표시. esc 를 먼저 거친 문자열에만 쓴다 */
  function markBlanks(escaped) {
    return escaped.replace(/\(([^()<>]{1,40})\)/g, '<span class="qf-blank">($1)</span>');
  }

  /* 계측 — sojae 의 moncTrack 과 같은 관습. 실패는 조용히 무시 */
  function track(event, meta) {
    if (!window.MONC || !MONC.sb) return;
    try {
      MONC.sb.from('page_events').insert({ event: event, path: '/quickfix', meta: meta || {} })
        .then(function () {}, function () {});
    } catch (e) {}
  }

  var _back = null, _lastFocus = null, _source = null;

  function close() {
    if (!_back) return;
    var b = _back; _back = null;
    b.classList.add('closing');
    document.removeEventListener('keydown', onKey);
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 180);
    document.documentElement.style.overflow = '';
    if (_lastFocus && _lastFocus.focus) _lastFocus.focus();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function box() { return _back ? _back.querySelector('.qf-box') : null; }

  /* ── 게이트: 로그인 → 프로브(구버전 오차감 차단) ─────────────────────── */
  function gate() {
    var b = box(); if (!b) return;
    if (!window.MONC || !MONC.sb) { renderNotReady(); return; }
    MONC.sb.auth.getSession().then(function (r) {
      var session = r && r.data && r.data.session;
      if (!session) { renderLogin(); return; }
      // 프로브 통과 기록은 세션 저장 — 페이지를 오가도 다시 안 두드린다(양성만 캐시)
      if (sessionStorage.getItem('monc_qf_ready') === '1') { renderForm(); return; }
      MONC.sb.functions.invoke('ai-killer', { body: { probe: true } }).then(function (res) {
        var d = res && res.data;
        var okFn = !!(d && Array.isArray(d.features) && d.features.indexOf('quickfix') !== -1);
        var okTable = !!(d && d.quickfix_table !== null && d.quickfix_table !== undefined);
        if (okFn && okTable) {
          try { sessionStorage.setItem('monc_qf_ready', '1'); } catch (e) {}
          renderForm();
        } else {
          if (d) console.warn('quickfix not ready — fn:', okFn, 'table:', okTable, 'version:', d.version);
          renderNotReady();
        }
      }).catch(renderNotReady);
    }).catch(renderNotReady);
  }

  function shell(inner) {
    var b = box(); if (!b) return;
    b.innerHTML =
      '<p class="qf-eyebrow">FREE · 하루 3번</p>' +
      '<h3>AI 느낌이 나는 구간,<br>붙여넣으면 다듬어드려요</h3>' + inner;
    var no = b.querySelector('#qfNo');
    if (no) no.addEventListener('click', close);
  }

  function renderLogin() {
    shell(
      '<p class="qf-lede">로그인하면 바로 쓸 수 있어요.</p>' +
      '<a class="qf-go" style="display:flex;align-items:center;justify-content:center;box-sizing:border-box;text-decoration:none;" href="' + (window.moncLoginHref ? window.moncLoginHref() : 'login.html') + '">로그인하기</a>' +
      '<button type="button" class="qf-cancel" id="qfNo">다음에 할게요</button>');
  }

  function renderNotReady() {
    shell(
      '<p class="qf-lede">준비 중이에요. 조금 뒤에 다시 열어 주세요.</p>' +
      '<button type="button" class="qf-cancel" id="qfNo">닫기</button>');
  }

  function renderForm(prefillMsg) {
    shell(
      '<p class="qf-lede">자소서나 답변에서 <b>어쩐지 AI 같은 한 구간</b>(' + QF_MAX + '자까지)만 붙여넣어 보세요. 연구진 기준으로 자연스럽게 고쳐드려요.</p>' +
      '<textarea class="qf-ta" id="qfTa" maxlength="' + QF_MAX + '" placeholder="예: 저는 다양한 경험을 통해 소통의 중요성을 깨달았습니다."></textarea>' +
      '<p class="qf-cnt"><span id="qfN">0</span> / ' + QF_MAX + '자</p>' +
      '<p class="qf-fine">남긴 문장은 몬크 연구진이 검사 기준을 다듬는 데 써요. 더 넣을수록 검사가 똑똑해져요.</p>' +
      '<button type="button" class="qf-go" id="qfGo" disabled>다듬기</button>' +
      '<button type="button" class="qf-cancel" id="qfNo">닫기</button>' +
      '<p class="qf-msg" id="qfMsg"></p>');
    var b = box(); if (!b) return;
    var ta = b.querySelector('#qfTa');
    var go = b.querySelector('#qfGo');
    var msg = b.querySelector('#qfMsg');
    if (prefillMsg) { msg.className = 'qf-msg err'; msg.textContent = prefillMsg; }
    ta.addEventListener('input', function () {
      b.querySelector('#qfN').textContent = ta.value.length;
      go.disabled = ta.value.trim().length < QF_MIN;
    });
    go.addEventListener('click', function () { submit(ta, go, msg); });
    ta.focus();
  }

  function submit(ta, go, msg) {
    var text = ta.value.trim();
    if (text.length < QF_MIN) return;
    go.disabled = true; ta.disabled = true;
    go.textContent = '다듬는 중…';
    msg.className = 'qf-msg'; msg.textContent = '';
    MONC.sb.functions.invoke('ai-killer', { body: { mode: 'quickfix', text: text, page: _source } })
      .then(function (res) {
        var d = res && res.data;
        if (!d) throw new Error('no_data');
        if (d.ok) {
          track('quickfix_done', { source: _source, spotted: (d.spotted || []).length, remaining: d.remaining });
          renderResult(text, d);
          return;
        }
        // 서버가 200 + code 로 준 사유 — 그대로 보여주고 입력은 살린다
        if (d.code === 'daily_limit') { renderLimit(d.error); return; }
        go.disabled = false; ta.disabled = false; go.textContent = '다듬기';
        msg.className = 'qf-msg err';
        msg.textContent = d.error || '다듬기에 실패했어요. 잠시 뒤 다시 시도해 주세요.';
      })
      .catch(function () {
        go.disabled = false; ta.disabled = false; go.textContent = '다듬기';
        msg.className = 'qf-msg err';
        msg.textContent = '연결이 불안정해요. 잠시 뒤 다시 시도해 주세요.';
      });
  }

  /* 퍼널 링크 — 지금 있는 페이지로 가는 링크는 뺀다 */
  function funnelLinks() {
    var links = '';
    // ⚠️ AI킬러 잠시 내림(2026-08-28 오너 "다 내리자") — 복원 시 아래 줄을 되살린다:
    // if (_source !== 'killer') links += '<a href="ai-killer.html">글 전체는 KILL AI로 검사하기 →</a>';
    links += '<a href="polish.html">문장까지 제대로 고치려면 첨삭 →</a>';
    return '<div class="qf-links">' + links + '</div>';
  }

  function renderLimit(serverMsg) {
    shell(
      '<p class="qf-lede">' + esc(serverMsg || '오늘 무료 다듬기를 다 썼어요. 내일 다시 열려요.') + '</p>' +
      funnelLinks() +
      '<button type="button" class="qf-cancel" id="qfNo">닫기</button>');
  }

  function renderResult(original, d) {
    var spots = (d.spotted || []).map(function (s) {
      return '<li>“<b>' + esc(s.term) + '</b>” — ' + esc(s.why || 'AI 글에 자주 나오는 표현이에요.') + '</li>';
    }).join('');
    shell(
      '<div class="qf-lbl">지금</div>' +
      '<div class="qf-was">' + esc(original) + '</div>' +
      '<div class="qf-lbl fix">이렇게</div>' +
      '<div class="qf-now">' + markBlanks(esc(d.fixed || '')) + '</div>' +
      (spots ? '<ul class="qf-spots">' + spots + '</ul>' : '') +
      '<p class="qf-left">' + (d.remaining > 0
        ? '오늘 <b>' + d.remaining + '번</b> 더 다듬을 수 있어요. (괄호)는 내 이야기로 채워 주세요.'
        : '오늘 무료 다듬기를 다 썼어요. (괄호)는 내 이야기로 채워 주세요.') + '</p>' +
      '<div class="qf-acts">' +
        '<button type="button" id="qfCopy">고친 문장 복사</button>' +
        (d.remaining > 0 ? '<button type="button" id="qfAgain">다른 구간 다듬기</button>' : '') +
      '</div>' +
      funnelLinks() +
      '<button type="button" class="qf-cancel" id="qfNo">닫기</button>');
    var b = box(); if (!b) return;
    var copy = b.querySelector('#qfCopy');
    copy.addEventListener('click', function () {
      try {
        navigator.clipboard.writeText(d.fixed || '').then(function () {
          copy.textContent = '복사됐어요';
          setTimeout(function () { copy.textContent = '고친 문장 복사'; }, 1600);
        });
      } catch (e) {}
    });
    var again = b.querySelector('#qfAgain');
    if (again) again.addEventListener('click', function () { renderForm(); });
  }

  /* ── 열기 ──────────────────────────────────────────────────────────── */
  function openQuickfix(source) {
    _source = source || null;
    injectCss();
    _lastFocus = document.activeElement;
    var back = document.createElement('div');
    back.className = 'qf-back';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-label', 'AI 느낌 구간 다듬기');
    back.innerHTML = '<div class="qf-box"><p class="qf-lede" style="margin:8px 0;">확인 중…</p></div>';
    document.body.appendChild(back);
    document.documentElement.style.overflow = 'hidden';
    _back = back;
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    track('quickfix_open', { source: _source });
    gate();
  }

  /* ── 티저 주입 — #quickfix-mount 가 있는 페이지에만 ───────────────────── */
  function mountTease() {
    var mount = document.getElementById('quickfix-mount');
    if (!mount || mount.dataset.qfDone) return;
    mount.dataset.qfDone = '1';
    injectCss();
    var compact = mount.hasAttribute('data-compact');
    var source = mount.getAttribute('data-source') || null;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qf-tease' + (compact ? ' compact' : '');
    btn.innerHTML = compact
      ? '<span class="qf-tease-t">AI 느낌 나는 구간, 무료로 다듬기 <span class="qf-tease-go">→</span></span>'
      : '<span class="qf-tease-t">AI 느낌이 나는 구간, 붙여넣으면 다듬어드려요</span><span class="qf-tease-go">무료 →</span>';
    btn.addEventListener('click', function () { openQuickfix(source); });
    mount.appendChild(btn);
  }

  window.MONC = window.MONC || {};
  window.MONC.openQuickfix = openQuickfix;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountTease);
  } else {
    mountTease();
  }
})();

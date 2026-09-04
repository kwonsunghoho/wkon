/* =============================================================================
   오픈 알림 받기 — 마감·모집예정 챌린지의 대기 명단 (2026-07-30 신설)

   자기 주입 공용 컴포넌트(nav.js·blind-quiz.js 와 같은 패턴). 쓰는 법:
     <script src="waitlist.js" defer></script>
   그리고 열 자리에서  MONC.openWaitlist('voice', 'closed')  를 부른다.

   ⚠️⚠️ 상세 4종에 모달을 복사해 넣지 말 것 — 그 네 파일의 인라인 <style> 공통 블록은
      글자 그대로 같아서 한 곳만 고치면 넷이 어긋난다(CLAUDE.md 경고). 그래서 CSS·마크업·
      로직을 이 한 파일에 모았고, 신청 페이지(apply.html)도 같은 컴포넌트를 쓴다.

   ⚠️ 법적 필수: 이름·전화는 개인정보다. 필수 동의 체크(만14세 + 수집·이용)를 사용자가
      직접 켜야 제출 버튼이 열린다. 사전 체크·'간주 동의'·체크 삭제 금지(apply.html 규정과 동일).
      동의 시각은 agreed_at, 약관 버전은 terms_version 으로 저장한다.

   ⚠️ 테이블은 마이그레이션 20260730120000_challenge_waitlist.sql (오너가 콘솔에서 실행).
      미적용이면 제출이 실패하고 안내 문구가 뜬다 — 페이지의 다른 기능은 영향 없다.
============================================================================= */
(function () {
  'use strict';
  if (window.MONC && window.MONC.openWaitlist) return;   // 중복 주입 방지

  var NAMES = {
    voice:      { label: '보.신.각', what: '목소리' },
    expression: { label: '영.합.각', what: '표현력' },
    spinning:   { label: '스.피.닝', what: '말투' },
    answer:     { label: '승.자.각', what: '답변' },
    culture:    { label: '댄.특.완', what: '대한항공 특화 답변' }
  };

  var CSS = [
    // ⚠️⚠️ 등장에서 **투명도를 애니메이션하지 말 것**(rAF 로 클래스를 붙이는 방식도 금지).
    //    실측으로 두 번 밟은 자리다: ① rAF 로 opacity 0→1 을 켜면 탭이 백그라운드일 때
    //    rAF 가 늦어 모달이 안 보인다 ② CSS 애니메이션으로 바꿔도 애니메이션이 일시정지되면
    //    첫 프레임(투명)에 멈춰 똑같이 안 보인다(fill-mode 를 떼도 마찬가지 — 재생 중에는
    //    애니메이션 값이 이긴다).
    //    그래서 배경막은 처음부터 불투명하게 두고, 움직임은 '위치만'(.wl-box 의 wl-rise) 준다.
    //    위치 애니메이션이 멈춰도 상자가 14px 아래 있을 뿐 내용은 보인다 — 실패해도 열린다.
    '.wl-back{position:fixed;inset:0;z-index:9000;background:rgba(20,32,46,.55);',
    '  display:flex;align-items:flex-end;justify-content:center;padding:0;',
    '  transition:opacity .18s ease}',
    '.wl-back.closing{opacity:0}',
    '@media (min-width:600px){.wl-back{align-items:center;padding:24px}}',
    '.wl-box{background:var(--surface,#fff);color:var(--text,#1E2229);width:100%;max-width:440px;',
    '  border-radius:20px 20px 0 0;padding:24px 20px 22px;box-sizing:border-box;',
    '  max-height:92vh;overflow-y:auto;animation:wl-rise .2s ease;font-family:inherit}',
    '@media (min-width:600px){.wl-box{border-radius:20px}}',
    '@keyframes wl-rise{from{transform:translateY(14px)}to{transform:none}}',
    // 움직임을 줄이는 설정이면 애니메이션 없이 '도착한 상태'로 둔다.
    '@media (prefers-reduced-motion:reduce){',
    '  .wl-back,.wl-box{animation:none}.wl-back{transition:none}}',
    '.wl-eyebrow{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;',
    '  color:var(--accent-ink,#1B3A6B);margin:0 0 8px}',
    '.wl-box h3{font-size:20px;font-weight:800;line-height:1.35;margin:0 0 8px;letter-spacing:-.02em}',
    '.wl-lede{font-size:14px;line-height:1.65;color:var(--text-muted,#545C68);margin:0 0 18px}',
    '.wl-f{display:block;margin-bottom:12px}',
    '.wl-f span{display:block;font-size:13px;font-weight:700;margin-bottom:6px}',
    '.wl-f input{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:13px 14px;',
    '  border:1px solid var(--border-soft,#DDE3EB);border-radius:10px;background:var(--bg2,#F4F7FC);',
    '  color:inherit;min-height:48px}',
    '.wl-f input:focus{outline:2px solid var(--accent-dark,#142C52);outline-offset:1px;border-color:transparent}',
    '.wl-consent{display:flex;gap:10px;align-items:flex-start;margin:16px 0 6px;cursor:pointer}',
    '.wl-consent input{flex:none;width:22px;height:22px;margin:1px 0 0;accent-color:var(--accent-ink,#1B3A6B)}',
    '.wl-consent span{font-size:13px;line-height:1.6}',
    // ⚠️ 12px 하한(9대 원칙 1) — 법적 고지라도 이 밑으로 내리지 말 것.
    '.wl-fine{font-size:12px;line-height:1.6;color:var(--text-muted,#545C68);margin:0 0 16px 32px}',
    '.wl-fine a{color:inherit}',
    '.wl-go{width:100%;font:inherit;font-size:16px;font-weight:800;padding:15px;border:none;',
    '  border-radius:12px;background:var(--action,#1B3A6B);color:var(--action-ink,#fff);',
    '  cursor:pointer;min-height:52px}',
    '.wl-go:disabled{opacity:.45;cursor:not-allowed}',
    '.wl-cancel{width:100%;font:inherit;font-size:14px;font-weight:700;padding:12px;margin-top:8px;',
    '  border:none;background:none;color:var(--text-muted,#545C68);cursor:pointer;min-height:44px}',
    '.wl-msg{font-size:13.5px;line-height:1.6;margin:12px 0 0;text-align:center}',
    '.wl-msg.err{color:#9E3B34;font-weight:700}',
    '.wl-done{text-align:center;padding:8px 0 4px}',
    '.wl-done .wl-tick{font-size:34px;line-height:1;color:#2E6E42;margin-bottom:10px}',
    '.wl-done h3{margin-bottom:8px}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('wl-style')) return;
    var s = document.createElement('style');
    s.id = 'wl-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  var _back = null, _lastFocus = null;

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

  /* 지금 로그인한 회원이면 이름·전화를 미리 채운다(있으면). 실패는 조용히 넘긴다. */
  function prefill(box) {
    if (!window.MONC || !MONC.getMyProfile) return;
    try {
      MONC.getMyProfile().then(function (p) {
        if (!p || !_back) return;
        if (p.name && !box.querySelector('#wlName').value) box.querySelector('#wlName').value = p.name;
        if (p.phone && !box.querySelector('#wlPhone').value) box.querySelector('#wlPhone').value = p.phone;
      }).catch(function () {});
    } catch (e) {}
  }

  function openWaitlist(challenge, status) {
    var info = NAMES[challenge] || { label: '이 챌린지', what: '' };
    var upcoming = status === 'upcoming';
    injectCss();
    _lastFocus = document.activeElement;

    var back = document.createElement('div');
    back.className = 'wl-back';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-label', info.label + ' 오픈 알림 받기');
    back.innerHTML =
      '<div class="wl-box">' +
        '<p class="wl-eyebrow">' + (upcoming ? '모집 예정' : '다음 기수 준비 중') + '</p>' +
        '<h3>' + info.label + ' 열리면<br>가장 먼저 알려드릴까요?</h3>' +
        '<p class="wl-lede">' +
          (upcoming
            ? '모집이 시작되는 날 문자로 알려드려요. 시작일을 놓치지 않게요.'
            : '다음 기수 모집이 열리는 날 문자로 알려드려요. 자리가 빨리 차는 편이라 미리 받아두시면 좋아요.') +
        '</p>' +
        '<label class="wl-f"><span>이름</span>' +
          '<input id="wlName" type="text" autocomplete="name" placeholder="이름을 입력해 주세요"></label>' +
        '<label class="wl-f"><span>휴대전화번호</span>' +
          '<input id="wlPhone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="010-0000-0000"></label>' +
        '<label class="wl-consent">' +
          '<input type="checkbox" id="wlAgree">' +
          '<span>[필수] 만 14세 이상이며, 오픈 알림 발송을 위한 개인정보 수집·이용에 동의합니다.</span>' +
        '</label>' +
        '<p class="wl-fine">수집 항목: 이름·휴대전화번호 / 목적: 모집 오픈 안내 / ' +
          '보유 기간: 안내 완료 후 지체 없이 파기 · ' +
          '<a href="privacy.html" target="_blank" rel="noopener">개인정보처리방침</a></p>' +
        '<button type="button" class="wl-go" id="wlGo" disabled>알림 신청하기</button>' +
        '<button type="button" class="wl-cancel" id="wlNo">괜찮아요</button>' +
        '<p class="wl-msg" id="wlMsg"></p>' +
      '</div>';

    document.body.appendChild(back);
    document.documentElement.style.overflow = 'hidden';
    _back = back;
    document.addEventListener('keydown', onKey);

    var box = back.querySelector('.wl-box');
    var go = back.querySelector('#wlGo');
    var agree = back.querySelector('#wlAgree');
    var msg = back.querySelector('#wlMsg');

    // ⚠️ 동의를 켜야 버튼이 열린다. 사전 체크 금지.
    agree.addEventListener('change', function () { go.disabled = !agree.checked; });
    back.querySelector('#wlNo').addEventListener('click', close);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    back.querySelector('#wlName').focus();
    prefill(box);

    go.addEventListener('click', function () {
      var name = back.querySelector('#wlName').value.trim();
      var phone = back.querySelector('#wlPhone').value.trim();
      msg.className = 'wl-msg';
      /* ⚠️ 검증 규칙은 phone-check.js 한 곳에만 둔다(2026-08-02 오너 지시) — 가입·챌린지·
         특강·오픈알림 네 창구가 같은 번호를 받는데 한쪽만 통과하면 안 된다.
         phone-check.js 가 없는 페이지에서도 죽지 않게 폴백을 남긴다. */
      var P = window.MONC_PHONE;
      var nc = P ? P.checkName(name) : { ok: name.length >= 2, message: '이름을 두 글자 이상 입력해 주세요.' };
      if (!nc.ok) { msg.className = 'wl-msg err'; msg.textContent = nc.message; return; }
      var pc = P ? P.check(phone) : { ok: phone.replace(/\D/g, '').length >= 10, message: '휴대전화번호를 정확히 입력해 주세요.' };
      if (!pc.ok) { msg.className = 'wl-msg err'; msg.textContent = pc.message; return; }
      if (!agree.checked) return;
      go.disabled = true;
      msg.textContent = '신청 중…';
      submit(challenge, name, phone).then(function (res) {
        if (res.ok || res.dup) { showDone(back, info, res.dup); return; }
        go.disabled = false;
        msg.className = 'wl-msg err';
        msg.textContent = res.message || '지금은 신청이 어려워요. 잠시 후 다시 시도해 주세요.';
      });
    });
  }

  function showDone(back, info, dup) {
    back.querySelector('.wl-box').innerHTML =
      '<div class="wl-done">' +
        '<div class="wl-tick">✓</div>' +
        '<h3>' + (dup ? '이미 신청되어 있어요' : '알림 신청 완료') + '</h3>' +
        '<p class="wl-lede">' + info.label + ' 모집이 열리는 날 문자로 알려드릴게요.' +
          (dup ? '' : ' 연락처는 안내가 끝나면 파기합니다.') + '</p>' +
        '<button type="button" class="wl-go" id="wlClose">확인</button>' +
      '</div>';
    back.querySelector('#wlClose').addEventListener('click', close);
    back.querySelector('#wlClose').focus();
  }

  /* Supabase 저장. 반환: {ok} / {dup:true} / {ok:false, message} */
  function submit(challenge, name, phone) {
    if (!window.MONC || !MONC.sb) {
      return Promise.resolve({ ok: false, message: '연결이 준비되지 않았어요. 새로고침 후 다시 시도해 주세요.' });
    }
    var row = {
      challenge: challenge,
      name: name,
      // ⚠️ 전화번호는 사용자가 입력한 표기 그대로 저장한다(운영자가 보고 전화를 건다).
      //    중복 판정은 DB 인덱스가 숫자만 뽑아서 하므로 표기가 달라도 걸린다.
      phone: phone,
      agreed_at: new Date().toISOString(),
      terms_version: (window.MONC && MONC.TERMS_VERSION) || null
    };
    return Promise.resolve()
      .then(function () { return MONC.getMyProfile ? MONC.getMyProfile().catch(function () { return null; }) : null; })
      .then(function (p) {
        if (p && p.id) row.member_id = p.id;   // RLS: null 또는 본인 uid 만 허용
        return MONC.sb.from('challenge_waitlist').insert(row);
      })
      .then(function (res) {
        if (!res || !res.error) return { ok: true };
        var e = res.error;
        // 23505 = unique 위반. 같은 번호로 이미 남긴 경우 → 실패가 아니라 '이미 신청됨'.
        if (e.code === '23505') return { dup: true };
        // 테이블 미생성(마이그레이션 미적용).
        // ⚠️ PostgREST 는 42P01 이 아니라 PGRST205("Could not find the table ... in the
        //    schema cache")를 돌려준다 — 실측으로 확인한 코드다. 42P01 만 보면 이 분기를
        //    영원히 타지 못하고 일반 오류 문구가 뜬다.
        if (e.code === 'PGRST205' || e.code === '42P01'
            || /could not find the table|does not exist/i.test(e.message || '')) {
          return { ok: false, message: '알림 신청 기능을 준비 중이에요. 조금 뒤에 다시 시도해 주세요.' };
        }
        return { ok: false, message: '지금은 신청이 어려워요. 잠시 후 다시 시도해 주세요.' };
      })
      .catch(function () {
        return { ok: false, message: '지금은 신청이 어려워요. 잠시 후 다시 시도해 주세요.' };
      });
  }

  window.MONC = window.MONC || {};
  window.MONC.openWaitlist = openWaitlist;
})();

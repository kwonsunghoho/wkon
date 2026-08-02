/* ══════════════════════════════════════════════════════════════════════════
   전화번호 검증 — 공용 (2026-08-02 신설 · 오너 "전화번호 양식이 다를 시 가입 또는 신청
   안 되게 해줘")

   왜 한 파일인가: 같은 사람이 같은 번호를 **네 창구**에 넣는다 —
   가입(onboarding) · 챌린지 신청(apply) · 특강 신청(lecture) · 오픈 알림(waitlist).
   각자 검증을 들고 있으면 한쪽만 통과하는 번호가 생긴다(실제로 그랬다: apply 는
   `if (!phone)` 이 전부라 '1' 한 글자도 통과했고, waitlist 만 10자리를 봤다).

   왜 이 규칙인가: 우리 연락 수단이 **카카오톡 오픈채팅·문자**다. 휴대전화가 아니면
   미션 안내가 안 간다. 그래서 유선번호·해외번호는 받지 않는다.
       010-0000-0000(11자리 고정) / 01x-000-0000 (구 국번은 10~11자리)
   ⚠️ 규칙을 완화하려면 이 파일 하나만 고친다. 페이지에 정규식을 복사해 넣지 말 것.
   ⚠️ 하이픈·공백·괄호는 자유다 — 숫자만 뽑아서 본다. 입력 중 자동 포맷팅은 하지
      않는다(커서가 튀어 오히려 오입력이 는다).

   쓰는 법:
       var r = MONC_PHONE.check(value);      // { ok:true, digits:'01012345678' } | { ok:false, message:'…' }
       var d = MONC_PHONE.digits(value);     // 숫자만
       MONC_PHONE.format('01012345678');     // '010-1234-5678' (저장·표시용)
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MONC_PHONE) return;

  /* 국내 휴대전화 국번.
     ⚠️ **010 은 11자리만** 받는다 — 10자리 010 은 2010년대에 전부 11자리로 전환돼
        지금 들어오면 한 자리를 빠뜨린 오타다(이게 '양식이 다르다'의 대표 사례다).
     01[16789] 는 아직 10자리가 남아 있어 10~11자리를 받는다. */
  var MOBILE_010 = /^010[0-9]{8}$/;
  var MOBILE_OLD = /^01[16789][0-9]{7,8}$/;
  function isMobile(d) { return MOBILE_010.test(d) || MOBILE_OLD.test(d); }

  function digits(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }

  /* +82 국제 표기를 국내 형식으로 되돌린다(붙여넣기가 흔하다).
     82 뒤가 이미 0 으로 시작하면(누군가 82 를 앞에 덧붙인 경우) 0 을 또 붙이지 않는다. */
  function unwrap82(d) {
    if (d.length <= 11 || d.indexOf('82') !== 0) return d;
    var rest = d.slice(2);
    return rest.charAt(0) === '0' ? rest : '0' + rest;
  }

  function check(v) {
    var d = unwrap82(digits(v));
    if (!d) return { ok: false, digits: '', message: '휴대전화번호를 입력해 주세요.' };
    if (!/^0/.test(d)) {
      return { ok: false, digits: d, message: '휴대전화번호를 010 으로 시작하게 입력해 주세요.' };
    }
    if (!isMobile(d)) {
      /* 유선번호를 넣은 경우를 따로 짚어 준다 — 무엇이 틀렸는지 알아야 고친다 */
      if (/^0(2|3[1-3]|4[1-4]|5[1-5]|6[1-4])/.test(d)) {
        return { ok: false, digits: d, message: '연락은 문자·카카오톡으로 드려요. 휴대전화번호(010)를 입력해 주세요.' };
      }
      /* 010 인데 자릿수만 틀린 경우는 그 사실을 짚어 준다 — '형식이 맞지 않아요'만으로는
         어디를 고쳐야 할지 모른다. */
      if (d.indexOf('010') === 0) {
        return { ok: false, digits: d, message: '010 번호는 숫자 11자리예요. 예) 010-1234-5678' };
      }
      return { ok: false, digits: d, message: '휴대전화번호 형식이 맞지 않아요. 예) 010-1234-5678' };
    }
    return { ok: true, digits: d, message: '' };
  }

  function format(v) {
    var d = digits(v);
    if (d.length === 11) return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
    if (d.length === 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    return String(v || '');
  }

  /* 이름도 같은 이유로 여기서 본다(네 창구가 같은 값을 받는다) */
  function checkName(v) {
    var n = String(v == null ? '' : v).trim();
    if (n.length < 2) return { ok: false, value: n, message: '이름을 두 글자 이상 입력해 주세요.' };
    if (n.length > 20) return { ok: false, value: n, message: '이름이 너무 길어요.' };
    return { ok: true, value: n, message: '' };
  }

  window.MONC_PHONE = { check: check, digits: digits, format: format, checkName: checkName };
})();

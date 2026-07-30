/* =============================================================================
 * MONC 매일 답변 프로그램 — 공용 데이터 계층 + 라벨 (2026-07-30)
 * =============================================================================
 * 쓰는 페이지: programs.html · program.html · experiences.html · review-desk.html
 * 로드 순서: supabase-js CDN → supabase-config.js → 이 파일 (데모 모드는 앞 둘이 없어도 동작)
 *
 * 구조: window.AP = { 라벨/순수 헬퍼, store }
 *   - store 는 실서버(Supabase+Edge Function)와 데모(localStorage) 두 구현을
 *     **같은 인터페이스**로 제공한다. 페이지는 store 만 부른다.
 *   - 데모 모드 = 마이그레이션·함수 배포·로그인 없이 전체 흐름을 검증하는 목업 어댑터.
 *     켜기: ?demo=1 (localStorage 에 남는다) / 끄기: ?demo=0 또는 배너의 종료 버튼.
 *   - ⚠️ 데모 AI 는 규칙 기반 흉내다 — 실제 판단 품질을 보지 말고 **흐름·화면**만 볼 것.
 *
 * ⚠️ apUnlockedMax / kstToday 는 서버(SQL ap_unlocked_max · edge fn)와 같은 식이어야
 *    한다. 식을 고치면 세 곳(여기·SQL·index.ts)을 같이 고치고
 *    node scripts/answer-program-tests.mjs 로 확인할 것.
 * ============================================================================= */
(function () {
  'use strict';

  /* ── 라벨 원장 ─────────────────────────────────────────────────────────── */
  var AIRLINES = {
    ke: '대한항공', lj: '진에어', '7c': '제주항공', tw: '티웨이항공',
    ze: '이스타항공', yp: '에어프레미아', rf: '에어로케이'
  };

  // 질문 유형 10종 — 유형별 권장 구조(서버 QTYPE_STRUCTURE 와 같은 표).
  var QTYPES = {
    experience: { label: '경험형',   structure: '핵심 행동 → 상황 → 판단 → 결과' },
    values:     { label: '가치관형', structure: '나의 기준 → 기준이 생긴 경험 → 실제 행동' },
    motivation: { label: '지원동기형', structure: '지원 이유 → 개인 경험 → 이 항공사를 고른 이유' },
    mistake:    { label: '실수형',   structure: '실수 인정 → 원인 → 해결 → 이후 달라진 행동' },
    weakness:   { label: '단점형',   structure: '실제 단점 → 문제가 됐던 사례 → 지금 관리 방법' },
    conflict:   { label: '갈등형',   structure: '갈등 원인 → 상대 관점 확인 → 내 행동 → 합의/결과' },
    situation:  { label: '상황형',   structure: '가장 먼저 할 행동 → 이유 → 후속 대응 순서' },
    company:    { label: '기업형',   structure: '회사에 대한 이해 → 나의 판단 → 나와의 연결' },
    job:        { label: '직무형',   structure: '직무 상황 이해 → 행동 기준 → 관련 경험/준비' },
    opinion:    { label: '의견형',   structure: '입장 → 판단 기준 → 근거 → 예외/보완' }
  };

  // qtype → answers.category(기존 4종) — 확정본을 답변노트로 넘길 때의 분류.
  var QTYPE_TO_CATEGORY = {
    experience: 'experience', mistake: 'experience', conflict: 'experience',
    values: 'values', weakness: 'values', opinion: 'values',
    situation: 'judgment', job: 'judgment',
    motivation: 'company', company: 'company'
  };

  var STATES = {
    not_started:          { label: '시작 전',        step: 1 },
    experience_selecting: { label: '경험 고르는 중', step: 1 },
    fact_gathering:       { label: '사실 모으는 중', step: 2 },
    student_drafting:     { label: '초안 쓰는 중',   step: 3 },
    ai_revised:           { label: 'AI 첨삭 도착',   step: 4 },
    student_editing:      { label: '다듬는 중',      step: 4 },
    review_requested:     { label: '연구원 검수 대기', step: 5 },
    researcher_reviewing: { label: '연구원 검수 중', step: 5 },
    revision_requested:   { label: '보완 요청 받음', step: 4 },
    approved:             { label: '연구원 승인',    step: 5 },
    finalized:            { label: '완성',           step: 6 }
  };

  var SRC_CONF = { verified: '검증된 기출', reported: '제보 기출', estimated: '예상 문항' };

  var EXP_TYPES = ['아르바이트', '동아리·학회', '봉사', '학업·프로젝트', '직장', '여행·생활', '기타'];

  var CARD_FIELD_LABELS = {
    period_text: '시기', duration_text: '기간', place_type: '장소', role: '당시 역할',
    people: '함께한 사람', situation: '시작 상황', problem: '발생한 문제',
    action: '실제로 한 행동', action_reason: '행동을 고른 이유', alternatives: '고려한 다른 방법',
    hardest: '가장 어려웠던 지점', result: '실제 결과', others_reaction: '상대의 실제 반응',
    feeling: '느낀 점', change_after: '이후 바뀐 행동', strengths: '스스로 보는 강점'
  };

  var SCORE_ITEMS = [
    ['evidence', '경험 근거', 25], ['specificity', '구체성', 20], ['ownership', '본인 행동', 15],
    ['judgment', '판단·가치관', 15], ['naturalness', '말투 자연스러움', 10],
    ['fit', '질문 적합성', 10], ['consistency', '답변 간 일관성', 5]
  ];

  /* ── 순수 헬퍼 (서버와 같은 식) ─────────────────────────────────────────── */
  function kstToday(now) {
    var t = new Date((now || Date.now()) + 9 * 3600 * 1000);
    return t.toISOString().slice(0, 10);
  }
  function unlockedMax(policy, totalDays, startedAt, todayStr) {
    if (policy === 'all') return totalDays;
    if (policy !== 'daily') return 0;
    var started = Date.parse(String(startedAt) + 'T00:00:00Z');
    var today = Date.parse(String(todayStr || kstToday()) + 'T00:00:00Z');
    if (!isFinite(started) || !isFinite(today)) return 0;
    var diff = Math.floor((today - started) / 86400000) + 1;
    return Math.max(1, Math.min(totalDays, diff));
  }
  function estSeconds(text) {
    return Math.round(String(text || '').replace(/\s/g, '').length / 5.5);
  }
  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // 테이블 미생성 판정 — PostgREST 는 42P01 이 아니라 PGRST205 를 준다(waitlist.js 실측과 동일).
  function isMissingTable(e) {
    return !!e && (e.code === 'PGRST205' || /schema cache|does not exist/i.test(String(e.message || '')));
  }
  function totalScore(scores) {
    if (!scores) return 0;
    var t = 0;
    SCORE_ITEMS.forEach(function (it) { t += Number(scores[it[0]] || 0); });
    return t;
  }

  /* ── 데모 모드 스위치 ──────────────────────────────────────────────────── */
  var DEMO_KEY = 'ap_demo_v1';
  (function syncDemoFlag() {
    try {
      var m = location.search.match(/[?&]demo=(\d)/);
      if (m) {
        if (m[1] === '1') localStorage.setItem(DEMO_KEY, '1');
        else localStorage.removeItem(DEMO_KEY);
      }
    } catch (e) {}
  })();
  function demoOn() {
    try { return localStorage.getItem(DEMO_KEY) === '1'; } catch (e) { return false; }
  }

  /* =============================================================================
   * 데모 스토어 — localStorage. 마이그레이션·배포·로그인 없이 전체 흐름 검증.
   * ============================================================================= */
  // v2(2026-07-30): 데모가 '필수 기출(공통)' 프로그램으로 바뀌어 키를 올렸다 —
  // 구 키를 그대로 쓰면 이전 체험자의 localStorage 에 옛 제주항공 데모가 남아 보인다.
  var DEMO_STATE_KEY = 'ap_demo_state_v2';

  function demoSeed() {
    var today = kstToday();
    var d2ago = kstToday(Date.now() - 2 * 86400000);
    return {
      programs: [{
        // 1차 상품 방향(2026-07-30 오너): 필수 기출(전 항공사 공통) 먼저 — airline null=공통
        id: 'demo-prog-7c', airline: null, title: '필수 기출 맛보기 (체험판)',
        subtitle: '어느 항공사든 무조건 나오는 문제부터', description: '체험 모드 — 실제 기출 은행이 아니라 예시 문항입니다.',
        total_days: 5, reveal_policy: 'daily', price: 0, visible: true
      }],
      enrollments: [{ id: 'demo-enr-1', program_id: 'demo-prog-7c', member_id: 'demo-user', started_at: d2ago, status: 'active', source: 'promo' }],
      questions: {
        'demo-q1': { id: 'demo-q1', content: '예상치 못한 상황을 침착하게 해결했던 경험을 말해 보세요.', qtype: 'experience', stage: '1차 면접', intent: '위기에서 무엇을 먼저 챙기는 사람인지, 실제로 몸이 움직였는지를 봅니다.', competencies: ['우선순위 판단', '침착함'], needed_facts: ['실제로 한 행동', '그때 한 말', '확인 가능한 결과'], good_exp_types: ['아르바이트', '동아리·학회'], avoid: '결과 자랑으로 시작하지 않기', common_mistakes: '팀이 한 일을 내가 한 일처럼 말하는 것', rec_seconds: 60, source_confidence: 'reported', asked_at: '2025 하반기', followups: ['그때 주변 반응은 어땠나요?', '같은 일이 다시 생기면 무엇을 다르게 하실 건가요?'] },
        'demo-q2': { id: 'demo-q2', content: '승무원이라는 직업을 선택한 이유는 무엇인가요?', qtype: 'motivation', stage: '공통 필수', intent: '멋있어 보여서가 아니라 직업의 실제(서비스+안전+체력)를 알고 골랐는지 봅니다.', competencies: ['직업 이해', '진정성'], needed_facts: ['계기가 된 개인 경험', '이 직업을 고른 이유'], good_exp_types: ['여행·생활'], rec_seconds: 45, source_confidence: 'verified', followups: ['승무원의 가장 힘든 점은 뭐라고 생각하세요?'] },
        'demo-q3': { id: 'demo-q3', content: '팀원과 의견이 크게 부딪혔을 때 어떻게 조율했는지 말해 보세요.', qtype: 'conflict', stage: '2차 면접', intent: '갈등에서 상대의 관점을 확인하는 사람인지 봅니다.', competencies: ['경청', '조율'], needed_facts: ['갈등의 원인', '내가 한 행동', '합의 결과'], good_exp_types: ['동아리·학회', '아르바이트'], rec_seconds: 60, source_confidence: 'reported', followups: ['상대가 끝까지 반대했다면요?'] },
        'demo-q4': { id: 'demo-q4', content: '본인의 단점은 무엇인가요?', qtype: 'weakness', stage: '2차 면접', intent: '자기 인식과 관리 능력을 봅니다. 장점으로 포장한 단점은 감점.', competencies: ['자기 인식'], needed_facts: ['실제 단점', '문제가 됐던 사례', '지금 관리 방법'], rec_seconds: 40, source_confidence: 'estimated', followups: ['그 단점이 기내에서 문제가 되면요?'] },
        'demo-q5': { id: 'demo-q5', content: '기내에서 승객 두 분이 동시에 도움을 요청하면 어떻게 하시겠어요?', qtype: 'situation', stage: '2차 면접', intent: '순서를 정하는 기준이 있는지 봅니다.', competencies: ['우선순위 판단', '안전 의식'], needed_facts: ['가장 먼저 할 행동', '그 이유'], rec_seconds: 40, source_confidence: 'reported', followups: ['두 분 다 급하다고 하시면요?'] }
      },
      days: [
        { program_id: 'demo-prog-7c', day_no: 1, question_id: 'demo-q1' },
        { program_id: 'demo-prog-7c', day_no: 2, question_id: 'demo-q2' },
        { program_id: 'demo-prog-7c', day_no: 3, question_id: 'demo-q3' },
        { program_id: 'demo-prog-7c', day_no: 4, question_id: 'demo-q4' },
        { program_id: 'demo-prog-7c', day_no: 5, question_id: 'demo-q5' }
      ],
      cards: [{
        id: 'demo-c1', title: '카페 마감 알바에서 주문 밀림 해결', exp_type: '아르바이트',
        period_text: '2025년 여름', duration_text: '8개월', place_type: '카페', role: '마감 담당 아르바이트',
        people: '같은 조 알바 1명', situation: '주말 저녁, 주문이 20분 밀림',
        problem: '음료가 늦어 손님 항의가 시작됨', action: '대기 손님께 예상 시간을 먼저 말씀드리고, 제조 순서를 단순 음료부터로 바꿈',
        action_reason: '기다리는 시간 자체보다 "얼마나 걸릴지 모르는 것"이 불만이라고 판단',
        result: '항의가 멈추고 마감까지 추가 컴플레인 없음', others_reaction: '단골 손님이 "말해 줘서 고맙다"고 함',
        change_after: '그 뒤로 밀리기 전에 먼저 안내하는 습관이 생김',
        status: 'verified_student', has_pii: false, origin: 'student', use_count: 0, updated_at: today
      }, {
        id: 'demo-c2', title: '동아리 공연 준비 중 팀원 갈등 조율', exp_type: '동아리·학회',
        period_text: '2024년 겨울', role: '공연 기획 팀장', people: '팀원 6명',
        situation: '공연 2주 전, 곡 순서를 두고 팀이 둘로 갈림',
        problem: '연습이 사흘간 멈춤', action: '양쪽 의견을 각각 따로 듣고, 기준을 "관객 동선"으로 통일하자고 제안',
        action_reason: '누가 옳은지가 아니라 기준이 없는 게 문제라고 봄',
        result: '기준에 맞춰 순서를 다시 짰고 공연은 예정대로 진행',
        others_reaction: '반대하던 팀원이 뒤풀이에서 "기준 얘기가 맞았다"고 함',
        status: 'verified_student', has_pii: false, origin: 'student', use_count: 1, updated_at: today
      }],
      facts: [
        { id: 'demo-f1', card_id: 'demo-c1', content: '주말 저녁 피크에 주문이 20분까지 밀렸다', fact_type: 'when', source: 'student', status: 'user_stated' },
        { id: 'demo-f2', card_id: 'demo-c1', content: '"지금 15분 정도 걸려요, 급하시면 환불도 도와드릴게요"라고 말했다', fact_type: 'quote', source: 'followup', status: 'user_confirmed' }
      ],
      sessions: [
        // 1일차 — 완성된 예시(검수 요청 상태 → review-desk 데모용)
        {
          id: 'demo-s1', program_id: 'demo-prog-7c', day_no: 1, question_id: 'demo-q1',
          state: 'review_requested', selected_cards: ['demo-c1'],
          draft: '주말 저녁 카페 마감 알바 중에 주문이 20분까지 밀린 적이 있습니다. 손님들 항의가 시작됐을 때, 저는 먼저 대기 중인 분들께 예상 시간을 말씀드렸습니다. 기다리는 시간보다 얼마나 걸릴지 모르는 게 더 불안하다고 생각했기 때문입니다. 그리고 제조 순서를 단순 음료부터로 바꿨습니다. 항의가 멈췄고 마감까지 추가 컴플레인은 없었습니다.',
          followup_qa: [{ q: '항의하신 손님께 실제로 뭐라고 말씀하셨나요?', a: '"지금 15분 정도 걸려요, 급하시면 환불도 도와드릴게요"라고 말했어요.' }],
          review_requested_at: today, answer_id: null, chosen_version: 'ai_tone'
        }
      ],
      versions: [],
      tone: { endings: ['~했습니다', '~였어요'], formality: 3, emotion: 2 },
      consents: {},
      answers: []
    };
  }

  function demoLoad() {
    try {
      var raw = localStorage.getItem(DEMO_STATE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    var s = demoSeed();
    demoSave(s);
    return s;
  }
  function demoSave(s) {
    try { localStorage.setItem(DEMO_STATE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function demoReset() {
    try { localStorage.removeItem(DEMO_STATE_KEY); } catch (e) {}
  }
  function uid(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 10); }

  // 데모 AI — 규칙 기반 흉내. 문장·근거 구조는 실서버와 같은 모양으로 돌려준다.
  function demoSplitSentences(text) {
    return String(text || '').split(/(?<=[.!?다요])\s+/).map(function (t) { return t.trim(); }).filter(Boolean);
  }

  var demoStore = {
    mode: 'demo',
    async init() { this.s = demoLoad(); return { mode: 'demo', user: { id: 'demo-user', name: '체험 회원' } }; },
    _save() { demoSave(this.s); },
    reset: demoReset,

    async probe() { return { ok: true, version: 'demo', features: ['recommend', 'followup', 'revise', 'speak'] }; },

    async listPrograms() {
      var s = this.s;
      return s.programs.map(function (p) {
        var enr = s.enrollments.find(function (e) { return e.program_id === p.id; }) || null;
        return { program: p, enrollment: enr };
      });
    },

    async programView(programId) {
      var s = this.s;
      var p = s.programs.find(function (x) { return x.id === programId; });
      if (!p) return { ok: false, code: 'not_found' };
      var enr = s.enrollments.find(function (e) { return e.program_id === programId; }) || null;
      var max = enr ? unlockedMax(p.reveal_policy, p.total_days, enr.started_at) : 0;
      var days = [];
      for (var i = 1; i <= p.total_days; i++) {
        (function (dayNo) {
          var d = s.days.find(function (x) { return x.program_id === programId && x.day_no === dayNo; });
          var sess = s.sessions.find(function (x) { return x.program_id === programId && x.day_no === dayNo; });
          var unlocked = dayNo <= max;
          days.push({
            day_no: dayNo, unlocked: unlocked, has_question: !!(d && d.question_id),
            note: d && d.note,
            session: sess ? { id: sess.id, state: sess.state, answer_id: sess.answer_id } : null,
            question: (unlocked && d && d.question_id) ? s.questions[d.question_id] : null
          });
        })(i);
      }
      return { ok: true, program: p, enrolled: !!enr, staff: false, started_at: enr && enr.started_at, unlocked_max: max, days: days };
    },

    async enrollFree(programId) {
      var s = this.s;
      if (!s.enrollments.some(function (e) { return e.program_id === programId; })) {
        s.enrollments.push({ id: uid('demo-enr'), program_id: programId, member_id: 'demo-user', started_at: kstToday(), status: 'active', source: 'promo' });
        this._save();
      }
      return { ok: true };
    },

    async getOrCreateSession(programId, dayNo, questionId) {
      var s = this.s;
      var sess = s.sessions.find(function (x) { return x.program_id === programId && x.day_no === dayNo; });
      if (!sess) {
        sess = { id: uid('demo-s'), program_id: programId, day_no: dayNo, question_id: questionId || null, state: 'not_started', selected_cards: [], draft: '', followup_qa: [], answer_id: null, chosen_version: null };
        s.sessions.push(sess);
        this._save();
      }
      return sess;
    },

    async updateSession(sessionId, patch) {
      var s = this.s;
      var sess = s.sessions.find(function (x) { return x.id === sessionId; });
      if (!sess) return { error: { message: 'not found' } };
      Object.assign(sess, patch);
      this._save();
      return { data: sess };
    },

    async listCards() { return this.s.cards.filter(function (c) { return c.status !== 'archived'; }); },
    async saveCard(card) {
      var s = this.s;
      if (card.id) {
        var i = s.cards.findIndex(function (c) { return c.id === card.id; });
        if (i >= 0) s.cards[i] = Object.assign({}, s.cards[i], card);
      } else {
        card.id = uid('demo-c'); card.status = card.status || 'draft'; card.use_count = 0; card.origin = 'student';
        s.cards.push(card);
      }
      this._save();
      return { data: card };
    },
    async archiveCard(id) {
      var c = this.s.cards.find(function (x) { return x.id === id; });
      if (c) { c.status = 'archived'; this._save(); }
      return { ok: true };
    },
    async listFacts(cardId) { return this.s.facts.filter(function (f) { return f.card_id === cardId; }); },
    async addFact(fact) { fact.id = uid('demo-f'); fact.status = fact.status || 'user_stated'; this.s.facts.push(fact); this._save(); return { data: fact }; },

    async getTone() { return this.s.tone || {}; },
    async saveTone(data) { this.s.tone = data; this._save(); return { ok: true }; },
    async getConsent(kind) { return !!this.s.consents[kind]; },
    async setConsent(kind, granted) { this.s.consents[kind] = granted; this._save(); return { ok: true }; },

    async versions(sessionId) {
      return this.s.versions.filter(function (v) { return v.session_id === sessionId; });
    },
    async insertVersion(row) {
      row.id = uid('demo-v'); row.created_at = new Date().toISOString();
      this.s.versions.push(row); this._save();
      return { data: row };
    },

    /* ── 데모 AI ── */
    async aiRecommend(sessionId) {
      var s = this.s;
      var sess = s.sessions.find(function (x) { return x.id === sessionId; });
      var q = sess && s.questions[sess.question_id];
      var cards = await this.listCards();
      var qt = q ? q.qtype : 'experience';
      var candidates = cards.map(function (c) {
        var good = (qt === 'conflict' && /갈등|조율/.test(c.title)) ||
                   (qt !== 'conflict' && /해결|알바/.test(c.title));
        return {
          card_id: c.id,
          fit: good ? 'good' : 'partial',
          reason: good ? '질문이 묻는 장면(문제 → 내 행동 → 결과)이 이미 들어 있어요.'
                       : '사실을 한두 개 보태면 이 질문에도 쓸 수 있어요.',
          missing: good ? [] : ['그때 실제로 한 말', '상대의 반응']
        };
      }).slice(0, 3);
      return { ok: true, candidates: candidates, new_card_hint: candidates.length ? '' : '이 질문에는 실제 겪은 장면이 필요해요 — 경험 창고에서 첫 카드를 만들어 보세요.' };
    },

    async aiFollowup(sessionId) {
      var s = this.s;
      var sess = s.sessions.find(function (x) { return x.id === sessionId; });
      var answered = (sess.followup_qa || []).filter(function (p) { return (p.a || '').trim(); }).length;
      if (answered >= 3) return { ok: true, enough: true, questions: [], note: '충분히 모였어요. 이제 초안을 써 볼까요?' };
      var pool = [
        { q: '그 일이 언제, 어디에서 있었나요?', why: '장면이 있어야 답변이 그 사람 이야기가 돼요.' },
        { q: '그때 실제로 뭐라고 말씀하셨나요?', why: '실제 한 말 한 줄이 답변의 설득력을 만들어요.' },
        { q: '상대방(손님·팀원)은 실제로 어떻게 반응했나요?', why: '결과를 부풀리지 않으려면 실제 반응이 필요해요.' },
        { q: '그 방법 말고 고려했던 다른 방법이 있었나요?', why: '왜 그걸 골랐는지가 판단력을 보여줘요.' }
      ];
      return { ok: true, enough: false, questions: pool.slice(answered, answered + 2), note: '' };
    },

    async aiRevise(sessionId) {
      var s = this.s;
      var self = this;
      var sess = s.sessions.find(function (x) { return x.id === sessionId; });
      var draft = (sess.draft || '').trim();
      if (draft.length < 60) return { error: '초안을 60자 이상 써 주세요. 첨삭은 학생의 글에서 시작해요.', code: 'draft_too_short' };
      var q = s.questions[sess.question_id] || null;
      var sents = demoSplitSentences(draft);
      var mk = function (t, ev) { return { text: t, ev: ev, unsupported: ev.length === 0, reason: ev.length ? '' : 'no_evidence' }; };
      var tone = sents.map(function (t) { return mk(t, ['draft']); });
      var deliv = sents.slice().map(function (t) { return mk(t, ['draft']); });
      // 데모 시연: 근거 없는 문장이 어떻게 표시되는지 보여주기 위해 일부러 한 문장을 붙인다.
      deliv.push(mk('이 경험 덕분에 매장 평점이 크게 올랐습니다.', []));
      var qa = (sess.followup_qa || []);
      qa.forEach(function (p, i) {
        if ((p.a || '').trim() && i === 0) tone.push(mk('그때 저는 "' + p.a.replace(/"/g, '').slice(0, 40) + '" 라고 말씀드렸습니다.', ['qa1']));
      });
      var cover = function (arr) { return arr.filter(function (x) { return !x.unsupported; }).length / Math.max(arr.length, 1); };
      var scores = {
        evidence: Math.round(Math.min(cover(tone), cover(deliv)) * 25),
        specificity: /\d/.test(draft) ? 16 : 10, ownership: /저는|제가/.test(draft) ? 13 : 8,
        judgment: /생각|판단|때문/.test(draft) ? 12 : 7, naturalness: 8, fit: q ? 8 : 6, consistency: 5,
        notes: ['실제로 한 말을 따옴표로 한 줄 넣으면 장면이 더 살아나요.', '결과 문장에 확인 가능한 사실을 하나 더 붙여 보세요.']
      };
      var result = {
        ok: true,
        fact_summary: {
          confirmed: sents.slice(0, 3).map(function (t) { return { text: t, ev: ['draft'], unsupported: false }; }),
          missing: ['상대방의 실제 반응 한 가지'], conflicts: []
        },
        fit_check: { fits: true, note: '고른 경험이 질문 의도와 맞아요.' },
        sources: [{ id: 'draft', label: '학생이 직접 쓴 초안', text: draft }].concat(
          qa.filter(function (p) { return (p.a || '').trim(); }).map(function (p, i) {
            return { id: 'qa' + (i + 1), label: '추가 질문에 대한 학생 답', text: 'Q. ' + (p.q || '') + '\nA. ' + p.a };
          })),
        tone_keep: tone, delivery: deliv, scores: scores,
        flags: { cliches_left: [], unsupported_tone: tone.filter(function (x) { return x.unsupported; }).length, unsupported_delivery: deliv.filter(function (x) { return x.unsupported; }).length, overused_cards: [], fit: { fits: true, note: '' }, conflicts: [] },
        followup_practice: (q && q.followups && q.followups.length) ? q.followups : ['그때 가장 어려웠던 건 뭐였나요?'],
        est_seconds: { tone: estSeconds(tone.map(function (x) { return x.text; }).join(' ')), delivery: estSeconds(deliv.map(function (x) { return x.text; }).join(' ')) }
      };
      // 버전 원장에 기록(실서버와 같은 모양)
      var metaCommon = { model: 'demo', prompt_version: 'demo', sources: [{ id: 'draft', label: '학생이 직접 쓴 초안', text: draft }] };
      await self.insertVersion({ session_id: sess.id, member_id: 'demo-user', kind: 'fact_summary', author: 'ai', content: result.fact_summary.confirmed.map(function (f) { return '· ' + f.text; }).join('\n'), meta: Object.assign({}, metaCommon, result.fact_summary) });
      await self.insertVersion({ session_id: sess.id, member_id: 'demo-user', kind: 'ai_tone', author: 'ai', content: tone.map(function (x) { return x.text; }).join(' '), meta: Object.assign({}, metaCommon, { sentences: tone, scores: scores, flags: result.flags }) });
      await self.insertVersion({ session_id: sess.id, member_id: 'demo-user', kind: 'ai_delivery', author: 'ai', content: deliv.map(function (x) { return x.text; }).join(' '), meta: Object.assign({}, metaCommon, { sentences: deliv, scores: scores, flags: result.flags, followup_practice: result.followup_practice }) });
      await self.updateSession(sess.id, { state: 'ai_revised' });
      return result;
    },

    async aiSpeak(sessionId, text) {
      var lines = demoSplitSentences(text).map(function (t) { return t.length > 50 ? t.replace(/,\s*/, ',\n') : t; });
      var out = [];
      lines.forEach(function (l) { l.split('\n').forEach(function (x) { out.push(x.trim()); }); });
      await this.insertVersion({ session_id: sessionId, member_id: 'demo-user', kind: 'speaking', author: 'ai', content: out.join('\n'), meta: { lines: out, tips: ['첫 문장 뒤에 반 박자 쉬세요.'] } });
      return { ok: true, lines: out, tips: ['첫 문장 뒤에 반 박자 쉬세요.', '숫자는 또박또박, 조금 느리게.'], est_seconds: estSeconds(text), cliches: [] };
    },

    async finalize(sessionId, text, extra) {
      var s = this.s;
      var sess = s.sessions.find(function (x) { return x.id === sessionId; });
      var q = s.questions[sess.question_id] || {};
      await this.insertVersion({ session_id: sessionId, member_id: 'demo-user', kind: 'final', author: 'student', content: text, meta: extra || {} });
      var ans = { id: uid('demo-a'), title: q.content || '프로그램 답변', content: text, category: QTYPE_TO_CATEGORY[q.qtype] || null, doc_kind: 'interview', airline: (s.programs[0] || {}).airline || null };
      s.answers.push(ans);
      sess.answer_id = ans.id;
      sess.state = 'finalized';
      (sess.selected_cards || []).forEach(function (cid) {
        var c = s.cards.find(function (x) { return x.id === cid; });
        if (c) c.use_count = (c.use_count || 0) + 1;
      });
      this._save();
      return { ok: true, answer_id: ans.id };
    },

    async requestReview(sessionId) {
      return this.updateSession(sessionId, { state: 'review_requested', review_requested_at: new Date().toISOString() });
    },

    /* ── 연구원(검수) — review-desk ── */
    async isResearcher() { return true; },
    async reviewQueue() {
      var s = this.s;
      return s.sessions
        .filter(function (x) { return x.state === 'review_requested' || x.state === 'researcher_reviewing'; })
        .map(function (x) {
          var q = s.questions[x.question_id] || {};
          var p = s.programs.find(function (pp) { return pp.id === x.program_id; }) || {};
          return { session: x, question: q, program: p, member: { name: '체험 회원' } };
        });
    },
    async reviewDetail(sessionId) {
      var s = this.s;
      var sess = s.sessions.find(function (x) { return x.id === sessionId; });
      if (!sess) return null;
      return {
        session: sess,
        question: s.questions[sess.question_id] || null,
        program: s.programs.find(function (p) { return p.id === sess.program_id; }) || null,
        member: { name: '체험 회원' },
        cards: s.cards.filter(function (c) { return (sess.selected_cards || []).indexOf(c.id) >= 0; }),
        versions: s.versions.filter(function (v) { return v.session_id === sessionId; }),
        codes: null   // null → 화면이 기본 코드 목록을 쓴다
      };
    },
    async claimReview(sessionId) { return this.updateSession(sessionId, { state: 'researcher_reviewing' }); },
    async saveResearcherEdit(sessionId, content, codes, decision) {
      await this.insertVersion({ session_id: sessionId, member_id: 'demo-user', kind: 'researcher_edit', author: 'researcher', content: content, meta: { codes: codes } });
      return this.updateSession(sessionId, { state: decision === 'approve' ? 'approved' : 'revision_requested' });
    }
  };

  /* =============================================================================
   * 실서버 스토어 — Supabase + Edge Function(answer-program)
   * ============================================================================= */
  var realStore = {
    mode: 'real',
    async init() {
      if (!window.MONC || !window.MONC.sb) return { mode: 'real', user: null };
      var session = await MONC.getSession();
      this.userId = session ? session.user.id : null;
      return { mode: 'real', user: session ? session.user : null };
    },

    async probe() {
      try {
        var r = await MONC.sb.functions.invoke('answer-program', { body: { probe: true } });
        return r.data || null;
      } catch (e) { return null; }
    },

    async _fn(body) {
      var r = await MONC.sb.functions.invoke('answer-program', { body: body });
      if (r.error) {
        // non-2xx 면 supabase-js 가 본문을 숨긴다 — 이 함수는 사용자 오류를 200 으로 주므로
        // 여기 걸리는 건 네트워크/배포 문제다.
        return { error: '서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.', code: 'network' };
      }
      return r.data;
    },

    async listPrograms() {
      var out = [];
      var progs = await MONC.sb.from('answer_programs').select('*')
        .eq('visible', true).order('sort_order').order('created_at');
      if (progs.error) { if (isMissingTable(progs.error)) return { notReady: true }; return out; }
      var mine = {};
      if (this.userId) {
        var enr = await MONC.sb.from('program_enrollments').select('*').eq('member_id', this.userId);
        (enr.data || []).forEach(function (e) { mine[e.program_id] = e; });
      }
      (progs.data || []).forEach(function (p) { out.push({ program: p, enrollment: mine[p.id] || null }); });
      return out;
    },

    async programView(programId) {
      var r = await MONC.sb.rpc('ap_program_view', { p_program_id: programId });
      if (r.error) {
        if (isMissingTable(r.error) || /function .*does not exist/i.test(r.error.message || '')) return { ok: false, code: 'not_ready' };
        return { ok: false, code: 'error', message: r.error.message };
      }
      return r.data;
    },

    async enrollFree(programId) {
      var r = await MONC.sb.from('program_enrollments')
        .insert({ program_id: programId, member_id: this.userId, source: 'promo' });
      if (r.error && r.error.code !== '23505') return { ok: false, message: r.error.message };
      return { ok: true };
    },

    async getOrCreateSession(programId, dayNo, questionId) {
      var q = await MONC.sb.from('answer_sessions').select('*')
        .eq('member_id', this.userId).eq('program_id', programId).eq('day_no', dayNo).maybeSingle();
      if (q.data) return q.data;
      var ins = await MONC.sb.from('answer_sessions')
        .insert({ member_id: this.userId, program_id: programId, day_no: dayNo, question_id: questionId || null })
        .select('*').single();
      if (ins.error) {
        // 동시 두 탭이 같이 만들었으면(23505) 다시 읽는다
        if (ins.error.code === '23505') {
          var again = await MONC.sb.from('answer_sessions').select('*')
            .eq('member_id', this.userId).eq('program_id', programId).eq('day_no', dayNo).maybeSingle();
          if (again.data) return again.data;
        }
        return { _error: ins.error };
      }
      return ins.data;
    },

    async updateSession(sessionId, patch) {
      var r = await MONC.sb.from('answer_sessions').update(patch)
        .eq('id', sessionId).eq('member_id', this.userId).select('*').maybeSingle();
      return r.error ? { error: r.error } : { data: r.data };
    },

    async listCards() {
      var r = await MONC.sb.from('experience_cards').select('*')
        .eq('member_id', this.userId).neq('status', 'archived')
        .order('updated_at', { ascending: false });
      if (r.error) return isMissingTable(r.error) ? { notReady: true } : [];
      return r.data || [];
    },
    async saveCard(card) {
      if (card.id) {
        var id = card.id; delete card.id;
        return await MONC.sb.from('experience_cards').update(card).eq('id', id).eq('member_id', this.userId).select('*').single();
      }
      card.member_id = this.userId;
      return await MONC.sb.from('experience_cards').insert(card).select('*').single();
    },
    async archiveCard(id) {
      return await MONC.sb.from('experience_cards').update({ status: 'archived' }).eq('id', id).eq('member_id', this.userId);
    },
    async listFacts(cardId) {
      var r = await MONC.sb.from('experience_facts').select('*').eq('card_id', cardId).order('created_at');
      return r.data || [];
    },
    async addFact(fact) {
      fact.member_id = this.userId;
      return await MONC.sb.from('experience_facts').insert(fact).select('*').single();
    },

    async getTone() {
      var r = await MONC.sb.from('member_tone_profiles').select('data').eq('member_id', this.userId).maybeSingle();
      return (r.data && r.data.data) || {};
    },
    async saveTone(data) {
      return await MONC.sb.from('member_tone_profiles')
        .upsert({ member_id: this.userId, data: data }, { onConflict: 'member_id' });
    },
    async getConsent(kind) {
      var r = await MONC.sb.from('member_consents').select('granted').eq('member_id', this.userId).eq('kind', kind).maybeSingle();
      return !!(r.data && r.data.granted);
    },
    async setConsent(kind, granted) {
      return await MONC.sb.from('member_consents')
        .upsert({ member_id: this.userId, kind: kind, granted: granted, decided_at: new Date().toISOString() }, { onConflict: 'member_id,kind' });
    },

    async versions(sessionId) {
      var r = await MONC.sb.from('answer_versions').select('*').eq('session_id', sessionId).order('created_at');
      return r.data || [];
    },
    async insertVersion(row) {
      row.member_id = this.userId;
      return await MONC.sb.from('answer_versions').insert(row).select('*').single();
    },

    async aiRecommend(sessionId) { return this._fn({ action: 'recommend', sessionId: sessionId }); },
    async aiFollowup(sessionId) { return this._fn({ action: 'followup', sessionId: sessionId }); },
    async aiRevise(sessionId) { return this._fn({ action: 'revise', sessionId: sessionId }); },
    async aiSpeak(sessionId, text) { return this._fn({ action: 'speak', sessionId: sessionId, text: text }); },

    /**
     * 최종 확정 — ① final 버전 기록 ② 답변노트(answers)로 합류 ③ 세션 확정.
     * ⚠️ answers 합류가 이 프로그램과 기존 상품(AI킬러·첨삭)의 연결점이다.
     *    실패해도 확정 자체는 진행하고 화면에 알린다(분류 컬럼 미적용 방어 포함).
     */
    async finalize(sessionId, text, extra) {
      var sess = (await MONC.sb.from('answer_sessions').select('*').eq('id', sessionId).eq('member_id', this.userId).maybeSingle()).data;
      if (!sess) return { ok: false, message: '세션을 찾지 못했어요.' };
      await this.insertVersion({ session_id: sessionId, kind: 'final', author: 'student', content: text, meta: extra || {} });

      var answerId = sess.answer_id || null;
      var q = null;
      if (sess.question_id) {
        // 질문 본문은 RPC 로만 오지만, 제목은 extra 로 전달받는다(비공개 표 직접 조회 불가).
      }
      var title = (extra && extra.question_title) || '매일 답변 프로그램';
      var row = {
        member_id: this.userId, title: title.slice(0, 200), content: text,
        category: (extra && extra.category) || null, doc_kind: 'interview',
        airline: (extra && extra.airline) || null, status: 'final'
      };
      if (answerId) {
        var up = await MONC.sb.from('answers').update({ content: text, updated_at: new Date().toISOString() }).eq('id', answerId).eq('member_id', this.userId);
        if (up.error) answerId = null;
      }
      if (!answerId) {
        var ins = await MONC.sb.from('answers').insert(row).select('id').single();
        if (ins.error) {
          // 분류 3종 미적용 방어(answers.html 과 같은 2단 저장)
          var bare = { member_id: row.member_id, title: row.title, content: row.content };
          ins = await MONC.sb.from('answers').insert(bare).select('id').single();
        }
        if (!ins.error) answerId = ins.data.id;
      }
      var upd = await this.updateSession(sessionId, { state: 'finalized', answer_id: answerId, chosen_version: (extra && extra.chosen) || null });
      if (upd.error) return { ok: false, message: upd.error.message };
      // 경험 사용 횟수 — 중복 사용 경고의 근거(본인 카드라 RLS 통과)
      var cards = sess.selected_cards || [];
      for (var i = 0; i < cards.length; i++) {
        var c = await MONC.sb.from('experience_cards').select('use_count').eq('id', cards[i]).maybeSingle();
        if (c.data) await MONC.sb.from('experience_cards').update({ use_count: (c.data.use_count || 0) + 1 }).eq('id', cards[i]);
      }
      return { ok: true, answer_id: answerId };
    },

    async requestReview(sessionId) {
      return this.updateSession(sessionId, { state: 'review_requested' });
    },

    /* ── 연구원(검수) ── */
    async isResearcher() {
      try {
        var r = await MONC.sb.from('researchers').select('active').eq('member_id', this.userId).maybeSingle();
        if (r.data && r.data.active) return true;
        var p = await MONC.getMyProfile();
        return !!(p && p.role === 'admin');
      } catch (e) { return false; }
    },
    async reviewQueue() {
      var r = await MONC.sb.from('answer_sessions').select('*')
        .in('state', ['review_requested', 'researcher_reviewing'])
        .order('review_requested_at', { ascending: true });
      if (r.error) return isMissingTable(r.error) ? { notReady: true } : [];
      var out = [];
      for (var i = 0; i < (r.data || []).length; i++) {
        var sess = r.data[i];
        var q = sess.question_id
          ? (await MONC.sb.from('interview_questions').select('content, qtype, intent').eq('id', sess.question_id).maybeSingle()).data
          : null;
        var p = (await MONC.sb.from('answer_programs').select('title, airline').eq('id', sess.program_id).maybeSingle()).data;
        var m = (await MONC.sb.from('members').select('name').eq('id', sess.member_id).maybeSingle()).data;
        out.push({ session: sess, question: q || {}, program: p || {}, member: m || { name: '(이름 없음)' } });
      }
      return out;
    },
    async reviewDetail(sessionId) {
      var s = (await MONC.sb.from('answer_sessions').select('*').eq('id', sessionId).maybeSingle()).data;
      if (!s) return null;
      var q = s.question_id
        ? (await MONC.sb.from('interview_questions').select('*').eq('id', s.question_id).maybeSingle()).data : null;
      var p = (await MONC.sb.from('answer_programs').select('*').eq('id', s.program_id).maybeSingle()).data;
      var m = (await MONC.sb.from('members').select('name').eq('id', s.member_id).maybeSingle()).data;
      var cards = [];
      if ((s.selected_cards || []).length) {
        var cr = await MONC.sb.from('experience_cards').select('*').in('id', s.selected_cards);
        cards = cr.data || [];
      }
      var vr = await MONC.sb.from('answer_versions').select('*').eq('session_id', sessionId).order('created_at');
      var codes = await MONC.sb.from('correction_codes').select('*').eq('active', true).order('sort_order');
      return { session: s, question: q, program: p, member: m || { name: '(이름 없음)' }, cards: cards, versions: vr.data || [], codes: codes.data || null };
    },
    async claimReview(sessionId) {
      return await MONC.sb.from('answer_sessions').update({ state: 'researcher_reviewing' }).eq('id', sessionId).select('id').maybeSingle();
    },
    async saveResearcherEdit(sessionId, content, codes, decision) {
      var sess = (await MONC.sb.from('answer_sessions').select('member_id').eq('id', sessionId).maybeSingle()).data;
      if (!sess) return { error: { message: 'not found' } };
      var session2 = await MONC.getSession();
      var v = await MONC.sb.from('answer_versions').insert({
        session_id: sessionId, member_id: sess.member_id, kind: 'researcher_edit',
        author: 'researcher', author_id: session2 ? session2.user.id : null,
        content: content, meta: { codes: codes }
      });
      if (v.error) return { error: v.error };
      return await MONC.sb.from('answer_sessions')
        .update({ state: decision === 'approve' ? 'approved' : 'revision_requested' })
        .eq('id', sessionId).select('id').maybeSingle();
    }
  };

  /* ── 계측 — page_events(있으면 기록, 없으면 조용히) ─────────────────────── */
  function logEvent(name, meta) {
    try {
      if (demoOn() || !window.MONC || !window.MONC.sb) return;
      window.MONC.sb.from('page_events').insert({ name: name, meta: meta || {} }).then(function () {});
    } catch (e) {}
  }

  // ⚠️ 전역 AP 별칭에 기대지 않고 지역 변수로 묶는다 — node vm(검증 스크립트)에서도 돌아야 한다.
  var AP = {
    AIRLINES: AIRLINES, QTYPES: QTYPES, QTYPE_TO_CATEGORY: QTYPE_TO_CATEGORY,
    STATES: STATES, SRC_CONF: SRC_CONF, EXP_TYPES: EXP_TYPES,
    CARD_FIELD_LABELS: CARD_FIELD_LABELS, SCORE_ITEMS: SCORE_ITEMS,
    kstToday: kstToday, unlockedMax: unlockedMax, estSeconds: estSeconds,
    esc: esc, isMissingTable: isMissingTable, totalScore: totalScore,
    demoOn: demoOn, demoReset: demoReset, logEvent: logEvent,
    store: null,
    init: async function () {
      AP.store = demoOn() ? demoStore : realStore;
      return AP.store.init();
    }
  };
  window.AP = AP;
})();

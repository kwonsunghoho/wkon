/* 합격 노하우는 기존 게시판 글과 연결하고, 주제·추천은 전용 RPC로 읽는다. */
(function () {
  'use strict';

  const airlines = ['대한항공', '아시아나항공', '제주항공', '진에어', '트리니티항공', '에어부산',
    '에어서울', '이스타항공', '에어프레미아', '에어로케이', '파라타항공', '국내 공통'];
  const stages = ['서류', '영상', '임원', '최종'];
  const recruitmentPeriods = ['상반기', '중반기', '하반기'];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const listURL = 'community.html?view=experiences';
  const kindLabels = { note:'노하우', request:'노하우 요청' };

  // 공개 본문에 저장된 작성창 레이블이다. 순서나 모양이 다르면 자유글로 읽는다.
  const videoBodyFields = [
    ['지원 횟수', 'attempt'],
    ['첫 지원부터 영상면접 결과까지 걸린 기간', 'duration'],
    ['영상면접 결과', 'result'],
    ['촬영 장소', 'place'],
    ['촬영 세팅', 'setup'],
    ['헤어·메이크업', 'styling'],
    ['의상', 'outfit'],
    ['촬영하면서 가장 많이 고친 점', 'focus'],
    ['영상면접 합격에 도움이 됐다고 느낀 점', 'passImpact'],
    ['다시 찍는다면 바꾸고 싶은 점', 'retryImpact'],
    ['기억나는 영상면접 질문', 'question'],
    ['답변 방향', 'answerDirection'],
    ['영상면접에 다시 도전하는 승준생에게 한마디', 'encouragement'],
    ['추가 내용', 'extra']
  ];
  const specBodyLabels = ['전공', '학점', '어학', '키'];
  const videoResults = ['합격', '미합격', '결과 대기'];
  const attemptCounts = ['첫 지원', '2회', '3회', '4회 이상'];

  async function rpc(name, args) {
    const { data, error } = await MONC.sb.rpc('community_experience_' + name, args);
    if (error) throw error;
    if (!data?.ok) throw new Error('community:bad_experience');
    return data;
  }

  const read = data => rpc('read', { p_data:data });
  const write = (action, data) => rpc('member', { p_action:action, p_data:data });

  const number = new Intl.NumberFormat('ko-KR');
  const visitorStorageKey = 'monc-community-visitor';
  const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
  let visitorId;

  function viewVisitor() {
    if (visitorId) return visitorId;
    try {
      const saved = localStorage.getItem(visitorStorageKey);
      if (uuid.test(saved || '')) return visitorId = saved;
    } catch (_) { /* 브라우저 저장소를 사용할 수 없으면 현재 화면에서만 보관한다. */ }
    visitorId = globalThis.crypto?.randomUUID?.();
    if (visitorId) {
      try { localStorage.setItem(visitorStorageKey, visitorId); } catch (_) {}
    }
    return visitorId;
  }

  function metricsHTML(id) {
    return `<span class="cex-metrics" data-experience-metrics="${escape(id)}" hidden>
      <span data-experience-views></span></span>`;
  }

  function setViews(slot, views) {
    if (views == null || !Number.isSafeInteger(Number(views)) || Number(views) < 0) return;
    slot.querySelector('[data-experience-views]').textContent = '조회 ' + number.format(views);
    slot.hidden = false;
  }

  async function hydrateMetrics(root) {
    if (!root) return;
    const slots = [...root.querySelectorAll('[data-experience-metrics]:not([data-metrics-requested])')];
    const groups = new Map();
    for (const slot of slots) {
      slot.dataset.metricsRequested = '';
      const id = slot.dataset.experienceMetrics;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(slot);
    }
    const ids = [...groups.keys()];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      try {
        const { items } = await rpc('metrics', { p_ids:batch });
        for (const item of items) {
          for (const slot of groups.get(item.id) || []) {
            if (!slot.isConnected) continue;
            setViews(slot, item.views);
          }
        }
      } catch (_) {
        for (const id of batch) {
          for (const slot of groups.get(id)) delete slot.dataset.metricsRequested;
        }
      }
    }
  }

  async function recordView(root, item, count) {
    const slot = root.querySelector('[data-experience-metrics]');
    const visitor = count && viewVisitor();
    if (visitor && slot) {
      try {
        const { views } = await rpc('record_view', { p_id:item.id, p_visit_id:visitor });
        if (slot.isConnected && views != null) {
          setViews(slot, views);
          return;
        }
      } catch (_) { /* 조회수 기록 실패가 읽기를 방해하지 않게 한다. */ }
    }
    hydrateMetrics(root);
  }

  function linkToThread(id, filters = '') {
    const params = new URLSearchParams(filters);
    params.set('view', 'thread');
    params.set('source', 'experiences');
    params.set('id', id);
    return 'community.html?' + params.toString();
  }

  function period(item) {
    return item.recruit_year ? `${item.recruit_year}년${item.half ? ' ' + item.half : ''}` : '';
  }

  function cardPreview(item) {
    const text = String(item.excerpt ?? '').replace(/\r\n?/g, '\n');
    if (item.kind !== 'note' || item.stage !== '영상') return text;
    const first = text.split('\n', 1)[0];
    if (!videoBodyFields.slice(0, 3).some(([label]) => label === first)) return text;
    const result = text.match(/(?:^|\n\n)영상면접 결과\n([^\n]+)(?:\n|$)/)?.[1];
    if (!videoResults.includes(result)) return text;
    const attempt = text.match(/^지원 횟수\n([^\n]+)\n/)?.[1];
    return ['영상면접 ' + result,
      attemptCounts.includes(attempt) ? (attempt === '첫 지원' ? attempt : '지원 ' + attempt) : ''
    ].filter(Boolean).join(' · ');
  }
  function card(item, filters = '', compact = false) {
    const meta = [item.airline, item.stage, period(item)].filter(Boolean).map(escape).join(' · ');
    const voteLabel = item.kind === 'request' ? '저도 궁금해요' : '도움됐어요';
    const count = item.kind === 'request' ? ` · 답변 ${Number(item.answer_count)}개` : '';
    const date = new Date(item.created_at).toLocaleDateString('ko-KR', { timeZone:'Asia/Seoul' });
    const href = escape(linkToThread(item.id, filters));
    return `<article class="cm-post cex-card">
      <div class="cex-meta"><span>${meta}</span>${item.verified ? '<span class="cm-tag" title="항공사·연도 기준">최종합격 확인</span>' : ''}</div>
      <a class="cm-post-title" href="${href}" data-experience-thread="${escape(item.id)}">${escape(item.title)}</a>
      ${compact ? '' : `<p class="cm-post-excerpt">${escape(cardPreview(item))}</p>`}
      <div class="cm-post-foot"><span>${escape(item.nickname)} · ${escape(date)}</span><span class="cex-metrics">
        ${item.kind === 'note' ? metricsHTML(item.id) : ''}<span>${voteLabel} ${number.format(item.votes)}${count}</span>
      </span></div>
    </article>`;
  }

  function homeHTML(items) {
    if (!items.length) return '';
    return `<section class="cm-section" aria-labelledby="cex-home-heading">
      <div class="cm-section-head"><h2 id="cex-home-heading">이번 주 인기 노하우</h2>
        <a class="cm-text-link" href="${listURL}" data-route="experiences">전체 보기 →</a></div>
      <div class="cm-thread-list">${items.slice(0, 3).map(item => card(item, '', true)).join('')}</div>
    </section>`;
  }

  function select(name, label, options, value, placeholder, required = false, idPrefix = 'cex') {
    const id = idPrefix + '-' + name;
    return `<div class="cm-field"><label class="cm-label" for="${id}">${label}</label>
      <select id="${id}" name="${name}" ${required ? 'required' : ''}>
        <option value="">${placeholder}</option>
        ${options.map(option => {
          const [key, text] = Array.isArray(option) ? option : [option, option];
          return `<option value="${escape(key)}" ${String(key) === String(value) ? 'selected' : ''}>${escape(text)}</option>`;
        }).join('')}
      </select></div>`;
  }

  function years(selected) {
    const current = Number(new Intl.DateTimeFormat('en', { year:'numeric', timeZone:'Asia/Seoul' }).format(new Date()));
    const oldest = Math.min(current - 8, Number(selected) || current);
    return Array.from({ length:current - Math.max(2000, oldest) + 1 }, (_, index) =>
      [String(current - index), `${current - index}년`]);
  }

  function filtersFrom(values) {
    const choice = (name, allowed) => allowed.includes(values.get(name)) ? values.get(name) : '';
    const period = values.get('period') || '';
    const [year, half] = period.split('-');
    const kind = values.get('kind') === 'request' ? 'request' : 'note';
    return {
      kind,
      q:(values.get('q') || '').trim().slice(0, 120),
      airline:choice('airline', airlines),
      stage:choice('stage', stages),
      year:/^20\d{2}$|^2100$/.test(year) ? year : '',
      half:recruitmentPeriods.includes(half) && /^\d{4}$/.test(year) ? half : '',
      recent:period === 'recent',
      verified:kind === 'note' && values.get('verified') === '1',
      sort:values.get('sort') === 'latest' ? 'latest' : 'popular'
    };
  }

  function periodOptions(filters) {
    const options = [['recent', '최근 1년']];
    for (const [year, label] of years(filters.year)) {
      options.push([year, label], ...recruitmentPeriods.map(period => [year + '-' + period, label + ' ' + period]));
    }
    return options;
  }

  function paramsFor(filters) {
    const params = new URLSearchParams({ view:'experiences' });
    for (const key of ['q', 'airline', 'stage']) {
      if (filters[key]) params.set(key, filters[key]);
    }
    if (filters.kind === 'request') params.set('kind', 'request');
    if (filters.sort === 'latest') params.set('sort', 'latest');
    if (filters.verified) params.set('verified', '1');
    if (filters.recent || filters.year) params.set('period', filters.recent ? 'recent' : [filters.year, filters.half].filter(Boolean).join('-'));
    return params;
  }

  function mount(main, openForm) {
    let filters = filtersFrom(new URLSearchParams(location.search));
    let offset = 0, revision = 0;
    main.innerHTML = `<div class="cm-filter-tabs cex-tabs" role="group" aria-label="글 종류">
      <button type="button" data-experience-kind="note">정보·노하우</button>
      <button type="button" data-experience-kind="request">노하우 요청</button>
    </div>
    <form class="cex-filters" aria-label="합격 노하우 검색과 필터">
      <div class="cm-search"><label for="cex-q" class="cm-sr-only">합격 노하우 검색</label>
        <input id="cex-q" class="cm-input" name="q" maxlength="120" value="${escape(filters.q)}" placeholder="전형 정보와 준비법 검색">
        <button class="cm-btn-ghost" type="submit">검색</button></div>
      <div class="cex-pair">
        ${select('airline', '항공사', airlines, filters.airline, '전체 항공사')}
        ${select('stage', '전형', stages, filters.stage, '전체 전형')}
      </div>
      <details ${filters.year || filters.recent || filters.verified ? 'open' : ''}>
        <summary>상세 필터 <span data-experience-filter-count></span></summary>
        ${select('period', '채용 시기', periodOptions(filters), filters.recent ? 'recent' : [filters.year, filters.half].filter(Boolean).join('-'), '전체 시기')}
        <label class="cm-check cex-verified-filter"><input type="checkbox" name="verified" value="1" ${filters.verified ? 'checked' : ''}>최종합격 확인 글</label>
      </details>
      <div class="cm-toolbar cex-toolbar">
        <label for="cex-sort" class="cm-sr-only">정렬</label>
        <select id="cex-sort" name="sort"><option value="popular">인기순</option><option value="latest">최신순</option></select>
        <button type="button" class="cm-btn" data-experience-compose></button>
      </div>
    </form>
    <div class="cm-thread-list" data-experience-results></div>
    <button type="button" class="cm-btn-ghost cex-more" data-experience-more hidden>더 보기</button>`;

    const form = main.querySelector('.cex-filters');
    const results = main.querySelector('[data-experience-results]');
    const more = main.querySelector('[data-experience-more]');
    const compose = main.querySelector('[data-experience-compose]');
    const verified = form.elements.verified;
    const rendered = new Set();
    let ready = false;
    form.elements.sort.value = filters.sort;

    function syncControls() {
      main.querySelectorAll('[data-experience-kind]').forEach(button =>
        button.setAttribute('aria-pressed', String(button.dataset.experienceKind === filters.kind)));
      compose.textContent = filters.kind === 'request' ? '노하우 요청하기' : '노하우 공유하기';
      verified.disabled = filters.kind === 'request';
      verified.closest('label').hidden = verified.disabled;
      const count = Number(Boolean(filters.year || filters.recent)) + Number(filters.verified);
      form.querySelector('[data-experience-filter-count]').textContent = count ? `${count}개 적용` : '';
    }

    function emptyHTML() {
      if (filters.kind === 'request') return '<div class="cm-empty"><b>조건에 맞는 요청이 없어요.</b>궁금한 경험을 첫 요청으로 남겨보세요.</div>';
      return `<div class="cm-empty"><b>조건에 맞는 글이 없어요.</b>
        <button type="button" class="cm-btn-ghost" data-experience-request>이 주제 노하우 요청</button></div>`;
    }

    async function load(append = false) {
      const turn = ++revision;
      if (!append) {
        offset = 0;
        rendered.clear();
        results.innerHTML = '<p role="status">불러오는 중입니다.</p>';
      }
      more.hidden = true;
      try {
        const data = await read({ ...filters, offset });
        if (turn !== revision || !main.isConnected) return;
        const items = data.items.slice(0, data.limit);
        const params = paramsFor(filters);
        const cards = [];
        for (const item of items) {
          if (rendered.has(item.id)) continue;
          rendered.add(item.id);
          cards.push(card(item, params));
        }
        if (append) results.insertAdjacentHTML('beforeend', cards.join(''));
        else results.innerHTML = cards.join('') || emptyHTML();
        hydrateMetrics(results);
        offset += items.length;
        more.hidden = data.items.length <= data.limit;
        ready = true;
      } catch (error) {
        if (turn !== revision || !main.isConnected) return;
        const unavailable = error?.code === 'PGRST202';
        const message = unavailable ? '합격 노하우 게시판을 준비하고 있어요.' : '목록을 불러오지 못했어요.';
        const feedback = `<div class="cm-empty" role="status"><b>${message}</b>${unavailable ? '' : '<button type="button" class="cm-btn-ghost" data-experience-retry>다시 불러오기</button>'}</div>`;
        if (append) more.hidden = false;
        else results.innerHTML = feedback;
        ready = !unavailable;
      } finally {
        if (turn === revision) compose.disabled = !ready;
      }
    }

    function change(kind = filters.kind) {
      const values = new FormData(form);
      values.set('kind', kind);
      filters = filtersFrom(values);
      history.replaceState(null, '', 'community.html?' + paramsFor(filters).toString());
      syncControls();
      return load();
    }

    form.addEventListener('submit', event => { event.preventDefault(); change(); });
    form.addEventListener('change', event => { if (event.target.matches('select, input[type=checkbox]')) change(); });
    main.addEventListener('click', event => {
      const node = event.target.closest('button');
      if (!node || node.disabled) return;
      if (node.hasAttribute('data-experience-more')) load(true);
      if (node.hasAttribute('data-experience-retry')) load();
      if (node.dataset.experienceKind && node.dataset.experienceKind !== filters.kind) change(node.dataset.experienceKind);
      if (node.hasAttribute('data-experience-compose') || node.hasAttribute('data-experience-request')) {
        const kind = node.hasAttribute('data-experience-request') ? 'request' : filters.kind;
        openForm(node, { ...filters, recruit_year:filters.year, kind });
      }
    });
    syncControls();
    compose.disabled = true;
    load();
  }

  function applicantForm(specs, field) {
    return `<fieldset class="cex-applicant-form">
      <legend>지원 당시 스펙 (선택)</legend>
      <p class="cm-help">입력한 항목은 게시글에 공개돼요.</p>
      <div class="cex-pair">
        ${field('spec_major','전공',specs.major,'text',80)}
        ${field('spec_gpa','학점',specs.gpa,'text',24)}
      </div>
      <div class="cex-pair">
        ${field('spec_language','어학 스펙',specs.language,'text',120)}
        ${field('spec_height','키 (cm)',specs.height,'text',24)}
      </div>
    </fieldset>`;
  }

  function videoForm(values, field, choice) {
    const input = (name,label,type='textarea',max=500,required=false) =>
      field('video_'+name,label,values[name] || '',type,max,required);
    const pick = (name,label,entries,prompt,required=false) =>
      choice('video_'+name,label,entries,values[name],prompt,required);
    return `<fieldset class="cex-video-form" data-cex-video hidden disabled>
      <legend>영상면접 준비와 결과</legend>
      <div class="cex-pair">
        ${pick('result','영상면접 결과',videoResults,'결과 선택',true)}
        ${pick('attempt','지원 횟수',attemptCounts,'횟수 선택')}
      </div>
      ${input('duration','첫 지원부터 걸린 기간','text',80)}
      ${input('focus','촬영하면서 가장 많이 고친 건 무엇인가요?','textarea',500,true)}
      <div class="cex-video-group">
        <h3>촬영 준비</h3>
        ${input('place','어디에서 촬영했나요?','text',120)}
        ${input('setup','도움이 된 카메라·조명 세팅')}
        ${input('styling','헤어·메이크업은 어떻게 했나요?')}
        ${input('outfit','어떤 의상을 입었나요?')}
      </div>
      <div class="cex-video-group">
        <h3>답변과 느낀 점</h3>
        ${input('question','기억나는 질문 1개','text',500)}
        ${input('answer_direction','그 질문에 어떻게 답했나요?')}
        ${input('impact','영상면접 합격에 도움이 됐다고 느낀 점은 무엇인가요?')}
        ${input('encouragement','영상면접에 다시 도전하는 승준생에게 한마디')}
      </div>
    </fieldset>`;
  }

  function nicknameProblem(value) {
    const name=value.trim();
    if (!name) return '글에 표시할 닉네임을 입력해 주세요.';
    if ([...name].length<2 || [...name].length>16 || /[<>@\p{Cc}]/u.test(name)) return '닉네임을 2~16자로 입력해 주세요. <, >, @는 사용할 수 없어요.';
    return '';
  }

  function mountPostForm(form) {
    const {stage,body,author_nickname:nickname,video_result:result}=form.elements;
    const video=form.querySelector('[data-cex-video]');
    const warning=form.querySelector('#cex-nickname-warning');
    function syncVideo() {
      const shown=Boolean(video && stage.value==='영상');
      if (video) {
        video.hidden=!shown;
        video.disabled=!shown;
        form.querySelector('[for=f-video_impact]').textContent=result.value==='합격'
          ? '영상면접 합격에 도움이 됐다고 느낀 점은 무엇인가요?'
          : '다시 찍는다면 뭘 바꾸고 싶나요?';
      }
      body.required=!shown;
      form.querySelector('[for=f-body]').textContent=shown?'추가로 남길 내용 (선택)':'내용';
      form.querySelector('[data-cex-body-prompt]').hidden=shown;
    }
    function checkNickname(show) {
      const problem=nicknameProblem(nickname.value);
      nickname.setCustomValidity(problem);
      if (!show) return;
      warning.textContent=problem;
      warning.hidden=!problem;
      if (problem) nickname.setAttribute('aria-invalid','true');
      else nickname.removeAttribute('aria-invalid');
    }
    nickname.addEventListener('input',()=>checkNickname(!warning.hidden));
    nickname.addEventListener('invalid',event=>{
      event.preventDefault();
      checkNickname(true);
      nickname.focus();
    });
    stage.addEventListener('change',syncVideo);
    result?.addEventListener('change',syncVideo);
    syncVideo();
    checkNickname(false);
  }

  function postForm(item, fields) {
    const { field } = fields;
    const request = item.kind === 'request';
    const formSelect = (name, label, entries, value, prompt, required) =>
      select(name, label, entries, value, prompt, required, 'cex-write');
    const prompt = request ? '어떤 전형 정보나 준비법이 궁금한지 적어 주세요.' : '도움이 됐던 지원 정보나 준비 방법을 구체적으로 적어 주세요.';
    const html = `<input type="hidden" name="id" value="${escape(item.id || '')}">
      <input type="hidden" name="kind" value="${request ? 'request' : 'note'}">
      <input type="hidden" name="request_id" value="${escape(item.request_id || '')}">
      <div class="cm-field">
        <label class="cm-label" for="cex-author-nickname">공개 닉네임</label>
        <input id="cex-author-nickname" name="author_nickname" type="text" maxlength="16" required
          value="${escape(item.nickname || '')}" aria-describedby="cex-nickname-help cex-nickname-warning">
        <p class="cm-help" id="cex-nickname-help">이 글에 표시되는 이름이에요.</p>
        <p class="cm-form-error" id="cex-nickname-warning" role="alert" hidden></p>
      </div>
      ${field('title', '제목', item.title || '', 'text', 100, true)}
      <div class="cex-pair">
        ${formSelect('airline', '항공사', airlines, item.airline, '항공사 선택', true)}
        ${formSelect('stage', '전형', stages, item.stage, '전형 선택', true)}
      </div>
      <div class="cex-pair">
        ${formSelect('year', '채용 연도 (선택)', years(item.recruit_year), item.recruit_year, '연도 선택')}
        ${formSelect('half', '채용 시기 (선택)', recruitmentPeriods, item.half, '시기 선택')}
      </div>
      ${request?'':applicantForm(item.applicant_specs || {},field)}
      ${request?'':videoForm(item.video_fields || {},field,formSelect)}
      <p class="cm-help" data-cex-body-prompt>${prompt}</p>${field('body', '내용', item.body || '', 'textarea', 10000, true)}
      <p class="cm-help">글은 누구나 읽을 수 있어요. 연락처·인증 자료·자소서 원문은 빼고 작성해 주세요.</p>`;
    return { label:item.id ? kindLabels[item.kind] + ' 수정' : request ? '노하우 요청하기' : '노하우 공유하기', html };
  }

  function splitApplicantSpecs(text) {
    const heading = '지원 당시 스펙\n';
    const separator = text.lastIndexOf('\n\n' + heading);
    const start = separator >= 0 ? separator + 2 : text.startsWith(heading) ? 0 : -1;
    if (start < 0) return { text, specs:[] };
    const lines = text.slice(start + heading.length).split('\n');
    const specs = [];
    let previous = -1;
    for (const line of lines) {
      const delimiter = line.indexOf(': ');
      const label = line.slice(0, delimiter);
      const value = line.slice(delimiter + 2);
      const index = specBodyLabels.indexOf(label);
      if (delimiter < 0 || index <= previous || !value.trim()) return { text, specs:[] };
      specs.push([label === '어학' ? '어학 스펙' : label, value]);
      previous = index;
    }
    return { text:separator >= 0 ? text.slice(0, separator) : '', specs };
  }

  function videoAnswers(text) {
    const answers = {};
    let last = -1;
    for (const chunk of text.split('\n\n')) {
      const newline = chunk.indexOf('\n');
      const heading = newline < 0 ? '' : chunk.slice(0, newline);
      const index = videoBodyFields.findIndex(([label]) => label === heading);
      if (index < 0) {
        if (last < 0) return null;
        answers[videoBodyFields[last][1]] += '\n\n' + chunk;
        continue;
      }
      if (index <= last) return null;
      answers[videoBodyFields[index][1]] = chunk.slice(newline + 1);
      last = index;
    }
    if (Object.values(answers).some(value => !value.trim()) || !videoResults.includes(answers.result) || !answers.focus) return null;
    if ((answers.attempt && !attemptCounts.includes(answers.attempt))
        || (answers.passImpact && answers.result !== '합격')
        || (answers.retryImpact && answers.result === '합격')) return null;
    return answers;
  }

  function paragraphs(text) {
    return text.trim().split(/\n(?:[ \t]*\n)+/).filter(Boolean)
      .map(paragraph => '<p>' + escape(paragraph) + '</p>').join('');
  }

  function readingSection(title, content, modifier = '') {
    return content ? `<section class="cex-reading-section${modifier ? ' ' + modifier : ''}"><h3>${title}</h3>${content}</section>` : '';
  }

  function readingFields(fields, grid = false) {
    const items = fields.filter(([, value]) => value).map(([label, value]) =>
      `<div><dt>${label}</dt><dd>${paragraphs(value)}</dd></div>`).join('');
    return items ? `<dl class="cex-reading-fields${grid ? ' cex-reading-grid' : ''}">${items}</dl>` : '';
  }

  function readingBodyHTML(item, body) {
    const original = String(body ?? '').replace(/\r\n?/g, '\n').trim();
    const { text, specs } = splitApplicantSpecs(original);
    const video = item.stage === '영상' ? videoAnswers(text) : null;
    const profile = readingSection('지원 당시 스펙', readingFields(specs, true));
    if (!video) return `<div class="cex-reading-content">
      ${text ? `<div class="cex-reading-prose">${paragraphs(text)}</div>` : ''}${profile}</div>`;

    const summary = readingFields([
      ['영상면접 결과', video.result], ['지원 횟수', video.attempt], ['소요 기간', video.duration]
    ], true);
    const keyPoints = readingFields([
      ['촬영하면서 가장 많이 고친 점', video.focus],
      ['합격에 도움이 됐다고 느낀 점', video.passImpact],
      ['다시 찍는다면 바꾸고 싶은 점', video.retryImpact]
    ]);
    const setup = readingFields([
      ['촬영 장소', video.place], ['카메라·조명 세팅', video.setup],
      ['헤어·메이크업', video.styling], ['의상', video.outfit]
    ]);
    const interview = readingFields([
      ['기억나는 질문', video.question], ['답변 방향', video.answerDirection]
    ]);
    return `<div class="cex-reading-content">
      <div class="cex-reading-summary" role="group" aria-label="지원 결과 요약">${summary}</div>
      ${readingSection('핵심 노하우', keyPoints, 'cex-reading-key')}
      ${readingSection('촬영 준비', setup)}
      ${readingSection('면접 질문과 답변', interview)}
      ${profile}
      ${readingSection('추가 내용', paragraphs(video.extra || ''))}
      ${readingSection('다시 도전하는 승준생에게', paragraphs(video.encouragement || ''), 'cex-reading-encouragement')}
    </div>`;
  }
  function threadHTML(item) {
    if (!item) return '';
    const request = item.kind === 'request';
    const label = request ? '저도 궁금해요' : '도움됐어요';
    const origin = item.request_id ? `<p class="cex-reference"><a href="${escape(linkToThread(item.request_id))}" data-experience-thread="${escape(item.request_id)}">답변한 요청 · ${escape(item.request_title)}</a></p>` : '';
    return `${origin}<div class="cm-wrap cex-thread-actions">
      <button type="button" class="cm-btn-ghost cex-vote" data-action="experience-vote" data-id="${escape(item.id)}"
        aria-pressed="${Boolean(item.voted)}" ${item.mine ? 'disabled' : ''}>${label} <span data-experience-vote-count>${number.format(item.votes)}</span></button>
      ${request ? '<button type="button" class="cm-btn" data-action="experience-answer">관련 노하우 공유하기</button>' : ''}</div>`;
  }

  async function item(id) {
    return (await read({ id })).items[0] || null;
  }

  function updateVote(button, item, active, votes) {
    item.voted = active;
    item.votes = votes;
    button.setAttribute('aria-pressed', String(active));
    button.querySelector('[data-experience-vote-count]').textContent = number.format(votes);
  }

  async function vote(id, active) { await write('vote', { id, active }); }

  async function save(data) {
    const entries=Object.entries(data);
    const writtenFields=prefix=>Object.fromEntries(entries
      .filter(([key,value])=>key.startsWith(prefix) && value.trim())
      .map(([key,value])=>[key.slice(prefix.length),value.trim()]));
    const draft=Object.fromEntries(entries.filter(([key])=>!key.startsWith('video_') && !key.startsWith('spec_')));
    draft.author_nickname=draft.author_nickname.trim();
    const video=draft.kind==='note' && draft.stage==='영상';
    if (draft.title.trim().length<2 || (!video && draft.body.trim().length<2)) throw new Error('check constraint');
    if (draft.half && !draft.year) throw new Error('community:experience_year_required');
    if (video) draft.video_fields=writtenFields('video_');
    if (draft.kind==='note') draft.applicant_specs=writtenFields('spec_');
    return rpc('author',{p_action:'save',p_data:draft});
  }

  async function draft(id) {
    return (await rpc('author',{p_action:'draft',p_data:{id}})).item;
  }

  window.MONCExperiences = {
    mount, homeHTML, item, vote, save, draft, postForm, mountPostForm, threadHTML, readingBodyHTML, period,
    metricsHTML, hydrateMetrics, recordView, updateVote,
    popular:() => read({ sort:'popular', popular_only:true, limit:3 }),
    answers:async request_id => (await read({ request_id, limit:20 })).items.slice(0, 20),
    answersHTML:(items, params) => items.length ? `<section class="cm-section"><div class="cm-section-head"><h2>공유된 노하우</h2></div>
      <div class="cm-thread-list">${items.map(item => card(item, params)).join('')}</div></section>` : ''
  };
})();

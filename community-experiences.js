/* 합격 노하우는 기존 게시판 글과 연결하고, 주제·추천은 전용 RPC로 읽는다. */
(function () {
  'use strict';

  const airlines = ['대한항공', '아시아나항공', '제주항공', '진에어', '트리니티항공', '에어부산',
    '에어서울', '이스타항공', '에어프레미아', '에어로케이', '파라타항공', '국내 공통'];
  const stages = ['서류', '영상', '임원', '최종'];
  const subjects = ['자소서 소재', '답변 구성', '보이스', '이미지', '재지원'];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const listURL = 'community.html?view=experiences';
  const kindLabels = { note:'노하우', request:'노하우 요청' };

  async function rpc(name, args) {
    const { data, error } = await MONC.sb.rpc('community_experience_' + name, args);
    if (error) throw error;
    if (!data?.ok) throw new Error('community:bad_experience');
    return data;
  }

  const read = data => rpc('read', { p_data:data });
  const write = (action, data) => rpc('member', { p_action:action, p_data:data });

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

  function card(item, filters = '', compact = false) {
    const meta = [item.airline, item.stage, period(item)].filter(Boolean).map(escape).join(' · ');
    const voteLabel = item.kind === 'request' ? '저도 궁금해요' : '도움됐어요';
    const count = item.kind === 'request' ? ` · 답변 ${Number(item.answer_count)}개` : '';
    const date = new Date(item.created_at).toLocaleDateString('ko-KR', { timeZone:'Asia/Seoul' });
    const href = escape(linkToThread(item.id, filters));
    return `<article class="cm-post cex-card">
      <div class="cex-meta"><span>${meta}</span>${item.verified ? '<span class="cm-tag" title="항공사·연도 기준">최종합격 확인</span>' : ''}</div>
      <a class="cm-post-title" href="${href}" data-experience-thread="${escape(item.id)}">${escape(item.title)}</a>
      ${compact ? '' : `<p class="cm-post-excerpt">${escape(item.excerpt)}</p>`}
      <div class="cm-post-foot"><span>${escape(item.nickname)} · ${escape(date)}</span><span>${voteLabel} ${Number(item.votes)}${count}</span></div>
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
      subject:choice('subject', subjects),
      year:/^20\d{2}$|^2100$/.test(year) ? year : '',
      half:['상반기', '하반기'].includes(half) && /^\d{4}$/.test(year) ? half : '',
      recent:period === 'recent',
      verified:kind === 'note' && values.get('verified') === '1',
      sort:values.get('sort') === 'latest' ? 'latest' : 'popular'
    };
  }

  function periodOptions(filters) {
    const options = [['recent', '최근 1년']];
    for (const [year, label] of years(filters.year)) {
      options.push([year, label], [year + '-상반기', label + ' 상반기'], [year + '-하반기', label + ' 하반기']);
    }
    return options;
  }

  function paramsFor(filters) {
    const params = new URLSearchParams({ view:'experiences' });
    for (const key of ['q', 'airline', 'stage', 'subject']) {
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
      <details ${filters.subject || filters.year || filters.recent || filters.verified ? 'open' : ''}>
        <summary>상세 필터 <span data-experience-filter-count></span></summary>
        <div class="cex-pair">
          ${select('subject', '준비 고민', subjects, filters.subject, '전체 주제')}
          ${select('period', '채용 시기', periodOptions(filters), filters.recent ? 'recent' : [filters.year, filters.half].filter(Boolean).join('-'), '전체 시기')}
        </div>
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
      const count = Number(Boolean(filters.subject)) + Number(Boolean(filters.year || filters.recent)) + Number(filters.verified);
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

  function postForm(item, fields) {
    const { field } = fields;
    const request = item.kind === 'request';
    const formSelect = (name, label, entries, value, prompt, required) =>
      select(name, label, entries, value, prompt, required, 'cex-write');
    const prompt = request ? '어떤 전형 정보나 준비법이 궁금한지 적어 주세요.' : '도움이 됐던 지원 정보나 준비 방법을 구체적으로 적어 주세요.';
    const html = `<input type="hidden" name="id" value="${escape(item.id || '')}">
      <input type="hidden" name="kind" value="${request ? 'request' : 'note'}">
      <input type="hidden" name="request_id" value="${escape(item.request_id || '')}">
      ${field('title', '제목', item.title || '', 'text', 100, true)}
      <div class="cex-pair">
        ${formSelect('airline', '항공사', airlines, item.airline, '항공사 선택', true)}
        ${formSelect('stage', '전형', stages, item.stage, '전형 선택', true)}
      </div>
      <div class="cex-pair">
        ${formSelect('year', '채용 연도 (선택)', years(item.recruit_year), item.recruit_year, '연도 선택')}
        ${formSelect('half', '채용 시기 (선택)', ['상반기', '하반기'], item.half, '시기 선택')}
      </div>
      ${formSelect('subject', '준비 고민 (선택)', subjects, item.subject, '주제 선택')}
      <p class="cm-help">${prompt}</p>${field('body', '내용', item.body || '', 'textarea', 10000, true)}
      <p class="cm-help">글은 누구나 읽을 수 있어요. 연락처·인증 자료·자소서 원문은 빼고 작성해 주세요.</p>`;
    return { label:item.id ? kindLabels[item.kind] + ' 수정' : request ? '노하우 요청하기' : '노하우 공유하기', html };
  }

  function threadHTML(item) {
    if (!item) return '';
    const request = item.kind === 'request';
    const label = request ? '저도 궁금해요' : '도움됐어요';
    const origin = item.request_id ? `<p class="cex-reference"><a href="${escape(linkToThread(item.request_id))}" data-experience-thread="${escape(item.request_id)}">답변한 요청 · ${escape(item.request_title)}</a></p>` : '';
    return `${origin}<div class="cm-wrap cex-thread-actions">
      <button type="button" class="cm-btn-ghost cex-vote" data-action="experience-vote" data-id="${escape(item.id)}"
        aria-pressed="${Boolean(item.voted)}" ${item.mine ? 'disabled' : ''}>${label} <span>${Number(item.votes)}</span></button>
      ${request ? '<button type="button" class="cm-btn" data-action="experience-answer">관련 노하우 공유하기</button>' : ''}</div>`;
  }

  async function item(id) {
    return (await read({ id })).items[0] || null;
  }

  async function vote(id, active) { await write('vote', { id, active }); }

  async function save(data) {
    if (data.title.trim().length < 2 || data.body.trim().length < 2) throw new Error('check constraint');
    if (data.half && !data.year) throw new Error('community:experience_year_required');
    return write('save', data);
  }

  window.MONCExperiences = {
    mount, homeHTML, item, vote, save, postForm, threadHTML, period,
    popular:() => read({ sort:'popular', popular_only:true, limit:3 }),
    answers:async request_id => (await read({ request_id, limit:20 })).items.slice(0, 20),
    answersHTML:(items, params) => items.length ? `<section class="cm-section"><div class="cm-section-head"><h2>공유된 노하우</h2></div>
      <div class="cm-thread-list">${items.map(item => card(item, params)).join('')}</div></section>` : ''
  };
})();

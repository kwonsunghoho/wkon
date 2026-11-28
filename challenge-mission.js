(() => {
  'use strict';
  const root = document.getElementById('mission-content');
  const notice = document.getElementById('mission-notice');
  const push = document.getElementById('mission-push');
  const schedule = document.getElementById('mission-schedule');
  const drafts = new Map();
  const lastInWeek = new Map();
  const picker = document.getElementById('mission-cohort');
  const kinds = {
    voice:{label:'보신각',audio:true,task:'처음·마지막 음성 제출',hint:'챌린지 시작과 마지막에 음성을 한 번씩 제출해요.'},
    spinning:{label:'스피닝',audio:true,task:'처음·마지막 음성 제출',hint:'첫날에는 음성 두 개를, 마지막 날에는 음성 한 개를 제출해요.'},
    expression:{label:'영합각',task:'처음·마지막 영상 제출',hint:'시작과 마지막에 촬영한 영상을 각각 제출해요.'},
    answer:{label:'승자각',task:'DAY별 승준노트 열기',hint:'오늘의 공식 문항을 열고 승준노트에 답변을 작성해요.'}
  };
  let week = 1, revision = 0, scheduleTimer, dueAt = 0, offset = 0, homeVersion = 0;
  let routing = false, requestingMic = false, visibleURL = location.href;
  const maxAudio = 20 * 1024 * 1024;
  const bucketName = 'challenge-room-audio';
  const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  const formats = { webm:'audio/webm', ogg:'audio/ogg', mp4:'audio/mp4', m4a:'audio/mp4', mp3:'audio/mpeg', wav:'audio/wav' };
  const mimeExt = { 'audio/webm':'webm', 'audio/ogg':'ogg', 'audio/mp4':'m4a', 'audio/x-m4a':'m4a',
    'audio/mpeg':'mp3', 'audio/wav':'wav', 'audio/x-wav':'wav' };
  let session, home, current, activeCohort, draft, recorder, stream, recordingTask = 0;
  let busy = false;
  const esc = val => String(val ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[ch]);
  const missionLink = id => 'challenge-mission.html?id=' + encodeURIComponent(id);
  const challengeOf = row => row?.challenge || 'voice';
  const family = row => kinds[challengeOf(row)];
  const keyOf = row => row ? challengeOf(row)+':'+row.round : '';
  const labelOf = row => (family(row)?.label || '챌린지')+' '+row.round+'기';
  const roundLink = (row,history=false) => {
    const p = new URLSearchParams();
    if (history) p.set('view','history');
    if (row) { p.set('challenge',challengeOf(row)); p.set('round',row.round); }
    return 'challenge-mission.html' + (p.size ? '?' + p : '');
  };

  function cohortOptions(history) {
    const unique = new Map();
    const rows = history ? [...home.cohorts,...home.history] : [...home.cohorts];
    for (const row of rows) if (family(row) && !unique.has(keyOf(row))) unique.set(keyOf(row),row);
    return [...unique.values()];
  }
  function updatePicker(scope,isHistory) {
    const choices = cohortOptions(isHistory);
    picker.replaceChildren();
    if (isHistory || !scope || !choices.some(c=>keyOf(c)===keyOf(scope))) picker.add(new Option(isHistory?'모든 챌린지':'챌린지 선택',''));
    for (const c of choices) picker.add(new Option(labelOf(c),keyOf(c)));
    picker.value = scope ? keyOf(scope) : '';
    picker.dataset.previous = picker.value;
    picker.closest('label').hidden = !choices.length || (choices.length===1 && keyOf(choices[0])===keyOf(scope));
    document.getElementById('mission-link').href=roundLink(scope);
    document.getElementById('history-link').href=roundLink(scope,true);
  }
  const dateLabel = raw => {
    const date = new Date(raw);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', month:'long', day:'numeric', weekday:'short'}).format(date);
  };
  const textError = (node, message) => { node.textContent = message; };
  const newDraft = () => ({ file:null, extension:null, url:null, requestId:crypto.randomUUID(), uploaded:false });
  const storage = () => MONC.sb.storage.from(bucketName);

  async function rpc(action, data = {}) {
    const {data:result, error} = await MONC.sb.rpc('challenge_room', {p_action:action, p_data:data});
    if (error) throw error;
    return result;
  }

  function freshDraft() {
    if (draft?.url) URL.revokeObjectURL(draft.url);
    draft = newDraft();
  }

  function releaseMic() {
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  function showPush(cohort) {
    push.hidden = !cohort || !window.ChallengePush;
    if (push.hidden) return;
    root.firstElementChild?.after(push);
    const key = keyOf(cohort);
    if (push.dataset.cohort === key) return;
    push.dataset.cohort = key;
    try {
      Promise.resolve(ChallengePush.mount(push, {challenge:challengeOf(cohort),roundId:cohort.round, sb:MONC.sb})).catch(() => {
        if (push.dataset.cohort!==key) return;
        push.textContent = '기기 알림 설정을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.';
        delete push.dataset.cohort;
      });
    } catch (_) {
      push.textContent = '기기 알림 설정을 불러오지 못했어요.';
      delete push.dataset.cohort;
    }
  }

  function historyView(scope,requested=false) {
    document.getElementById('history-link').setAttribute('aria-current','page');
    const entries = home.history.filter(row=>!requested || (scope && keyOf(row)===keyOf(scope))).sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));
    root.innerHTML = '<section class="mission-card"><h2>내 제출 기록</h2>' + (entries.length
      ? '<ul class="mission-list">' + entries.map(row => `<li><a href="${esc(missionLink(row.mission_id))}"><span class="mission-meta">${esc(labelOf(row))} · DAY ${esc(row.day_no)}</span><strong>${esc(row.title)}</strong><span class="mission-meta">${esc(dateLabel(row.created_at))} 제출 · ${row.shared ? '기수에 공유' : '나만 보기'} · 코멘트 ${esc(row.comment_count || 0)}개</span></a></li>`).join('') + '</ul>'
      : '<p class="mission-hint">아직 제출한 답변이 없어요. 미션에 답하면 이곳에서 다시 볼 수 있어요.</p>') + '</section>';
  }

  const kstDay = () => new Date(Date.now()+offset+9*3600000).toISOString().slice(0,10);
  const newest = (cohort,weekNumber=0) => cohort && cohort.missions.filter(m=>!weekNumber || weekOf(m.day_no)===weekNumber).sort((a,b) => b.release_date.localeCompare(a.release_date))[0];
  const weekOf = number => number > 5 ? 2 : 1;

  function drawSchedule() {
    schedule.hidden = !activeCohort || (activeCohort.weekly_start > kstDay() && !activeCohort.missions.length);
    if (schedule.hidden) { schedule.replaceChildren(); return; }
    const weekdays = ['월','화','수','목','금'];
    const today = kstDay();
    const buttons = [1,2].map(n => `<button type="button" data-week="${n}" aria-pressed="${week===n}">${n}주차</button>`).join('');
    const days = weekdays.map((label,i) => {
      const n = (week-1)*5+i+1;
      const item = activeCohort.missions.find(m => m.day_no === n);
      if (!item) return `<span class="mission-day" aria-disabled="true" aria-label="DAY ${n}, ${label}요일 예정"><strong>${label}</strong><span>DAY ${n}</span><small>예정</small></span>`;
      const date = new Date(item.release_date+'T00:00:00+09:00');
      const weekday = new Intl.DateTimeFormat('ko',{weekday:'short',timeZone:'Asia/Seoul'}).format(date);
      const selected = item.id === current?.mission.id;
      const state = item.submission_id ? '제출' : '열림';
      const shortDate = item.release_date.slice(5).replace('-','/');
      return `<a class="mission-day" href="${esc(missionLink(item.id))}" ${selected?'aria-current="page"':''} aria-label="DAY ${n}, ${esc(dateLabel(item.release_date))}, ${state}"><strong>${esc(weekday)}</strong><span>${esc(shortDate)}</span><small>${item.release_date===today?'오늘':state}</small></a>`;
    }).join('');
    schedule.innerHTML = `<div class="mission-weeks" role="group" aria-label="주차">${buttons}</div><div class="mission-days" role="group" aria-label="${week}주차 요일">${days}</div>`;
  }

  function captureDraft() {
    if (!current || !draft) return;
    draft.text = document.getElementById('mission-body')?.value || '';
    draft.shared = document.getElementById('mission-share')?.checked || false;
    draft.comments = [...root.querySelectorAll('[data-comment]')].filter(f=>f.elements.body.value).map(f=>[f.dataset.comment,f.elements.body.value]);
    if (draft.text || draft.shared || draft.file || draft.comments.length) drafts.set(current.mission.id,draft);
    else drafts.delete(current.mission.id);
  }

  function restoreDraft() {
    if (draft?.file) filePreview();
    const body = document.getElementById('mission-body'), checkbox = document.getElementById('mission-share');
    if (body && draft?.text) body.value = draft.text;
    if (checkbox) checkbox.checked = Boolean(draft?.shared);
    for (const form of root.querySelectorAll('[data-comment]')) {
      const value = draft?.comments?.find(([id])=>id===form.dataset.comment);
      if (value) form.elements.body.value = value[1];
    }
  }

  async function readHome() {
    const version = ++homeVersion;
    const result = await rpc('home');
    if (version !== homeVersion) return false;
    if (!Array.isArray(result?.cohorts) || !Array.isArray(result.history)) throw new Error('home unavailable');
    home = result;
    const server = Date.parse(result.server_now);
    if (Number.isFinite(server)) offset = server-Date.now();
    const now = Date.now()+offset;
    const tomorrow = (Math.floor((now+9*3600000)/86400000)+1)*86400000-9*3600000;
    dueAt = tomorrow-offset+250;
    clearTimeout(scheduleTimer); scheduleTimer = setTimeout(refreshSchedule,Math.max(250,dueAt-Date.now()));
    return true;
  }

  async function refreshSchedule() {
    if (!session) return;
    try {
      if (!await readHome() || !activeCohort) return;
      const old = activeCohort;
      activeCohort = home.cohorts.find(c => keyOf(c)===keyOf(old));
      if (!activeCohort) { location.reload(); return; }
      const waitingWeek = !current && Number(new URL(location.href).searchParams.get('week'));
      const latest = newest(activeCohort,waitingWeek);
      const url = new URL(location.href);
      if (!url.searchParams.has('id')) {
        url.searchParams.set('challenge',challengeOf(activeCohort)); url.searchParams.set('round',activeCohort.round);
      }
      if (!current && latest && !routing) { await openRoute(url,'refresh'); return; }
      drawSchedule();
      if (latest && !old.missions.some(m=>m.id===latest.id)) {
        captureDraft();
        const playing = root.querySelector('.chapter-screen iframe, .chapter-screen video, [data-chapter-play]:disabled') ||
          [...root.querySelectorAll('audio')].some(el=>!el.paused);
        const editing = root.contains(document.activeElement) && document.activeElement.matches('input,textarea');
        if (current?.mission.id===newest(old)?.id && !url.searchParams.has('id') && !url.searchParams.has('week') &&
          !drafts.has(current.mission.id) && !routing && !busy && !requestingMic && !recorder && !playing && !editing) {
          await openRoute(url,'refresh');
          return;
        }
        notice.textContent = '새 미션이 열렸어요. ';
        const link = document.createElement('a'); link.href = missionLink(latest.id); link.textContent = '오늘 미션 열기'; notice.append(link);
      }
    } catch (_) {
      dueAt = Date.now()+30000; clearTimeout(scheduleTimer); scheduleTimer = setTimeout(refreshSchedule,30000);
    }
  }


  function submissionForm(kind) {
    return `<form id="mission-submit" class="mission-card"><h2>${kind.audio ? '내 답변' : '연습 메모'}</h2>
      <p class="mission-hint">${kind.audio ? '녹음이나 글 중 하나를 남겨 주세요. 둘 다 제출할 수도 있어요.' : '오늘 연습에서 기억해 둘 점을 글로 남겨 보세요.'}</p>
      <label class="field"><span>${kind.audio ? '답변 글' : '메모 내용'}</span><textarea id="mission-body" maxlength="2000" rows="3"></textarea></label>
      ${kind.audio ? `<div class="field"><strong>음성 답변</strong><div class="mission-controls">
        <button type="button" id="mission-record" class="mission-action" ${typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia ? 'hidden' : ''}>녹음 시작</button>
        <label class="mission-file"><span>음성 파일 선택</span><input type="file" id="mission-file" aria-label="음성 파일 선택" accept=".webm,.ogg,.mp4,.m4a,.mp3,.wav,audio/*"></label>
      </div><p class="mission-hint" id="mission-file-info" role="status">파일당 최대 20MB</p>
      <audio id="mission-preview" aria-label="제출 전 내 녹음" controls hidden></audio>
      <button type="button" id="mission-remove-file" class="mission-action" hidden>선택한 음성 지우기</button></div>` : ''}
      <label class="mission-check"><input type="checkbox" id="mission-share">같은 기수에 답변을 공유하고 코멘트 받기</label>
      <p class="mission-feedback" id="mission-submit-feedback" role="status"></p>
      <button class="mission-action primary" type="submit">${kind.audio ? '답변 제출' : '메모 저장'}</button></form>`;
  }

  function answerCard(answer, canInteract) {
    const comments = Array.isArray(answer.comments) ? answer.comments : [];
    const player = answer.audio_path ? `<div class="mission-controls" data-player><button type="button" class="mission-action" data-play="${esc(answer.id)}">녹음 듣기</button></div>` : '';
    const thread = comments.length ? `<ul class="mission-comments">${comments.map(c => `<li><strong>${esc(c.mine ? '나' : c.author_label)}</strong> ${esc(c.body)}</li>`).join('')}</ul>` : '';
    const mayComment = canInteract && !answer.mine && answer.shared && !comments.some(c => c.mine);
    return `<article class="mission-entry" data-answer="${esc(answer.id)}">
      <h3>${esc(answer.mine ? (family(current?.mission)?.audio ? '내 답변' : '내 연습 메모') : answer.author_label)}</h3>
      <p class="mission-meta">${esc(dateLabel(answer.created_at))} 제출${answer.mine ? ' · ' + (answer.shared ? '기수에 공유' : '나만 보기') : ''}</p>
      ${answer.body ? `<p class="mission-body">${esc(answer.body)}</p>` : ''}${player}
      ${answer.mine && (canInteract || answer.shared) ? `<div class="mission-controls"><button type="button" class="mission-action" data-share="${esc(answer.id)}">${answer.shared ? '공유 중단' : '같은 기수에 공유하기'}</button></div>` : ''}
      ${thread}${mayComment ? `<form data-comment="${esc(answer.id)}" class="field"><label class="field"><span>한 줄 코멘트</span><input type="text" name="body" maxlength="180" required></label><div class="mission-controls"><button class="mission-action" type="submit">코멘트 남기기</button></div></form>` : ''}
      <p class="mission-feedback" role="status"></p></article>`;
  }

  let stopMicCheck = null;
  async function checkMicrophone(button) {
    stopMicCheck?.();
    const result = document.getElementById('mic-check-result');
    let stream, context, timer, closed = false, peak = 0;
    const stop = () => {
      closed = true; clearInterval(timer);
      stream?.getTracks().forEach(track => track.stop());
      context?.close().catch(() => {});
      if (stopMicCheck === stop) stopMicCheck = null;
      button.disabled = false;
    };
    stopMicCheck = stop; button.disabled = true;
    result.textContent = '마이크 사용을 허용한 뒤 한 문장을 말해 주세요.';
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      context = new Audio();
      await context.resume();
      if (closed) return;
      stream = await navigator.mediaDevices.getUserMedia({audio:true});
      if (closed || !button.isConnected) { stream.getTracks().forEach(t => t.stop()); return; }
      const analyser = context.createAnalyser();
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize), until = Date.now() + 4000;
      result.textContent = '소리를 확인하고 있어요. 평소 목소리로 말해 보세요.';
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        for (const value of samples) peak = Math.max(peak, Math.abs(value - 128));
        if (Date.now() >= until || !button.isConnected) {
          result.textContent = peak > 3 ? '목소리가 잘 들어와요.' : '소리가 작아요. 마이크를 가까이 두고 다시 확인해 주세요.';
          stop();
        }
      }, 80);
    } catch (_) {
      if (!closed) result.textContent = '마이크를 사용할 수 없어요. 브라우저의 마이크 권한을 확인해 주세요.';
      stop();
    }
  }

  function renderMission() {
    const {mission, answers} = current;
    const canInteract = Boolean(activeCohort);
    const mine = answers.find(a => a.mine);
    const peers = answers.filter(a => !a.mine);
    const kind = family(mission);
    document.getElementById('mission-context').textContent = labelOf(mission) + (canInteract ? ' · 평일 자정 공개' : ' · 제출 기록');
    const weekdayLabel = activeCohort?.weekly_start ? weekOf(mission.day_no)+'주차 '+['월','화','수','목','금'][(mission.day_no-1)%5]+'요일' : '';
    const chapter = canInteract ? ChallengeChapter.render(mission.chapter,mission.day_no) : '';
    root.innerHTML = `<section class="mission-card mission-prompt"><p class="mission-meta">${weekdayLabel ? '<strong class="mission-weekday">'+weekdayLabel+'</strong>' : ''}${mission.release_date===kstDay()?'오늘의 미션 · ':''}DAY ${esc(mission.day_no)} · ${esc(dateLabel(mission.release_date))}</p><h2>${esc(mission.title)}</h2><p class="mission-body">${esc(mission.body)}</p>${chapter}</section>
      ${canInteract && kind ? `<section class="mission-card"><h2>${esc(kind.label)} 공식 과제</h2><p class="mission-hint">${esc(kind.hint)}</p><p class="mission-controls"><a class="mission-link" href="submit.html?ch=${esc(challengeOf(mission))}">${esc(kind.task)}</a></p></section>` : ''}
      ${mine ? `<section class="mission-card">${answerCard(mine,canInteract)}</section>` : (canInteract && kind ? submissionForm(kind) : '')}
      ${canInteract ? `<section class="mission-card"><h2>기수 동료의 답변</h2>${peers.length ? peers.map(p => answerCard(p,canInteract)).join('') : '<p class="mission-hint">아직 기수에 공유된 답변이 없어요.</p>'}</section>` : ''}
      `;
    restoreDraft();
    drawSchedule();
    showPush(activeCohort);
  }

  async function loadMission(id,turn=revision) {
    const result = await rpc('mission', {id});
    if (turn !== revision) return false;
    if (!result?.mission || !Array.isArray(result.answers)) throw new Error('mission unavailable');
    captureDraft();
    ChallengeChapter.close();
    current = result;
    activeCohort = result.mission.eligible === false ? null : home.cohorts.find(c => keyOf(c)===keyOf(result.mission));
    week = weekOf(result.mission.day_no);
    lastInWeek.set(keyOf(result.mission)+'-'+week,id);
    draft = drafts.get(id) || newDraft();
    renderMission();
    return true;
  }

  async function openRoute(url,mode='initial') {
    stopMicCheck?.();
    const turn = ++revision;
    const params = url.searchParams;
    const isHistory = params.get('view') === 'history';
    routing = true;
    try {
      if (!home || isHistory) await readHome();
      if (turn !== revision) return;
      // 과거 ?round=N 공유 주소는 보신각을 가리킨다. 명시된 기수가 없으면 다른 종목으로 넘기지 않는다.
      const hasRound=params.has('round'), scoped=hasRound || params.has('challenge');
      const requested= params.get('challenge') || (hasRound?'voice':'');
      const match=c=>(!scoped || challengeOf(c)===requested) && (!hasRound || String(c.round)===params.get('round'));
      const targetCohort = home.cohorts.filter(c=>family(c) && match(c)).sort((a,b)=>
        (params.get('enrollment')==='latest' ? (b.weekly_start||'').localeCompare(a.weekly_start||'') : 0) ||
        (newest(b)?.release_date||'').localeCompare(newest(a)?.release_date||'') || b.round-a.round)[0];
      const requestedScope = Object.hasOwn(kinds,requested) && /^[1-9]\d*$/.test(params.get('round'))
        ? {challenge:requested,round:params.get('round')} : null;
      let scope = scoped ? targetCohort || cohortOptions(true).find(match) || requestedScope : null;
      const requestedWeek = [1,2].includes(Number(params.get('week'))) ? Number(params.get('week')) : 0;
      const id = params.get('id') || newest(targetCohort,requestedWeek)?.id;
      if (!isHistory && id) {
        if (!uuidPattern.test(id)) throw new Error('mission unavailable');
        if (!await loadMission(id,turn)) return;
        scope = current.mission;
      } else {
        captureDraft(); ChallengeChapter.close(); current = null; draft = newDraft(); push.hidden = true;
        activeCohort = isHistory ? null : targetCohort;
        week = requestedWeek || 1; drawSchedule();
        if (isHistory) {
          document.getElementById('mission-context').textContent = (scope ? labelOf(scope)+' · ' : '')+'제출한 답변과 받은 코멘트';
          historyView(scope,scoped);
        } else {
          const hint = activeCohort ? '첫 미션이 열리면 이곳에서 연습을 시작할 수 있어요.' : '미션이 예약된 챌린지의 참가자는 이곳에서 미션을 확인할 수 있어요.';
          scope = activeCohort || scope;
          document.getElementById('mission-context').textContent = scope ? labelOf(scope)+' · 평일 자정 공개' : '평일 자정에 열리는 챌린지 연습';
          const heading = requestedWeek && activeCohort ? requestedWeek+'주차 미션은 아직 열리지 않았어요' : '아직 열린 미션이 없어요';
          const waiting = activeCohort?.weekly_start && activeCohort.weekly_start > kstDay();
          root.innerHTML = waiting ? `<section class="mission-card"><p class="mission-meta">보신각 · 시작 전</p><h2>${esc(dateLabel(activeCohort.weekly_start))} 시작</h2><p class="mission-hint">1주차 월요일 미션이 한국시간 0시에 열려요. 미리 마이크를 확인하고 미션 알림을 설정해 보세요.</p><div class="mission-controls"><button type="button" class="mission-action" data-mic-check>마이크 테스트</button></div><p id="mic-check-result" class="mission-hint" role="status"></p></section>`
            : `<section class="mission-card"><h2>${heading}</h2><p class="mission-hint">${hint}</p></section>`;
          showPush(activeCohort);
        }
      }
      const nav = document.getElementById('mission-nav');
      updatePicker(scope,isHistory);
      nav.hidden = false; nav.querySelectorAll('a').forEach(a=>a.removeAttribute('aria-current'));
      const header = document.querySelector('.mission-heading h1');
      header.textContent = scope && family(scope) ? family(scope).label+' 미션' : '챌린지 미션';
      document.title = header.textContent+' — MONC 몬크';
      document.getElementById(isHistory?'history-link':'mission-link').setAttribute('aria-current','page');
      notice.textContent = '';
      if (mode==='push') history.pushState(null,'',url);
      else if (mode==='refresh') history.replaceState(null,'',url);
      visibleURL = url.href;
    } catch (_) {
      if (turn !== revision) return;
      if (mode!=='initial' && current) {
        picker.value = picker.dataset.previous || '';
        notice.textContent = '미션을 열지 못했어요. 다시 시도해 주세요.';
        if (mode==='pop') history.replaceState(null,'',visibleURL);
      } else root.innerHTML = '<section class="mission-card"><h2>미션을 열 수 없어요</h2><p class="mission-hint">참여 기수와 미션 공개 시간을 확인한 뒤 다시 시도해 주세요.</p><div class="mission-controls"><button type="button" class="mission-action" data-retry>다시 불러오기</button><a class="mission-link" href="challenge-mission.html">미션 목록</a></div></section>';
    } finally { if(turn===revision) { routing = false; root.setAttribute('aria-busy','false'); } }
  }

  async function start() {
    try {
      session = await MONC.requireSession();
      if (!session || !(await MONC.requireConsent())) return;
      await openRoute(new URL(location.href));
    } catch (_) { root.textContent = '로그인 정보를 확인하지 못했어요. 새로고침 후 다시 시도해 주세요.'; root.setAttribute('aria-busy','false'); }
  }

  function canNavigate() {
    if (busy || requestingMic || (recorder && recorder.state !== 'inactive')) {
      notice.textContent = busy ? '저장이 끝난 뒤 미션을 옮겨 주세요.' : '녹음을 마친 뒤 다른 미션을 선택해 주세요.';
      return false;
    }
    return true;
  }

  picker.addEventListener('change',()=>{
    const isHistory=document.getElementById('history-link').hasAttribute('aria-current');
    if (!canNavigate()) { picker.value=picker.dataset.previous || ''; return; }
    const choice=cohortOptions(isHistory).find(c=>keyOf(c)===picker.value);
    openRoute(new URL(roundLink(choice,isHistory),location.href),'push');
  });
  document.querySelector('.mission-layout').addEventListener('click',event=>{
    const weekButton = event.target.closest('button[data-week]');
    if (weekButton) {
      const chosen = Number(weekButton.dataset.week);
      if (week===chosen || !canNavigate() || !activeCohort) return;
      const prior = lastInWeek.get(keyOf(activeCohort)+'-'+chosen);
      const item = activeCohort.missions.find(m=>m.id===prior) || newest(activeCohort,chosen);
      const url = item ? missionLink(item.id) : roundLink(activeCohort)+'&week='+chosen;
      openRoute(new URL(url,location.href),'push').then(()=>schedule.querySelector('[data-week="'+chosen+'"]')?.focus());
      return;
    }
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target==='_blank') return;
    const url = new URL(link.href);
    if (url.origin!==location.origin || url.pathname!==location.pathname) return;
    event.preventDefault();
    if (canNavigate()) openRoute(url,'push');
  });
  window.addEventListener('popstate',()=>{
    if (!canNavigate()) { history.pushState(null,'',visibleURL); return; }
    openRoute(new URL(location.href),'pop');
  });
  document.addEventListener('visibilitychange',()=>{
    if (!document.hidden && dueAt && Date.now()>=dueAt) refreshSchedule();
  });
  window.addEventListener('beforeunload',e=>{
    captureDraft();
    if (drafts.size || recorder?.state==='recording' || requestingMic) { e.preventDefault(); e.returnValue=''; }
  });


  function filePreview() {
    const info = document.getElementById('mission-file-info');
    if (!info) return;
    info.textContent = draft.file ? draft.file.name + ' · ' + (draft.file.size / (1024 * 1024)).toFixed(1) + 'MB' : '파일당 최대 20MB';
    const preview = document.getElementById('mission-preview');
    preview.hidden = !draft.file;
    if (draft.file) preview.src = draft.url;
    else { preview.removeAttribute('src'); preview.load(); }
    document.getElementById('mission-remove-file').hidden = !draft.file;
  }

  function chooseAudio(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    const mime = file.type.split(';')[0].toLowerCase();
    const ext = formats[extension] ? extension : mimeExt[mime];
    const feedback = document.getElementById('mission-submit-feedback');
    if (!ext || (mime && !mimeExt[mime] && mime !== 'application/octet-stream')) {
      textError(feedback,'WebM, OGG, M4A, MP4, MP3 또는 WAV 음성 파일을 선택해 주세요.'); return;
    }
    if (!file.size || file.size > maxAudio) { textError(feedback,'0바이트보다 크고 20MB 이하인 음성 파일을 선택해 주세요.'); return; }
    freshDraft();
    draft.file = file;
    draft.extension = ext;
    draft.url = URL.createObjectURL(file);
    feedback.textContent = '';
    filePreview();
  }

  async function toggleRecord(button) {
    if (recorder?.state === 'recording') { recorder.stop(); return; }
    const key = ++recordingTask;
    const feedback = document.getElementById('mission-submit-feedback');
    const submit = button.form.querySelector('[type=submit]');
    const input = document.getElementById('mission-file');
    button.disabled = submit.disabled = input.disabled = true;
    let started = false;
    try {
      requestingMic = true;
      const media = await navigator.mediaDevices.getUserMedia({audio:true});
      if (key !== recordingTask) { media.getTracks().forEach(t=>t.stop()); return; }
      stream = media;
      const mime = ['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m));
      recorder = mime ? new MediaRecorder(media,{mimeType:mime}) : new MediaRecorder(media);
      const audioType = recorder.mimeType.split(';')[0], extension = mimeExt[audioType];
      if (!extension) throw new Error('format');
      const chunks = [];
      let total = 0;
      recorder.ondataavailable = e => {
        if (!e.data.size) return;
        total += e.data.size;
        if (total <= maxAudio) chunks.push(e.data);
        else if (recorder?.state === 'recording') recorder.stop();
      };
      recorder.onstop = () => {
        releaseMic(); recorder = null;
        if (key !== recordingTask) return;
        button.textContent = '녹음 시작'; submit.disabled = input.disabled = false;
        if (total > maxAudio) textError(feedback,'20MB를 넘었어요. 짧게 다시 녹음해 주세요.');
        else chooseAudio(new File(chunks,'내 녹음.' + extension,{type:audioType}));
      };
      recorder.start(1000); started = true; button.textContent = '녹음 마치기';
      feedback.textContent = '녹음 중이에요. 마치면 들어 볼 수 있어요.';
    } catch (_) {
      releaseMic(); recorder = null;
      textError(feedback,'녹음을 시작하지 못했어요. 마이크 권한을 확인하거나 음성 파일을 선택해 주세요.');
    } finally {
      requestingMic = false; button.disabled = false;
      if (!started) submit.disabled = input.disabled = false;
    }
  }

  async function submitAnswer(form) {
    if (busy || recorder?.state === 'recording') return;
    const feedback = document.getElementById('mission-submit-feedback');
    const body = document.getElementById('mission-body').value.trim();
    const shared = document.getElementById('mission-share').checked;
    if (!body && !draft.file) { textError(feedback,family(current.mission)?.audio ? '녹음이나 답변 글을 먼저 추가해 주세요.' : '연습 메모를 먼저 작성해 주세요.'); return; }
    const controls = Array.from(form.elements);
    controls.forEach(el => { el.disabled = true; });
    const isMemo = !family(current.mission)?.audio;
    busy = true; feedback.textContent = isMemo ? '메모를 저장하는 중이에요.' : '답변을 제출하는 중이에요.';
    let path;
    try {
      const payload = {id:current.mission.id, body, shared, request_id:draft.requestId};
      if (draft.file) {
        path = session.user.id + '/' + current.mission.id + '/' + draft.requestId + '.' + draft.extension;
        if (!draft.uploaded) {
          const {error} = await storage().upload(path, draft.file, {upsert:false,contentType:formats[draft.extension]});
          if (error && Number(error.statusCode || error.status) !== 409 && !/already exists|duplicate/i.test(error.message || '')) throw error;
          draft.uploaded = true;
        }
        payload.file_id = draft.requestId; payload.extension = draft.extension;
      }
      await rpc('submit', payload);
    } catch (e) {
      if (e.code === '23505') {
        try { await loadMission(current.mission.id); if (current.answers.some(a => a.mine)) { freshDraft(); notice.textContent='이미 제출한 답변을 확인해 주세요.'; return; } } catch (_) {}
      }
      if (draft.uploaded && path && ['42501','22023','23514','P0001'].includes(e.code)) {
        try { const r = await storage().remove([path]); if (!r.error) draft.uploaded = false; } catch (_) {}
      }
      textError(feedback,'제출을 완료하지 못했어요. 작성한 답변을 유지했으니 다시 시도해 주세요.');
      return;
    } finally { busy = false; controls.forEach(el => { el.disabled = false; }); }
    drafts.delete(current.mission.id);
    const item = activeCohort?.missions.find(m=>m.id===current.mission.id); if (item) item.submission_id = 'saved';
    freshDraft(); notice.textContent = isMemo ? '연습 메모를 저장했어요.' : '내 답변을 제출했어요.';
    // 저장 후 조회 실패는 재제출로 이어지지 않도록 입력칸을 닫는다.
    form.replaceWith(Object.assign(document.createElement('p'),{textContent:'제출을 완료했어요.'}));
    try { await loadMission(current.mission.id); }
    catch (_) { notice.textContent = '답변은 저장됐어요. 내 기록에서 다시 확인할 수 있어요.'; }
  }

  async function saveComment(form) {
    const card = form.closest('[data-answer]'), feedback = card.querySelector('.mission-feedback');
    const body = form.elements.body.value.trim();
    if (!body || busy) return;
    form.dataset.request ||= crypto.randomUUID();
    const button = form.querySelector('button');
    busy = true; button.disabled = true; form.elements.body.readOnly = true;
    try { await rpc('comment',{id:form.dataset.comment,body,request_id:form.dataset.request}); }
    catch (_) {
      textError(feedback,'코멘트를 남기지 못했어요. 다시 시도해 주세요.'); return;
    } finally { busy = false; button.disabled = false; form.elements.body.readOnly = false; }
    form.remove(); feedback.textContent = '코멘트를 남겼어요.';
    // 다른 답변에서 쓰던 글과 진행 중인 녹음을 보존한다.
    const list = card.querySelector('.mission-comments') || document.createElement('ul');
    list.className = 'mission-comments';
    if (!list.isConnected) card.insertBefore(list,feedback);
    const item = document.createElement('li'); item.textContent = '나 ' + body; list.appendChild(item);
  }

  root.addEventListener('submit', e => {
    e.preventDefault();
    if (routing) { notice.textContent = '미션을 불러온 뒤 다시 시도해 주세요.'; return; }
    if (e.target.id === 'mission-submit') submitAnswer(e.target);
    if (e.target.matches('[data-comment]')) saveComment(e.target);
  });
  root.addEventListener('change', e => {
    if (e.target.id === 'mission-file' && e.target.files[0]) { chooseAudio(e.target.files[0]); e.target.value = ''; }
  });
  root.addEventListener('click', async e => {
    const button = e.target.closest('button');
    if (!button) return;
    if (routing) return;
    if (button.hasAttribute('data-mic-check')) { await checkMicrophone(button); return; }
    if (button.matches('[data-chapter-play],[data-chapter-full]')) {
      const mission = current?.mission;
      if (!activeCohort || !mission?.chapter) return;
      const full = button.hasAttribute('data-chapter-full') ? button.dataset.mode!=='full' : button.dataset.chapterPlay==='full';
      await ChallengeChapter.play(button.closest('.chapter-player'),mission.chapter,{
        full, resume:button.dataset.resume ? Number(button.dataset.resume) : undefined,
        async loadURL() {
          const {data,error} = await MONC.sb.functions.invoke('challenge-week-video',{body:{action:'play',id:mission.id}});
          if (error || data?.ok!==true || !data.url) throw new Error('video unavailable');
          return data.url;
        }
      });
      return;
    }
    if (button.hasAttribute('data-retry')) { location.reload(); return; }
    if (button.id === 'mission-record') { await toggleRecord(button); return; }
    if (button.id === 'mission-remove-file') { freshDraft(); filePreview(); return; }
    const card = button.closest('[data-answer]');
    if (!card) return;
    const answer = current.answers.find(a => a.id === card.dataset.answer);
    if (!answer) return;
    const feedback = card.querySelector('.mission-feedback');
    if (button.dataset.play) {
      button.disabled = true;
      try {
        const {data,error} = await storage().createSignedUrl(answer.audio_path,60);
        if (error || !data?.signedUrl) throw error || new Error('no url');
        const audio = document.createElement('audio');
        audio.controls = true; audio.setAttribute('aria-label','제출한 음성'); audio.src = data.signedUrl;
        audio.addEventListener('error',() => { audio.remove(); button.hidden = false; feedback.textContent='음성을 다시 불러와 주세요.'; });
        button.hidden = true; button.after(audio); feedback.textContent='';
        try { await audio.play(); } catch (_) {}
      } catch (_) { textError(feedback,'음성을 불러오지 못했어요. 다시 시도해 주세요.'); }
      finally { button.disabled = false; }
    }
    if (button.dataset.share && !busy) {
      busy = true; button.disabled = true;
      try {
        await rpc('share',{id:answer.id,shared:!answer.shared});
        answer.shared = !answer.shared;
        const next = document.createElement('div'); next.innerHTML = answerCard(answer,Boolean(activeCohort)); card.replaceWith(next.firstElementChild);
        notice.textContent = answer.shared ? '같은 기수에 답변을 공유했어요.' : '답변을 나만 보기로 바꿨어요.';
      } catch (_) { textError(feedback,'공개 범위를 바꾸지 못했어요. 다시 시도해 주세요.'); }
      finally { busy = false; button.disabled = false; }
    }
  });
  window.addEventListener('pagehide',() => {
    stopMicCheck?.(); recordingTask++; ChallengeChapter.close();
    if (recorder?.state === 'recording') recorder.stop();
    releaseMic();
  });
  // 입력 중 기기 권한 창이나 다른 페이지에 다녀와도 같은 계정의 초안을 보존한다.
  window.addEventListener('pageshow',async e => {
    if (!e.persisted) return;
    captureDraft();
    const hasDraft = drafts.size > 0;
    if (!hasDraft) { location.reload(); return; }
    try {
      const user = await MONC.requireSession();
      if (!user || !(await MONC.requireConsent())) return;
      await readHome();
      if (user.user.id !== session.user.id || (activeCohort && !home.cohorts.some(c => keyOf(c)===keyOf(activeCohort)))) {
        location.reload(); return;
      }
      // 뒤로 돌아온 입력 화면에서는 닫힌 플레이어만 복원하고 기존 답변 초안은 유지한다.
      const chapterPanel = root.querySelector('.chapter-player');
      if (chapterPanel && current && activeCohort) {
        chapterPanel.outerHTML = ChallengeChapter.render(current.mission.chapter,current.mission.day_no);
      }
      const record = document.getElementById('mission-record');
      if (record) {
        record.textContent = '녹음 시작';
        record.disabled = record.form.querySelector('[type=submit]').disabled = document.getElementById('mission-file').disabled = false;
      }
    } catch (_) { location.reload(); }
  });
  freshDraft();
  start();
})();

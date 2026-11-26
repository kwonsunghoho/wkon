(() => {
  'use strict';
  const root = document.getElementById('mission-content');
  const notice = document.getElementById('mission-notice');
  const push = document.getElementById('mission-push');
  const params = new URLSearchParams(location.search);
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
  const roundLink = round => 'challenge-mission.html?round=' + encodeURIComponent(round);
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
    const round = String(cohort.round);
    if (push.dataset.round === round) return;
    push.dataset.round = round;
    try {
      Promise.resolve(ChallengePush.mount(push, {roundId:cohort.round, sb:MONC.sb})).catch(() => {
        push.textContent = '기기 알림 설정을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.';
        delete push.dataset.round;
      });
    } catch (_) {
      push.textContent = '기기 알림 설정을 불러오지 못했어요.';
      delete push.dataset.round;
    }
  }

  function historyView() {
    document.getElementById('history-link').setAttribute('aria-current','page');
    const entries = (home.history || []).slice().sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));
    root.innerHTML = '<section class="mission-card"><h2>내 제출 기록</h2>' + (entries.length
      ? '<ul class="mission-list">' + entries.map(row => `<li><a href="${esc(missionLink(row.mission_id))}"><span class="mission-meta">보신각 ${esc(row.round)}기 · DAY ${esc(row.day_no)}</span><strong>${esc(row.title)}</strong><span class="mission-meta">${esc(dateLabel(row.created_at))} 제출 · ${row.shared ? '기수에 공유' : '나만 보기'} · 코멘트 ${esc(row.comment_count || 0)}개</span></a></li>`).join('') + '</ul>'
      : '<p class="mission-hint">아직 제출한 답변이 없어요. 미션에 답하면 이곳에서 다시 볼 수 있어요.</p>') + '</section>';
  }

  function releaseList(cohort, selected) {
    if (!cohort) return '';
    const otherRounds = home.cohorts.filter(c => c.round !== cohort.round);
    const missions = [...cohort.missions].sort((a,b) => b.release_date.localeCompare(a.release_date));
    const rounds = otherRounds.length ? `<p class="mission-controls">${otherRounds.map(c => `<a class="mission-link" href="${esc(roundLink(c.round))}">보신각 ${esc(c.round)}기</a>`).join('')}</p>` : '';
    if (!missions.length && !rounds) return '';
    return `<details class="mission-card"><summary>열린 미션 · ${esc(missions.length)}개</summary><ul class="mission-list">${missions.map(m => `<li><a href="${esc(missionLink(m.id))}" ${m.id === selected ? 'aria-current="page"' : ''}><span class="mission-meta">DAY ${esc(m.day_no)} · ${esc(dateLabel(m.release_date))}</span><strong>${esc(m.title)}</strong><span class="mission-meta">${m.submission_id ? '제출 완료' : '미제출'}</span></a></li>`).join('')}</ul>${rounds}</details>`;
  }

  function submissionForm() {
    return `<form id="mission-submit" class="mission-card"><h2>내 답변</h2>
      <p class="mission-hint">녹음이나 글 중 하나를 남겨 주세요. 둘 다 제출할 수도 있어요.</p>
      <label class="field"><span>답변 글</span><textarea id="mission-body" maxlength="2000" rows="3"></textarea></label>
      <div class="field"><strong>음성 답변</strong><div class="mission-controls">
        <button type="button" id="mission-record" class="mission-action" ${typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia ? 'hidden' : ''}>녹음 시작</button>
        <label class="mission-file"><span>음성 파일 선택</span><input type="file" id="mission-file" aria-label="음성 파일 선택" accept=".webm,.ogg,.mp4,.m4a,.mp3,.wav,audio/*"></label>
      </div><p class="mission-hint" id="mission-file-info" role="status">파일당 최대 20MB</p>
      <audio id="mission-preview" aria-label="제출 전 내 녹음" controls hidden></audio>
      <button type="button" id="mission-remove-file" class="mission-action" hidden>선택한 음성 지우기</button></div>
      <label class="mission-check"><input type="checkbox" id="mission-share">같은 기수에 답변을 공유하고 코멘트 받기</label>
      <p class="mission-feedback" id="mission-submit-feedback" role="status"></p>
      <button class="mission-action primary" type="submit">답변 제출</button></form>`;
  }

  function answerCard(answer, canInteract) {
    const comments = Array.isArray(answer.comments) ? answer.comments : [];
    const player = answer.audio_path ? `<div class="mission-controls" data-player><button type="button" class="mission-action" data-play="${esc(answer.id)}">녹음 듣기</button></div>` : '';
    const thread = comments.length ? `<ul class="mission-comments">${comments.map(c => `<li><strong>${esc(c.mine ? '나' : c.author_label)}</strong> ${esc(c.body)}</li>`).join('')}</ul>` : '';
    const mayComment = canInteract && !answer.mine && answer.shared && !comments.some(c => c.mine);
    return `<article class="mission-entry" data-answer="${esc(answer.id)}">
      <h3>${esc(answer.mine ? '내 답변' : answer.author_label)}</h3>
      <p class="mission-meta">${esc(dateLabel(answer.created_at))} 제출${answer.mine ? ' · ' + (answer.shared ? '기수에 공유' : '나만 보기') : ''}</p>
      ${answer.body ? `<p class="mission-body">${esc(answer.body)}</p>` : ''}${player}
      ${answer.mine && (canInteract || answer.shared) ? `<div class="mission-controls"><button type="button" class="mission-action" data-share="${esc(answer.id)}">${answer.shared ? '공유 중단' : '같은 기수에 공유하기'}</button></div>` : ''}
      ${thread}${mayComment ? `<form data-comment="${esc(answer.id)}" class="field"><label class="field"><span>한 줄 코멘트</span><input type="text" name="body" maxlength="180" required></label><div class="mission-controls"><button class="mission-action" type="submit">코멘트 남기기</button></div></form>` : ''}
      <p class="mission-feedback" role="status"></p></article>`;
  }

  function renderMission() {
    const {mission, answers} = current;
    const canInteract = Boolean(activeCohort);
    const mine = answers.find(a => a.mine);
    const peers = answers.filter(a => !a.mine);
    document.getElementById('mission-context').textContent = '보신각 ' + mission.round + '기 · 평일 자정 공개';
    root.innerHTML = `<section class="mission-card mission-prompt"><p class="mission-meta">DAY ${esc(mission.day_no)} · ${esc(dateLabel(mission.release_date))}</p><h2>${esc(mission.title)}</h2><p class="mission-body">${esc(mission.body)}</p></section>
      ${mine ? `<section class="mission-card">${answerCard(mine,canInteract)}</section>` : (canInteract ? submissionForm() : '')}
      ${canInteract ? `<section class="mission-card"><h2>기수 동료의 답변</h2>${peers.length ? peers.map(p => answerCard(p,canInteract)).join('') : '<p class="mission-hint">아직 기수에 공유된 답변이 없어요.</p>'}</section>` : ''}
      ${releaseList(activeCohort,mission.id)}`;
    if (draft?.file && !mine) filePreview();
    showPush(activeCohort);
  }

  async function loadMission(id) {
    current = await rpc('mission', {id});
    if (!current?.mission || !Array.isArray(current.answers)) throw new Error('mission unavailable');
    activeCohort = current.mission.eligible === false ? null : home.cohorts.find(c => c.round === current.mission.round && c.challenge === current.mission.challenge);
    renderMission();
  }

  async function start() {
    try {
      session = await MONC.requireSession();
      if (!session || !(await MONC.requireConsent())) return;
      home = await rpc('home');
      if (!Array.isArray(home?.cohorts) || !Array.isArray(home.history)) throw new Error('home unavailable');
      document.getElementById('mission-nav').hidden = false;
      if (params.get('view') === 'history') { historyView(); return; }
      document.getElementById('mission-link').setAttribute('aria-current','page');
      const id = params.get('id');
      if (id) {
        if (!uuidPattern.test(id)) throw new Error('mission unavailable');
        await loadMission(id);
        return;
      }
      activeCohort = home.cohorts.find(c => String(c.round) === params.get('round')) || [...home.cohorts].sort((a,b) => b.round-a.round)[0];
      const newest = activeCohort && [...activeCohort.missions].sort((a,b) => b.release_date.localeCompare(a.release_date))[0];
      if (newest) { await loadMission(newest.id); return; }
      const hint = activeCohort ? '첫 미션이 열리면 이곳에서 연습을 시작할 수 있어요.' : '미션이 예약된 보신각 기수의 참가자는 이곳에서 미션을 확인할 수 있어요.';
      if (activeCohort) document.getElementById('mission-context').textContent = '보신각 ' + activeCohort.round + '기 · 평일 자정 공개';
      root.innerHTML = `<section class="mission-card"><h2>아직 열린 미션이 없어요</h2><p class="mission-hint">${hint}</p></section>${releaseList(activeCohort)}`;
      showPush(activeCohort);
    } catch (_) {
      root.innerHTML = '<section class="mission-card"><h2>미션을 열 수 없어요</h2><p class="mission-hint">참여 기수와 미션 공개 시간을 확인한 뒤 다시 시도해 주세요.</p><div class="mission-controls"><button type="button" class="mission-action" data-retry>다시 불러오기</button><a class="mission-link" href="challenge-mission.html">미션 목록</a></div></section>';
    } finally { root.setAttribute('aria-busy','false'); }
  }

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
      button.disabled = false;
      if (!started) submit.disabled = input.disabled = false;
    }
  }

  async function submitAnswer(form) {
    if (busy || recorder?.state === 'recording') return;
    const feedback = document.getElementById('mission-submit-feedback');
    const body = document.getElementById('mission-body').value.trim();
    const shared = document.getElementById('mission-share').checked;
    if (!body && !draft.file) { textError(feedback,'녹음이나 답변 글을 먼저 추가해 주세요.'); return; }
    const controls = Array.from(form.elements);
    controls.forEach(el => { el.disabled = true; });
    busy = true; feedback.textContent = '답변을 제출하는 중이에요.';
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
    freshDraft(); notice.textContent = '내 답변을 제출했어요.';
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
    if (e.target.id === 'mission-submit') submitAnswer(e.target);
    if (e.target.matches('[data-comment]')) saveComment(e.target);
  });
  root.addEventListener('change', e => {
    if (e.target.id === 'mission-file' && e.target.files[0]) { chooseAudio(e.target.files[0]); e.target.value = ''; }
  });
  root.addEventListener('click', async e => {
    const button = e.target.closest('button');
    if (!button) return;
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
    recordingTask++;
    if (recorder?.state === 'recording') recorder.stop();
    releaseMic();
  });
  // 입력 중 기기 권한 창이나 다른 페이지에 다녀와도 같은 계정의 초안을 보존한다.
  window.addEventListener('pageshow',async e => {
    if (!e.persisted) return;
    const hasDraft = draft?.file || [...root.querySelectorAll('textarea,input[type=text]')].some(field => field.value);
    if (!hasDraft) { location.reload(); return; }
    try {
      const user = await MONC.requireSession();
      if (!user || !(await MONC.requireConsent())) return;
      const access = await rpc('home');
      if (user.user.id !== session.user.id || !access.cohorts.some(c => c.round === activeCohort?.round)) {
        location.reload(); return;
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

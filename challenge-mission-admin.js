/* 선택한 챌린지·기수의 평일 미션 예약. 공개 여부와 변경 권한은 서버에서 판정한다. */
(function () {
  'use strict';

  const panel = document.getElementById('missionSchedule');
  const challengeSelect = document.getElementById('msChallenge');
  const roundSelect = document.getElementById('msRound');
  const list = document.getElementById('msList');
  const msg = document.getElementById('msStatus');
  const form = document.getElementById('msForm');
  const fields = form.querySelector('fieldset');
  const addButton = document.getElementById('msAdd');
  const refreshButton = document.getElementById('msRefresh');
  const day = form.elements.day;
  const date = form.elements.date;
  const title = form.elements.title;
  const body = form.elements.body;
  const weekList = document.getElementById('msWeekVideos');
  const weekForm = document.getElementById('msWeekForm');
  const videoInput = weekForm.elements.video;
  const transferBox = document.getElementById('msTransfer');
  const transferLabel = document.getElementById('msTransferLabel');
  const transferBar = transferBox.querySelector('progress');
  const stopTransfer = document.getElementById('msStopTransfer');
  const preview = document.getElementById('msWeekPreview');
  const previewPlayer = preview.querySelector('video');
  const previewStatus = document.getElementById('msPreviewStatus');
  const chapter = form.elements.withChapter;
  const startTime = form.elements.chapterStart;
  const endTime = form.elements.chapterEnd;
  const weekdayLabels = ['월', '화', '수', '목', '금'];
  let challenge = '';
  let allRounds = [];
  let round = '';
  let rows = [];
  let videos = [];
  let editingWeek = null;
  let sequence = 0;
  let editId = null;
  let dirty = false;
  let saving = false;
  let ready = false;
  let tusLoader = null;
  let uploadAbort = null;
  let transferred = null;
  let previewRequest = 0;
  let previewButton = null;
  let roundsState = 'pending';
  let requestedRound = '';
  let missingRound = '';
  let loadingRound = false;
  let loadedForOpening = false;
  let focusAfterRounds = false;
  let retryRounds = null;

  function updateUploadUrl() {
    if (!location.search) return;
    const url = new URL(location.href);
    if (!['challenge-upload','voice-upload'].includes(url.searchParams.get('focus')) || url.searchParams.get('tab') !== 'rounds') return;
    url.searchParams.set('focus','challenge-upload');
    if (challenge) url.searchParams.set('challenge',challenge); else url.searchParams.delete('challenge');
    const target = challenge && (round || requestedRound || missingRound);
    if (target) url.searchParams.set('round',target); else url.searchParams.delete('round');
    history.replaceState(history.state,'',url);
  }
  function focusUpload() {
    const target = saving ? panel.querySelector('summary') :
      !weekForm.hidden ? videoInput : !form.hidden ? (day.disabled ? title : day) : !challenge ? challengeSelect : roundSelect.options.length ? roundSelect :
      roundsState === 'pending' ? panel.querySelector('summary') : msg;
    target.focus({preventScroll:true});
    if (target === videoInput || target === day || target === title) target.scrollIntoView({block:'center'});
    else panel.scrollIntoView({block:'start'});
  }
  function changeChallenge(next, desiredRound = '') {
    ++sequence; loadingRound = false; ready = false;
    challenge = next; challengeSelect.value = next;
    round = ''; requestedRound = desiredRound; missingRound = '';
    closeEditor(); closePreview(); rows = []; videos = [];
    roundSelect.replaceChildren(); list.replaceChildren(); weekList.replaceChildren();
    if (roundsState === 'ready') setRounds(allRounds);
    else { controls(); updateUploadUrl(); }
  }
  function openUpload(code, value) {
    const wasOpen = panel.open;
    panel.open = true;
    // 화면 안의 바로가기는 작성 중인 내용을 유지하고, 지정된 주소는 해당 챌린지·기수를 연다.
    if (code != null) {
      const next = [...challengeSelect.options].some(o => o.value === code) ? code : '';
      const desired = next && /^[1-9]\d*$/.test(value || '') ? value : '';
      if (next !== challenge || (desired && desired !== (round || requestedRound || missingRound))) {
        if (saving || !canDiscard()) { updateUploadUrl(); focusUpload(); return; }
        changeChallenge(next,desired);
      }
    }
    if (roundsState === 'pending') msg.textContent = challenge ? '기수를 불러오는 중입니다.' : '먼저 챌린지를 선택해 주세요.';
    else if (wasOpen && roundsState === 'ready' && !ready && !loadingRound && !saving) load();
    focusAfterRounds = roundsState === 'pending'; focusUpload();
    updateUploadUrl();
  }

  function koreanDate(stamp = Date.now()) {
    return new Date(stamp + 9 * 3600000).toISOString().slice(0, 10);
  }
  function isWeekday(value) {
    const week = new Date(value + 'T12:00:00Z').getUTCDay();
    return week >= 1 && week <= 5;
  }
  function defaultDate() {
    const item = roundSelect.selectedOptions[0];
    const last = rows.reduce((latest, row) => row.release_date > latest ? row.release_date : latest, koreanDate());
    let start = new Date(last + 'T00:00:00Z').getTime() + 86400000;
    const begins = Date.parse((item?.dataset.start || '') + 'T00:00:00Z');
    if (Number.isFinite(begins)) start = Math.max(start, begins);
    let value = new Date(start).toISOString().slice(0, 10);
    while (!isWeekday(value)) {
      start += 86400000;
      value = new Date(start).toISOString().slice(0, 10);
    }
    return value;
  }
  function availableDays() {
    return Array.from({length:10}, (_, i) => i + 1).filter(n => !rows.some(r => r.day_no === n));
  }
  function weekOf(n) { return Math.floor((Number(n) - 1) / 5) + 1; }
  function weekdayOf(n) { return ((Number(n) - 1) % 5) + 1; }
  function timeLabel(seconds) {
    if (seconds == null) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    const pad = n => String(n).padStart(2, '0');
    return (hours ? hours + ':' + pad(minutes) : String(minutes)) + ':' + pad(seconds % 60);
  }
  function parseTime(input) {
    const parts = input.trim().split(':');
    if (parts.length < 2 || parts.length > 3 || !/^\d+$/.test(parts[0])
      || !parts.slice(1).every(p => /^[0-5]\d$/.test(p))) return NaN;
    return parts.reduce((n, p) => n * 60 + Number(p), 0);
  }
  function suggestDate() {
    const n = Number(day.value);
    const peers = rows.filter(r => r.id !== editId && r.chapter_start_seconds != null);
    const peer = peers.find(r => weekOf(r.day_no) === weekOf(n)) || peers[0];
    const offset = d => (weekOf(d) - 1) * 7 + weekdayOf(d) - 1;
    const startOfWeek = new Date((roundSelect.selectedOptions[0]?.dataset.start || koreanDate(Date.now() + 86400000)) + 'T00:00:00Z');
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() + (8 - startOfWeek.getUTCDay()) % 7);
    const base = peer ? Date.parse(peer.release_date + 'T00:00:00Z') - offset(peer.day_no) * 86400000 : startOfWeek.getTime();
    const suggested = new Date(base + offset(n) * 86400000).toISOString().slice(0,10);
    if (suggested > koreanDate()) return suggested;
    const first = new Date(defaultDate() + 'T00:00:00Z');
    first.setUTCDate(first.getUTCDate() + (weekdayOf(n) - first.getUTCDay() + 7) % 7);
    return first.toISOString().slice(0,10);
  }
  function syncChapter() {
    document.getElementById('msChapterFields').hidden = !chapter.checked;
    startTime.disabled = endTime.disabled = !chapter.checked;
    startTime.required = endTime.required = chapter.checked;
    const week = weekOf(day.value);
    const hint = document.getElementById('msChapterHint');
    hint.textContent = videos.some(v => v.week_no === week)
      ? week + '주차 원본 · ' + weekdayLabels[weekdayOf(day.value)-1] + '요일 공개 구간'
      : week + '주차 원본 영상을 먼저 등록해 주세요.';
    for (const input of [chapter,date,startTime,endTime]) input.setCustomValidity('');
  }
  function closeEditor() {
    form.hidden = true; form.reset(); editId = null; dirty = false;
    weekForm.hidden = true; weekForm.reset(); editingWeek = null;
    dropStaged(); transferBox.hidden = true;
    for (const input of [title,body,date,startTime,endTime,chapter,videoInput]) input.setCustomValidity('');
  }
  function canDiscard() {
    return !dirty || window.confirm('작성 중인 내용을 저장하지 않고 이동할까요?');
  }
  function controls() {
    challengeSelect.disabled = saving;
    roundSelect.disabled = saving || roundSelect.options.length < 1;
    fields.disabled = saving || !ready;
    weekForm.querySelector('fieldset').disabled = saving || !ready;
    weekList.querySelectorAll('button').forEach(b => { b.disabled = saving || !ready; });
    refreshButton.disabled = saving || (!round && !(roundsState === 'error' && retryRounds));
    addButton.disabled = saving || !ready || !availableDays().length;
    list.querySelectorAll('button').forEach(b => { b.disabled = saving || !ready; });
  }
  async function rpc(action, data) {
    const result = await MONC.sb.rpc('challenge_room', {p_action:action, p_data:data});
    if (result.error) throw result.error;
    return result.data;
  }
  async function videoApi(action, params) {
    const result = await MONC.sb.functions.invoke('challenge-week-video',{body:{action,...params}});
    if (result.data?.ok) return result.data;
    let reason = result.data?.error;
    if (!reason && result.error?.context?.clone) {
      try { reason = (await result.error.context.clone().json()).error; } catch (_) {}
    }
    throw new Error(reason || 'video_service_error');
  }
  function cancelTicket(id) {
    if (id) videoApi('admin-cancel',{upload_id:id}).catch(() => {});
  }
  function dropStaged() {
    if (transferred) cancelTicket(transferred.ticket.upload_id);
    transferred = null;
  }
  function locked(row) {
    return row.locked || Date.parse(row.opens_at) <= Date.now();
  }
  function editWeek(week) {
    if (!canDiscard()) return;
    closeEditor();
    const video = videos.find(v => v.week_no === week);
    if (!ready || saving || video?.locked) return;
    editingWeek = week;
    weekForm.querySelector('legend').textContent = challengeSelect.selectedOptions[0].textContent + ' ' + round + '기 · ' + week + '주차 원본 영상 ' + (video ? '수정' : '등록');
    msg.textContent = ''; weekForm.hidden = false; videoInput.focus();
  }
  function closePreview() {
    ++previewRequest;
    preview.hidden = true;
    if (previewPlayer.hasAttribute('src')) {
      previewPlayer.pause(); previewPlayer.removeAttribute('src'); previewPlayer.load();
    }
    previewStatus.textContent = '';
  }
  async function previewWeek(week, opener) {
    closePreview();
    const turn = previewRequest;
    previewButton = opener;
    preview.hidden = false;
    document.getElementById('msPreviewTitle').textContent = challengeSelect.selectedOptions[0].textContent + ' ' + round + '기 · ' + week + '주차 원본 영상';
    previewStatus.textContent = '영상을 불러오는 중입니다.';
    document.getElementById('msPreviewClose').focus();
    try {
      const data = await videoApi('admin-preview',{challenge,round:Number(round),week_no:week});
      if (turn !== previewRequest) return;
      previewPlayer.src = data.url;
      previewStatus.textContent = '';
    } catch (error) {
      if (turn === previewRequest) previewStatus.textContent = errorText(error);
    }
  }
  function ensureTus() {
    if (window.tus?.Upload) return Promise.resolve(window.tus);
    if (!tusLoader) {
      tusLoader = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tus-js-client@4.3.1/dist/tus.min.js';
        script.onload = () => window.tus?.Upload ? resolve(window.tus) : reject(new Error('upload_sdk'));
        script.onerror = () => { script.remove(); reject(new Error('upload_sdk')); };
        document.head.append(script);
      }).catch(error => { tusLoader = null; throw error; });
    }
    return tusLoader;
  }
  async function transferFile(ticket, file, signal) {
    const [tus, session] = await Promise.all([ensureTus(), MONC.getSession()]);
    if (signal.aborted) throw new DOMException('upload_cancelled','AbortError');
    if (!session?.access_token) throw new Error('session_expired');
    await new Promise((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint:ticket.endpoint,
        headers:{'x-signature':ticket.token,Authorization:'Bearer ' + session.access_token},
        chunkSize:6 * 1024 * 1024, retryDelays:[0,1000,3000,5000,10000],
        uploadDataDuringCreation:true, removeFingerprintOnSuccess:true, storeFingerprintForResuming:false,
        metadata:{bucketName:ticket.bucket,objectName:ticket.path,contentType:ticket.contentType,cacheControl:'0'},
        onProgress(sent,total) {
          if (!signal.aborted && total > 0) {
            transferBar.value = Math.round(sent / total * 100);
            transferLabel.textContent = '영상 업로드 ' + transferBar.value + '%';
          }
        },
        onSuccess() { signal.removeEventListener('abort', cancel); resolve(); },
        onError() { signal.removeEventListener('abort', cancel); reject(new Error('transfer_failed')); }
      });
      function cancel() {
        upload.abort().catch(() => {});
        reject(new DOMException('upload_cancelled','AbortError'));
      }
      signal.addEventListener('abort',cancel,{once:true});
      upload.start();
    });
  }
  async function uploadWeek() {
    const file = videoInput.files[0];
    if (saving || !ready || !editingWeek || weekForm.hidden || !file) return;
    const extension = file.name.split('.').pop().toLowerCase();
    const contentType = {mp4:'video/mp4',webm:'video/webm'}[extension];
    if (!contentType || (file.type && file.type !== contentType)) videoInput.setCustomValidity('MP4 또는 WebM 파일을 선택해 주세요.');
    else if (!file.size || file.size > 2 * 1024 ** 3) videoInput.setCustomValidity('0바이트보다 크고 2GB 이하인 파일을 선택해 주세요.');
    if (!weekForm.reportValidity()) return;

    const week = editingWeek, targetRound = round, targetChallenge = challenge;
    const controller = new AbortController();
    uploadAbort = controller; saving = true; controls(); msg.textContent = '';
    transferBox.hidden = false; stopTransfer.hidden = false;
    transferBar.value = 0; transferLabel.textContent = '업로드를 준비하고 있습니다.';
    let ticket = transferred?.file === file ? transferred.ticket : null;
    let committing = false;
    try {
      if (!ticket) {
        ticket = await videoApi('admin-upload',{challenge,round:Number(round),week_no:week,name:file.name,size:file.size,contentType});
        if (controller.signal.aborted) throw new DOMException('upload_cancelled','AbortError');
        await transferFile(ticket,file,controller.signal);
        if (controller.signal.aborted) throw new DOMException('upload_cancelled','AbortError');
        transferred = {file,ticket};
      }
      committing = true; stopTransfer.hidden = true; transferBar.value = 100;
      transferLabel.textContent = '업로드한 영상을 주차 원본으로 저장하고 있습니다.';
      await videoApi('admin-commit',{upload_id:ticket.upload_id});
      transferred = null;
      if (challenge === targetChallenge && round === targetRound && editingWeek === week) {
        closeEditor(); await load(week + '주차 원본 영상을 저장했습니다.');
      }
    } catch (error) {
      // 저장 응답이 끊기면 같은 업로드 ID로 완료 여부를 다시 확인한다.
      if (!committing) cancelTicket(ticket?.upload_id);
      else if (/expired|not_found|locked|stale|superseded|conflict|invalid_file|invalid_upload|upload_incomplete|size_mismatch|missing_object|upload_missing/.test(error.message)) dropStaged();
      if (challenge === targetChallenge && round === targetRound && editingWeek === week) msg.textContent = errorText(error);
    } finally {
      uploadAbort = null; saving = false; stopTransfer.hidden = true; transferBox.hidden = true; controls();
    }
  }
  function showVideos() {
    weekList.replaceChildren();
    for (const week of [1, 2]) {
      const video = videos.find(v => v.week_no === week);
      const row = document.createElement('div'); row.className = 'ms-week';
      const info = document.createElement('div');
      const heading = document.createElement('strong');
      heading.textContent = week + '주차 원본 영상';
      const state = document.createElement('span'); state.className = 'ms-meta';
      state.textContent = (week === 1 ? 'DAY 1–5' : 'DAY 6–10') + ' · ' + (video?.locked ? '공개 후 고정' : video ? '등록됨' : '미등록');
      info.append(heading, state); row.append(info);
      if (video?.provider === 'storage') {
        const name = document.createElement('span'); name.className = 'ms-meta'; name.textContent = video.file_name || '업로드한 영상';
        const open = document.createElement('button'); open.type = 'button'; open.className = 'ri-edit';
        open.textContent = '원본 보기'; open.setAttribute('aria-label',week + '주차 원본 영상 보기');
        open.addEventListener('click', () => previewWeek(week,open)); info.append(name,open);
      } else if (video && /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(video.video_url)) {
        const link = document.createElement('a'); link.href = video.video_url;
        link.textContent = '원본 보기'; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', week + '주차 원본 영상 새 탭에서 보기'); info.append(link);
      }
      if (!video?.locked) {
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ri-edit';
        btn.textContent = video ? '영상 수정' : '영상 등록';
        btn.setAttribute('aria-label', week + '주차 ' + btn.textContent);
        btn.addEventListener('click', () => editWeek(week)); row.append(btn);
      }
      weekList.append(row);
    }
  }
  function showRows() {
    list.replaceChildren();
    if (!rows.length) { list.textContent = '예약된 미션이 없습니다.'; return; }
    for (const item of rows) {
      const row = document.createElement('div');
      row.className = 'ms-row';
      const heading = document.createElement('strong');
      heading.textContent = 'DAY ' + item.day_no + ' · ' + item.title;
      const state = document.createElement('span');
      state.className = 'ms-meta';
      state.textContent = item.release_date + ' 00:00 · ' + (locked(item) ? '공개됨' : '예약됨');
      if (item.chapter_start_seconds != null) state.textContent += ' · ' + weekOf(item.day_no) + '주차 ' + timeLabel(item.chapter_start_seconds) + '–' + timeLabel(item.chapter_end_seconds);
      const info = document.createElement('div');
      info.append(heading, state); row.append(info);
      if (!locked(item)) {
        const edit = document.createElement('button');
        edit.type = 'button'; edit.className = 'ri-edit'; edit.textContent = '수정';
        edit.setAttribute('aria-label', 'DAY ' + item.day_no + ' 미션 수정');
        edit.addEventListener('click', () => { if (canDiscard()) openEditor(item); });
        row.append(edit);
      }
      list.append(row);
    }
  }
  function errorText(error) {
    const reason = String(error?.message || '');
    if (/unauthoriz|session_expired|unauthenticated|not_authenticated/i.test(reason)) return '다시 로그인한 뒤 영상을 업로드해 주세요.';
    if (/cancelled|cancelled_upload/i.test(reason) || error?.name === 'AbortError') return '업로드를 취소했습니다.';
    if (/upload_sdk/.test(reason)) return '파일 전송 도구를 불러오지 못했습니다. 다시 업로드해 주세요.';
    if (/transfer_failed/.test(reason)) return '파일 전송이 중단됐습니다. 다시 업로드해 주세요.';
    if (/stale|superseded|edit_conflict|revision_conflict|upload_conflict/.test(reason)) return '주차 원본이 변경되었습니다. 새로고침해 현재 파일을 확인해 주세요.';
    if (/upload_expired|upload_incomplete|missing_object|invalid_upload|upload_missing/.test(reason)) return '업로드한 파일을 확인할 수 없습니다. 파일을 다시 선택해 업로드해 주세요.';
    if (/too_large|invalid_size|size_mismatch/.test(reason)) return '최대 2GB 이내의 영상 파일을 선택해 주세요.';
    if (/invalid_file|content_type|unsupported|bad_video/.test(reason)) return 'MP4 또는 WebM 영상 파일을 선택해 주세요.';
    if (/video_service_error/.test(reason)) return '영상 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    if (/week_video_missing/.test(reason)) return '이 DAY에 해당하는 주차의 원본 영상을 먼저 등록해 주세요.';
    if (/chapter_order/.test(reason)) return '같은 주차에서 앞 DAY가 끝난 뒤에 시작하고 다음 DAY가 시작되기 전에 끝나도록 구간을 조정해 주세요.';
    if (/bad_chapter_day/.test(reason)) return 'DAY에 지정된 요일과 공개 날짜를 맞춰 주세요.';
    if (/bad_chapter/.test(reason)) return '영상의 시작·끝 시간을 확인해 주세요.';
    if (/locked|already.open|already.released|past_date/i.test(reason)) return '이미 공개됐거나 공개 시각이 지났습니다. 일정을 새로고침해 주세요.';
    if (error?.code === '23505' || /duplicate|conflict/i.test(reason)) return '같은 DAY 또는 공개 날짜가 이미 등록되어 있습니다.';
    if (/weekend|weekday|release_date|release_range|bad_schedule|bad_date/i.test(reason)) return '기수 일정에 맞는 미래의 평일을 선택해 주세요.';
    if (/forbidden|permission|admin_required/i.test(reason)) return '관리자 권한을 확인해 주세요.';
    return '처리하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.';
  }
  async function load(after = '') {
    const turn = ++sequence;
    loadedForOpening = panel.open;
    closePreview();
    ready = false; rows = []; videos = []; list.replaceChildren(); weekList.replaceChildren(); controls();
    if (!round) {
      loadingRound = false;
      const label = challengeSelect.selectedOptions[0]?.textContent || '';
      msg.textContent = !challenge ? '먼저 챌린지를 선택해 주세요.' : missingRound && roundSelect.options.length
        ? '요청한 ' + label + ' ' + missingRound + '기를 찾을 수 없습니다. 기수를 확인해 주세요.'
        : '기수 관리에서 ' + label + ' 기수를 먼저 등록해 주세요.';
      return;
    }
    loadingRound = true;
    msg.textContent = '예약 일정을 불러오는 중입니다.';
    try {
      const data = await rpc('admin-list', {challenge, round:Number(round)});
      if (turn !== sequence) return;
      if (!Array.isArray(data?.missions)) throw new Error('missing missions');
      rows = data.missions; videos = Array.isArray(data.week_videos) ? data.week_videos : [];
      ready = true; showVideos(); showRows(); msg.textContent = after;
    } catch (error) {
      if (turn === sequence) msg.textContent = [after, errorText(error)].filter(Boolean).join(' ');
    } finally { if (turn === sequence) { loadingRound = false; controls(); } }
  }
  function setRounds(items, retry) {
    allRounds = items || [];
    roundsState = items === null ? 'error' : 'ready';
    retryRounds = retry || null;
    const options = allRounds.filter(r => challenge && r.challenge === challenge).sort((a,b) => Number(b.round) - Number(a.round));
    const last = round;
    roundSelect.replaceChildren(...options.map(r => {
      const option = new Option(r.round + '기', String(r.round));
      option.dataset.start = r.program_start || ''; return option;
    }));
    const preferred = requestedRound || missingRound || last;
    if (options.some(r => String(r.round) === preferred)) { roundSelect.value = preferred; missingRound = ''; }
    else if (items !== null && (requestedRound || missingRound)) { missingRound = requestedRound || missingRound; roundSelect.selectedIndex = -1; }
    if (items !== null) requestedRound = '';
    else if (!requestedRound) requestedRound = last;
    round = roundSelect.value;
    if (items === null) {
      loadingRound = false;
      uploadAbort?.abort(); closePreview();
      ++sequence; closeEditor(); ready = false; rows = []; videos = []; weekList.replaceChildren(); list.replaceChildren();
      msg.textContent = '기수 목록을 불러오지 못했습니다. 새로고침해 주세요.';
    } else if (last !== round || !ready) {
      if (last !== round) uploadAbort?.abort();
      closeEditor(); rows = []; ready = false;
      if (panel.open && (last !== round || !loadingRound)) load();
    }
    controls();
    if (roundsState === 'ready') updateUploadUrl();
    if (focusAfterRounds && panel.open && document.activeElement === panel.querySelector('summary')) focusUpload();
    focusAfterRounds = false;
  }
  function openEditor(row) {
    closeEditor();
    if (!ready || saving || (row && locked(row))) return;
    editId = row?.id || null;
    const days = row ? [row.day_no] : availableDays();
    if (!days.length) return;
    day.replaceChildren(...days.map(n => new Option('DAY ' + n, String(n))));
    day.disabled = !!row;
    date.min = koreanDate(Date.now() + 86400000);
    date.value = row?.release_date || defaultDate();
    title.value = row?.title || ''; body.value = row?.body || '';
    chapter.checked = row?.chapter_start_seconds != null;
    startTime.value = timeLabel(row?.chapter_start_seconds);
    endTime.value = timeLabel(row?.chapter_end_seconds);
    date.dataset.userSet = row ? '1' : ''; syncChapter();
    form.querySelector('legend').textContent = row ? 'DAY ' + row.day_no + ' 미션 수정' : '새 미션';
    document.getElementById('msDelete').hidden = !row;
    msg.textContent = ''; form.hidden = false; (row ? title : day).focus();
  }
  async function write(action, data, success) {
    const targetRound = round, targetChallenge = challenge;
    saving = true; controls(); msg.textContent = '저장 중입니다.';
    try {
      await rpc(action, data);
      if (challenge !== targetChallenge || round !== targetRound) return;
      closeEditor(); await load(success);
      if (panel.open) refreshButton.focus();
    } catch (error) { if (challenge === targetChallenge && round === targetRound) msg.textContent = errorText(error); }
    finally { saving = false; controls(); }
  }
  challengeSelect.addEventListener('change', () => {
    if (saving || !canDiscard()) { challengeSelect.value = challenge; return; }
    changeChallenge(challengeSelect.value);
  });
  roundSelect.addEventListener('change', () => {
    if (saving || !canDiscard()) { roundSelect.value = round; return; }
    missingRound = ''; round = roundSelect.value; updateUploadUrl(); closeEditor(); load();
  });
  panel.addEventListener('toggle', () => {
    if (!panel.open) { loadedForOpening = false; return; }
    if (!loadedForOpening && roundsState === 'ready' && !loadingRound && !saving && !dirty && form.hidden && weekForm.hidden) load();
  });
  refreshButton.addEventListener('click', () => {
    if (roundsState === 'error' && retryRounds) {
      roundsState = 'pending'; controls(); msg.textContent = '기수를 불러오는 중입니다.'; retryRounds(); return;
    }
    if (canDiscard()) { closeEditor(); load(); }
  });
  addButton.addEventListener('click', () => { if (canDiscard()) openEditor(); });
  form.addEventListener('input', e => { dirty = true; e.target.setCustomValidity?.(''); });
  videoInput.addEventListener('change', () => {
    dirty = true; videoInput.setCustomValidity('');
    if (transferred?.file !== videoInput.files[0]) dropStaged();
    msg.textContent = '';
  });
  stopTransfer.addEventListener('click', () => { stopTransfer.hidden = true; uploadAbort?.abort(); });
  document.getElementById('msPreviewClose').addEventListener('click', () => { closePreview(); previewButton?.focus(); });
  previewPlayer.addEventListener('error', () => {
    if (!preview.hidden && previewPlayer.hasAttribute('src')) previewStatus.textContent = '영상을 재생하지 못했습니다. 원본 보기를 다시 눌러 주세요.';
  });
  for (const input of [day, chapter]) input.addEventListener('change', () => {
    syncChapter();
    if (chapter.checked && !date.dataset.userSet) date.value = suggestDate();
  });
  date.addEventListener('input', () => { date.dataset.userSet = '1'; });
  startTime.addEventListener('input', () => endTime.setCustomValidity(''));
  weekForm.addEventListener('submit', event => {
    event.preventDefault();
    uploadWeek();
  });
  document.getElementById('msWeekCancel').addEventListener('click', () => {
    if (canDiscard()) { const btn = weekList.children[editingWeek - 1]?.querySelector('button'); closeEditor(); btn?.focus(); }
  });
  document.getElementById('msCancel').addEventListener('click', () => { if (canDiscard()) { closeEditor(); addButton.focus(); } });
  document.getElementById('msDelete').addEventListener('click', () => {
    if (!saving && editId && window.confirm('이 기수의 DAY ' + day.value + ' 미션 예약을 취소할까요?')) {
      write('admin-delete', {id:editId,challenge,round:Number(round)}, '미션 예약을 취소했습니다.');
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (saving || !ready || form.hidden) return;
    if (date.value < (roundSelect.selectedOptions[0]?.dataset.start || '')) date.setCustomValidity('프로그램 시작일 이후의 평일을 선택해 주세요.');
    else if (!isWeekday(date.value) || date.value <= koreanDate()) date.setCustomValidity('내일 이후의 평일을 선택해 주세요.');
    else if (chapter.checked && new Date(date.value + 'T00:00:00Z').getUTCDay() !== weekdayOf(day.value)) date.setCustomValidity('DAY ' + day.value + '는 ' + weekdayLabels[weekdayOf(day.value) - 1] + '요일에 공개됩니다.');
    else if (rows.some(r => r.id !== editId && r.release_date === date.value)) date.setCustomValidity('같은 날짜에 예약된 미션이 있습니다.');
    else date.setCustomValidity('');
    title.setCustomValidity(title.value.trim() ? '' : '미션 제목을 입력해 주세요.');
    body.setCustomValidity(body.value.trim() ? '' : '미션 내용을 입력해 주세요.');
    const start = chapter.checked ? parseTime(startTime.value) : null;
    const end = chapter.checked ? parseTime(endTime.value) : null;
    chapter.setCustomValidity(chapter.checked && !videos.some(v => v.week_no === weekOf(day.value)) ? '해당 주차의 원본 영상을 먼저 등록해 주세요.' : '');
    startTime.setCustomValidity(chapter.checked && (!Number.isFinite(start) || start >= 86400) ? '시작 시간을 분:초로 입력해 주세요.' : '');
    endTime.setCustomValidity(chapter.checked && (!Number.isFinite(end) || end > 86400 || end <= start) ? '끝 시간은 시작 시간보다 늦게, 24시간 이내로 입력해 주세요.' : '');
    if (chapter.checked && start >= 0 && end > start) {
      const n = Number(day.value);
      const peers = rows.filter(r => r.id !== editId && r.chapter_start_seconds != null && weekOf(r.day_no) === weekOf(n));
      const before = peers.find(r => r.day_no < n && start < r.chapter_end_seconds);
      const after = peers.find(r => r.day_no > n && end > r.chapter_start_seconds);
      if (before) startTime.setCustomValidity('DAY ' + before.day_no + '가 끝나는 ' + timeLabel(before.chapter_end_seconds) + ' 이후로 시작 시간을 지정해 주세요.');
      if (after) endTime.setCustomValidity('DAY ' + after.day_no + '가 시작하는 ' + timeLabel(after.chapter_start_seconds) + ' 이전으로 끝 시간을 지정해 주세요.');
    }
    if (!form.reportValidity()) return;
    const payload = {challenge, round:Number(round), day_no:Number(day.value), release_date:date.value, title:title.value.trim(), body:body.value.trim()};
    payload.chapter_start_seconds = start;
    payload.chapter_end_seconds = end;
    if (editId) payload.id = editId;
    write('admin-save', payload, '미션을 예약했습니다.');
  });
  window.MONCMissionSchedule = {setRounds,openUpload,leaveUpload() { focusAfterRounds = false; requestedRound = ''; }};
})();


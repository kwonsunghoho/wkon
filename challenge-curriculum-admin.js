/* 챌린지의 공통 영상·요일별 미션과 기수별 예약을 관리한다. */
(function () {
  'use strict';

  const weekdays = ['월', '화', '수', '목', '금'];
  const oneDay = 86400000;
  function shiftDate(value, days) {
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) ? new Date(time + days * oneDay).toISOString().slice(0, 10) : '';
  }
  function tomorrow() {
    return new Date(Date.now() + 9 * 3600000 + oneDay).toISOString().slice(0, 10);
  }
  function weekday(value) { return new Date(value + 'T00:00:00Z').getUTCDay(); }
  function mondayOnOrAfter(value) { return shiftDate(value, (8 - weekday(value)) % 7); }
  function errorCode(error) {
    return String(error?.message || error?.code || '').match(/challenge_curriculum:([a-z_]+)/)?.[1] || '';
  }
  function errorMessage(error) {
    return ({
      forbidden:'공통 자료를 관리할 권한이 없습니다.',
      not_found:'선택한 챌린지 또는 기수를 찾을 수 없습니다.',
      invalid_input:'입력한 제목, 미션 내용과 시간을 확인해 주세요.',
      bad_chapter:'시작 시간과 끝 시간을 확인해 주세요.',
      bad_schedule:'개강일 이후의 미래 월요일을 선택해 주세요.',
      edit_conflict:'다른 운영자가 공통 자료를 변경했습니다.',
      incomplete:'두 주차의 영상과 DAY 1~10을 모두 등록해 주세요.',
      schedule_conflict:'이 기수에 다른 예약이 있습니다. 기존 일정을 확인해 주세요.',
      locked:'이미 공개된 일정이 있어 변경할 수 없습니다.'
    })[errorCode(error)] || '서버 응답을 확인하지 못했습니다. 다시 시도해 주세요.';
  }
  function textNode(tag, value, className) {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    return element;
  }
  function button(text, label, click) {
    const element = textNode('button', text, 'ri-edit');
    element.type = 'button';
    element.setAttribute('aria-label', label);
    element.addEventListener('click', click);
    return element;
  }

  function create(host) {
    const get = id => document.getElementById(id);
    const workspace = get('mcWorkspace'), media = get('mcWeekVideo'), days = get('mcDays');
    const form = get('mcDayForm'), fields = form.elements, message = get('mcMessage');
    const start = get('mcStart'), summary = get('mcSummary'), schedule = get('mcSchedule');
    const scheduleStatus = get('mcScheduleStatus'), refreshButton = get('mcRefresh');
    const weekButtons = [get('mcWeek1'), get('mcWeek2')];
    let challenge = '', round = '', earliest = '', week = 1;
    let common = null, roundSchedule = null, generation = 0, reading = false;
    let pendingRead = null, pendingSchedule = null, readError = false;
    let externalBusy = false, writing = false, dateEdited = false;
    let editing = 0, baseRevision = 0, conflict = false, dirty = false;

    function videoFor(n) { return common?.week_videos.find(v => v.week_no === n) || null; }
    function dayFor(n) { return common?.days.find(d => d.day_no === n) || null; }
    const locked = () => writing || externalBusy;

    function closeEditor() {
      form.hidden = true;
      editing = 0; dirty = false; conflict = false;
      form.reset(); get('mcConflict')?.remove();
      for (const input of [fields.title, fields.body, fields.start, fields.end]) input.setCustomValidity('');
    }
    function canLeave() {
      if (locked()) return false;
      if (dirty && !window.confirm('작성 중인 DAY의 변경사항을 버릴까요?')) return false;
      if (!host.canSwitch()) return false;
      closeEditor(); return true;
    }
    function buttons() {
      const blocked = locked();
      for (const b of weekButtons) b.disabled = blocked || !common;
      for (const b of [...media.querySelectorAll('button'), ...days.querySelectorAll('button')]) b.disabled = blocked || !common;
      refreshButton.disabled = blocked || !challenge || reading;
      form.querySelector('fieldset').disabled = blocked;
      form.querySelector('[type=submit]').disabled = blocked || conflict;
      const fixed = ['manual','scheduled'].includes(roundSchedule?.state);
      start.disabled = blocked || !round || fixed;
      schedule.disabled = blocked || !round || reading || fixed || !validStart()
        || (!pendingSchedule && (!common?.ready || roundSchedule?.state !== 'empty' || readError));
    }
    function setWriting(on) { writing = on; host.syncBusy(on); buttons(); }
    function validStart() {
      if (pendingSchedule && pendingSchedule.start_date === start.value) return true;
      return !!start.value && weekday(start.value) === 1 && start.value >= start.min;
    }
    function rangeText(date) {
      if (!date || weekday(date) !== 1) { summary.textContent = ''; return; }
      summary.textContent = [[1, 0, 4], [2, 7, 11]].map(([index,begin,finish]) => {
        const from = shiftDate(date, begin), to = shiftDate(date, finish);
        return index + '주차  ' + from + ' (월) ~ ' + to + ' (금)';
      }).join('\n');
    }
    function renderSchedule() {
      const state = roundSchedule?.state;
      const min = tomorrow();
      start.min = earliest > min ? earliest : min;
      if (state === 'scheduled') start.value = roundSchedule.start_date;
      else if (state === 'manual') start.value = '';
      else if (!dateEdited && !pendingSchedule) start.value = round ? mondayOnOrAfter(start.min) : '';
      rangeText(start.value);
      if (!round) scheduleStatus.textContent = '예약할 기수를 선택해 주세요.';
      else if (state === 'scheduled') {
        scheduleStatus.textContent = '이 기수는 ' + roundSchedule.start_date + ' 시작으로 DAY 1~10이 예약되어 있습니다.';
        if (roundSchedule.start_date >= min) scheduleStatus.textContent += ' 공개 전이고 알림 발송 이력이 없으면 기수 수정에서 개강일을 바꿀 수 있습니다.';
      }
      else if (state === 'manual') scheduleStatus.textContent = '이 기수에는 개별 일정이 있습니다. 기존 미션 관리에서 확인해 주세요.';
      else if (pendingSchedule) scheduleStatus.textContent = '예약 결과를 확인하지 못했습니다. 같은 날짜로 예약을 다시 누르면 결과를 확인합니다.';
      else if (readError) scheduleStatus.textContent = '예약 상태를 확인하지 못했습니다. 공통 자료를 새로고침해 주세요.';
      else if (reading || !roundSchedule) scheduleStatus.textContent = '기수 일정을 확인하고 있습니다.';
      else if (start.value && !validStart()) scheduleStatus.textContent = '개강일 이후의 미래 월요일을 선택해 주세요.';
      else if (!common?.ready) scheduleStatus.textContent = '공통 영상 2개와 DAY 10개를 준비하면 예약할 수 있습니다.';
      else scheduleStatus.textContent = start.value ? '예정된 평일마다 한국 시간 0시에 공개됩니다.' : '첫 미션을 공개할 월요일을 선택해 주세요.';
      buttons();
    }
    function renderWeek() {
      media.replaceChildren(); days.replaceChildren();
      weekButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i + 1 === week)));
      get('mcReady').classList.toggle('is-ready', !!common?.ready);
      if (!common) {
        get('mcReady').textContent = challenge ? (readError ? '공통 자료를 불러오지 못했습니다.' : '공통 자료를 불러오는 중입니다.') : '';
        buttons(); return;
      }
      get('mcReady').textContent = (common.ready ? '예약 준비 완료' : '준비 중') + ' · 공통 영상 ' + common.week_videos.length + '/2 · DAY ' + common.days.length + '/10';
      const video = videoFor(week);
      const videoRow = document.createElement('div'); videoRow.className = 'mc-video-row';
      const info = document.createElement('div'); info.className = 'mc-info';
      info.append(textNode('strong', week + '주차 공통 영상'), textNode('span', video?.file_name || '등록된 영상 없음', 'ms-meta'));
      const actions = document.createElement('div'); actions.className = 'ms-actions';
      if (video) actions.append(button('영상 보기', week + '주차 공통 영상 보기', e => {
        if (canLeave()) host.previewVideo(week, e.currentTarget);
      }));
      const verb = video ? '교체' : '등록';
      actions.append(button('영상 ' + verb, week + '주차 공통 영상 ' + verb, () => {
        if (canLeave()) host.editVideo(week,video);
      }));
      videoRow.append(info,actions); media.append(videoRow);
      for (let i = 0; i < 5; i++) {
        const n = (week - 1) * 5 + i + 1, d = dayFor(n);
        const row = document.createElement('div'); row.className = 'mc-row';
        const labels = document.createElement('div'); labels.className = 'mc-info';
        labels.append(textNode('strong', 'DAY ' + n + ' · ' + weekdays[i] + '요일'));
        labels.append(textNode('span', d ? d.title + ' · ' + host.timeLabel(d.chapter_start_seconds) + '–' + host.timeLabel(d.chapter_end_seconds) : '미등록', 'ms-meta'));
        row.append(labels, button(d ? '수정' : '작성', 'DAY ' + n + ' 편집', () => { if (canLeave()) openDay(n); }));
        days.append(row);
      }
      buttons();
    }
    function openDay(n) {
      const d = dayFor(n);
      editing = n; baseRevision = common.revision; dirty = false; conflict = false;
      form.querySelector('legend').textContent = 'DAY ' + n + ' · ' + weekdays[(n - 1) % 5] + '요일 공통 미션';
      fields.title.value = d?.title || ''; fields.body.value = d?.body || '';
      fields.start.value = host.timeLabel(d?.chapter_start_seconds); fields.end.value = host.timeLabel(d?.chapter_end_seconds);
      form.hidden = false; message.textContent = ''; buttons(); fields.title.focus();
    }
    function setRoundState(state) {
      roundSchedule = state;
      host.onRoundState(state?.state || null);
    }
    async function refresh() {
      if (!challenge) return false;
      const turn = ++generation, data = {challenge};
      if (round) data.round = Number(round);
      reading = true; readError = false;
      if (!common) renderWeek();
      renderSchedule();
      try {
        const next = await host.rpc('admin-curriculum',data);
        if (turn !== generation) return false;
        if (!Array.isArray(next?.days) || !Array.isArray(next?.week_videos) || !Number.isInteger(next.revision)) throw Error('invalid_response');
        common = next; setRoundState(next.round_schedule);
        if (next.round_schedule?.state === 'scheduled') pendingSchedule = null;
        renderWeek(); return true;
      } catch (error) {
        if (turn === generation) {
          readError = true;
          message.textContent = errorMessage(error);
          if (!common) renderWeek();
        }
        return false;
      } finally {
        if (turn === generation) { reading = false; renderSchedule(); }
      }
    }
    function select(code, cohort, programStart) {
      code = code || ''; cohort = String(cohort || ''); programStart = programStart || '';
      if (code === challenge && cohort === round) {
        if (earliest !== programStart) {
          earliest = programStart;
          if (challenge && round) pendingRead = refresh();
          else renderSchedule();
        }
        return pendingRead;
      }
      const scopeChanged = code !== challenge;
      ++generation; reading = false; readError = false;
      challenge = code; round = cohort; earliest = programStart;
      pendingSchedule = null; dateEdited = false; start.value = '';
      if (scopeChanged) {
        common = null; week = 1; closeEditor(); media.replaceChildren(); days.replaceChildren(); message.textContent = '';
      }
      workspace.hidden = !code; setRoundState(null);
      if (!code) { renderWeek(); renderSchedule(); return; }
      pendingRead = refresh();
      return pendingRead;
    }
    function showConflict() {
      get('mcConflict')?.remove();
      const d = dayFor(editing), alert = document.createElement('div');
      alert.id = 'mcConflict'; alert.className = 'mc-conflict';
      alert.append(textNode('strong','현재 저장된 DAY ' + editing));
      alert.append(textNode('p', d ? d.title + ' · ' + host.timeLabel(d.chapter_start_seconds) + '–' + host.timeLabel(d.chapter_end_seconds) : '아직 저장된 미션이 없습니다.'));
      if (d) alert.append(textNode('p', d.body));
      alert.append(button('저장된 내용 사용','저장된 내용 사용', () => { const n = editing; closeEditor(); openDay(n); }));
      alert.append(button('내 입력 유지','내 입력 유지', () => {
        baseRevision = common.revision; conflict = false; alert.remove(); buttons(); message.textContent = '입력한 내용을 확인한 뒤 DAY 저장을 눌러 주세요.';
      }));
      form.querySelector('fieldset').append(alert);
    }
    async function saveDay(event) {
      event.preventDefault();
      if (!editing || locked() || conflict || !common) return;
      const n = editing, value = {challenge,expected_revision:baseRevision,day_no:n,title:fields.title.value.trim(),body:fields.body.value.trim(),
        chapter_start_seconds:host.parseTime(fields.start.value),chapter_end_seconds:host.parseTime(fields.end.value)};
      const first = value.chapter_start_seconds, last = value.chapter_end_seconds;
      fields.title.setCustomValidity(value.title ? '' : '미션 제목을 입력해 주세요.');
      fields.body.setCustomValidity(value.body ? '' : '미션 내용을 입력해 주세요.');
      fields.start.setCustomValidity(Number.isInteger(first) && first >= 0 && first < 86400 ? '' : '시작 시간을 분:초로 입력해 주세요.');
      fields.end.setCustomValidity(Number.isInteger(last) && last > first && last <= 86400 ? '' : '끝 시간은 시작 시간보다 늦고 24시간 이내여야 합니다.');
      if (!form.reportValidity()) return;
      setWriting(true);
      try {
        const saved = await host.rpc('admin-curriculum-save',value);
        if (challenge !== value.challenge) return;
        if (!Number.isInteger(saved?.revision)) throw Error('invalid_response');
        closeEditor(); message.textContent = 'DAY ' + n + ' 공통 미션을 저장했습니다.';
        await refresh();
      } catch (error) {
        if (challenge !== value.challenge) return;
        message.textContent = errorMessage(error);
        if (errorCode(error) === 'edit_conflict') {
          conflict = true;
          if (await refresh()) { showConflict(); message.textContent = '다른 운영자가 저장한 최신 내용과 내 입력을 확인해 주세요.'; }
          else { conflict = false; message.textContent = '최신 내용을 확인하지 못했습니다. 입력을 유지했습니다. 다시 시도해 주세요.'; }
        }
      } finally { setWriting(false); }
    }
    async function reserve() {
      if (locked() || schedule.disabled || !challenge || !round || !validStart()) return;
      if (!canLeave()) return;
      const request = pendingSchedule || {challenge,round:Number(round),start_date:start.value,expected_revision:common.revision};
      pendingSchedule = request; setWriting(true);
      scheduleStatus.textContent = '10일 미션을 예약하고 있습니다.';
      try {
        const result = await host.rpc('admin-curriculum-schedule',request);
        if (request.challenge !== challenge || String(request.round) !== round) return;
        if (result?.state !== 'scheduled') throw Error('invalid_response');
        pendingSchedule = null;
        setRoundState({state:'scheduled',start_date:result.start_date,revision:result.revision});
        renderSchedule(); await host.onScheduled();
      } catch (error) {
        if (request.challenge !== challenge || String(request.round) !== round) return;
        const definite = !!errorCode(error);
        if (definite) pendingSchedule = null;
        const checked = await refresh();
        if (checked && roundSchedule?.state === 'scheduled') await host.onScheduled();
        else if (definite) scheduleStatus.textContent = errorMessage(error);
      } finally { setWriting(false); }
    }

    weekButtons.forEach((b,i) => b.addEventListener('click', () => {
      if (week === i + 1 || !canLeave()) return;
      week = i + 1; message.textContent = ''; renderWeek(); b.focus();
    }));
    refreshButton.addEventListener('click', () => {
      if (!locked() && !reading) { message.textContent = ''; refresh(); }
    });
    form.addEventListener('input', e => {
      dirty = true; e.target.setCustomValidity('');
      if (e.target === fields.start) fields.end.setCustomValidity('');
    });
    form.addEventListener('submit',saveDay);
    get('mcDayCancel').addEventListener('click', () => {
      if (!dirty || window.confirm('작성 중인 DAY의 변경사항을 버릴까요?')) {
        const n = editing; closeEditor(); days.querySelector('[aria-label="DAY ' + n + ' 편집"]')?.focus();
      }
    });
    start.addEventListener('input', () => {
      dateEdited = true; pendingSchedule = null; renderSchedule();
    });
    schedule.addEventListener('click', reserve);
    workspace.hidden = true;
    return {select,refresh,getVideo:videoFor,closeEditor,isDirty:() => dirty,
      focusEditor() { if (!editing) return false; fields.title.focus(); return true; },
      setBusy(on) { externalBusy = !!on; buttons(); },
      get activeWeek() { return week; }};
  }
  window.MONCCurriculumAdmin = {create};
})();

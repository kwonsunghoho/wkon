/* 운영자가 선택한 보신각 기수의 평일 미션 예약. 공개 여부와 변경 권한은 서버에서 판정한다. */
(function () {
  'use strict';

  const panel = document.getElementById('missionSchedule');
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
  let round = '';
  let rows = [];
  let sequence = 0;
  let editId = null;
  let dirty = false;
  let saving = false;
  let ready = false;

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
  function closeEditor() {
    form.hidden = true; form.reset(); editId = null; dirty = false;
    title.setCustomValidity(''); body.setCustomValidity(''); date.setCustomValidity('');
  }
  function canDiscard() {
    return !dirty || window.confirm('작성 중인 미션을 저장하지 않고 이동할까요?');
  }
  function controls() {
    roundSelect.disabled = saving || roundSelect.options.length < 1;
    fields.disabled = saving || !ready;
    refreshButton.disabled = saving || !round;
    addButton.disabled = saving || !ready || !availableDays().length;
    list.querySelectorAll('button').forEach(b => { b.disabled = saving || !ready; });
  }
  async function rpc(action, data) {
    const result = await MONC.sb.rpc('challenge_room', {p_action:action, p_data:data});
    if (result.error) throw result.error;
    return result.data;
  }
  function locked(row) {
    return row.locked || Date.parse(row.opens_at) <= Date.now();
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
    if (/locked|already.open|already.released|past_date/i.test(reason)) return '이미 공개됐거나 공개 시각이 지났습니다. 일정을 새로고침해 주세요.';
    if (error?.code === '23505' || /duplicate|conflict/i.test(reason)) return '같은 DAY 또는 공개 날짜가 이미 등록되어 있습니다.';
    if (/weekend|weekday|release_date|release_range|bad_schedule|bad_date/i.test(reason)) return '기수 일정에 맞는 미래의 평일을 선택해 주세요.';
    if (/forbidden|permission|admin_required/i.test(reason)) return '관리자 권한을 확인해 주세요.';
    return '처리하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.';
  }
  async function load(after = '') {
    const turn = ++sequence;
    ready = false; rows = []; list.replaceChildren(); controls();
    if (!round) { msg.textContent = '기수 관리에서 보신각 기수를 먼저 등록해 주세요.'; return; }
    msg.textContent = '예약 일정을 불러오는 중입니다.';
    try {
      const data = await rpc('admin-list', {challenge:'voice', round:Number(round)});
      if (turn !== sequence) return;
      if (!Array.isArray(data?.missions)) throw new Error('missing missions');
      rows = data.missions; ready = true; showRows(); msg.textContent = after;
    } catch (error) {
      if (turn === sequence) msg.textContent = [after, errorText(error)].filter(Boolean).join(' ');
    } finally { if (turn === sequence) controls(); }
  }
  function setRounds(items) {
    const options = (items || []).filter(r => r.challenge === 'voice').sort((a,b) => Number(b.round) - Number(a.round));
    const last = round;
    roundSelect.replaceChildren(...options.map(r => {
      const option = new Option('보신각(보이스) ' + r.round + '기', String(r.round));
      option.dataset.start = r.program_start || ''; return option;
    }));
    if (options.some(r => String(r.round) === last)) roundSelect.value = last;
    round = roundSelect.value;
    if (items === null) {
      ++sequence; closeEditor(); ready = false; rows = []; list.replaceChildren();
      msg.textContent = '기수 목록을 불러오지 못했습니다. 기수 관리를 다시 열어 주세요.';
    } else if (last !== round || !ready) {
      closeEditor(); rows = []; ready = false;
      if (panel.open) load();
    }
    controls();
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
    form.querySelector('legend').textContent = row ? 'DAY ' + row.day_no + ' 미션 수정' : '새 미션';
    document.getElementById('msDelete').hidden = !row;
    msg.textContent = ''; form.hidden = false; (row ? title : day).focus();
  }
  async function write(action, data, success) {
    const targetRound = round;
    saving = true; controls(); msg.textContent = '저장 중입니다.';
    try {
      await rpc(action, data);
      if (round !== targetRound) return;
      closeEditor(); await load(success);
      if (panel.open) refreshButton.focus();
    } catch (error) { msg.textContent = errorText(error); }
    finally { saving = false; controls(); }
  }
  roundSelect.addEventListener('change', () => {
    if (!canDiscard()) { roundSelect.value = round; return; }
    round = roundSelect.value; closeEditor(); load();
  });
  panel.addEventListener('toggle', () => { if (panel.open && !saving && !dirty && form.hidden) load(); });
  refreshButton.addEventListener('click', () => { if (canDiscard()) { closeEditor(); load(); } });
  addButton.addEventListener('click', () => { if (canDiscard()) openEditor(); });
  form.addEventListener('input', e => { dirty = true; e.target.setCustomValidity?.(''); });
  document.getElementById('msCancel').addEventListener('click', () => { if (canDiscard()) { closeEditor(); addButton.focus(); } });
  document.getElementById('msDelete').addEventListener('click', () => {
    if (!saving && editId && window.confirm('이 기수의 DAY ' + day.value + ' 미션 예약을 취소할까요?')) {
      write('admin-delete', {id:editId}, '미션 예약을 취소했습니다.');
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (saving || !ready || form.hidden) return;
    if (date.value < (roundSelect.selectedOptions[0]?.dataset.start || '')) date.setCustomValidity('프로그램 시작일 이후의 평일을 선택해 주세요.');
    else if (!isWeekday(date.value) || date.value <= koreanDate()) date.setCustomValidity('내일 이후의 평일을 선택해 주세요.');
    else if (rows.some(r => r.id !== editId && r.release_date === date.value)) date.setCustomValidity('같은 날짜에 예약된 미션이 있습니다.');
    else date.setCustomValidity('');
    title.setCustomValidity(title.value.trim() ? '' : '미션 제목을 입력해 주세요.');
    body.setCustomValidity(body.value.trim() ? '' : '미션 내용을 입력해 주세요.');
    if (!form.reportValidity()) return;
    const payload = {challenge:'voice', round:Number(round), day_no:Number(day.value), release_date:date.value, title:title.value.trim(), body:body.value.trim()};
    if (editId) payload.id = editId;
    write('admin-save', payload, '미션을 예약했습니다.');
  });
  window.MONCMissionSchedule = {setRounds};
})();


/* 모집자·운영 관리자 공용 화면. 권한과 정원은 서버 응답을 기준으로 한다. */
(function () {
  'use strict';
  let studyId='', tab='applicants', selected='', detailOpen=false;
  const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const button=(action,label,id='',extra='')=>`<button type="button" class="sm-button" data-action="${action}" data-id="${e(id)}" ${extra}>${e(label)}</button>`;
  const day=v=>v?new Date(v).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric'}):'';
  const status={open:'모집 중',closed:'모집 마감',ended:'스터디 종료',hidden:'숨김'};
  const skillNames={basic:'기본 신상답변',experience:'경험답변',voice:'발성·스피치',followup:'추가 질문',situation:'상황문항',video:'영상면접',feedback:'피드백',lead:'스터디 진행'};
  const skillText=p=>(p?.skills||[]).map(k=>skillNames[k]).filter(Boolean).join(' · ')||'준비 항목 미입력';
  const proof=p=>[(p?.certificates||[]).length?'면접 경험 인증':'면접 경험 미인증',p?.assessment?'몬크 Lv.'+p.assessment.level:'실력검증 전'].join(' · ');
  const definition=rows=>`<dl class="sm-facts">${rows.map(([k,v])=>`<div><dt>${e(k)}</dt><dd>${e(v||'미입력')}</dd></div>`).join('')}</dl>`;
  function contact(c,admin){return `<section class="sm-contact"><h3>연락 정보</h3><p class="sm-meta">${admin?'운영 관리자에게만 표시됩니다.':'제공 동의 범위에서 조장에게만 표시됩니다.'}</p>${c?definition([['실명',c.name],['휴대폰',c.phone]]):'<p class="sm-meta">실명·연락처 제공 동의 전입니다.</p>'}</section>`;}
  function applicantDetail(a,s,st){
    const p=a.profile;
    return `<div class="sm-person-heading"><div><h2 id="sm-detail-heading" tabindex="-1">${e(p?.nickname||'프로필 확인 불가')}</h2><p class="sm-meta">${day(a.created_at)} 지원 · 승인 대기</p></div>${button('sm-back','목록으로','','aria-label="지원자 목록으로 돌아가기"')}</div>
      ${p?definition([['목표',p.goals],['준비 항목',skillText(p)],['보완할 점',p.improve],['가능 시간',p.schedule]]):'<p>프로필을 확인할 수 없는 지원자입니다.</p>'}
      <p class="sm-meta">준비 항목은 본인이 직접 표시한 내용입니다.</p><section class="sm-detail-section"><h3>경험·실력 확인</h3><p>${e(proof(p))}</p>${p?.assessment?`<p class="sm-meta">몬크 확인 항목: ${e((p.assessment.skills||[]).map(k=>skillNames[k]).filter(Boolean).join(' · ')||'별도 표시 없음')}</p>`:''}</section>
      ${p?.bio?`<section class="sm-detail-section"><h3>한 줄 소개</h3><p class="sm-copy">${e(p.bio)}</p></section>`:''}
      <section class="sm-detail-section"><h3>지원 이유</h3><p class="sm-copy">${e(a.message||'지원 이유를 작성하지 않았어요.')}</p>${p?button('sm-profile','전체 프로필 · 답변 샘플 보기',p.id):''}</section>
      ${contact(a.contact,st.administrator)}
      <div class="sm-decision">${button('application-reject','지원 제외',a.id,s.status!=='open'?'disabled':'')}${button('application-accept','참여 승인',a.id,s.status!=='open'||s.members>=s.capacity||!p?'disabled':'')}</div>
      ${s.members>=s.capacity?'<p class="sm-meta">정원이 찼습니다. 빈자리가 생긴 후 승인할 수 있습니다.</p>':''}`;
  }
  // 모바일은 핵심 요약과 판단 정보를 먼저 읽고 추가 이력은 펼쳐 본다.
  function mobileDetail(a,s,st){
    const p=a.profile;
    return `<div class="sm-mobile-detail"><div class="sm-mobile-top">${button('sm-back','지원자 목록','','aria-label="지원자 목록으로 돌아가기"')}<span>${st.administrator?'관리자':'모집자'}</span></div><p class="sm-study-context">${e(s.title)}</p>
    <section class="sm-mobile-profile" aria-label="지원자 프로필"><div class="sm-mobile-name"><h2 id="sm-mobile-heading" tabindex="-1">${e(p?.nickname||'프로필 확인 불가')}</h2><span>승인 대기 · ${day(a.created_at)}</span></div><p class="sm-mobile-goal">${e(p?.goals||'목표 미입력')}</p><div class="sm-proof-summary">${proof(p).split(' · ').map(v=>`<span>${e(v)}</span>`).join('')}</div>
    <dl class="sm-fit"><div><dt>참여 가능 시간</dt><dd>${e(p?.schedule||'미입력')}</dd></div><div><dt>준비한 항목 <span>본인 표시</span></dt><dd class="sm-skill-lines">${(p?.skills||[]).map(k=>skillNames[k]).filter(Boolean).map(v=>`<span>${e(v)}</span>`).join('')||'미입력'}</dd></div></dl></section>
    <section class="sm-mobile-application" aria-label="지원 내용"><h3>함께 연습하고 싶은 점</h3><p class="sm-improve">${e(p?.improve||'보완하고 싶은 점을 작성하지 않았어요.')}</p><h3 class="sm-reason-title">지원 이유</h3><p class="sm-copy">${e(a.message||'지원 이유를 작성하지 않았어요.')}</p>
    <details class="sm-mobile-more"><summary>소개·인증·답변 샘플 더 보기</summary><div><p class="sm-copy">${e(p?.bio||'소개 미입력')}</p>${p?.assessment?`<p class="sm-meta">몬크 확인 항목: ${e((p.assessment.skills||[]).map(k=>skillNames[k]).filter(Boolean).join(' · ')||'별도 표시 없음')}</p>`:''}${p?button('sm-profile','전체 프로필 · 답변 샘플',p.id):''}</div></details></section>
    <section class="sm-mobile-private" aria-label="비공개 관리"><div class="sm-private-heading"><h3>연락처</h3><span>비공개</span></div><p class="sm-meta">${st.administrator?'운영 관리자에게만 표시됩니다.':'제공 동의 범위에서 조장에게만 표시됩니다.'}</p>${a.contact?`<p class="sm-contact-inline"><strong>${e(a.contact.name)}</strong><span>${e(a.contact.phone)}</span></p>`:'<p class="sm-meta">실명·연락처 제공 동의 전입니다.</p>'}<div class="sm-decision">${button('application-reject','지원 제외',a.id,s.status!=='open'?'disabled':'')}${button('application-accept','참여 승인',a.id,s.status!=='open'||s.members>=s.capacity||!p?'disabled':'')}</div>${s.members>=s.capacity?'<p class="sm-meta">정원이 찼습니다. 빈자리가 생긴 후 승인할 수 있습니다.</p>':''}</section></div>`;
  }
  function applicants(s,st){
    const rows=st.applications||[];
    if(!rows.length){selected='';detailOpen=false;return '<div class="sm-empty"><h2>승인 대기 중인 지원자가 없어요</h2><p>새 지원이 들어오면 이곳에서 준비 상태와 지원 이유를 확인할 수 있어요.</p></div>';}
    if(!rows.some(a=>a.id===selected)){selected=rows[0].id;detailOpen=false;}
    const a=rows.find(v=>v.id===selected);
    return `<div class="sm-workspace ${detailOpen?'has-detail':''}"><section class="sm-master" aria-label="지원자 목록"><div class="sm-section-head"><h2>지원자</h2><span class="sm-meta">최근 신청순</span></div><div class="sm-list-head" aria-hidden="true"><span>지원자</span><span>목표 · 준비 상태</span><span>신청일</span></div><div class="sm-applicants">${rows.map(v=>`<button type="button" class="sm-applicant ${v.id===selected?'is-selected':''}" data-action="sm-select" data-id="${e(v.id)}" aria-pressed="${v.id===selected}" aria-controls="sm-applicant-detail"><strong>${e(v.profile?.nickname||'프로필 확인 불가')}</strong><span class="sm-applicant-info"><b>${e(v.profile?.goals||'목표 미입력')}</b><span>${e(skillText(v.profile))}</span><small>${e(proof(v.profile))}</small></span><time datetime="${e(v.created_at)}">${day(v.created_at)}</time></button>`).join('')}</div><p class="sm-meta sm-list-help">지원자를 선택하면 상세 내용을 확인할 수 있어요.</p></section><section id="sm-applicant-detail" class="sm-detail" aria-label="선택한 지원자 상세"><div class="sm-desktop-detail">${applicantDetail(a,s,st)}</div>${mobileDetail(a,s,st)}</section></div>`;
  }
  function members(s,st){return `<section class="sm-members"><div class="sm-section-head"><h2>참여자 ${s.members}명</h2><span class="sm-meta">조장 포함</span></div>${(st.members||[]).map(v=>`<article class="sm-member"><div><h3>${e(v.profile?.nickname||'프로필 확인 불가')}${v.role==='owner'?'<span class="sm-owner-label">조장</span>':''}</h3><p class="sm-meta">${e(v.profile?.goals||'목표 미입력')} · ${e(proof(v.profile))}</p>${v.contact?`<p class="sm-member-contact">${e(v.contact.name)} · ${e(v.contact.phone)}</p>`:v.role!=='owner'?'<p class="sm-meta">실명·연락처 제공 동의 전</p>':''}</div><div class="sm-member-actions">${v.profile?button('sm-profile','프로필 보기',v.profile.id):''}${v.role!=='owner'&&v.profile&&['open','closed'].includes(s.status)?`<details><summary>참여 관리</summary><div>${button('study-transfer','조장 인계',v.profile.id)}${button('study-remove-member','내보내기',v.profile.id)}</div></details>`:''}</div></article>`).join('')}</section>`;}
  function settings(s,st){return `<section class="sm-settings"><h2>모집 설정</h2><p>${s.status==='open'?`현재 ${Math.max(0,s.capacity-s.members)}명이 더 참여할 수 있어요.`:s.status==='closed'?'모집은 마감됐지만 기존 참여자와 안내는 유지됩니다.':s.status==='hidden'?'숨김 상태입니다. 관리자 콘텐츠 관리에서 숨김을 해제할 수 있습니다.':'스터디 활동이 종료됐습니다. 기존 기록은 보관됩니다.'}</p><div class="sm-setting-actions">${['open','closed'].includes(s.status)?button('study-edit','모집글 수정',s.id):''}${s.status==='open'?button('study-close','모집 마감',s.id):''}${s.status==='closed'?button('study-reopen','다시 모집하기',s.id,s.members>=s.capacity?'disabled':''):''}</div>${s.status==='closed'&&s.members>=s.capacity?'<p class="sm-meta">정원이 찼어요. 빈자리가 생기면 다시 모집할 수 있어요.</p>':''}${['open','closed'].includes(s.status)?`<details class="sm-end"><summary>활동 종료 관리</summary><p>모집 마감과 달리 실제 스터디 활동을 종료합니다. 종료 후에는 다시 모집할 수 없습니다.</p>${button('study-end','스터디 활동 종료',s.id)}</details>`:''}${st.administrator?'<p class="sm-meta">운영 관리자 변경 작업은 처리 사유와 함께 기록됩니다.</p>':''}</section>`;}
  function render(s,st){
    if(studyId!==s.id){studyId=s.id;tab='applicants';selected='';detailOpen=false;}
    const content=tab==='applicants'?applicants(s,st):tab==='members'?members(s,st):tab==='guide'?`<section class="sm-guide"><div class="sm-section-head"><h2>참여 안내</h2><span class="sm-meta">참여자·운영 관리자에게만 공개</span></div><p class="sm-copy">${e(st.member_guide||'모임 장소와 준비물을 안내해 주세요.')}</p>${['open','closed'].includes(s.status)?button('study-guide',st.member_guide?'안내 수정':'안내 작성',s.id):''}</section>`:tab==='settings'?settings(s,st):`<section class="sm-guide"><h2>모집 정보</h2>${definition([['진행 방식',s.mode==='online'?'온라인':'오프라인'],['장소',s.location],['목표',s.goals]])}<h3>스터디 소개</h3><p class="sm-copy">${e(s.description)}</p><h3>모집 조건</h3><ul>${[...(s.recruitment_conditions||[]),s.min_level?`몬크 Lv.${s.min_level} 이상`:"",s.require_experience?"면접 진출 경험 인증 필수":"",...(s.required_skills||[]).map(k=>skillNames[k])].filter(Boolean).map(v=>`<li>${e(v)}</li>`).join('')||'<li>별도 조건 없음</li>'}</ul></section>`;
    return `<article class="sm-root ${tab==='applicants'&&detailOpen?'sm-detail-active':''}"><div class="sm-breadcrumb">${button(st.administrator?'study-admin':'studies',st.administrator?'전체 스터디 관리':'스터디 목록')}</div><header class="sm-header"><div><h2>${e(s.title)}</h2><p>${e(s.schedule)}${s.location?' · '+e(s.location):''}</p></div>${button('sm-tab','모집 설정','settings','aria-pressed="'+(tab==='settings')+'"')}</header>${st.administrator?'<p class="sm-admin-label">운영 관리자 · 전체 스터디 관리 권한</p>':''}<div class="sm-summary"><strong>${e(status[s.status]||s.status)}</strong><span>참여 ${s.members}/${s.capacity}명</span><span>승인 대기 ${(st.applications||[]).length}명</span></div><nav class="sm-tabs" aria-label="스터디 관리 메뉴">${[['applicants','지원자 '+(st.applications||[]).length],['members','참여자 '+s.members],['guide','참여 안내'],['info','모집 정보']].map(([k,label])=>button('sm-tab',label,k,`aria-pressed="${tab===k}"`)).join('')}</nav><div id="sm-content">${content}</div></article>`;
  }
  function act(action,id,s,st){
    if(!['sm-tab','sm-select','sm-back'].includes(action))return false;
    if(action==='sm-tab'){tab=id;detailOpen=false;}
    if(action==='sm-select'){selected=id;detailOpen=true;}
    if(action==='sm-back')detailOpen=false;
    document.getElementById('main').innerHTML=render(s,st);
    const target=action==='sm-select'?document.getElementById(innerWidth<=700?'sm-mobile-heading':'sm-detail-heading'):action==='sm-back'?document.querySelector('.sm-applicant.is-selected'):document.querySelector(`.sm-tabs [data-id="${tab}"]`);
    target?.focus({preventScroll:true});
    if(innerWidth<=700&&['sm-select','sm-back'].includes(action))document.querySelector('.sm-root')?.scrollIntoView({block:'start'});
    return true;
  }
  window.MONCStudyManagement={render,act};
})();

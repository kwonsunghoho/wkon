/* ── 공용 챌린지 신청 모달 ── */
const APPLICATION_API_URL = "https://script.google.com/macros/s/AKfycbxrUFhRQvAAC3HZM8QuFCrrRfWRCQ8BA_j9-kvfLvW57QIroF0OsNahynY2Xi1RFnGz1w/exec";

/* ── CSS 주입 ── */
(function injectStyle() {
  const s = document.createElement('style');
  s.textContent = `
    #applicationModal {
      position: fixed; top:0; left:0; right:0; bottom:0;
      background: rgba(0,0,0,.5); display:none;
      align-items:center; justify-content:center;
      z-index:2000; padding:16px;
    }
    #applicationModal.open { display:flex; }
    .app-modal-content {
      background:#fff; border-radius:20px; padding:32px 28px;
      width:100%; max-width:500px; max-height:88vh; overflow-y:auto;
      box-shadow:0 20px 60px rgba(0,0,0,.25); position:relative;
      font-family:'Pretendard','Apple SD Gothic Neo',-apple-system,sans-serif;
    }
    .app-modal-content h2 { font-size:22px; font-weight:900; margin-bottom:24px; color:#241A12; }
    .app-modal-close {
      position:absolute; top:14px; right:18px;
      font-size:26px; cursor:pointer; color:#999; line-height:1;
      background:none; border:none;
    }
    .app-modal-close:hover { color:#333; }
    .app-modal-input {
      width:100%; padding:12px 15px; margin-bottom:10px;
      border:1.5px solid rgba(36,26,18,.2); border-radius:10px;
      font-size:14px; font-family:inherit; box-sizing:border-box; color:#241A12;
    }
    .app-modal-input:focus { outline:none; border-color:#241A12; box-shadow:0 0 0 3px rgba(36,26,18,.1); }
    .app-modal-btn {
      width:100%; padding:14px;
      background:linear-gradient(135deg,#241A12,#9A5B1E);
      color:#fff; border:none; border-radius:10px;
      font-weight:700; font-size:15px; cursor:pointer;
      margin-top:8px; transition:all .25s; font-family:inherit;
    }
    .app-modal-btn:hover { transform:translateY(-2px); box-shadow:0 8px 20px rgba(36,26,18,.3); }
    .modal-status-tag {
      font-size:10px; font-weight:800; padding:2px 7px;
      border-radius:99px; margin-left:4px; white-space:nowrap;
    }
  `;
  document.head.appendChild(s);
})();

/* ── HTML 주입 ── */
document.addEventListener('DOMContentLoaded', function() {
  if (document.getElementById('applicationModal')) return; // 이미 있으면 스킵

  document.body.insertAdjacentHTML('beforeend', `
  <div id="applicationModal">
    <div class="app-modal-content">
      <button class="app-modal-close" onclick="closeApplicationModal()">&times;</button>
      <h2>챌린지 신청</h2>

      <input type="text"  id="appName"    placeholder="이름"                                          class="app-modal-input">
      <input type="tel"   id="appPhone"   placeholder="전화번호 (010-0000-0000)"                       class="app-modal-input">
      <input type="text"  id="appAccount" placeholder="보증금 환급 계좌 (예: 신한 110-000-000000 홍길동)" class="app-modal-input">

      <div style="margin-top:16px; margin-bottom:4px;">
        <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;">신청 챌린지 선택</h3>

        <!-- 보신각 -->
        <label style="display:flex;align-items:center;gap:10px;margin-bottom:6px;cursor:pointer;">
          <input type="checkbox" class="challenge-checkbox" data-price="30000" data-deposit="30000"
            data-name="보.신.각(보이스) - 목소리 챌린지" data-curriculum="currVoice" data-recruit-id="voice">
          <div style="flex:1;">
            <div style="font-size:14px;font-weight:600;">보.신.각(보이스)</div>
            <div style="font-size:12px;color:#6B5744;">목소리 챌린지</div>
          </div>
          <span style="font-size:12px;color:#241A12;font-weight:700;white-space:nowrap;">참가비 3만원</span>
        </label>
        <div id="currVoice" style="display:none;background:#FFF7ED;border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid rgba(36,26,18,.15);">
          <div style="font-size:12px;font-weight:700;color:#241A12;margin-bottom:10px;">📋 2주 커리큘럼 — 보신각</div>
          <div onclick="toggleCurr('cv1')" style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px;user-select:none;">
            <span style="font-size:11px;color:#241A12;">▶</span><span style="font-size:12px;font-weight:700;">1주차: 내 목소리 찾기</span>
          </div>
          <div id="cv1" style="display:none;padding-left:16px;margin-bottom:8px;">
            <div style="font-size:11px;color:#6B5744;line-height:2;">
              📅 월 — 나에게 편한 톤 찾기<br>📅 화 — 목소리가 잘 나오는 자세<br>📅 수 — 단단한 아나운서 목소리 만들기<br>📅 목·금 — 반복 훈련과 짧은 문장 적용
            </div>
          </div>
          <div onclick="toggleCurr('cv2')" style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px;user-select:none;">
            <span style="font-size:11px;color:#241A12;">▶</span><span style="font-size:12px;font-weight:700;">2주차: 대본에 목소리 적용하기</span>
          </div>
          <div id="cv2" style="display:none;padding-left:16px;">
            <div style="font-size:11px;color:#6B5744;line-height:2;">
              📅 월·화 — 안정적인 정보 전달과 중간톤 굳히기<br>📅 수·금 — 호흡의 길이 조절과 감정 울림 확장
            </div>
          </div>
        </div>

        <!-- 스피닝 -->
        <label style="display:flex;align-items:center;gap:10px;margin-bottom:6px;cursor:pointer;">
          <input type="checkbox" class="challenge-checkbox" data-price="30000" data-deposit="30000"
            data-name="스.피.닝(스피치) - 말 맛 챌린지" data-curriculum="currSpinning" data-recruit-id="spinning">
          <div style="flex:1;">
            <div style="font-size:14px;font-weight:600;">스.피.닝(스피치)</div>
            <div style="font-size:12px;color:#6B5744;">말 맛 챌린지</div>
          </div>
          <span style="font-size:12px;color:#241A12;font-weight:700;white-space:nowrap;">참가비 3만원</span>
        </label>
        <div id="currSpinning" style="display:none;background:#FFF7ED;border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid rgba(36,26,18,.15);">
          <div style="font-size:12px;font-weight:700;color:#241A12;margin-bottom:10px;">📋 2주 커리큘럼 — 스피닝</div>
          <div onclick="toggleCurr('cs1')" style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px;user-select:none;">
            <span style="font-size:11px;color:#241A12;">▶</span><span style="font-size:12px;font-weight:700;">1주차: 말의 기본기를 만드는 주간</span>
          </div>
          <div id="cs1" style="display:none;padding-left:16px;margin-bottom:8px;">
            <div style="font-size:11px;color:#6B5744;line-height:2;">
              📅 DAY 1 — 정확한 발음 1<br>📅 DAY 2 — 정확한 발음 2<br>📅 DAY 3 — 숨 쉬면서 말하기<br>📅 DAY 4 — 웃으면서 말하기<br>📅 DAY 5 — 인토네이션 &amp; 미소 체크
            </div>
          </div>
          <div onclick="toggleCurr('cs2')" style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px;user-select:none;">
            <span style="font-size:11px;color:#241A12;">▶</span><span style="font-size:12px;font-weight:700;">2주차: 면접 답변에 말투를 입히는 주간</span>
          </div>
          <div id="cs2" style="display:none;padding-left:16px;">
            <div style="font-size:11px;color:#6B5744;line-height:2;">
              📅 DAY 6 — 신뢰도 있게 말하기<br>📅 DAY 7 — 음의 고저 만들기<br>📅 DAY 8 — 쿠셔닝 표현 사용하기<br>📅 DAY 9 — 쉽게 말하기<br>📅 DAY 10 — 최종 스피치 발표
            </div>
          </div>
        </div>

        <!-- 영합각 -->
        <label style="display:flex;align-items:center;gap:10px;margin-bottom:6px;cursor:pointer;">
          <input type="checkbox" class="challenge-checkbox" data-price="30000" data-deposit="30000"
            data-name="영.합.각(표현력) - 영상면접 표현력 챌린지" data-curriculum="currExpression" data-recruit-id="expression">
          <div style="flex:1;">
            <div style="font-size:14px;font-weight:600;">영.합.각(표현력)</div>
            <div style="font-size:12px;color:#6B5744;">영상면접 표현력 챌린지</div>
          </div>
          <span style="font-size:12px;color:#241A12;font-weight:700;white-space:nowrap;">참가비 3만원</span>
        </label>
        <div id="currExpression" style="display:none;background:#FFF7ED;border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid rgba(36,26,18,.15);">
          <div style="font-size:12px;font-weight:700;color:#241A12;margin-bottom:10px;">📋 2주 커리큘럼 — 영합각</div>
          <div onclick="toggleCurr('ce1')" style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px;user-select:none;">
            <span style="font-size:11px;color:#241A12;">▶</span><span style="font-size:12px;font-weight:700;">1주차: 카메라 이미지 세팅</span>
          </div>
          <div id="ce1" style="display:none;padding-left:16px;margin-bottom:8px;">
            <div style="font-size:11px;color:#6B5744;line-height:2;">
              🎬 DAY 1 — 캐릭터 찾기<br>🎬 DAY 2 — 스타일링<br>🎬 DAY 3 — 미소·아이컨택<br>🎬 DAY 4 — 자세·각도<br>🎬 DAY 5 — 이미지 파이널
            </div>
          </div>
          <div onclick="toggleCurr('ce2')" style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px;user-select:none;">
            <span style="font-size:11px;color:#241A12;">▶</span><span style="font-size:12px;font-weight:700;">2주차: 말하기 전달력 파이널</span>
          </div>
          <div id="ce2" style="display:none;padding-left:16px;">
            <div style="font-size:11px;color:#6B5744;line-height:2;">
              🎬 DAY 6 — 오프닝<br>🎬 DAY 7 — 구어체 스크립트<br>🎬 DAY 8 — 호흡구간<br>🎬 DAY 9 — 인토네이션<br>🎬 DAY 10 — 최종 촬영
            </div>
          </div>
        </div>

        <!-- 승자각 -->
        <label style="display:flex;align-items:center;gap:10px;margin-bottom:6px;cursor:pointer;">
          <input type="checkbox" class="challenge-checkbox" data-price="30000" data-deposit="30000"
            data-name="승.자.각(답변) - 답변 챌린지" data-curriculum="currAnswer" data-recruit-id="answer">
          <div style="flex:1;">
            <div style="font-size:14px;font-weight:600;">승.자.각(답변)</div>
            <div style="font-size:12px;color:#6B5744;">답변 챌린지</div>
          </div>
          <span style="font-size:12px;color:#241A12;font-weight:700;white-space:nowrap;">참가비 3만원</span>
        </label>
        <div id="currAnswer" style="display:none;background:#FFF7ED;border-radius:10px;padding:14px;margin-bottom:20px;border:1px solid rgba(36,26,18,.15);">
          <div style="font-size:12px;font-weight:700;color:#241A12;margin-bottom:10px;">📋 2주 커리큘럼 — 승자각</div>
          <div onclick="toggleCurr('ca1')" style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px;user-select:none;">
            <span style="font-size:11px;color:#241A12;">▶</span><span style="font-size:12px;font-weight:700;">1주차: 기본 질문으로 나를 설명하는 힘 만들기</span>
          </div>
          <div id="ca1" style="display:none;padding-left:16px;margin-bottom:8px;">
            <div style="font-size:11px;color:#6B5744;line-height:2;">
              📅 DAY 1 — 정확한 발음 1<br>📅 DAY 2 — 정확한 발음 2<br>📅 DAY 3 — 숨 쉬면서 말하기<br>📅 DAY 4 — 웃으면서 말하기<br>📅 DAY 5 — 인토네이션 &amp; 미소 체크
            </div>
          </div>
          <div onclick="toggleCurr('ca2')" style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px;user-select:none;">
            <span style="font-size:11px;color:#241A12;">▶</span><span style="font-size:12px;font-weight:700;">2주차: 경험 질문으로 나다운 답변 완성하기</span>
          </div>
          <div id="ca2" style="display:none;padding-left:16px;">
            <div style="font-size:11px;color:#6B5744;line-height:2;">
              📅 DAY 6 — 신뢰도 있게 말하기<br>📅 DAY 7 — 음의 고저 만들기<br>📅 DAY 8 — 쿠셔닝 표현 사용하기<br>📅 DAY 9 — 쉽게 말하기<br>📅 DAY 10 — 최종 스피치 발표
            </div>
          </div>
        </div>
      </div>

      <!-- 납부 금액 -->
      <div style="background:#FFF3E6;padding:15px;border-radius:12px;margin-bottom:10px;">
        <div style="font-size:13px;font-weight:700;color:#241A12;margin-bottom:10px;">
          선택된 챌린지: <span id="selectedCount">0</span>개
        </div>
        <div style="background:#fff;border-radius:10px;padding:12px;font-size:13px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;color:#241A12;">
            <span>참가비</span><span><span id="participationFee">0</span>원</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:10px;color:#6B5744;">
            <span>보증금 <span style="font-size:11px;">(수료 시 전액 환급 💚)</span></span>
            <span><span id="depositFee">0</span>원</span>
          </div>
          <div style="border-top:1.5px solid rgba(36,26,18,.15);padding-top:10px;display:flex;justify-content:space-between;align-items:baseline;">
            <span style="font-size:14px;font-weight:800;color:#241A12;">지금 입금할 금액</span>
            <span style="font-size:20px;font-weight:900;color:#241A12;"><span id="totalPrice">0</span>원</span>
          </div>
        </div>
      </div>

      <!-- 입금 안내 -->
      <div style="background:rgba(154,91,30,.1);padding:15px;border-radius:12px;margin-bottom:15px;border:1px solid rgba(36,26,18,.2);">
        <div style="font-size:12px;font-weight:700;color:#241A12;margin-bottom:8px;">입금 정보</div>
        <div style="font-size:13px;color:#241A12;line-height:1.6;">
          <div>은행: 신한</div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span>계좌: <strong id="acctNumber">110-254-022354</strong></span>
            <button type="button" onclick="copyAccount(this)" style="font-size:11px;font-weight:700;color:#fff;background:#241A12;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;white-space:nowrap;">📋 복사</button>
          </div>
          <div>예금주: 권성호</div>
        </div>
        <div style="font-size:12px;color:#6B5744;margin-top:10px;padding-top:10px;border-top:1px solid rgba(36,26,18,.15);">
          입금 후 아래 신청 버튼을 눌러주세요
        </div>
      </div>

      <button class="app-modal-btn" onclick="submitApplication()">신청하기</button>
    </div>
  </div>
  `);

  // 체크박스 이벤트
  document.addEventListener('change', function(e) {
    if (e.target.classList.contains('challenge-checkbox')) {
      updateTotalPrice();
      updateCurriculumVisibility();
    }
  });
});

/* ── 모달 함수들 ── */
async function openApplicationModal() {
  document.getElementById('applicationModal').style.display = 'flex';
  await loadChallengeStatuses();

  const statuses = window._challengeStatuses || {};
  document.querySelectorAll('.challenge-checkbox[data-recruit-id]').forEach(cb => {
    const status   = statuses[cb.dataset.recruitId];
    const label    = cb.closest('label');
    const disabled = status === 'upcoming' || status === 'closed';

    cb.disabled = disabled;
    if (disabled) cb.checked = false;

    if (label) {
      label.style.opacity      = disabled ? '.45' : '1';
      label.style.pointerEvents = disabled ? 'none' : '';
      const old = label.querySelector('.modal-status-tag');
      if (old) old.remove();
      if (disabled) {
        const tag = document.createElement('span');
        tag.className = 'modal-status-tag';
        tag.textContent = status === 'upcoming' ? '⏰ 모집예정' : '마감';
        tag.style.cssText = `
          background:${status === 'upcoming' ? 'rgba(36,26,18,.12)' : 'rgba(120,120,120,.15)'};
          color:${status === 'upcoming' ? '#241A12' : '#888'};
          border:1px solid ${status === 'upcoming' ? 'rgba(36,26,18,.3)' : 'rgba(120,120,120,.3)'};
        `;
        label.querySelector('div').appendChild(tag);
      }
    }
  });

  updateTotalPrice();
}

function closeApplicationModal() {
  document.getElementById('applicationModal').style.display = 'none';
}

function updateCurriculumVisibility() {
  document.querySelectorAll('.challenge-checkbox').forEach(cb => {
    const currId = cb.dataset.curriculum;
    if (currId) document.getElementById(currId).style.display = cb.checked ? 'block' : 'none';
  });
}

function toggleCurr(id) {
  const content = document.getElementById(id);
  content.style.display = content.style.display !== 'none' ? 'none' : 'block';
}

function updateTotalPrice() {
  const checkboxes = document.querySelectorAll('.challenge-checkbox:checked');
  let participation = 0, deposit = 0;
  checkboxes.forEach(cb => {
    participation += parseInt(cb.dataset.price);
    deposit       += parseInt(cb.dataset.deposit);
  });
  document.getElementById('selectedCount').textContent     = checkboxes.length;
  document.getElementById('participationFee').textContent  = participation.toLocaleString();
  document.getElementById('depositFee').textContent        = deposit.toLocaleString();
  document.getElementById('totalPrice').textContent        = (participation + deposit).toLocaleString();
}

/* 계좌번호 복사 */
function copyAccount(btn) {
  const num = (document.getElementById('acctNumber') &&
               document.getElementById('acctNumber').textContent || '').trim();
  const done = () => {
    const orig = btn.textContent;
    btn.textContent = '✓ 복사됨';
    btn.style.background = '#16a34a';
    setTimeout(() => { btn.textContent = orig; btn.style.background = '#241A12'; }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(num).then(done).catch(() => _fallbackCopy(num, done));
  } else {
    _fallbackCopy(num, done);
  }
}
function _fallbackCopy(text, cb) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand('copy'); cb && cb(); } catch(e) { alert('복사 실패: ' + text); }
  document.body.removeChild(ta);
}

let _isSubmitting = false;

async function submitApplication() {
  if (_isSubmitting) return;  // 이미 전송 중이면 무시

  const name    = document.getElementById('appName').value.trim();
  const phone   = document.getElementById('appPhone').value.trim();
  const account = document.getElementById('appAccount').value.trim();

  if (!name || !phone || !account) {
    alert('이름, 전화번호, 보증금 환급 계좌를 모두 입력해주세요.');
    return;
  }

  const checkboxes = document.querySelectorAll('.challenge-checkbox:checked');
  if (checkboxes.length === 0) {
    alert('신청할 챌린지를 선택해주세요.');
    return;
  }

  // 버튼 비활성화 + 로딩 텍스트
  _isSubmitting = true;
  const btn = document.querySelector('.app-modal-btn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '신청 중...';
  btn.style.opacity = '0.7';
  btn.style.cursor  = 'not-allowed';

  const challenges = Array.from(checkboxes).map(cb => ({ name: cb.dataset.name, price: parseInt(cb.dataset.price) }));
  let totalPrice = 0;
  checkboxes.forEach(cb => { totalPrice += parseInt(cb.dataset.price) + parseInt(cb.dataset.deposit); });

  try {
    const res    = await fetch(APPLICATION_API_URL, {
      method: 'POST',
      body: JSON.stringify({ action:'application', name, phone, account, challenges, totalPrice, timestamp: new Date().toLocaleString('ko-KR') })
    });
    const result = await res.json();
    alert(result.message);
    if (result.success) {
      closeApplicationModal();
      document.getElementById('appName').value    = '';
      document.getElementById('appPhone').value   = '';
      document.getElementById('appAccount').value = '';
      document.querySelectorAll('.challenge-checkbox').forEach(cb => cb.checked = false);
      updateTotalPrice();
    }
  } catch(e) {
    alert('오류가 발생했습니다. 다시 시도해주세요.');
  } finally {
    // 성공/실패 모두 버튼 원상복구
    _isSubmitting = false;
    btn.disabled = false;
    btn.textContent = originalText;
    btn.style.opacity = '1';
    btn.style.cursor  = 'pointer';
  }
}

/**
 * ════════════════════════════════════════════════════════════════
 *  MONC 관리자 페이지용 Apps Script 추가 코드
 * ════════════════════════════════════════════════════════════════
 *
 *  이 코드는 admin.html(관리자 페이지)이 신청자 현황을 읽고,
 *  입금/환급 상태를 저장하기 위한 백엔드입니다.
 *
 *  ⚠️ 이 파일은 저장소 안 '참고용'일 뿐, 자동으로 반영되지 않습니다.
 *     아래 순서대로 구글 Apps Script 콘솔에서 직접 적용해야 합니다.
 *
 *  ── 적용 순서 ──────────────────────────────────────────────────
 *  1) 신청/후기를 처리하는 기존 Apps Script 프로젝트를 엽니다.
 *     (script.google.com → 해당 프로젝트)
 *
 *  2) 관리자 비밀번호를 안전하게 저장합니다.
 *     프로젝트 설정(톱니바퀴) → '스크립트 속성' → 속성 추가:
 *        이름:  ADMIN_PW
 *        값:   (원하는 관리자 비밀번호)
 *     ※ 비밀번호는 여기에만 저장됩니다. admin.html에는 들어가지 않습니다.
 *
 *  3) 아래 함수들(adminHandleGet / adminHandlePost / 헬퍼)을
 *     코드 맨 아래에 그대로 붙여넣습니다.
 *
 *  4) 기존 doGet(e) / doPost(e) 안에서, 응답을 만들기 전에
 *     아래 '연결 지점' 두 줄을 추가합니다:
 *
 *       function doGet(e) {
 *         const admin = adminHandleGet(e);      // ← 추가
 *         if (admin) return admin;              // ← 추가
 *         ... 기존 reviews 등 처리 ...
 *       }
 *
 *       function doPost(e) {
 *         const admin = adminHandlePost(e);     // ← 추가
 *         if (admin) return admin;              // ← 추가
 *         ... 기존 application 처리 ...
 *       }
 *
 *  5) 오른쪽 위 '배포 → 배포 관리 → 편집(연필) → 새 버전 → 배포'.
 *     ※ 반드시 '새 버전'으로 배포해야 반영됩니다. URL은 그대로 유지됩니다.
 *
 *  6) admin.html을 열어 2)에서 정한 비밀번호로 로그인하면 끝.
 * ──────────────────────────────────────────────────────────────
 */

// 신청 데이터가 들어있는 시트 이름 (다르면 여기만 바꾸세요)
const ADMIN_SHEET = '학생현황';
// 입금/환급 상태를 저장할 열 제목 (없으면 자동으로 만들어집니다)
const ADMIN_PAID_HEADER   = '입금확인';
const ADMIN_REFUND_HEADER = '환급';

function adminCheckPw_(e) {
  const want = PropertiesService.getScriptProperties().getProperty('ADMIN_PW');
  const got  = (e && e.parameter && e.parameter.pw) || adminPostBody_(e).pw;
  return want && got && String(got) === String(want);
}

function adminJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function adminPostBody_(e) {
  try { return JSON.parse(e.postData.contents); } catch (_) { return {}; }
}

// 시트에서 입금/환급/전화 열 위치를 찾고, 없으면 상태 열을 만든다
function adminCols_(sh, headers) {
  function find(names) {
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i]).trim();
      if (names.some(n => h.indexOf(n) !== -1)) return i;
    }
    return -1;
  }
  let paid   = find([ADMIN_PAID_HEADER, '입금']);
  let refund = find([ADMIN_REFUND_HEADER, '환급', '환불']);
  const phone = find(['전화', '연락처', 'phone', '휴대']);
  // 상태 열이 없으면 시트 오른쪽에 새로 만든다
  if (paid === -1)   { sh.getRange(1, headers.length + 1).setValue(ADMIN_PAID_HEADER);   paid = headers.length; headers.push(ADMIN_PAID_HEADER); }
  if (refund === -1) { sh.getRange(1, headers.length + 1).setValue(ADMIN_REFUND_HEADER); refund = headers.length; headers.push(ADMIN_REFUND_HEADER); }
  return { paid, refund, phone };
}

// GET: ?action=admin_ping / ?action=admin_apps  (반환하면 처리 완료, 아니면 null)
function adminHandleGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action !== 'admin_ping' && action !== 'admin_apps') return null;

  if (!adminCheckPw_(e)) return adminJson_({ ok: false, error: '비밀번호가 올바르지 않습니다.' });
  if (action === 'admin_ping') return adminJson_({ ok: true });

  const sh = SpreadsheetApp.getActive().getSheetByName(ADMIN_SHEET);
  if (!sh) return adminJson_({ ok: false, error: "'" + ADMIN_SHEET + "' 시트를 찾을 수 없습니다." });

  const values = sh.getDataRange().getValues();
  if (!values.length) return adminJson_({ ok: true, headers: [], rows: [], cols: {} });

  const headers = values[0].map(String);
  const cols = adminCols_(sh, headers);

  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const cells = values[i].map(v => (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : String(v));
    while (cells.length < headers.length) cells.push('');
    if (cells.every(c => c === '')) continue; // 빈 줄 스킵
    rows.push({ row: i + 1, cells: cells }); // row = 시트의 실제 행 번호(1-based)
  }
  return adminJson_({ ok: true, headers: headers, rows: rows, cols: cols });
}

// POST: { action:'admin_setStatus', pw, row, field:'paid'|'refund', value:true|false }
function adminHandlePost(e) {
  const body = adminPostBody_(e);
  if (body.action !== 'admin_setStatus') return null;

  if (!adminCheckPw_(e)) return adminJson_({ ok: false, error: '비밀번호가 올바르지 않습니다.' });

  const sh = SpreadsheetApp.getActive().getSheetByName(ADMIN_SHEET);
  if (!sh) return adminJson_({ ok: false, error: '시트를 찾을 수 없습니다.' });

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const cols = adminCols_(sh, headers);
  const colIdx = body.field === 'refund' ? cols.refund : cols.paid;
  const row = parseInt(body.row, 10);
  if (!(row >= 2) || colIdx < 0) return adminJson_({ ok: false, error: '잘못된 위치입니다.' });

  sh.getRange(row, colIdx + 1).setValue(body.value ? 'O' : '');
  return adminJson_({ ok: true });
}

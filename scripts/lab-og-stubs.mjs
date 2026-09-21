// 연구실 자료별 미리보기 안내판 생성기 (2026-09-21 오너 "그때마다 계속 너한테 요청해야하는거니?" → 자동화)
//
// 카톡·블로그 크롤러는 JS 를 안 돌려서 ?r= 값을 못 읽는다 → 자료별 링크도 미리보기는 서가 공용이었다.
// 이 스크립트가 공개 자료마다 og 만 든 얇은 파일 r/<id 앞 8자>.html 을 만든다(서가 안내판 lab-<key>.html 과 같은 사상).
// 화면은 여전히 lab-shelf.html 한 파일이 그린다 — 안내판은 ?r=<자료 id> 를 달아 그리로 넘길 뿐이다.
//
// 실행: node scripts/lab-og-stubs.mjs   (.github/workflows/lab-og.yml 이 1시간마다 돌리고, 바뀐 게 있을 때만 커밋한다)
//
// ⚠️ 읽는 것은 비회원도 목록에서 보는 값뿐이다(공개 RPC lab_resource_list · anon key) —
//    파일 경로·비밀번호·영상 주소는 애초에 이 RPC 가 내주지 않는다. service_role 키를 쓰지 말 것.
// ⚠️ 조회가 하나라도 실패하거나 0건이면 아무것도 건드리지 않고 끝낸다 —
//    장애 한 번에 안내판이 전부 지워지면 이미 뿌린 링크의 미리보기가 통째로 죽는다.
// ⚠️ 파일명 규칙(id 앞 8자)은 admin.html 의 [링크] 버튼이 같은 식으로 조립한다 — 한쪽만 바꾸지 말 것.

import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'r');
const SITE = 'https://monc.ai.kr';

// 접속 값은 supabase-config.js 한 곳에서 읽는다(여기에 복사해 두면 키를 바꿀 때 어긋난다)
const cfg = readFileSync(join(ROOT, 'supabase-config.js'), 'utf8');
const SB_URL = (cfg.match(/SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
const SB_KEY = (cfg.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/) || [])[1];
if (!SB_URL || !SB_KEY) { console.error('supabase-config.js 에서 접속 값을 못 읽었어요.'); process.exit(1); }

// DB shelf 값 → 넘길 주소·미리보기 사진·서가 이름. 기출은 자료실 안의 갈래라 kind 를 단다(lab-question.html 과 같다).
const SHELVES = {
  airline:  { to: 'shelf=airline',               img: 'lab-airline.png',  name: '취업 자료실' },
  question: { to: 'shelf=airline&kind=question', img: 'lab-question.png', name: '기출문제' },
  video:    { to: 'shelf=video',                 img: 'lab-video.png',    name: '영상관' },
  report:   { to: 'shelf=report',                img: 'lab-report.png',   name: '현장 리포트' }
};
const AIRLINE_LABEL = { kal:'대한항공', asiana:'아시아나항공', jinair:'진에어', jejuair:'제주항공', twayair:'티웨이항공', airbusan:'에어부산', airseoul:'에어서울', eastarjet:'이스타항공', airpremia:'에어프레미아', aerok:'에어로케이' };

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

async function list(shelf) {
  const res = await fetch(SB_URL + '/rest/v1/rpc/lab_resource_list', {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_shelf: shelf, p_airline: null })
  });
  if (!res.ok) throw new Error(shelf + ' 목록 조회 실패 ' + res.status);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error(shelf + ' 응답이 목록이 아니에요');
  return rows;
}

function stub(r, slug) {
  const sh = SHELVES[r.shelf];
  const title = oneLine(r.title) + ' — MONC 몬크';
  const bits = [AIRLINE_LABEL[r.airline], r.doc_type].filter(Boolean).join(' · ');
  let desc = oneLine(r.summary) || (bits ? bits + ' — 몬크 연구실 ' + sh.name : '몬크 연구실 ' + sh.name);
  if (desc.length > 110) desc = desc.slice(0, 109) + '…';
  const url = SITE + '/r/' + slug + '.html';
  const img = SITE + '/images/og/' + sh.img;
  const go = '../lab-shelf.html?' + sh.to + '&r=' + r.id;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- 자동 생성 파일 — 손으로 고치지 말 것(scripts/lab-og-stubs.mjs 가 다음 실행 때 덮어쓴다 · docs/notes/lab.md '자료별 미리보기').
       자료별 링크 미리보기 전용 주소. 화면은 lab-shelf.html 한 파일이 그린다. -->
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <meta property="og:type"        content="website" />
  <meta property="og:url"         content="${url}" />
  <meta property="og:title"       content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:image"       content="${img}" />
  <meta property="og:image:width"  content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:locale"      content="ko_KR" />
  <meta property="og:site_name"   content="MONC 몬크" />
  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:title"       content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(desc)}" />
  <meta name="twitter:image"       content="${img}" />
  <link rel="icon" href="../images/MONC_Logo_Full_Package/assets/favicon/favicon.ico" sizes="any">
  <meta name="theme-color" content="#102B56">
  <script>location.replace('${go}' + location.search.replace(/^\\?/, '&') + location.hash);</script>
</head>
<body style="margin:0;background:#FFFFFF;color:#1E2229;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
  <p style="margin:0;padding:28px;font-size:17px;line-height:1.6">
    <a href="${go}" style="color:#1B3A6B">${esc(oneLine(r.title))} 열기</a>
  </p>
</body>
</html>
`;
}

const rows = [];
for (const shelf of Object.keys(SHELVES)) rows.push(...(await list(shelf)));
if (!rows.length) { console.error('공개 자료가 0건이에요 — 안내판을 건드리지 않고 끝냅니다.'); process.exit(1); }

if (!existsSync(OUT)) mkdirSync(OUT);
const want = new Map();   // 파일명 → 내용
for (const r of rows) {
  if (!SHELVES[r.shelf] || !/^[0-9a-f-]{36}$/i.test(r.id)) continue;
  const slug = r.id.slice(0, 8).toLowerCase();
  const name = slug + '.html';
  // 앞 8자가 겹치는 자료(사실상 없다)는 나중 것을 건너뛴다 — admin 은 공용 미리보기 주소로 돌아간다
  if (want.has(name)) { console.warn('앞 8자 중복 — 건너뜀: ' + r.id); continue; }
  want.set(name, stub(r, slug));
}
// admin [링크] 버튼이 읽는 목록 — 여기 있는 자료만 r/ 주소를 복사한다(아직 없는 자료는 lab-<서가>.html?r= 로)
want.set('index.json', JSON.stringify({ slugs: [...want.keys()].map((n) => n.replace(/\.html$/, '')).sort() }) + '\n');

let wrote = 0, removed = 0;
for (const [name, body] of want) {
  const p = join(OUT, name);
  if (existsSync(p) && readFileSync(p, 'utf8') === body) continue;
  writeFileSync(p, body); wrote++;
}
for (const name of readdirSync(OUT)) {
  if (want.has(name)) continue;
  unlinkSync(join(OUT, name)); removed++;   // 숨기거나 지운 자료
}
console.log(`자료 ${rows.length}건 · 쓴 파일 ${wrote} · 지운 파일 ${removed}`);

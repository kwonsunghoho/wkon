#!/usr/bin/env node
/* ═══ MONC 홈페이지 소개 영상 렌더러 (2026-09-25) ═══
   compose.html(합성 무대)을 Playwright 크로미움으로 열고, 가상 시계를 1/30초씩 진행하며 프레임을
   찍어 ffmpeg(libx264)로 잇는다 → video/monc-intro.mp4 (1080×1920 세로 · 30fps · 약 42초).

   왜 실시간 녹화가 아니라 프레임 단위인가: 홈의 조립 애니메이션·칩 정렬·카운트업은 rAF·setTimeout·
   CSS 전환이 섞여 있다. 실시간으로 찍으면 헤드리스 렌더 속도에 따라 끊기고 매번 결과가 다르다.
   Playwright 의 가상 시계(rAF·타이머)와 Web Animations API(CSS 전환·애니메이션의 currentTime)를 함께
   1/30초씩 밀면 어느 기계에서 돌려도 같은 프레임이 나온다.

   준비물
   - node 18+ · playwright(npm i -g playwright → npx playwright install chromium) ·
     ffmpeg(PATH 또는 FFMPEG 환경변수. 없으면 파이썬 imageio-ffmpeg 를 찾는다: pip install imageio-ffmpeg)
   - 레포 루트에서 정적 서버: python -m http.server 5500  (iframe 이 같은 출처여야 스크롤을 밖에서 제어할 수 있다)

   실행(레포 루트에서)
     node scripts/intro-video/render.mjs                          → video/monc-intro.mp4
     node scripts/intro-video/render.mjs --preview 2,9,21,40      → 지정 시각(초)의 PNG 만 저장(구성 확인용)
     옵션: --base http://127.0.0.1:5500 · --out video/monc-intro.mp4 · --fps 30 · --preview-dir <dir> · --crf 20

   ⚠️ 외부 요청(Supabase·CDN·Clarity)은 전부 차단한 채 찍는다 — 화면은 로그아웃·데이터 없음 기본 상태다.
      모집중 개수·특강 문·연구실 숫자 같은 실데이터 칸은 기본 문구로 나온다(그래서 자료실·뉴스는 안 싣는다).
   ⚠️ 장면 시각·자막·스크롤 목표는 아래 TIMELINE 한 곳. 섹션 위치는 실행 때 실측(__measure)해 잡으므로
      홈 섹션이 늘거나 줄어도 목표는 따라간다 — 다만 장면 길이(초)는 눈으로 다시 본다.
   ⚠️ 자막 문구는 사이트 문구를 그대로 옮긴 것이다. 숫자(11년·30,000+·연구원 6명·7가지 유형)는 사이트에
      이미 적힌 값만 쓴다 — 새 숫자를 지어 넣지 말 것(CLAUDE.md '숫자를 꾸며내지 않는다').
*/
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/* ── 인자 ────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
function opt(name, def) { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : def; }
const BASE = opt('base', 'http://127.0.0.1:5500').replace(/\/$/, '');
const OUT = path.resolve(ROOT, opt('out', 'video/monc-intro.mp4'));
const FPS = parseInt(opt('fps', '30'), 10);
const CRF = opt('crf', '20');
const PREVIEW = opt('preview', null);
const PREVIEW_DIR = path.resolve(opt('preview-dir', path.join(os.tmpdir(), 'monc-intro-preview')));

/* ── playwright · ffmpeg 찾기 ────────────────────────────────────────── */
function loadPlaywright() {
  try { return createRequire(import.meta.url)('playwright'); } catch (e) { /* 전역 설치를 찾는다 */ }
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return createRequire(path.join(g, 'x'))('playwright');
}
function findFfmpeg() {
  if (process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  for (const cmd of ['ffmpeg']) {
    try { execSync((process.platform === 'win32' ? 'where ' : 'which ') + cmd, { stdio: 'ignore' }); return cmd; } catch (e) { /* 다음 */ }
  }
  for (const py of ['python3', 'python']) {
    try {
      const p = execSync(`${py} -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (p && fs.existsSync(p)) return p;
    } catch (e) { /* 다음 */ }
  }
  throw new Error('ffmpeg 를 찾지 못했다 — PATH 에 두거나 FFMPEG 환경변수로 경로를 주거나 pip install imageio-ffmpeg');
}

/* ── 보간 유틸 ───────────────────────────────────────────────────────── */
const cl = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const easeOut = p => 1 - Math.pow(1 - p, 3);
/* keys: [{t, v, ease?}] — 구간별로 앞 키의 ease 가 아니라 **뒤 키의 ease** 를 쓴다(그 키로 '가는' 방식). */
function kf(keys, t) {
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (t <= b.t) {
      const p = (t - a.t) / Math.max(1e-6, b.t - a.t);
      const e = b.ease === 'linear' ? p : b.ease === 'out' ? easeOut(p) : easeInOut(p);
      if (typeof a.v === 'number') return a.v + (b.v - a.v) * e;
      const o = {}; for (const k of Object.keys(a.v)) o[k] = a.v[k] + (b.v[k] - a.v[k]) * e; return o;
    }
  }
  return keys[keys.length - 1].v;
}
const fadeIn = (dt, dur) => easeOut(cl(dt / dur));
const fadeOut = (remain, dur) => cl(remain / dur);

/* ── 무대 상수(compose.html 의 540×960 좌표) ─────────────────────────── */
const STAGE = { w: 540, h: 960 };
const PHONE = { w: 375, h: 667 };
const FULL = { s: STAGE.w / PHONE.w, x: 0, y: 0, r: 0, bezel: 0 };                 /* 오프닝: 화면 가득 */
const DOCK_S = 0.9;
const DOCK = { s: DOCK_S, x: (STAGE.w - PHONE.w * DOCK_S) / 2, y: 292, r: 34, bezel: 1 }; /* 본편: 폰 목업 */

/* ── 섹션 기준점(실행 때 실측) ────────────────────────────────────────── */
const SELECTORS = {
  home: { home: '#home', doors: '#doors', doorTools: '#doors .tl-step:has(.door-tools)', sort: '#sort',
    sortWrap: '#sortWrap', nums: '.nums', numsStats: '#moncStats', closing: '.closing' },
  ch: { cards: '#ch-list', row3: '#ch-list .ch-card:nth-child(5)', bq: '#blind-quiz' },
  tools: { poster: 'section[aria-label="나만의 승준노트"]', list: 'section[aria-label="도구 목록"]', community: '#community' },
  res: { tabs: '#instructors', panel: '#mi-panel-kwon' },
  games: { grid: '#gmGrid' }
};

/* ── 타임라인(초) ────────────────────────────────────────────────────── */
/* 2026-09-25 오너 "템포나 흐름이 좀 빠르면, 늘어지는 것 같아" → 66초 판을 42초로 다시 잘랐다.
   정지 구간 2초 안팎, 스크롤 1~1.2초(ease-out — 폰 플릭처럼 빠르게 출발해 부드럽게 멈춤),
   자막은 한 줄 부제로. 늘리려면 여기 시각만 밀면 된다(스크롤 목표는 실측이라 그대로). */
const END = 42.0;
const XFADE = 0.35;                                   /* 화면(iframe) 교체 크로스페이드 */
const PAGE_SEG = [                                     /* 등장 순서 = compose.html iframe DOM 순서 */
  { k: 'home', from: 0, to: 20.4 },
  { k: 'ch', from: 20.4, to: 26.4 },
  { k: 'tools', from: 26.4, to: 30.8 },
  { k: 'res', from: 30.8, to: 34.6 },
  { k: 'games', from: 34.6, to: END }
];
const PHONE_KF = [                                     /* 히어로 조립(1.7초)이 끝나고 신호가 뜬 직후 축소 */
  { t: 0, v: FULL }, { t: 2.4, v: FULL }, { t: 3.2, v: DOCK }
];
const CAPTIONS = [
  { key: 'c1', from: 3.3, to: 6.6, e: 'MONC — Moment Of New Career', t: '승무원 준비의<br>새로운 기준, 몬크', s: '혼자 준비하는 시간이 막막하지 않도록.' },
  { key: 'c2', from: 6.9, to: 11.4, e: 'Challenge · Tools', t: '2주 밀착 챌린지,<br>올인원 면접 툴킷', s: '목소리부터 답변까지, 코치진과 하루 하나씩.' },
  { key: 'c3', from: 11.7, to: 15.6, e: 'Why MONC', t: '혼자하면 막막하지만,<br>몬크와 함께하면 간결합니다', s: '열다섯 가지 준비가 세 갈래로 정리됩니다.' },
  { key: 'c4', from: 15.9, to: 20.4, e: 'The Numbers', t: '어렵고 고민되는 승무원 준비,<br>방향을 알려드리겠습니다', s: '11년 몬크 데이터 · 함께한 승준생 30,000+명' },
  { key: 'c5', from: 20.7, to: 24.0, e: 'Challenge', t: '각 분야 전문가의 코칭과<br>챌린저들의 열정으로', s: '2주 챌린지 5종, 하루 한 번.' },
  { key: 'c6', from: 24.2, to: 26.4, e: 'Blind Test', t: '당신이 면접관이라면?', s: '면접관의 귀로 직접 판정하는 블라인드 테스트.' },
  { key: 'c7', from: 26.7, to: 30.8, e: 'MONC Tools', t: '쓴 답변은 전부<br>나만의 승준노트에', s: '소재 발굴 · 답변 첨삭 · 뉴스 스크랩 · 역량검사 게임' },
  { key: 'c8', from: 31.1, to: 34.6, e: 'Researchers', t: '전문 연구원이 직접<br>설계하고 피드백합니다', s: '현장 경험이 풍부한 연구진 6명.' },
  { key: 'c9', from: 34.9, to: 37.6, e: 'MONC Games', t: '역량검사 게임 연습', s: '7가지 유형 · 무료 · 무제한' }
];
const URL_IN = 3.2, URL_OUT = 37.6;
const FINAL_AT = 37.6;

/* 스크롤 키프레임 — 실측값(A)으로 만든다. nav 는 상단 고정 바 높이(그 아래에 섹션 머리를 앉힌다). */
function scrollKeys(A) {
  const H = A.home, C = A.ch, T = A.tools, R = A.res, G = A.games;
  const n = H.nav || 57;
  const bottom = m => Math.max(0, m.h - m.vh);
  const O = 'out';                                     /* 스크롤은 플릭처럼: 빠르게 출발, 부드럽게 착지 */
  const numsEnd = Math.min(bottom(H), H.numsStats - n - 110);
  const chRows = Math.min(bottom(C), C.row3 + 237 - C.vh + 24);
  return {
    home: [
      { t: 0, v: 0 }, { t: 3.4, v: 0 },
      { t: 4.6, v: H.home - n, ease: O },
      { t: 6.6, v: H.home - n + 30, ease: 'linear' },
      { t: 7.8, v: H.doors - n - 8, ease: O },
      { t: 9.2, v: H.doors - n - 8 },
      { t: 10.2, v: H.doorTools - n - 16, ease: O },
      { t: 11.4, v: H.doorTools - n - 16 },
      { t: 12.4, v: H.sort - n + 10, ease: O },      /* 칩 정렬(1.45초)은 스크롤 중 0.35 임계에서 시작 */
      { t: 13.8, v: H.sort - n + 10 },
      { t: 14.8, v: H.sortWrap + 30, ease: O },
      { t: 15.6, v: H.sortWrap + 30 },
      { t: 16.6, v: H.nums - n, ease: O },
      { t: 16.9, v: H.nums - n },
      { t: 17.9, v: numsEnd, ease: O },               /* 카운트업 2.0초+지연 → 20.4 전환 전에 끝난다 */
      { t: END, v: numsEnd }
    ],
    ch: [
      { t: 0, v: 0 }, { t: 21.2, v: 0 },
      { t: 23.0, v: chRows, ease: O },
      { t: 23.6, v: chRows },
      { t: 24.6, v: Math.min(bottom(C), C.bq - n), ease: O },
      { t: END, v: Math.min(bottom(C), C.bq - n) }
    ],
    tools: [
      { t: 0, v: 0 }, { t: 27.0, v: 0 },
      { t: 28.0, v: Math.min(bottom(T), T.poster - n - 8), ease: O },
      { t: 28.6, v: Math.min(bottom(T), T.poster - n - 8) },
      { t: 29.8, v: bottom(T), ease: O },
      { t: END, v: bottom(T) }
    ],
    res: [
      { t: 0, v: 0 }, { t: 31.4, v: 0 },
      { t: 32.4, v: Math.min(bottom(R), R.panel - n), ease: O },
      { t: 32.8, v: Math.min(bottom(R), R.panel - n) },
      { t: 33.8, v: Math.min(bottom(R), R.panel + 560), ease: O },
      { t: END, v: Math.min(bottom(R), R.panel + 560) }
    ],
    games: [
      { t: 0, v: 0 }, { t: 35.2, v: 0 },
      { t: 36.4, v: Math.min(bottom(G), G.grid - n - 20), ease: O },
      { t: END, v: Math.min(bottom(G), G.grid - n - 20) }
    ]
  };
}

function stateAt(t, SK) {
  const phone = kf(PHONE_KF, t);
  const pages = {};
  PAGE_SEG.forEach((seg, i) => {
    let a;
    if (i === 0) a = t < seg.to + XFADE + 0.05 ? 1 : 0;                 /* 첫 화면은 다음 화면이 다 덮인 뒤 꺼진다 */
    else if (t < seg.from) a = 0;
    else if (i < PAGE_SEG.length - 1 && t > seg.to + XFADE + 0.05) a = 0;
    else a = fadeIn(t - seg.from, XFADE);
    pages[seg.k] = a;
  });
  const scroll = {};
  for (const k of Object.keys(SK)) scroll[k] = Math.round(kf(SK[k], t));
  let caption = null;
  for (const c of CAPTIONS) {
    if (t >= c.from && t <= c.to + 0.02) {
      const fi = fadeIn(t - c.from, 0.35), fo = fadeOut(c.to - t, 0.25);
      caption = { key: c.key, e: c.e, t: c.t, s: c.s, alpha: Math.min(fi, fo), dy: (1 - fi) * 14 };
      break;
    }
  }
  const url = Math.min(fadeIn(t - URL_IN, 0.5), fadeOut(URL_OUT + 0.5 - t, 0.5));
  const final = { alpha: fadeIn(t - FINAL_AT, 0.6), t: t - FINAL_AT };
  return { phone, pages, scroll, caption, url, final };
}

/* 모든 프레임(iframe 포함)에 심는 CSS 전환·애니메이션 가상 시계.
   Playwright 의 가상 시계는 rAF·타이머만 다루고 CSS 전환·애니메이션은 실시간으로 흐른다 —
   그래서 document.getAnimations() 로 잡아 pause 한 뒤 currentTime 을 우리 시계로 민다. */
const VT_INIT = `(() => {
  const S = { now: 0, recs: new WeakMap() };
  window.__vtTick = function (dt) {
    S.now += dt;
    let anims; try { anims = document.getAnimations(); } catch (e) { return; }
    for (const a of anims) {
      let rec = S.recs.get(a);
      if (!rec) {
        let ct = 0; try { ct = a.currentTime || 0; } catch (e) {}
        rec = { start: S.now - ct }; S.recs.set(a, rec);
        try { a.pause(); } catch (e) {}
      }
      let end = Infinity; try { end = a.effect.getComputedTiming().endTime; } catch (e) {}
      const ct = S.now - rec.start;
      try { if (isFinite(end) && ct >= end) a.finish(); else a.currentTime = ct; } catch (e) {}
    }
  };
})();`;

/* ── 본체 ────────────────────────────────────────────────────────────── */
async function main() {
  const { chromium } = loadPlaywright();
  const ffmpegBin = PREVIEW ? null : findFfmpeg();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: STAGE.w, height: STAGE.h }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, locale: 'ko-KR', colorScheme: 'light', reducedMotion: 'no-preference'
  });
  ctx.setDefaultTimeout(60000);
  const origin = new URL(BASE).host;
  await ctx.route(/^https?:\/\//, r => (new URL(r.request().url()).host === origin ? r.continue() : r.abort()));
  await ctx.addInitScript(VT_INIT);
  await ctx.clock.install();
  await ctx.clock.pauseAt(Date.now() + 1000);         /* 로드 중엔 아무 애니메이션도 흐르지 않는다 */

  const page = await ctx.newPage();
  page.on('pageerror', e => console.warn('[pageerror]', String(e.message).slice(0, 160)));
  await page.goto(`${BASE}/scripts/intro-video/compose.html`, { waitUntil: 'load' });
  for (const fr of page.frames()) { try { await fr.evaluate(() => document.fonts.ready); } catch (e) { /* 무시 */ } }
  await page.waitForTimeout(400);                       /* 이미지 디코드 여유 */

  const A = await page.evaluate(sel => window.__measure(sel), SELECTORS);
  for (const k of Object.keys(SELECTORS)) {
    if (!A[k]) throw new Error(`iframe ${k} 을 못 읽었다`);
    for (const name of Object.keys(SELECTORS[k])) if (A[k][name] == null) throw new Error(`기준점 없음: ${k}.${name} (${SELECTORS[k][name]})`);
  }
  console.log('기준점', JSON.stringify(A));
  const SK = scrollKeys(A);

  const total = Math.round(END * FPS);
  const ticks = FPS === 30 ? [33, 33, 34] : [Math.round(1000 / FPS)];
  const wanted = new Map();
  if (PREVIEW) {
    fs.mkdirSync(PREVIEW_DIR, { recursive: true });
    PREVIEW.split(',').map(Number).filter(n => !isNaN(n)).forEach(sec => wanted.set(Math.min(total - 1, Math.round(sec * FPS)), sec));
  }

  let ff = null, ffDone = null;
  if (!PREVIEW) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    ff = spawn(ffmpegBin, ['-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(FPS), '-i', 'pipe:0',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', String(CRF), '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-movflags', '+faststart', '-r', String(FPS), OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
    ffDone = new Promise((res, rej) => {
      ff.on('error', rej);
      ff.on('close', code => (code === 0 ? res() : rej(new Error('ffmpeg 종료 코드 ' + code))));
    });
  }
  const write = buf => new Promise(res => { if (ff.stdin.write(buf)) res(); else ff.stdin.once('drain', res); });

  /* ⚠️ 한 장만 찍으면 가끔 폰 화면 일부가 흰색으로 빈다 — 크로미움이 바뀐 내용의 타일 래스터를
     끝내기 전에 스크린샷이 잡히는 것(2026-09-25 미리보기 t=20.3 에서 실제로 잡힘). 상태는 가상
     시계로 얼어 있으므로 **연속 두 장이 바이트 단위로 같을 때까지** 다시 찍는다. 첫 장이 렌더
     갱신(IntersectionObserver 콜백 등)을 일으켜 두 번째가 달라질 수 있어 사이마다 __tickAll(0)
     로 새 CSS 전환을 붙잡아 둔다(시간은 안 민다). 보통 2장, 최대 5장. */
  let retakes = 0;
  async function captureStable() {
    let prev = await page.screenshot({ type: 'png' });
    for (let k = 0; k < 4; k++) {
      await page.evaluate(() => window.__tickAll(0));
      const cur = await page.screenshot({ type: 'png' });
      if (cur.equals(prev)) return cur;
      retakes++;
      prev = cur;
    }
    return prev;
  }

  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    const st = stateAt(t, SK);
    await page.evaluate(s => window.__setState(s), st);
    const dt = ticks[i % ticks.length];
    await ctx.clock.runFor(dt);
    await page.evaluate(d => window.__tickAll(d), dt);
    if (PREVIEW) {
      if (wanted.has(i)) {
        const file = path.join(PREVIEW_DIR, `t${String(wanted.get(i)).replace('.', '_')}.png`);
        fs.writeFileSync(file, await captureStable());
        console.log('저장', file);
      } else {
        await page.screenshot({ type: 'jpeg', quality: 30, clip: { x: 0, y: 0, width: 4, height: 4 } }); /* 렌더 갱신만 */
      }
    } else {
      await write(await captureStable());
    }
    if (i % (FPS * 5) === 0) console.log(`${t.toFixed(1)}s / ${END}s  (${((Date.now() - t0) / 1000).toFixed(0)}s 경과 · 재촬영 ${retakes})`);
  }
  if (ff) { ff.stdin.end(); await ffDone; console.log('완료', OUT, (fs.statSync(OUT).size / 1048576).toFixed(1) + 'MB', '· 재촬영 ' + retakes + '회'); }
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });

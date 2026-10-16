/* 기존 학원 빈자리 계산을 보존한 순수 함수. */
(function(root){
const {pad,parseYmd,ymd,scheduleCategory}=root.MONC_OPS_UTIL;
// 개강할 수 있는 자리를 계산한다.
// 화면에 의존하지 않는다. scripts/operations-slots-tests.mjs에서 확인한다.

// ──────────────────────────────────────────
// 운영 규칙
// ──────────────────────────────────────────
// 학원 사정이 바뀌면(3반이 된다, 일요일도 연다) 이 아래만 고친다.

/** 수업을 넣을 수 있는 요일 (0=일) — 화·수·목·금·토. 일·월 휴무 */
const OPEN_WEEKDAYS = [2, 3, 4, 5, 6];

/** 하루에 수업을 넣을 수 있는 범위 (시).
 *
 *  정해진 시작 시각을 두지 않는다. 학원 시간이 늘 정각에 떨어지지 않아서,
 *  칸에 맞춰 보면 14:00~16:00 수업 하나가 13시 칸과 15시 칸을 둘 다 물어
 *  정작 비어 있는 16시 이후가 안 보였다. 등록된 수업의 실제 시각에서 자른다.
 *
 *  저녁 시간 같은 고정 휴식도 두지 않는다 — 뒤죽박죽이라 규칙으로 박아 둘 것이 못 된다.
 *  쉬어야 하는 시간은 일정에 등록해서 막는다. */
const DAY_START_HOUR = 13;
const DAY_END_HOUR = 22;

/** 수업 한 번의 길이(분) */
const CLASS_MINUTES = 120;

/** 같은 시간에 동시에 돌릴 수 있는 반 수 */
const MAX_CONCURRENT = 2;

/**
 * 수업 종류마다 길이가 다르다.
 *
 * 처음에는 120분 하나로만 걸렀는데, 그랬더니 90분짜리 1:1 수업이 들어갈 자리가
 * 통째로 숨었다. 가장 짧은 종류 이상이면 다 보여주고, 구간마다 무엇이 들어가는지 적는다.
 *
 * 상담은 사무실에서 하므로 강의실 자리를 차지하지 않는다 — buildDayPlans 는 상담을
 * 아예 세지 않는다. 여기 있는 건 "이 틈이면 상담도 되겠다" 는 참고일 뿐이다.
 *
 * 긴 것부터 적어 둔다. kindsThatFit 이 이 순서로 돌려주고 화면도 그 순서로 읽는다.
 */
const CLASS_KINDS = [
  { key: "regular", label: "정규반", minutes: 120 },
  { key: "oneOnOne", label: "1:1수업", minutes: 90 },
  { key: "consult", label: "상담", minutes: 60 },
] ;

/** 목록에 보여줄 최소 길이 — 가장 짧은 종류도 안 들어가면 보여 봐야 고르지 못한다 */
const MIN_OPENING_MINUTES = Math.min(...CLASS_KINDS.map((k) => k.minutes));

/** 'HH:mm' → 자정부터의 분. 못 읽으면 null */
function toMinutes(hhmm ) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** 분 → 'HH:mm' */
function hhmm(mins ) {
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

/**
 * 시트의 time 열 → [시작분, 끝분]. 시간이 없거나 못 읽으면 null.
 *
 * 끝 시간이 없는 일정이 많다 (시작만 적고 넘어간다). 그런 건 수업 길이만큼
 * 자리를 잡는 것으로 본다 — 안 그러면 자리가 비어 있는 걸로 잘못 나온다.
 * 끝이 시작보다 빠른 값(자정을 넘기거나 잘못 적은 것)도 같이 취급한다.
 */
function eventSpan(time ) {
  const [rawStart, rawEnd] = (time || "").split("~");
  const start = toMinutes(rawStart ?? "");
  if (start === null) return null;
  const end = rawEnd ? toMinutes(rawEnd) : null;
  if (end === null || end <= start) return [start, start + CLASS_MINUTES];
  return [start, end];
}

// ──────────────────────────────────────────
// 날짜
// ──────────────────────────────────────────

/**
 * today 부터 세어 그 요일이 오는 날 weeks 번.
 * 오늘이 마침 그 요일이면 오늘부터 센다.
 */
function upcomingDates(today , weekday , weeks ) {
  const d = parseYmd(today);
  const delta = (weekday - d.getDay() + 7) % 7;
  const first = new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta);
  return Array.from({ length: weeks }, (_, i) =>
    ymd(new Date(first.getFullYear(), first.getMonth(), first.getDate() + i * 7))
  );
}

// ──────────────────────────────────────────
// 자리 계산
// ──────────────────────────────────────────

const DAY_START = DAY_START_HOUR * 60;
const DAY_END = DAY_END_HOUR * 60;

/** 일정의 시각을 하루 범위 안으로 자른다. 범위 밖이거나 읽을 수 없으면 null */
function clampedSpan(e ) {
  const span = eventSpan(e.time);
  if (!span) return null;
  const start = Math.max(span[0], DAY_START);
  const end = Math.min(span[1], DAY_END);
  return start < end ? [start, end] : null;
}

/** 그 요일의 한 주치 */

/**
 * free2   — 보는 기간 내내 두 자리 다 빈다
 * free1   — 내내 한 자리는 빈다 (두 자리가 아닌 주가 있다)
 * partial — 되는 주와 안 되는 주가 섞여 있다
 * full    — 한 주도 못 넣는다
 */

/** 띠 한 조각 */

/** 요일 한 줄 */

function bandStatus(openWeeks , twoWeeks , total ) {
  if (total === 0) return "full";
  if (twoWeeks === total) return "free2";
  if (openWeeks === total) return "free1";
  if (openWeeks === 0) return "full";
  return "partial";
}

/** 이름 목록에 중복 없이 더한다 */
function pushTitle(list , raw ) {
  const t = (raw || "").trim();
  if (t && !list.includes(t)) list.push(t);
}

/**
 * 요일마다 13:00~22:00 을 하나의 띠로 놓고, 등록된 수업의 실제 시각에서 자른다.
 *
 * 자리를 차지하는 것은 **수업뿐**이다. 행사는 표식만 남긴다.
 * events 는 분류 필터가 걸리지 않은 원본이어야 한다 —
 * 무엇이 자리를 차지하는지는 이 함수가 정한다.
 */
function buildDayPlans(
  events ,
  today ,
  weeks
) {
  const byDate = new Map                         ();
  for (const e of events) {
    const arr = byDate.get(e.date);
    if (arr) arr.push(e);
    else byDate.set(e.date, [e]);
  }

  return OPEN_WEEKDAYS.map((weekday) => {
    const days = upcomingDates(today, weekday, weeks).map((date, i) => {
      const classes = [];
      const shows = [];
      for (const e of byDate.get(date) ?? []) {
        const cat = scheduleCategory(e.category);
        if (cat !== "수업" && cat !== "행사") continue;
        if (!clampedSpan(e)) continue;
        if (cat === "수업") classes.push(e);
        else shows.push(e);
      }
      return { week: i + 1, date, classes, events: shows };
    });

    // 자르는 지점 — 실제 일정의 시작·끝 시각과 하루의 양 끝뿐이다
    const cuts = new Set        ([DAY_START, DAY_END]);
    for (const d of days)
      for (const e of [...d.classes, ...d.events]) {
        const span = clampedSpan(e) ;
        cuts.add(span[0]);
        cuts.add(span[1]);
      }
    const points = [...cuts].sort((a, b) => a - b);

    const raw = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const start = points[i];
      const end = points[i + 1];
      let openWeeks = 0;
      let twoWeeks = 0;
      let hasEvent = false;
      const titles = [];

      for (const d of days) {
        let used = 0;
        for (const c of d.classes) {
          const span = clampedSpan(c) ;
          // 자르는 지점이 전부 경계이므로 구간 안에서는 값이 변하지 않는다
          if (span[0] < end && span[1] > start) {
            used++;
            pushTitle(titles, c.title);
          }
        }
        const free = Math.max(0, MAX_CONCURRENT - used);
        if (free >= 1) openWeeks++;
        if (free >= MAX_CONCURRENT) twoWeeks++;

        for (const s of d.events) {
          const span = clampedSpan(s) ;
          if (span[0] < end && span[1] > start) hasEvent = true;
        }
      }

      raw.push({
        start,
        end,
        status: bandStatus(openWeeks, twoWeeks, days.length),
        openWeeks,
        twoWeeks,
        classTitles: titles,
        hasEvent,
      });
    }

    // 다른 주의 일정 때문에 생긴 자르는 지점이 이 구간에서는 아무것도 바꾸지 않을 수 있다.
    // 값이 똑같은 이웃은 도로 붙인다 — 안 그러면 같은 색이 이유 없이 두 조각으로 보인다.
    const bands = [];
    for (const b of raw) {
      const prev = bands[bands.length - 1];
      if (
        prev &&
        prev.end === b.start &&
        prev.status === b.status &&
        prev.openWeeks === b.openWeeks &&
        prev.twoWeeks === b.twoWeeks &&
        prev.hasEvent === b.hasEvent &&
        prev.classTitles.join("|") === b.classTitles.join("|")
      ) {
        prev.end = b.end;
        continue;
      }
      bands.push({ ...b, classTitles: [...b.classTitles] });
    }

    return { weekday, weeks: days, bands, openings: buildOpenings(weekday, bands) };
  });
}

/** 조건에 맞는 조각들이 이어지는 덩어리로 끊는다 */
function runsOf(bands , keep ) {
  const runs = [];
  let run = [];
  for (const b of bands) {
    if (keep(b)) run.push(b);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

/**
 * 꽉 차지 않은 구간에서 120분 이상 들어가는 자리를 뽑는다.
 *
 * 세 겹으로 본다. "두 반 다 되는 자리" 를 따로 뽑지 않으면,
 * 하루 어딘가에 한 반이 끼어 있다는 이유로 하루 전체가 "한 반 더" 하나로
 * 뭉뚱그려져 정작 완전히 빈 시간대가 안 보인다.
 *
 * 약한 겹은 그 겹에서만 나오는 조각이 실제로 있을 때만 넣는다 —
 * 없으면 위 겹과 똑같은 줄이 되어 새로 알려주는 게 없다.
 */
function buildOpenings(weekday , bands ) {
  const out = [];

  const add = (run , status ) => {
    const start = run[0].start;
    const end = run[run.length - 1].end;
    if (end - start < MIN_OPENING_MINUTES) return;
    const titles = [];
    for (const b of run) for (const t of b.classTitles) pushTitle(titles, t);
    out.push({
      weekday,
      start,
      end,
      status,
      minOpenWeeks: Math.min(...run.map((b) => b.openWeeks)),
      classTitles: titles,
      fits: kindsThatFit(end - start),
    });
  };

  for (const run of runsOf(bands, (b) => b.status === "free2")) add(run, "free2");

  for (const run of runsOf(bands, (b) => b.status === "free2" || b.status === "free1"))
    if (run.some((b) => b.status === "free1")) add(run, "free1");

  for (const run of runsOf(bands, (b) => b.status !== "full"))
    if (run.some((b) => b.status === "partial")) add(run, "partial");

  return out;
}

/** 'HH:mm~HH:mm' */
function rangeLabel(start , end ) {
  return `${hhmm(start)}~${hhmm(end)}`;
}

/** 이 길이에 들어가는 수업 종류 (긴 것부터) */
function kindsThatFit(mins ) {
  return CLASS_KINDS.filter((k) => k.minutes <= mins).map((k) => k.key);
}

/** "정규반 · 1:1수업 · 상담" */
function fitsLabel(fits ) {
  return CLASS_KINDS.filter((k) => fits.includes(k.key))
    .map((k) => k.label)
    .join(" · ");
}

root.MONC_OPS_SLOTS={buildDayPlans,rangeLabel,fitsLabel,eventSpan};
})(globalThis);

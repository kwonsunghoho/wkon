(function () {
  'use strict';

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function initReveal() {
    var els = document.querySelectorAll('[data-reveal]');
    if (!els.length) return;

    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('is-revealed'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

    els.forEach(function (el) { observer.observe(el); });
  }

  function initStickyPanel() {
    var panels = document.querySelectorAll('[data-sticky-panel]');
    if (!panels.length) return;

    if (prefersReducedMotion) {
      panels.forEach(function (panel) {
        panel.querySelectorAll('[data-sticky-to]').forEach(function (to) {
          to.style.opacity = 1;
        });
        panel.querySelectorAll('[data-sticky-from]').forEach(function (from) {
          from.style.opacity = 0;
        });
      });
      return;
    }

    var ticking = false;

    function update() {
      ticking = false;
      panels.forEach(function (panel) {
        var rect = panel.getBoundingClientRect();
        var vh = window.innerHeight;
        var progress = Math.min(1, Math.max(0, (vh - rect.top) / (rect.height + vh)));
        var from = panel.querySelector('[data-sticky-from]');
        var to = panel.querySelector('[data-sticky-to]');
        if (from) {
          from.style.opacity = String(1 - progress);
          from.style.transform = 'translateY(' + (-progress * 24) + 'px)';
        }
        if (to) {
          to.style.opacity = String(progress);
          to.style.transform = 'translateY(' + ((1 - progress) * 24) + 'px)';
        }
      });
    }

    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    update();
  }

  function initCountUp() {
    var els = document.querySelectorAll('[data-count-up]');
    if (!els.length) return;

    function run(el) {
      var raw = el.getAttribute('data-count-up');
      var target = parseFloat(raw);
      var suffix = el.getAttribute('data-count-suffix') || '';
      if (prefersReducedMotion || isNaN(target)) {
        el.textContent = target + suffix;
        return;
      }
      // 소수점 자리수는 원본 문자열 기준으로 결정 (예: "14.2" → 소수 1자리).
      // 정수 값은 기존과 동일하게 Math.round()로 반올림.
      var dotIndex = raw.indexOf('.');
      var decimals = dotIndex === -1 ? 0 : raw.length - dotIndex - 1;
      var duration = 1200;
      var start = null;
      function step(ts) {
        if (start === null) start = ts;
        var progress = Math.min(1, (ts - start) / duration);
        var current = decimals > 0
          ? (target * progress).toFixed(decimals)
          : Math.round(target * progress);
        el.textContent = current + suffix;
        if (progress < 1) window.requestAnimationFrame(step);
      }
      window.requestAnimationFrame(step);
    }

    if (!('IntersectionObserver' in window)) {
      els.forEach(run);
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          run(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    els.forEach(function (el) { observer.observe(el); });
  }

  function initZoomExit() {
    var wraps = document.querySelectorAll('[data-zoom-exit]');
    if (!wraps.length) return;

    if (prefersReducedMotion) {
      return; // CSS 쪽에서 sticky/min-height를 해제해 정적 레이아웃으로 표시
    }

    // 모바일에서도 줌 연출은 유지하되(transform 기반이라 GPU 합성으로 충분히
    // 부드러움), 짧은 뷰포트에서 긴 runway가 빈 스크롤 구간이 되지 않도록
    // data-zoom-runway-mobile / data-zoom-scale-mobile 오버라이드를 지원.
    var smallViewport = window.matchMedia('(max-width: 768px)').matches;

    function attrFor(wrap, name) {
      // 모바일이면 <name>-mobile 우선, 없으면 기본 속성으로 폴백
      var v = smallViewport ? wrap.getAttribute(name + '-mobile') : null;
      return v !== null ? v : wrap.getAttribute(name);
    }

    var SCALE_K = 0.32; // 기본 최대 scale = 1 + SCALE_K (data-zoom-scale 속성으로 섹션별 오버라이드 가능)

    // data-zoom-runway(vh 단위 숫자)가 있으면 기본 160vh 대신 해당 값을 min-height로 적용.
    // (CSS의 [data-zoom-exit][data-zoom-exit] { min-height: 160vh } 기본값을 인라인 스타일로 오버라이드)
    wraps.forEach(function (wrap) {
      var runwayAttr = attrFor(wrap, 'data-zoom-runway');
      var runwayVh = runwayAttr ? parseFloat(runwayAttr) : NaN;
      if (!isNaN(runwayVh)) {
        wrap.style.minHeight = runwayVh + 'vh';
      }
    });

    // smoothstep 이징 — 선형(progress 그대로)보다 시작/끝이 완만해 "확 당겨지는"
    // 느낌 대신 서서히 가속했다 서서히 감속하는 자연스러운 확대감을 줌.
    function easeInOut(p) {
      return p * p * (3 - 2 * p);
    }

    // ── 스크롤 스무딩 (2026-07-11) ─────────────────────────────────────
    // 이전에는 scroll 이벤트마다 진행률을 스타일에 1:1로 꽂았다. 마우스 휠은
    // 한 칸에 수십~수백 px씩 점프하므로 줌·페이드가 계단식으로 뚝뚝 끊겼고,
    // 모바일도 빠른 플릭 중엔 scroll 이벤트가 프레임마다 오지 않아 스텝이 보였다.
    // 지금은 목표 진행률(target)을 향해 현재값(current)이 매 프레임 지수 감쇠로
    // 따라붙는 rAF 루프를 돌려, 어떤 입력이든 프레임 단위 연속 보간이 된다.
    // 루프는 목표에 수렴하면 스스로 멈춰(idle) 유휴 비용이 없다.
    // TAU(ms) = 감쇠 시정수. 클수록 부드럽지만 지연감이 커짐. 데스크톱·터치
    // 공통 150ms(2026-07-11): 터치만 80ms로 짧게 줬더니 플릭 중 성기게 오는
    // scroll 이벤트의 점프가 덜 걸러져 모바일이 데스크톱보다 뚝뚝 끊겨 보였다.
    // 풀스크린 연출이라 손가락 추종 지연은 체감이 낮아 완충을 우선한다.
    //
    // 적응형 추격(2026-07-12): 고정 150ms는 빠른 스크롤에서 줌이 진행률
    // 0.15~0.2만큼 뒤처져, 클라이맥스(최대 확대·창 통과)가 핀이 화면을
    // 벗어난 뒤 재생되는 '줌 희석'을 만들었다. 그래서 목표와의 격차가
    // 클수록 시정수를 TAU_FAST까지 줄인다 — 휠 한 칸(격차 ≈0.03~0.06)은
    // 여전히 TAU 근처로 부드럽고, 빠른 플릭(격차 0.25+)은 바짝 따라붙어
    // 연출 전 구간이 화면 안에서 재생된다. 줌 효과 자체(배율·커브)의
    // 문제가 아니므로 배율을 키우는 식으로 보상하지 말 것.
    var TAU = 150;
    var TAU_FAST = 60;

    // 프레임 루프에서 매번 querySelector/getAttribute/parseFloat를 반복하지
    // 않도록, 섹션별 설정과 페이드 대상 요소를 초기화 시점에 한 번만 수집한다.
    // (속성·DOM 구조는 런타임에 바뀌지 않음 — 2026-07-11 프레임 비용 절감)
    var items = [];
    wraps.forEach(function (wrap) {
      var pin = wrap.querySelector('.zoom-exit-pin');
      if (!pin) return;
      // data-zoom-start(0~1, 기본 0): 줌이 시작되는 진행률. 예: 0.5면 전반
      // 50%는 scale 1로 정지(태그라인 조립·유지 구간), 후반 50%에 확대가
      // 몰려 '정면으로 확 뚫고 들어가는' 연출이 된다. (2026-07-10)
      var startAttr = attrFor(wrap, 'data-zoom-start');
      var zoomStart = startAttr ? parseFloat(startAttr) : 0;
      if (isNaN(zoomStart) || zoomStart < 0 || zoomStart >= 1) zoomStart = 0;
      var scaleAttr = attrFor(wrap, 'data-zoom-scale');
      var scaleK = scaleAttr ? parseFloat(scaleAttr) : SCALE_K;
      if (isNaN(scaleK)) scaleK = SCALE_K;
      var item = {
        wrap: wrap, pin: pin, current: 0, target: 0,
        zoomStart: zoomStart, scaleK: scaleK,
        // data-zoom-fade="none"이면 페이드 없이 확대만 진행 (완전 불투명 유지)
        fadeNone: wrap.getAttribute('data-zoom-fade') === 'none',
        toneBridge: wrap.querySelector('.zoom-tone-bridge'),
        contentFadeEls: wrap.querySelectorAll('.zoom-content-fade'),
        bezelFadeEls: wrap.querySelectorAll('.zoom-bezel-fade')
      };
      items.push(item);
      // 개구부 실측 캘리브레이션(2026-07-12, index 태그라인 IIFE가 dispatch):
      // '창문 통과' 연출은 개구부가 뷰포트를 완전히 삼킬 만큼 확대돼야 성립한다.
      // 프레임 이미지의 개구부 크기를 알파 스캔으로 실측해 필요한 최대 배율
      // (1+scaleK)을 보정받는다 — data-zoom-scale 속성은 실측 실패 시 폴백.
      (function (it) {
        wrap.addEventListener('monc:zoomcalib', function (e) {
          var k = e.detail && parseFloat(e.detail.scaleK);
          if (!isNaN(k)) {
            // 캡 6.5: 여운용 오버슛(need^1.25) 포함 상한 — 울트라와이드에서
            // 넘치면 클램프되어 통과 완료가 약간 늦어질 뿐 연출은 유지된다.
            it.scaleK = Math.min(6.5, Math.max(0.2, k));
            renderWrap(it);
          }
        });
      })(item);
    });
    if (!items.length) return;

    function computeTarget(wrap) {
      var rect = wrap.getBoundingClientRect();
      var vh = window.innerHeight;
      // wrap 상단이 뷰포트 상단을 지나 wrap 하단(= 스크롤 runway 끝)에 도달할 때까지 0→1
      var runway = rect.height - vh;
      var progress = runway > 0 ? (-rect.top) / runway : 0;
      return Math.min(1, Math.max(0, progress));
    }

    function renderWrap(item) {
      var wrap = item.wrap;
      var pin = item.pin;
      var progress = item.current;
      var zoomStart = item.zoomStart;
      var zp = zoomStart > 0
        ? Math.min(1, Math.max(0, (progress - zoomStart) / (1 - zoomStart)))
        : progress;
      var eased = easeInOut(zp);
      // 스케일 커브(2026-07-11): 로그 공간 기하 보간 + 완만한 ease-in 멱지수.
      // 줌의 체감 속도는 scale의 '비율' 변화라서, 선형 보간(1 + eased×K)은
      // smoothstep과 겹치면 중반 급가속·종반 감속이 되어 '확 당겨졌다 멈추는'
      // 느낌을 줬다. (1+K)^(zp^1.35)는 체감 줌 속도가 거의 일정하게 서서히
      // 빨라지며 끝까지 감속 없이 '쭉' 빨려들어간다. (끝의 잔속도는 하늘
      // 페이드 80~100%가 덮는다.)
      pin.style.transform = 'scale(' + Math.pow(1 + item.scaleK, Math.pow(zp, 1.35)) + ')';
      // fadeNone(data-zoom-fade="none")이면 페이드 없이 확대만 진행 —
      // "사라짐" 없이 "뚫고 들어가는" 느낌을 위함. 없으면 기존과 동일하게
      // progress에 따라 선형으로 페이드아웃. (불변값 '1'은 CSS 기본이라 미기록)
      if (!item.fadeNone) pin.style.opacity = String(1 - eased);

      // 다음 섹션(주로 어두운 톤)으로 자연스럽게 이어지도록, wrap 안에
      // .zoom-tone-bridge 요소가 있으면 진행률에 따라 어두운 그라디언트를
      // 서서히 덧씌워 톤이 미리 어두워지기 시작하게 함 (급격한 톤 전환 방지).
      // 단 톤 브릿지는 z-order상 하늘/창틀 '아래'라 하늘 페이드(96%~) 전엔
      // 완전히 가려진다 — 가려진 동안에도 풀스크린 블렌딩 비용을 내므로
      // visibility로 합성 자체를 끈다(Intel iGPU 등 fill-rate 병목 완화,
      // 2026-07-12). 0.90부터 표시 — 이때도 아직 하늘 뒤라 시각 변화 없음.
      if (item.toneBridge) {
        var toneHidden = progress < 0.90;
        if (toneHidden !== item.toneHidden) {
          item.toneHidden = toneHidden;
          item.toneBridge.style.visibility = toneHidden ? 'hidden' : '';
        }
        if (!toneHidden) item.toneBridge.style.opacity = String(eased);
      }

      // .zoom-content-fade(하늘)는 줌 마지막(96~100%)에만 지운다. pin이
      // sticky에서 풀려 일반 스크롤로 넘어가는 순간(=100%) 확대된 이미지가
      // 뷰포트에 걸쳐 보이지 않도록 정확히 그 직전에 0이 된다.
      // (구 80~100%는 '창문 통과' 클라이맥스 도중 하늘이 절반쯤 사라져
      // 통과감을 죽였다 — 2026-07-12 재조정. 96~은 통과(~89%) 후 하늘 위에
      // 남는 MONC 브랜드 여운(태그라인 94~99.5% 페이드)의 배경을 확보.)
      if (item.contentFadeEls.length) {
        var contentOpacity = Math.max(0, 1 - Math.max(0, (progress - 0.96) / 0.04));
        item.contentFadeEls.forEach(function (el) {
          el.style.opacity = String(contentOpacity);
        });
      }

      // .zoom-bezel-fade(창틀): '창문 통과' 연출의 본체 — 확대에 밀려 화면
      // 밖으로 빠르게 지나가는 것이 통과감이므로 페이드로 지우지 않고 통과
      // 완료(~89%, calibrateZoom 오버슛) 직전 82~90%에만 짧게 지운다. 이
      // 페이드는 개구부 둥근 모서리가 남기는 벽 잔여물 정리용 안전망일 뿐이다.
      // ⚠️ 구 55~75% 페이드로 되돌리지 말 것 — 창틀이 일찍 사라지면 '창문을
      // 뚫고 들어가는' 느낌이 '하늘 사진이 커지는' 느낌으로 퇴화한다(2026-07-12).
      // (개구부가 뷰포트를 못 덮던 옛 문제는 monc:zoomcalib 실측 배율로 해결.)
      if (item.bezelFadeEls.length) {
        var bezelOpacity = Math.max(0, 1 - Math.max(0, (progress - 0.82) / 0.08));
        item.bezelFadeEls.forEach(function (el) {
          el.style.opacity = String(bezelOpacity);
        });
      }

      // position은 CSS의 기본 sticky 그대로 둔다 — wrap의 runway를 다 소진하면
      // sticky는 브라우저가 수학적으로 정확히 같은 지점에서(점프 없이) 자연스럽게
      // 풀어주므로 JS가 수동으로 absolute로 전환할 필요가 없다. (이전에 수동
      // 전환을 했을 때 그 순간 위치가 튀면서 확대된 하늘 대신 창문 프레임이
      // 다시 보이는 버그가 있었음 — 원인은 top:0 기준점이 sticky의 "뷰포트
      // 상단"에서 absolute의 "wrap 상단"으로 바뀌며 위치가 어긋났기 때문.)

      // 외부 스크립트(히어로 태그라인 등)가 줌과 '동일한 스무딩 진행률'로
      // 프레임 단위 동기화할 수 있도록 진행률을 이벤트로 공유한다.
      wrap.dispatchEvent(new CustomEvent('monc:zoomprogress', { detail: { progress: progress } }));
    }

    var rafId = null;
    var lastTs = 0;
    function frame(ts) {
      // 프레임레이트 독립 지수 감쇠: k = 1 - e^(-dt/TAU). 탭 복귀 등으로 dt가
      // 튀어도 한 번에 과하게 점프하지 않도록 64ms로 클램프.
      var dt = lastTs ? Math.min(64, ts - lastTs) : 16.7;
      lastTs = ts;
      var busy = false;
      items.forEach(function (item) {
        item.target = computeTarget(item.wrap);
        var diff = item.target - item.current;
        var ad = Math.abs(diff);
        if (ad > 0.0004) {
          // 격차 비례 적응형 시정수: 격차 0 → TAU(부드러움), 0.25 이상 → TAU_FAST(추격)
          var tau = TAU - (TAU - TAU_FAST) * Math.min(1, ad / 0.25);
          item.current += diff * (1 - Math.exp(-dt / tau));
          busy = true;
        } else {
          item.current = item.target;
        }
        renderWrap(item);
      });
      if (busy) {
        rafId = window.requestAnimationFrame(frame);
      } else {
        rafId = null;
        lastTs = 0;
      }
    }

    function kick() {
      if (window.__moncZoomFreeze) return; // 성능 진단용: 줌 파이프라인 일시 동결
      if (rafId === null) {
        lastTs = 0;
        rafId = window.requestAnimationFrame(frame);
      }
    }

    window.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', kick, { passive: true });

    // 초기 상태: 현재 스크롤 위치의 진행률로 즉시 렌더 (로드 시 따라붙기 애니메이션 없음)
    items.forEach(function (item) {
      item.current = item.target = computeTarget(item.wrap);
      renderWrap(item);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initReveal();
    initStickyPanel();
    initCountUp();
    initZoomExit();
  });

  window.MoncScrollFx = window.MoncScrollFx || {};
  window.MoncScrollFx.initReveal = initReveal;
  window.MoncScrollFx.initStickyPanel = initStickyPanel;
  window.MoncScrollFx.initCountUp = initCountUp;
  window.MoncScrollFx.initZoomExit = initZoomExit;
})();

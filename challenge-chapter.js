/* 공개된 챕터만 재생한다. 영상 주소는 사용자가 재생을 누른 뒤에만 로드한다. */
window.ChallengeChapter = (() => {
  'use strict';
  let api, player, poll, loadTimer, ticket = 0;
  const clock = n => Math.floor(n / 60) + ':' + String(n % 60).padStart(2,'0');
  function valid(c) {
    return c?.provider === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(c.video_id) &&
      Number.isInteger(c.start_seconds) && Number.isInteger(c.end_seconds) &&
      c.start_seconds >= 0 && c.start_seconds < c.end_seconds && c.end_seconds <= 86400;
  }
  function close() {
    ticket++; clearInterval(poll); clearTimeout(loadTimer);
    if (player) { try { player.destroy(); } catch (_) {} }
    player = null;
  }
  function render(c, day) {
    if (!valid(c)) return '';
    return `<section class="chapter-player" aria-label="DAY ${Number(day)} 영상"><div class="chapter-screen" data-chapter-screen>
      <button type="button" data-chapter-play><span class="chapter-triangle" aria-hidden="true"></span><span>챕터 재생</span></button></div>
      <div class="chapter-caption"><strong>DAY ${Number(day)} 영상</strong><span>${clock(c.start_seconds)} – ${clock(c.end_seconds)}</span></div>
      <a class="chapter-full" href="https://www.youtube.com/watch?v=${c.video_id}" target="_blank" rel="noopener noreferrer">이번 주 영상 전체 보기</a>
      <p data-chapter-status role="status"></p></section>`;
  }
  function loadAPI() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (api) return api;
    api = new Promise((resolve,reject) => {
      const script = document.createElement('script');
      const prior = window.onYouTubeIframeAPIReady;
      const ready = () => {
        if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = prior;
        clearTimeout(timer);
        try { prior?.(); } finally { resolve(window.YT); }
      };
      function failed() {
        if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = prior;
        clearTimeout(timer); script.remove(); api = null; reject(new Error('video api'));
      }
      const timer = setTimeout(failed,12000);
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = failed; window.onYouTubeIframeAPIReady = ready; document.head.append(script);
    });
    return api;
  }
  async function play(panel,c) {
    if (!valid(c)) return;
    close();
    const turn = ticket, screen = panel.querySelector('[data-chapter-screen]'), status = panel.querySelector('[data-chapter-status]');
    const again = (message,label) => {
      if (turn !== ticket || !panel.isConnected) return;
      close();
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.chapterPlay = ''; button.textContent = label;
      screen.replaceChildren(button); status.textContent = message;
    };
    status.textContent = '영상을 불러오는 중이에요.';
    screen.querySelector('button').disabled = true;
    try {
      const yt = await loadAPI();
      if (turn !== ticket || !panel.isConnected) return;
      const host = document.createElement('div'); screen.replaceChildren(host);
      const segment = {videoId:c.video_id,startSeconds:c.start_seconds,endSeconds:c.end_seconds};
      loadTimer = setTimeout(() => again('영상을 열 수 없어요. 연결을 확인한 뒤 다시 시도해 주세요.','다시 시도'),15000);
      player = new yt.Player(host,{width:'100%',height:'100%',playerVars:{controls:1,origin:location.origin,playsinline:1,rel:0},
        events:{
          onReady:e => {
            if (turn !== ticket) return;
            clearTimeout(loadTimer);
            const frame = e.target.getIframe?.();
            if (frame) frame.title = '이번 챕터 영상';
            e.target.loadVideoById(segment);
            status.textContent = '';
          },
          onStateChange:e => {
            if (turn !== ticket) return;
            clearInterval(poll);
            if (e.data === yt.PlayerState.ENDED) { again('이 챕터를 끝까지 재생했어요.','챕터 다시 보기'); return; }
            if (e.data !== yt.PlayerState.PLAYING) return;
            let startedAt = performance.now();
            poll = setInterval(() => {
              if (turn !== ticket) return;
              const time = e.target.getCurrentTime();
              if (time >= c.end_seconds) { again('이 챕터를 끝까지 재생했어요.','챕터 다시 보기'); return; }
              // 유튜브 키프레임 오차를 허용하되 구간 바깥으로 탐색하면 같은 챕터의 시작으로 돌린다.
              if (time + 2 < c.start_seconds && performance.now()-startedAt > 1500) {
                startedAt = performance.now(); e.target.loadVideoById(segment);
              }
            },200);
          },
          onError:() => again('영상을 재생할 수 없어요. 연결 또는 영상의 공개 설정을 확인해 주세요.','다시 시도')
        }});
    } catch (_) { again('영상을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.','다시 시도'); }
  }
  return {render,play,close};
})();

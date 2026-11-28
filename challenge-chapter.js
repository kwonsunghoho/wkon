/* 공개된 챕터만 재생한다. 영상 주소는 사용자가 재생을 누른 뒤에만 로드한다. */
window.ChallengeChapter = (() => {
  'use strict';
  let api, player, nativeVideo, nativeEvents, poll, loadTimer, ticket = 0;
  if ('serviceWorker' in navigator && location.pathname.endsWith('/challenge-mission.html')) {
    navigator.serviceWorker.register('challenge-mission-sw.js', {scope: 'challenge-mission.html'}).catch(()=>{});
  }
  const clock = n => Math.floor(n / 60) + ':' + String(n % 60).padStart(2,'0');
  function valid(c) {
    const supported = c?.provider === 'storage' || (c?.provider === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(c.video_id));
    return supported &&
      Number.isInteger(c.start_seconds) && Number.isInteger(c.end_seconds) &&
      c.start_seconds >= 0 && c.start_seconds < c.end_seconds && c.end_seconds <= 86400;
  }
  function close() {
    ticket++; clearInterval(poll); clearTimeout(loadTimer);
    nativeEvents?.abort();
    if (nativeVideo) {
      nativeVideo.pause(); nativeVideo.removeAttribute('src'); nativeVideo.load(); nativeVideo.remove();
    }
    nativeVideo = nativeEvents = null;
    if (player) { try { player.destroy(); } catch (_) {} }
    player = null;
  }
  function render(c, day) {
    if (!valid(c)) return '';
    const full = c.provider === 'youtube'
      ? `<a class="chapter-full" href="https://www.youtube.com/watch?v=${c.video_id}" target="_blank" rel="noopener noreferrer">이번 주 영상 전체 보기</a>`
      : '<button class="chapter-full" type="button" data-chapter-full>이번 주 영상 전체 보기</button>';
    return `<section class="chapter-player" aria-label="DAY ${Number(day)} 영상"><div class="chapter-screen" data-chapter-screen>
      <button type="button" data-chapter-play><span class="chapter-triangle" aria-hidden="true"></span><span>챕터 재생</span></button></div>
      <div class="chapter-caption"><strong>DAY ${Number(day)} 영상</strong><span>${clock(c.start_seconds)} – ${clock(c.end_seconds)}</span></div>
      ${full}
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
  function mountNative(screen,status,c,full,url,resume,again,reconnect) {
    const video = document.createElement('video');
    const turn = ticket;
    nativeVideo = video; nativeEvents = new AbortController();
    const listen = (name,fn) => video.addEventListener(name,fn,{signal:nativeEvents.signal});
    const start = full ? 0 : c.start_seconds;
    let end = full ? Infinity : c.end_seconds;
    const requestedPosition = Number.isFinite(resume) && resume>=start && resume<end ? resume : start;
    let lastPosition = requestedPosition;
    const finish = () => again(full ? '이번 주 영상을 끝까지 재생했어요.' : '이 챕터를 끝까지 재생했어요.',full ? '전체 영상 다시 보기' : '챕터 다시 보기');
    function checkRange() {
      if (turn!==ticket || video.readyState<1 || video.error) return;
      if (video.currentTime>=start && video.currentTime<end) lastPosition = video.currentTime;
      if (full) return;
      if (video.currentTime >= end) finish();
      else if (video.currentTime + .15 < start && !video.seeking) video.currentTime = start;
    }
    video.controls = true; video.playsInline = true; video.preload = 'auto';
    const media = new URL(url);
    if (media.origin === 'https://apzwauiumhmsvrgffjis.supabase.co') video.crossOrigin = 'anonymous';
    const firstChapterPlay = !full && !Number.isFinite(resume);
    if (firstChapterPlay && start > 0) media.hash = 't=' + start;
    video.setAttribute('aria-label',full ? '이번 주 전체 영상' : '선택한 챕터 영상');
    listen('loadedmetadata',()=>{
      if (turn!==ticket) return;
      if (Number.isFinite(video.duration)) {
        if (!full && (start >= video.duration || end > video.duration+.5)) {
          again('설정한 챕터 시간이 영상 길이를 벗어났어요. 운영자에게 알려 주세요.','다시 시도'); return;
        }
        end = Math.min(end,video.duration);
      }
      if (Math.abs(video.currentTime - requestedPosition) > .15) video.currentTime = requestedPosition;
      if (video.paused && !needsTap) requestPlayback();
    });
    listen('loadeddata',()=>{ clearTimeout(loadTimer); });
    listen('playing',()=>{ clearTimeout(loadTimer); status.textContent=''; clearInterval(poll); if(!full) poll=setInterval(checkRange,100); });
    listen('pause',()=>clearInterval(poll));
    listen('seeked',checkRange); listen('timeupdate',checkRange); listen('ended',finish);
    listen('error',()=>{
      if (turn!==ticket) return;
      const position = video.currentTime>=start && video.currentTime<end && (video.currentTime>0 || lastPosition===0)
        ? video.currentTime : lastPosition;
      reconnect(position);
    });
    screen.replaceChildren(video);
    video.src = media.href;
    video.load();
    let needsTap = false;
    loadTimer = setTimeout(()=>{
      if (turn===ticket && !needsTap) status.textContent='영상을 준비하고 있어요. 준비가 끝나면 재생됩니다.';
    },8000);
    function requestPlayback() {
      video.play().catch(error=>{
        if (turn!==ticket || error.name==='AbortError') return;
        if (error.name==='NotAllowedError') {
          needsTap = true;
          status.textContent = '영상의 ▶ 버튼을 눌러 재생해 주세요.';
        }
      });
    }
    if (firstChapterPlay) requestPlayback();
  }
  async function play(panel,c,{full=false,loadURL,resume,renewed=false}={}) {
    if (!panel || !valid(c)) return;
    close();
    const turn = ticket, screen = panel.querySelector('[data-chapter-screen]'), status = panel.querySelector('[data-chapter-status]');
    const fullButton = panel.querySelector('[data-chapter-full]');
    if (fullButton) {
      fullButton.dataset.mode = full ? 'full' : 'chapter';
      fullButton.textContent = full ? '선택한 챕터로 돌아가기' : '이번 주 영상 전체 보기';
    }
    const again = (message,label,position) => {
      if (turn !== ticket || !panel.isConnected) return;
      close();
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.chapterPlay = full ? 'full' : 'chapter'; button.textContent = label;
      if (Number.isFinite(position)) button.dataset.resume = String(position);
      screen.replaceChildren(button); status.textContent = message;
    };
    status.textContent = renewed ? '보던 위치에서 다시 연결하고 있어요.' : '영상을 불러오는 중이에요.';
    const pendingButton = document.createElement('button');
    pendingButton.type = 'button'; pendingButton.dataset.chapterPlay = ''; pendingButton.disabled = true; pendingButton.textContent = '불러오는 중';
    screen.replaceChildren(pendingButton);
    try {
      if (c.provider === 'storage') {
        loadTimer = setTimeout(()=>again('영상을 열 수 없어요. 연결을 확인한 뒤 다시 시도해 주세요.','다시 시도',resume),20000);
        const href = await loadURL();
        if (turn!==ticket || !panel.isConnected) return;
        clearTimeout(loadTimer);
        if (typeof href!=='string' || !href.trim()) throw new Error('video url');
        const url = new URL(href,location.href);
        if (url.protocol!=='https:' && !(url.protocol==='http:' && url.origin===location.origin)) throw new Error('video url');
        mountNative(screen,status,c,full,url.href,resume,again,position=>{
          // 긴 원본의 다음 구간 요청이 실패하면 참가 권한을 다시 확인하고, 같은 위치에서 한 번만 복구한다.
          if (!renewed) { play(panel,c,{full,loadURL,resume:position,renewed:true}); return; }
          again('영상을 불러오지 못했어요. 다시 누르면 보던 위치에서 이어져요.','다시 시도',position);
        });
        return;
      }
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
    } catch (_) { again('영상을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.','다시 시도',resume); }
  }
  return {render,play,close};
})();

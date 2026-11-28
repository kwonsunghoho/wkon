/* 챌린지 영상 구간 요청과 미션 알림을 처리한다. 비공개 영상은 캐시하지 않는다. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || req.destination !== 'video') return;
  const url = new URL(req.url);
  if (url.origin !== 'https://apzwauiumhmsvrgffjis.supabase.co' ||
      !url.pathname.startsWith('/storage/v1/object/sign/challenge-room-video/')) return;

  // 메타데이터와 챕터 시작점을 찾을 때 수 GB의 남은 원본 전체를 요청하지 않는다.
  const match = /^bytes=(\d+)-(\d*)$/i.exec(req.headers.get('range') || 'bytes=0-');
  if (!match) return;
  const start = Number(match[1]), limit = start + 2 * 1024 * 1024 - 1;
  if (!Number.isSafeInteger(limit) || (match[2] && Number(match[2]) <= limit)) return;
  event.respondWith((async () => {
    try {
      const part = await fetch(url.href, {
        headers: { Range: 'bytes=' + start + '-' + limit }, credentials: 'omit',
        cache: 'no-store', signal: req.signal
      });
      if (part.status === 206 || part.status === 416) return part;
      await part.body?.cancel();
    } catch (error) {
      if (req.signal.aborted) throw error;
    }
    return fetch(req);
  })());
});

self.addEventListener('push', event => {
  let value = {};
  try { value = event.data?.json() || {}; } catch {}
  const mission = typeof value.mission === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.mission)
    ? value.mission : '';
  const names = {voice:'보신각',spinning:'스피닝',expression:'영합각',answer:'승자각'};
  const challenge = Object.hasOwn(names,value.challenge) ? value.challenge : 'voice';
  const round = Number.isInteger(value.round) && value.round>0 ? value.round : null;
  const day = Number(value.day);
  const label = Number.isInteger(day) && day >= 1 && day <= 10 ? 'DAY ' + day + ' 미션이 열렸어요.' : '오늘의 미션이 열렸어요.';
  event.waitUntil(self.registration.showNotification('몬크 · '+names[challenge]+(round?' '+round+'기':' 챌린지'), {
    body:label, icon:'/images/MONC_Logo_Full_Package/assets/favicon/android-chrome-192x192.png',
    tag:'monc-challenge-' + mission, data:{mission,challenge,round},
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL('challenge-mission.html',self.location.href);
  const mission = event.notification.data?.mission;
  if (mission) url.searchParams.set('id',mission);
  else if (event.notification.data?.round) {
    url.searchParams.set('challenge',event.notification.data.challenge);
    url.searchParams.set('round',event.notification.data.round);
  }
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const match = clients.find(client => new URL(client.url).pathname === url.pathname && new URL(client.url).origin === url.origin);
    if (match) {
      try { const target = await match.navigate(url.href); if (target) return await target.focus(); } catch {}
    }
    return await self.clients.openWindow(url.href);
  })());
});

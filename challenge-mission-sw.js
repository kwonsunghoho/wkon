/* 캐시 또는 일반 페이지 요청 처리는 하지 않는다. 알림을 누르면 해당 미션을 연다. */
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

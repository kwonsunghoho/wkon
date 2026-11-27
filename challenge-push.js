/* 알림은 이 기기에서 직접 동의한 기수에만 보낸다. */
window.ChallengePush = (() => {
  const workerURL = new URL('challenge-mission-sw.js', document.baseURI);
  const scope = new URL('challenge-mission.html', workerURL).href;
  const views = new WeakMap();

  async function registration() {
    const reg = await navigator.serviceWorker.register(workerURL.href, {scope});
    if (reg.active) return reg;
    const worker = reg.installing || reg.waiting;
    if (!worker) throw Error('worker');
    await new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        worker.removeEventListener('statechange', changed);
      };
      const changed = () => {
        if (worker.state === 'activated') { done(); resolve(); }
        if (worker.state === 'redundant') { done(); reject(Error('worker')); }
      };
      const timer = setTimeout(() => { done(); reject(Error('timeout')); },12000);
      worker.addEventListener('statechange',changed);
      changed();
    });
    return reg;
  }

  async function mount(container, {roundId, sb}) {
    if (!container || !sb || !roundId) return;
    const view = {};
    views.set(container,view);
    const button = document.createElement('button');
    button.type = 'button';
    const hint = document.createElement('small');
    hint.setAttribute('role','status');
    container.replaceChildren(button,hint);
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const installed = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    const unsupported = !window.isSecureContext || !('serviceWorker' in navigator) ||
      !('PushManager' in window) || !('Notification' in window);
    if (unsupported || (ios && !installed)) {
      button.hidden = true;
      hint.textContent = ios && !installed
        ? '아이폰은 Safari에서 공유 → 홈 화면에 추가한 뒤, 몬크를 열어 알림을 켜 주세요.'
        : '이 브라우저에서는 기기 알림을 사용할 수 없어요. 미션은 이 페이지에서 확인하세요.';
      return;
    }
    let enabled = false;
    let reg;
    let subscription;
    async function update(action,extra) {
      const {data,error} = await sb.rpc('challenge_room',{p_action:action,p_data:{
        challenge:'voice',round:roundId,...extra,
      }});
      if (error || data?.ok === false) throw Error('update');
      return data;
    }
    function display(message='') {
      button.textContent = enabled ? '이 기기 알림 끄기' : '이 기기에서 미션 알림 받기';
      button.setAttribute('aria-pressed',String(enabled));
      hint.textContent = message || (enabled ? '미션이 열리면 이 기기로 알려드려요.' : '');
    }
    button.disabled = true;
    display();
    try {
      reg = await registration();
      subscription = await reg.pushManager.getSubscription();
      if (subscription) enabled = (await update('push-status',{endpoint:subscription.endpoint}))?.enabled === true;
      display();
    } catch {
      display('알림 설정을 확인하지 못했어요. 잠시 후 다시 열어 주세요.');
      return;
    }
    if (views.get(container) !== view) return;
    button.disabled = false;
    button.addEventListener('click',async () => {
      button.disabled = true;
      try {
        if (enabled) {
          await update('push-disable',{endpoint:subscription.endpoint});
          enabled = false;
          display('이 기기에서 이번 기수의 알림을 껐어요.');
          return;
        }
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          display(permission === 'denied' ? '기기 또는 브라우저 설정에서 이 사이트의 알림을 허용해 주세요.' : '알림을 켜려면 브라우저에서 허용을 선택해 주세요.');
          return;
        }
        if (!subscription) {
          const {data,error} = await sb.functions.invoke('challenge-mission-push',{body:{action:'public-key'}});
          if (error || !data?.publicKey) throw Error('key');
          const keyBytes = Uint8Array.from(atob(data.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
          subscription = await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes});
        }
        const details = subscription.toJSON();
        await update('push-enable',{endpoint:details.endpoint,keys:details.keys});
        enabled = true;
        display();
      } catch { display('알림 설정을 저장하지 못했어요. 다시 시도해 주세요.'); }
      finally { button.disabled = false; }
    });
  }
  return {mount};
})();

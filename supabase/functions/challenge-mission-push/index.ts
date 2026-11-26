import webpush from 'npm:web-push@3.6.7';

const FN_VERSION = '2026-11-26.1';
const base = Deno.env.get('SUPABASE_URL');
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => Response.json(body, {status, headers: cors});

async function worker(action: string, data: Record<string, unknown>) {
  if (!base || !service) throw Error('configuration');
  const response = await fetch(base + '/rest/v1/rpc/challenge_push_worker', {
    method: 'POST',
    headers: {apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json'},
    body: JSON.stringify({p_action: action, p_data: data}),
  });
  if (!response.ok) throw Error('worker:' + response.status);
  return await response.json();
}

type Vapid = {publicKey: string; privateKey: string};
let keysPending: Promise<Vapid> | undefined;
function keys(): Promise<Vapid> {
  // 처음 한 번만 DB에 생성된다. 동시에 실행돼도 DB가 정한 같은 키 쌍을 쓴다.
  keysPending ??= worker('vapid', webpush.generateVAPIDKeys()).catch(error => {
    keysPending = undefined;
    throw error;
  });
  return keysPending!;
}

function isPushEndpoint(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) return false;
    return ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com',
      'web.push.apple.com', 'push.apple.com', 'wns.windows.com', 'notify.windows.com'].some(
        host => url.hostname === host || (host !== 'fcm.googleapis.com' && url.hostname.endsWith('.' + host))
      );
  } catch { return false; }
}

type Delivery = {id:string; lease:string; mission_id:string; day_no:number; endpoint:string;
  keys:{p256dh:string; auth:string}};
async function deliver(item: Delivery, vapid: Vapid) {
  if (!isPushEndpoint(item.endpoint)) return 'failed';
  let request;
  try {
    request = webpush.generateRequestDetails({endpoint:item.endpoint, keys:item.keys}, JSON.stringify({
      mission:item.mission_id, day:item.day_no,
    }), {TTL:1800, urgency:'normal', topic:item.mission_id.replaceAll('-',''),
      vapidDetails:{subject:'https://monc.ai.kr', ...vapid}});
  } catch { return 'failed'; }
  try {
    const response = await fetch(request.endpoint, {
      method:'POST', headers:request.headers, body:new Uint8Array(request.body),
      redirect:'error', signal:AbortSignal.timeout(6500),
    });
    await response.body?.cancel();
    if (response.ok) return 'sent';
    if (response.status === 404 || response.status === 410) return 'gone';
    if ([408, 429].includes(response.status) || response.status >= 500 || response.status === 403) return 'retry';
    return 'failed';
  } catch { return 'retry'; }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, {headers:cors});
  if (request.method !== 'POST') return json({error:'method'},405);
  try {
    const body = await request.json().catch(() => null);
    if (body?.probe === true) return json({version:FN_VERSION});
    if (body?.action === 'public-key') return json({publicKey:(await keys()).publicKey});
    if (body?.action !== 'dispatch' || typeof body.token !== 'string' || body.token.length > 256)
      return json({error:'request'},400);
    let result;
    try { result = await worker('claim',{token:body.token}); }
    catch (error) {
      if (error instanceof Error && ['worker:401','worker:403'].includes(error.message)) return json({error:'dispatch'},403);
      throw error;
    }
    if (!Array.isArray(result?.deliveries)) return json({error:'dispatch'},403);
    if (!result.deliveries.length) return json({processed:0});
    const vapid = await keys();
    const items: Delivery[] = result.deliveries;
    let processed = 0;
    for (let offset=0; offset<items.length; offset+=10) {
      const group = items.slice(offset,offset+10);
      const complete = await Promise.allSettled(group.map(async item => {
        const status = await deliver(item,vapid);
        const update = await worker('finish',{id:item.id,lease:item.lease,status});
        return update?.ok === true;
      }));
      processed += complete.filter(entry => entry.status === 'fulfilled' && entry.value).length;
    }
    return json({processed});
  } catch { return json({error:'temporarily_unavailable'},503); }
});

import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {createECDH,randomBytes} from 'node:crypto';
import ece from 'npm:http_ece@1.2.0';
let handler: (req: Request) => Promise<Response>;
Object.defineProperty(Deno,'serve',{value:(fn:typeof handler) => { handler=fn; }});
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','fixture');
Deno.env.set('SUPABASE_URL','https://fixture.invalid');
const receiver=createECDH('prime256v1');
receiver.generateKeys();
const subscriptionKeys={p256dh:receiver.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')};
let stored:unknown;
const results:Record<string,string> = {};
const contact:string[]=[];
globalThis.fetch=async(input,init)=>{
  const url=String(input);
  if (url.startsWith('https://fixture.invalid/')) {
    const {p_action:act,p_data:data}=JSON.parse(String(init?.body));
    if (act==='vapid') {stored??=data; return Response.json(stored);}
    if (act==='finish') {results[data.id]=data.status;return Response.json({ok:true});}
    if (act==='claim') {
      if(data.token!=='valid')return Response.json({ok:false});
      return Response.json({deliveries:['send','gone','retry','bad-host'].map(id=>({
        id,lease:'fixture',mission_id:'0f257189-1064-4809-9025-6836267a2140',day_no:1,challenge:'spinning',round:4,
        endpoint:id==='bad-host'?'https://example.com/push':'https://fcm.googleapis.com/'+id,keys:subscriptionKeys,
      }))});
    }
    throw Error(act);
  }
  contact.push(url);
  assert.match(url,/^https:\/\/fcm\.googleapis\.com\//);
  assert.equal(init?.redirect,'error');
  const headers=new Headers(init?.headers);
  assert.equal(headers.get('content-encoding'),'aes128gcm');
  assert.match(headers.get('authorization')||'',/^vapid /);
  const decoded = ece.decrypt(Buffer.from(init?.body as Uint8Array), {
    version:'aes128gcm', privateKey:receiver, authSecret:Buffer.from(subscriptionKeys.auth,'base64url'),
  });
  assert.deepEqual(JSON.parse(decoded.toString()), {mission:'0f257189-1064-4809-9025-6836267a2140',day:1,challenge:'spinning',round:4});
  return new Response(null,{status:url.endsWith('/gone')?410:url.endsWith('/retry')?429:201});
};
await import('../supabase/functions/challenge-mission-push/index.ts');
const call=async(body:unknown)=>handler(new Request('https://server.invalid/',{method:'POST',body:JSON.stringify(body)}));
assert.equal((await (await call({probe:true})).json()).version,'2026-11-28.1');
const key=await (await call({action:'public-key'})).json();
assert.deepEqual(Object.keys(key),['publicKey']);
assert.equal(Buffer.from(key.publicKey,'base64url').length,65);
assert.equal((await call({action:'dispatch',token:'unrecognised'})).status,403);
assert.equal((await (await call({action:'dispatch',token:'valid'})).json()).processed,4);
assert.deepEqual(results,{send:'sent',gone:'gone',retry:'retry','bad-host':'failed'});
assert.equal(contact.length,3);
console.log('Push sender verified with synthetic subscriptions (no real network).');

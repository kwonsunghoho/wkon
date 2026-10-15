// 저장 공급자 경계: 학생 화면은 파일 ID만 다루고 서명·삭제는 이 함수가 담당한다.
// Verify JWT ON. 정리 예약은 별도 MEDIA_CLEANUP_SECRET과 JWT를 모두 요구한다.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
export const FN_VERSION = '2026-10-13a';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type, x-cleanup-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:{...cors,'Content-Type':'application/json'}});
type Media = {id:string; provider:string; bucket:string; object_path:string; expires_at:string; lease_id:string};
type Store = { upload(m:Media):Promise<unknown>; read(m:Media,seconds:number):Promise<string>; remove(m:Media):Promise<void> };

export async function handler(req: Request): Promise<Response> {
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  try {
    const b = await req.json();
    if(b.probe===true) return json({version:FN_VERSION,features:['private-media','resumable-upload','academy-2-months','challenge-14-days','cleanup-leases']});
    const url=Deno.env.get('SUPABASE_URL')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!;
    const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const stores:Record<string,Store>={supabase:{
      async upload(m){
        const {data,error}=await service.storage.from(m.bucket).createSignedUploadUrl(m.object_path);
        if(error) throw error;
        return {provider:'supabase',id:m.id,bucket:m.bucket,path:m.object_path,token:data.token,
          endpoint:url.replace('.supabase.co','.storage.supabase.co')+'/storage/v1/upload/resumable'};
      },
      async read(m,seconds){const {data,error}=await service.storage.from(m.bucket).createSignedUrl(m.object_path,seconds); if(error) throw error; return data.signedUrl;},
      async remove(m){const {error}=await service.storage.from(m.bucket).remove([m.object_path]); if(error) throw error;}
    }};
    const store=(m:Media)=>{if(!stores[m.provider]) throw new Error('unsupported_provider');return stores[m.provider];};
    if(b.action==='cleanup') {
      const secret=Deno.env.get('MEDIA_CLEANUP_SECRET');
      if(!secret || req.headers.get('x-cleanup-secret')!==secret) return json({error:'forbidden'},403);
      const {data,error}=await service.rpc('academy_api',{p_action:'cleanup_claim',p:{}});
      if(error) throw error;
      let deleted=0,failed=0;
      for(const m of (data.items||[]) as Media[]) {
        let ok=true,reason='';
        try {await store(m).remove(m);deleted++;} catch(e){ok=false;failed++;reason=String(e);}
        const saved=await service.rpc('academy_api',{p_action:'cleanup_result',p:{id:m.id,lease_id:m.lease_id,ok,error:reason}});
        if(saved.error) throw saved.error;
      }
      return json({deleted,failed,processed:data.items.length});
    }
    const authorization=req.headers.get('authorization')||'';
    const client=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
    const {data:auth,error:authError}=await client.auth.getUser(authorization.replace(/^Bearer\s+/i,''));
    if(authError||!auth.user) return json({error:'login_required'},401);
    const action=({prepare:'media_prepare',finish:'media_finish',read:'media_read',path:'media_path'} as Record<string,string>)[b.action];
    if(!action) return json({error:'unknown_action'},400);
    const {data,error}=await client.rpc('academy_api',{p_action:action,p:b.params||{}});
    if(error) return json({error:error.message,code:error.code},error.code==='42501'?403:400);
    if(b.action==='prepare') return json(await store(data).upload(data));
    if(b.action==='finish'||data.expired) return json(data);
    const seconds=Math.min(600,Math.floor((Date.parse(data.expires_at)-Date.now())/1000));
    if(seconds<1) return json({expired:true});
    return json({url:await store(data).read(data,seconds),expires_at:data.expires_at});
  } catch(e) {
    console.error('academy-media:',e instanceof Error?e.message:String(e));
    return json({error:'media_unavailable'},500);
  }
}
if(import.meta.main) Deno.serve(handler);

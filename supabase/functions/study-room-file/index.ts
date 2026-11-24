// 팀원이 제출한 파일과 녹음은 비공개 버킷에서만 다룬다.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const FN_VERSION = '2026-11-24a';
const bucket = 'study-room-private';
const limit = 40 * 1024 * 1024;
const headers = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', 'Content-Type': 'application/json',
};
const reply = (value: unknown, status=200) => new Response(JSON.stringify(value), {status, headers});
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);

function mimeOf(bytes: Uint8Array, name: string, type: string) {
  const ascii = (offset: number, n: number) => String.fromCharCode(...bytes.subarray(offset,offset+n));
  const signature = (...values: number[]) => values.every((v,i)=>bytes[i]===v);
  const ext = name.split('.').pop()?.toLowerCase();
  if (signature(0x89,0x50,0x4e,0x47,13,10,26,10)) return 'image/png';
  if (signature(255,216,255)) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(ascii(0,6))) return 'image/gif';
  if (ascii(0,4)==='RIFF') {
    if (ascii(8,4)==='WEBP') return 'image/webp';
    if (ascii(8,4)==='WAVE') return 'audio/wav';
  }
  if (ascii(4,4)==='ftyp') {
    const brand=ascii(8,4);
    if (/^avi[fs]$/.test(brand)) return 'image/avif';
    if (/^(heic|heix|hevc|mif1)$/.test(brand)) return 'application/octet-stream';
    if (brand==='qt  ') return 'video/quicktime';
    return type.startsWith('audio/') || ext==='m4a' ? 'audio/mp4' : 'video/mp4';
  }
  if (signature(26,69,223,163)) return type.startsWith('audio/') || ext==='weba' ? 'audio/webm':'video/webm';
  if (ascii(0,4)==='OggS') return type.startsWith('video/')?'video/ogg':'audio/ogg';
  if (ascii(0,4)==='fLaC') return 'audio/flac';
  if (ascii(0,3)==='ID3' || (bytes[0]===255 && (bytes[1]&224)===224)) return ext==='aac'?'audio/aac':'audio/mpeg';
  if (ascii(0,5)==='%PDF-') return 'application/pdf';
  if (signature(0x50,0x4b,3,4) && (ext==='docx'||ext==='hwpx')) return 'application/octet-stream';
  if (signature(0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1) && ext==='hwp') return 'application/octet-stream';
  if (ext==='txt') {try {return new TextDecoder('utf-8',{fatal:true}).decode(bytes).includes('\0')?null:'text/plain';}catch{return null;}}
  return null;
}
Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response(null,{headers});
  if(req.method!=='POST') return reply({ok:false},405);
  try {
    const multipart=(req.headers.get('content-type')||'').includes('multipart/form-data');
    const json=multipart?null:await req.json();
    if(json?.probe===true) return reply({ok:true,fn:'study-room-file',version:FN_VERSION});
    const authorization=req.headers.get('authorization')||'';
    if(!/^Bearer \S+$/i.test(authorization)) return reply({ok:false},401);
    const url=Deno.env.get('SUPABASE_URL')!;
    const member=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
    const {data:{user},error}=await member.auth.getUser(authorization.slice(7));
    if(error||!user) return reply({ok:false},401);
    const svc=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const storage=svc.storage.from(bucket);
    if(!multipart){
      if(json?.action!=='read'||!uuid(json.room)||!uuid(json.id)) return reply({ok:false},400);
      const access=await svc.rpc('study_room_file',{p_actor:user.id,p_room:json.room,p_action:'read',p_data:{id:json.id}});
      if(access.error||!access.data) return reply({ok:false},403);
      const signed=await storage.createSignedUrl(access.data.path,60,json.download?{download:access.data.name}:undefined);
      return signed.error?reply({ok:false},503):reply({ok:true,url:signed.data.signedUrl});
    }
    if(Number(req.headers.get('content-length')||0)>limit+65536) return reply({ok:false,code:'size'},413);
    const form=await req.formData(), room=form.get('room'), task=form.get('task'), id=form.get('id'), file=form.get('file');
    if(!uuid(room)||!uuid(task)||!uuid(id)||!(file instanceof File)||!file.size||file.size>limit) return reply({ok:false,code:'size'},400);
    const grant=await member.rpc('study_room',{p_room:room,p_action:'upload-check',p_data:{task,id}});
    if(grant.error) return reply({ok:false,code:'permission_or_deadline'},403);
    if(grant.data?.saved) return reply({ok:true,id});
    const bytes=new Uint8Array(await file.arrayBuffer());
    const name=file.name.replace(/[\\/\x00-\x1f]/g,'_').slice(0,255)||'첨부';
    const mime=mimeOf(bytes,name,file.type);
    if(!mime) return reply({ok:false,code:'format'},415);
    const key=room+'/'+task+'/'+crypto.randomUUID();
    const uploaded=await storage.upload(key,bytes,{contentType:mime,upsert:false});
    if(uploaded.error) return reply({ok:false,code:'upload'},503);
    const saved=await svc.rpc('study_room_file',{p_actor:user.id,p_room:room,p_action:'attach',p_data:{task,id,path:key,name,mime}});
    if(saved.error){
      // DB가 명시적으로 거절한 경우에만 제거한다. 응답 유실 때 이미 커밋한 파일을 지우지 않는다.
      if(/^[0-9A-Z]{5}$/.test(saved.error.code||'')) await storage.remove([key]);
      return reply({ok:false,code:'save'},409);
    }
    if(saved.data.path!==key) await storage.remove([key]);
    return reply({ok:true,id});
  } catch {return reply({ok:false,code:'request'},400);}
});
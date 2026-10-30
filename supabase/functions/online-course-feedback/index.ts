// 온라인 강의 전용 제출·피드백. 기존 결제와 학원 수업 권한을 변경하지 않는다.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
const FN_VERSION='2026-10-30-feedback'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}})
const fail=(error:string,status=200)=>reply({ok:false,error},status)
const bucket='online-course-assets',uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const publicRow=(f:any)=>f?{id:f.id,body:f.body,submittedAt:f.submitted_at,feedback:f.replied_at?f.feedback:null,repliedAt:f.replied_at,hasVideo:!!f.upload_id}:null
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
 if(req.method!=='POST')return fail('method_not_allowed',405)
 try{
  const b=await req.json();if(b.probe===true)return reply({ok:true,version:FN_VERSION})
  const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const {data:{user},error:ue}=await sb.auth.getUser((req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,''))
  if(ue||!user)return fail('not_authenticated',401)
  const {data:m,error:me}=await sb.from('members').select('*').eq('id',user.id).maybeSingle()
  if(me||!m?.agreed_at||m.terms_version!=='2026-10-05')return fail('consent_required')
  const admin=m.role==='admin',action=String(b.action||'view')
  if(action.startsWith('admin-')&&!admin)return fail('forbidden',403)
  if(action==='admin-reply'){
   if(!uuid(b.id)||typeof b.body!=='string'||b.body.length>12000||!Number.isInteger(b.revision)||b.revision<0||typeof b.publish!=='boolean')return fail('invalid_feedback')
   const {data,error}=await sb.rpc('oc_reply_feedback',{p_actor:user.id,p_id:b.id,p_body:b.body,p_revision:b.revision,p_publish:b.publish})
   return error?fail('save_failed'):reply(data)
  }
  if(action==='media'){
   if(!uuid(b.id))return fail('not_found')
   const {data:f,error}=await sb.from('online_course_feedback').select('*').eq('id',b.id).maybeSingle()
   if(error||!f||!admin&&f.member_id!==user.id)return fail('not_found')
   const {data:u,error:up}=await sb.from('online_feedback_uploads').select('*').eq('id',f.upload_id).maybeSingle()
   if(up||!u||u.member_id!==f.member_id||u.course_id!==f.course_id)return fail('not_found')
   const {data:s,error:se}=await sb.storage.from(bucket).createSignedUrl(u.path,300)
   return se||!s?fail('not_ready'):reply({ok:true,url:s.signedUrl,name:u.name})
  }
  const courseId=String(b.courseId||'expression-advanced')
  if(action==='admin-list'){
   const page=Number.isInteger(b.page)&&b.page>=0?Math.min(b.page,10000):0
   let q=sb.from('online_course_feedback').select('*').eq('course_id',courseId)
   if(b.filter==='pending')q=q.is('replied_at',null)
   const {data:rows,error}=await q.order('submitted_at',{ascending:false}).order('id').range(page*20,page*20+20)
   if(error)return fail('not_ready')
   const ids=[...new Set((rows||[]).map(f=>f.member_id))]
   const members=ids.length?await sb.from('members').select('id,name').in('id',ids):{data:[],error:null}
   if(members.error)return fail('not_ready')
   return reply({ok:true,hasMore:(rows?.length||0)>20,rows:(rows||[]).slice(0,20).map(f=>({...publicRow(f),name:members.data?.find(v=>v.id===f.member_id)?.name||'수강생',draft:f.draft,revision:f.revision}))})
  }
  if(action==='summary'){
   const {data:rows,error}=await sb.from('online_course_feedback').select('course_id,replied_at').eq('member_id',user.id)
   return error?fail('not_ready'):reply({ok:true,rows})
  }
  let q=sb.from('online_enrollments').select('*').eq('member_id',user.id)
  if(b.enrollmentId){if(!uuid(b.enrollmentId))return fail('not_enrolled');q=q.eq('id',b.enrollmentId)}else q=q.eq('course_id',courseId)
  if(!admin)q=q.eq('admin_preview',false)
  const {data:enrollments,error:ee}=await q.order('created_at',{ascending:false})
  if(ee)return fail('not_ready');if(!enrollments?.length)return fail('not_enrolled')
  const now=Date.now(),e=enrollments.find(v=>!v.revoked_at&&(!v.expires_at||Date.parse(v.expires_at)>now))||enrollments[0]
  const {data:f,error:fe}=await sb.from('online_course_feedback').select('*').eq('member_id',user.id).eq('course_id',e.course_id).maybeSingle()
  const {data:c,error:ce}=await sb.from('online_courses').select('title').eq('id',e.course_id).maybeSingle()
  if(fe||ce)return fail('not_ready')
  const deadline=e.started_at?new Date(Math.min(Date.parse(e.started_at)+14*864e5,Date.parse(e.expires_at))).toISOString():null
  const eligible=!f&&!e.revoked_at&&!!deadline&&Date.parse(deadline)>now
  if(action==='view')return reply({ok:true,title:c?.title||'온라인 강의',courseId:e.course_id,enrollmentId:e.id,deadline,eligible,reason:f?'already_submitted':!e.started_at?'not_started':'submission_closed',submission:publicRow(f)})
  if(action==='upload'){
   if(!eligible)return fail(f?'already_submitted':'submission_closed')
   const ext=String(b.name||'').split('.').pop()?.toLowerCase(),types:Record<string,string>={mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime'}
   if(!ext||!types[ext]||typeof b.name!=='string'||b.name.length>200||!Number.isInteger(b.bytes)||b.bytes<1||b.bytes>2147483648)return fail('invalid_file')
   const id=crypto.randomUUID(),path=`feedback/${user.id}/${id}.${ext}`
   const {data:reserved,error:ie}=await sb.rpc('oc_reserve_feedback_upload',{p_member:user.id,p_enrollment:e.id,p_id:id,p_name:b.name,p_bytes:b.bytes,p_type:types[ext],p_path:path})
   if(ie||!reserved?.ok)return fail(reserved?.error||'save_failed')
   const {data:s,error:se}=await sb.storage.from(bucket).createSignedUploadUrl(path)
   if(se||!s)return fail('upload_failed')
   return reply({ok:true,id,path,bucket,token:s.token,contentType:types[ext],endpoint:Deno.env.get('SUPABASE_URL')!.replace('.supabase.co','.storage.supabase.co')+'/storage/v1/upload/resumable/sign'})
  }
  if(action==='submit'){
   if(!uuid(b.requestId)||typeof b.body!=='string'||b.body.length>12000||b.uploadId!=null&&!uuid(b.uploadId))return fail('invalid_submission')
   const {data,error}=await sb.rpc('oc_submit_feedback',{p_member:user.id,p_enrollment:e.id,p_request:b.requestId,p_body:b.body,p_upload:b.uploadId||null})
   return error?fail('save_failed'):reply(data)
  }
  return fail('unknown_action')
 }catch{return fail('not_ready')}
})

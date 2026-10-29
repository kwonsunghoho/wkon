// 영합각 심화: 공개 소개 / 본인 수강권 / 최초 재생 / 비공개 자산 / 진도.
// 콘솔 한 파일 배포. Verify JWT는 켜둔다. 운영 데이터는 서버에서만 접근한다.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
const FN_VERSION = '2026-10-29-cleanup'
const CORS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const reply = (body: unknown,status=200) => new Response(JSON.stringify(body),{status,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store'}})
const fail = (error:string) => reply({ok:false,error})
const bucket = 'online-course-assets'
// 저장 성공과 파일 정리 성공을 구분한다. 실패·중단된 작업은 DB 임대 만료 후 재시도한다.
async function cleanupVideos(supa:any){
 try{
  const {data:jobs,error}=await supa.rpc('oc_claim_video_cleanup')
  if(error)return {pending:true}
  let pending=false
  for(const job of jobs||[]){
   let success=false
   try{const r=await supa.storage.from(bucket).remove([job.path]);success=!r.error}catch{ /* 다음 조회에서 재시도 */ }
   const done=await supa.rpc('oc_finish_video_cleanup',{p_path:job.path,p_lease:job.lease,p_success:success})
   if(!success||done.error)pending=true
  }
  const remaining=await supa.from('online_video_cleanup').select('path').neq('state','deleted').limit(1)
  return {pending:pending||!!remaining.error||!!remaining.data?.length}
 }catch{return {pending:true}}
}
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:CORS})
 if(req.method!=='POST')return reply({ok:false,error:'method_not_allowed'},405)
 try{
  const b=await req.json()
  if(b.probe===true)return reply({ok:true,fn:'online-course',version:FN_VERSION})
  const supa=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const courseId=String(b.courseId||'expression-advanced')
  if(b.action==='catalog'){
   const {data:c,error}=await supa.from('online_courses').select('*').eq('id',courseId).eq('published',true).maybeSingle()
   if(error)return fail('not_ready')
   if(!c)return fail('not_published')
   const {data:lessons,error:le}=await supa.from('online_lessons').select('*').eq('course_id',c.id).eq('published',true).order('position')
   if(le)return fail('not_ready')
   return reply({ok:true,course:{id:c.id,title:c.title,description:c.description,price:c.price,accessDays:c.access_days,saleOpen:c.sale_open,purchaseNotice:c.purchase_notice},lessons:(lessons||[]).map(l=>({id:l.id,title:l.title,chapter:l.chapter,position:l.position,duration:l.duration_seconds}))})
  }
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'')
  const {data:{user},error:authError}=await supa.auth.getUser(token)
  if(authError||!user)return reply({ok:false,error:'not_authenticated'},401)
  const {data:member,error:me}=await supa.from('members').select('*').eq('id',user.id).maybeSingle()
  if(me||!member?.agreed_at||member.terms_version!=='2026-10-05')return fail('consent_required')
  if(b.action==='access'){
   if(member.role==='admin'){
    if(b.claim!==true)return reply({ok:true,kind:'admin'})
    const {data,error}=await supa.rpc('oc_admin_preview',{p_actor:user.id,p_course:courseId})
    return error?fail('not_ready'):reply(data)
   }
   const {data,error}=await supa.rpc('oc_course_access',{p_member:user.id,p_course:courseId,p_claim:b.claim===true})
   return error?fail('not_ready'):reply(data)
  }
  if(b.action==='note-save'){
   if(typeof b.body!=='string'||b.body.length>12000||!Number.isInteger(b.revision)||b.revision<0||!/^[-0-9a-f]{36}$/i.test(String(b.lessonId)))return fail('invalid_note')
   const {data,error}=await supa.rpc('oc_save_note',{p_member:user.id,p_lesson:b.lessonId,p_body:b.body,p_revision:b.revision})
   return error?fail('save_failed'):reply(data)
  }
  if(b.action==='notes'){
   let query=supa.from('online_course_notes').select('*').eq('member_id',user.id)
   if(b.lessonId)query=query.eq('lesson_id',b.lessonId)
   const {data:notes,error}=await query.order('updated_at',{ascending:false})
   let eq=supa.from('online_enrollments').select('*').eq('member_id',user.id)
   if(member.role!=='admin')eq=eq.eq('admin_preview',false)
   const {data:enrollments,error:ee}=await eq.order('created_at',{ascending:false})
   if(error||ee)return fail('not_ready')
   if(!notes?.length)return reply({ok:true,notes:[],hasCourses:!!enrollments?.length})
   const {data:lessons,error:le}=await supa.from('online_lessons').select('*').in('id',notes.map(n=>n.lesson_id))
   const {data:courses,error:ce}=await supa.from('online_courses').select('*').in('id',[...new Set((lessons||[]).map(l=>l.course_id))])
   if(le||ce)return fail('not_ready')
   return reply({ok:true,hasCourses:!!enrollments?.length,notes:notes.map(n=>{
    const l=lessons?.find(l=>l.id===n.lesson_id),c=courses?.find(c=>c.id===l?.course_id)
    const e=enrollments?.find(e=>e.course_id===l?.course_id&&!e.revoked_at&&(!e.expires_at||Date.parse(e.expires_at)>Date.now())&&(l?.published||e.admin_preview))
    return {lessonId:n.lesson_id,body:n.body,revision:n.revision,updatedAt:n.updated_at,lessonTitle:l?.title||'강의 메모',courseTitle:c?.title||'온라인 강의',courseId:l?.course_id,duration:l?.duration_seconds||0,enrollmentId:e?.id||null}
   })})
  }
  // 관리자는 JWT 실사용자와 현재 회원 역할을 매 요청마다 확인한다.
  if(String(b.action).startsWith('admin-')){
   if(member.role!=='admin')return reply({ok:false,error:'forbidden'},403)
   const {data:c,error:ce}=await supa.from('online_courses').select('*').eq('id',courseId).maybeSingle()
   if(ce||!c||!Number.isInteger(c.revision))return fail('not_ready')
   if(b.action==='admin-classroom'){
    const {data,error}=await supa.rpc('oc_admin_preview',{p_actor:user.id,p_course:courseId})
    return error?fail('not_ready'):reply(data)
   }
   if(b.action==='admin-load'){
    const {data:courses,error:cs}=await supa.from('online_courses').select('*').order('created_at')
    const {data:lessons,error:ls}=await supa.from('online_lessons').select('*').eq('course_id',courseId).order('position')
    if(cs||ls)return fail('not_ready')
    const cleanup=await cleanupVideos(supa)
    return reply({ok:true,course:c,courses,lessons,cleanup})
   }
   const safeText=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max
   const whole=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max
   if(b.action==='admin-course'){
    const p=b.values||{}
    if(!safeText(p.title,100)||!p.title.trim()||!safeText(p.description,2000)||!safeText(p.purchase_notice,10000)
     ||!(p.price===null||whole(p.price,1,100000000))||!whole(p.access_days,1,730)
     ||typeof p.published!=='boolean'||typeof p.sale_open!=='boolean'||!whole(p.revision,1,2147483647))return fail('invalid_fields')
    const {data,error}=await supa.rpc('oc_admin_save',{p_actor:user.id,p_course:courseId,p_action:'course',p})
    return error?fail('save_failed'):reply(data)
   }
   if(b.action==='admin-add'){
    const {data,error}=await supa.rpc('oc_admin_save',{p_actor:user.id,p_course:courseId,p_action:'add',p:{}})
    return error?fail('save_failed'):reply(data)
   }
   if(!/^[0-9a-f-]{36}$/i.test(String(b.lessonId)))return fail('not_found')
   const {data:l,error:le}=await supa.from('online_lessons').select('*').eq('id',b.lessonId).eq('course_id',courseId).maybeSingle()
   if(le||!l)return fail('not_found')
   const types:Record<string,string>={mp4:'video/mp4',webm:'video/webm',pdf:'application/pdf',zip:'application/zip',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',hwp:'application/x-hwp',hwpx:'application/hwp+zip',txt:'text/plain',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'}
   const extension=(name:string)=>name.split('.').pop()?.toLowerCase()||''
   const validName=(name:unknown,kind:string)=>safeText(name,180)&&!!String(name).trim()&&!/[\\/\x00-\x1f]/.test(String(name))&&(kind==='video'?['mp4','webm']:['pdf','zip','docx','pptx','xlsx','hwp','hwpx','txt','png','jpg','jpeg']).includes(extension(String(name)))
   const maxBytes=(kind:string)=>(kind==='video'?2048:50)*1024*1024
   const fileInfo=async(path:string)=>{
    const i=path.lastIndexOf('/'),name=path.slice(i+1)
    const {data,error}=await supa.storage.from(bucket).list(path.slice(0,i),{search:name,limit:100})
    return error?null:data?.find(f=>f.name===name&&f.id)
   }
   if(b.action==='admin-upload'){
    if(!['video','material'].includes(b.kind)||!validName(b.name,b.kind)||!whole(b.bytes,1,maxBytes(b.kind)))return fail('invalid_file')
    if(l.revision!==b.revision)return fail('edit_conflict')
    const path=`${courseId}/${l.id}/${b.kind}/${crypto.randomUUID()}.${extension(b.name)}`
    const {data,error}=await supa.storage.from(bucket).createSignedUploadUrl(path)
    if(error||!data)return fail('upload_unavailable')
    const base=Deno.env.get('SUPABASE_URL')!.replace('.supabase.co','.storage.supabase.co')
    return reply({ok:true,path,token:data.token,bucket,contentType:types[extension(b.name)],endpoint:base+'/storage/v1/upload/resumable/sign'})
   }
   if(b.action==='admin-preview'){
    const path=b.kind==='video'?l.video_path:b.kind==='material'?l.material_path:null
    if(!path)return fail('content_not_ready')
    const {data,error}=await supa.storage.from(bucket).createSignedUrl(path,90,b.kind==='material'?{download:true}:undefined)
    return error||!data?fail('media_unavailable'):reply({ok:true,url:data.signedUrl})
   }
   if(b.action==='admin-lesson'){
    const p=b.values||{}
    if(!safeText(p.title,150)||!p.title.trim()||!safeText(p.chapter,100)||!p.chapter.trim()
     ||!whole(p.position,1,10000)||!whole(p.duration_seconds,0,86400)||typeof p.published!=='boolean'
     ||!whole(p.revision,1,2147483647))return fail('invalid_fields')
    if(l.revision!==p.revision)return fail('edit_conflict')
    if(p.chapters!==undefined&&(!Array.isArray(p.chapters)||p.chapters.length>60||p.chapters.some((c:any,i:number)=>!c||!safeText(c.title,100)||!c.title.trim()||!whole(c.seconds,0,p.duration_seconds-1)||(i>0&&c.seconds<=p.chapters[i-1].seconds))))return fail('invalid_chapters')
    for(const kind of ['video','material']){
     const path=p[kind+'_path'],name=p[kind+'_name']
     if(path===null){if(name!==null)return fail('invalid_file');continue}
     if(typeof path!=='string'||path.length>500||!validName(name,kind))return fail('invalid_file')
     const prefix=`${courseId}/${l.id}/${kind}/`
     if(path!==l[kind+'_path']&&(!path.startsWith(prefix)||!new RegExp('^[0-9a-f-]{36}\\.'+extension(name)+'$','i').test(path.slice(prefix.length))))return fail('invalid_file')
     const file=await fileInfo(path)
     if(!file||!whole(Number(file.metadata?.size),1,maxBytes(kind)))return fail('upload_incomplete')
     const mime=String(file.metadata?.mimetype||'').split(';')[0]
     if(kind==='video'&&mime!==types[extension(name)])return fail('invalid_file')
    }
    // 화면에서 넘긴 다른 키나 구매자 조건을 갱신하지 않는다.
    const {data,error}=await supa.rpc('oc_admin_save',{p_actor:user.id,p_course:courseId,p_action:'lesson',p:{...p,id:l.id}})
    if(error)return fail('save_failed')
    if(!data?.ok)return reply(data)
    const cleanup=await cleanupVideos(supa)
    return reply({...data,cleanup})
   }
   return fail('unknown_action')
  }
  if(b.action==='order'){
   const {data,error}=await supa.rpc('oc_prepare_order',{p_member:user.id,p_course:courseId,p_amount:b.amount,p_days:b.accessDays,p_accepted:b.accepted===true})
   return error?fail('not_ready'):reply(data)
  }
  if(b.action==='library'){
   let libraryQuery=supa.from('online_enrollments').select('*').eq('member_id',user.id)
   if(member.role!=='admin')libraryQuery=libraryQuery.eq('admin_preview',false)
   const {data:rows,error}=await libraryQuery.order('created_at',{ascending:false})
   if(error)return fail('not_ready')
   if(!rows?.length)return reply({ok:true,serverNow:new Date().toISOString(),enrollments:[]})
   const {data:courses,error:ce}=await supa.from('online_courses').select('*').in('id',[...new Set((rows||[]).map(r=>r.course_id))])
   if(ce)return fail('not_ready')
   const ids=(rows||[]).map(r=>r.id)
   const {data:progress,error:pe}=ids.length?await supa.from('online_progress').select('*').in('enrollment_id',ids):{data:[],error:null}
   if(pe)return fail('not_ready')
   return reply({ok:true,serverNow:new Date().toISOString(),enrollments:(rows||[]).map(e=>({...e,title:courses?.find(c=>c.id===e.course_id)?.title||'온라인 강의',progress:(progress||[]).filter(p=>p.enrollment_id===e.id)}))})
  }
  const {data:e,error:ee}=await supa.from('online_enrollments').select('*').eq('id',b.enrollmentId).eq('member_id',user.id).maybeSingle()
  if(ee)return fail('not_ready')
  if(!e||e.admin_preview&&member.role!=='admin')return fail('not_enrolled')
  const expired=!!e.revoked_at||(e.expires_at&&Date.parse(e.expires_at)<=Date.now())
  if(b.action==='view'){
   const {data:c,error:ce}=await supa.from('online_courses').select('*').eq('id',e.course_id).single()
   let lessonQuery=supa.from('online_lessons').select('*').eq('course_id',e.course_id)
   if(!e.admin_preview)lessonQuery=lessonQuery.eq('published',true)
   const {data:lessons,error:le}=await lessonQuery.order('position')
   const {data:progress,error:pe}=await supa.from('online_progress').select('*').eq('enrollment_id',e.id)
   if(ce||le||pe)return fail('not_ready')
   return reply({ok:true,serverNow:new Date().toISOString(),enrollment:e,expired,course:{id:c.id,title:c.title},lessons:(lessons||[]).map(l=>({id:l.id,title:l.title,chapter:l.chapter,position:l.position,duration:l.duration_seconds,hasVideo:!!l.video_path,hasMaterial:!!l.material_path,chapters:l.chapters||[]})),progress:progress||[]})
  }
  if(expired)return fail('access_expired')
  if(b.action==='progress'){
   const position=Number(b.position)
   if(!Number.isFinite(position)||position<0)return fail('bad_progress')
   const {data,error}=await supa.rpc('oc_save_progress',{p_member:user.id,p_enrollment:e.id,p_lesson:b.lessonId,p_position:Math.floor(position)})
   return error?fail('save_failed'):reply(data)
  }
  if(!['play','material'].includes(b.action))return fail('unknown_action')
  let lessonQuery=supa.from('online_lessons').select('*').eq('id',b.lessonId).eq('course_id',e.course_id)
  if(!e.admin_preview)lessonQuery=lessonQuery.eq('published',true)
  const {data:l,error:le}=await lessonQuery.maybeSingle()
  if(le||!l)return fail('lesson_unavailable')
  if(b.action==='material'&&!e.started_at)return fail('start_video_first')
  const path=b.action==='play'?l.video_path:l.material_path
  if(!path)return fail('content_not_ready')
  // URL을 만들어도 실제 파일이 없는 경우를 차단한다. 경로는 DB 값만 사용한다.
  const slash=path.lastIndexOf('/'),folder=slash<0?'':path.slice(0,slash),name=path.slice(slash+1)
  const {data:files,error:fe}=await supa.storage.from(bucket).list(folder,{search:name,limit:100})
  if(fe||!files?.some(f=>f.name===name))return fail('content_not_ready')
  const ttl=e.expires_at?Math.min(90,Math.floor((Date.parse(e.expires_at)-Date.now())/1000)):90
  if(ttl<1)return fail('access_expired')
  const {data:signed,error:se}=await supa.storage.from(bucket).createSignedUrl(path,ttl,b.action==='material'?{download:true}:undefined)
  if(se||!signed?.signedUrl)return fail('media_unavailable')
  let started={startedAt:e.started_at,expiresAt:e.expires_at,serverNow:new Date().toISOString()}
  if(b.action==='play'){
   const {data,error}=await supa.rpc('oc_start',{p_member:user.id,p_enrollment:e.id,p_lesson:l.id})
   if(error)return fail('start_failed')
   if(!data?.ok)return reply(data)
   started=data
  }else{
   // 서명 중 환불/만료가 발생했으면 URL을 반환하지 않는다.
   const {data:again,error:ae}=await supa.from('online_enrollments').select('*').eq('id',e.id).single()
   if(ae||again.revoked_at||Date.parse(again.expires_at)<=Date.now())return fail('access_expired')
  }
  return reply({ok:true,url:signed.signedUrl,urlExpiresAt:new Date(Date.now()+ttl*1000).toISOString(),...started})
 }catch(error){console.error('online-course',error instanceof Error?error.message:'error');return fail('temporarily_unavailable')}
})

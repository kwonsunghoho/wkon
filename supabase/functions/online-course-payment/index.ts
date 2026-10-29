// 온라인 강의 지급 전용. verify-payment와 웹훅만 service_role로 호출한다.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
const FN_VERSION='2026-10-28a'
const STORE='store-a2a17822-a4c8-4d25-ac38-939772dfb6d5'
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
Deno.serve(async req=>{
 if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405)
 try{
  const b=await req.json()
  if(b.probe===true)return json({ok:true,fn:'online-course-payment',version:FN_VERSION})
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  if(!key||req.headers.get('Authorization')!==`Bearer ${key}`)return json({ok:false,error:'forbidden'},403)
  const supa=createClient(Deno.env.get('SUPABASE_URL')!,key)
  const {data:o,error:oe}=await supa.from('online_orders').select('*').eq('payment_id',String(b.paymentId||'')).maybeSingle()
  if(oe)return json({ok:false,error:'not_ready'},503)
  if(!o)return json({ok:false,error:'order_not_found',terminal:true})
  if((b.memberId&&b.memberId!==o.member_id)||(b.courseId&&b.courseId!==o.course_id))return json({ok:false,error:'order_owner_mismatch'},403)
  const secret=Deno.env.get('PORTONE_API_SECRET')
  if(!secret)return json({ok:false,error:'secret_missing'},503)
  const url=`https://api.portone.io/payments/${encodeURIComponent(o.payment_id)}`
  const headers={Authorization:`PortOne ${secret}`}
  const response=await fetch(`${url}?storeId=${encodeURIComponent(STORE)}`,{headers})
  if(response.status===404)return json({ok:false,error:'not_paid'})
  if(!response.ok)return json({ok:false,error:'lookup_failed'},502)
  const pay=await response.json()
  const cancelled=Number(pay.amount?.cancelled||0)
  if(['CANCELLED','PARTIAL_CANCELLED'].includes(pay.status)&&cancelled>0){
   const {data,error}=await supa.rpc('oc_revoke',{p_payment:o.payment_id,p_refunded:cancelled})
   if(error||!data?.ok)return json({ok:false,error:'revoke_failed'},503)
   return json({ok:false,error:'refunded',refunded:true,terminal:true})
  }
  if(['FAILED','CANCELLED'].includes(pay.status)&&!cancelled){
   const {error}=await supa.from('online_orders').update({state:'cancelled'}).eq('payment_id',o.payment_id).eq('state','pending')
   return error?json({ok:false,error:'save_failed'},503):json({ok:false,error:'payment_failed',terminal:true})
  }
  if(pay.status!=='PAID')return json({ok:false,error:'not_paid'})
  // 조회 상점·주문 표식·금액·통화가 모두 일치해야 지급한다.
  let cd:Record<string,unknown>={}
  try{cd=typeof pay.customData==='string'?JSON.parse(pay.customData):pay.customData||{}}catch{ /* 지급하지 않는다. */ }
  if(Number(pay.amount?.total)!==o.amount||!['KRW','CURRENCY_KRW'].includes(pay.currency)||pay.storeId&&pay.storeId!==STORE)
   return json({ok:false,error:'amount_mismatch'})
  const contextOk=cd.k==='online-course'&&cd.oid===o.payment_id&&cd.cid===o.course_id&&cd.uid===o.member_id&&pay.customer?.id===o.member_id
  let result:{ok?:boolean;error?:string;[key:string]:unknown}
  if(!contextOk||pay.channel?.type==='TEST')result={ok:false,error:'refund_required'}
  else{
   const {data,error}=await supa.rpc('oc_settle',{p_payment:o.payment_id,p_amount:o.amount,p_paid_at:pay.paidAt})
   if(error)return json({ok:false,error:'grant_failed'},503)
   result=data
  }
  if(result?.error!=='refund_required')return json(result)
  // 확정 지급 불가만 전액 환불한다. 네트워크/DB 오류는 재시도 대상으로 남긴다.
  const refund=await fetch(`${url}/cancel`,{method:'POST',headers:{...headers,'Content-Type':'application/json','Idempotency-Key':`"course-refund-${o.payment_id}"`},body:JSON.stringify({storeId:STORE,amount:o.amount,reason:'온라인 강의 수강권 지급 불가 · 자동 환불'})})
  const refundBody=await refund.json().catch(()=>({}))
  if(!refund.ok)return json({ok:false,error:'refund_pending'},503)
  // 취소 접수만 된 비동기 결제는 지급/완료로 판단하지 않는다.
  if(refundBody.cancellation?.status!=='SUCCEEDED')return json({ok:false,error:'refund_pending'},503)
  const {data,error}=await supa.rpc('oc_revoke',{p_payment:o.payment_id,p_refunded:o.amount})
  if(error||!data?.ok)return json({ok:false,refunded:true,error:'revoke_failed',warning:'환불은 완료됐지만 수강권 기록 확인이 필요합니다.'},503)
  return json({ok:false,error:'refunded',refunded:true,terminal:true})
 }catch(error){console.error('online-course-payment',error instanceof Error?error.message:'error');return json({ok:false,error:'temporarily_unavailable'},503)}
})

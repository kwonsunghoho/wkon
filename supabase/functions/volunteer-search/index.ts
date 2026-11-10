// 1365 공식 공고 조회. 인증키와 원문 연락처는 브라우저에 전달하지 않는다.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { XMLParser, XMLValidator } from 'npm:fast-xml-parser@5.12.0';
const FN_VERSION='2026-11-10a';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const parser=new XMLParser({ignoreAttributes:true,parseTagValue:false,processEntities:true});
const text=(v:unknown,max=300)=>String(v??'').trim().slice(0,max);
const day=(v:unknown)=>{const s=text(v).replaceAll('-','');return /^\d{8}$/.test(s)?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`:'';};
const hour=(v:unknown)=>{const s=text(v);if(!/^\d{1,2}$/.test(s)||+s>23)return '';return s.padStart(2,'0')+':00';};
export function normalizeItem(row:Record<string,unknown>){
 const id=text(row.progrmRegistNo,20);if(!/^\d{1,20}$/.test(id))throw new Error('upstream_invalid');
 let url='';try{const u=new URL(text(row.url,1500));if(u.protocol==='https:'&&['www.1365.go.kr','1365.go.kr'].includes(u.hostname))url=u.href;}catch{/* 상세 응답에는 원문 주소가 없을 수 있다. */}
 return {id,title:text(row.progrmSj),organization:text(row.mnnstNm||row.nanmmbyNm),location:text(row.actPlace),start_date:day(row.progrmBgnde),end_date:day(row.progrmEndde),start_time:hour(row.actBeginTm),end_time:hour(row.actEndTm),recruit_end:day(row.noticeEndde),status:text(row.progrmSttusSe,10),adult:text(row.adultPosblAt,10),group:text(row.grpPosblAt,10),url,description:text(row.progrmCn,10000)};
}
export function parseResponse(xml:string){
 if(xml.length>2_000_000||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('upstream_invalid');
 const doc=parser.parse(xml),response=doc.response;
 const code=text(response?.header?.resultCode||doc.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnReasonCode);
 if(!['00','0','NORMAL_SERVICE'].includes(code))throw new Error(['20','30','31','32'].includes(code)?'provider_key_error':'upstream_error');
 if(!response?.body)throw new Error('upstream_invalid');
 const rows=response.body.items?.item;
 return {items:(rows?(Array.isArray(rows)?rows:[rows]):[]).map(normalizeItem),total:Math.max(0,Number(response.body.totalCount)||0)};
}
const cache=new Map<string,{at:number;data:ReturnType<typeof parseResponse>}>();
export async function handler(req:Request){
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({ok:false,code:'bad_method'},405);
 let input:Record<string,unknown>;try{const raw=await req.text();if(raw.length>4000)return reply({ok:false,code:'bad_request'},400);input=JSON.parse(raw);if(!input||Array.isArray(input))throw new Error();}catch{return reply({ok:false,code:'bad_request'},400);}
 if(input.probe===true)return reply({ok:true,fn:'volunteer-search',version:FN_VERSION});
 const action=input.action==='detail'?'detail':input.action==='search'?'search':'';
 if(!action)return reply({ok:false,code:'bad_request'},400);
 const auth=req.headers.get('authorization')||'';
 const sb=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_ANON_KEY')||'',{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
 const token=auth.replace(/^Bearer\s+/i,'');const user=await sb.auth.getUser(token);
 if(user.error||!user.data.user)return reply({ok:false,code:'login_required'},401);
 const access=await sb.rpc('community_member',{p_action:'volunteer-access',p_data:{}});
 if(access.error)return reply({ok:false,code:String(access.error.message).includes('rate_limited')?'rate_limited':'access_required'},403);
 const key=Deno.env.get('VOLUNTEER_1365_SERVICE_KEY')?.trim();
 if(!key)return reply({ok:false,code:'not_configured'},503);
 const params=new URLSearchParams({pageNo:'1',numOfRows:'10'});
 if(action==='detail'){
  const id=text(input.id,21);if(!/^\d{1,20}$/.test(id))return reply({ok:false,code:'bad_request'},400);params.set('progrmRegistNo',id);
 }else{
  const keyword=text(input.keyword,80),region=text(input.region,8),from=text(input.from,11),to=text(input.to,11);
  if((region&&!/^\d{7}$/.test(region))||![from,to].every(s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s)))||from>to)return reply({ok:false,code:'bad_request'},400);
  const page=Number(input.page||1);if(!Number.isInteger(page)||page<1||page>100)return reply({ok:false,code:'bad_request'},400);
  params.set('pageNo',String(page));params.set('progrmBgnde',from.replaceAll('-',''));params.set('progrmEndde',to.replaceAll('-',''));params.set('schCateGu','all');
  if(keyword)params.set('keyword',keyword);if(region)params.set('schSido',region);
 }
 const cacheKey=action+params.toString(),cached=cache.get(cacheKey);
 if(action==='search'&&cached&&Date.now()-cached.at<60000)return reply({ok:true,...cached.data,checked_at:new Date(cached.at).toISOString(),cached:true});
 params.set('serviceKey',key);
 try{
  const endpoint=action==='detail'?'getVltrPartcptnItem':'getVltrSearchWordList';
  const result=await fetch(`https://apis.data.go.kr/1741000/volunteerPartcptnService/${endpoint}?${params}`,{signal:AbortSignal.timeout(12000),redirect:'error'});
  if(!result.ok)throw new Error('upstream_error');
  const reader=result.body?.getReader();if(!reader)throw new Error('upstream_error');let xml='',size=0;const decoder=new TextDecoder();
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2_000_000){await reader.cancel();throw new Error('upstream_invalid');}xml+=decoder.decode(part.value,{stream:true});}xml+=decoder.decode();
  const data=parseResponse(xml),at=Date.now();if(cache.size>=100)cache.delete(cache.keys().next().value!);if(action==='search')cache.set(cacheKey,{at,data});
  return reply({ok:true,...data,checked_at:new Date(at).toISOString(),cached:false});
 }catch(err){const code=err instanceof Error&&['provider_key_error','upstream_invalid'].includes(err.message)?err.message:'upstream_error';return reply({ok:false,code},502);}
}
if(import.meta.main)Deno.serve(handler);

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
export const FN_VERSION='2026-10-20.1';
const cors={'Access-Control-Allow-Origin':'https://monc.ai.kr','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
export function validate(input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const b=input as Record<string,unknown>;
 if(b.consent!==true||b.consent_version!=='talent-2026-10-17'||(b.website!==undefined&&b.website!==''))return null;
 if(typeof b.request_id!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(b.request_id))return null;
 const values:Record<string,string>={request_id:b.request_id};
 for(const [key,max] of Object.entries({name:50,phone:20,email:254,education:300,experience:2000,coaching:1000,availability:1000,strength:500,approach:500,feedback:500,responsibility:500})){
  if(typeof b[key]!=='string')return null;const value=(b[key] as string).trim();if(!value||value.length>max)return null;values[key]=value;
 }
 values.phone=values.phone.replace(/[^0-9]/g,'');values.email=values.email.toLowerCase();
 if(!/^0[0-9]{8,10}$/.test(values.phone)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))return null;
 return values;
}
async function readBody(req:Request){
 const reader=req.body?.getReader();if(!reader)throw new Error('invalid');const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32000){await reader.cancel();throw new Error('too_large');}chunks.push(value);}
 const all=new Uint8Array(size);let offset=0;for(const v of chunks){all.set(v,offset);offset+=v.length;}return JSON.parse(new TextDecoder().decode(all));
}
export async function handler(req:Request){
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return reply({ok:false,code:'method_not_allowed'},405);
 let body;try{body=await readBody(req);}catch{return reply({ok:false,code:'invalid_input'},400);}
 if(body?.probe===true){
  try{const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {error}=await db.from('talent_applications').select('id,education,coaching,availability,feedback,responsibility').limit(0);
  return reply({ok:true,version:FN_VERSION,ready:!error});}catch{return reply({ok:true,version:FN_VERSION,ready:false});}
 }
 const input=validate(body);if(!input)return reply({ok:false,code:'invalid_input'},400);
 try{
 const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!secret)throw new Error('missing_config');
 const client=createClient(Deno.env.get('SUPABASE_URL')!,secret,{auth:{persistSession:false}});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const ip=(req.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim();
 const {data,error}=await client.rpc('submit_talent_application',{p_id:input.request_id,p_name:input.name,p_phone:input.phone,p_email:input.email,p_education:input.education,p_coaching:input.coaching,p_availability:input.availability,p_feedback:input.feedback,p_responsibility:input.responsibility,p_experience:input.experience,p_strength:input.strength,p_approach:input.approach,p_contact_hash:await hash('phone:'+input.phone),p_ip_hash:await hash('ip:'+ip)});
 if(error)return reply({ok:false,code:error.message.includes('rate_limited')?'rate_limited':'unavailable'},error.message.includes('rate_limited')?429:503);
 return reply({ok:true,receipt:data});
 }catch{return reply({ok:false,code:'unavailable'},503);}
}
if(import.meta.main)Deno.serve(handler);

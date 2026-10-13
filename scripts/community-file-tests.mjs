// 실제 파일 함수의 요청 처리를 실행하되 인증·스토리지 네트워크는 모형으로 대체한다.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const file=fileURLToPath(new URL('../supabase/functions/community-file/index.ts',import.meta.url));
const uid='00000000-0000-4000-8000-000000000011',id='11111111-1111-4111-8111-111111111111',p=uid+'/'+id+'.pdf';
let handler,state;
function reset(extra={}){state={calls:[],deleted:[],uploaded:[],...extra};}
const client={auth:{getUser:async token=>({data:{user:token==='member-token'?{id:uid}:null},error:null})},rpc:async(fn,args)=>{
 state.calls.push({fn,args});
 if(fn==='community_member')return{data:{item:state.noProfile?null:{blocked:false}},error:null};
 if(fn==='community_asset_create')return{data:id,error:state.registrationError?{message:'기록 오류'}:null};
 if(fn==='community_asset_access')return{data:{path:state.badPath?'../secret':p,mime:'application/pdf',kind:'proof',title:'가상 파일'},error:state.denied?{message:'forbidden'}:null};
 if(fn==='community_cleanup_candidates')return{data:state.cleaned?[]:[{id,path:p}],error:null};
 if(fn==='community_assets_mark_deleted')state.cleaned=true;
 return{data:null,error:state.markError?{message:'기록 오류'}:null};
},storage:{from:()=>({upload:async(path,bytes,opts)=>{state.uploaded.push({path,bytes,opts});return{error:state.uploadError?{}:null};},remove:async paths=>{state.deleted.push(...paths);return{error:state.removeError?{}:null};},createSignedUrl:async(path,ttl)=>{state.ttl=ttl;return{data:{signedUrl:'https://example.invalid/signed'},error:null};}})}};
const source=(await fs.readFile(file,'utf8')).replace(/^import[^\n]+\n/m,'');
vm.runInNewContext(stripTypeScriptTypes(source),{createClient:()=>client,Deno:{serve:fn=>handler=fn,env:{get:key=>({SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'service-token',SUPABASE_ANON_KEY:'anon-token'})[key]}},Response,Request,FormData,File,Uint8Array,TextDecoder,crypto});
const call=async(body,token='member-token',headers={})=>{
 const form=body instanceof FormData;
 const r=await handler(new Request('https://example.invalid/community-file',{method:'POST',headers:{...(token?{authorization:'Bearer '+token}:{}),...(!form?{'Content-Type':'application/json'}:{}),...headers},body:form?body:JSON.stringify(body)}));
 return await r.json();
};
const upload=(bytes,kind='proof')=>{const f=new FormData();f.set('action','upload');f.set('kind',kind);f.set('title','가상 자료');f.set('scope','members');f.set('file',new File([bytes],'user-file.pdf'));return f;};
let count=0;
async function check(name,fn){reset();await fn();count++;process.stdout.write('통과: '+name+'\n');}
await check('배포 버전 조회는 인증·스토리지 호출 없이 반환',async()=>{assert.equal((await call({probe:true},null)).version,'2026-10-13a');assert.equal(state.calls.length,0);});
await check('로그아웃·삭제된 회원 토큰은 원본 접근 차단',async()=>{assert.equal((await call({action:'read',id},null)).code,'login_required');assert.equal((await call({action:'read',id},'invalid-token')).code,'login_required');assert.equal(state.calls.length,0);});
await check('클라이언트가 준 경로는 사용하지 않고 원장 권한 재확인',async()=>{state.denied=true;assert.equal((await call({action:'read',id,path:'fake.pdf'})).code,'forbidden');assert.equal(state.ttl,undefined);});
await check('짧은 서명 링크·경로 탈출 차단',async()=>{assert.equal((await call({action:'read',id})).ok,true);assert.equal(state.ttl,60);state.badPath=true;assert.equal((await call({action:'read',id})).code,'forbidden');});
await check('HTML 위장 파일·빈 텍스트·큰 파일은 업로드 차단',async()=>{assert.equal((await call(upload('<html>악성</html>'))).code,'bad_file_type');assert.equal((await call(upload('   ','text'))).code,'bad_file_type');assert.equal((await call(upload(new Uint8Array(8*1024*1024+1)))).code,'file_too_large');assert.equal(state.uploaded.length,0);});
await check('원본은 회원 경로·비공개 범위·덮어쓰기 금지',async()=>{assert.equal((await call(upload('%PDF-1.7 test'))).ok,true);assert.ok(state.uploaded[0].path.startsWith(uid+'/'));assert.equal(state.uploaded[0].opts.upsert,false);assert.equal(state.calls.find(c=>c.fn==='community_asset_create').args.p_scope,'private');});
await check('기록 실패는 업로드하지 않고 업로드 실패는 정리 대상으로 처리',async()=>{state.registrationError=true;assert.equal((await call(upload('%PDF-1.7 test'))).code,'asset_record_failed');assert.equal(state.uploaded.length,0);state.registrationError=false;state.uploadError=true;assert.equal((await call(upload('%PDF-1.7 test'))).code,'upload_failed');assert.ok(state.calls.some(c=>c.fn==='community_asset_expire'));});
await check('원본 삭제 실패를 성공으로 표시하지 않음',async()=>{state.removeError=true;assert.equal((await call({action:'delete',id})).code,'delete_failed');assert.ok(!state.calls.some(c=>c.fn==='community_asset_mark_deleted'));});
await check('자동 정리는 서비스 자격만 허용·삭제 후 기록',async()=>{assert.equal((await call({action:'cleanup'})).code,'bad_action');assert.equal((await call({action:'cleanup'},'service-token')).deleted,1);assert.deepEqual(state.deleted,[p]);assert.ok(state.calls.some(c=>c.fn==='community_assets_mark_deleted'));});
process.stdout.write(`완료: ${count}개 파일 함수 검사 통과\n`);

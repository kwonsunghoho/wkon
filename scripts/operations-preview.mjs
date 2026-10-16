// 로컬 합성 자료 전용. Supabase 설정과 원격 스크립트를 대체해 운영 호출을 막는다.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setup,ids} from './operations-test-db.mjs';
const {db,as,api,write,boot}=await setup();
const teacher=boot.staff.find(x=>x.member_id===ids[1]).id;
const owner=boot.me;
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());
await write('schedule_save',{dates:[date],category:'수업',title:'정규과정 · 면접 실습',body:'수업 자료와 진행 순서를 함께 확인합니다.',start_time:'14:00',end_time:'16:00',staff_ids:[teacher],expected:[]});
await write('schedule_save',{dates:[date],category:'상담',title:'신규 수강 상담',body:'상담 전 준비 내용을 확인합니다.',start_time:'17:00',end_time:'18:00',staff_ids:[owner],expected:[]});
await write('work_save',{type:'task',title:'다음 주 수업 자료 준비',body:'정규과정 면접 실습 자료를 정리해 주세요. 준비가 끝나면 검수를 요청해 주세요.',assignees:[owner],reviewer_id:teacher,due_date:date,recurrence:'weekly:5'});
await write('work_save',{type:'notice',title:'주말 수업 준비 안내',body:'수업 전 강의실과 준비물을 확인해 주세요.',assignees:[owner,teacher],reviewer_id:'',due_date:'',recurrence:''});
const root=process.cwd(),port=Number(process.env.PORT||5516);let queue=Promise.resolve();
const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://127.0.0.1:'+port);
 if(req.method==='POST'&&url.pathname==='/__rpc'){
  if(req.headers.origin!=='http://127.0.0.1:'+port)return json(res,{error:{message:'origin'}},403);
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>100000)throw Error('too_large');}
  const body=JSON.parse(raw);queue=queue.then(async()=>{try{await as(ids[body.role]||ids[0]);json(res,{data:await api(body.p_action,body.p),error:null});}catch(e){json(res,{data:null,error:{message:e.message,code:e.code}});}});await queue;return;
 }
 if(req.method!=='GET')return json(res,{},405);
 if(url.pathname==='/supabase-config.js'){
  const role=Number(url.searchParams.get('role')||0);
  res.writeHead(200,{'Content-Type':'text/javascript'});res.end(`window.MONC={requireSession:async()=>true,requireConsent:async()=>true,getSession:async()=>({user:{id:${JSON.stringify(ids[role]||ids[0])}}}),getMyProfile:async()=>({name:'로컬 테스트',role:'member'}),sb:{rpc:async(name,args)=>{if(name!=='operations_api')return {data:null,error:null};return (await fetch('/__rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...args,role:${role}})})).json();}}};`);return;
 }
 const relative=decodeURIComponent(url.pathname).replace(/^\//,'')||'operations.html';
 if(!/^(operations(?:-utils|-slots)?\.(html|js|css)|nav\.(js|css)|tokens\.css|inapp\.js|images\/[\w/.-]+|fonts\/[\w/.-]+)$/.test(relative)||relative.includes('..'))return json(res,{},404);
 let content=await fs.readFile(path.join(root,relative));
 if(relative==='operations.html')content=content.toString().replace(/<script src="https:\/\/cdn[^>]+><\/script>/g,'').replace('src="supabase-config.js"',`src="supabase-config.js?role=${Number(url.searchParams.get('role')||0)}"`).replace('<main id="main"',`<div style="position:fixed;bottom:0;z-index:99999;background:#19385f;color:white;font:12px sans-serif;padding:8px;width:100%;text-align:center">로컬 합성 자료 · <a style="color:white" href="?role=0">원장</a> / <a style="color:white" href="?role=1">가람 선생님</a> / <a style="color:white" href="?role=2">다온 선생님</a> / <a style="color:white" href="?role=3">학생</a></div><main id="main"`);
 const ext=path.extname(relative),type={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon'}[ext]||'application/octet-stream';
 res.writeHead(200,{'Content-Type':type+';charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; object-src 'none'; frame-src 'none'"});res.end(content);
 }catch(e){json(res,{error:{message:e.message}},500);}
});
server.listen(port,'127.0.0.1',()=>console.log('합성 운영 프리뷰 http://127.0.0.1:'+port+'/operations.html'));
process.on('SIGINT',async()=>{server.close();await db.close();process.exit();});

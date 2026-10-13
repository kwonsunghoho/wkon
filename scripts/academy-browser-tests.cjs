// Supabase 설정 스크립트 자체를 스텁으로 대체하고 외부 API를 차단한다.
const {createRequire}=require('node:module');
const requireRuntime=createRequire(process.env.ACADEMY_RUNTIME_MODULES+'/package.json');
const {chromium}=requireRuntime('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.cwd(),out=path.join(root,'outputs','academy-verification');fs.mkdirSync(out,{recursive:true});
for(const filename of ['submit.html','mypage.html','admin.html','academy.html','academy-desk.html']){
  const html=fs.readFileSync(path.join(root,filename),'utf8');
  for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){
    if(script[1].trim()&&!script[0].includes('application/ld+json'))new (require('node:vm').Script)(script[1],{filename});
  }
}
const fixture=String.raw`
window.__calls=[];window.__failDraft=false;window.__failUpload=false;window.__notReady=false;
const desk=location.pathname.includes('desk'),uid=desk?'teacher':'student';
let state='revision_requested',rev=3,body='손님이 기다리는 동안 진행 상황을 안내했습니다.\n그 뒤 다시 확인했습니다.',reviewRev=0,feedback='',suggestion='',savedNotes=[];
let versions=[{id:'v1',number:1,body:'손님이 기다리는 동안 진행 상황을 안내했습니다.\n그 뒤 다시 확인했습니다.',submitted_at:'2026-10-12T09:00:00Z',late:false,media:null,reviews:desk?[]:[{author_id:'teacher',author_name:'담당 선생님',body:'어떤 상황이었는지 한 문장을 보태 주세요. 행동은 구체적으로 잘 적었습니다.',suggestion:'',notes:[{quote:'그 뒤 다시 확인했습니다.',comment:'무엇을 확인했는지 적어 주세요.'}],decision:'revision_requested',published_at:'2026-10-13T00:00:00Z'}]}];
const task={id:'t1',title:'서비스 경험을 구체적으로 설명하기',prompt:'실제로 겪은 경험을 바탕으로 상황과 행동을 적어 주세요.',kind:'text',due_at:'2026-10-13T14:59:00Z'};
window.MONC={requireSession:async()=>({user:{id:uid}}),requireConsent:async()=>true,sb:{
auth:{getSession:async()=>({data:{session:{access_token:'local-stub'}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
rpc:async(action,args)=>{
 const a=args.p_action,p=args.p||{};window.__calls.push({a,p});
 if(window.__notReady)return {error:{code:'PGRST202'}};
 if(a==='bootstrap')return {data:{admin:desk,teacher:desk,courses:[{id:'c1',title:'정규반 · 10월',can_teach:desk}],enrollments:[{id:'e1',course_id:'c1',status:'active'}]}};
 if(a==='media_usage')return {data:{bytes:660000000,expired:0,failed:0}};
 if(a==='tasks'||a==='queue')return {data:{items:[{...task,task_id:'t1',enrollment_id:'e1',state:desk?'submitted':state,display_name:'테스트 학생',updated_at:task.due_at},{...task,id:'t2',task_id:'t2',title:'오늘의 음성 과제',kind:'audio',enrollment_id:'e1',state:'draft'}]}};
 if(a==='open'){if(p.task_id==='t2')return {data:{task:{...task,id:'t2',kind:'audio',title:'오늘의 음성 과제'},student:'테스트 학생',work:{id:'w2',revision:0,state:'draft',draft:''},versions:[],writable:true}};
 return {data:{task,student:'테스트 학생',work:{id:'w1',revision:rev,state:desk?'submitted':state,...(!desk?{draft:body}:{})},versions:JSON.parse(JSON.stringify(versions)),writable:!desk}};}
 if(a==='draft'){if(window.__failDraft)return {error:{code:'40001',message:'conflict'}};body=p.body;return {data:{revision:++rev}};}
 if(a==='submit'){state='submitted';versions.unshift({id:'v2',number:2,body:p.body,submitted_at:new Date().toISOString(),late:false,reviews:[],media:null});return {data:{id:'v2'}};}
 if(a==='review_save'){feedback=p.body;suggestion=p.suggestion;savedNotes=p.notes;return {data:{review_revision:++reviewRev}};}
 if(a==='review_publish'){versions[0].reviews.push({author_id:uid,author_name:'담당 선생님',body:p.body,suggestion:p.suggestion,notes:p.notes,published_at:new Date().toISOString(),decision:p.decision,revision:++reviewRev});return {data:{ok:true}};}
 if(a==='members')return {data:{items:[{id:'student',name:'테스트 학생',email:'student@example.invalid'}]}};
 return {data:{ok:true,id:'new',revision:++rev}};
},functions:{invoke:async(name,{body:b})=>{
 if(window.__failUpload)return {error:new Error('offline')};
 if(b.action==='prepare')return {data:{provider:'supabase',id:'m1',bucket:'academy-media',path:'student/m1',endpoint:'http://127.0.0.1/upload',token:'stub'}};
 if(b.action==='finish')return {data:{id:'m1',expires_at:'2026-12-13T00:00:00Z'}};
 return {data:{expired:true}};
}}}};
window.tus={Upload:class {constructor(file,options){this.options=options;}start(){this.options.onProgress(100,100);this.options.onSuccess();}}};
`;
new (require('node:vm').Script)(fixture);
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'})[ext]||'application/octet-stream');res.end(fs.readFileSync(file));}catch(_){res.writeHead(404);res.end();}
});
(async()=>{
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[],metrics=[];let forbidden=0;
async function page(width=375){const p=await browser.newPage({viewport:{width,height:900}});p.on('pageerror',e=>errors.push(e.message));
await p.route('**/*',route=>{
 const url=route.request().url();
 if(url.includes('supabase-config.js'))return route.fulfill({contentType:'text/javascript',body:fixture});
 if(url.includes('supabase.co')){forbidden++;return route.abort();}
 if(url.includes('supabase-js')||url.includes('tus-js-client'))return route.fulfill({contentType:'text/javascript',body:''});
 if(!url.startsWith(base))return route.abort();
 return route.continue();});return p;}
async function measure(p,label){await p.evaluate(async()=>{await document.fonts.ready;scrollTo(0,0);});const m=await p.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,smallInputs:[...document.querySelectorAll('main input,main textarea,main select')].filter(e=>e.getBoundingClientRect().height&&parseFloat(getComputedStyle(e).fontSize)<16).length,smallButtons:[...document.querySelectorAll('main button')].filter(e=>e.getBoundingClientRect().height>0&&e.getBoundingClientRect().height<44).length}));assert.equal(m.overflow,0,label);assert.equal(m.smallInputs,0);assert.equal(m.smallButtons,0);metrics.push({label,...m});}
const student=await page();await student.goto(base+'/academy.html');await student.getByRole('button',{name:/서비스 경험/}).click();
assert.match(await student.locator('.ac-review').innerText(),/무엇을 확인했는지/);
assert.equal(await student.locator('#acSubmit').innerText(),'제출');
await measure(student,'학생 수정 375');await student.screenshot({path:path.join(out,'student-375.png'),fullPage:true});
await student.locator('#acBody').fill('제가 겪은 상황을 보태 수정했습니다.');await student.locator('#acSave').click();await student.getByText('저장됨',{exact:true}).waitFor();
await student.locator('#acSubmit').click();await student.getByText('과제를 제출했어요.',{exact:true}).waitFor();assert.equal(await student.locator('#acBody').count(),0);
assert.equal((await student.evaluate(()=>__calls)).filter(x=>x.a==='submit').length,1);
assert.equal(await student.locator('#acSource').inputValue(),'제가 겪은 상황을 보태 수정했습니다.');
assert.equal(await student.locator('#acVersion').count(),0);assert.equal(await student.evaluate(()=>versions.length),2);
await student.locator('#acBack').click();await student.getByRole('button',{name:/오늘의 음성/}).click();
await student.locator('#acSubmit').click();await student.getByText('영상·음성 파일을 먼저 업로드해 주세요.',{exact:true}).waitFor();
await student.locator('#acFile').setInputFiles({name:'test.webm',mimeType:'audio/webm',buffer:Buffer.from('fixture')});
await student.getByText(/업로드 완료/).waitFor();await measure(student,'음성 업로드 375');await student.screenshot({path:path.join(out,'audio-375.png'),fullPage:true});
const teacher=await page();await teacher.goto(base+'/academy-desk.html');await teacher.getByRole('button',{name:/서비스 경험/}).click();
await teacher.locator('#acFeedback').fill('상황을 한 문장 보태고, 본인이 한 행동을 구체적으로 적어 주세요.');
assert.equal(await teacher.locator('#acSuggestion,#acSelectQuote,#acNotes,#acVersion').count(),0);
assert.equal(await teacher.locator('#acEditor textarea:not([readonly])').count(),1);
await teacher.locator('#acSave').click();await teacher.getByText('저장됨',{exact:true}).waitFor();
await measure(teacher,'선생님 피드백 375');await teacher.screenshot({path:path.join(out,'teacher-375.png'),fullPage:true});
for(const width of [768,1280]){await teacher.setViewportSize({width,height:900});await measure(teacher,'선생님 피드백 '+width);await teacher.screenshot({path:path.join(out,`teacher-${width}.png`),fullPage:true});}
await teacher.locator('#acRevision').click();await teacher.locator('#acMessage').getByText('학생에게 피드백을 전달했어요.',{exact:true}).waitFor();assert.equal(await teacher.locator('#acFeedback').count(),0);
const sent=await teacher.evaluate(()=>__calls.find(x=>x.a==='review_publish').p);
assert.equal(sent.body,'상황을 한 문장 보태고, 본인이 한 행동을 구체적으로 적어 주세요.');assert.equal(sent.suggestion,'');assert.deepEqual(sent.notes,[]);
const completed=await page();await completed.goto(base+'/academy-desk.html');await completed.getByRole('button',{name:/서비스 경험/}).click();
await completed.locator('#acFeedback').fill('경험과 행동이 잘 드러납니다. 수고하셨습니다.');await completed.getByRole('button',{name:'피드백 전달',exact:true}).click();
await completed.locator('#acMessage').getByText('학생에게 피드백을 전달했어요.',{exact:true}).waitFor();
assert.equal(await completed.evaluate(()=>__calls.find(x=>x.a==='review_publish').p.decision),'approved');
const conflict=await page(320);await conflict.goto(base+'/academy.html');await conflict.getByRole('button',{name:/서비스 경험/}).click();await conflict.evaluate(()=>__failDraft=true);await conflict.locator('#acBody').fill('충돌해도 이 글은 사라지면 안 됩니다.');await conflict.locator('#acSave').click();await conflict.getByText(/다른 화면에서 기록/).waitFor();assert.match(await conflict.locator('#acBody').inputValue(),/사라지면/);await measure(conflict,'충돌 320');await conflict.screenshot({path:path.join(out,'conflict-320.png'),fullPage:true});
const failed=await page();await failed.goto(base+'/academy.html');await failed.getByRole('button',{name:/오늘의 음성/}).click();await failed.evaluate(()=>__failUpload=true);
await failed.locator('#acFile').setInputFiles({name:'retry.webm',mimeType:'audio/webm',buffer:Buffer.from('fixture')});await failed.locator('#acRetryUpload').waitFor({state:'visible'});
await failed.evaluate(()=>__failUpload=false);await failed.locator('#acRetryUpload').click();await failed.getByText(/업로드 완료/).waitFor();
await failed.evaluate(()=>{
  const row={created_at:'2026-10-01T00:00:00Z'};
  if(MONC_MEDIA.challengeExpired(row,Date.parse('2026-10-14T23:59:59Z')))throw new Error('14일 전 조기 만료');
  if(!MONC_MEDIA.challengeExpired(row,Date.parse('2026-10-15T00:00:00Z')))throw new Error('14일 경계 만료 누락');
});
// 기존 마이페이지에 새 링크를 붙일 때 hidden이 flex 규칙에 덮이지 않는지 확인한다.
const entry=await page();await entry.setContent(fs.readFileSync(path.join(root,'mypage.html'),'utf8').replace(/<script\b[\s\S]*?<\/script>/gi,''));
assert.equal(await entry.locator('#academyEntry').isVisible(),false);await entry.evaluate(()=>document.getElementById('academyEntry').hidden=false);assert.equal(await entry.locator('#academyDeskEntry').isVisible(),false);
assert.deepEqual(errors,[]);assert.equal(forbidden,0,'운영 요청 없음');fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify({metrics,errors,productionRequests:forbidden},null,2));
console.log('PASS: 학생 저장·제출·최신 원문·이력 보존, 음성 업로드, 피드백 저장·공개, 충돌 보존, 320/375/768/1280 렌더, 운영 요청 0');
await browser.close();server.close();
})().catch(e=>{console.error(e);server.close();process.exit(1);});

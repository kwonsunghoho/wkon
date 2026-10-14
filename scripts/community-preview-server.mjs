// 운영 설정을 전혀 싣지 않는 로컬 확인 서버. 데이터는 메모리 PostgreSQL에만 남는다.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.argv.includes('--port')?process.argv[process.argv.indexOf('--port')+1]:5518);
const deps=process.argv[process.argv.indexOf('--deps')+1],source=process.argv[process.argv.indexOf('--source')+1];
if(!deps||!source)throw new Error('--deps, --source 경로가 필요합니다.');
const {PGlite}=await import(pathToFileURL(path.resolve(deps,'node_modules/@electric-sql/pglite/dist/index.js')));
const {pg_trgm}=await import(pathToFileURL(path.resolve(deps,'node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js')));
const db=new PGlite({extensions:{pg_trgm}});
const ids={owner:'00000000-0000-4000-8000-000000000011',member:'00000000-0000-4000-8000-000000000012',beginner:'00000000-0000-4000-8000-000000000013',admin:'00000000-0000-4000-8000-000000000021'};
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create schema extensions;
create table auth.users(id uuid primary key);create table public.members(id uuid primary key references auth.users(id) on delete cascade,name text,phone text,agreed_at timestamptz,terms_version text,role text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
insert into auth.users values ${Object.values(ids).map(v=>`('${v}')`).join(',')};
insert into public.members select id,'가상 회원','010-0000-0000',now(),'2026-10-05',case when id='${ids.admin}' then 'admin' else 'member' end from auth.users;`);
await db.exec(await fs.readFile(path.join(root,'supabase/migrations/20261013090000_community.sql'),'utf8'));
let chain=Promise.resolve();
function lock(task){const r=chain.then(task);chain=r.catch(()=>{});return r;}
async function rpc(who,fn,a,d={}){
  await db.exec(`reset role;set request.jwt.claim.sub='${ids[who]||''}';set role ${fn==='community_read'?'anon':'authenticated'};`);
  try{return (await db.query(`select public.${fn}($1,$2::jsonb) result`,[a,JSON.stringify(d)])).rows[0].result;}finally{await db.exec('reset role');}
}
const profiles={};
for(const [who,nickname] of Object.entries({owner:'하늘',member:'소담',beginner:'새봄',admin:'몬크 운영진'}))profiles[who]=(await rpc(who,'community_member','profile-save',{nickname,bio:'서로의 답변을 듣고 함께 성장하고 싶어요.',goals:'국내 항공사 객실승무원',schedule:'평일 저녁 · 주말 오전',mode:'서울·온라인',improve:'추가 질문을 자연스럽게 이어가는 연습',skills:['basic','experience','voice','feedback'],sample_scope:'organizer'})).item;
await rpc('admin','community_admin','assessment-save',{profile_id:profiles.member.id,level:2,skills:['voice','basic'],method:'test',date:'2026-10-13'});
const files=new Map();
const assetPath=ids.member+'/11111111-1111-4111-8111-111111111111.txt';
const sample=(await db.query('select public.community_asset_create($1,$2,$3,$4,$5,$6,$7) id',[ids.member,'text','자기소개 답변 샘플',assetPath,'text/plain',100,'members'])).rows[0].id;
files.set(assetPath,Buffer.from('안녕하세요. 함께하는 사람의 이야기를 끝까지 듣는 지원자입니다.\n이 문장은 화면 검증을 위한 가상 예시입니다.'));
const proofPath=ids.member+'/22222222-2222-4222-8222-222222222222.pdf';
const proofAsset=(await db.query('select public.community_asset_create($1,$2,$3,$4,$5,$6,$7) id',[ids.member,'proof','가상 인증',proofPath,'application/pdf',100,'private'])).rows[0].id;
files.set(proofPath,Buffer.from('%PDF-1.0 가상 문서'));
const proof=(await rpc('member','community_member','proof-submit',{airline:'예시항공',year:2026,stage:'임원면접 진출',asset_id:proofAsset})).id;
await rpc('admin','community_admin','proof-decide',{id:proof,decision:'approve'});
const ownerProofAsset=(await db.query('select public.community_asset_create($1,$2,$3,$4,$5,$6,$7) id',[ids.owner,'proof','모집자 가상 인증',ids.owner+'/33333333-3333-4333-8333-333333333333.pdf','application/pdf',100,'private'])).rows[0].id;
const ownerProof=(await rpc('owner','community_member','proof-submit',{airline:'예시항공',year:2026,stage:'면접 진출',asset_id:ownerProofAsset})).id;
await rpc('admin','community_admin','proof-decide',{id:ownerProof,decision:'approve'});
await rpc('admin','community_admin','assessment-save',{profile_id:profiles.owner.id,level:2,skills:['basic','voice'],method:'class',date:'2026-10-13'});
for(const p of [
 {category:'question',title:'지원서 경력, 오래된 아르바이트도 적으시나요?',body:'공고에는 최근 경력을 중심으로 작성하라고 되어 있네요. 여러분은 어떤 기준으로 정리하고 계신가요?',airline:'국내항공',stage:'지원서'},
 {topic:'hair',category:'info',title:'헤메&샵 정보 같이 정리해요',body:'면접일 예약할 때 소요 시간과 이동 거리를 같이 확인하면 좋겠어요. 직접 이용한 후기는 댓글로 남겨 주세요.'},
 {category:'free',title:'면접 준비하다가 지칠 때 어떻게 쉬세요?',body:'이번 주는 잠깐 쉬고 다시 답변을 정리하려고요. 준비하는 분들과 이야기 나누고 싶어요.'},
 {category:'question',title:'영상면접에서 시선 처리 어떻게 하시나요?',body:'카메라를 보는 것과 화면을 보는 것 사이에서 시선이 자꾸 흔들리네요. 같이 경험을 나눠 주세요.',airline:'국내항공',stage:'영상면접'},
 {category:'info',title:'스터디룸 예약 전 확인할 것',body:'인원, 거울, 소음, 촬영 가능 여부를 미리 확인하면 모임 진행이 편해집니다.'}
].reverse()) {const id=(await rpc('owner','community_member','post-save',p)).id;await rpc('member','community_member','comment-save',{post_id:id,body:'저도 궁금했어요. 공고 기준을 먼저 확인하고 같이 정리해 보아요.'});}
for(const s of [
 {title:'국내항공 실전 답변 스터디',goals:'경험답변 · 추가 질문',mode:'offline',location:'서울 강남',schedule:'매주 화·목 오후 7시',capacity:4,min_level:2,require_experience:true,required_skills:['basic','voice']},
 {title:'주말 온라인 영상면접 스터디',goals:'시선·속도·전달력',mode:'online',schedule:'토요일 오전 10시',capacity:5,min_level:0,required_skills:['basic']},
 {title:'기본 답변부터 함께 준비해요',goals:'자기소개 · 지원동기',mode:'offline',location:'서울 홍대',schedule:'일요일 오후 2시',capacity:4,min_level:0,required_skills:[]}
].reverse()){await rpc('owner','community_member','study-save',{...s,description:'각자 준비한 답변을 나누고 서로 추가 질문과 피드백을 주고받습니다. 시간에 맞춰 참여해 주세요.'});}
const stub=`<script>
const who=new URLSearchParams(location.search).get('as')||'member';
const uid=${JSON.stringify(ids)}[who];
const session=uid?{user:{id:uid,user_metadata:{name:'가상 회원'}}}:null;
async function localRpc(fn,data){try{const r=await fetch('/__api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({who,fn,...data})});return await r.json();}catch(e){return{data:null,error:{message:e.message}};}}
window.MONC={getSession:async()=>session,getMyProfile:async()=>session?{name:'가상 회원',role:who==='admin'?'admin':'member'}:null,requireConsent:async()=>!!session,requireAdmin:async()=>who==='admin'?{role:'admin'}:null,sb:{rpc:localRpc,functions:{invoke:async(fn,{body})=>{const form=body instanceof FormData;const r=await fetch('/__api/file?who='+who,{method:'POST',headers:form?{}:{'Content-Type':'application/json'},body:form?body:JSON.stringify(body)});return await r.json();}}}};
</script>`;
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
const json=(res,v)=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(v));};
const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/board.html'||url.pathname==='/selected.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(await fs.readFile(path.join(root,'scripts/'+(url.pathname==='/selected.html'?'community-home-preview.html':'community-preview-board.html')),'utf8'));return;}
  if(url.pathname==='/__api/rpc') {const chunks=[];for await(const c of req){chunks.push(c);if(Buffer.concat(chunks).length>100000)throw new Error('요청 크기');}const data=JSON.parse(Buffer.concat(chunks));if(!['community_read','community_member','community_admin'].includes(data.fn))throw new Error('함수 이름');try{const r=await lock(()=>rpc(data.who,data.fn,data.p_action,data.p_data));json(res,{data:r,error:null});}catch(e){json(res,{data:null,error:{message:e.message,code:e.code}});}return;}
  if(url.pathname==='/__api/file') {const request=new Request(url,{method:'POST',headers:req.headers,body:req,duplex:'half'}),isForm=req.headers['content-type']?.includes('multipart/form-data');const form=isForm?await request.formData():null,data=form?Object.fromEntries(form):await request.json(),who=url.searchParams.get('who');try{const result=await lock(async()=>{
    if(!ids[who])throw new Error('community:login_required');
    if(data.action==='upload'){const b=Buffer.from(await form.get('file').arrayBuffer()),kind=data.kind,extension={proof:'pdf',text:'txt',audio:'mp3',video:'mp4'}[kind];const p=ids[who]+'/'+crypto.randomUUID()+'.'+extension;const id=(await db.query('select public.community_asset_create($1,$2,$3,$4,$5,$6,$7) id',[ids[who],kind,data.title,p,form.get('file').type||'text/plain',b.length,data.scope])).rows[0].id;files.set(p,b);return{ok:true,id};}
    const a=(await db.query('select public.community_asset_access($1,$2,$3) item',[ids[who],data.id,data.action==='delete'])).rows[0].item;
    if(data.action==='delete'){files.delete(a.path);await db.query('select public.community_asset_mark_deleted($1)',[data.id]);return{ok:true};}
    const token=crypto.randomUUID();downloads.set(token,{path:a.path,until:Date.now()+60000});return{ok:true,url:'http://127.0.0.1:'+port+'/__file/'+token,mime:a.mime,kind:a.kind,title:a.title};
  });json(res,{data:result,error:null});}catch(e){json(res,{data:{ok:false,code:e.message},error:null});}return;}
  if(url.pathname.startsWith('/__file/')){const d=downloads.get(url.pathname.split('/').pop());if(!d||d.until<Date.now()||!files.has(d.path)){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(files.get(d.path));return;}
  if(url.pathname==='/'||url.pathname==='/index.html') {
    const original=await fs.readFile(path.join(root,'index.html'),'utf8');
    const blocks=Array.from(original.matchAll(/<script(?:\s[^>]*)?>([^]*?)<\/script>/g)).map(x=>x[1]);
    const visual=blocks.filter(x=>x.includes('히어로 — MONC 조립 애니메이션')||x.includes("bar.classList.add('is-intro')")).join('\n');
    if(!visual||/fetch\(|sendBeacon\(|MONC\.sb|sb\.from/.test(visual))throw new Error('시각 스크립트 확인');
    let html=original.replace(/<script\b[^>]*>[^]*?<\/script>/g,'');
    html=html.replace('</head>','<meta name="robots" content="noindex,nofollow"><style>.reveal{opacity:1!important;transform:none!important}</style><script src="nav.js" defer></script><script src="community-home.js" defer></script></head>').replace('<body>','<body>'+stub).replace('</body>','<script>'+visual+'</script></body>');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;
  }
  if(url.pathname==='/community.html') {const html=(await fs.readFile(path.join(root,'community.html'),'utf8')).replace(/<script[^>]+src="(?:https:\/\/cdn[^\"]+|supabase-config\.js)"[^>]*><\/script>/g,'').replace('<body>','<body>'+stub);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;}
  // 공용 메뉴 변경을 대표 화면의 원본 스타일에 겹쳐 확인한다. 회원·운영 스크립트는 실행하지 않는다.
  if(['/tools.html','/lab.html','/challenges.html','/login.html','/mypage.html','/lectures.html','/sojae.html','/polish.html','/answers.html','/lab-airline.html','/news.html','/games.html','/researchers.html','/reviews.html'].includes(url.pathname)) {
    const original=await fs.readFile(path.join(source,url.pathname.slice(1)),'utf8');
    const navScript=original.includes('nav.css')?'<script src="nav.js" defer></script>':'';
    const html=original.replace(/<script\b[^>]*>[^]*?<\/script>/g,'').replace(/<body([^>]*)>/,'<body$1>'+stub).replace('</head>','<meta name="robots" content="noindex,nofollow">'+navScript+'</head>');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;
  }
  const name=decodeURIComponent(url.pathname).slice(1);if(name.includes('..')||name.includes('\\'))throw new Error('경로');
  const local=['community.js','community.css','community-home.js','community-home.css','nav.js','nav.css','index.css'];const shared=['tokens.css','inapp.js'];if(!local.includes(name)&&!shared.includes(name)&&!name.endsWith('.css')&&!name.startsWith('images/')&&!name.startsWith('fonts/')){res.writeHead(404);res.end();return;}
  const p=path.join(local.includes(name)?root:source,name);const content=await fs.readFile(p);res.writeHead(200,{'Content-Type':mime[path.extname(p)]||'application/octet-stream'});res.end(content);
}catch(e){res.writeHead(500);res.end('로컬 확인 서버 오류');}});
const downloads=new Map();server.listen(port,'127.0.0.1',()=>process.stdout.write('운영 호출이 차단된 확인 화면: http://127.0.0.1:'+port+'/selected.html\n'));

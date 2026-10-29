// 실제 화면에서 외부 SDK·회원 설정을 제거한 로컬 전용 검증 서버.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),pages=new Set(['course.html','classroom.html','classroom-watch.html']);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4','.txt':'text/plain; charset=utf-8','.ico':'image/x-icon'};
http.createServer((req,res)=>{
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end();}
 let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'course.html';}catch{res.writeHead(400);return res.end();}
 const file=path.resolve(root,name);
 if(!file.startsWith(root+path.sep)||name.includes('supabase-config')||path.extname(name)==='.html'&&!pages.has(name)){res.writeHead(403);return res.end('검증 화면에서 지원하지 않는 주소입니다.');}
 if(pages.has(name)){
  let html=fs.readFileSync(file,'utf8').replace(/<script\b[^>]*src="(?:https:[^"]+|supabase-config\.js|pay-methods\.js[^\"]*)"[^>]*><\/script>/g,'');
  html=html.replace('<script src="nav.js"','<script src="scripts/online-course-fixture.js"></script><script src="nav.js"');
  res.writeHead(200,{'Content-Type':types['.html'],'Cache-Control':'no-store','Content-Security-Policy':"connect-src 'self'; media-src 'self' blob:; form-action 'none'"});return res.end(html);
 }
 fs.stat(file,(err,stat)=>{if(err||!stat.isFile()){res.writeHead(404);return res.end();}const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','Accept-Ranges':'bytes'};
  if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m){res.writeHead(416);return res.end();}const start=Number(m[1]),end=Math.min(m[2]?Number(m[2]):stat.size-1,stat.size-1);if(start>end){res.writeHead(416);return res.end();}res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${stat.size}`});fs.createReadStream(file,{start,end}).pipe(res);
  }else{res.writeHead(200,{...headers,'Content-Length':stat.size});fs.createReadStream(file).pipe(res);}
 });
}).listen(5521,'127.0.0.1',()=>console.log('비공개 기능 검증: http://127.0.0.1:5521/course.html'));

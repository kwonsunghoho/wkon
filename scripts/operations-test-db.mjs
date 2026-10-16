// 합성 자료 전용 PostgreSQL. 운영 Supabase에는 연결하지 않는다.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export const ids=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004'];
export async function setup(){
 const {PGlite}=await import(pathToFileURL(process.env.ACADEMY_PGLITE_MODULE).href);const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;
 create table public.members(id uuid primary key,name text,email text,role text,agreed_at timestamptz);
 create function public.is_admin() returns boolean language sql security definer set search_path='' as $$select exists(select 1 from public.members where id=auth.uid() and role='admin')$$;`);
 for(let i=0;i<4;i++)await db.query('insert into public.members values($1,$2,$3,$4,now())',[ids[i],['원장 · 테스트','가람 선생님 · 테스트','다온 선생님 · 테스트','학생 · 테스트'][i],`ops${i}@example.invalid`,i?'member':'admin']);
 const file=(await fs.readdir('supabase/migrations')).find(x=>x.endsWith('_academy_operations.sql'));await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
 async function as(uid=ids[0],role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role '+role);}
 async function api(a,p={}){return (await db.query('select public.operations_api($1,$2) result',[a,p])).rows[0].result;}
 async function write(a,p={}){return api(a,{...p,request_id:p.request_id||crypto.randomUUID()});}
 await as();await api('bootstrap');
 for(let i=1;i<3;i++)await write('staff_save',{member_id:ids[i],name:['','가람 선생님','다온 선생님'][i],active:true,schedule:i===1,work:true});
 const boot=await api('bootstrap');return {db,as,api,write,boot};
}

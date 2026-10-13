-- 게시판·스터디·개인 프로필·인증. 원본과 개인정보는 비공개 스키마/버킷에 보관한다.
begin;
create schema if not exists monc_community;
revoke all on schema monc_community from public, anon, authenticated;
grant usage on schema monc_community to service_role;
alter default privileges in schema monc_community revoke execute on functions from public;
create extension if not exists pg_trgm with schema extensions;

create table monc_community.profiles (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id) on delete cascade,
  nickname text not null check(char_length(nickname) between 2 and 16 and nickname !~ '[<>@]'),
  goals text not null default '' check(char_length(goals)<=100), bio text not null default '' check(char_length(bio)<=160),
  schedule text not null default '' check(char_length(schedule)<=100), mode text not null default '' check(char_length(mode)<=80),
  improve text not null default '' check(char_length(improve)<=200), skills text[] not null default '{}',
  sample_scope text not null default 'organizer' check(sample_scope in ('private','organizer','members')),
  blocked boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index community_nickname_unique on monc_community.profiles(lower(nickname));
create table monc_community.posts (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null,
  nickname text not null, category text not null check(category in ('question','info','free')),
  title text not null check(char_length(title) between 2 and 100), body text not null check(char_length(body) between 2 and 10000),
  airline text not null default '' check(char_length(airline)<=40), recruit_year integer check(recruit_year between 2000 and 2100),
  stage text not null default '' check(char_length(stage)<=50), source_url text not null default '' check(char_length(source_url)<=2000 and (source_url='' or source_url ~ '^https://[^[:space:]<>]+$')),
  status text not null default 'published' check(status in ('published','hidden','deleted')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table monc_community.comments (
  id uuid primary key default gen_random_uuid(), post_id uuid not null references monc_community.posts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, nickname text not null,
  body text not null check(char_length(body) between 1 and 3000), parent_id uuid references monc_community.comments(id) on delete set null,
  status text not null default 'published' check(status in ('published','hidden','deleted')), created_at timestamptz not null default now()
);
create table monc_community.bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade, post_id uuid not null references monc_community.posts(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(user_id,post_id)
);
create table monc_community.assets (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null,
  kind text not null check(kind in ('proof','text','audio','video')), title text not null check(char_length(title) between 1 and 100),
  storage_path text not null unique, mime text not null, size_bytes integer not null check(size_bytes>0 and size_bytes<=52428800),
  scope text not null default 'private' check(scope in ('private','organizer','members')),
  state text not null default 'ready' check(state in ('ready','deleted')), created_at timestamptz not null default now(), expires_at timestamptz,
  check(kind<>'proof' or scope='private')
);
create table monc_community.proof_requests (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  airline text not null check(char_length(airline) between 1 and 40), recruit_year integer not null check(recruit_year between 2000 and 2100),
  stage text not null check(char_length(stage) between 1 and 60), asset_id uuid not null references monc_community.assets(id),
  status text not null default 'pending' check(status in ('pending','approved','rejected','withdrawn')),
  note text not null default '' check(char_length(note)<=500), reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), reviewed_at timestamptz, unique(asset_id)
);
create table monc_community.certificates (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null unique references monc_community.proof_requests(id) on delete cascade,
  airline text not null, recruit_year integer not null, stage text not null, active boolean not null default true, verified_at timestamptz not null default now()
);
create table monc_community.assessments (
  user_id uuid primary key references auth.users(id) on delete cascade, level integer not null check(level between 1 and 3),
  confirmed_skills text[] not null default '{}', method text not null check(method in ('class','test')),
  assessed_at date not null, valid_until date, active boolean not null default true,
  assessed_by uuid references auth.users(id) on delete set null, note text not null default '' check(char_length(note)<=500),
  updated_at timestamptz not null default now(), check(valid_until is null or valid_until>=assessed_at)
);
create table monc_community.studies (
  id uuid primary key default gen_random_uuid(), owner_id uuid references auth.users(id) on delete set null,
  title text not null check(char_length(title) between 4 and 100), goals text not null default '' check(char_length(goals)<=100),
  mode text not null check(mode in ('online','offline')), location text not null default '' check(char_length(location)<=100),
  schedule text not null check(char_length(schedule) between 2 and 100), description text not null check(char_length(description) between 10 and 5000),
  member_guide text not null default '' check(char_length(member_guide)<=1500),
  capacity integer not null check(capacity between 2 and 12), min_level integer not null default 0 check(min_level between 0 and 3),
  require_experience boolean not null default false, required_skills text[] not null default '{}',
  status text not null default 'open' check(status in ('open','closed','hidden')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(mode<>'offline' or char_length(location)>0)
);
create table monc_community.study_members (
  study_id uuid not null references monc_community.studies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, role text not null check(role in ('owner','member')),
  joined_at timestamptz not null default now(), primary key(study_id,user_id)
);
create unique index community_one_study_owner on monc_community.study_members(study_id) where role='owner';
create table monc_community.applications (
  id uuid primary key default gen_random_uuid(), study_id uuid not null references monc_community.studies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, message text not null check(char_length(message) between 8 and 1500),
  status text not null default 'pending' check(status in ('pending','accepted','rejected','withdrawn','closed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(study_id,user_id)
);
create table monc_community.notices (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null, title text not null, target_id uuid, read_at timestamptz, created_at timestamptz not null default now()
);
create table monc_community.reports (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check(target_type in ('post','comment','study')), target_id uuid not null,
  reason text not null check(char_length(reason) between 2 and 1000), status text not null default 'pending' check(status in ('pending','resolved')),
  decision text, created_at timestamptz not null default now(), resolved_at timestamptz, unique(user_id,target_type,target_id)
);
create table monc_community.audit (
  id bigint generated always as identity primary key, actor_id uuid references auth.users(id) on delete set null,
  action text not null, target_id uuid, created_at timestamptz not null default now()
);
create index community_posts_cursor on monc_community.posts(created_at desc,id desc) where status='published';
create index community_comments_post on monc_community.comments(post_id,created_at,id);
create index community_studies_cursor on monc_community.studies(created_at desc,id desc);
create index community_application_owner on monc_community.applications(study_id,status,created_at);
create index community_notice_user on monc_community.notices(user_id,created_at desc);
create index community_asset_expiry on monc_community.assets(expires_at) where state='ready';
create index community_post_user on monc_community.posts(user_id,created_at desc);
create index community_comment_user on monc_community.comments(user_id,created_at desc);
create index community_application_user on monc_community.applications(user_id,created_at desc);
create index community_study_member_user on monc_community.study_members(user_id);
create index community_proof_queue on monc_community.proof_requests(status,created_at);
create index community_proof_user on monc_community.proof_requests(user_id,created_at desc);
create index community_certificate_user on monc_community.certificates(user_id) where active;
create index community_asset_user on monc_community.assets(user_id,kind) where state='ready';
-- 확장이 이미 설치된 경우도 실제 설치 스키마에서 연산자 클래스를 찾는다.
do $$ declare op_schema text; begin
  select n.nspname into op_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm';
  execute format('create index community_post_search on monc_community.posts using gin (lower(title||'' ''||body) %I.gin_trgm_ops)',op_schema);
  execute format('create index community_comment_search on monc_community.comments using gin (lower(body) %I.gin_trgm_ops)',op_schema);
  execute format('create index community_study_search on monc_community.studies using gin (lower(title||'' ''||goals||'' ''||description||'' ''||location||'' ''||schedule) %I.gin_trgm_ops)',op_schema);
end $$;

-- 비공개 테이블은 Data API로 직접 읽거나 수정하지 않는다.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='monc_community' loop
    execute format('alter table monc_community.%I enable row level security',t.tablename);
    execute format('revoke all on monc_community.%I from public,anon,authenticated',t.tablename);
    execute format('grant all on monc_community.%I to service_role',t.tablename);
  end loop;
end $$;

create function monc_community.actor(p_uid uuid default auth.uid()) returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
  if p_uid is null or not exists(select 1 from public.members m where m.id=p_uid and m.agreed_at is not null and nullif(m.phone,'') is not null) then
    raise exception 'community:login_required' using errcode='42501';
  end if;
  return p_uid;
end $$;
create function monc_community.admin(p_uid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.members where id=p_uid and role='admin');
$$;
create function monc_community.skills_valid(p_skills text[]) returns boolean language sql immutable set search_path='' as $$
  select cardinality(p_skills)<=8 and p_skills <@ array['basic','experience','voice','followup','situation','video','feedback','lead']::text[];
$$;
create function monc_community.skill_level(p_uid uuid) returns integer language sql stable security definer set search_path='' as $$
  select coalesce((select level from monc_community.assessments where user_id=p_uid and active and (valid_until is null or valid_until>=(now() at time zone 'Asia/Seoul')::date)),0);
$$;
create function monc_community.notify(p_uid uuid,p_kind text,p_title text,p_target uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_uid is not null then insert into monc_community.notices(user_id,kind,title,target_id) values(p_uid,p_kind,p_title,p_target); end if;
end $$;
create function monc_community.rate(p_uid uuid,p_action text,p_limit integer) returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_uid::text||p_action,0));
  if (select count(*) from monc_community.audit where actor_id=p_uid and action=p_action and created_at>now()-interval '1 hour')>=p_limit then
    raise exception 'community:rate_limited';
  end if;
  insert into monc_community.audit(actor_id,action) values(p_uid,p_action);
end $$;
create function monc_community.profile(p_uid uuid,p_viewer uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform monc_community.actor(p_viewer);
  select jsonb_build_object('id',p.id,'nickname',p.nickname,'goals',p.goals,'bio',p.bio,'schedule',p.schedule,'mode',p.mode,'improve',p.improve,'skills',p.skills,
    'sample_scope',p.sample_scope,'mine',p.user_id=p_viewer,'blocked',p.blocked,
    'certificates',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'airline',c.airline,'year',c.recruit_year,'stage',c.stage,'verified_at',c.verified_at) order by c.verified_at desc) from monc_community.certificates c where c.user_id=p.user_id and c.active),'[]'::jsonb),
    'assessment',(select jsonb_build_object('level',a.level,'skills',a.confirmed_skills,'method',a.method,'date',a.assessed_at,'valid_until',a.valid_until) from monc_community.assessments a where a.user_id=p.user_id and a.active and (a.valid_until is null or a.valid_until>=(now() at time zone 'Asia/Seoul')::date)),
    'samples',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'kind',s.kind,'scope',s.scope,'can_read',p.user_id=p_viewer or s.scope='members' or (s.scope='organizer' and exists(select 1 from monc_community.applications ap join monc_community.studies st on st.id=ap.study_id where ap.user_id=p.user_id and st.owner_id=p_viewer and ap.status in ('pending','accepted')))) order by s.created_at desc) from monc_community.assets s where s.user_id=p.user_id and s.kind<>'proof' and s.state='ready' and (s.expires_at is null or s.expires_at>now()) and (p.user_id=p_viewer or s.scope='members' or (s.scope='organizer' and exists(select 1 from monc_community.applications ap join monc_community.studies st on st.id=ap.study_id where ap.user_id=p.user_id and st.owner_id=p_viewer and ap.status in ('pending','accepted'))))),'[]'::jsonb)) into result
    from monc_community.profiles p where p.user_id=p_uid and (not p.blocked or p.user_id=p_viewer or monc_community.admin(p_viewer));
  return result;
end $$;
create function monc_community.study_json(p_study uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',s.id,'title',s.title,'goals',s.goals,'mode',s.mode,'location',s.location,'schedule',s.schedule,'description',s.description,
    'capacity',s.capacity,'min_level',s.min_level,'require_experience',s.require_experience,'required_skills',s.required_skills,'status',s.status,'created_at',s.created_at,
    'members',(select count(*) from monc_community.study_members where study_id=s.id),
    'experience_count',(select count(*) from monc_community.study_members m where m.study_id=s.id and exists(select 1 from monc_community.certificates c where c.user_id=m.user_id and c.active)),
    'skill_count',(select count(*) from monc_community.study_members m where m.study_id=s.id and monc_community.skill_level(m.user_id)>0))
  from monc_community.studies s where s.id=p_study;
$$;
create function monc_community.eligible(p_study uuid,p_uid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from monc_community.studies s join monc_community.profiles p on p.user_id=p_uid where s.id=p_study and not p.blocked
    and monc_community.skill_level(p_uid)>=s.min_level and s.required_skills<@p.skills
    and (not s.require_experience or exists(select 1 from monc_community.certificates c where c.user_id=p_uid and c.active)));
$$;

create function public.community_read(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q text:=left(trim(coalesce(p_data->>'q','')),120); pat text; items jsonb; lim integer:=least(30,greatest(1,coalesce((p_data->>'limit')::integer,20))); before_time timestamptz:=(p_data->>'before')::timestamptz; before_id uuid:=(p_data->>'before_id')::uuid; target uuid:=(p_data->>'id')::uuid;
begin
  pat:='%'||replace(replace(replace(lower(q),'\','\\'),'%','\%'),'_','\_')||'%';
  if p_action='posts' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id desc),'[]'::jsonb) into items from (
      select p.id,p.category,p.title,left(p.body,180) excerpt,p.nickname,p.airline,p.recruit_year,p.stage,p.created_at,p.updated_at,
      (select count(*) from monc_community.comments c where c.post_id=p.id and c.status='published') comments
      from monc_community.posts p where p.status='published'
      and (coalesce(p_data->>'category','')='' or p.category=p_data->>'category')
      and (coalesce(p_data->>'airline','')='' or p.airline=p_data->>'airline')
      and (before_time is null or (p.created_at,p.id)<(before_time,coalesce(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      and (q='' or lower(p.title||' '||p.body) like pat or exists(select 1 from monc_community.comments c where c.post_id=p.id and c.status='published' and lower(c.body) like pat))
      order by p.created_at desc,p.id desc limit lim+1
    ) t;
    return jsonb_build_object('ok',true,'items',items,'limit',lim);
  elsif p_action='thread' then
    select jsonb_build_object('id',p.id,'category',p.category,'title',p.title,'body',p.body,'nickname',p.nickname,'airline',p.airline,'year',p.recruit_year,'stage',p.stage,'source_url',p.source_url,'created_at',p.created_at,
      'comments',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'body',case when c.status='deleted' then '삭제된 댓글입니다.' else c.body end,'nickname',c.nickname,'parent_id',c.parent_id,'status',c.status,'created_at',c.created_at) order by c.created_at,c.id) from monc_community.comments c where c.post_id=p.id and c.status<>'hidden'),'[]'::jsonb)) into items
      from monc_community.posts p where p.id=target and p.status='published';
    return jsonb_build_object('ok',true,'item',items);
  elsif p_action='studies' then
    select coalesce(jsonb_agg(t.item order by t.created_at desc,t.id desc),'[]'::jsonb) into items from (
      select s.id,s.created_at,monc_community.study_json(s.id) item from monc_community.studies s where s.status='open'
      and (coalesce(p_data->>'mode','')='' or s.mode=p_data->>'mode')
      and (not coalesce((p_data->>'verified')::boolean,false) or s.min_level>0 or s.require_experience)
      and (q='' or lower(s.title||' '||s.goals||' '||s.description||' '||s.location||' '||s.schedule) like pat)
      and (before_time is null or (s.created_at,s.id)<(before_time,coalesce(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by s.created_at desc,s.id desc limit lim+1
    ) t;
    return jsonb_build_object('ok',true,'items',items,'limit',lim);
  elsif p_action='study' then
    return jsonb_build_object('ok',true,'item',(select monc_community.study_json(id) from monc_community.studies where id=target and status<>'hidden'));
  else raise exception 'community:bad_action'; end if;
end $$;
revoke all on function public.community_read(text,jsonb) from public;
grant execute on function public.community_read(text,jsonb) to anon,authenticated;

create function public.community_member(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=monc_community.actor(); target uuid:=(p_data->>'id')::uuid; profile_row monc_community.profiles%rowtype; st monc_community.studies%rowtype; ap monc_community.applications%rowtype; po monc_community.posts%rowtype; asset monc_community.assets%rowtype; result jsonb; ids text[]; target_user uuid;
begin
  select * into profile_row from monc_community.profiles where user_id=u;
  if p_action='profile' then
    target_user:=case when target is null then u else (select user_id from monc_community.profiles where id=target) end;
    return jsonb_build_object('ok',true,'item',monc_community.profile(target_user,u));
  elsif p_action='profile-save' then
    if coalesce(profile_row.blocked,false) then raise exception 'community:blocked'; end if;
    select coalesce(array_agg(distinct v),'{}') into ids from jsonb_array_elements_text(coalesce(p_data->'skills','[]')) v;
    if not monc_community.skills_valid(ids) then raise exception 'community:bad_skills'; end if;
    insert into monc_community.profiles(user_id,nickname,goals,bio,schedule,mode,improve,skills,sample_scope)
    values(u,trim(p_data->>'nickname'),trim(coalesce(p_data->>'goals','')),trim(coalesce(p_data->>'bio','')),trim(coalesce(p_data->>'schedule','')),trim(coalesce(p_data->>'mode','')),trim(coalesce(p_data->>'improve','')),ids,coalesce(p_data->>'sample_scope','organizer'))
    on conflict(user_id) do update set nickname=excluded.nickname,goals=excluded.goals,bio=excluded.bio,schedule=excluded.schedule,mode=excluded.mode,improve=excluded.improve,skills=excluded.skills,sample_scope=excluded.sample_scope,updated_at=now();
    return jsonb_build_object('ok',true,'item',monc_community.profile(u,u));
  elsif p_action='notices' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]'::jsonb) into result from(select id,kind,title,target_id,read_at,created_at from monc_community.notices where user_id=u order by created_at desc limit 50)t;
    return jsonb_build_object('ok',true,'items',result);
  elsif p_action='notice-read' then
    update monc_community.notices set read_at=now() where user_id=u and (target is null or id=target);
    return jsonb_build_object('ok',true);
  elsif p_action='activity' then
    return jsonb_build_object('ok',true,
      'posts',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'status',p.status,'created_at',p.created_at) order by p.created_at desc) from monc_community.posts p where user_id=u and status<>'deleted'),'[]'::jsonb),
      'comments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'excerpt',left(c.body,100)) order by c.created_at desc) from monc_community.comments c join monc_community.posts p on p.id=c.post_id where c.user_id=u and c.status='published' and p.status='published'),'[]'::jsonb),
      'bookmarks',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title)) from monc_community.bookmarks b join monc_community.posts p on p.id=b.post_id where b.user_id=u and p.status='published'),'[]'::jsonb),
      'applications',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'study_id',a.study_id,'title',s.title,'status',a.status,'created_at',a.created_at) order by a.created_at desc) from monc_community.applications a join monc_community.studies s on s.id=a.study_id where a.user_id=u),'[]'::jsonb),
      'studies',coalesce((select jsonb_agg(monc_community.study_json(m.study_id)||jsonb_build_object('role',m.role)) from monc_community.study_members m where m.user_id=u),'[]'::jsonb),
      'proofs',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'airline',r.airline,'year',r.recruit_year,'stage',r.stage,'status',r.status,'note',r.note,'created_at',r.created_at,'reviewed_at',r.reviewed_at) order by r.created_at desc) from monc_community.proof_requests r where r.user_id=u),'[]'::jsonb));
  elsif p_action='thread-state' then
    return jsonb_build_object('ok',true,'mine',exists(select 1 from monc_community.posts where id=target and user_id=u),'saved',exists(select 1 from monc_community.bookmarks where user_id=u and post_id=target),
      'own_comments',coalesce((select jsonb_agg(id) from monc_community.comments where post_id=target and user_id=u),'[]'::jsonb));
  elsif p_action='study-state' then
    select * into st from monc_community.studies where id=target and status<>'hidden';
    if not found then raise exception 'community:not_found'; end if;
    return jsonb_build_object('ok',true,'owner',st.owner_id=u,'joined',exists(select 1 from monc_community.study_members where study_id=target and user_id=u),'eligible',monc_community.eligible(target,u),
      'member_guide',case when exists(select 1 from monc_community.study_members where study_id=target and user_id=u) then st.member_guide else null end,
      'application',(select jsonb_build_object('id',id,'status',status) from monc_community.applications where study_id=target and user_id=u),
      'members',coalesce((select jsonb_agg(jsonb_build_object('profile',monc_community.profile(m.user_id,u),'role',m.role)) from monc_community.study_members m where m.study_id=target),'[]'::jsonb),
      'applications',case when st.owner_id=u then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'message',a.message,'status',a.status,'created_at',a.created_at,'profile',monc_community.profile(a.user_id,u)) order by a.created_at) from monc_community.applications a where a.study_id=target and a.status='pending'),'[]'::jsonb) else '[]'::jsonb end);
  end if;
  if p_action not in ('post-delete','comment-delete','application-withdraw','study-leave','study-close','asset-delete','proof-withdraw') then
    if profile_row.user_id is null then raise exception 'community:profile_required'; end if;
    if profile_row.blocked then raise exception 'community:blocked'; end if;
  end if;
  if p_action in ('post-save','comment-save','study-save','apply','proof-submit','report') then perform monc_community.rate(u,p_action,case when p_action='post-save' then 15 else 40 end); end if;
  if p_action='post-save' then
    if target is null then
      insert into monc_community.posts(user_id,nickname,category,title,body,airline,recruit_year,stage,source_url)
      values(u,profile_row.nickname,p_data->>'category',trim(p_data->>'title'),trim(p_data->>'body'),trim(coalesce(p_data->>'airline','')),(p_data->>'year')::integer,trim(coalesce(p_data->>'stage','')),trim(coalesce(p_data->>'source_url',''))) returning id into target;
    else
      update monc_community.posts set title=trim(p_data->>'title'),body=trim(p_data->>'body'),category=p_data->>'category',airline=trim(coalesce(p_data->>'airline','')),recruit_year=(p_data->>'year')::integer,stage=trim(coalesce(p_data->>'stage','')),source_url=trim(coalesce(p_data->>'source_url','')),updated_at=now() where id=target and user_id=u and status<>'deleted';
      if not found then raise exception 'community:forbidden'; end if;
    end if;
    return jsonb_build_object('ok',true,'id',target);
  elsif p_action='post-delete' then
    update monc_community.posts set title='삭제된 글',body='삭제된 글입니다.',status='deleted',source_url='',airline='',stage='',recruit_year=null,updated_at=now() where id=target and user_id=u;
    if not found then raise exception 'community:forbidden'; end if;
  elsif p_action='comment-save' then
    select * into po from monc_community.posts where id=(p_data->>'post_id')::uuid and status='published' for share;
    if not found then raise exception 'community:not_found'; end if;
    if p_data->>'parent_id' is not null and not exists(select 1 from monc_community.comments where id=(p_data->>'parent_id')::uuid and post_id=po.id and status='published') then raise exception 'community:bad_parent'; end if;
    insert into monc_community.comments(post_id,user_id,nickname,body,parent_id) values(po.id,u,profile_row.nickname,trim(p_data->>'body'),(p_data->>'parent_id')::uuid) returning id into target;
    if po.user_id<>u then perform monc_community.notify(po.user_id,'thread','내 글에 새 댓글이 달렸어요',po.id); end if;
    select user_id into target_user from monc_community.comments where id=(p_data->>'parent_id')::uuid;
    if target_user<>u and target_user is distinct from po.user_id then perform monc_community.notify(target_user,'thread','내 댓글에 답글이 달렸어요',po.id); end if;
    return jsonb_build_object('ok',true,'id',target);
  elsif p_action='comment-delete' then
    update monc_community.comments set body='삭제된 댓글입니다.',status='deleted' where id=target and user_id=u;
    if not found then raise exception 'community:forbidden'; end if;
  elsif p_action='bookmark' then
    if not exists(select 1 from monc_community.posts where id=target and status='published') then raise exception 'community:not_found'; end if;
    if coalesce((p_data->>'saved')::boolean,true) then insert into monc_community.bookmarks(user_id,post_id) values(u,target) on conflict do nothing;
    else delete from monc_community.bookmarks where user_id=u and post_id=target; end if;
  elsif p_action='study-save' then
    select coalesce(array_agg(distinct v),'{}') into ids from jsonb_array_elements_text(coalesce(p_data->'required_skills','[]')) v;
    if not monc_community.skills_valid(ids) then raise exception 'community:bad_skills'; end if;
    if target is not null then
      select * into st from monc_community.studies where id=target for update;
      if st.owner_id is distinct from u then raise exception 'community:forbidden'; end if;
      if st.status<>'open' then raise exception 'community:study_closed'; end if;
      if (p_data->>'capacity')::integer<(select count(*) from monc_community.study_members where study_id=target) then raise exception 'community:study_full'; end if;
      update monc_community.studies set title=trim(p_data->>'title'),goals=trim(coalesce(p_data->>'goals','')),mode=p_data->>'mode',location=trim(coalesce(p_data->>'location','')),schedule=trim(p_data->>'schedule'),description=trim(p_data->>'description'),capacity=(p_data->>'capacity')::integer,min_level=coalesce((p_data->>'min_level')::integer,0),require_experience=coalesce((p_data->>'require_experience')::boolean,false),required_skills=ids,updated_at=now() where id=target;
      if exists(select 1 from monc_community.study_members m where m.study_id=target and not monc_community.eligible(target,m.user_id)) then raise exception 'community:not_eligible'; end if;
      return jsonb_build_object('ok',true,'id',target);
    end if;
    insert into monc_community.studies(owner_id,title,goals,mode,location,schedule,description,capacity,min_level,require_experience,required_skills)
    values(u,trim(p_data->>'title'),trim(coalesce(p_data->>'goals','')),p_data->>'mode',trim(coalesce(p_data->>'location','')),trim(p_data->>'schedule'),trim(p_data->>'description'),(p_data->>'capacity')::integer,coalesce((p_data->>'min_level')::integer,0),coalesce((p_data->>'require_experience')::boolean,false),ids) returning id into target;
    if not monc_community.eligible(target,u) then raise exception 'community:not_eligible'; end if;
    insert into monc_community.study_members(study_id,user_id,role) values(target,u,'owner');
    return jsonb_build_object('ok',true,'id',target);
  elsif p_action='study-guide' then
    update monc_community.studies set member_guide=trim(coalesce(p_data->>'guide','')),updated_at=now() where id=target and owner_id=u;
    if not found then raise exception 'community:forbidden'; end if;
  elsif p_action='apply' then
    select * into st from monc_community.studies where id=target for update;
    if not found or st.status<>'open' then raise exception 'community:study_closed'; end if;
    if exists(select 1 from monc_community.study_members where study_id=target and user_id=u) then raise exception 'community:already_joined'; end if;
    if not monc_community.eligible(target,u) then raise exception 'community:not_eligible'; end if;
    if (select count(*) from monc_community.study_members where study_id=target)>=st.capacity then raise exception 'community:study_full'; end if;
    select * into ap from monc_community.applications where study_id=target and user_id=u;
    if ap.status='pending' then return jsonb_build_object('ok',true,'id',ap.id,'duplicate',true); end if;
    insert into monc_community.applications(study_id,user_id,message) values(target,u,trim(p_data->>'message'))
    on conflict(study_id,user_id) do update set message=excluded.message,status='pending',created_at=now(),updated_at=now() returning id into target;
    perform monc_community.notify(st.owner_id,'study','스터디에 새 지원이 들어왔어요',st.id);
    return jsonb_build_object('ok',true,'id',target);
  elsif p_action='application-decide' then
    select study_id into target_user from monc_community.applications where id=target;
    select * into st from monc_community.studies where id=target_user for update;
    if st.owner_id is distinct from u then raise exception 'community:forbidden'; end if;
    select * into ap from monc_community.applications where id=target for update;
    if ap.status<>'pending' then raise exception 'community:already_processed'; end if;
    if st.status<>'open' then raise exception 'community:study_closed'; end if;
    if p_data->>'decision'='accept' then
      if not monc_community.eligible(st.id,ap.user_id) then raise exception 'community:not_eligible'; end if;
      if (select count(*) from monc_community.study_members where study_id=st.id)>=st.capacity then raise exception 'community:study_full'; end if;
      insert into monc_community.study_members(study_id,user_id,role) values(st.id,ap.user_id,'member');
      update monc_community.applications set status='accepted',updated_at=now() where id=ap.id;
      perform monc_community.notify(ap.user_id,'study','스터디 참여가 승인됐어요',st.id);
    elsif p_data->>'decision'='reject' then
      update monc_community.applications set status='rejected',updated_at=now() where id=ap.id;
      perform monc_community.notify(ap.user_id,'study','스터디 지원 결과를 확인해 주세요',st.id);
    else raise exception 'community:bad_action'; end if;
  elsif p_action='application-withdraw' then
    select study_id into target_user from monc_community.applications where id=target and user_id=u;
    perform 1 from monc_community.studies where id=target_user for update;
    update monc_community.applications set status='withdrawn',updated_at=now() where id=target and user_id=u and status='pending';
    if not found then raise exception 'community:already_processed'; end if;
  elsif p_action='study-leave' then
    select * into st from monc_community.studies where id=target for update;
    if st.owner_id=u then raise exception 'community:transfer_required'; end if;
    delete from monc_community.study_members where study_id=target and user_id=u;
    update monc_community.applications set status='withdrawn',updated_at=now() where study_id=target and user_id=u and status='accepted';
  elsif p_action='study-transfer' then
    select * into st from monc_community.studies where id=target for update;
    if st.owner_id is distinct from u then raise exception 'community:forbidden'; end if;
    select user_id into target_user from monc_community.profiles where id=(p_data->>'profile_id')::uuid;
    if target_user is null or target_user=u or not exists(select 1 from monc_community.study_members where study_id=target and user_id=target_user) then raise exception 'community:bad_member'; end if;
    update monc_community.study_members set role='member' where study_id=target and user_id=u;
    update monc_community.study_members set role='owner' where study_id=target and user_id=target_user;
    update monc_community.studies set owner_id=target_user,updated_at=now() where id=target;
    perform monc_community.notify(target_user,'study','스터디 모집자 역할을 인계받았어요',target);
  elsif p_action='study-close' then
    select * into st from monc_community.studies where id=target for update;
    if st.owner_id is distinct from u then raise exception 'community:forbidden'; end if;
    update monc_community.studies set status='closed',updated_at=now() where id=target;
    for target_user in select user_id from monc_community.applications where study_id=target and status='pending' loop perform monc_community.notify(target_user,'study','지원한 스터디의 모집이 종료됐어요',target); end loop;
    update monc_community.applications set status='closed',updated_at=now() where study_id=target and status='pending';
  elsif p_action='asset-scope' then
    update monc_community.assets set scope=p_data->>'scope' where id=target and user_id=u and kind<>'proof' and state='ready';
    if not found then raise exception 'community:forbidden'; end if;
  elsif p_action='asset-delete' then
    update monc_community.assets set expires_at=now() where id=target and user_id=u and state='ready';
    if not found then raise exception 'community:forbidden'; end if;
    update monc_community.proof_requests set status='withdrawn',reviewed_at=now() where asset_id=target and status='pending';
  elsif p_action='proof-submit' then
    select * into asset from monc_community.assets where id=(p_data->>'asset_id')::uuid and user_id=u and kind='proof' and state='ready' and (expires_at is null or expires_at>now()) for update;
    if not found then raise exception 'community:bad_asset'; end if;
    insert into monc_community.proof_requests(user_id,airline,recruit_year,stage,asset_id) values(u,trim(p_data->>'airline'),(p_data->>'year')::integer,trim(p_data->>'stage'),asset.id) returning id into target;
    update monc_community.assets set expires_at=null where id=asset.id;
    return jsonb_build_object('ok',true,'id',target);
  elsif p_action='proof-withdraw' then
    update monc_community.proof_requests set status='withdrawn',reviewed_at=now() where id=target and user_id=u and status='pending' returning asset_id into target_user;
    if not found then raise exception 'community:already_processed'; end if;
    update monc_community.assets set expires_at=now() where id=target_user;
  elsif p_action='report' then
    if p_data->>'type'='post' and not exists(select 1 from monc_community.posts where id=target and status='published') then raise exception 'community:not_found';
    elsif p_data->>'type'='comment' and not exists(select 1 from monc_community.comments where id=target and status='published') then raise exception 'community:not_found';
    elsif p_data->>'type'='study' and not exists(select 1 from monc_community.studies where id=target and status<>'hidden') then raise exception 'community:not_found'; end if;
    insert into monc_community.reports(user_id,target_type,target_id,reason) values(u,p_data->>'type',target,trim(p_data->>'reason')) on conflict(user_id,target_type,target_id) do nothing;
  else raise exception 'community:bad_action'; end if;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.community_member(text,jsonb) from public,anon;
grant execute on function public.community_member(text,jsonb) to authenticated;

create function public.community_admin(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=monc_community.actor(); target uuid:=(p_data->>'id')::uuid; pr monc_community.proof_requests%rowtype; rp monc_community.reports%rowtype; target_user uuid; ids text[]; result jsonb;
begin
  if not monc_community.admin(u) then raise exception 'community:forbidden' using errcode='42501'; end if;
  if p_action='queue' then
    return jsonb_build_object('ok',true,
      'proofs',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from (select r.id,r.airline,r.recruit_year,r.stage,r.asset_id,r.status,r.created_at,p.nickname,p.id profile_id,m.name member_name from monc_community.proof_requests r join monc_community.profiles p on p.user_id=r.user_id join public.members m on m.id=r.user_id where r.status='pending' order by r.created_at limit 100)t),'[]'::jsonb),
      'reports',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from (select r.id,r.target_type,r.target_id,r.reason,r.created_at,p.nickname,
        case r.target_type when 'post' then (select title from monc_community.posts where id=r.target_id) when 'comment' then (select body from monc_community.comments where id=r.target_id) when 'study' then (select title from monc_community.studies where id=r.target_id) end content
        from monc_community.reports r join monc_community.profiles p on p.user_id=r.user_id where r.status='pending' order by r.created_at limit 100)t),'[]'::jsonb));
  elsif p_action='profiles' then
    select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from(select p.id,p.nickname,p.goals,p.blocked,monc_community.skill_level(p.user_id) level from monc_community.profiles p where lower(p.nickname) like '%'||lower(left(coalesce(p_data->>'q',''),60))||'%' order by p.created_at desc limit 50)t;
    return jsonb_build_object('ok',true,'items',result);
  elsif p_action='proof-decide' then
    select * into pr from monc_community.proof_requests where id=target for update;
    if not found or pr.status<>'pending' then raise exception 'community:already_processed'; end if;
    if p_data->>'decision'='approve' then
      if not exists(select 1 from monc_community.assets where id=pr.asset_id and state='ready' and (expires_at is null or expires_at>now())) then raise exception 'community:bad_asset'; end if;
      update monc_community.proof_requests set status='approved',note=coalesce(p_data->>'note',''),reviewed_by=u,reviewed_at=now() where id=target;
      insert into monc_community.certificates(user_id,request_id,airline,recruit_year,stage) values(pr.user_id,pr.id,pr.airline,pr.recruit_year,pr.stage);
      perform monc_community.notify(pr.user_id,'proof','면접 진출 경험이 확인됐어요',pr.id);
    elsif p_data->>'decision'='reject' then
      if char_length(trim(coalesce(p_data->>'note','')))<2 then raise exception 'community:reason_required'; end if;
      update monc_community.proof_requests set status='rejected',note=p_data->>'note',reviewed_by=u,reviewed_at=now() where id=target;
      perform monc_community.notify(pr.user_id,'proof','인증 신청 결과를 확인해 주세요',pr.id);
    else raise exception 'community:bad_action'; end if;
    update monc_community.assets set expires_at=now()+interval '30 days' where id=pr.asset_id;
  elsif p_action='assessment-save' then
    if (p_data->>'date')::date>(now() at time zone 'Asia/Seoul')::date then raise exception 'community:bad_date'; end if;
    select user_id into target_user from monc_community.profiles where id=(p_data->>'profile_id')::uuid;
    if target_user is null then raise exception 'community:not_found'; end if;
    select coalesce(array_agg(distinct v),'{}') into ids from jsonb_array_elements_text(coalesce(p_data->'skills','[]')) v;
    if not monc_community.skills_valid(ids) then raise exception 'community:bad_skills'; end if;
    insert into monc_community.assessments(user_id,level,confirmed_skills,method,assessed_at,valid_until,assessed_by,note)
    values(target_user,(p_data->>'level')::integer,ids,p_data->>'method',(p_data->>'date')::date,(nullif(p_data->>'valid_until',''))::date,u,coalesce(p_data->>'note',''))
    on conflict(user_id) do update set level=excluded.level,confirmed_skills=excluded.confirmed_skills,method=excluded.method,assessed_at=excluded.assessed_at,valid_until=excluded.valid_until,assessed_by=u,note=excluded.note,active=true,updated_at=now();
    perform monc_community.notify(target_user,'assessment','몬크 실력검증 결과가 반영됐어요',null);
  elsif p_action='assessment-revoke' then
    select user_id into target_user from monc_community.profiles where id=(p_data->>'profile_id')::uuid;
    update monc_community.assessments set active=false,updated_at=now() where user_id=target_user;
    perform monc_community.notify(target_user,'assessment','실력검증 상태가 변경됐어요',null);
  elsif p_action='certificate-revoke' then
    update monc_community.certificates set active=false where id=target returning user_id into target_user;
    if not found then raise exception 'community:not_found'; end if;
    perform monc_community.notify(target_user,'proof','경험 인증 상태가 변경됐어요',null);
  elsif p_action='report-resolve' then
    select * into rp from monc_community.reports where id=target for update;
    if not found or rp.status<>'pending' then raise exception 'community:already_processed'; end if;
    if p_data->>'decision'='hide' then
      if rp.target_type='post' then update monc_community.posts set status='hidden' where id=rp.target_id;
      elsif rp.target_type='comment' then update monc_community.comments set status='hidden' where id=rp.target_id;
      else update monc_community.studies set status='hidden' where id=rp.target_id; update monc_community.applications set status='closed',updated_at=now() where study_id=rp.target_id and status='pending'; end if;
    elsif p_data->>'decision'<>'dismiss' then raise exception 'community:bad_action'; end if;
    update monc_community.reports set status='resolved',decision=p_data->>'decision',resolved_at=now() where id=target;
  elsif p_action='member-block' then
    update monc_community.profiles set blocked=coalesce((p_data->>'blocked')::boolean,true) where id=(p_data->>'profile_id')::uuid;
  else raise exception 'community:bad_action'; end if;
  insert into monc_community.audit(actor_id,action,target_id) values(u,p_action,target);
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.community_admin(text,jsonb) from public,anon;
grant execute on function public.community_admin(text,jsonb) to authenticated;

-- 파일 함수만 사용하는 창구. 브라우저에는 파일 경로를 돌려주지 않는다.
create function public.community_asset_create(p_actor uuid,p_kind text,p_title text,p_path text,p_mime text,p_size integer,p_scope text default 'private') returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  perform monc_community.actor(p_actor);
  if not exists(select 1 from monc_community.profiles where user_id=p_actor and not blocked) or split_part(p_path,'/',1)<>p_actor::text then raise exception 'community:forbidden'; end if;
  perform monc_community.rate(p_actor,'asset-create',20);
  insert into monc_community.assets(user_id,kind,title,storage_path,mime,size_bytes,scope,expires_at)
  values(p_actor,p_kind,p_title,p_path,p_mime,p_size,case when p_kind='proof' then 'private' else p_scope end,now()+interval '7 days') returning id into result;
  return result;
end $$;
create function public.community_asset_access(p_actor uuid,p_id uuid,p_delete boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a monc_community.assets%rowtype;
begin
  perform monc_community.actor(p_actor);
  select * into a from monc_community.assets where id=p_id and state='ready';
  if not found or a.user_id is null or (a.expires_at is not null and a.expires_at<=now()) then raise exception 'community:not_found'; end if;
  if a.kind<>'proof' and a.user_id<>p_actor and exists(select 1 from monc_community.profiles where user_id=a.user_id and blocked) then raise exception 'community:forbidden'; end if;
  if p_delete then
    if a.user_id<>p_actor then raise exception 'community:forbidden'; end if;
  elsif a.kind='proof' then
    if a.user_id<>p_actor and not monc_community.admin(p_actor) then raise exception 'community:forbidden'; end if;
  elsif a.user_id<>p_actor and not (a.scope='members' or (a.scope='organizer' and exists(select 1 from monc_community.applications ap join monc_community.studies s on s.id=ap.study_id where ap.user_id=a.user_id and s.owner_id=p_actor and ap.status in ('pending','accepted')))) then raise exception 'community:forbidden'; end if;
  return jsonb_build_object('id',a.id,'path',a.storage_path,'mime',a.mime,'kind',a.kind,'title',a.title);
end $$;
create function public.community_asset_mark_deleted(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  update monc_community.assets set state='deleted',expires_at=now() where id=p_id;
  update monc_community.proof_requests set status='withdrawn',reviewed_at=now() where asset_id=p_id and status='pending';
end
$$;
create function public.community_assets_mark_deleted(p_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
begin
  if cardinality(p_ids)>100 then raise exception 'community:bad_request'; end if;
  update monc_community.assets set state='deleted',expires_at=now() where id=any(p_ids);
  update monc_community.proof_requests set status='withdrawn',reviewed_at=now() where asset_id=any(p_ids) and status='pending';
end $$;
create function public.community_asset_expire(p_id uuid) returns void language sql security definer set search_path='' as $$
  update monc_community.assets set expires_at=now() where id=p_id and state='ready';
$$;
create function public.community_asset_complete(p_id uuid) returns void language sql security definer set search_path='' as $$
  update monc_community.assets set expires_at=null where id=p_id and kind<>'proof' and state='ready' and expires_at>now();
$$;
create function public.community_cleanup_candidates() returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',storage_path)),'[]'::jsonb) from(select id,storage_path from monc_community.assets where state='ready' and expires_at<=now() order by expires_at limit 100)t;
$$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('community_asset_create','community_asset_access','community_asset_mark_deleted','community_assets_mark_deleted','community_asset_expire','community_asset_complete','community_cleanup_candidates') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

-- 계정 파기 직후 원본 접근을 차단하고 파일 정리 대상으로 넘긴다. 타인의 댓글은 보존한다.
create function monc_community.account_deleted() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update monc_community.posts set title='삭제된 글',body='삭제된 글입니다.',nickname='탈퇴한 회원',source_url='',airline='',stage='',recruit_year=null,status='deleted' where user_id=old.id;
  update monc_community.comments set body='삭제된 댓글입니다.',nickname='탈퇴한 회원',status='deleted' where user_id=old.id;
  update monc_community.studies set title='삭제된 스터디',goals='',location=case when mode='offline' then '비공개' else '' end,schedule='모집 종료',description='모집자가 탈퇴하여 종료된 스터디입니다.',member_guide='',status='closed' where owner_id=old.id;
  update monc_community.applications set status='closed',updated_at=now() where status='pending' and study_id in(select id from monc_community.studies where owner_id=old.id);
  update monc_community.assets set expires_at=now() where user_id=old.id and state='ready';
  return old;
end $$;
create trigger community_account_deleted before delete on auth.users for each row execute function monc_community.account_deleted();

insert into storage.buckets(id,name,public,file_size_limit) values('community-private','community-private',false,52428800) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit;
comment on schema monc_community is '커뮤니티 비공개 원장. 제한된 RPC만 사용하며 인증 원본·샘플은 공개 레포/공개 테이블에 넣지 않는다.';
commit;

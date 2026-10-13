-- 재학생 수업은 기존 무료 혜택/답변 프로그램과 별도 원장이다.
-- 비공개 스키마의 함수만 쓰기를 수행한다. 공개 RPC는 권한을 승격하지 않는다.
begin;
create schema if not exists academy_private;
revoke all on schema academy_private from public, anon, authenticated;
grant usage on schema academy_private to authenticated, service_role;

create table academy_private.courses (
  id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 1 and 120),
  created_at timestamptz not null default now()
);
create table academy_private.staff (
  course_id uuid not null references academy_private.courses, member_id uuid not null references public.members on delete cascade,
  primary key(course_id,member_id)
);
create index academy_staff_member on academy_private.staff(member_id);
create table academy_private.enrollments (
  id uuid primary key default gen_random_uuid(), course_id uuid not null references academy_private.courses,
  member_id uuid references public.members on delete cascade, display_name text not null check(length(display_name) between 1 and 80),
  starts_on date not null, ends_on date, status text not null default 'active' check(status in ('active','completed','revoked')),
  legacy_id text unique, check(ends_on is null or ends_on >= starts_on)
);
create index academy_enrollment_member on academy_private.enrollments(member_id,course_id);
create index academy_enrollment_course on academy_private.enrollments(course_id,status);
create unique index academy_enrollment_unique on academy_private.enrollments(course_id,member_id,starts_on) where member_id is not null;
create table academy_private.tasks (
  id uuid primary key default gen_random_uuid(), course_id uuid not null references academy_private.courses,
  title text not null check(length(title) between 1 and 160), prompt text not null default '' check(length(prompt)<=12000),
  kind text not null check(kind in ('text','video','audio')), due_at timestamptz not null,
  created_by uuid references public.members on delete set null, created_at timestamptz not null default now()
);
create index academy_task_course_due on academy_private.tasks(course_id,due_at desc,id);
create table academy_private.work (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references academy_private.tasks,
  enrollment_id uuid not null references academy_private.enrollments on delete cascade, draft text not null default '' check(length(draft)<=30000),
  revision integer not null default 0, state text not null default 'draft' check(state in ('draft','submitted','revision_requested','approved')),
  updated_at timestamptz not null default now(), unique(task_id,enrollment_id)
);
create index academy_work_enrollment on academy_private.work(enrollment_id);
create index academy_work_queue on academy_private.work(state,updated_at,id);
create table academy_private.media (
  id uuid primary key default gen_random_uuid(), owner_id uuid references public.members on delete set null,
  work_id uuid references academy_private.work on delete set null, scope text not null check(scope in ('academy','challenge')),
  provider text not null default 'supabase', bucket text not null, object_path text not null,
  name text not null, mime text not null, bytes bigint not null check(bytes between 0 and 52428800),
  status text not null default 'pending' check(status in ('pending','ready','deleting','deleted')),
  created_at timestamptz not null default now(), uploaded_at timestamptz, expires_at timestamptz not null,
  deleted_at timestamptz, lease_until timestamptz, lease_id uuid, attempts integer not null default 0, last_error text,
  unique(provider,bucket,object_path)
);
create index academy_media_cleanup on academy_private.media(expires_at) where status <> 'deleted';
create index academy_media_work on academy_private.media(work_id);
create table academy_private.versions (
  id uuid primary key default gen_random_uuid(), work_id uuid not null references academy_private.work on delete cascade,
  number integer not null, body text not null check(length(body)<=30000), media_id uuid references academy_private.media,
  request_id uuid not null unique, submitted_at timestamptz not null default now(), late boolean not null,
  unique(work_id,number)
);
create index academy_version_media on academy_private.versions(media_id);
create table academy_private.reviews (
  id uuid primary key default gen_random_uuid(), version_id uuid not null references academy_private.versions on delete cascade,
  author_id uuid references public.members on delete set null, body text not null default '' check(length(body)<=16000),
  suggestion text not null default '' check(length(suggestion)<=30000), notes jsonb not null default '[]',
  decision text check(decision in ('revision_requested','approved')), revision integer not null default 0,
  published_at timestamptz, updated_at timestamptz not null default now(), unique(version_id,author_id)
);
create index academy_review_author on academy_private.reviews(author_id);
-- 테이블은 Data API로 직접 노출하지 않는다. 기본 권한까지 명시적으로 회수한다.
do $$ declare n text; begin
  foreach n in array array['courses','staff','enrollments','tasks','work','media','versions','reviews'] loop
    execute format('alter table academy_private.%I enable row level security',n);
    execute format('revoke all on academy_private.%I from public, anon, authenticated',n);
  end loop;
end $$;

create function academy_private.can_teach(p_course uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (public.is_admin() or exists(
    select 1 from academy_private.staff where course_id=p_course and member_id=auth.uid()));
$$;
revoke all on function academy_private.can_teach(uuid) from public, anon, authenticated;

create function academy_private.dispatch(p_action text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid(); adm boolean := false; c uuid; eid uuid; wid uuid; vid uuid;
  w academy_private.work; t academy_private.tasks; e academy_private.enrollments;
  m academy_private.media; r academy_private.reviews; v academy_private.versions;
  result jsonb; n integer; offn integer := greatest(0,least(coalesce((p->>'offset')::integer,0),100000));
  teach boolean; writable boolean; note jsonb; stamp timestamptz := now();
begin
  -- 워커 액션은 service_role만 호출한다. 브라우저 JWT로는 접근할 수 없다.
  if p_action in ('cleanup_claim','cleanup_result') then
    if coalesce(auth.role(),'') <> 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
    if p_action='cleanup_claim' then
      -- 파일 업로드 후 제출 저장이 실패한 새 경로만 수거한다. 알 수 없는 구 경로는 건드리지 않는다.
      insert into academy_private.media(owner_id,scope,bucket,object_path,name,mime,bytes,status,expires_at)
      select u.id,'challenge','recordings',o.name,'미완료 제출',coalesce(o.metadata->>'mimetype','application/octet-stream'),
        least(coalesce((o.metadata->>'size')::bigint,0),52428800),'pending',stamp
      from storage.objects o left join public.members u on u.id::text=split_part(o.name,'/',1)
      where o.bucket_id='recordings' and o.created_at<stamp-interval '1 day'
        and o.name ~ '^[0-9a-f-]+/(voice|expression|spinning)-(before|after|before2)/[0-9a-f-]+\.[A-Za-z0-9]{1,8}$'
        and not exists(select 1 from academy_private.media a where a.bucket='recordings' and a.object_path=o.name)
      limit 50 on conflict(provider,bucket,object_path) do nothing;
      update academy_private.media a set expires_at=least(a.expires_at,stamp)
      where a.scope='academy' and a.status='ready' and a.uploaded_at<stamp-interval '1 day'
        and not exists(select 1 from academy_private.versions submitted where submitted.media_id=a.id);
      with candidates as (
        select id from academy_private.media where expires_at<=stamp and status<>'deleted'
          and (lease_until is null or lease_until<stamp) order by expires_at limit 50 for update skip locked
      ), claimed as (
        update academy_private.media x set status='deleting',lease_id=gen_random_uuid(),lease_until=stamp+interval '10 minutes',attempts=attempts+1
        from candidates y where x.id=y.id returning x.*
      ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed;
      return jsonb_build_object('items',result);
    end if;
    update academy_private.media set status=case when (p->>'ok')::boolean then 'deleted' else 'deleting' end,
      deleted_at=case when (p->>'ok')::boolean then stamp else null end,
      last_error=case when (p->>'ok')::boolean then null else left(p->>'error',300) end,
      lease_until=case when (p->>'ok')::boolean then null else stamp+interval '1 hour' end
      where id=(p->>'id')::uuid and lease_id=(p->>'lease_id')::uuid and status='deleting';
    return jsonb_build_object('ok',found);
  end if;
  if uid is null then raise exception 'login_required' using errcode='42501'; end if;
  if not exists(select 1 from public.members where id=uid and agreed_at is not null) then
    raise exception 'consent_required' using errcode='42501';
  end if;
  adm := public.is_admin();

  if p_action='bootstrap' then
    select jsonb_build_object('admin',adm,'teacher',adm or exists(select 1 from academy_private.staff where member_id=uid),
      'courses',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('can_teach',academy_private.can_teach(x.id)) order by x.title) from academy_private.courses x
         where academy_private.can_teach(x.id) or exists(select 1 from academy_private.enrollments y where y.course_id=x.id and y.member_id=uid and y.status<>'revoked')),'[]'),
      'enrollments',coalesce((select jsonb_agg(to_jsonb(y)) from academy_private.enrollments y where y.member_id=uid and y.status<>'revoked'),'[]')) into result;
    return result;
  end if;
  if p_action in ('create_course','enroll','set_staff','members','roster','media_usage') then
    if not adm then raise exception 'admin_required' using errcode='42501'; end if;
    if p_action='create_course' then
      insert into academy_private.courses(title) values(btrim(p->>'title')) returning id into c;
      return jsonb_build_object('id',c);
    elsif p_action='enroll' then
      insert into academy_private.enrollments(course_id,member_id,display_name,starts_on,ends_on)
      values((p->>'course_id')::uuid,(p->>'member_id')::uuid,btrim(p->>'name'),(p->>'starts_on')::date,nullif(p->>'ends_on','')::date) returning id into eid;
      return jsonb_build_object('id',eid);
    elsif p_action='set_staff' then
      if (p->>'enabled')::boolean then
        insert into academy_private.staff values((p->>'course_id')::uuid,(p->>'member_id')::uuid) on conflict do nothing;
      else delete from academy_private.staff where course_id=(p->>'course_id')::uuid and member_id=(p->>'member_id')::uuid; end if;
      return '{"ok":true}';
    elsif p_action='members' then
      if length(btrim(coalesce(p->>'query','')))<2 then return '{"items":[]}'; end if;
      select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
        select id,name,email from public.members where name ilike '%'||(p->>'query')||'%' or email ilike '%'||(p->>'query')||'%' order by name,id limit 20
      ) x; return jsonb_build_object('items',result);
    elsif p_action='roster' then
      select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
        select y.*,exists(select 1 from academy_private.staff s where s.course_id=y.course_id and s.member_id=y.member_id) as teacher
        from academy_private.enrollments y where course_id=(p->>'course_id')::uuid order by display_name,id limit 30 offset offn
      ) x; return jsonb_build_object('items',result);
    else
      select jsonb_build_object('bytes',coalesce(sum(bytes) filter(where status<>'deleted'),0),
        'expired',count(*) filter(where expires_at<=stamp and status<>'deleted'),
        'failed',count(*) filter(where last_error is not null and status<>'deleted')) into result from academy_private.media;
      return result;
    end if;
  end if;
  if p_action='create_task' then
    c:=(p->>'course_id')::uuid;
    if not academy_private.can_teach(c) then raise exception 'forbidden' using errcode='42501'; end if;
    insert into academy_private.tasks(course_id,title,prompt,kind,due_at,created_by)
      values(c,btrim(p->>'title'),coalesce(p->>'prompt',''),p->>'kind',(p->>'due_at')::timestamptz,uid) returning id into vid;
    return jsonb_build_object('id',vid);
  end if;
  if p_action='tasks' then
    select * into e from academy_private.enrollments where id=(p->>'enrollment_id')::uuid and member_id=uid and status<>'revoked';
    if not found then raise exception 'forbidden' using errcode='42501'; end if;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
      select a.*,b.id work_id,coalesce(b.state,'draft') state from academy_private.tasks a
      left join academy_private.work b on b.task_id=a.id and b.enrollment_id=e.id
      where a.course_id=e.course_id and (a.due_at at time zone 'Asia/Seoul')::date>=e.starts_on
        and (e.ends_on is null or (a.due_at at time zone 'Asia/Seoul')::date<=e.ends_on)
      order by a.due_at desc,a.id limit 30 offset offn
    ) x; return jsonb_build_object('items',result);
  end if;
  if p_action='queue' then
    c:=(p->>'course_id')::uuid;
    if not academy_private.can_teach(c) then raise exception 'forbidden' using errcode='42501'; end if;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
      select b.id,b.task_id,b.enrollment_id,b.state,b.updated_at,a.title,a.kind,y.display_name
      from academy_private.work b join academy_private.tasks a on a.id=b.task_id join academy_private.enrollments y on y.id=b.enrollment_id
      where a.course_id=c and y.status<>'revoked' and b.state<>'draft' and (coalesce(p->>'state','')='' or b.state=p->>'state')
      order by b.updated_at,b.id limit 30 offset offn
    ) x; return jsonb_build_object('items',result);
  end if;

  if p_action='media_path' then
    select * into m from academy_private.media where bucket='recordings' and object_path=p->>'path' and scope='challenge';
    if not found or not(adm or m.owner_id=uid) then raise exception 'forbidden' using errcode='42501'; end if;
    if m.expires_at<=stamp or m.status<>'ready' then return '{"expired":true}'; end if;
    return to_jsonb(m);
  end if;
  if p_action in ('media_read','media_finish') then
    select * into m from academy_private.media where id=(p->>'id')::uuid;
    if not found or m.scope<>'academy' then raise exception 'forbidden' using errcode='42501'; end if;
    wid:=m.work_id;
  elsif p_action='open' then
    select * into t from academy_private.tasks where id=(p->>'task_id')::uuid;
    select * into e from academy_private.enrollments where id=(p->>'enrollment_id')::uuid;
    if t.id is null or e.id is null or e.course_id<>t.course_id or e.status='revoked'
      or not(coalesce(e.member_id=uid,false) or academy_private.can_teach(t.course_id)) then raise exception 'forbidden' using errcode='42501'; end if;
    if (t.due_at at time zone 'Asia/Seoul')::date<e.starts_on or (e.ends_on is not null and (t.due_at at time zone 'Asia/Seoul')::date>e.ends_on) then
      raise exception 'outside_enrollment' using errcode='42501'; end if;
    insert into academy_private.work(task_id,enrollment_id) values(t.id,e.id) on conflict do nothing;
    select id into wid from academy_private.work where task_id=t.id and enrollment_id=e.id;
  else wid:=(p->>'work_id')::uuid; end if;
  select * into w from academy_private.work where id=wid for update;
  select * into t from academy_private.tasks where id=w.task_id;
  select * into e from academy_private.enrollments where id=w.enrollment_id;
  teach:=academy_private.can_teach(t.course_id);
  if w.id is null or e.status='revoked' or not(coalesce(e.member_id=uid,false) or teach) then raise exception 'forbidden' using errcode='42501'; end if;
  writable:=e.member_id=uid and e.status='active' and (stamp at time zone 'Asia/Seoul')::date>=e.starts_on
    and (e.ends_on is null or (stamp at time zone 'Asia/Seoul')::date<=e.ends_on);
  if p_action='open' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.number desc),'[]') into result from (
      select z.*, (select jsonb_build_object('id',a.id,'name',a.name,'mime',a.mime,'expires_at',a.expires_at,'status',a.status) from academy_private.media a where a.id=z.media_id) media,
      coalesce((select jsonb_agg(to_jsonb(q)||jsonb_build_object('author_name',coalesce(mm.name,'선생님')) order by q.updated_at)
        from academy_private.reviews q left join public.members mm on mm.id=q.author_id where q.version_id=z.id and (q.published_at is not null or q.author_id=uid)),'[]') reviews
      from academy_private.versions z where z.work_id=w.id order by z.number desc
    ) x;
    return jsonb_build_object('work',case when e.member_id=uid then to_jsonb(w) else to_jsonb(w)-'draft' end,
      'task',to_jsonb(t),'student',e.display_name,'writable',writable,'versions',result);
  end if;
  if p_action='media_read' then
    if m.status<>'ready' or m.expires_at<=stamp then return '{"expired":true}'; end if;
    if e.member_id<>uid and not exists(select 1 from academy_private.versions where media_id=m.id) then raise exception 'forbidden' using errcode='42501'; end if;
    return to_jsonb(m);
  end if;
  if p_action in ('draft','submit','media_prepare','media_finish') then
    if not coalesce(writable,false) then raise exception 'read_only' using errcode='42501'; end if;
    -- 네트워크 재시도는 제출 후 상태에서도 같은 제출 결과를 반환한다.
    if p_action='submit' then
      select * into v from academy_private.versions where request_id=(p->>'request_id')::uuid;
      if found then
        if v.work_id<>w.id then raise exception 'invalid_request'; end if;
        return jsonb_build_object('ok',true,'id',v.id);
      end if;
    end if;
    if w.state not in ('draft','revision_requested') then raise exception 'read_only' using errcode='42501'; end if;
    if p_action in ('draft','submit') and w.revision is distinct from (p->>'revision')::integer then raise exception 'conflict' using errcode='40001'; end if;
    if p_action='draft' then
      update academy_private.work set draft=coalesce(p->>'body',''),revision=revision+1,updated_at=stamp where id=w.id returning revision into n;
      return jsonb_build_object('revision',n);
    elsif p_action='media_prepare' then
      if t.kind not in ('video','audio') or split_part(p->>'mime','/',1)<>t.kind or (p->>'bytes')::bigint not between 1 and 52428800 then raise exception 'invalid_file'; end if;
      if (select count(*) from academy_private.media where work_id=w.id and status='pending' and expires_at>stamp)>=3 then raise exception 'too_many_uploads'; end if;
      vid:=gen_random_uuid();
      insert into academy_private.media(id,owner_id,work_id,scope,bucket,object_path,name,mime,bytes,expires_at)
      values(vid,uid,w.id,'academy','academy-media',uid::text||'/'||vid::text,left(p->>'name',240),p->>'mime',(p->>'bytes')::bigint,stamp+interval '1 day') returning * into m;
      return to_jsonb(m);
    elsif p_action='media_finish' then
      if m.owner_id<>uid or m.status not in ('pending','ready') or m.expires_at<=stamp then raise exception 'invalid_upload'; end if;
      if m.status='pending' then
        -- Storage API가 기록한 실제 파일 정보와 요청 크기를 비교한다.
        if not exists(select 1 from storage.objects o where o.bucket_id=m.bucket and o.name=m.object_path
          and (o.metadata->>'size')::bigint=m.bytes and split_part(o.metadata->>'mimetype','/',1)=t.kind) then raise exception 'upload_incomplete'; end if;
        update academy_private.media set status='ready',uploaded_at=stamp,
          expires_at=((stamp at time zone 'Asia/Seoul')+interval '2 months') at time zone 'Asia/Seoul' where id=m.id returning * into m;
      end if;
      return jsonb_build_object('id',m.id,'expires_at',m.expires_at);
    else
      if t.kind='text' and length(btrim(coalesce(p->>'body','')))=0 then raise exception 'empty_body'; end if;
      if t.kind<>'text' then
        select * into m from academy_private.media where id=(p->>'media_id')::uuid and work_id=w.id and owner_id=uid and status='ready' and expires_at>stamp for update;
        if not found then raise exception 'invalid_media'; end if;
      end if;
      select coalesce(max(number),0)+1 into n from academy_private.versions where work_id=w.id;
      insert into academy_private.versions(work_id,number,body,media_id,request_id,late)
      values(w.id,n,coalesce(p->>'body',''),case when t.kind='text' then null else m.id end,(p->>'request_id')::uuid,stamp>t.due_at) returning id into vid;
      update academy_private.work set draft=coalesce(p->>'body',''),state='submitted',revision=revision+1,updated_at=stamp where id=w.id;
      return jsonb_build_object('ok',true,'id',vid);
    end if;
  end if;
  if p_action in ('review_save','review_publish') then
    if not teach then raise exception 'forbidden' using errcode='42501'; end if;
    select * into v from academy_private.versions where work_id=w.id order by number desc limit 1;
    if v.id is distinct from (p->>'version_id')::uuid then raise exception 'new_version' using errcode='40001'; end if;
    select * into r from academy_private.reviews where version_id=v.id and author_id=uid for update;
    if r.published_at is not null then
      if p_action='review_publish' and r.body=coalesce(p->>'body','') and r.suggestion=coalesce(p->>'suggestion','')
        and r.notes=coalesce(p->'notes','[]') and r.decision=p->>'decision' then return '{"ok":true}'; end if;
      raise exception 'published_review_is_immutable';
    end if;
    if coalesce(r.revision,0) is distinct from (p->>'review_revision')::integer then raise exception 'conflict' using errcode='40001'; end if;
    if jsonb_typeof(coalesce(p->'notes','[]'))<>'array' or jsonb_array_length(coalesce(p->'notes','[]'))>100 then raise exception 'invalid_notes'; end if;
    for note in select value from jsonb_array_elements(coalesce(p->'notes','[]')) loop
      if coalesce(length(note->>'quote'),0)=0 or position(note->>'quote' in v.body)=0 or coalesce(length(note->>'comment'),0) not between 1 and 2000 then raise exception 'invalid_quote'; end if;
    end loop;
    if p_action='review_publish' and (w.revision is distinct from (p->>'revision')::integer or coalesce(p->>'decision','') not in ('approved','revision_requested')) then
      raise exception 'conflict' using errcode='40001'; end if;
    if p_action='review_publish' and length(btrim(coalesce(p->>'body','')))=0 then raise exception 'empty_feedback'; end if;
    insert into academy_private.reviews(version_id,author_id,body,suggestion,notes,revision,decision,published_at)
    values(v.id,uid,coalesce(p->>'body',''),coalesce(p->>'suggestion',''),coalesce(p->'notes','[]'),1,
      case when p_action='review_publish' then p->>'decision' end,case when p_action='review_publish' then stamp end)
    on conflict(version_id,author_id) do update set body=excluded.body,suggestion=excluded.suggestion,notes=excluded.notes,
      revision=academy_private.reviews.revision+1,decision=excluded.decision,published_at=excluded.published_at,updated_at=stamp returning * into r;
    if p_action='review_publish' then update academy_private.work set state=p->>'decision',revision=revision+1,updated_at=stamp where id=w.id; end if;
    return jsonb_build_object('review_revision',r.revision,'ok',true);
  end if;
  raise exception 'unknown_action';
end $$;
revoke all on function academy_private.dispatch(text,jsonb) from public, anon;
grant execute on function academy_private.dispatch(text,jsonb) to authenticated, service_role;
create function public.academy_api(p_action text,p jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select academy_private.dispatch(p_action,p); $$;
revoke all on function public.academy_api(text,jsonb) from public, anon;
grant execute on function public.academy_api(text,jsonb) to authenticated, service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('academy-media','academy-media',false,52428800,array['video/*','audio/*']) on conflict(id) do nothing;
-- academy-media는 인증된 서버가 발급하는 업로드/재생 서명만 허용한다. 공개 읽기 정책 없음.

-- 챌린지 제출물은 기존 표/피드백을 보존하고 보관 원장에 경로만 연결한다.
create function academy_private.track_challenge() returns trigger
language plpgsql security definer set search_path='' as $$
declare sent timestamptz; begin
  sent:=case when tg_table_name='challenge_submissions' then (to_jsonb(new)->>'updated_at')::timestamptz else new.created_at end;
  if tg_op='UPDATE' and new.storage_path=old.storage_path and sent=coalesce((to_jsonb(old)->>'updated_at')::timestamptz,old.created_at) then return new; end if;
  insert into academy_private.media(owner_id,scope,provider,bucket,object_path,name,mime,bytes,status,uploaded_at,expires_at)
  select new.member_id,'challenge','supabase','recordings',new.storage_path,'챌린지 제출물',coalesce(o.metadata->>'mimetype','application/octet-stream'),
    least(coalesce((o.metadata->>'size')::bigint,0),52428800),'ready',sent,sent+interval '14 days'
  from storage.objects o where o.bucket_id='recordings' and o.name=new.storage_path
  on conflict(provider,bucket,object_path) do nothing;
  return new;
end $$;
revoke all on function academy_private.track_challenge() from public,anon,authenticated;
create trigger academy_track_challenge after insert or update on public.challenge_submissions for each row execute function academy_private.track_challenge();
create trigger academy_track_legacy after insert or update on public.recordings for each row execute function academy_private.track_challenge();
insert into academy_private.media(owner_id,scope,bucket,object_path,name,mime,bytes,status,uploaded_at,expires_at)
select x.member_id,'challenge','recordings',x.storage_path,'챌린지 제출물',coalesce(o.metadata->>'mimetype','application/octet-stream'),
  least(coalesce((o.metadata->>'size')::bigint,0),52428800),'ready',x.sent,x.sent+interval '14 days'
from (select distinct on(storage_path) member_id,storage_path,sent from (
  select member_id,storage_path,updated_at sent from public.challenge_submissions union all select member_id,storage_path,created_at from public.recordings
) a order by storage_path,sent desc) x join storage.objects o on o.bucket_id='recordings' and o.name=x.storage_path
on conflict(provider,bucket,object_path) do nothing;

-- 만료 파일의 신규 서명 발급을 DB에서도 차단한다. 기존 소유자/admin 정책과 AND 결합한다.
create function academy_private.recording_access(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from academy_private.media where bucket='recordings' and object_path=p_path and status='ready' and expires_at>now());
$$;
revoke all on function academy_private.recording_access(text) from public,anon;
grant execute on function academy_private.recording_access(text) to authenticated;
create policy recordings_retention_read on storage.objects as restrictive for select to authenticated
using(bucket_id<>'recordings' or academy_private.recording_access(name));
-- 신규 제출은 불변 경로를 사용한다. 이전 클라이언트의 파일 덮어쓰기를 막아 삭제 워커와 경합하지 않는다.
drop policy if exists recordings_bucket_write_own on storage.objects;
drop policy if exists recordings_bucket_update_own on storage.objects;
create policy recordings_bucket_write_own on storage.objects for insert to authenticated with check (
  bucket_id='recordings' and (storage.foldername(name))[1]=auth.uid()::text
  and name ~ '^[0-9a-f-]+/(voice|expression|spinning)-(before|after|before2)/[0-9a-f-]+\.[A-Za-z0-9]{1,8}$'
  and (split_part((storage.foldername(name))[2],'-',2)<>'before2' or split_part((storage.foldername(name))[2],'-',1)='spinning')
  and public.is_challenge_participant(split_part((storage.foldername(name))[2],'-',1))
);
create policy recordings_no_overwrite on storage.objects as restrictive for update to authenticated
using(bucket_id<>'recordings') with check(bucket_id<>'recordings');
create function academy_private.challenge_submission_clock() returns trigger
language plpgsql set search_path='' as $$ begin
  if tg_op='INSERT' then new.created_at:=now(); new.updated_at:=now();
  elsif new.storage_path is distinct from old.storage_path then new.updated_at:=now();
  else new.updated_at:=old.updated_at; end if;
  return new;
end $$;
revoke all on function academy_private.challenge_submission_clock() from public,anon,authenticated;
create trigger zz_academy_submission_clock before insert or update on public.challenge_submissions
for each row execute function academy_private.challenge_submission_clock();
-- 탈퇴가 새 외래키 때문에 막히지 않게 한다. 학생 원문은 계정과 함께 지우고 파일은 정리 대상으로 넘긴다.
create function academy_private.member_removed() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  update academy_private.media set expires_at=least(expires_at,now()),owner_id=null,work_id=null,name='탈퇴 회원 파일'
    where owner_id=old.id;
  return old;
end $$;
revoke all on function academy_private.member_removed() from public,anon,authenticated;
create trigger academy_member_removed before delete on public.members for each row execute function academy_private.member_removed();
commit;

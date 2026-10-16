-- 학원 내부 운영 전용. 공개 테이블에 일정·업무 내용을 노출하지 않는다.
begin;
create schema operations_private;
revoke all on schema operations_private from public,anon,authenticated;
grant usage on schema operations_private to authenticated;
create table operations_private.staff (
 id uuid primary key default gen_random_uuid(), member_id uuid unique references public.members on delete set null,
 name text not null check(length(trim(name)) between 1 and 80), active boolean not null default true,
 schedule boolean not null default false, work boolean not null default false, legacy_key text unique,
 revision integer not null default 0
);
create table operations_private.schedule (
 id uuid primary key default gen_random_uuid(), series_id uuid not null, date date not null,
 category text not null check(category in ('상담','수업','행사','외부일정','기타')),
 title text not null check(length(trim(title)) between 1 and 160), body text not null default '' check(length(body)<=12000),
 start_time time, end_time time, staff_ids uuid[] not null default '{}', legacy_staff text not null default '',
 revision integer not null default 0, archived_at timestamptz, legacy_key text unique,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(end_time is null or (start_time is not null and end_time>start_time))
);
create index ops_schedule_date on operations_private.schedule(date,id) where archived_at is null;
create index ops_schedule_series on operations_private.schedule(series_id);
create table operations_private.items (
 id uuid primary key default gen_random_uuid(), group_id uuid not null, type text not null check(type in ('task','notice')),
 title text not null check(length(trim(title)) between 1 and 160), body text not null default '' check(length(body)<=16000),
 author_id uuid references operations_private.staff, assignee_id uuid not null references operations_private.staff,
 reviewer_id uuid references operations_private.staff, due_date date,
 status text not null default 'todo' check(status in ('todo','doing','review','rejected','done')),
 recurrence text not null default '' check(recurrence='' or recurrence ~ '^(weekly:[0-6]|monthly:([1-9]|[12][0-9]|3[01]))$'),
 first_opened_at timestamptz, submitted_at timestamptz, reviewed_at timestamptz, completed_at timestamptz,
 archived_at timestamptz, revision integer not null default 0, legacy_key text unique,
 parent_id uuid unique references operations_private.items,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(reviewer_id is null or reviewer_id<>assignee_id),
 check((type='task' and due_date is not null) or (type='notice' and reviewer_id is null and due_date is null and recurrence=''))
);
create index ops_items_due on operations_private.items(due_date,id) where archived_at is null;
create index ops_items_assignee on operations_private.items(assignee_id,status);
create index ops_items_reviewer on operations_private.items(reviewer_id,status);
create index ops_items_group on operations_private.items(group_id);
create table operations_private.history (
 id uuid primary key default gen_random_uuid(), target_id uuid not null, kind text not null,
 actor_id uuid references operations_private.staff, action text not null, note text not null default '',
 before_data jsonb, after_data jsonb, created_at timestamptz not null default now(), legacy_key text unique
);
create index ops_history_target on operations_private.history(target_id,created_at);
create table operations_private.comments (
 id uuid primary key default gen_random_uuid(), item_id uuid not null references operations_private.items,
 actor_id uuid references operations_private.staff, body text not null check(length(trim(body)) between 1 and 8000),
 created_at timestamptz not null default now(), legacy_key text unique
);
create index ops_comments_item on operations_private.comments(item_id,created_at);
create table operations_private.requests (
 id uuid primary key, actor_id uuid not null, action text not null, payload jsonb not null, result jsonb not null
);
do $$ declare t text; begin
 foreach t in array array['staff','schedule','items','history','comments','requests'] loop
 execute format('alter table operations_private.%I enable row level security',t);
 execute format('revoke all on operations_private.%I from public,anon,authenticated',t);
 end loop;
end $$;

create function operations_private.next_due(r text,d date) returns date language plpgsql immutable set search_path='' as $$
declare n integer; first_day date; begin
 if r like 'weekly:%' then
 n:=((split_part(r,':',2)::int-extract(dow from d)::int+6)%7)+1; return d+n;
 elsif r like 'monthly:%' then
 first_day:=(date_trunc('month',d)+interval '1 month')::date;
 return first_day+least(split_part(r,':',2)::int,extract(day from first_day+interval '1 month'-interval '1 day')::int)-1;
 end if; return null;
end $$;

create function operations_private.dispatch(a text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
 uid uuid:=auth.uid(); adm boolean; actor operations_private.staff; s operations_private.staff;
 w operations_private.items; e operations_private.schedule; old jsonb; result jsonb; x jsonb;
 request_id uuid; group_id uuid; new_id uuid; who uuid; reviewer uuid; target_ids uuid[]; assigned uuid[];
 n integer; d date; nextdate date; to_state text; allowed boolean; is_new boolean;
begin
 if uid is null or not exists(select 1 from public.members where id=uid and agreed_at is not null) then
 raise exception 'consent_required' using errcode='42501'; end if;
 adm:=public.is_admin();
 if a='access' then
 return jsonb_build_object('allowed',adm or exists(select 1 from operations_private.staff where member_id=uid and active and (schedule or work)));
 end if;
 if adm then
 insert into operations_private.staff(member_id,name,schedule,work) select id,coalesce(nullif(name,''),'관리자'),true,true from public.members where id=uid
 on conflict(member_id) do nothing;
 end if;
 select * into actor from operations_private.staff where member_id=uid and (active or adm);
 if actor.id is null or (not adm and not actor.schedule and not actor.work) then raise exception 'staff_required' using errcode='42501'; end if;
 if a like 'schedule_%' and not(adm or actor.schedule) then raise exception 'forbidden' using errcode='42501'; end if;
 if a like 'work_%' and not(adm or actor.work) then raise exception 'forbidden' using errcode='42501'; end if;
 if a in ('staff_save','members') and not adm then raise exception 'forbidden' using errcode='42501'; end if;
 if a='bootstrap' then
 return jsonb_build_object('me',actor.id,'admin',adm,'schedule',adm or actor.schedule,'work',adm or actor.work,
 'staff',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') from operations_private.staff t));
 elsif a='members' then
 if length(trim(coalesce(p->>'query','')))<2 then return '{"items":[]}'; end if;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from
 (select id,name,email from public.members where name ilike '%'||(p->>'query')||'%' or email ilike '%'||(p->>'query')||'%' order by name,id limit 20)t));
 elsif a='schedule_list' then
 if (p->>'end')::date<(p->>'start')::date or (p->>'end')::date-(p->>'start')::date>370 then raise exception 'date_range'; end if;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(t) order by t.date,t.start_time,t.id),'[]') from operations_private.schedule t
 where t.date between (p->>'start')::date and (p->>'end')::date and (t.archived_at is null or coalesce((p->>'archived')::boolean,false))));
 elsif a='schedule_series' then
 select * into e from operations_private.schedule where id=(p->>'id')::uuid;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(t) order by t.date),'[]') from operations_private.schedule t where t.series_id=e.series_id and t.archived_at is null));
 elsif a='work_list' then
 -- 월별 페이지로 전체 원장 무제한 전송을 막는다. 공지와 미완료는 항상 함께 가져온다.
 return jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc),'[]') from operations_private.items t
 where (t.archived_at is null or coalesce((p->>'archived')::boolean,false)) and
 (t.status<>'done' or t.type='notice' or t.due_date between (p->>'start')::date and (p->>'end')::date)));
 elsif a='work_detail' then
 select * into w from operations_private.items where id=(p->>'id')::uuid;
 if w.id is null then raise exception 'not_found'; end if;
 if w.assignee_id=actor.id and w.first_opened_at is null then
 update operations_private.items set first_opened_at=now() where id=w.id and first_opened_at is null returning * into w;
 end if;
 return jsonb_build_object('item',to_jsonb(w),
 'group',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from operations_private.items t where t.group_id=w.group_id and t.archived_at is null),
 'history',(select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at),'[]') from operations_private.history t where t.target_id=w.id),
 'comments',(select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at),'[]') from operations_private.comments t where t.item_id=w.id));
 end if;

 -- 요청 재전송과 동시 변경을 같은 트랜잭션 안에서 처리한다.
 request_id:=(p->>'request_id')::uuid;
 if request_id is null then raise exception 'request_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('monc-operations-write',0));
 -- 잠금을 기다리는 동안 권한이 회수된 경우에도 다시 확인한다.
 adm:=public.is_admin();
 select * into actor from operations_private.staff where member_id=uid and (active or adm);
 if actor.id is null or (not adm and not actor.schedule and not actor.work) then raise exception 'staff_required' using errcode='42501'; end if;
 if a like 'schedule_%' and not(adm or actor.schedule) then raise exception 'forbidden' using errcode='42501'; end if;
 if a like 'work_%' and not(adm or actor.work) then raise exception 'forbidden' using errcode='42501'; end if;
 if a='staff_save' and not adm then raise exception 'forbidden' using errcode='42501'; end if;
 select r.result into result from operations_private.requests r where r.id=request_id and r.actor_id=actor.id and r.action=a and r.payload=p;
 if found then return result; end if;
 if exists(select 1 from operations_private.requests where id=request_id) then raise exception 'request_conflict'; end if;
 result:='{"ok":true}';
 if a='staff_save' then
 if not exists(select 1 from public.members where id=(p->>'member_id')::uuid) then raise exception 'member_required'; end if;
 select * into s from operations_private.staff where member_id=(p->>'member_id')::uuid for update;
 if s.id is not null and s.revision<>coalesce((p->>'revision')::int,-1) then raise exception 'conflict' using errcode='40001'; end if;
 if s.id=actor.id and not coalesce((p->>'active')::boolean,true) then raise exception 'self_disable'; end if;
 insert into operations_private.staff(member_id,name,active,schedule,work)
 values((p->>'member_id')::uuid,trim(p->>'name'),(p->>'active')::boolean,(p->>'schedule')::boolean,(p->>'work')::boolean)
 on conflict(member_id) do update set name=excluded.name,active=excluded.active,schedule=excluded.schedule,work=excluded.work,revision=operations_private.staff.revision+1
 returning id into new_id;
 insert into operations_private.history(target_id,kind,actor_id,action,before_data,after_data) values(new_id,'staff',actor.id,a,to_jsonb(s),p-'request_id');
 elsif a in ('schedule_save','schedule_batch') then
 target_ids:='{}';
 for x in select * from jsonb_array_elements(coalesce(p->'expected','[]')) loop
 select * into e from operations_private.schedule where id=(x->>'id')::uuid for update;
 if e.id is null or e.revision is distinct from (x->>'revision')::int then raise exception 'conflict' using errcode='40001'; end if;
 target_ids:=array_append(target_ids,e.id);
 end loop;
 if cardinality(target_ids)>400 then raise exception 'too_many'; end if;
 if cardinality(target_ids)<>(select count(distinct z) from unnest(target_ids) z) then raise exception 'duplicate_selection'; end if;
 if a='schedule_batch' then
 if cardinality(target_ids)=0 then raise exception 'selection_required'; end if;
 for e in select * from operations_private.schedule where id=any(target_ids) loop
 old:=to_jsonb(e);
 if p->>'operation'='title' then update operations_private.schedule set title=trim(p->>'title'),revision=revision+1,updated_at=now() where id=e.id;
 elsif p->>'operation' in ('archive','restore') then update operations_private.schedule set archived_at=case when p->>'operation'='archive' then now() else null end,revision=revision+1,updated_at=now() where id=e.id;
 else raise exception 'unknown_action'; end if;
 insert into operations_private.history(target_id,kind,actor_id,action,before_data,after_data) values(e.id,'schedule',actor.id,a,old,p-'request_id');
 end loop;
 else
 if jsonb_typeof(p->'dates') is distinct from 'array' or jsonb_array_length(p->'dates') not between 1 and 400 then raise exception 'dates_required'; end if;
 if cardinality(target_ids)>0 and p->>'scope'='series' then
 select series_id into group_id from operations_private.schedule where id=target_ids[1];
 if exists(select 1 from operations_private.schedule where series_id=group_id and archived_at is null and not(id=any(target_ids))) or exists(select 1 from operations_private.schedule where id=any(target_ids) and series_id<>group_id) then raise exception 'conflict' using errcode='40001'; end if;
 elsif cardinality(target_ids)>1 then raise exception 'invalid_scope'; end if;
 group_id:=coalesce(group_id,gen_random_uuid());
 select coalesce(array_agg(value::uuid),'{}') into assigned from jsonb_array_elements_text(coalesce(p->'staff_ids','[]'));
 if exists(select 1 from unnest(assigned) z where not exists(select 1 from operations_private.staff where id=z and active)) then raise exception 'staff_required'; end if;
 if cardinality(target_ids)=1 and p->>'scope'='single' and jsonb_array_length(p->'dates')<>1 then raise exception 'single_date_required'; end if;
 for e in select * from operations_private.schedule where id=any(target_ids) loop
 insert into operations_private.history(target_id,kind,actor_id,action,before_data,after_data) values(e.id,'schedule',actor.id,'replace',to_jsonb(e),p-'request_id');
 update operations_private.schedule set archived_at=now(),revision=revision+1,updated_at=now() where id=e.id;
 end loop;
 for d in select distinct value::date from jsonb_array_elements_text(p->'dates') loop
 insert into operations_private.schedule(series_id,date,category,title,body,start_time,end_time,staff_ids,legacy_staff)
 values(group_id,d,p->>'category',trim(p->>'title'),coalesce(p->>'body',''),nullif(p->>'start_time','')::time,nullif(p->>'end_time','')::time,assigned,coalesce(p->>'legacy_staff','')) returning id into new_id;
 insert into operations_private.history(target_id,kind,actor_id,action,after_data) values(new_id,'schedule',actor.id,'create',p-'request_id');
 end loop;
 end if;
 elsif a='work_save' then
 is_new:=nullif(p->>'id','') is null;
 select coalesce(array_agg(distinct value::uuid),'{}') into assigned from jsonb_array_elements_text(coalesce(p->'assignees','[]'));
 reviewer:=nullif(p->>'reviewer_id','')::uuid;
 if cardinality(assigned) not between 1 and 100 then raise exception 'assignee_required'; end if;
 if reviewer=any(assigned) then raise exception 'self_review'; end if;
 if not is_new then
 select * into w from operations_private.items where id=(p->>'id')::uuid for update;
 if w.id is null then raise exception 'not_found'; end if;
 if not adm and w.author_id is distinct from actor.id then raise exception 'forbidden' using errcode='42501'; end if;
 if w.revision is distinct from (p->>'revision')::int or w.archived_at is not null then raise exception 'conflict' using errcode='40001'; end if;
 if w.type<>p->>'type' then raise exception 'type_immutable'; end if;
 if w.type='task' and cardinality(assigned)<>1 then raise exception 'one_assignee'; end if;
 group_id:=w.group_id;
 if w.type='notice' then
 for w in select * from operations_private.items where items.group_id=group_id and archived_at is null loop
 if not exists(select 1 from jsonb_array_elements(p->'expected') z where (z->>'id')::uuid=w.id and (z->>'revision')::int=w.revision) then raise exception 'conflict' using errcode='40001'; end if;
 end loop;
 end if;
 else group_id:=gen_random_uuid(); end if;
 -- 새로 지정하는 사람은 활성 직원이어야 한다. 기존 비활성 직원의 기록 수정은 허용한다.
 if exists(select 1 from unnest(assigned) z where
 not exists(select 1 from operations_private.staff t where t.id=z and t.active and t.work and t.member_id is not null)
 and (is_new or not exists(select 1 from operations_private.items i where i.group_id=group_id and i.archived_at is null and i.assignee_id=z))) then raise exception 'work_staff_required'; end if;
 if reviewer is not null and not exists(select 1 from operations_private.staff t where t.id=reviewer and t.active and t.work and t.member_id is not null)
 and (is_new or not exists(select 1 from operations_private.items i where i.id=(p->>'id')::uuid and i.reviewer_id=reviewer)) then raise exception 'work_staff_required'; end if;
 for who in select unnest(assigned) loop
 w:=null;
 if not is_new then
 if p->>'type'='notice' then select * into w from operations_private.items i where i.group_id=group_id and i.assignee_id=who and i.archived_at is null;
 else select * into w from operations_private.items where id=(p->>'id')::uuid; end if;
 end if;
 old:=to_jsonb(w);
 if w.id is null then
 insert into operations_private.items(group_id,type,title,body,author_id,assignee_id,reviewer_id,due_date,recurrence)
 values(group_id,p->>'type',trim(p->>'title'),coalesce(p->>'body',''),actor.id,who,reviewer,nullif(p->>'due_date','')::date,coalesce(p->>'recurrence','')) returning * into w;
 else
 -- 처리 중 담당자·검수자 교체는 상태 의미를 바꾸므로 대기로 돌린 뒤 변경한다.
 if w.status<>'todo' and (who<>w.assignee_id or reviewer is distinct from w.reviewer_id) then raise exception 'assignment_locked'; end if;
 update operations_private.items set title=trim(p->>'title'),body=coalesce(p->>'body',''),assignee_id=who,reviewer_id=reviewer,
 due_date=nullif(p->>'due_date','')::date,recurrence=coalesce(p->>'recurrence',''),revision=revision+1,updated_at=now() where id=w.id returning * into w;
 end if;
 insert into operations_private.history(target_id,kind,actor_id,action,before_data,after_data) values(w.id,'work',actor.id,a,old,to_jsonb(w));
 end loop;
 if not is_new and p->>'type'='notice' then
 for w in select * from operations_private.items i where i.group_id=group_id and i.archived_at is null and not(i.assignee_id=any(assigned)) loop
 update operations_private.items set archived_at=now(),revision=revision+1,updated_at=now() where id=w.id;
 insert into operations_private.history(target_id,kind,actor_id,action,before_data) values(w.id,'work',actor.id,'recipient_remove',to_jsonb(w));
 end loop;
 end if;
 elsif a in ('work_transition','work_archive','work_comment') then
 select * into w from operations_private.items where id=(p->>'id')::uuid for update;
 if w.id is null then raise exception 'not_found'; end if;
 old:=to_jsonb(w);
 if a='work_comment' then
 if w.archived_at is not null then raise exception 'archived'; end if;
 insert into operations_private.comments(item_id,actor_id,body) values(w.id,actor.id,trim(p->>'body'));
 else
 if w.revision is distinct from (p->>'revision')::int then raise exception 'conflict' using errcode='40001'; end if;
 if a='work_archive' then
 if not adm and w.author_id is distinct from actor.id then raise exception 'forbidden' using errcode='42501'; end if;
 update operations_private.items set archived_at=case when coalesce((p->>'restore')::boolean,false) then null else now() end,revision=revision+1,updated_at=now() where id=w.id;
 else
 if w.archived_at is not null then raise exception 'archived'; end if;
 to_state:=p->>'to'; allowed:=false;
 if w.type='notice' then allowed:=w.status='todo' and to_state='done' and w.assignee_id=actor.id;
 else
 allowed:=(w.status in ('todo','rejected') and to_state='doing' and w.assignee_id=actor.id)
 or (w.status='doing' and w.assignee_id=actor.id and ((to_state='review' and w.reviewer_id is not null) or (to_state='done' and w.reviewer_id is null)))
 or (w.status='review' and to_state in ('done','rejected') and w.reviewer_id=actor.id)
 or (w.status='done' and to_state='todo' and adm);
 end if;
 if not coalesce(allowed,false) then raise exception 'forbidden_transition' using errcode='42501'; end if;
 if to_state='rejected' and length(trim(coalesce(p->>'note','')))=0 then raise exception 'reject_note_required'; end if;
 update operations_private.items set status=to_state,revision=revision+1,updated_at=now(),
 submitted_at=case when to_state='review' then now() else submitted_at end,
 reviewed_at=case when w.status='review' then now() else reviewed_at end,
 completed_at=case when to_state='done' then now() else null end where id=w.id;
 if to_state='done' and w.type='task' and w.recurrence<>'' then
 nextdate:=operations_private.next_due(w.recurrence,w.due_date);
 insert into operations_private.items(group_id,type,title,body,author_id,assignee_id,reviewer_id,due_date,recurrence,parent_id)
 values(gen_random_uuid(),'task',w.title,w.body,w.author_id,w.assignee_id,w.reviewer_id,nextdate,w.recurrence,w.id) on conflict(parent_id) do nothing;
 end if;
 end if;
 insert into operations_private.history(target_id,kind,actor_id,action,note,before_data,after_data)
 select w.id,'work',actor.id,a,left(coalesce(p->>'note',''),8000),old,to_jsonb(i) from operations_private.items i where i.id=w.id;
 end if;
 else raise exception 'unknown_action'; end if;
 insert into operations_private.requests values(request_id,actor.id,a,p,result);
 return result;
end $$;
create function public.operations_api(p_action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$
 select operations_private.dispatch(p_action,p);
$$;
revoke all on all functions in schema operations_private from public,anon,authenticated;
grant execute on function operations_private.dispatch(text,jsonb) to authenticated;
revoke all on function public.operations_api(text,jsonb) from public,anon;
grant execute on function public.operations_api(text,jsonb) to authenticated;
commit;

notify pgrst, 'reload schema';
select
 to_regprocedure('public.operations_api(text,jsonb)') is not null as api_ready,
 (select count(*)=6 and bool_and(c.relrowsecurity)
  and not bool_or(has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
                  or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='operations_private' and c.relkind='r') as private_tables_protected,
 not has_function_privilege('anon','public.operations_api(text,jsonb)','EXECUTE') as anonymous_blocked,
 has_function_privilege('authenticated','public.operations_api(text,jsonb)','EXECUTE') as member_rpc_ready;

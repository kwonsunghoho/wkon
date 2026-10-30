-- 과정 전체 1회 제출. 첫 재생 후 14일, 전달된 피드백은 수강 만료와 무관하게 보존한다.
begin;
create table public.online_feedback_uploads (
 id uuid primary key, member_id uuid not null references auth.users(id) on delete cascade,
 course_id text not null references public.online_courses(id), path text not null unique,
 name text not null, bytes bigint not null check(bytes between 1 and 2147483648),
 content_type text not null, created_at timestamptz not null default now(), used_at timestamptz
);
create table public.online_course_feedback (
 id uuid primary key default gen_random_uuid(), member_id uuid not null references auth.users(id) on delete cascade,
 course_id text not null references public.online_courses(id), enrollment_id uuid not null references public.online_enrollments(id),
 request_id uuid not null unique, body text not null check(length(body)<=12000),
 upload_id uuid references public.online_feedback_uploads(id), submitted_at timestamptz not null default now(),
 draft text not null default '' check(length(draft)<=12000), revision integer not null default 0,
 feedback text, replied_at timestamptz, actor_id uuid references auth.users(id) on delete set null,
 unique(member_id,course_id), check(length(trim(body))>0 or upload_id is not null)
);
alter table public.online_feedback_uploads enable row level security;
alter table public.online_course_feedback enable row level security;
revoke all on public.online_feedback_uploads,public.online_course_feedback from public,anon,authenticated;
grant all on public.online_feedback_uploads,public.online_course_feedback to service_role;
create index online_feedback_queue on public.online_course_feedback(course_id,submitted_at desc);

create function public.oc_feedback_eligible(p_member uuid,p_enrollment uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.online_enrollments e join public.members m on m.id=e.member_id
 where e.id=p_enrollment and e.member_id=p_member and e.revoked_at is null and e.started_at is not null
 and now()<e.started_at+interval '14 days' and now()<e.expires_at
 and (not e.admin_preview or m.role='admin') and m.agreed_at is not null and m.terms_version='2026-10-05')
$$;
create function public.oc_submit_feedback(p_member uuid,p_enrollment uuid,p_request uuid,p_body text,p_upload uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.online_enrollments; f public.online_course_feedback; u public.online_feedback_uploads;
begin
 select * into e from public.online_enrollments where id=p_enrollment and member_id=p_member;
 if not found then return jsonb_build_object('ok',false,'error','not_enrolled'); end if;
 -- 환불과 같은 순서로 잠그며, 다른 수강권을 이용한 중복도 과정 단위로 막는다.
 if e.payment_id is not null then perform 1 from public.online_orders where payment_id=e.payment_id for update; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_member::text||':'||e.course_id,0));
 select * into e from public.online_enrollments where id=p_enrollment for update;
 select * into f from public.online_course_feedback where member_id=p_member and course_id=e.course_id;
 if found then
  if f.request_id=p_request and f.body=p_body and f.upload_id is not distinct from p_upload then return jsonb_build_object('ok',true,'id',f.id); end if;
  return jsonb_build_object('ok',false,'error','already_submitted');
 end if;
 if not public.oc_feedback_eligible(p_member,p_enrollment) then return jsonb_build_object('ok',false,'error','submission_closed'); end if;
 if p_request is null or p_body is null or length(p_body)>12000 or (length(trim(p_body))=0 and p_upload is null) then return jsonb_build_object('ok',false,'error','invalid_submission'); end if;
 if p_upload is not null then
  select * into u from public.online_feedback_uploads where id=p_upload and member_id=p_member and course_id=e.course_id and used_at is null for update;
  if not found or not exists(select 1 from storage.objects where bucket_id='online-course-assets' and name=u.path and (metadata->>'size')::bigint=u.bytes and metadata->>'mimetype'=u.content_type) then return jsonb_build_object('ok',false,'error','upload_incomplete'); end if;
 end if;
 insert into public.online_course_feedback(member_id,course_id,enrollment_id,request_id,body,upload_id)
 values(p_member,e.course_id,p_enrollment,p_request,p_body,p_upload) returning * into f;
 if p_upload is not null then update public.online_feedback_uploads set used_at=now() where id=p_upload; end if;
 return jsonb_build_object('ok',true,'id',f.id);
end $$;
create function public.oc_reserve_feedback_upload(p_member uuid,p_enrollment uuid,p_id uuid,p_name text,p_bytes bigint,p_type text,p_path text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.online_enrollments;
begin
 select * into e from public.online_enrollments where id=p_enrollment and member_id=p_member;
 if not found then return jsonb_build_object('ok',false,'error','not_enrolled'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_member::text||':'||e.course_id,0));
 if not public.oc_feedback_eligible(p_member,p_enrollment) then return jsonb_build_object('ok',false,'error','submission_closed'); end if;
 if exists(select 1 from public.online_course_feedback where member_id=p_member and course_id=e.course_id) then return jsonb_build_object('ok',false,'error','already_submitted'); end if;
 if p_id is null or p_name is null or length(p_name)>200 or p_bytes is null or p_bytes<1 or p_bytes>2147483648 or p_type not in ('video/mp4','video/webm','video/quicktime')
 or p_path is distinct from ('feedback/'||p_member::text||'/'||p_id::text||case p_type when 'video/mp4' then '.mp4' when 'video/webm' then '.webm' when 'video/quicktime' then '.mov' end) then return jsonb_build_object('ok',false,'error','invalid_file'); end if;
 if (select count(*) from public.online_feedback_uploads where member_id=p_member and course_id=e.course_id and used_at is null and created_at>now()-interval '1 day')>=3 then return jsonb_build_object('ok',false,'error','upload_limit'); end if;
 insert into public.online_feedback_uploads(id,member_id,course_id,path,name,bytes,content_type) values(p_id,p_member,e.course_id,p_path,p_name,p_bytes,p_type);
 return jsonb_build_object('ok',true);
end $$;
create function public.oc_reply_feedback(p_actor uuid,p_id uuid,p_body text,p_revision integer,p_publish boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f public.online_course_feedback;
begin
 if not exists(select 1 from public.members where id=p_actor and role='admin' and agreed_at is not null and terms_version='2026-10-05') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
 if p_body is null or length(p_body)>12000 or p_publish is null or (p_publish and length(trim(p_body))=0) then return jsonb_build_object('ok',false,'error','invalid_feedback'); end if;
 select * into f from public.online_course_feedback where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
 if f.replied_at is not null then
  if p_publish and f.feedback=p_body then return jsonb_build_object('ok',true); end if;
  return jsonb_build_object('ok',false,'error','already_replied');
 end if;
 if f.revision is distinct from p_revision then return jsonb_build_object('ok',false,'error','edit_conflict'); end if;
 update public.online_course_feedback set draft=p_body,revision=revision+1,actor_id=p_actor,
 feedback=case when p_publish then p_body else null end,replied_at=case when p_publish then now() else null end where id=p_id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.oc_feedback_eligible(uuid,uuid),public.oc_submit_feedback(uuid,uuid,uuid,text,uuid),public.oc_reply_feedback(uuid,uuid,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.oc_feedback_eligible(uuid,uuid),public.oc_submit_feedback(uuid,uuid,uuid,text,uuid),public.oc_reply_feedback(uuid,uuid,text,integer,boolean) to service_role;
revoke all on function public.oc_reserve_feedback_upload(uuid,uuid,uuid,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.oc_reserve_feedback_upload(uuid,uuid,uuid,text,bigint,text,text) to service_role;
commit;

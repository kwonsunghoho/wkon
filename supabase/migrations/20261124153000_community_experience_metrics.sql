begin;

create table monc_community.interview_experience_view_totals (
  post_id uuid primary key references monc_community.interview_experiences(post_id) on delete cascade,
  views bigint not null check (views > 0)
);

-- 같은 브라우저의 반복 열람을 합치기 위한 글별 키다.
create table monc_community.interview_experience_view_windows (
  post_id uuid not null references monc_community.interview_experiences(post_id) on delete cascade,
  visitor_key bytea not null,
  counted_at timestamptz not null,
  primary key (post_id,visitor_key)
);
create index interview_experience_view_windows_counted_at
  on monc_community.interview_experience_view_windows (counted_at);

alter table monc_community.interview_experience_view_totals enable row level security;
alter table monc_community.interview_experience_view_windows enable row level security;
revoke all on monc_community.interview_experience_view_totals,monc_community.interview_experience_view_windows
  from public,anon,authenticated;
grant all on monc_community.interview_experience_view_totals,monc_community.interview_experience_view_windows
  to service_role;

create function monc_community.experience_metrics(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if cardinality(p_ids)>100 then
    return jsonb_build_object('ok',false,'code','too_many_ids');
  end if;

  return jsonb_build_object('ok',true,'items',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',e.post_id,'views',coalesce(t.views,0),'votes',(
        select count(*) from monc_community.interview_experience_votes v
        where v.post_id=e.post_id and v.active
      )
    ))
    from monc_community.interview_experiences e
    join monc_community.posts p on p.id=e.post_id and p.status='published'
    left join monc_community.interview_experience_view_totals t on t.post_id=e.post_id
    where e.kind='note' and e.post_id=any(p_ids)
  ),'[]'::jsonb));
end $$;

create function monc_community.experience_record_view(p_id uuid,p_visit_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  at_time timestamptz:=statement_timestamp();
  view_count bigint;
  counted boolean;
begin
  if p_id is null or p_visit_id is null then
    return jsonb_build_object('ok',false,'code','visit_required');
  end if;

  -- 지표 집계 중에는 글 공개 상태 변경과 삭제를 잠시 기다리게 한다.
  perform 1 from monc_community.interview_experiences e
  join monc_community.posts p on p.id=e.post_id
  where e.post_id=p_id and e.kind='note' and p.status='published'
  for share of p;
  if not found then
    return jsonb_build_object('ok',true,'id',p_id,'views',null,'counted',false);
  end if;

  insert into monc_community.interview_experience_view_windows as visit(post_id,visitor_key,counted_at)
  values(p_id,sha256(convert_to(p_id::text||':'||p_visit_id::text,'UTF8')),at_time)
  on conflict(post_id,visitor_key) do update set counted_at=excluded.counted_at
  where visit.counted_at <= excluded.counted_at - interval '30 minutes';
  counted:=found;

  if counted then
    insert into monc_community.interview_experience_view_totals as total(post_id,views)
    values(p_id,1)
    on conflict(post_id) do update set views=total.views+1
    returning views into view_count;

    -- 최근 열람 키만 필요하다. 잠긴 키는 건너뛰고 한 번에 조금씩 정리한다.
    delete from monc_community.interview_experience_view_windows
    where (post_id,visitor_key) in (
      select stale.post_id,stale.visitor_key
      from monc_community.interview_experience_view_windows stale
      where stale.counted_at < at_time - interval '30 minutes'
      order by stale.counted_at
      limit 64
      for update skip locked
    );
  else
    select t.views into view_count from monc_community.interview_experience_view_totals t where t.post_id=p_id;
  end if;

  return jsonb_build_object('ok',true,'id',p_id,'views',coalesce(view_count,0),'counted',counted);
end $$;

revoke all on function monc_community.experience_metrics(uuid[]),
  monc_community.experience_record_view(uuid,uuid) from public,anon,authenticated;
grant execute on function monc_community.experience_metrics(uuid[]),
  monc_community.experience_record_view(uuid,uuid) to anon,authenticated;

create function public.community_experience_metrics(p_ids uuid[]) returns jsonb
language sql stable security invoker set search_path=''
begin atomic
  select monc_community.experience_metrics(p_ids);
end;

create function public.community_experience_record_view(p_id uuid,p_visit_id uuid) returns jsonb
language sql security invoker set search_path=''
begin atomic
  select monc_community.experience_record_view(p_id,p_visit_id);
end;

revoke all on function public.community_experience_metrics(uuid[]),
  public.community_experience_record_view(uuid,uuid) from public,anon,authenticated;
grant execute on function public.community_experience_metrics(uuid[]),
  public.community_experience_record_view(uuid,uuid) to anon,authenticated;

notify pgrst,'reload schema';

commit;

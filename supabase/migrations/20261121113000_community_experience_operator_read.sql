begin;

-- 합격 노하우 운영 조회만 추가한다. 글의 숨김·복원은 기존 콘텐츠 운영 RPC가 처리한다.
create function monc_community.experience_operator_read(p_data jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  u uuid := monc_community.actor();
  q text := lower(left(trim(coalesce(p_data->>'q','')),100));
  filter_status text := coalesce(p_data->>'status','');
  filter_kind text := coalesce(p_data->>'kind','');
  skip integer := greatest(0,least(coalesce((p_data->>'offset')::integer,0),100000));
  items jsonb;
begin
  if not monc_community.admin(u) then
    raise exception 'community:forbidden' using errcode='42501';
  end if;

  with page as (
    select p.id,p.title,p.body,p.nickname,p.status,p.created_at,
      e.kind,e.airline,e.stage,e.subject,e.recruit_year,e.half
    from monc_community.interview_experiences e
    join monc_community.posts p on p.id=e.post_id
    where (filter_status='' or p.status=filter_status)
      and (filter_kind='' or e.kind=filter_kind)
      and (q='' or strpos(lower(concat_ws(' ',p.title,p.body,p.nickname,e.airline,e.stage,e.subject)),q)>0)
    order by p.created_at desc,p.id desc
    limit 31 offset skip
  )
  select coalesce(jsonb_agg(to_jsonb(page) || jsonb_build_object('votes',(
    select count(*) from monc_community.interview_experience_votes v
    where v.post_id=page.id and v.active
  )) order by page.created_at desc,page.id desc),'[]'::jsonb)
  into items from page;

  return jsonb_build_object('ok',true,'items',items,'limit',30);
end $$;

revoke all on function monc_community.experience_operator_read(jsonb) from public,anon,authenticated;
grant execute on function monc_community.experience_operator_read(jsonb) to authenticated;

-- 함수 본문을 생성 시점에 연결해 비공개 스키마에 직접 접근 권한을 줄 필요가 없다.
create function public.community_experience_operator_read(p_data jsonb default '{}') returns jsonb
language sql stable security invoker set search_path=''
begin atomic
  select monc_community.experience_operator_read(p_data);
end;

revoke all on function public.community_experience_operator_read(jsonb) from public,anon,authenticated;
grant execute on function public.community_experience_operator_read(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

begin;

alter table monc_community.interview_experiences
  drop constraint interview_experiences_check,
  add constraint interview_experiences_half_check
    check (half in ('','상반기','중반기','하반기') and (half='' or recruit_year is not null));

-- 최근 1년 조회에서 중반기는 9월 말까지의 전형으로 계산한다.
create or replace function public.community_experience_read(p_data jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  target uuid:=nullif(p_data->>'id','')::uuid;
  parent uuid:=nullif(p_data->>'request_id','')::uuid;
  filter_kind text:=case when p_data->>'kind'='request' then 'request' else 'note' end;
  q text:=lower(left(trim(coalesce(p_data->>'q','')),120));
  popular boolean:=p_data->>'sort'='popular';
  lim integer:=greatest(1,least(30,coalesce((p_data->>'limit')::integer,16)));
  skip integer:=greatest(0,least(100000,coalesce((p_data->>'offset')::integer,0)));
  year_filter integer:=nullif(p_data->>'year','')::integer;
  current_year integer:=extract(year from now() at time zone 'Asia/Seoul')::integer;
  items jsonb;
begin
  with posts as (
    select p.id,p.title,left(p.body,160) as excerpt,p.nickname,p.created_at,
      e.kind,e.airline,e.stage,e.subject,e.recruit_year,e.half,
      (select count(*) from monc_community.posts note
        join monc_community.interview_experiences child on child.post_id=note.id
        where child.request_id=e.post_id and note.status='published') as answer_count,
      (select count(*) from monc_community.comments c where c.post_id=p.id and c.status='published') as comments,
      (select req.title from monc_community.posts req where req.id=e.request_id and req.status='published') as request_title,
      (select req.id from monc_community.posts req where req.id=e.request_id and req.status='published') as request_id,
      coalesce(v.total,0) as votes,coalesce(v.recent,0) as recent_votes,coalesce(v.mine,false) as voted,
      coalesce(p.user_id=auth.uid(),false) as mine,
      exists(select 1 from monc_community.certificates c
        where c.user_id=p.user_id and c.active and c.recruit_year=e.recruit_year
        and (case trim(c.airline) when '티웨이항공' then '트리니티항공'
          when '아시아나' then '아시아나항공' else trim(c.airline) end)=e.airline
        and regexp_replace(c.stage,'[[:space:]]+','','g')='최종합격') as verified
    from monc_community.interview_experiences e
    join monc_community.posts p on p.id=e.post_id and p.status='published'
    left join lateral (
      select count(*) as total,count(*) filter(where created_at >= now()-interval '7 days') as recent,
        bool_or(user_id=auth.uid()) as mine
      from monc_community.interview_experience_votes where post_id=e.post_id and active
    ) v on true
    where (target is null or p.id=target)
      and (parent is null or e.request_id=parent)
      and (target is not null or e.kind=filter_kind)
      and (coalesce(p_data->>'airline','')='' or e.airline=p_data->>'airline')
      and (coalesce(p_data->>'stage','')='' or e.stage=p_data->>'stage')
      and (coalesce(p_data->>'subject','')='' or e.subject=p_data->>'subject')
      and (year_filter is null or e.recruit_year=year_filter)
      and (coalesce(p_data->>'half','')='' or e.half=p_data->>'half')
      and (not coalesce((p_data->>'recent')::boolean,false)
        or (e.recruit_year is not null
          and make_date(e.recruit_year,case e.half when '상반기' then 6 when '중반기' then 9 else 12 end,
            case when e.half in ('상반기','중반기') then 30 else 31 end)>=(now() at time zone 'Asia/Seoul')::date-interval '1 year'
          and e.recruit_year<=current_year))
      and (q='' or strpos(lower(p.title||' '||p.body||' '||e.airline||' '||e.stage||' '||e.subject),q)>0)
  ),
  page as (
    select posts.*,case when popular then recent_votes else 0 end as sort_votes
    from posts
    where (not coalesce((p_data->>'verified')::boolean,false) or verified)
      and (not coalesce((p_data->>'popular_only')::boolean,false) or recent_votes>0)
    order by sort_votes desc,created_at desc,id desc
    limit lim+1 offset skip
  )
  select coalesce(jsonb_agg(to_jsonb(page)-'sort_votes' order by sort_votes desc,created_at desc,id desc),'[]'::jsonb) into items
  from page;
  return jsonb_build_object('ok',true,'items',items,'limit',lim);
end $$;

notify pgrst,'reload schema';
commit;

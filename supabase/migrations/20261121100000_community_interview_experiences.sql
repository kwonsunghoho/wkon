begin;

create table monc_community.interview_experiences (
  post_id uuid primary key references monc_community.posts(id) on delete cascade,
  kind text not null check (kind in ('note','request')),
  airline text not null check (airline in (
    '대한항공','아시아나항공','제주항공','진에어','트리니티항공','에어부산','에어서울',
    '이스타항공','에어프레미아','에어로케이','파라타항공','국내 공통'
  )),
  stage text not null check (stage in ('서류','영상','임원','최종')),
  subject text not null default '' check (subject in ('','자소서 소재','답변 구성','보이스','이미지','재지원')),
  recruit_year integer check (recruit_year between 2000 and 2100),
  half text not null default '' check (half in ('','상반기','하반기') and (half='' or recruit_year is not null)),
  request_id uuid references monc_community.interview_experiences(post_id) on delete set null,
  check (request_id is null or (kind='note' and request_id<>post_id))
);
create index interview_experiences_filter on monc_community.interview_experiences(kind,airline,stage);
create index interview_experiences_request on monc_community.interview_experiences(request_id) where request_id is not null;

create table monc_community.interview_experience_votes (
  post_id uuid not null references monc_community.interview_experiences(post_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  active boolean not null default true,
  primary key (post_id,user_id)
);
create index interview_experience_votes_active on monc_community.interview_experience_votes(post_id,created_at) where active;

alter table monc_community.interview_experiences enable row level security;
alter table monc_community.interview_experience_votes enable row level security;
revoke all on monc_community.interview_experiences,monc_community.interview_experience_votes from public,anon,authenticated;
grant all on monc_community.interview_experiences,monc_community.interview_experience_votes to service_role;

-- 일반 게시판의 수정 경로를 사용해도 경험담의 항공사·전형·글 종류를 유지한다.
create function monc_community.sync_interview_experience_post() returns trigger
language plpgsql set search_path='' as $$
declare experience monc_community.interview_experiences%rowtype;
begin
  select * into experience from monc_community.interview_experiences where post_id=new.id;
  if found then
    new.topic:='prep';
    new.category:=case when experience.kind='request' then 'question' else 'info' end;
    new.airline:=experience.airline;
    new.stage:=experience.stage;
    new.recruit_year:=experience.recruit_year;
  end if;
  return new;
end $$;
revoke all on function monc_community.sync_interview_experience_post() from public,anon,authenticated;

create trigger sync_interview_experience_post
before update of topic,category,airline,stage,recruit_year on monc_community.posts
for each row execute function monc_community.sync_interview_experience_post();

-- 기존 게시판과 같은 공개 범위에서 필요한 값만 반환한다. 회원 식별자·인증 원본은 반환하지 않는다.
create function public.community_experience_read(p_data jsonb default '{}') returns jsonb
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
          and make_date(e.recruit_year,case when e.half='상반기' then 6 else 12 end,
            case when e.half='상반기' then 30 else 31 end)>=(now() at time zone 'Asia/Seoul')::date-interval '1 year'
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
revoke all on function public.community_experience_read(jsonb) from public,anon,authenticated;
grant execute on function public.community_experience_read(jsonb) to anon,authenticated;

create function public.community_experience_member(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=monc_community.actor();
  target uuid:=nullif(p_data->>'id','')::uuid;
  new_post boolean:=target is null;
  parent uuid:=nullif(p_data->>'request_id','')::uuid;
  post_kind text:=p_data->>'kind';
  post_airline text:=p_data->>'airline';
  post_stage text:=p_data->>'stage';
  post_subject text:=coalesce(p_data->>'subject','');
  post_year integer:=nullif(p_data->>'year','')::integer;
  post_half text:=coalesce(p_data->>'half','');
  existing monc_community.interview_experiences%rowtype;
  owner_id uuid;
begin
  if not exists(select 1 from monc_community.profiles where user_id=u) then
    raise exception 'community:profile_required';
  end if;
  if exists(select 1 from monc_community.profiles where user_id=u and blocked) then
    raise exception 'community:blocked';
  end if;

  if p_action='vote' then
    select p.user_id into owner_id from monc_community.posts p
    join monc_community.interview_experiences e on e.post_id=p.id
    where p.id=target and p.status='published' for share of p;
    if not found then raise exception 'community:not_found'; end if;
    if owner_id=u then raise exception 'community:forbidden'; end if;

    if (p_data->>'active')::boolean is true then
      insert into monc_community.interview_experience_votes(post_id,user_id) values(target,u)
      on conflict(post_id,user_id) do update set active=true;
    else
      update monc_community.interview_experience_votes set active=false where post_id=target and user_id=u;
    end if;
    return jsonb_build_object('ok',true,'id',target);
  end if;

  if p_action<>'save' then raise exception 'community:bad_action'; end if;
  if target is not null then
    perform 1 from monc_community.posts where id=target and user_id=u and status<>'deleted' for update;
    if not found then raise exception 'community:forbidden'; end if;
    select * into existing from monc_community.interview_experiences where post_id=target;
    if not found then raise exception 'community:not_found'; end if;
    post_kind:=existing.kind;
    parent:=existing.request_id;
  elsif parent is not null then
    select e.* into existing from monc_community.interview_experiences e
    join monc_community.posts p on p.id=e.post_id
    where e.post_id=parent and e.kind='request' and p.status='published' for share of p;
    if not found then raise exception 'community:not_found'; end if;
    if post_kind is distinct from 'note' or post_airline is distinct from existing.airline or post_stage is distinct from existing.stage then
      raise exception 'community:bad_experience';
    end if;
  end if;

  if post_kind is null or post_kind not in ('note','request') or post_stage is null or post_stage not in ('서류','영상','임원','최종')
    or post_airline is null or post_airline not in ('대한항공','아시아나항공','제주항공','진에어','트리니티항공','에어부산',
      '에어서울','이스타항공','에어프레미아','에어로케이','파라타항공','국내 공통') then
    raise exception 'community:bad_experience';
  end if;

  if target is not null then
    update monc_community.interview_experiences e
    set airline=post_airline,stage=post_stage,subject=post_subject,recruit_year=post_year,half=post_half
    where e.post_id=target;
  end if;
  target:=(public.community_member('post-save',jsonb_build_object(
    'id',target,'topic','prep','category',case when post_kind='request' then 'question' else 'info' end,
    'title',p_data->>'title','body',p_data->>'body','airline',post_airline,'stage',post_stage,'year',post_year
  ))->>'id')::uuid;
  if new_post then
    insert into monc_community.interview_experiences(post_id,kind,airline,stage,subject,recruit_year,half,request_id)
    values(target,post_kind,post_airline,post_stage,post_subject,post_year,post_half,parent);
  end if;
  return jsonb_build_object('ok',true,'id',target);
end $$;
revoke all on function public.community_experience_member(text,jsonb) from public,anon,authenticated;
grant execute on function public.community_experience_member(text,jsonb) to authenticated;

commit;

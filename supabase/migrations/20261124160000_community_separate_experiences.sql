begin;

-- 게시판 목록·검색에는 일반 게시글만 보여 준다. 노하우 목록은 전용 RPC가 담당한다.
create or replace function public.community_read(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q text:=left(trim(coalesce(p_data->>'q','')),120); pat text; items jsonb; lim integer:=least(30,greatest(1,coalesce((p_data->>'limit')::integer,20))); before_time timestamptz:=(p_data->>'before')::timestamptz; before_id uuid:=(p_data->>'before_id')::uuid; target uuid:=(p_data->>'id')::uuid;
begin
  pat:='%'||replace(replace(replace(lower(q),'\','\\'),'%','\%'),'_','\_')||'%';
  if p_action='posts' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id desc),'[]'::jsonb) into items from (
      select p.id,p.category,p.topic,p.title,left(p.body,180) excerpt,p.nickname,p.airline,p.recruit_year,p.stage,p.created_at,p.updated_at,
      (select count(*) from monc_community.comments c where c.post_id=p.id and c.status='published') comments
      from monc_community.posts p where p.status='published'
      and not exists(select 1 from monc_community.interview_experiences e where e.post_id=p.id)
      and (coalesce(p_data->>'category','')='' or p.category=p_data->>'category')
      and (coalesce(p_data->>'topic','')='' or p.topic=p_data->>'topic')
      and (coalesce(p_data->>'airline','')='' or p.airline=p_data->>'airline')
      and (before_time is null or (p.created_at,p.id)<(before_time,coalesce(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      and (q='' or lower(p.title||' '||p.body) like pat or exists(select 1 from monc_community.comments c where c.post_id=p.id and c.status='published' and lower(c.body) like pat))
      order by p.created_at desc,p.id desc limit lim+1
    ) t;
    return jsonb_build_object('ok',true,'items',items,'limit',lim);
  elsif p_action='thread' then
    select jsonb_build_object('id',p.id,'category',p.category,'topic',p.topic,'title',p.title,'body',p.body,'nickname',p.nickname,'airline',p.airline,'year',p.recruit_year,'stage',p.stage,'source_url',p.source_url,'created_at',p.created_at,
      'comments',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'body',case when c.status='deleted' then '삭제된 댓글입니다.' else c.body end,'nickname',c.nickname,'parent_id',c.parent_id,'status',c.status,'created_at',c.created_at) order by c.created_at,c.id) from monc_community.comments c where c.post_id=p.id and c.status<>'hidden'),'[]'::jsonb)) into items
      from monc_community.posts p where p.id=target and p.status='published';
    return jsonb_build_object('ok',true,'item',items);
  elsif p_action='volunteer-counts' then
    if jsonb_typeof(p_data->'ids') is distinct from 'array' then raise exception 'community:bad_volunteer'; end if;
    if jsonb_array_length(p_data->'ids')>30 then raise exception 'community:bad_volunteer'; end if;
    select coalesce(jsonb_object_agg(t.volunteer_id,t.n),'{}'::jsonb) into items from (
      select s.volunteer_id,count(*) n from monc_community.studies s
      where s.study_category='volunteer' and s.status='open' and s.volunteer_id in (select jsonb_array_elements_text(p_data->'ids'))
      group by s.volunteer_id
    ) t;
    return jsonb_build_object('ok',true,'counts',items);
  elsif p_action='studies' then
    select coalesce(jsonb_agg(t.item order by t.created_at desc,t.id desc),'[]'::jsonb) into items from (
      select s.id,s.created_at,monc_community.study_json(s.id) item from monc_community.studies s where s.status in ('open','closed','ended') and (coalesce(p_data->>'recruitment','open')='all' or s.status=coalesce(p_data->>'recruitment','open'))
      and (coalesce(p_data->>'study_category','')='' or s.study_category=p_data->>'study_category')
      and (coalesce(p_data->>'volunteer_id','')='' or (s.study_category='volunteer' and s.volunteer_id=p_data->>'volunteer_id'))
      and (coalesce(p_data->>'mode','')='' or s.mode=p_data->>'mode')
      and (not coalesce((p_data->>'verified')::boolean,false) or s.min_level>0 or s.require_experience)
      and (q='' or lower(s.title||' '||s.goals||' '||s.description||' '||s.location||' '||s.schedule||' '||array_to_string(s.tags,' ')) like pat)
      and (before_time is null or (s.created_at,s.id)<(before_time,coalesce(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by s.created_at desc,s.id desc limit lim+1
    ) t;
    return jsonb_build_object('ok',true,'items',items,'limit',lim);
  elsif p_action='study' then
    return jsonb_build_object('ok',true,'item',(select monc_community.study_json(id) from monc_community.studies where id=target and status<>'hidden'));
  else raise exception 'community:bad_action'; end if;
end $$;

commit;

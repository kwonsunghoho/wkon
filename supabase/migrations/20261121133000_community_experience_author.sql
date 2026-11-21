begin;

-- 화면에 공개되는 본문은 게시글 원장에 보관하고, 질문별 입력값은 작성자 수정에만 쓴다.
alter table monc_community.interview_experiences
  add column video_fields jsonb,
  add column applicant_specs jsonb,
  add column author_body text,
  add column author_body_hash text;

create function monc_community.experience_author(p_action text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid := monc_community.actor();
  target uuid := nullif(p_data->>'id','')::uuid;
  blocked boolean;
  saved_kind text := p_data->>'kind';
  saved_stage text;
  saved_body text;
  saved_nickname text;
  saved_video_fields jsonb;
  saved_specs jsonb;
  saved_author_body text;
  saved_author_body_hash text;
  saved_subject text;
  posted_nickname text;
  answers jsonb;
  specs jsonb;
  extra text := coalesce(p_data->>'body','');
  posted_body text := extra;
  composed text;
  specs_text text;
  result jsonb;
begin
  select pr.blocked into blocked from monc_community.profiles pr where pr.user_id=u;
  if not found then raise exception 'community:profile_required'; end if;
  if blocked then raise exception 'community:blocked'; end if;

  if p_action is distinct from 'draft' and p_action is distinct from 'save' then
    raise exception 'community:bad_action';
  end if;

  if target is not null then
    -- 등록 RPC와 같은 글 행을 잠가 이전 화면의 수정과 닉네임 업데이트가 엇갈리지 않게 한다.
    select e.kind,e.stage,p.body,p.nickname,e.video_fields,e.applicant_specs,e.author_body,e.author_body_hash,e.subject
    into saved_kind,saved_stage,saved_body,saved_nickname,saved_video_fields,saved_specs,saved_author_body,saved_author_body_hash,saved_subject
    from monc_community.posts p join monc_community.interview_experiences e on e.post_id=p.id
    where p.id=target and p.user_id=u and p.status<>'deleted'
    for update of p;
    if not found then raise exception 'community:forbidden' using errcode='42501'; end if;
  end if;

  if p_action='draft' then
    if target is null then raise exception 'community:not_found'; end if;
    if saved_kind='note' and saved_author_body_hash=md5(saved_stage||E'\n'||saved_body) then
      return jsonb_build_object('ok',true,'item',jsonb_build_object(
        'nickname',saved_nickname,'body',saved_author_body,
        'video_fields',saved_video_fields,'applicant_specs',saved_specs));
    end if;
    -- 새 작성창이 생기기 전의 글과 이전 화면에서 바꾼 글은 현재 본문을 유지한다.
    return jsonb_build_object('ok',true,'item',jsonb_build_object(
      'nickname',saved_nickname,'body',saved_body,'video_fields',null,'applicant_specs',null));
  end if;

  posted_nickname:=regexp_replace(coalesce(p_data->>'author_nickname',''),'^[[:space:]]+|[[:space:]]+$','','g');
  if posted_nickname='' then raise exception 'community:nickname_required'; end if;
  if jsonb_typeof(p_data->'author_nickname') is distinct from 'string'
    or char_length(posted_nickname) not between 2 and 16 or posted_nickname ~ '[<>@[:cntrl:]]' then
    raise exception 'community:nickname_invalid';
  end if;

  if saved_kind='note' and p_data->>'stage'='영상' then
    answers:=p_data->'video_fields';
    if answers is null or answers='null'::jsonb then raise exception 'community:video_required'; end if;
    if jsonb_typeof(answers)<>'object' then raise exception 'community:video_invalid'; end if;
    if exists(
      select 1 from jsonb_each(answers) as answer(key,value)
      where answer.key not in ('attempt','duration','result','place','setup','styling','outfit',
        'focus','impact','question','answer_direction','encouragement')
        or jsonb_typeof(answer.value)<>'string' or char_length(answer.value#>>'{}')>500
    ) then raise exception 'community:video_invalid'; end if;

    select coalesce(jsonb_object_agg(answer.key,clean.value),'{}'::jsonb) into answers
    from jsonb_each_text(answers) as answer(key,value)
    cross join lateral (select regexp_replace(answer.value,'^[[:space:]]+|[[:space:]]+$','','g') as value) clean
    where clean.value<>'';

    if nullif(answers->>'result','') is null or char_length(coalesce(answers->>'focus',''))<2 then
      raise exception 'community:video_required';
    end if;
    if answers->>'result' not in ('합격','미합격','결과 대기')
      or (answers ? 'attempt' and answers->>'attempt' not in ('첫 지원','2회','3회','4회 이상')) then
      raise exception 'community:video_invalid';
    end if;

    select string_agg(field.label||E'\n'||(answers->>field.key),E'\n\n' order by field.position) into composed
    from (values
      (1,'attempt','지원 횟수'),
      (2,'duration','첫 지원부터 영상면접 결과까지 걸린 기간'),
      (3,'result','영상면접 결과'),
      (4,'place','촬영 장소'),
      (5,'setup','촬영 세팅'),
      (6,'styling','헤어·메이크업'),
      (7,'outfit','의상'),
      (8,'focus','촬영하면서 가장 많이 고친 점'),
      (9,'impact',case when answers->>'result'='합격' then '영상면접 합격에 도움이 됐다고 느낀 점'
        else '다시 찍는다면 바꾸고 싶은 점' end),
      (10,'question','기억나는 영상면접 질문'),
      (11,'answer_direction','답변 방향'),
      (12,'encouragement','영상면접에 다시 도전하는 승준생에게 한마디')
    ) as field(position,key,label)
    where answers ? field.key;

    extra:=regexp_replace(extra,'^[[:space:]]+|[[:space:]]+$','','g');
    posted_body:=concat_ws(E'\n\n',composed,case when extra<>'' then '추가 내용'||E'\n'||extra end);
  end if;

  if saved_kind='note' and p_data->'applicant_specs' <> 'null'::jsonb then
    specs:=p_data->'applicant_specs';
    if jsonb_typeof(specs)<>'object' then raise exception 'community:specs_invalid'; end if;
    if exists(
      select 1 from jsonb_each(specs) as spec(key,value)
      left join (values ('major',80),('gpa',24),('language',120),('height',24)) as field(key,limit_chars)
        on field.key=spec.key
      where field.key is null or jsonb_typeof(spec.value)<>'string'
        or char_length(spec.value#>>'{}')>field.limit_chars
    ) then raise exception 'community:specs_invalid'; end if;

    select jsonb_object_agg(spec.key,clean.value) into specs
    from jsonb_each_text(specs) as spec(key,value)
    cross join lateral (select regexp_replace(spec.value,'^[[:space:]]+|[[:space:]]+$','','g') as value) clean
    where clean.value<>'';

    if specs is not null then
      select string_agg(field.label||': '||(specs->>field.key),E'\n' order by field.position) into specs_text
      from (values (1,'major','전공'),(2,'gpa','학점'),(3,'language','어학'),(4,'height','키')) as field(position,key,label)
      where specs ? field.key;

      -- 일반 노하우에도 기존 본문 입력 검사를 적용한다.
      if answers is null and char_length(trim(extra))<2 then
        raise exception 'community:body_required' using errcode='23514';
      end if;
      posted_body:=concat_ws(E'\n\n',posted_body,'지원 당시 스펙'||E'\n'||specs_text);
    end if;
  end if;

  if char_length(posted_body)>10000 then
    if answers is not null then raise exception 'community:video_invalid'; end if;
    if specs is not null then raise exception 'community:specs_invalid'; end if;
  end if;

  if target is not null and not (p_data ? 'subject') then
    p_data:=p_data||jsonb_build_object('subject',saved_subject);
  end if;

  -- 작성 권한, 스팸 제한, 기존 요청글 연결, 글 저장은 기존 RPC가 검증한다.
  result:=public.community_experience_member('save',p_data||jsonb_build_object('body',posted_body));
  target:=(result->>'id')::uuid;
  update monc_community.posts p set nickname=posted_nickname
  where p.id=target and p.user_id=u and p.status<>'deleted'
  returning p.body into saved_body;
  if not found then raise exception 'community:forbidden' using errcode='42501'; end if;

  update monc_community.interview_experiences
  set video_fields=answers,applicant_specs=specs,
    author_body=case when answers is not null or specs is not null then extra end,
    author_body_hash=case when answers is not null or specs is not null then md5(stage||E'\n'||saved_body) end
  where post_id=target;
  return result;
end $$;

revoke all on function monc_community.experience_author(text,jsonb) from public,anon,authenticated;
grant execute on function monc_community.experience_author(text,jsonb) to authenticated;

create function public.community_experience_author(p_action text, p_data jsonb default '{}') returns jsonb
language sql security invoker set search_path=''
begin atomic
  select monc_community.experience_author(p_action,p_data);
end;

revoke all on function public.community_experience_author(text,jsonb) from public,anon,authenticated;
grant execute on function public.community_experience_author(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

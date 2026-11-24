-- 마이페이지에는 본인이 현재 열 수 있는 스터디의 받은 피드백 수만 반환한다.
begin;
create function public.my_study_feedback()
returns table(room_id uuid, title text, note_count bigint)
language sql stable security definer set search_path = '' as $$
  select s.id, s.title, count(*)
  from monc_community.room_answers a
  join monc_community.room_tasks t on t.id = a.task_id
  join monc_community.room_notes n on n.answer_id = a.id
  join monc_community.profiles author on author.user_id = n.user_id
  join monc_community.studies s on s.id = t.study_id
  join monc_community.study_members member on member.study_id = s.id and member.user_id = a.user_id
  join monc_community.profiles p on p.user_id = a.user_id and not p.blocked
  join public.members m on m.id = a.user_id and m.terms_version = '2026-10-05'
  where a.user_id = (select monc_community.actor(auth.uid()))
    and s.status in ('open','closed','ended')
  group by s.id, s.title
  order by max(n.created_at) desc, s.id;
$$;
revoke all on function public.my_study_feedback() from public, anon;
grant execute on function public.my_study_feedback() to authenticated;
commit;

-- Only timecodes follow the common editor. The same video must still be assigned
-- to the scheduled round and the specific mission must not yet be released.
create view challenge_room_data.pending_shared_chapter_ranges
with (security_invoker=true) as
select m.id as mission_id, d.challenge, d.day_no, d.start_seconds, d.end_seconds
from challenge_room_data.missions m
join challenge_room_data.curriculum_schedules a on a.round_id=m.round_id
join public.challenge_rounds r on r.id=m.round_id
join challenge_room_data.curriculum_days d on d.challenge=r.challenge and d.day_no=m.day_no
join challenge_room_data.week_videos v on v.round_id=m.round_id and v.week_no=(m.day_no-1)/5+1
join challenge_room_data.curriculum_sources s on s.challenge=d.challenge and s.week_no=v.week_no
where v.curriculum_copy and v.upload_id=s.upload_id and m.opens_at>statement_timestamp();

revoke all on challenge_room_data.pending_shared_chapter_ranges from public, anon, authenticated;

create function challenge_room_data.protect_scheduled_chapter_range()
returns trigger language plpgsql set search_path='' as $guard$
begin
  if tg_op='UPDATE' then
    if new.mission_id=old.mission_id and exists (
      select 1 from challenge_room_data.pending_shared_chapter_ranges d
      where d.mission_id=new.mission_id
        and (d.start_seconds,d.end_seconds)=(new.start_seconds,new.end_seconds)
    ) then return new; end if;
  end if;
  if exists (
    select 1 from challenge_room_data.missions m
    join challenge_room_data.curriculum_schedules a on a.round_id=m.round_id
    where m.id=old.mission_id
  ) then raise exception 'challenge_room:locked'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$guard$;
revoke all on function challenge_room_data.protect_scheduled_chapter_range() from public, anon, authenticated;
create or replace trigger curriculum_locked_chapter before update or delete on challenge_room_data.mission_chapters
  for each row execute function challenge_room_data.protect_scheduled_chapter_range();

create function challenge_room_data.sync_pending_chapter_ranges()
returns trigger language plpgsql set search_path='' as $sync$
begin
  update challenge_room_data.mission_chapters c
  set start_seconds=d.start_seconds, end_seconds=d.end_seconds
  from challenge_room_data.pending_shared_chapter_ranges d
  where d.mission_id=c.mission_id and d.challenge=new.challenge and d.day_no=new.day_no
    and (c.start_seconds,c.end_seconds) is distinct from (d.start_seconds,d.end_seconds);
  return new;
end
$sync$;
revoke all on function challenge_room_data.sync_pending_chapter_ranges() from public, anon, authenticated;
create trigger sync_saved_chapter_ranges after update of start_seconds,end_seconds on challenge_room_data.curriculum_days
  for each row when ((new.start_seconds,new.end_seconds) is distinct from (old.start_seconds,old.end_seconds))
  execute function challenge_room_data.sync_pending_chapter_ranges();

-- Reconcile the already scheduled voice previews with their current saved Day 1.
update challenge_room_data.mission_chapters c
set start_seconds=d.start_seconds, end_seconds=d.end_seconds
from challenge_room_data.pending_shared_chapter_ranges d
where d.mission_id=c.mission_id and d.challenge='voice' and d.day_no=1
  and (c.start_seconds,c.end_seconds) is distinct from (d.start_seconds,d.end_seconds);

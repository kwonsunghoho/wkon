create or replace function public.community_delete_study(p_id uuid, p_title text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := monc_community.actor(auth.uid());
  study_title text;
begin
  if not monc_community.admin(viewer) or not exists (
    select 1 from public.members where id=viewer and terms_version='2026-10-05'
  ) or exists(select 1 from monc_community.profiles where user_id=viewer and blocked) then
    raise exception 'community:forbidden' using errcode='42501';
  end if;
  select title into study_title from monc_community.studies where id=p_id for update;
  if not found then
    return jsonb_build_object('ok',true);
  end if;
  if p_title is distinct from study_title then raise exception 'community:study_changed'; end if;

  delete from monc_community.notices where target_id=p_id;
  delete from monc_community.studies where id=p_id;
  insert into monc_community.audit(actor_id,action,target_id,details)
    values(viewer,'ops:study-delete',p_id,jsonb_build_object('label',study_title));
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.community_delete_study(uuid,text) from public,anon;
grant execute on function public.community_delete_study(uuid,text) to authenticated;

-- 삭제된 스터디의 비공개 첨부만 Storage API로 정리한다. 요청 실패 시 다음 실행에서 다시 확인한다.
create or replace function monc_community.purge_deleted_study_files()
returns void language plpgsql security definer set search_path = '' as $$
declare
  paths text[];
  service_key text;
begin
  select array_agg(name) into paths from (
    select o.name from storage.objects o
    where o.bucket_id='study-room-private'
      and o.name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'
      and exists(select 1 from monc_community.audit a where a.action='ops:study-delete' and a.target_id::text=split_part(o.name,'/',1))
      and not exists(select 1 from monc_community.studies s where s.id::text=split_part(o.name,'/',1))
    order by o.created_at limit 100
  ) pending;
  if paths is null then return; end if;
  select decrypted_secret into strict service_key from vault.decrypted_secrets where name='monc_lab_cleanup_service_role';
  perform net.http_delete(
    url := 'https://apzwauiumhmsvrgffjis.supabase.co/storage/v1/object/study-room-private',
    params := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','apikey',service_key,'Authorization','Bearer '||service_key),
    timeout_milliseconds := 30000, body := jsonb_build_object('prefixes',paths)
  );
end $$;
revoke all on function monc_community.purge_deleted_study_files() from public,anon,authenticated;
select cron.schedule('community-deleted-study-files','38 * * * *','select monc_community.purge_deleted_study_files()');

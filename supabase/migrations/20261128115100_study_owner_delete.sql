create or replace function public.community_delete_study(p_id uuid, p_title text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := monc_community.actor(auth.uid());
  study_title text;
  study_owner uuid;
begin
  if not exists (
    select 1 from public.members where id=viewer and terms_version='2026-10-05'
  ) or exists(select 1 from monc_community.profiles where user_id=viewer and blocked) then
    raise exception 'community:forbidden' using errcode='42501';
  end if;
  select title,owner_id into study_title,study_owner from monc_community.studies where id=p_id for update;
  if not found then
    return jsonb_build_object('ok',true);
  end if;
  if viewer is distinct from study_owner and not monc_community.admin(viewer) then
    raise exception 'community:forbidden' using errcode='42501';
  end if;
  if p_title is distinct from study_title then raise exception 'community:study_changed'; end if;

  delete from monc_community.notices where target_id=p_id;
  delete from monc_community.studies where id=p_id;
  insert into monc_community.audit(actor_id,action,target_id,details)
    values(viewer,'ops:study-delete',p_id,jsonb_build_object('label',study_title,'actor_role',case when monc_community.admin(viewer) then 'admin' else 'owner' end));
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.community_delete_study(uuid,text) from public,anon;
grant execute on function public.community_delete_study(uuid,text) to authenticated;


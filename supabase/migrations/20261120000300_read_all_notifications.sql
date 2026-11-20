create function public.read_all_notifications(p_user_id text) returns jsonb
language plpgsql set search_path='' as $$
begin
  insert into public.notification_reads(user_id,notification_id)
  select p_user_id,n.id
  from public.notifications n
  where public.can_read_notification(p_user_id,n)
    and not exists(
      select 1 from public.notification_reads r
      where r.user_id=p_user_id and r.notification_id=n.id
    )
  on conflict do nothing;

  return public.notification_feed(p_user_id,0);
end;
$$;

revoke all on function public.read_all_notifications(text) from public,anon,authenticated;
grant execute on function public.read_all_notifications(text) to service_role;

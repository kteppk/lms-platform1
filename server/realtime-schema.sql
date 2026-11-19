-- Native VPS only. Signals contain routing keys, never message/profile contents.
create or replace function public.lms_realtime_signal() returns trigger
language plpgsql set search_path='' as $$
declare d jsonb; prior jsonb; topic text; gid text; owner_id text; teacher_id text;
begin
 d:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 prior:=case when tg_op='UPDATE' then to_jsonb(old) else d end;
 if tg_op='UPDATE' and d=prior then return null;end if;
 if tg_table_name in ('news_posts','news_likes') then topic:='news';
 elsif tg_table_name='curator_messages' then topic:='chat';
 elsif tg_table_name='curator_chat_reads' then topic:='chat-unread';owner_id:=d->>'user_id';
 elsif tg_table_name='study_groups' then
  if tg_op<>'UPDATE' or (d->>'name',d->>'course',d->>'program',d->>'lessons_per_day') is distinct from (prior->>'name',prior->>'course',prior->>'program',prior->>'lessons_per_day') then
   perform pg_catalog.pg_notify('lms_changes',jsonb_build_object('kind','groups')::text);
  end if;
  topic:='schedule';gid:=d->>'id';
 elsif tg_table_name in ('weekly_schedule_cells','group_lesson_times') then topic:='schedule';gid:=d->>'group_id';
 elsif tg_table_name='schedule_entries' then
  for gid in select g.id from public.study_groups g where lower(g.name) in(lower(d->>'group_name'),lower(prior->>'group_name')) loop
   perform pg_catalog.pg_notify('lms_changes',jsonb_build_object('kind','schedule','groupId',gid)::text);
  end loop;
  return null;
 elsif tg_table_name='notifications' then
  if d->>'recipient_id' is null and d->>'category'<>'announcement' then return null;end if;
  topic:='notices';owner_id:=d->>'recipient_id';
 elsif tg_table_name='notification_reads' then topic:='notices';owner_id:=d->>'user_id';
 elsif tg_table_name in ('notification_subscriptions','lesson_reminder_subscriptions','push_devices') then topic:='subscriptions';owner_id:=d->>'user_id';
 elsif tg_table_name='test_results' then topic:='results';owner_id:=d->>'student_id';teacher_id:=d->>'teacher_id';
 elsif tg_table_name='test_result_reviews' then
  select r.student_id,r.teacher_id into owner_id,teacher_id from public.test_results r where r.id=d->>'result_id';topic:='results';
 elsif tg_table_name='test_grading_scales' then
  perform pg_catalog.pg_notify('lms_changes',jsonb_build_object('kind','results','userId',r.student_id,'teacherId',r.teacher_id)::text)
  from (select distinct student_id,teacher_id from public.test_results where test_id=d->>'test_id') r;
  return null;
 elsif tg_table_name in ('subjects','subject_teachers','materials','tests') then topic:='content';
 elsif tg_table_name='portal_settings' then topic:='settings';
 elsif tg_table_name='role_changes' then topic:='accounts';
 elsif tg_table_name='account_roles' then
  perform pg_catalog.pg_notify('lms_changes',jsonb_build_object('kind','permissions','userId',d->>'user_id')::text);
  perform pg_catalog.pg_notify('lms_changes','{"kind":"content"}');
  perform pg_catalog.pg_notify('lms_changes','{"kind":"accounts"}');topic:='people';
 else
  owner_id:=coalesce(d->>'user_id',d->>'teacher_id',d->>'id');
  perform pg_catalog.pg_notify('lms_changes',jsonb_build_object('kind','profile','userId',owner_id)::text);
  perform pg_catalog.pg_notify('lms_changes','{"kind":"accounts"}');topic:='people';owner_id:=null;
 end if;
 perform pg_catalog.pg_notify('lms_changes',jsonb_strip_nulls(jsonb_build_object('kind',topic,'groupId',gid,'userId',owner_id,'teacherId',teacher_id))::text);
 if tg_op='UPDATE' and tg_table_name in ('weekly_schedule_cells','group_lesson_times') and prior->>'group_id' is distinct from gid then
  perform pg_catalog.pg_notify('lms_changes',jsonb_build_object('kind','schedule','groupId',prior->>'group_id')::text);
 end if;
 return null;
end; $$;
revoke all on function public.lms_realtime_signal() from public,anon,authenticated;
grant execute on function public.lms_realtime_signal() to lms_backend;
do $$ declare t text;begin
 foreach t in array array['news_posts','news_likes','curator_messages','curator_chat_reads','study_groups','weekly_schedule_cells','group_lesson_times','schedule_entries',
 'notifications','notification_reads','notification_subscriptions','lesson_reminder_subscriptions','push_devices','test_results','test_result_reviews','test_grading_scales',
 'subjects','subject_teachers','materials','tests','profiles','account_roles','teacher_profiles','teacher_documents','account_avatars','education_profiles','portal_settings','role_changes','teachers'] loop
  execute format('drop trigger if exists lms_realtime on public.%I',t);
  execute format('create trigger lms_realtime after insert or update or delete on public.%I for each row execute function public.lms_realtime_signal()',t);
 end loop;
end; $$;

create or replace function app_auth.lms_realtime_signal() returns trigger language plpgsql set search_path='' as $$
declare d jsonb;
begin
 d:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='sessions' then
  perform pg_catalog.pg_notify('lms_changes',jsonb_build_object('kind','session','userId',d->>'user_id')::text);
 elsif tg_table_name='users' then
  if tg_op<>'UPDATE' or (new.disabled,new.token_version,new.email) is distinct from (old.disabled,old.token_version,old.email) then
   perform pg_catalog.pg_notify('lms_changes',jsonb_build_object('kind','session','userId',d->>'id')::text);
   perform pg_catalog.pg_notify('lms_changes','{"kind":"accounts"}');
  end if;
 else perform pg_catalog.pg_notify('lms_changes','{"kind":"accounts"}');end if;
 return null;
end; $$;
revoke all on function app_auth.lms_realtime_signal() from public,anon,authenticated;
grant execute on function app_auth.lms_realtime_signal() to lms_backend;
drop trigger if exists lms_realtime on app_auth.users;
create trigger lms_realtime after insert or update or delete on app_auth.users for each row execute function app_auth.lms_realtime_signal();
drop trigger if exists lms_realtime on app_auth.sessions;
create trigger lms_realtime after delete on app_auth.sessions for each row execute function app_auth.lms_realtime_signal();
drop trigger if exists lms_realtime on app_auth.recovery_requests;
create trigger lms_realtime after insert or update or delete on app_auth.recovery_requests for each row execute function app_auth.lms_realtime_signal();

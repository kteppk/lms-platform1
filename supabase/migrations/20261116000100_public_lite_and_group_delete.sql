-- Serialize deletion with cell edits using the same existing group-row lock.
alter table public.study_groups add column revision integer not null default 0 check(revision>=0);
create function public.bump_schedule_group_revision() returns trigger language plpgsql set search_path='' as $$
begin
 update public.study_groups set revision=revision+1 where id=case when tg_op='DELETE' then old.group_id else new.group_id end;
 return case when tg_op='DELETE' then old else new end;
end; $$;
create trigger schedule_group_revision after insert or update or delete on public.weekly_schedule_cells
for each row execute function public.bump_schedule_group_revision();

create function public.delete_schedule_group(p_actor_id text,p_group_id text,p_revision integer,p_name text) returns jsonb
language plpgsql set search_path='' as $$
declare target public.study_groups; pairs integer; dated integer;
begin
 if not exists(select 1 from public.account_roles where user_id=p_actor_id and role='admin') then
  raise exception using errcode='42501',message='Только администратор может удалять группы.';
 end if;
 select * into target from public.study_groups where id=p_group_id for update;
 if not found then raise exception using errcode='P0002',message='Группа уже удалена.'; end if;
 if p_revision is null or target.revision<>p_revision or p_name is distinct from target.name then
  raise exception using errcode='PT409',message='Расписание группы изменилось. Обновите его перед удалением.';
 end if;
 insert into public.notifications(actor_id,recipient_id,category,title,body,destination,dedupe_key)
 select p_actor_id,s.user_id,'schedule','Группа '||target.name||' удалена из расписания',
  'Администратор удалил группу. Выберите другое расписание при необходимости.','schedule','deleted-group:'||target.id||':'||s.user_id
 from public.notification_subscriptions s where s.group_id=target.id and s.scope='group' on conflict(dedupe_key) do nothing;
 delete from public.notification_subscriptions where group_id=target.id;
 delete from public.weekly_schedule_cells where group_id=target.id;get diagnostics pairs=row_count;
 delete from public.schedule_entries where group_name=target.name;get diagnostics dated=row_count;
 delete from public.study_groups where id=target.id;
 return jsonb_build_object('id',target.id,'name',target.name,'cells',pairs,'dated',dated);
end; $$;

-- Deliberate public projection: no accounts, email, files, results or recipient notices.
create function public.lite_public_snapshot(p_view text,p_group_id text,p_week date,p_offset integer,p_post_id text) returns jsonb
language plpgsql stable set search_path='' as $$
declare groups jsonb; feed jsonb; timetable jsonb; target public.study_groups;
begin
 if p_view not in ('bootstrap','schedule','news','post') or p_offset is null or p_offset<0 or p_offset>10000
  or p_week is null or extract(isodow from p_week)<>1 then raise exception using errcode='22023',message='Некорректный запрос.';end if;
 if p_view='post' then
  select jsonb_build_object('id',id,'title',title,'body',body,'channel',channel,'kind',kind,'publishedAt',published_at) into feed
  from public.news_posts where id=p_post_id and published_at<=now();
  if feed is null then raise exception using errcode='P0002',message='Новость не найдена.';end if;
  return jsonb_build_object('post',feed);
 end if;
 if p_view='bootstrap' then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'course',course,'program',program,'lessonsPerDay',lessons_per_day) order by name,id),'[]'::jsonb)
  into groups from public.study_groups;
 end if;
 if p_view in ('bootstrap','schedule') and p_group_id is not null then
  select * into target from public.study_groups where id=p_group_id;
  if not found then raise exception using errcode='P0002',message='Группа не найдена.';end if;
  timetable:=jsonb_build_object('group',jsonb_build_object('id',target.id,'name',target.name,'course',target.course,'lessonsPerDay',target.lessons_per_day),
   'week',p_week,'cells',coalesce((select jsonb_agg(jsonb_build_object('day',weekday,'number',lesson_number,'state',status,'title',title,
    'teacher',teacher_label,'room',room,'note',note,'start',starts_at,'end',ends_at) order by weekday,lesson_number)
    from public.weekly_schedule_cells where group_id=target.id),'[]'::jsonb),
   'dated',coalesce((select jsonb_agg(jsonb_build_object('date',lesson_date,'start',starts_at,'end',ends_at,'title',title,'room',room,'note',note) order by lesson_date,starts_at,id)
    from public.schedule_entries where group_name=target.name and lesson_date between p_week and p_week+6),'[]'::jsonb));
 end if;
 if p_view in ('bootstrap','news') then
  select coalesce(jsonb_agg(to_jsonb(n) order by n."publishedAt" desc,n.id),'[]'::jsonb) into feed from (
   select id,channel,kind,title,left(body,480) as excerpt,char_length(body)>480 as "hasFullText",published_at as "publishedAt"
   from public.news_posts where published_at<=now() order by published_at desc,id limit 11 offset p_offset) n;
 end if;
 return jsonb_strip_nulls(jsonb_build_object('groups',groups,'schedule',timetable,'news',case when feed is null then null else
  jsonb_build_object('rows',feed-10,'hasMore',jsonb_array_length(feed)>10,'offset',p_offset) end));
end; $$;
revoke all on function public.bump_schedule_group_revision(),public.delete_schedule_group(text,text,integer,text),
 public.lite_public_snapshot(text,text,date,integer,text) from public,anon,authenticated;
grant execute on function public.delete_schedule_group(text,text,integer,text),public.lite_public_snapshot(text,text,date,integer,text) to service_role;

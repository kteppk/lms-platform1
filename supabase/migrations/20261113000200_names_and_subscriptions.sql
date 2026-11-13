-- Preserve existing full names as unconfirmed legacy values; never guess their parts.
alter table public.profiles
  add column first_name_raw text,
  add column last_name_raw text,
  add column patronymic_raw text,
  add column patronymic_status text not null default 'unknown' check(patronymic_status in ('provided','absent','unknown')),
  add column name_revision integer not null default 0 check(name_revision>=0),
  add column name_confirmed_at timestamptz,
  add constraint profile_name_parts check(
    (name_confirmed_at is null or (first_name_raw is not null and last_name_raw is not null)) and
    (first_name_raw is null or char_length(first_name_raw) between 1 and 256) and
    (last_name_raw is null or char_length(last_name_raw) between 1 and 256) and
    ((patronymic_status='provided' and patronymic_raw is not null and char_length(patronymic_raw) between 1 and 256)
      or (patronymic_status in ('absent','unknown') and patronymic_raw is null))
  );
alter table public.profiles drop constraint profiles_name_check;
alter table public.profiles add constraint profiles_name_check check(char_length(name) between 1 and 800);
update public.profiles set patronymic_status='absent' where no_patronymic;
-- A linked teacher's full display name can be longer than the former nickname.
alter table public.weekly_schedule_cells drop constraint weekly_schedule_cells_teacher_label_check;
alter table public.weekly_schedule_cells add constraint weekly_schedule_cells_teacher_label_check check(char_length(teacher_label)<=800);
do $$ declare definition text;
begin
  definition:=pg_get_functiondef('public.save_schedule_cell(text,text,integer,integer,text,integer,jsonb)'::regprocedure);
  execute replace(definition,'char_length(teacher_name)>120','char_length(teacher_name)>800');
end; $$;

alter table public.notifications
  add column category text not null default 'legacy' check(category in ('legacy','personal','schedule','announcement','profile')),
  add column context jsonb not null default '{}' check(jsonb_typeof(context)='object');
-- Private history stays private. Explicit administrator announcements remain global.
update public.notifications set category='personal' where recipient_id is not null;
update public.notifications set category='announcement' where recipient_id is null and destination='notifications';
update public.notifications set category='profile',title='Проверьте данные профиля',severity='info',
  body='Теперь имя, фамилия и необязательное отчество заполняются отдельно. Подтвердите свои данные в профиле.'
where dedupe_key like 'name:%';
alter table public.notifications add constraint notification_audience check(
  (category not in ('personal','schedule','profile') or recipient_id is not null)
  and (category<>'announcement' or recipient_id is null));

create or replace function public.sync_name_notice() returns trigger language plpgsql set search_path='' as $$
begin
  -- Profile completion is an inline prompt, not a repeating red notification.
  if tg_op='INSERT' then
    insert into public.notifications(actor_id,recipient_id,category,title,body,destination,dedupe_key)
    values(new.id,new.id,'personal','Добро пожаловать в КТЭиП ПК','Кабинет студента готов. Выберите предметы и подпишитесь на нужное расписание.','home','welcome:'||new.id);
  end if;
  if new.name_confirmed_at is not null then
    delete from public.notifications where recipient_id=new.id and dedupe_key='name:'||new.id;
  end if;
  return new;
end; $$;
drop trigger profile_name_notice on public.profiles;
create trigger profile_name_notice after insert or update of name,name_confirmed_at on public.profiles
for each row execute function public.sync_name_notice();

create function public.save_profile_name(p_user_id text,p_revision integer,p_first text,p_last text,p_patronymic text,p_status text,p_display text)
returns jsonb language plpgsql set search_path='' as $$
declare result public.profiles;
begin
  if p_revision is null or p_revision<0 or p_first is null or p_last is null or p_display is null
    or char_length(btrim(p_first)) not between 1 and 256 or char_length(btrim(p_last)) not between 1 and 256
    or char_length(btrim(p_display)) not between 1 and 800 or p_status is null or p_status not in ('provided','absent','unknown')
    or (p_status='provided' and (p_patronymic is null or char_length(btrim(p_patronymic)) not between 1 and 256))
    or (p_status<>'provided' and p_patronymic is not null) then
    raise exception using errcode='22023',message='Проверьте поля имени, фамилии и отчества.';
  end if;
  update public.profiles set first_name_raw=p_first,last_name_raw=p_last,patronymic_raw=p_patronymic,patronymic_status=p_status,
    name=p_display,no_patronymic=(p_status='absent'),name_revision=name_revision+1,name_confirmed_at=now()
  where id=p_user_id and name_revision=p_revision returning * into result;
  if not found then raise exception using errcode='PT409',message='Данные профиля уже изменены. Откройте профиль заново перед сохранением.'; end if;
  return to_jsonb(result)-'email';
end; $$;

create table public.notification_subscriptions (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references public.profiles(id) on delete cascade,
  scope text not null check(scope in ('group','subject','mine')),
  group_id text references public.study_groups(id) on delete cascade,
  subject_id text references public.subjects(id),
  subject_title text,
  subject_key text,
  created_at timestamptz not null default now(),
  check((scope='group' and group_id is not null and subject_title is null and subject_key is null and subject_id is null)
    or (scope='subject' and group_id is not null and subject_title is not null and subject_key is not null and char_length(subject_title) between 1 and 200 and char_length(subject_key)>0)
    or (scope='mine' and group_id is null and subject_title is null and subject_key is null and subject_id is null))
);
create unique index notification_group_subscription on public.notification_subscriptions(user_id,group_id) where scope='group';
create unique index notification_subject_subscription on public.notification_subscriptions(user_id,group_id,subject_key) where scope='subject';
create unique index notification_my_subscription on public.notification_subscriptions(user_id) where scope='mine';
create index notification_subscription_group on public.notification_subscriptions(group_id);

create function public.notification_subject_key(p_title text) returns text language sql immutable set search_path='' as $$
  select lower(btrim(regexp_replace(coalesce(p_title,''),'[[:space:]]+',' ','g')));
$$;
create function public.list_notification_subscriptions(p_user_id text) returns jsonb language sql set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'scope',s.scope,'group_id',s.group_id,'group_name',g.name,
    'subject_id',s.subject_id,'subject_title',s.subject_title,'created_at',s.created_at) order by g.name,s.subject_title,s.id),'[]'::jsonb)
  from public.notification_subscriptions s left join public.study_groups g on g.id=s.group_id where s.user_id=p_user_id;
$$;
create function public.add_notification_subscription(p_user_id text,p_scope text,p_group_id text,p_subject_id text,p_subject_title text)
returns jsonb language plpgsql set search_path='' as $$
declare result public.notification_subscriptions; v_subject_key text;
begin
  if not exists(select 1 from public.profiles where id=p_user_id) then raise exception using errcode='42501',message='Войдите в аккаунт.'; end if;
  if p_scope is null or p_scope not in ('group','subject','mine') then raise exception using errcode='22023',message='Выберите тип подписки.'; end if;
  if p_scope='mine' then
    if not exists(select 1 from public.account_roles r join public.teachers t on t.user_id=r.user_id where r.user_id=p_user_id and r.role in ('teacher','admin')) then
      raise exception using errcode='42501',message='Подписка на свои занятия доступна преподавателю.';
    end if;
    insert into public.notification_subscriptions(user_id,scope) values(p_user_id,'mine') on conflict do nothing;
    select * into result from public.notification_subscriptions where user_id=p_user_id and scope='mine';
  else
    if not exists(select 1 from public.study_groups where id=p_group_id) then raise exception using errcode='P0002',message='Группа не найдена.'; end if;
    if p_scope='subject' then
      v_subject_key:=public.notification_subject_key(p_subject_title);
      if p_subject_title is null or char_length(p_subject_title)>200 or v_subject_key='' then raise exception using errcode='22023',message='Укажите предмет для подписки.'; end if;
      if p_subject_id is not null and not exists(select 1 from public.subjects where id=p_subject_id and archived_at is null) then raise exception using errcode='22023',message='Предмет недоступен.'; end if;
      insert into public.notification_subscriptions(user_id,scope,group_id,subject_id,subject_title,subject_key)
      values(p_user_id,p_scope,p_group_id,p_subject_id,btrim(p_subject_title),v_subject_key) on conflict do nothing;
      select s.* into result from public.notification_subscriptions s where user_id=p_user_id and scope=p_scope and group_id=p_group_id and s.subject_key=v_subject_key;
    else
      insert into public.notification_subscriptions(user_id,scope,group_id) values(p_user_id,p_scope,p_group_id) on conflict do nothing;
      select * into result from public.notification_subscriptions where user_id=p_user_id and scope=p_scope and group_id=p_group_id;
    end if;
  end if;
  return to_jsonb(result);
end; $$;

create function public.schedule_notice_description(p_row jsonb) returns text language sql stable set search_path='' as $$
  select case when p_row is null or p_row->>'status'='free' then 'Нет пары' else
    coalesce(p_row->>'title','Занятие')
    ||case when teacher<>'' then ' · '||left(teacher,120)||case when char_length(teacher)>120 then '…' else '' end else '' end
    ||case when coalesce(p_row->>'room','')<>'' then ' · Каб. '||(p_row->>'room') else '' end
    ||case when p_row->>'lesson_date' is not null then ' · '||(p_row->>'lesson_date') else '' end
    ||case when p_row->>'starts_at' is not null then ' · '||left(p_row->>'starts_at',5)||'–'||left(p_row->>'ends_at',5) else '' end end
  from (select coalesce(nullif(p_row->>'teacher_label',''),(select p.name from public.profiles p where p.id=p_row->>'teacher_id'),'') teacher) n;
$$;
create function public.publish_schedule_change(p_group_id text,p_weekday integer,p_lesson integer,p_before jsonb,p_after jsonb,p_actor_id text,p_date date default null)
returns void language plpgsql set search_path='' as $$
declare group_name text; event_id text:=gen_random_uuid()::text; old_title text:=coalesce(p_before->>'title',''); new_title text:=coalesce(p_after->>'title',''); message text;
begin
  if p_group_id is null then return; end if;
  select name into group_name from public.study_groups where id=p_group_id;
  if not found then return; end if;
  message:=case when p_date is not null then p_date::text else (array['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'])[p_weekday] end
    ||case when p_lesson is not null then ' · '||p_lesson||' пара' else '' end
    ||case when p_before is not null then E'\nБыло: '||public.schedule_notice_description(p_before) else '' end
    ||E'\nСтало: '||public.schedule_notice_description(p_after);
  insert into public.notifications(actor_id,recipient_id,category,title,body,destination,context,dedupe_key)
  select p_actor_id,recipient.user_id,'schedule','Изменение расписания · группа '||group_name,message,'schedule',
    jsonb_build_object('groupId',p_group_id,'weekday',p_weekday,'lessonNumber',p_lesson),event_id||':'||recipient.user_id
  from (select distinct s.user_id from public.notification_subscriptions s where
    (s.scope='group' and s.group_id=p_group_id)
    or (s.scope='subject' and s.group_id=p_group_id and (
      (s.subject_id is not null and s.subject_id in(p_before->>'subject_id',p_after->>'subject_id'))
      or ((s.subject_id is null or p_before->>'subject_id' is null) and s.subject_key=public.notification_subject_key(old_title))
      or ((s.subject_id is null or p_after->>'subject_id' is null) and s.subject_key=public.notification_subject_key(new_title))))
    or (s.scope='mine' and s.user_id in(p_before->>'teacher_id',p_after->>'teacher_id')
      and exists(select 1 from public.account_roles r join public.teachers t on t.user_id=r.user_id where r.user_id=s.user_id and r.role in ('teacher','admin')))
  ) recipient;
end; $$;
create or replace function public.notify_weekly_schedule() returns trigger language plpgsql set search_path='' as $$
begin
  perform public.publish_schedule_change(new.group_id,new.weekday,new.lesson_number,
    case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new),new.updated_by);
  return new;
end; $$;

create or replace function public.notify_platform_change() returns trigger language plpgsql set search_path='' as $$
declare row_data jsonb; old_group_id text; new_group_id text;
begin
  row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name='test_results' then
    if tg_op='UPDATE' and new.review_revision=old.review_revision then return new; end if;
    insert into public.notifications(actor_id,recipient_id,category,title,body,destination)
    values(row_data->>'teacher_id',row_data->>'student_id','personal',
      case when row_data->>'status'='pending_review' then 'Работа ожидает проверки' else 'Результат работы готов' end,row_data->>'test_title','results');
    if tg_op='INSERT' and new.status='pending_review' then
      insert into public.notifications(actor_id,recipient_id,category,title,body,destination)
      values(new.student_id,new.teacher_id,'personal','Новая работа на проверку',new.test_title,'journal');
    end if;
  elsif tg_table_name='schedule_entries' then
    if tg_op<>'INSERT' then select g.id into old_group_id from public.study_groups g where public.notification_subject_key(g.name)=public.notification_subject_key(old.group_name); end if;
    if tg_op<>'DELETE' then select g.id into new_group_id from public.study_groups g where public.notification_subject_key(g.name)=public.notification_subject_key(new.group_name); end if;
    if old_group_id is not distinct from new_group_id then
      perform public.publish_schedule_change(coalesce(new_group_id,old_group_id),null,null,case when tg_op<>'INSERT' then to_jsonb(old) else null end,
        case when tg_op<>'DELETE' then to_jsonb(new) else null end,row_data->>'created_by',(row_data->>'lesson_date')::date);
    else
      if old_group_id is not null then perform public.publish_schedule_change(old_group_id,null,null,to_jsonb(old),null,row_data->>'created_by',old.lesson_date); end if;
      if new_group_id is not null then perform public.publish_schedule_change(new_group_id,null,null,null,to_jsonb(new),row_data->>'created_by',new.lesson_date); end if;
    end if;
  end if;
  -- Catalog/profile/material edits are visible in their sections, not broadcast.
  return case when tg_op='DELETE' then old else new end;
end; $$;

create function public.can_read_notification(p_user_id text,n public.notifications) returns boolean
language sql stable set search_path='' as $$
  select n.recipient_id=p_user_id or (n.recipient_id is null and n.category='announcement');
$$;
create or replace function public.notification_feed(p_user_id text,p_offset integer default 0) returns jsonb language sql set search_path='' as $$
select jsonb_build_object('unreadCount',(select count(*) from public.notifications n where public.can_read_notification(p_user_id,n)
  and not exists(select 1 from public.notification_reads r where r.notification_id=n.id and r.user_id=p_user_id)),
  'rows',coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc,page.id) from (
    select n.id,n.title,n.body,n.severity,n.destination,n.category,n.context,n.created_at,
      exists(select 1 from public.notification_reads r where r.notification_id=n.id and r.user_id=p_user_id) as read
    from public.notifications n where public.can_read_notification(p_user_id,n)
    order by n.created_at desc,n.id limit 50 offset p_offset) page),'[]'::jsonb));
$$;
create or replace function public.read_notifications(p_user_id text,p_ids jsonb) returns void language sql set search_path='' as $$
insert into public.notification_reads(user_id,notification_id)
select p_user_id,n.id from public.notifications n where public.can_read_notification(p_user_id,n)
and n.id in(select jsonb_array_elements_text(p_ids)) on conflict do nothing;
$$;

-- Keep administrator changes in the existing audit log; only welcome the affected account.
do $$ declare definition text;
begin
  definition:=pg_get_functiondef('public.set_account_role(text,text,text,text)'::regprocedure);
  definition:=replace(replace(definition,'''Роль аккаунта изменена''','''Ваш доступ обновлён'''),
    '''Администратор назначил вам роль: ''','''Вам доступен кабинет ''');
  definition:=replace(definition,'then ''администратор'' when ''teacher'' then ''преподаватель'' else ''студент'' end',
    'then ''администратора'' when ''teacher'' then ''преподавателя'' else ''студента'' end');
  definition:=replace(definition,'insert into public.notifications(actor_id,recipient_id,title,body,destination)',
    'insert into public.notifications(actor_id,recipient_id,category,title,body,destination)');
  definition:=replace(definition,'values(p_actor_id,p_user_id,''Ваш доступ обновлён''','values(p_actor_id,p_user_id,''personal'',''Ваш доступ обновлён''');
  execute definition;
end; $$;
create function public.role_change_log(p_actor_id text,p_offset integer default 0) returns jsonb language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.account_roles where user_id=p_actor_id and role='admin') then raise exception using errcode='42501',message='Только для администратора.'; end if;
  return coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc,page.id) from (
    select c.id,c.old_role,c.new_role,c.created_at,a.name actor_name,u.name user_name
    from public.role_changes c join public.profiles a on a.id=c.actor_id join public.profiles u on u.id=c.user_id
    order by c.created_at desc,c.id limit 50 offset p_offset) page),'[]'::jsonb);
end; $$;
create or replace function public.list_accounts(p_actor_id text,p_search text,p_offset integer default 0) returns jsonb language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.account_roles where user_id=p_actor_id and role='admin') then raise exception using errcode='42501',message='Недостаточно прав.'; end if;
  return coalesce((select jsonb_agg(to_jsonb(page) order by page.name,page.id) from (
    select p.id,p.name,p.email,r.role,p.name_confirmed_at is null as needs_name
    from public.profiles p join public.account_roles r on r.user_id=p.id
    where p_search='' or strpos(lower(p.name||' '||p.email),lower(p_search))>0
    order by p.name,p.id limit 50 offset p_offset) page),'[]'::jsonb);
end; $$;

alter table public.notification_subscriptions enable row level security;
revoke all on public.notification_subscriptions from public,anon,authenticated;
grant select,insert,delete on public.notification_subscriptions to service_role;
revoke all on function public.save_profile_name(text,integer,text,text,text,text,text),public.notification_subject_key(text),
  public.list_notification_subscriptions(text),public.add_notification_subscription(text,text,text,text,text),
  public.publish_schedule_change(text,integer,integer,jsonb,jsonb,text,date),public.schedule_notice_description(jsonb),public.can_read_notification(text,public.notifications),
  public.role_change_log(text,integer) from public,anon,authenticated;
grant execute on function public.save_profile_name(text,integer,text,text,text,text,text),public.notification_subject_key(text),
  public.list_notification_subscriptions(text),public.add_notification_subscription(text,text,text,text,text),
  public.publish_schedule_change(text,integer,integer,jsonb,jsonb,text,date),public.schedule_notice_description(jsonb),public.can_read_notification(text,public.notifications),
  public.role_change_log(text,integer) to service_role;

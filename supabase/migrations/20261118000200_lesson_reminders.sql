alter table public.notifications drop constraint notifications_category_check;
alter table public.notifications add constraint notifications_category_check check(category in ('legacy','personal','schedule','announcement','profile','lesson'));
alter table public.notifications drop constraint notification_audience;
alter table public.notifications add constraint notification_audience check((category not in ('personal','schedule','profile','lesson') or recipient_id is not null) and (category<>'announcement' or recipient_id is null));
alter table public.push_devices add column lessons boolean not null default false;
create table public.lesson_reminder_subscriptions(
 user_id text not null references public.profiles(id) on delete cascade,group_id text not null references public.study_groups(id) on delete cascade,
 accepted_warning integer not null check(accepted_warning=1),created_at timestamptz not null default now(),primary key(user_id,group_id)
);
create function public.set_lesson_reminder(p_user text,p_group text,p_enabled boolean,p_acknowledged boolean) returns void language plpgsql set search_path='' as $$
begin
 perform 1 from public.profiles where id=p_user for update;if not found then raise exception using errcode='42501',message='Войдите в аккаунт.';end if;
 if not exists(select 1 from public.study_groups where id=p_group) then raise exception using errcode='P0002',message='Группа не найдена.';end if;
 if p_enabled is null then raise exception using errcode='22023',message='Укажите состояние напоминаний.';end if;
 if p_enabled then
  if p_acknowledged is distinct from true then raise exception using errcode='22023',message='Подтвердите предупреждение о неточности расписания.';end if;
  if not exists(select 1 from public.push_devices where user_id=p_user and lessons) then raise exception using errcode='22023',message='Сначала подключите уведомления на устройстве.';end if;
  insert into public.lesson_reminder_subscriptions(user_id,group_id,accepted_warning) values(p_user,p_group,1) on conflict do nothing;
 else delete from public.lesson_reminder_subscriptions where user_id=p_user and group_id=p_group;end if;
end; $$;
drop function public.save_push_device(text,text,text,text,boolean,boolean);
create function public.save_push_device(p_user text,p_endpoint text,p_key text,p_auth text,p_schedule boolean,p_announcements boolean,p_lessons boolean default null) returns jsonb language plpgsql set search_path='' as $$
declare result public.push_devices;prior_owner text;
begin
 perform 1 from public.profiles where id=p_user for update;if not found then raise exception using errcode='42501',message='Войдите в аккаунт.';end if;
 if (select count(*) from public.push_devices where user_id=p_user and endpoint<>p_endpoint)>=5 then raise exception using errcode='22023',message='Уже подключено пять устройств.';end if;
 select user_id into prior_owner from public.push_devices where endpoint=p_endpoint for update;
 if prior_owner is not null and prior_owner<>p_user then delete from public.push_devices where endpoint=p_endpoint;end if;
 insert into public.push_devices(user_id,endpoint,p256dh,auth,schedule,announcements,lessons) values(p_user,p_endpoint,p_key,p_auth,p_schedule,p_announcements,coalesce(p_lessons,false))
 on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,schedule=excluded.schedule,announcements=excluded.announcements,lessons=coalesce(p_lessons,push_devices.lessons),updated_at=now() returning * into result;
 return jsonb_build_object('id',result.id,'schedule',result.schedule,'announcements',result.announcements,'lessons',result.lessons);
end; $$;

-- Same effective schedule powers the screen, export and reminders; no guessed clocks.
create function public.lesson_events_for_day(p_day date) returns table(event_key text,group_id text,group_name text,title text,room text,starts_at timestamptz,fingerprint text) language sql stable set search_path='' as $$
 select 'w:'||c.id,c.group_id,g.name,c.title,c.room,(p_day+c.starts_at) at time zone 'Asia/Krasnoyarsk',md5(concat_ws('|',c.title,c.room,c.starts_at))
 from public.effective_weekly_schedule c join public.study_groups g on g.id=c.group_id
 where c.status='lesson' and c.starts_at is not null and c.weekday=extract(isodow from p_day) and not exists(select 1 from public.schedule_entries d where d.group_name=g.name and d.lesson_date=p_day and d.starts_at=c.starts_at)
 union all
 select 'd:'||d.id,g.id,g.name,d.title,d.room,(p_day+d.starts_at) at time zone 'Asia/Krasnoyarsk',md5(concat_ws('|',d.title,d.room,d.starts_at))
 from public.schedule_entries d join public.study_groups g on g.name=d.group_name where d.lesson_date=p_day;
$$;
create function public.enqueue_lesson_reminders(p_now timestamptz default now()) returns integer language plpgsql set search_path='' as $$
declare amount integer;
begin
 delete from public.notifications where category='lesson' and created_at<now()-interval '7 days';
 insert into public.notifications(recipient_id,category,title,body,destination,dedupe_key,context)
 select s.user_id,'lesson','Скоро пара · группа '||e.group_name,
 'Через 5 минут: '||e.title||'. Начало '||to_char(e.starts_at at time zone 'Asia/Krasnoyarsk','HH24:MI')||case when e.room<>'' then ', кабинет '||e.room else '' end||'. Экспериментальное напоминание: расписание может быть устаревшим. Сверьтесь с официальным расписанием.',
 'schedule','lesson:'||s.user_id||':'||e.event_key||':'||(e.starts_at at time zone 'Asia/Krasnoyarsk')::date,
 jsonb_build_object('groupId',e.group_id,'eventKey',e.event_key,'fingerprint',e.fingerprint,'startsAt',e.starts_at,'expiresAt',e.starts_at-interval '4 minutes')
 from public.lesson_reminder_subscriptions s join public.lesson_events_for_day(((p_now+interval '5 minutes') at time zone 'Asia/Krasnoyarsk')::date) e on e.group_id=s.group_id
 where e.starts_at>=date_trunc('minute',p_now)+interval '5 minutes' and e.starts_at<date_trunc('minute',p_now)+interval '6 minutes'
 on conflict(dedupe_key) do nothing;get diagnostics amount=row_count;return amount;
end; $$;
create index lesson_notice_retention on public.notifications(created_at) where category='lesson';
create or replace function public.can_read_notification(p_user_id text,n public.notifications) returns boolean language sql stable set search_path='' as $$
 select (n.recipient_id=p_user_id or (n.recipient_id is null and n.category='announcement')) and
 (n.category<>'lesson' or ((n.context->>'expiresAt')::timestamptz>now() and exists(select 1 from public.lesson_reminder_subscriptions s where s.user_id=p_user_id and s.group_id=n.context->>'groupId') and
 exists(select 1 from public.lesson_events_for_day(((n.context->>'startsAt')::timestamptz at time zone 'Asia/Krasnoyarsk')::date) e where e.group_id=n.context->>'groupId' and e.event_key=n.context->>'eventKey' and e.fingerprint=n.context->>'fingerprint')));
$$;
create or replace function public.enqueue_browser_push() returns trigger language plpgsql set search_path='' as $$
begin
 if new.category not in ('schedule','announcement','lesson') then return new;end if;
 insert into public.push_deliveries(notification_id,device_id) select new.id,d.id from public.push_devices d where
 (new.category='schedule' and new.recipient_id=d.user_id and d.schedule) or (new.category='announcement' and new.recipient_id is null and d.announcements) or
 (new.category='lesson' and new.recipient_id=d.user_id and d.lessons and exists(select 1 from public.lesson_reminder_subscriptions s where s.user_id=d.user_id and s.group_id=new.context->>'groupId'))
 on conflict do nothing;return new;
end; $$;
do $$ declare d text;begin
 d:=pg_get_functiondef('public.claim_browser_push()'::regprocedure);
 d:=replace(d,'-- Opt-out and removed group subscriptions take effect before delivery too.',
 $code$-- Revalidate reminders after edits, opt-out and expiry; a delayed reminder is discarded.
 update public.push_deliveries j set state='dead' from public.push_devices d,public.notifications n
 where j.device_id=d.id and j.notification_id=n.id and j.state='pending' and n.category='lesson' and
 (not d.lessons or n.recipient_id is distinct from d.user_id or (n.context->>'expiresAt')::timestamptz<=now() or
 not exists(select 1 from public.lesson_reminder_subscriptions s where s.user_id=d.user_id and s.group_id=n.context->>'groupId') or
 not exists(select 1 from public.lesson_events_for_day(((n.context->>'startsAt')::timestamptz at time zone 'Asia/Krasnoyarsk')::date) e
 where e.group_id=n.context->>'groupId' and e.event_key=n.context->>'eventKey' and e.fingerprint=n.context->>'fingerprint' and e.starts_at=(n.context->>'startsAt')::timestamptz));
 $code$);
 d:=replace(d,'''groupId'',n.context->>''groupId''','''groupId'',n.context->>''groupId'',''category'',n.category,''expiresAt'',n.context->>''expiresAt''');execute d;
end; $$;
-- The existing free minute job generates reminders before dispatching its queue.
do $$ declare command text;begin
 if to_regnamespace('cron') is not null then
  execute 'select command from cron.job where jobname=''lms-web-push''' into command;
  if command is not null and position('enqueue_lesson_reminders' in command)=0 then
   execute 'select cron.schedule(''lms-web-push'',''* * * * *'',$1)' using 'select public.enqueue_lesson_reminders();'||command;
  end if;
 end if;
end; $$;
alter table public.lesson_reminder_subscriptions enable row level security;
revoke all on public.lesson_reminder_subscriptions from public,anon,authenticated;grant select,insert,update,delete on public.lesson_reminder_subscriptions to service_role;
revoke all on function public.set_lesson_reminder(text,text,boolean,boolean),public.save_push_device(text,text,text,text,boolean,boolean,boolean),public.lesson_events_for_day(date),public.enqueue_lesson_reminders(timestamptz) from public,anon,authenticated;
grant execute on function public.set_lesson_reminder(text,text,boolean,boolean),public.save_push_device(text,text,text,text,boolean,boolean,boolean),public.lesson_events_for_day(date),public.enqueue_lesson_reminders(timestamptz) to service_role;

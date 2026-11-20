alter table public.push_devices add column chat boolean not null default false;
alter table public.notifications drop constraint notifications_category_check;
alter table public.notifications add constraint notifications_category_check
  check(category in ('legacy','personal','schedule','announcement','profile','lesson','chat'));
alter table public.notifications add constraint chat_notice_is_personal
  check(category<>'chat' or (recipient_id is not null and coalesce(context->>'messageId','') ~ '^[0-9]{1,18}$'));
create index chat_notice_retention on public.notifications(created_at) where category='chat';
create index chat_notice_recipient on public.notifications(recipient_id,((context->>'messageId')::bigint)) where category='chat';

create function public.save_push_device(
  p_user text,p_endpoint text,p_key text,p_auth text,p_schedule boolean,p_announcements boolean,p_lessons boolean,p_chat boolean
) returns jsonb language plpgsql set search_path='' as $$
declare device jsonb;
begin
  if p_chat is true then perform public.require_curator_chat(p_user);end if;
  device:=public.save_push_device(p_user,p_endpoint,p_key,p_auth,p_schedule,p_announcements,p_lessons);
  if p_chat is not null then
    update public.push_devices set chat=p_chat where id=device->>'id' and user_id=p_user;
  end if;
  return device||jsonb_build_object('chat',(select chat from public.push_devices where id=device->>'id' and user_id=p_user));
end; $$;
revoke all on function public.save_push_device(text,text,text,text,boolean,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.save_push_device(text,text,text,text,boolean,boolean,boolean,boolean) to service_role;

create function public.enqueue_curator_chat_notice() returns trigger language plpgsql set search_path='' as $$
begin
  insert into public.notifications(recipient_id,category,title,body,destination,context)
  select user_id,'chat','Новое сообщение в чате кураторов','Откройте чат, чтобы прочитать сообщение.',
    'curator-chat',jsonb_build_object('messageId',new.id::text)
  from public.account_roles where role in ('admin','curator') and user_id<>new.author_id;
  return new;
end; $$;
revoke all on function public.enqueue_curator_chat_notice() from public,anon,authenticated;
create trigger curator_message_notice after insert on public.curator_messages
  for each row execute function public.enqueue_curator_chat_notice();

create function public.read_curator_chat_notices() returns trigger language plpgsql set search_path='' as $$
begin
  insert into public.notification_reads(user_id,notification_id)
  select new.user_id,id from public.notifications
  where category='chat' and recipient_id=new.user_id and (context->>'messageId')::bigint<=new.last_read_id
  on conflict do nothing;
  return new;
end; $$;
revoke all on function public.read_curator_chat_notices() from public,anon,authenticated;
create trigger curator_message_notices_read after insert or update of last_read_id on public.curator_chat_reads
  for each row execute function public.read_curator_chat_notices();

create or replace function public.can_read_notification(p_user_id text,n public.notifications) returns boolean
language sql stable set search_path='' as $$
  select (n.recipient_id=p_user_id or (n.recipient_id is null and n.category='announcement')) and
  (n.category<>'chat' or exists(select 1 from public.account_roles r where r.user_id=p_user_id and r.role in ('admin','curator'))) and
  (n.category<>'lesson' or ((n.context->>'expiresAt')::timestamptz>now() and
   exists(select 1 from public.lesson_reminder_subscriptions s where s.user_id=p_user_id and s.group_id=n.context->>'groupId') and
   exists(select 1 from public.lesson_events_for_day(((n.context->>'startsAt')::timestamptz at time zone 'Asia/Krasnoyarsk')::date) e
    where e.group_id=n.context->>'groupId' and e.event_key=n.context->>'eventKey' and e.fingerprint=n.context->>'fingerprint')));
$$;

create or replace function public.enqueue_browser_push() returns trigger language plpgsql set search_path='' as $$
begin
  if new.category not in ('schedule','announcement','lesson','chat') then return new;end if;
  insert into public.push_deliveries(notification_id,device_id)
  select new.id,d.id from public.push_devices d where
    (new.category='schedule' and new.recipient_id=d.user_id and d.schedule) or
    (new.category='announcement' and new.recipient_id is null and d.announcements) or
    (new.category='lesson' and new.recipient_id=d.user_id and d.lessons and
     exists(select 1 from public.lesson_reminder_subscriptions s where s.user_id=d.user_id and s.group_id=new.context->>'groupId')) or
    (new.category='chat' and new.recipient_id=d.user_id and d.chat)
  on conflict do nothing;
  return new;
end; $$;

create or replace function public.claim_browser_push() returns jsonb language plpgsql set search_path='' as $$
declare batch jsonb;token text:=gen_random_uuid()::text;
begin
  update public.push_deliveries j set state='dead' from public.push_devices d,public.notifications n
  where j.device_id=d.id and j.notification_id=n.id and j.state='pending' and
  (j.created_at<now()-interval '1 day' or j.attempts>=5 or
   (n.category='announcement' and not d.announcements) or
   (n.category='schedule' and (not d.schedule or n.recipient_id is distinct from d.user_id or
    (n.context->>'groupId' is not null and not exists(select 1 from public.notification_subscriptions s
     where s.user_id=d.user_id and s.scope='group' and s.group_id=n.context->>'groupId')))) or
   (n.category='lesson' and (not d.lessons or n.recipient_id is distinct from d.user_id or
    not public.can_read_notification(d.user_id,n) or
    not exists(select 1 from public.lesson_events_for_day(((n.context->>'startsAt')::timestamptz at time zone 'Asia/Krasnoyarsk')::date) e
     where e.group_id=n.context->>'groupId' and e.event_key=n.context->>'eventKey' and e.starts_at=(n.context->>'startsAt')::timestamptz))) or
   (n.category='chat' and (not d.chat or n.created_at<now()-interval '15 minutes' or
    not public.can_read_notification(d.user_id,n) or
    exists(select 1 from public.notification_reads r where r.user_id=d.user_id and r.notification_id=n.id))));
  with targets as(select id from public.push_deliveries where state='pending' and next_at<=now()
    and (locked_until is null or locked_until<now()) order by id for update skip locked limit 20)
  update public.push_deliveries j set locked_until=now()+interval '60 seconds',lease_token=token,attempts=attempts+1
  from targets where j.id=targets.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',j.id::text,'lease',j.lease_token,'deviceId',d.id,'endpoint',d.endpoint,'p256dh',d.p256dh,'auth',d.auth,
   'payload',jsonb_build_object('id',n.id,'title',left(n.title,150),'body',left(n.body,500),'destination',n.destination,
    'groupId',n.context->>'groupId','category',n.category,'expiresAt',n.context->>'expiresAt'))),'[]'::jsonb) into batch
  from public.push_deliveries j join public.push_devices d on d.id=j.device_id join public.notifications n on n.id=j.notification_id
  where j.lease_token=token;
  delete from public.push_deliveries where state<>'pending' and created_at<now()-interval '7 days';
  delete from public.notifications where category='chat' and created_at<now()-interval '7 days';
  return batch;
end; $$;

create table public.push_devices(
 id text primary key default gen_random_uuid()::text,user_id text not null references public.profiles(id) on delete cascade,
 endpoint text not null unique check(char_length(endpoint) between 15 and 2500),p256dh text not null,auth text not null,
 schedule boolean not null default true,announcements boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.push_deliveries(
 id bigint generated always as identity primary key,notification_id text not null references public.notifications(id) on delete cascade,
 device_id text not null references public.push_devices(id) on delete cascade,state text not null default 'pending' check(state in ('pending','sent','dead')),
 attempts integer not null default 0,next_at timestamptz not null default now(),locked_until timestamptz,lease_token text,
 created_at timestamptz not null default now(),unique(notification_id,device_id)
);
create index pending_push on public.push_deliveries(next_at) where state='pending';
create function public.save_push_device(p_user text,p_endpoint text,p_key text,p_auth text,p_schedule boolean,p_announcements boolean) returns jsonb language plpgsql set search_path='' as $$
declare result public.push_devices;prior_owner text;
begin
 perform 1 from public.profiles where id=p_user for update;if not found then raise exception using errcode='42501',message='Войдите в аккаунт.';end if;
 if (select count(*) from public.push_devices where user_id=p_user and endpoint<>p_endpoint)>=5 then raise exception using errcode='22023',message='Уже подключено пять устройств.';end if;
 select user_id into prior_owner from public.push_devices where endpoint=p_endpoint for update;
 -- A subscription identifies this browser. Rebinding on shared devices must drop old queued deliveries.
 if prior_owner is not null and prior_owner<>p_user then delete from public.push_devices where endpoint=p_endpoint;end if;
 insert into public.push_devices(user_id,endpoint,p256dh,auth,schedule,announcements) values(p_user,p_endpoint,p_key,p_auth,p_schedule,p_announcements)
 on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,schedule=excluded.schedule,announcements=excluded.announcements,updated_at=now() returning * into result;
 return jsonb_build_object('id',result.id,'schedule',result.schedule,'announcements',result.announcements);
end; $$;
create function public.enqueue_browser_push() returns trigger language plpgsql set search_path='' as $$
begin
 if new.category not in ('schedule','announcement') then return new;end if;
 insert into public.push_deliveries(notification_id,device_id)
 select new.id,d.id from public.push_devices d where
  (new.category='schedule' and new.recipient_id=d.user_id and d.schedule) or
  (new.category='announcement' and new.recipient_id is null and d.announcements)
 on conflict do nothing;return new;
end; $$;
create trigger notification_web_push after insert on public.notifications for each row execute function public.enqueue_browser_push();
create function public.claim_browser_push() returns jsonb language plpgsql set search_path='' as $$
declare batch jsonb;token text:=gen_random_uuid()::text;
begin
 -- Opt-out and removed group subscriptions take effect before delivery too.
 update public.push_deliveries j set state='dead' from public.push_devices d,public.notifications n
 where j.device_id=d.id and j.notification_id=n.id and j.state='pending' and
 (j.created_at<now()-interval '1 day' or j.attempts>=5 or
  (n.category='announcement' and not d.announcements) or
  (n.category='schedule' and (not d.schedule or n.recipient_id<>d.user_id or
    (n.context->>'groupId' is not null and not exists(select 1 from public.notification_subscriptions s where s.user_id=d.user_id and s.scope='group' and s.group_id=n.context->>'groupId')))));
 with targets as(select id from public.push_deliveries where state='pending' and next_at<=now() and (locked_until is null or locked_until<now()) order by id for update skip locked limit 20)
 update public.push_deliveries j set locked_until=now()+interval '60 seconds',lease_token=token,attempts=attempts+1 from targets where j.id=targets.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',j.id::text,'lease',j.lease_token,'deviceId',d.id,'endpoint',d.endpoint,'p256dh',d.p256dh,'auth',d.auth,
  'payload',jsonb_build_object('id',n.id,'title',left(n.title,150),'body',left(n.body,500),'destination',n.destination,'groupId',n.context->>'groupId'))),'[]'::jsonb) into batch
 from public.push_deliveries j join public.push_devices d on d.id=j.device_id join public.notifications n on n.id=j.notification_id where j.lease_token=token;
 -- Bounded retention; endpoints and payloads are never logged.
 delete from public.push_deliveries where state<>'pending' and created_at<now()-interval '7 days';return batch;
end; $$;
create function public.finish_browser_push(p_id bigint,p_lease text,p_status integer) returns void language plpgsql set search_path='' as $$
declare target public.push_deliveries;
begin
 select * into target from public.push_deliveries where id=p_id and lease_token=p_lease for update;if not found then return;end if;
 if p_status in (404,410) then delete from public.push_devices where id=target.device_id;return;end if;
 update public.push_deliveries set state=case when p_status between 200 and 299 then 'sent' when p_status between 400 and 499 and p_status<>429 then 'dead' else 'pending' end,
 next_at=now()+make_interval(secs=>least(3600,60*(2^attempts)::int)),locked_until=null,lease_token=null where id=p_id;
end; $$;
alter table public.push_devices enable row level security;alter table public.push_deliveries enable row level security;
revoke all on public.push_devices,public.push_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.push_devices,public.push_deliveries to service_role;
grant usage,select on sequence public.push_deliveries_id_seq to service_role;
revoke all on function public.save_push_device(text,text,text,text,boolean,boolean),public.enqueue_browser_push(),public.claim_browser_push(),public.finish_browser_push(bigint,text,integer) from public,anon,authenticated;
grant execute on function public.save_push_device(text,text,text,text,boolean,boolean),public.claim_browser_push(),public.finish_browser_push(bigint,text,integer) to service_role;

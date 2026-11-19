create table if not exists public.curator_chat_reads (
 user_id text primary key references public.profiles(id) on delete cascade,
 last_read_id bigint not null default 0 check(last_read_id>=0),
 updated_at timestamptz not null default now()
);
alter table public.curator_chat_reads enable row level security;
revoke all on public.curator_chat_reads from public,anon,authenticated;
grant select,insert,update,delete on public.curator_chat_reads to service_role;

-- Before this release no read receipts existed. Do not label old history as new.
insert into public.curator_chat_reads(user_id,last_read_id)
select user_id,coalesce((select max(id) from public.curator_messages),0)
from public.account_roles where role in('admin','curator') on conflict(user_id) do nothing;

create or replace function public.curator_chat_summary(p_user text) returns jsonb
language plpgsql stable set search_path='' as $$
declare cursor_id bigint; result jsonb;
begin
 perform public.require_curator_chat(p_user);
 select coalesce((select last_read_id from public.curator_chat_reads where user_id=p_user),0) into cursor_id;
 select jsonb_build_object('unreadCount',(select count(*) from public.curator_messages where id>cursor_id and author_id<>p_user),
  'lastReadId',cursor_id::text,'latestId',coalesce(max(id),0)::text,
  'latestIncoming',(select jsonb_build_object('id',m.id::text,'authorName',p.name) from public.curator_messages m join public.profiles p on p.id=m.author_id
   where m.id>cursor_id and m.author_id<>p_user order by m.id desc limit 1)) into result from public.curator_messages;
 return result;
end; $$;

create or replace function public.read_curator_chat(p_user text,p_message_id bigint) returns jsonb
language plpgsql set search_path='' as $$
declare target bigint;
begin
 perform 1 from public.account_roles where user_id=p_user for update;
 perform public.require_curator_chat(p_user);
 if p_message_id is null or p_message_id<0 then raise exception using errcode='22023',message='Некорректный номер сообщения.';end if;
 select least(p_message_id,coalesce(max(id),0)) into target from public.curator_messages;
 insert into public.curator_chat_reads(user_id,last_read_id) values(p_user,target)
 on conflict(user_id) do update set last_read_id=greatest(curator_chat_reads.last_read_id,excluded.last_read_id),updated_at=now()
 where curator_chat_reads.last_read_id<excluded.last_read_id;
 return public.curator_chat_summary(p_user);
end; $$;

create or replace function public.send_curator_message(p_user text,p_body text,p_client_id text) returns jsonb language plpgsql set search_path='' as $$
declare result public.curator_messages;
begin
 perform 1 from public.account_roles where user_id=p_user for update;
 perform public.require_curator_chat(p_user);
 -- Serialize insertion/commit order before allocating the identity. Watermarks
 -- must not skip a lower message ID that commits after a later message.
 lock table public.curator_messages in exclusive mode;
 select * into result from public.curator_messages where author_id=p_user and client_id=p_client_id;
 if found then return jsonb_build_object('id',result.id::text);end if;
 if p_body is null or char_length(btrim(p_body)) not between 1 and 4000 or p_client_id is null or p_client_id !~ '^[A-Za-z0-9_-]{1,128}$' then raise exception using errcode='22023',message='Сообщение — от 1 до 4000 символов.';end if;
 if (select count(*) from public.curator_messages where author_id=p_user and created_at>now()-interval '1 minute')>=20 then raise exception using errcode='22023',message='Слишком много сообщений. Подождите минуту.';end if;
 insert into public.curator_messages(author_id,body,client_id) values(p_user,btrim(p_body),p_client_id) returning * into result;
 return jsonb_build_object('id',result.id::text);
end; $$;
revoke all on function public.curator_chat_summary(text),public.read_curator_chat(text,bigint) from public,anon,authenticated;
grant execute on function public.curator_chat_summary(text),public.read_curator_chat(text,bigint) to service_role;

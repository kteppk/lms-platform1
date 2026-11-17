alter table public.account_roles drop constraint account_roles_role_check;
alter table public.account_roles add constraint account_roles_role_check check(role in ('student','curator','teacher','admin'));
create or replace view public.student_profiles with(security_invoker=true) as
select p.id,p.name,p.email,p.created_at from public.profiles p join public.account_roles r on r.user_id=p.id and r.role in ('student','curator');
do $$ declare d text;
begin
 d:=pg_get_functiondef('public.set_account_role(text,text,text,text)'::regprocedure);
 d:=replace(d,'''student'',''teacher'',''admin''','''student'',''curator'',''teacher'',''admin''');
 d:=replace(d,'when ''teacher'' then ''преподавателя''','when ''curator'' then ''куратора-студента'' when ''teacher'' then ''преподавателя''');execute d;
 d:=pg_get_functiondef('public.check_result_reader(text,boolean)'::regprocedure);
 execute replace(d,'account_role<>''student''','account_role not in (''student'',''curator'')');
 d:=pg_get_functiondef('public.people_directory(text,text,integer)'::regprocedure);
 execute replace(d,'''student'',''teacher'',''admin''','''student'',''curator'',''teacher'',''admin''');
 d:=pg_get_functiondef('public.registration_statistics(text)'::regprocedure);
 execute replace(d,'role=''student''','role in (''student'',''curator'')');
end; $$;

create table public.news_likes (
 post_id text not null references public.news_posts(id) on delete cascade,
 user_id text not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),primary key(post_id,user_id)
);
create function public.news_feed_v2(p_user text,p_channel text,p_order text,p_offset integer default 0) returns jsonb
language plpgsql stable set search_path='' as $$
begin
 if p_channel is null or p_channel not in ('all','site','college') or p_order is null or p_order not in ('newest','oldest') or p_offset is null or p_offset<0 or p_offset>100000 then raise exception using errcode='22023',message='Проверьте фильтры новостей.';end if;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page) order by page.position) from (
  select n.id,n.channel,n.kind,n.title,n.body,n.commit_sha,n.published_at,n.revision,n.source_key is not null imported,
   (select count(*) from public.news_likes l where l.post_id=n.id) as like_count,
   exists(select 1 from public.news_likes l where l.post_id=n.id and l.user_id=p_user) as liked,
   row_number() over(order by case when p_order='newest' then n.published_at end desc,case when p_order='oldest' then n.published_at end asc,n.id) position
  from public.news_posts n where n.published_at<=now() and (p_channel='all' or n.channel=p_channel)
  order by case when p_order='newest' then n.published_at end desc,case when p_order='oldest' then n.published_at end asc,n.id limit 20 offset p_offset) page),'[]'::jsonb),
 'hasMore',(select count(*)>p_offset+20 from public.news_posts n where n.published_at<=now() and (p_channel='all' or n.channel=p_channel)));
end; $$;
create function public.set_news_like(p_user text,p_post text,p_liked boolean) returns jsonb language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=p_user) then raise exception using errcode='42501',message='Войдите, чтобы поставить лайк.';end if;
 perform 1 from public.news_posts where id=p_post and published_at<=now() for update;
 if not found then raise exception using errcode='P0002',message='Новость не найдена.';end if;
 if p_liked is null then raise exception using errcode='22023',message='Укажите состояние лайка.';end if;
 if p_liked then insert into public.news_likes(post_id,user_id) values(p_post,p_user) on conflict do nothing;
 else delete from public.news_likes where post_id=p_post and user_id=p_user;end if;
 return jsonb_build_object('id',p_post,'liked',p_liked,'like_count',(select count(*) from public.news_likes where post_id=p_post));
end; $$;

create table public.curator_messages (
 id bigint generated always as identity primary key,
 author_id text not null references public.profiles(id) on delete cascade,
 body text not null check(char_length(btrim(body)) between 1 and 4000),
 client_id text not null check(client_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 created_at timestamptz not null default now(),unique(author_id,client_id)
);
create function public.require_curator_chat(p_user text) returns void language plpgsql stable set search_path='' as $$
begin
 if not exists(select 1 from public.account_roles where user_id=p_user and role in ('admin','curator')) then raise exception using errcode='42501',message='Чат доступен только кураторам-студентам и администрации.';end if;
end; $$;
create function public.curator_chat_feed(p_user text,p_before bigint default null,p_after bigint default null) returns jsonb language plpgsql stable set search_path='' as $$
begin
 perform public.require_curator_chat(p_user);
 if p_before is not null and p_after is not null then raise exception using errcode='22023',message='Некорректная страница чата.';end if;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page) order by page.id::bigint) from (
  select m.id::text id,m.body,m.author_id,p.name author_name,m.created_at from public.curator_messages m join public.profiles p on p.id=m.author_id
  where (p_before is null or m.id<p_before) and (p_after is null or m.id>p_after)
  order by case when p_after is not null then m.id end asc,m.id desc limit 50) page),'[]'::jsonb));
end; $$;
create function public.send_curator_message(p_user text,p_body text,p_client_id text) returns jsonb language plpgsql set search_path='' as $$
declare result public.curator_messages;
begin
 -- Role row is locked until commit, so revocation also serializes with sends.
 perform 1 from public.account_roles where user_id=p_user for update;perform public.require_curator_chat(p_user);
 select * into result from public.curator_messages where author_id=p_user and client_id=p_client_id;
 if found then return jsonb_build_object('id',result.id::text);end if;
 if p_body is null or char_length(btrim(p_body)) not between 1 and 4000 or p_client_id is null or p_client_id !~ '^[A-Za-z0-9_-]{1,128}$' then raise exception using errcode='22023',message='Сообщение — от 1 до 4000 символов.';end if;
 if (select count(*) from public.curator_messages where author_id=p_user and created_at>now()-interval '1 minute')>=20 then raise exception using errcode='22023',message='Слишком много сообщений. Подождите минуту.';end if;
 insert into public.curator_messages(author_id,body,client_id) values(p_user,btrim(p_body),p_client_id) returning * into result;
 return jsonb_build_object('id',result.id::text);
end; $$;

-- Public guest access is a projection with a strict allowlist, not an account.
create function public.guest_read(p_action text,p_input jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare target public.study_groups; date_from date;date_to date;
begin
 if p_action='listNews' then return public.news_feed_v2(null,coalesce(p_input->>'channel','all'),coalesce(p_input->>'order','newest'),coalesce((p_input->>'offset')::integer,0));
 elsif p_action='listScheduleGroups' then return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'course',course,'program',program,'lessons_per_day',lessons_per_day) order by name,id) from public.study_groups),'[]'::jsonb);
 elsif p_action='getWeeklySchedule' then
  select * into target from public.study_groups where id=p_input->>'groupId';if not found then raise exception using errcode='P0002',message='Группа не найдена.';end if;
  return jsonb_build_object('group',jsonb_build_object('id',target.id,'name',target.name,'course',target.course,'program',target.program,'lessons_per_day',target.lessons_per_day),
   'cells',coalesce((select jsonb_agg(jsonb_build_object('weekday',weekday,'lesson_number',lesson_number,'status',status,'title',title,'teacher_label',teacher_label,'room',room,'note',note,'starts_at',starts_at,'ends_at',ends_at) order by weekday,lesson_number) from public.weekly_schedule_cells where group_id=target.id),'[]'::jsonb));
 elsif p_action='listSchedule' then
  date_from:=(p_input->>'from')::date;date_to:=(p_input->>'to')::date;
  if date_from is null or date_to is null or date_to<date_from or date_to-date_from>31 then raise exception using errcode='22023',message='Некорректный период.';end if;
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page)) from (select lesson_date,starts_at,ends_at,title,room,note from public.schedule_entries where group_name=p_input->>'group' and lesson_date between date_from and date_to order by lesson_date,starts_at,id limit 500) page),'[]'::jsonb),'hasMore',false);
 end if;
 raise exception using errcode='42501',message='Гостю доступны только новости и расписание.';
end; $$;
alter table public.news_likes enable row level security;alter table public.curator_messages enable row level security;
revoke all on public.news_likes,public.curator_messages from public,anon,authenticated;
grant select,insert,delete on public.news_likes,public.curator_messages to service_role;
grant usage,select on sequence public.curator_messages_id_seq to service_role;
revoke all on function public.news_feed_v2(text,text,text,integer),public.set_news_like(text,text,boolean),public.require_curator_chat(text),public.curator_chat_feed(text,bigint,bigint),public.send_curator_message(text,text,text),public.guest_read(text,jsonb) from public,anon,authenticated;
grant execute on function public.news_feed_v2(text,text,text,integer),public.set_news_like(text,text,boolean),public.require_curator_chat(text),public.curator_chat_feed(text,bigint,bigint),public.send_curator_message(text,text,text),public.guest_read(text,jsonb) to service_role;

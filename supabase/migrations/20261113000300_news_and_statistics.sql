create table public.news_posts (
  id text primary key default gen_random_uuid()::text,
  channel text not null check(channel in ('site','college')),
  kind text not null default 'news' check(kind in ('news','announcement','update')),
  title text not null check(char_length(title) between 1 and 200),
  body text not null check(char_length(body) between 1 and 20000),
  author_id text references public.profiles(id) on delete set null,
  source_key text unique,
  commit_sha text,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 0
);
create index news_channel_date on public.news_posts(channel,published_at desc,id);
create table public.news_sync (
  id text primary key check(id='github'),
  cursor_sha text not null default '264a2e1',
  checked_at timestamptz,
  locked_until timestamptz
);
insert into public.news_sync(id) values('github');
-- Keep existing explicit announcements on the new home page as well.
insert into public.news_posts(channel,kind,title,body,author_id,source_key,published_at)
select 'site','announcement',title,coalesce(nullif(body,''),title),actor_id,'notification:'||id,created_at
from public.notifications where category='announcement';
insert into public.news_posts(channel,kind,title,body,source_key) values('site','update','Версия 0.7.1 · Новости, предметы и статистика',
  'На главной появились две новостные ленты. В предметах добавлены поиск, краткие превью и полные описания. Администрации доступна статистика регистраций. Прежние PDF-файлы сохранены в материалах; отдельный раздел «Книги» убран.','release:0.7.1');
create function public.copy_announcement_to_news() returns trigger language plpgsql set search_path='' as $$
begin
  if new.category='announcement' and not(new.context ? 'newsPostId') then
    insert into public.news_posts(channel,kind,title,body,author_id,source_key,published_at)
    values('site','announcement',new.title,coalesce(nullif(new.body,''),new.title),new.actor_id,'notification:'||new.id,new.created_at) on conflict(source_key) do nothing;
  end if;
  return new;
end; $$;
create trigger news_from_announcement after insert on public.notifications for each row execute function public.copy_announcement_to_news();

create function public.news_feed(p_channel text,p_offset integer default 0) returns jsonb language plpgsql set search_path='' as $$
begin
  if p_channel not in ('site','college') or p_offset<0 then raise exception using errcode='22023',message='Выберите ленту.'; end if;
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page) order by page.published_at desc,page.id) from (
    select n.id,n.channel,n.kind,n.title,n.body,n.commit_sha,n.published_at,n.revision,n.source_key is not null as imported
    from public.news_posts n where n.channel=p_channel order by n.published_at desc,n.id limit 20 offset p_offset) page),'[]'::jsonb),
    'hasMore',(select count(*)>p_offset+20 from public.news_posts where channel=p_channel));
end; $$;
create function public.save_news_post(p_actor text,p_id text,p_revision integer,p_channel text,p_kind text,p_title text,p_body text,p_notify boolean default false,p_important boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare result public.news_posts;
begin
  if not exists(select 1 from public.account_roles where user_id=p_actor and role='admin') then raise exception using errcode='42501',message='Только администратор может публиковать новости.'; end if;
  if p_channel is null or p_channel not in ('site','college') or p_kind is null or p_kind not in ('news','announcement','update')
    or p_title is null or char_length(btrim(p_title)) not between 1 and 200 or p_body is null or char_length(btrim(p_body)) not between 1 and 20000
    or (p_notify and char_length(p_body)>2000) then raise exception using errcode='22023',message='Проверьте заголовок и текст. Для уведомления — до 2000 символов.'; end if;
  if p_id is null then
    insert into public.news_posts(channel,kind,title,body,author_id) values(p_channel,p_kind,btrim(p_title),btrim(p_body),p_actor) returning * into result;
  else
    update public.news_posts set channel=p_channel,kind=p_kind,title=btrim(p_title),body=btrim(p_body),updated_at=now(),revision=revision+1
    where id=p_id and revision=p_revision and source_key is null returning * into result;
    if not found then raise exception using errcode='PT409',message='Новость уже изменена. Откройте её заново.'; end if;
  end if;
  if p_notify then
    insert into public.notifications(actor_id,category,title,body,destination,context,severity)
    values(p_actor,'announcement',result.title,result.body,'home',jsonb_build_object('newsPostId',result.id),case when p_important then 'danger' else 'info' end);
  end if;
  return to_jsonb(result);
end; $$;
create function public.delete_news_post(p_actor text,p_id text,p_revision integer) returns void language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.account_roles where user_id=p_actor and role='admin') then raise exception using errcode='42501',message='Только администратор может удалять новости.'; end if;
  delete from public.news_posts where id=p_id and revision=p_revision and source_key is null;
  if not found then raise exception using errcode='PT409',message='Новость уже изменена или импортирована. Обновите список.'; end if;
end; $$;
create function public.claim_news_sync() returns jsonb language plpgsql set search_path='' as $$
declare result public.news_sync;
begin
  update public.news_sync set locked_until=now()+interval '45 seconds'
  where id='github' and (checked_at is null or checked_at<now()-interval '5 minutes')
    and (locked_until is null or locked_until<now()) returning * into result;
  return case when result.id is null then null else to_jsonb(result) end;
end; $$;

create function public.registration_statistics(p_actor text) returns jsonb language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.account_roles where user_id=p_actor and role='admin') then raise exception using errcode='42501',message='Статистика доступна только администрации.'; end if;
  return jsonb_build_object('total',(select count(*) from public.profiles),
    'students',(select count(*) from public.account_roles where role='student'),
    'teachers',(select count(*) from public.account_roles where role='teacher'),
    'admins',(select count(*) from public.account_roles where role='admin'),
    'last7',(select count(*) from public.profiles where created_at>=now()-interval '7 days'),
    'last30',(select count(*) from public.profiles where created_at>=now()-interval '30 days'),
    'months',(select jsonb_agg(jsonb_build_object('month',to_char(m,'YYYY-MM'),
      'students',(select count(*) from public.profiles p join public.account_roles r on r.user_id=p.id where r.role='student' and date_trunc('month',p.created_at at time zone 'Asia/Krasnoyarsk')=m),
      'teachers',(select count(*) from public.profiles p join public.account_roles r on r.user_id=p.id where r.role='teacher' and date_trunc('month',p.created_at at time zone 'Asia/Krasnoyarsk')=m),
      'admins',(select count(*) from public.profiles p join public.account_roles r on r.user_id=p.id where r.role='admin' and date_trunc('month',p.created_at at time zone 'Asia/Krasnoyarsk')=m)) order by m desc)
      from generate_series(date_trunc('month',now() at time zone 'Asia/Krasnoyarsk')-interval '5 months',date_trunc('month',now() at time zone 'Asia/Krasnoyarsk'),interval '1 month') m));
end; $$;
alter table public.news_posts enable row level security;
alter table public.news_sync enable row level security;
revoke all on public.news_posts,public.news_sync from public,anon,authenticated;
grant select,insert,update,delete on public.news_posts,public.news_sync to service_role;
revoke all on function public.news_feed(text,integer),public.save_news_post(text,text,integer,text,text,text,text,boolean,boolean),public.delete_news_post(text,text,integer),public.claim_news_sync(),public.registration_statistics(text),public.copy_announcement_to_news() from public,anon,authenticated;
grant execute on function public.news_feed(text,integer),public.save_news_post(text,text,integer,text,text,text,text,boolean,boolean),public.delete_news_post(text,text,integer),public.claim_news_sync(),public.registration_statistics(text),public.copy_announcement_to_news() to service_role;

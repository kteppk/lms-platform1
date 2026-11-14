-- One avatar for every account; retain the older teacher profile API.
create table public.account_avatars (
  user_id text primary key references public.profiles(id) on delete cascade,
  path text unique,
  revision integer not null default 0 check(revision>=0),
  check(path is null or (split_part(path,'/',1)=user_id and path ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$'))
);
insert into public.account_avatars(user_id,path)
select user_id,avatar_path from public.teacher_profiles where avatar_path is not null;

create function public.sync_teacher_avatar() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' and new.avatar_path is null then return new; end if;
  insert into public.account_avatars(user_id,path) values(new.user_id,new.avatar_path)
  on conflict(user_id) do update set path=excluded.path,revision=account_avatars.revision+1
  where account_avatars.path is distinct from excluded.path;
  return new;
end; $$;
create trigger teacher_avatar_sync after insert or update of avatar_path on public.teacher_profiles
for each row execute function public.sync_teacher_avatar();
create function public.sync_account_avatar() returns trigger language plpgsql set search_path='' as $$
begin
  update public.teacher_profiles set avatar_path=new.path,revision=revision+1,updated_at=now()
  where user_id=new.user_id and avatar_path is distinct from new.path;
  return new;
end; $$;
create trigger account_avatar_sync after insert or update of path on public.account_avatars
for each row execute function public.sync_account_avatar();

create function public.save_account_avatar(p_user_id text,p_path text,p_revision integer) returns jsonb
language plpgsql set search_path='' as $$
declare saved public.account_avatars;
begin
  if p_revision is null or p_revision<0 or (p_path is not null and
    (split_part(p_path,'/',1)<>p_user_id or p_path !~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$')) then
    raise exception using errcode='22023',message='Некорректная фотография профиля.';
  end if;
  insert into public.account_avatars(user_id) values(p_user_id) on conflict do nothing;
  update public.account_avatars set path=p_path,revision=revision+1
  where user_id=p_user_id and revision=p_revision returning * into saved;
  if not found then raise exception using errcode='PT409',message='Фотография уже изменена. Обновите профиль.'; end if;
  return to_jsonb(saved);
end; $$;

create or replace view public.teacher_directory with(security_invoker=true) as
select p.id,p.name,tp.position,a.path as avatar_path from public.teachers t
join public.profiles p on p.id=t.user_id
join public.account_roles r on r.user_id=p.id and r.role in ('teacher','admin')
left join public.teacher_profiles tp on tp.user_id=p.id
left join public.account_avatars a on a.user_id=p.id;

-- Authenticated members can discover names/roles/photos, never email or results.
create function public.people_directory(p_search text,p_role text,p_offset integer) returns jsonb
language plpgsql set search_path='' as $$
declare rows jsonb;
begin
  if p_search is null or char_length(p_search)>200 or p_role is null or p_role not in ('','student','teacher','admin')
    or p_offset is null or p_offset<0 or p_offset>100000 then
    raise exception using errcode='22023',message='Некорректные параметры поиска.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(page) order by page.name,page.id),'[]'::jsonb) into rows from (
    select p.id,p.name,r.role,tp.position,a.path as avatar_path,
      exists(select 1 from public.teachers t where t.user_id=p.id) and r.role in ('teacher','admin') as has_teacher_profile
    from public.profiles p join public.account_roles r on r.user_id=p.id
    left join public.account_avatars a on a.user_id=p.id
    left join public.teacher_profiles tp on tp.user_id=p.id and r.role in ('teacher','admin')
    where (p_role='' or r.role=p_role) and not exists (
      select 1 from regexp_split_to_table(replace(lower(btrim(p_search)),'ё','е'),'\s+') word
      where word<>'' and strpos(replace(lower(p.name),'ё','е'),word)=0)
    order by p.name,p.id limit 31 offset p_offset
  ) page;
  return jsonb_build_object('rows',rows,'hasMore',jsonb_array_length(rows)>30);
end; $$;

create table public.portal_settings (
  singleton boolean primary key default true check(singleton),
  feedback_url text,
  revision integer not null default 0,
  check(feedback_url is null or (char_length(feedback_url)<=2000 and
    feedback_url ~ '^https://(forms\.gle/[^[:space:]]+|docs\.google\.com/forms/[^[:space:]]+)$'))
);
insert into public.portal_settings(singleton) values(true);
create function public.save_portal_settings(p_actor_id text,p_feedback_url text,p_revision integer) returns jsonb
language plpgsql set search_path='' as $$
declare saved public.portal_settings;
begin
  if not exists(select 1 from public.account_roles where user_id=p_actor_id and role='admin') then
    raise exception using errcode='42501',message='Только администратор может подключить форму.';
  end if;
  update public.portal_settings set feedback_url=p_feedback_url,revision=revision+1
  where singleton and revision=p_revision returning * into saved;
  if not found then raise exception using errcode='PT409',message='Настройки уже изменены. Откройте справочник заново.'; end if;
  return jsonb_build_object('feedbackUrl',saved.feedback_url,'revision',saved.revision);
end; $$;

alter table public.account_avatars enable row level security;
alter table public.portal_settings enable row level security;
revoke all on public.account_avatars,public.portal_settings from public,anon,authenticated;
grant select,insert,update,delete on public.account_avatars,public.portal_settings to service_role;
revoke all on function public.sync_teacher_avatar(),public.sync_account_avatar(),
 public.save_account_avatar(text,text,integer),public.people_directory(text,text,integer),
 public.save_portal_settings(text,text,integer) from public,anon,authenticated;
grant execute on function public.save_account_avatar(text,text,integer),public.people_directory(text,text,integer),
 public.save_portal_settings(text,text,integer) to service_role;

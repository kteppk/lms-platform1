-- Roles are independent from the historical teacher records: changing a role
-- never destroys subjects, materials, memberships or submitted work.
alter table public.profiles add column no_patronymic boolean not null default false;
create table public.account_roles (
  user_id text primary key references public.profiles(id) on delete cascade,
  role text not null default 'student' check (role in ('student','teacher','admin'))
);
insert into public.account_roles(user_id,role)
select p.id,case when t.user_id is null then 'student' else 'teacher' end
from public.profiles p left join public.teachers t on t.user_id=p.id;

create function public.initial_account_role() returns trigger language plpgsql set search_path='' as $$
begin
  insert into public.account_roles(user_id,role) values(new.id,'student') on conflict do nothing;
  return new;
end; $$;
create trigger profile_initial_role after insert on public.profiles for each row execute function public.initial_account_role();
-- Retain compatibility with the original documented teacher provisioning method.
create function public.provision_teacher_role() returns trigger language plpgsql set search_path='' as $$
begin
  insert into public.account_roles(user_id,role) values(new.user_id,'teacher')
  on conflict(user_id) do update set role='teacher' where public.account_roles.role <> 'admin';
  return new;
end; $$;
create trigger teacher_initial_role after insert on public.teachers for each row execute function public.provision_teacher_role();

create or replace view public.student_profiles with (security_invoker=true) as
select p.id,p.name,p.email,p.created_at from public.profiles p
join public.account_roles r on r.user_id=p.id and r.role='student';
create or replace view public.subject_instructors with (security_invoker=true) as
select s.id as subject_id,st.teacher_id,p.name as teacher_name
from public.subjects s join public.subject_teachers st on st.subject_id=s.id
join public.profiles p on p.id=st.teacher_id
join public.account_roles r on r.user_id=p.id and r.role in ('teacher','admin')
where s.archived_at is null;

create table public.teacher_profiles (
  user_id text primary key references public.profiles(id) on delete cascade,
  position text not null default '' check(char_length(position)<=200),
  bio text not null default '' check(char_length(bio)<=5000),
  education text not null default '' check(char_length(education)<=5000),
  qualification text not null default '' check(char_length(qualification)<=3000),
  experience_years integer check(experience_years between 0 and 80),
  avatar_path text,
  revision integer not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.teacher_profiles(user_id) select user_id from public.teachers;
create table public.teacher_documents (
  id text primary key default gen_random_uuid()::text,
  teacher_id text not null references public.profiles(id) on delete cascade,
  title text not null check(char_length(title) between 1 and 200),
  category text not null check(category in ('diploma','award','certificate','other')),
  issued_year integer check(issued_year between 1950 and 2200),
  path text not null unique,
  file_name text not null check(char_length(file_name)<=255),
  mime text not null,
  created_at timestamptz not null default now()
);
create index teacher_documents_by_teacher on public.teacher_documents(teacher_id,created_at desc);
create view public.teacher_directory with(security_invoker=true) as
select p.id,p.name,tp.position,tp.avatar_path from public.teachers t
join public.profiles p on p.id=t.user_id
join public.account_roles r on r.user_id=p.id and r.role in ('teacher','admin')
left join public.teacher_profiles tp on tp.user_id=p.id;

create table public.schedule_entries (
  id text primary key default gen_random_uuid()::text,
  lesson_date date not null,
  starts_at time not null,
  ends_at time not null check(ends_at>starts_at),
  subject_id text references public.subjects(id),
  title text not null check(char_length(title) between 1 and 200),
  teacher_id text references public.profiles(id),
  group_name text not null default '' check(char_length(group_name)<=100),
  room text not null default '' check(char_length(room)<=100),
  note text not null default '' check(char_length(note)<=1000),
  revision integer not null default 0,
  created_by text not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index schedule_dates on public.schedule_entries(lesson_date,starts_at);

create table public.notifications (
  id text primary key default gen_random_uuid()::text,
  actor_id text,
  recipient_id text references public.profiles(id) on delete cascade,
  title text not null check(char_length(title) between 1 and 200),
  body text not null default '' check(char_length(body)<=2000),
  severity text not null default 'info' check(severity in ('info','success','danger')),
  destination text not null default 'notifications',
  dedupe_key text unique,
  created_at timestamptz not null default now()
);
create index notifications_date on public.notifications(created_at desc);
create index notifications_recipient on public.notifications(recipient_id,created_at desc);
create table public.notification_reads (
  user_id text not null references public.profiles(id) on delete cascade,
  notification_id text not null references public.notifications(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(user_id,notification_id)
);
create table public.role_changes (
  id text primary key default gen_random_uuid()::text,
  actor_id text not null references public.profiles(id),
  user_id text not null references public.profiles(id),
  old_role text not null,new_role text not null,
  created_at timestamptz not null default now()
);

create function public.valid_full_name(p_name text,p_no_patronymic boolean default false)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(array_length(parts,1)=case when p_no_patronymic then 2 else 3 end
    and not exists(select 1 from unnest(parts) part
      where part !~ '^[[:alpha:]][[:alpha:]''’‐-]{0,38}[[:alpha:]]$'),false)
  from (select regexp_split_to_array(btrim(p_name),'\s+') parts) n;
$$;

create function public.sync_name_notice() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.name is distinct from old.name or new.no_patronymic is distinct from old.no_patronymic) then
    insert into public.notifications(actor_id,recipient_id,title,body,destination)
    values(new.id,new.id,'ФИО обновлено',new.name,'profile');
  end if;
  if public.valid_full_name(new.name,new.no_patronymic) then
    delete from public.notifications where dedupe_key='name:'||new.id;
  else
    insert into public.notifications(recipient_id,title,body,severity,destination,dedupe_key)
    values(new.id,'Укажите полное ФИО','Откройте «Мой профиль» и укажите имя, фамилию и отчество вместо никнейма. Если отчества нет, отметьте это в профиле.','danger','profile','name:'||new.id)
    on conflict(dedupe_key) do nothing;
  end if;
  return new;
end; $$;
create trigger profile_name_notice after insert or update of name,no_patronymic on public.profiles
for each row execute function public.sync_name_notice();
-- Deliver the requested warning to all existing accounts with an incomplete format.
update public.profiles set name=name;

create function public.set_account_role(p_actor_id text,p_user_id text,p_role text,p_expected_role text)
returns text language plpgsql set search_path='' as $$
declare previous text;
begin
  lock table public.account_roles in share row exclusive mode;
  if not exists(select 1 from public.account_roles where user_id=p_actor_id and role='admin') then
    raise exception using errcode='42501',message='Только администратор может менять роли.';
  end if;
  if p_role not in ('student','teacher','admin') or p_role is null then
    raise exception using errcode='22023',message='Неизвестная роль.';
  end if;
  select role into previous from public.account_roles where user_id=p_user_id;
  if not found then raise exception using errcode='P0002',message='Аккаунт не найден.'; end if;
  if p_expected_role is distinct from previous then
    raise exception using errcode='PT409',message='Роль уже изменена. Обновите список.';
  end if;
  if previous=p_role then return p_role; end if;
  if previous='admin' and p_role<>'admin' and (select count(*) from public.account_roles where role='admin')<=1 then
    raise exception using errcode='22023',message='Нельзя убрать последнего администратора.';
  end if;
  if p_role='teacher' then
    insert into public.teachers(user_id) values(p_user_id) on conflict do nothing;
    insert into public.teacher_profiles(user_id) values(p_user_id) on conflict do nothing;
  end if;
  update public.account_roles set role=p_role where user_id=p_user_id;
  insert into public.role_changes(actor_id,user_id,old_role,new_role) values(p_actor_id,p_user_id,previous,p_role);
  insert into public.notifications(actor_id,recipient_id,title,body,destination)
  values(p_actor_id,p_user_id,'Роль аккаунта изменена','Администратор назначил вам роль: '||case p_role when 'admin' then 'администратор' when 'teacher' then 'преподаватель' else 'студент' end||'. При следующем открытии вы перейдёте в соответствующий кабинет.','profile');
  return p_role;
end; $$;

-- Publish meaningful changes in the same transaction as the change itself.
-- Draft saves and other students' answers are never broadcast.
create function public.notify_platform_change() returns trigger language plpgsql set search_path='' as $$
declare row_data jsonb; message text; heading text; target text; author text; destination text;
begin
  row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name='test_results' then
    if tg_op='UPDATE' and new.review_revision=old.review_revision then return new; end if;
    insert into public.notifications(actor_id,recipient_id,title,body,destination)
    values(row_data->>'teacher_id',row_data->>'student_id',
      case when row_data->>'status'='pending_review' then 'Работа ожидает проверки' else 'Результат работы готов' end,
      row_data->>'test_title','results');
    if tg_op='INSERT' and new.status='pending_review' then
      insert into public.notifications(actor_id,recipient_id,title,body,destination)
      values(new.student_id,new.teacher_id,'Новая работа на проверку',new.test_title,'journal');
    end if;
    return new;
  elsif tg_table_name='schedule_entries' then
    heading:=case tg_op when 'DELETE' then 'Занятие отменено' when 'INSERT' then 'Добавлено занятие' else 'Расписание изменено' end;
    message:=(row_data->>'lesson_date')||' · '||(row_data->>'title')||' · '||(row_data->>'group_name');
    author:=row_data->>'created_by'; destination:='schedule';
  elsif tg_table_name='teacher_documents' then
    heading:=case when tg_op='DELETE' then 'Документ преподавателя удалён' else 'Новый документ преподавателя' end;
    message:=row_data->>'title'; author:=row_data->>'teacher_id'; destination:='teachers';
  elsif tg_table_name='teacher_profiles' then
    heading:='Профиль преподавателя обновлён';
    select name into message from public.profiles where id=new.user_id;
    author:=new.user_id; destination:='teachers';
  elsif tg_table_name='subject_teachers' then
    heading:='Изменился состав преподавателей';
    select title into message from public.subjects where id=row_data->>'subject_id';
    author:=row_data->>'teacher_id'; destination:='subjects';
  else
    author:=coalesce(row_data->>'teacher_id',row_data->>'created_by');
    message:=row_data->>'title';
    if tg_table_name='subjects' then
      destination:='subjects'; heading:='Предметы обновлены';
    elsif tg_table_name='tests' then
      destination:='tests'; heading:=case when row_data->>'archived_at' is not null then 'Тест перенесён в архив' else 'Новый тест' end;
    else
      destination:=row_data->>'kind'; heading:=case when tg_op='DELETE' then 'Учебный материал удалён' else 'Учебные материалы обновлены' end;
    end if;
  end if;
  insert into public.notifications(actor_id,title,body,destination) values(author,heading,coalesce(message,''),destination);
  return case when tg_op='DELETE' then old else new end;
end; $$;
create trigger notify_materials after insert or update or delete on public.materials for each row execute function public.notify_platform_change();
create trigger notify_tests after insert or update of archived_at on public.tests for each row execute function public.notify_platform_change();
create trigger notify_subjects after insert or update on public.subjects for each row execute function public.notify_platform_change();
create trigger notify_instructors after insert or delete on public.subject_teachers for each row execute function public.notify_platform_change();
create trigger notify_teacher_profile after update on public.teacher_profiles for each row execute function public.notify_platform_change();
create trigger notify_teacher_documents after insert or delete on public.teacher_documents for each row execute function public.notify_platform_change();
create trigger notify_schedule after insert or update or delete on public.schedule_entries for each row execute function public.notify_platform_change();
create trigger notify_result after insert or update of review_revision on public.test_results for each row execute function public.notify_platform_change();

create function public.notification_feed(p_user_id text,p_offset integer default 0) returns jsonb
language sql set search_path='' as $$
select jsonb_build_object('unreadCount',(select count(*) from public.notifications n
  where (n.recipient_id is null or n.recipient_id=p_user_id) and not exists
  (select 1 from public.notification_reads r where r.notification_id=n.id and r.user_id=p_user_id)),
  'rows',coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc,page.id) from
    (select n.id,n.title,n.body,n.severity,n.destination,n.created_at,
      exists(select 1 from public.notification_reads r where r.notification_id=n.id and r.user_id=p_user_id) as read
    from public.notifications n where n.recipient_id is null or n.recipient_id=p_user_id
    order by n.created_at desc,n.id limit 50 offset p_offset) page),'[]'::jsonb));
$$;
create function public.read_notifications(p_user_id text,p_ids jsonb) returns void
language sql set search_path='' as $$
insert into public.notification_reads(user_id,notification_id)
select p_user_id,n.id from public.notifications n where (n.recipient_id is null or n.recipient_id=p_user_id)
and n.id in(select jsonb_array_elements_text(p_ids)) on conflict do nothing;
$$;
create function public.list_accounts(p_actor_id text,p_search text,p_offset integer default 0) returns jsonb
language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.account_roles where user_id=p_actor_id and role='admin') then
    raise exception using errcode='42501',message='Недостаточно прав.';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(page) order by page.name,page.id) from (
    select p.id,p.name,p.email,r.role,not public.valid_full_name(p.name,p.no_patronymic) as needs_name
    from public.profiles p join public.account_roles r on r.user_id=p.id
    where p_search='' or strpos(lower(p.name||' '||p.email),lower(p_search))>0
    order by p.name,p.id limit 50 offset p_offset) page),'[]'::jsonb);
end; $$;

-- Also enforce the current role inside the existing grading transaction.
do $$ declare definition text;
begin
  definition:=pg_get_functiondef('public.review_test_result(text,text,jsonb,text,integer)'::regprocedure);
  execute replace(definition,'exists(select 1 from public.teachers where user_id = p_teacher_id)',
    'exists(select 1 from public.account_roles where user_id = p_teacher_id and role in (''teacher'',''admin''))');
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
('lms-profiles','lms-profiles',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']);

alter table public.account_roles enable row level security;
alter table public.teacher_profiles enable row level security;
alter table public.teacher_documents enable row level security;
alter table public.schedule_entries enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;
alter table public.role_changes enable row level security;
revoke all on public.account_roles,public.teacher_profiles,public.teacher_documents,public.schedule_entries,
  public.notifications,public.notification_reads,public.role_changes from public,anon,authenticated;
revoke all on public.teacher_directory from public,anon,authenticated;
grant select on public.teacher_directory to service_role;
grant select,insert,update,delete on public.account_roles,public.teacher_profiles,public.teacher_documents,
  public.schedule_entries,public.notifications,public.notification_reads to service_role;
grant select,insert,delete on public.role_changes to service_role;
revoke all on function public.initial_account_role(),public.provision_teacher_role(),public.sync_name_notice(),
  public.valid_full_name(text,boolean),public.set_account_role(text,text,text,text),public.notify_platform_change(),
  public.notification_feed(text,integer),public.read_notifications(text,jsonb),public.list_accounts(text,text,integer) from public,anon,authenticated;
grant execute on function public.valid_full_name(text,boolean),public.set_account_role(text,text,text,text),
  public.notification_feed(text,integer),public.read_notifications(text,jsonb),public.list_accounts(text,text,integer) to service_role;

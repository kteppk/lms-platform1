create table public.subjects (
  id text primary key default gen_random_uuid()::text,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  created_by text not null references public.profiles(id),
  archived_at timestamptz
);

create unique index subjects_active_title on public.subjects (lower(btrim(title)))
  where archived_at is null;

create table public.subject_teachers (
  subject_id text not null references public.subjects(id),
  teacher_id text not null references public.teachers(user_id) on delete cascade,
  primary key (subject_id, teacher_id)
);

create index subject_teachers_by_teacher on public.subject_teachers (teacher_id, subject_id);

alter table public.materials
  add column subject_id text references public.subjects(id),
  add column attachment_details jsonb not null default '[]' check (jsonb_typeof(attachment_details) = 'array');
alter table public.tests add column subject_id text references public.subjects(id);

create index materials_subject_feed on public.materials (subject_id, teacher_id, kind, created_at desc)
  where subject_id is not null;
create index tests_subject_feed on public.tests (subject_id, teacher_id, created_at desc)
  where subject_id is not null;

alter table public.subjects enable row level security;
alter table public.subject_teachers enable row level security;

create view public.subject_instructors with (security_invoker = true) as
select s.id as subject_id, st.teacher_id, p.name as teacher_name
from public.subjects s
join public.subject_teachers st on st.subject_id = s.id
join public.profiles p on p.id = st.teacher_id
where s.archived_at is null;

revoke all on public.subjects, public.subject_teachers, public.subject_instructors
  from public, anon, authenticated;
grant select, insert, update on public.subjects to service_role;
grant select, insert, update, delete on public.subject_teachers to service_role;
grant select on public.subject_instructors to service_role;

create function public.ensure_active_subject() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.subjects s
    where s.id = new.subject_id and s.archived_at is null for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'Предмет недоступен.';
  end if;
  return new;
end;
$$;

create trigger subject_teachers_require_active_subject
  before insert or update of subject_id on public.subject_teachers
  for each row execute function public.ensure_active_subject();

create function public.ensure_subject_instructor() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.subject_id is not null then
    perform 1 from public.subjects s
      join public.subject_teachers st on st.subject_id = s.id
      where s.id = new.subject_id and st.teacher_id = new.teacher_id and s.archived_at is null
      for share of s, st;
    if not found then
      raise exception using errcode = '42501', message = 'Вы не ведёте этот предмет.';
    end if;
  end if;
  return new;
end;
$$;

create trigger materials_require_subject_instructor
  before insert or update of subject_id, teacher_id on public.materials
  for each row execute function public.ensure_subject_instructor();
create trigger tests_require_subject_instructor
  before insert or update of subject_id, teacher_id on public.tests
  for each row execute function public.ensure_subject_instructor();

create function public.create_subject(p_teacher_id text, p_title text, p_description text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  new_subject_id text;
begin
  insert into public.subjects (title, description, created_by)
    values (p_title, p_description, p_teacher_id) returning id into new_subject_id;
  insert into public.subject_teachers (subject_id, teacher_id)
    values (new_subject_id, p_teacher_id);
  return new_subject_id;
end;
$$;

revoke all on function public.ensure_active_subject(), public.ensure_subject_instructor(),
  public.create_subject(text, text, text) from public, anon, authenticated;
grant execute on function public.create_subject(text, text, text) to service_role;

update storage.buckets
set allowed_mime_types = array(
  select distinct unnest(allowed_mime_types || array[
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ])
)
where id = 'lms-lectures' and allowed_mime_types is not null;

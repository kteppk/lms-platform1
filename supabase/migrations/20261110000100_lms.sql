create table public.profiles (
  id text primary key,
  name text not null check (char_length(name) between 1 and 120),
  email text not null,
  created_at timestamptz not null default now()
);

create table public.teachers (
  user_id text primary key references public.profiles(id)
);

create view public.student_profiles with (security_invoker = true) as
select p.id, p.name, p.email, p.created_at
from public.profiles p
where not exists (select 1 from public.teachers t where t.user_id = p.id);

create table public.materials (
  id text primary key default gen_random_uuid()::text,
  kind text not null check (kind in ('lectures', 'books')),
  teacher_id text not null,
  teacher_name text not null,
  title text not null,
  body text not null,
  author text,
  files text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index materials_kind_date on public.materials (kind, created_at desc);
create index materials_kind_teacher_date on public.materials (kind, teacher_id, created_at desc);

create table public.tests (
  id text primary key default gen_random_uuid()::text,
  teacher_id text not null,
  teacher_name text not null,
  title text not null,
  timer integer not null check (timer between 0 and 1440),
  questions jsonb not null check (jsonb_array_length(questions) between 1 and 100),
  created_at timestamptz not null default now()
);

create index tests_date on public.tests (created_at desc);
create index tests_teacher_date on public.tests (teacher_id, created_at desc);

create table public.test_attempts (
  id text primary key default gen_random_uuid()::text,
  test_id text not null,
  student_id text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.test_results (
  id text primary key,
  test_id text not null,
  test_title text not null,
  teacher_id text not null,
  student_id text not null,
  student_name text not null,
  answers jsonb not null,
  score integer not null,
  total integer not null,
  percentage integer not null,
  submitted_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.teachers enable row level security;
alter table public.materials enable row level security;
alter table public.tests enable row level security;
alter table public.test_attempts enable row level security;
alter table public.test_results enable row level security;

revoke all on public.profiles, public.teachers, public.student_profiles, public.materials,
  public.tests, public.test_attempts, public.test_results from public, anon, authenticated;
grant select, insert, update, delete on public.profiles, public.teachers, public.materials,
  public.tests, public.test_attempts, public.test_results to service_role;
grant select on public.student_profiles to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('lms-lectures', 'lms-lectures', false, 52428800, array[
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'video/mp4', 'text/html'
  ]),
  ('lms-books', 'lms-books', false, 52428800, array['application/pdf']),
  ('lms-photos', 'lms-photos', false, 10485760, array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
    'image/heif', 'image/avif', 'image/bmp', 'image/tiff'
  ]);

create function public.submit_test_attempt(
  p_attempt_id text,
  p_student_id text,
  p_answers jsonb,
  p_received_at timestamptz
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  attempt public.test_attempts%rowtype;
  test public.tests%rowtype;
  result public.test_results%rowtype;
  student_name text;
  correct_count integer;
  total_count integer;
begin
  -- Serialize simultaneous submissions before looking for a saved result.
  select * into attempt from public.test_attempts
    where id = p_attempt_id and student_id = p_student_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Попытка недоступна.';
  end if;

  select * into result from public.test_results where id = p_attempt_id;
  if not found then
    if attempt.expires_at is not null and p_received_at > attempt.expires_at + interval '15 seconds' then
      raise exception using errcode = 'P0001', message = 'Время на прохождение теста истекло.';
    end if;
    select * into test from public.tests where id = attempt.test_id for share;
    if not found then
      raise exception using errcode = 'P0002', message = 'Тест удалён.';
    end if;
    select name into strict student_name from public.profiles where id = p_student_id;

    select count(*) filter (
      where question->>'type' = 'choice' and
        p_answers->((position - 1)::text) = question->'correct'
    ), count(*)
    into correct_count, total_count
    from jsonb_array_elements(test.questions) with ordinality as q(question, position);

    insert into public.test_results
      (id, test_id, test_title, teacher_id, student_id, student_name, answers, score, total, percentage)
    values
      (p_attempt_id, test.id, test.title, test.teacher_id, p_student_id, student_name, p_answers,
       correct_count, total_count, round(correct_count * 100.0 / total_count))
    returning * into result;
  end if;

  return jsonb_build_object('score', result.score, 'total', result.total, 'percentage', result.percentage);
end;
$$;

revoke all on function public.submit_test_attempt(text, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.submit_test_attempt(text, text, jsonb, timestamptz) to service_role;

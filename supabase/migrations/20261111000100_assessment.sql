alter table public.tests add column archived_at timestamptz;
alter table public.test_attempts
  add column test_snapshot jsonb not null default '{}',
  add column answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object'),
  add column revision integer not null default 0,
  add column state text not null default 'active' check (state in ('active', 'submitted', 'superseded', 'unavailable'));

update public.test_attempts a set test_snapshot = to_jsonb(t)
  from public.tests t where t.id = a.test_id;
update public.test_attempts a set state = 'submitted', answers = r.answers
  from public.test_results r where r.id = a.id;
update public.test_attempts set state = 'unavailable'
  where state = 'active' and not (test_snapshot ? 'questions');
with duplicates as (
  select id, row_number() over (partition by student_id, test_id order by created_at desc, id desc) as n
  from public.test_attempts where state = 'active'
)
update public.test_attempts a set state = 'superseded' from duplicates d where d.id = a.id and d.n > 1;
create unique index one_active_test_attempt on public.test_attempts (student_id, test_id) where state = 'active';
create index student_active_attempts on public.test_attempts (student_id, created_at desc) where state = 'active';

alter table public.test_results
  add column test_snapshot jsonb not null default '{}',
  add column question_scores jsonb not null default '{}',
  add column status text not null default 'graded' check (status in ('pending_review', 'graded')),
  add column feedback text not null default '',
  add column graded_by text,
  add column graded_at timestamptz,
  add column review_revision integer not null default 0,
  alter column percentage drop not null;
update public.test_results r set test_snapshot = a.test_snapshot from public.test_attempts a where a.id = r.id;
update public.test_results r set test_snapshot = to_jsonb(t)
  from public.tests t where t.id = r.test_id and not (r.test_snapshot ? 'questions');
update public.test_results r set question_scores = (
  select coalesce(jsonb_object_agg((n-1)::text, case when q->>'type' = 'choice'
    then to_jsonb(case when r.answers->((n-1)::text) = q->'correct' then 1 else 0 end) else 'null'::jsonb end), '{}')
  from jsonb_array_elements(coalesce(r.test_snapshot->'questions', '[]')) with ordinality as x(q,n)
);
update public.test_results set status = 'pending_review', percentage = null
  where exists (select 1 from jsonb_each(question_scores) s where s.value = 'null'::jsonb);
create index teacher_gradebook on public.test_results (teacher_id, submitted_at desc, id);
create index student_gradebook on public.test_results (student_id, submitted_at desc, id);

create table public.test_result_reviews (
  id text primary key default gen_random_uuid()::text,
  result_id text not null references public.test_results(id) on delete cascade,
  teacher_id text not null,
  grades jsonb not null,
  feedback text not null,
  score integer not null,
  reviewed_at timestamptz not null default now()
);
alter table public.test_result_reviews enable row level security;
revoke all on public.test_result_reviews from public, anon, authenticated;
grant select, insert, delete on public.test_result_reviews to service_role;

create function public.result_summary(r public.test_results) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'score', r.score, 'total', r.total,
    'percentage', r.percentage, 'status', r.status, 'feedback', r.feedback,
    'gradedAt', r.graded_at, 'reviewRevision', r.review_revision);
$$;

create function public.validate_attempt_answers(snapshot jsonb, answers jsonb, student_id text, attempt_id text)
returns void language plpgsql set search_path = '' as $$
declare k text; v jsonb; q jsonb;
begin
  if jsonb_typeof(answers) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Некорректные ответы.';
  end if;
  for k,v in select * from jsonb_each(answers) loop
    if k !~ '^(0|[1-9][0-9]{0,2})$' then
      raise exception using errcode = '22023', message = 'Неизвестный вопрос.';
    end if;
    q := snapshot->'questions'->(k::integer);
    if q is null then raise exception using errcode = '22023', message = 'Неизвестный вопрос.'; end if;
    if q->>'type' = 'choice' and jsonb_typeof(v) = 'number' and v::text ~ '^[0-3]$' then continue; end if;
    if q->>'type' = 'text' and jsonb_typeof(v) = 'string' and char_length(v #>> '{}') <= 5000 then continue; end if;
    if q->>'type' = 'photo' and jsonb_typeof(v) = 'string'
      and left(v #>> '{}', char_length(student_id || '/' || attempt_id || '/')) = student_id || '/' || attempt_id || '/'
      and substring(v #>> '{}' from char_length(student_id || '/' || attempt_id || '/') + 1) ~ '^[A-Za-z0-9_-]{1,128}$'
      then continue; end if;
    raise exception using errcode = '22023', message = 'Некорректный ответ.';
  end loop;
end;
$$;

create function public.finish_test_attempt(p_attempt_id text, p_student_id text, p_answers jsonb,
  p_expected_revision integer, p_received_at timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare a public.test_attempts%rowtype; r public.test_results%rowtype;
  chosen jsonb; scores jsonb; points integer; count_questions integer; needs_review boolean; student_name text;
begin
  select * into a from public.test_attempts where id = p_attempt_id and student_id = p_student_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Попытка недоступна.'; end if;
  select * into r from public.test_results where id = a.id;
  if found then return public.result_summary(r); end if;
  if a.state <> 'active' then raise exception using errcode = 'P0002', message = 'Попытка закрыта.'; end if;
  chosen := a.answers;
  -- Late submissions finalize the last saved draft instead of losing the attempt.
  if p_answers is not null and (a.expires_at is null or p_received_at <= a.expires_at + interval '15 seconds') then
    if p_expected_revision is not null and p_expected_revision <> a.revision then
      raise exception using errcode = '40001', message = 'Ответы изменены в другом окне. Обновите попытку.';
    end if;
    perform public.validate_attempt_answers(a.test_snapshot, p_answers, p_student_id, p_attempt_id);
    chosen := p_answers;
  end if;
  select coalesce(jsonb_object_agg((n-1)::text, case when q->>'type' = 'choice'
      then to_jsonb(case when chosen->((n-1)::text) = q->'correct' then 1 else 0 end) else 'null'::jsonb end), '{}'),
    count(*)::integer, coalesce(bool_or(q->>'type' <> 'choice'), false)
    into scores, count_questions, needs_review
    from jsonb_array_elements(a.test_snapshot->'questions') with ordinality as x(q,n);
  if count_questions < 1 then raise exception using errcode = 'P0002', message = 'Вопросы попытки недоступны.'; end if;
  select coalesce(sum(value::text::integer),0)::integer into points from jsonb_each(scores) where value <> 'null'::jsonb;
  select name into strict student_name from public.profiles where id = p_student_id;
  insert into public.test_results (id,test_id,test_title,teacher_id,student_id,student_name,answers,
    score,total,percentage,test_snapshot,question_scores,status)
  values (a.id,a.test_id,a.test_snapshot->>'title',a.test_snapshot->>'teacher_id',p_student_id,student_name,chosen,
    points,count_questions,case when needs_review then null else round(points*100.0/count_questions)::integer end,
    a.test_snapshot,scores,case when needs_review then 'pending_review' else 'graded' end) returning * into r;
  update public.test_attempts set state = 'submitted', answers = chosen, revision = revision + 1 where id = a.id;
  return public.result_summary(r);
end;
$$;

-- Keep the deployed v1 handler compatible while the function is being updated.
create or replace function public.submit_test_attempt(p_attempt_id text, p_student_id text,
  p_answers jsonb, p_received_at timestamptz) returns jsonb language sql set search_path = '' as $$
  select public.finish_test_attempt(p_attempt_id,p_student_id,p_answers,null,p_received_at);
$$;

create function public.open_test_attempt(p_test_id text, p_student_id text) returns jsonb
language plpgsql set search_path = '' as $$
declare a public.test_attempts%rowtype; t public.tests%rowtype;
begin
  perform 1 from public.profiles where id = p_student_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Профиль недоступен.'; end if;
  select * into a from public.test_attempts where test_id = p_test_id and student_id = p_student_id and state = 'active' for update;
  if not found then
    select * into t from public.tests where id = p_test_id and archived_at is null for share;
    if not found then raise exception using errcode = 'P0002', message = 'Тест недоступен.'; end if;
    if t.subject_id is not null then
      perform 1 from public.subjects s join public.subject_teachers st on st.subject_id = s.id
        where s.id = t.subject_id and s.archived_at is null and st.teacher_id = t.teacher_id for share of s,st;
      if not found then raise exception using errcode = 'P0002', message = 'Тест недоступен.'; end if;
    end if;
    insert into public.test_attempts (test_id,student_id,test_snapshot,expires_at)
      values (t.id,p_student_id,to_jsonb(t),case when t.timer > 0 then now()+make_interval(mins=>t.timer) else null end)
      returning * into a;
  end if;
  if a.expires_at is not null and now() >= a.expires_at then
    perform public.finish_test_attempt(a.id,p_student_id,null,null,now());
    select * into a from public.test_attempts where id = a.id;
  end if;
  return to_jsonb(a);
end;
$$;

create function public.read_test_attempt(p_attempt_id text, p_student_id text) returns jsonb
language plpgsql set search_path = '' as $$
declare a public.test_attempts%rowtype;
begin
  select * into a from public.test_attempts where id = p_attempt_id and student_id = p_student_id for update;
  if not found or a.state not in ('active','submitted') then
    raise exception using errcode = 'P0002', message = 'Попытка недоступна.';
  end if;
  if a.state = 'active' and a.expires_at is not null and now() >= a.expires_at then
    perform public.finish_test_attempt(a.id,p_student_id,null,null,now());
    select * into a from public.test_attempts where id = a.id;
  end if;
  return to_jsonb(a);
end;
$$;

create function public.save_test_draft(p_attempt_id text, p_student_id text, p_answers jsonb, p_expected_revision integer)
returns jsonb language plpgsql set search_path = '' as $$
declare a public.test_attempts%rowtype;
begin
  select * into a from public.test_attempts where id = p_attempt_id and student_id = p_student_id for update;
  if not found or a.state <> 'active' then raise exception using errcode = 'P0002', message = 'Попытка закрыта.'; end if;
  if a.expires_at is not null and now() > a.expires_at then
    raise exception using errcode = 'P0001', message = 'Время на прохождение теста истекло.';
  end if;
  if p_expected_revision is null or p_expected_revision <> a.revision then
    raise exception using errcode = '40001', message = 'Ответы изменены в другом окне. Обновите попытку.';
  end if;
  perform public.validate_attempt_answers(a.test_snapshot,p_answers,p_student_id,p_attempt_id);
  update public.test_attempts set answers = p_answers, revision = revision + 1 where id = a.id returning * into a;
  return jsonb_build_object('revision',a.revision);
end;
$$;

create function public.review_test_result(p_result_id text, p_teacher_id text, p_grades jsonb,
  p_feedback text, p_expected_revision integer) returns jsonb
language plpgsql set search_path = '' as $$
declare r public.test_results%rowtype; k text; v jsonb; scores jsonb; points integer; manual_count integer;
begin
  select * into r from public.test_results where id = p_result_id and teacher_id = p_teacher_id for update;
  if not found or not exists(select 1 from public.teachers where user_id = p_teacher_id) then
    raise exception using errcode = 'P0002', message = 'Работа недоступна.';
  end if;
  if p_expected_revision is null or p_expected_revision <> r.review_revision then
    raise exception using errcode = '40001', message = 'Работа уже изменена. Обновите страницу проверки.';
  end if;
  if jsonb_typeof(p_grades) is distinct from 'object' or p_feedback is null or char_length(p_feedback) > 5000 then
    raise exception using errcode = '22023', message = 'Некорректная проверка.';
  end if;
  select count(*)::integer into manual_count from jsonb_array_elements(coalesce(r.test_snapshot->'questions','[]')) q
    where q->>'type' in ('text','photo');
  if manual_count = 0 or (select count(*) from jsonb_object_keys(p_grades)) <> manual_count then
    raise exception using errcode = '22023', message = 'Оцените каждый текстовый и фотоответ.';
  end if;
  scores := r.question_scores;
  for k,v in select * from jsonb_each(p_grades) loop
    if k !~ '^(0|[1-9][0-9]{0,2})$' then raise exception using errcode = '22023', message = 'Неизвестный вопрос.'; end if;
    if coalesce(r.test_snapshot->'questions'->(k::integer)->>'type','') not in ('text','photo')
      or jsonb_typeof(v) <> 'number' or v::text !~ '^[01]$' then
      raise exception using errcode = '22023', message = 'Допустимы 0 или 1 балл за ручной ответ.';
    end if;
    scores := jsonb_set(scores,array[k],v);
  end loop;
  select sum(value::text::integer)::integer into points from jsonb_each(scores);
  update public.test_results set question_scores = scores, score = points,
    percentage = round(points*100.0/total)::integer, status = 'graded', feedback = p_feedback,
    graded_by = p_teacher_id, graded_at = now(), review_revision = review_revision + 1
    where id = r.id returning * into r;
  insert into public.test_result_reviews(result_id,teacher_id,grades,feedback,score)
    values(r.id,p_teacher_id,p_grades,p_feedback,r.score);
  return public.result_summary(r);
end;
$$;

revoke all on function public.result_summary(public.test_results),
  public.validate_attempt_answers(jsonb,jsonb,text,text),
  public.finish_test_attempt(text,text,jsonb,integer,timestamptz),
  public.open_test_attempt(text,text),public.read_test_attempt(text,text),
  public.save_test_draft(text,text,jsonb,integer),public.review_test_result(text,text,jsonb,text,integer)
  from public, anon, authenticated;
grant execute on function public.result_summary(public.test_results),
  public.validate_attempt_answers(jsonb,jsonb,text,text),
  public.finish_test_attempt(text,text,jsonb,integer,timestamptz),
  public.open_test_attempt(text,text),public.read_test_attempt(text,text),
  public.save_test_draft(text,text,jsonb,integer),public.review_test_result(text,text,jsonb,text,integer)
  to service_role;

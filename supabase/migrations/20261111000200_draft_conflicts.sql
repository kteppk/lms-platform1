-- Business conflicts are HTTP 409, not a retryable database/server failure.
do $$
declare signature text; definition text;
begin
  foreach signature in array array[
    'public.finish_test_attempt(text,text,jsonb,integer,timestamp with time zone)',
    'public.review_test_result(text,text,jsonb,text,integer)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    execute replace(definition, 'errcode = ''40001''', 'errcode = ''PT409''');
  end loop;
end;
$$;

create or replace function public.save_test_draft(p_attempt_id text, p_student_id text,
  p_answers jsonb, p_expected_revision integer) returns jsonb
language plpgsql set search_path = '' as $$
declare a public.test_attempts%rowtype;
begin
  select * into a from public.test_attempts where id = p_attempt_id and student_id = p_student_id for update;
  if not found or a.state <> 'active' then raise exception using errcode = 'P0002', message = 'Попытка закрыта.'; end if;
  if a.expires_at is not null and now() > a.expires_at then
    raise exception using errcode = 'P0001', message = 'Время на прохождение теста истекло.';
  end if;
  -- A lost HTTP response may be retried with exactly the same draft.
  if p_expected_revision = a.revision - 1 and p_answers = a.answers then
    return jsonb_build_object('revision',a.revision);
  end if;
  if p_expected_revision is null or p_expected_revision <> a.revision then
    raise exception using errcode = 'PT409', message = 'Ответы изменены в другом окне. Обновите попытку.';
  end if;
  perform public.validate_attempt_answers(a.test_snapshot,p_answers,p_student_id,p_attempt_id);
  update public.test_attempts set answers = p_answers, revision = revision + 1 where id = a.id returning * into a;
  return jsonb_build_object('revision',a.revision);
end;
$$;

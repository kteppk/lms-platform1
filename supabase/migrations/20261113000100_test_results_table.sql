-- Keep every attempt/review; add only an optional per-test mark conversion.
create table public.test_grading_scales (
  test_id text primary key references public.tests(id) on delete cascade,
  min_three integer not null check(min_three between 0 and 98),
  min_four integer not null check(min_four between 1 and 99),
  min_five integer not null check(min_five between 2 and 100),
  revision integer not null default 0,
  updated_by text not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  check(min_three<min_four and min_four<min_five)
);
create index results_test_student_date on public.test_results(test_id,student_id,submitted_at desc,id);

create function public.check_result_reader(p_user_id text,p_teacher boolean) returns void
language plpgsql set search_path='' as $$
declare actual_teacher boolean; account_role text;
begin
  select role into account_role from public.account_roles where user_id=p_user_id;
  actual_teacher:=account_role in ('teacher','admin') and exists(select 1 from public.teachers where user_id=p_user_id);
  if account_role is null or p_teacher is null or p_teacher is distinct from actual_teacher
    or (not p_teacher and account_role<>'student') then
    raise exception using errcode='42501',message='Недостаточно прав для просмотра результатов.';
  end if;
end; $$;

create function public.list_result_tests(p_user_id text,p_teacher boolean) returns jsonb
language plpgsql set search_path='' as $$
begin
  perform public.check_result_reader(p_user_id,p_teacher);
  return coalesce((with owned_results as (
    select r.* from public.test_results r
    where case when p_teacher then r.teacher_id=p_user_id else r.student_id=p_user_id end
  ), ids as (
    select test_id id from owned_results
    union select id from public.tests where p_teacher and teacher_id=p_user_id
  ), catalog as (
    select i.id,coalesce(t.title,(select r.test_title from owned_results r where r.test_id=i.id order by r.submitted_at desc,r.id desc limit 1)) title,
      case when t.id is null then 'retained' when t.archived_at is null then 'active' else 'archived' end state,
      (select count(*) from owned_results r where r.test_id=i.id) attempts,
      (select count(distinct student_id) from owned_results r where r.test_id=i.id) students,
      (select count(*) from owned_results r where r.test_id=i.id and r.status='pending_review') pending
    from ids i left join public.tests t on t.id=i.id
  ) select jsonb_agg(to_jsonb(c) order by c.title,c.id) from catalog c),'[]'::jsonb);
end; $$;

create function public.save_test_grading_scale(p_teacher_id text,p_test_id text,p_revision integer,p_three integer,p_four integer,p_five integer)
returns jsonb language plpgsql set search_path='' as $$
declare previous public.test_grading_scales; result public.test_grading_scales;
begin
  perform public.check_result_reader(p_teacher_id,true);
  perform 1 from public.tests where id=p_test_id and teacher_id=p_teacher_id for update;
  if not found then raise exception using errcode='P0002',message='Тест недоступен.'; end if;
  select * into previous from public.test_grading_scales where test_id=p_test_id;
  -- -1 means the teacher opened a test with no configured scale.
  if p_revision is null or p_revision<>coalesce(previous.revision,-1) then
    raise exception using errcode='PT409',message='Шкала уже изменена. Обновите результаты перед сохранением.';
  end if;
  if p_three is null or p_four is null or p_five is null or p_three<0 or p_five>100 or not(p_three<p_four and p_four<p_five) then
    raise exception using errcode='22023',message='Пороги должны возрастать: оценка 3 < оценка 4 < оценка 5, от 0 до 100%.';
  end if;
  if previous.test_id is not null and (previous.min_three,previous.min_four,previous.min_five)=(p_three,p_four,p_five) then return to_jsonb(previous); end if;
  insert into public.test_grading_scales(test_id,min_three,min_four,min_five,updated_by,revision)
  values(p_test_id,p_three,p_four,p_five,p_teacher_id,0)
  on conflict(test_id) do update set min_three=p_three,min_four=p_four,min_five=p_five,
    updated_by=p_teacher_id,revision=public.test_grading_scales.revision+1,updated_at=now() returning * into result;
  return to_jsonb(result);
end; $$;

create function public.test_results_table(p_user_id text,p_teacher boolean,p_test_id text,p_mode text,p_search text,p_status text,
  p_student_id text,p_sort text,p_offset integer,p_export boolean)
returns jsonb language plpgsql set search_path='' as $$
declare response jsonb;
begin
  perform public.check_result_reader(p_user_id,p_teacher);
  if p_export is null or (p_export and not p_teacher) then raise exception using errcode='42501',message='Выгрузка доступна преподавателю.'; end if;
  if p_test_id is null or not (
    exists(select 1 from public.test_results r where r.test_id=p_test_id and case when p_teacher then r.teacher_id=p_user_id else r.student_id=p_user_id end)
    or (p_teacher and exists(select 1 from public.tests where id=p_test_id and teacher_id=p_user_id))
  ) then raise exception using errcode='P0002',message='Тест недоступен.'; end if;
  if p_mode is null or p_mode not in ('latest','all') or p_sort is null or p_sort not in ('name','date','score')
    or p_status is null or p_status not in ('','graded','pending_review') or p_search is null or char_length(p_search)>120
    or p_offset is null or p_offset<0 or p_offset>100000 then raise exception using errcode='22023',message='Некорректный фильтр результатов.'; end if;
  -- One statement supplies the scale, counts and export rows from the same snapshot.
  with scoped as (
    select r.*,row_number() over(partition by r.student_id order by r.submitted_at,r.id) attempt_number,
      count(*) over(partition by r.student_id) attempt_count,
      row_number() over(partition by r.student_id order by r.submitted_at desc,r.id desc) latest
    from public.test_results r where r.test_id=p_test_id
      and case when p_teacher then r.teacher_id=p_user_id else r.student_id=p_user_id end
  ), filtered as (
    select s.* from scoped s where (p_mode='all' or latest=1)
      and (p_status='' or s.status=p_status) and (p_student_id is null or s.student_id=p_student_id)
      and (not p_teacher or p_search='' or strpos(lower(s.student_name),lower(p_search))>0)
  ), ordered as (
    select f.*,row_number() over(order by
      case when p_sort='name' then lower(f.student_name) end,
      case when p_sort='score' and f.status='graded' and f.total>0 then f.score::numeric/f.total end desc nulls last,
      f.submitted_at desc,f.id desc) position
    from filtered f
  ), scale as (select * from public.test_grading_scales where test_id=p_test_id), page as (
    select o.*,case when o.status<>'graded' or o.total<=0 then null
      when o.score::bigint*100>=g.min_five::bigint*o.total then 5
      when o.score::bigint*100>=g.min_four::bigint*o.total then 4
      when o.score::bigint*100>=g.min_three::bigint*o.total then 3
      when g.test_id is not null then 2 else null end mark
    from ordered o left join scale g on true
    order by o.position offset case when p_export then 0 else p_offset end limit case when p_export then 5000 else 50 end
  ) select jsonb_build_object(
    'test',jsonb_build_object('id',p_test_id,
      'title',coalesce((select title from public.tests where id=p_test_id),(select test_title from scoped order by submitted_at desc,id desc limit 1)),
      'canSetScale',p_teacher and exists(select 1 from public.tests where id=p_test_id and teacher_id=p_user_id)),
    'scale',(select to_jsonb(g)-'updated_by' from scale g),
    'summary',jsonb_build_object('rows',(select count(*) from filtered),'students',(select count(distinct student_id) from filtered),
      'pending',(select count(*) from filtered where status='pending_review'),'graded',(select count(*) from filtered where status='graded')),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'test_id',p.test_id,'test_title',p.test_title,
      'student_id',p.student_id,'student_name',p.student_name,'score',p.score,'total',p.total,'percentage',p.percentage,'status',p.status,
      'submitted_at',p.submitted_at,'graded_at',p.graded_at,'attempt_number',p.attempt_number,'attempt_count',p.attempt_count,'mark',p.mark)
      order by p.position) from page p),'[]'::jsonb),
    'hasMore',not p_export and (select count(*) from filtered)>p_offset+50,
    'generatedAt',statement_timestamp()
  ) into response;
  if p_export and (response->'summary'->>'rows')::integer>5000 then raise exception using errcode='22023',message='Для выгрузки доступно до 5000 попыток. Сузьте фильтр.'; end if;
  return response;
end; $$;

alter table public.test_grading_scales enable row level security;
revoke all on public.test_grading_scales from public,anon,authenticated;
grant select,insert,update,delete on public.test_grading_scales to service_role;
revoke all on function public.check_result_reader(text,boolean),public.list_result_tests(text,boolean),
  public.save_test_grading_scale(text,text,integer,integer,integer,integer),
  public.test_results_table(text,boolean,text,text,text,text,text,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.check_result_reader(text,boolean),public.list_result_tests(text,boolean),
  public.save_test_grading_scale(text,text,integer,integer,integer,integer),
  public.test_results_table(text,boolean,text,text,text,text,text,text,integer,boolean) to service_role;

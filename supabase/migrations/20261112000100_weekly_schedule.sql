-- The college timetable repeats every week. Dated entries remain intact.
create table public.study_groups (
  id text primary key default gen_random_uuid()::text,
  name text not null check(char_length(btrim(name)) between 1 and 100),
  course text not null default '' check(char_length(course)<=40),
  program text not null default '' check(char_length(program)<=200),
  lessons_per_day integer not null default 6 check(lessons_per_day between 1 and 12),
  created_by text not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index study_groups_name on public.study_groups(lower(regexp_replace(btrim(name),'\s+',' ','g')));
insert into public.study_groups(name,created_by)
select distinct on (lower(regexp_replace(btrim(group_name),'\s+',' ','g')))
  regexp_replace(btrim(group_name),'\s+',' ','g'),created_by
from public.schedule_entries where btrim(group_name)<>'' order by lower(regexp_replace(btrim(group_name),'\s+',' ','g')),id;

create table public.weekly_schedule_cells (
  id text primary key default gen_random_uuid()::text,
  group_id text not null references public.study_groups(id),
  weekday integer not null check(weekday between 1 and 7),
  lesson_number integer not null check(lesson_number between 1 and 12),
  status text not null check(status in ('lesson','free')),
  title text not null default '' check(char_length(title)<=200),
  subject_id text references public.subjects(id),
  teacher_id text references public.profiles(id),
  teacher_label text not null default '' check(char_length(teacher_label)<=120),
  room text not null default '' check(char_length(room)<=100),
  note text not null default '' check(char_length(note)<=1000),
  starts_at time,
  ends_at time,
  revision integer not null default 0 check(revision>=0),
  updated_by text not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique(group_id,weekday,lesson_number),
  check ((starts_at is null and ends_at is null) or (starts_at is not null and ends_at is not null and ends_at>starts_at)),
  check ((status='lesson' and char_length(btrim(title))>0) or
    (status='free' and title='' and subject_id is null and teacher_id is null and teacher_label='' and room='' and note='' and starts_at is null and ends_at is null))
);

create function public.create_schedule_group(p_actor_id text,p_name text,p_course text,p_program text,p_lessons integer)
returns jsonb language plpgsql set search_path='' as $$
declare result public.study_groups;
begin
  if not exists(select 1 from public.account_roles where user_id=p_actor_id and role='admin') then
    raise exception using errcode='42501',message='Только администратор может создавать группы.';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 100 or p_lessons is null or p_lessons not between 1 and 12 then
    raise exception using errcode='22023',message='Укажите группу и число пар от 1 до 12.';
  end if;
  insert into public.study_groups(name,course,program,lessons_per_day,created_by)
  values(regexp_replace(btrim(p_name),'\s+',' ','g'),coalesce(p_course,''),coalesce(p_program,''),p_lessons,p_actor_id) returning * into result;
  return to_jsonb(result)-'created_by';
exception when unique_violation then
  raise exception using errcode='22023',message='Такая группа уже существует. Выберите её в списке.';
end; $$;

create function public.save_schedule_cell(p_actor_id text,p_group_id text,p_weekday integer,p_lesson integer,
  p_expected_id text,p_revision integer,p_cell jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare previous public.weekly_schedule_cells; result public.weekly_schedule_cells; slots integer;
  state text; caption text; subject text; teacher text; teacher_name text; location text; remark text; starts time; ends time;
begin
  if not exists(select 1 from public.account_roles where user_id=p_actor_id and role='admin') then
    raise exception using errcode='42501',message='Только администратор может менять расписание.';
  end if;
  -- Serialize creation of a previously empty cell as well as edits to an existing one.
  select lessons_per_day into slots from public.study_groups where id=p_group_id for update;
  if not found then raise exception using errcode='P0002',message='Группа не найдена.'; end if;
  if p_weekday is null or p_weekday not between 1 and 7 or p_lesson is null or p_lesson not between 1 and slots
    or p_revision is null or p_revision<0 or jsonb_typeof(p_cell) is distinct from 'object' then
    raise exception using errcode='22023',message='Некорректная ячейка расписания.';
  end if;
  select * into previous from public.weekly_schedule_cells where group_id=p_group_id and weekday=p_weekday and lesson_number=p_lesson;
  if (previous.id is distinct from p_expected_id) or (previous.id is not null and previous.revision<>p_revision) then
    raise exception using errcode='PT409',message='Эта ячейка уже изменена. Закройте редактор и откройте расписание заново.';
  end if;
  state:=p_cell->>'status';
  if state is null or state not in ('lesson','free') then raise exception using errcode='22023',message='Выберите занятие или «Нет пары».'; end if;
  if state='lesson' then
    caption:=btrim(coalesce(p_cell->>'title','')); subject:=nullif(p_cell->>'subjectId',''); teacher:=nullif(p_cell->>'teacherId','');
    teacher_name:=btrim(coalesce(p_cell->>'teacherLabel','')); location:=btrim(coalesce(p_cell->>'room','')); remark:=btrim(coalesce(p_cell->>'note',''));
    starts:=nullif(p_cell->>'startsAt','')::time; ends:=nullif(p_cell->>'endsAt','')::time;
    if char_length(caption) not between 1 and 200 or char_length(teacher_name)>120 or char_length(location)>100 or char_length(remark)>1000
      or (starts is null)<>(ends is null) or ends<=starts then raise exception using errcode='22023',message='Проверьте предмет, преподавателя и время занятия.'; end if;
    if subject is not null and not exists(select 1 from public.subjects where id=subject and archived_at is null) then
      raise exception using errcode='22023',message='Предмет недоступен.';
    end if;
    if teacher is not null then
      select name into teacher_name from public.teacher_directory where id=teacher;
      if not found then raise exception using errcode='22023',message='Выберите действующего преподавателя.'; end if;
    end if;
  else caption:='';teacher_name:='';location:='';remark:=''; end if;
  if previous.id is null then
    insert into public.weekly_schedule_cells(group_id,weekday,lesson_number,status,title,subject_id,teacher_id,teacher_label,room,note,starts_at,ends_at,updated_by)
    values(p_group_id,p_weekday,p_lesson,state,caption,subject,teacher,teacher_name,location,remark,starts,ends,p_actor_id) returning * into result;
  elsif (previous.status,previous.title,previous.subject_id,previous.teacher_id,previous.teacher_label,previous.room,previous.note,previous.starts_at,previous.ends_at)
    is not distinct from (state,caption,subject,teacher,teacher_name,location,remark,starts,ends) then return to_jsonb(previous);
  else
    update public.weekly_schedule_cells set status=state,title=caption,subject_id=subject,teacher_id=teacher,teacher_label=teacher_name,
      room=location,note=remark,starts_at=starts,ends_at=ends,revision=revision+1,updated_by=p_actor_id,updated_at=now()
    where id=previous.id returning * into result;
  end if;
  return to_jsonb(result);
end; $$;

create function public.notify_weekly_schedule() returns trigger language plpgsql set search_path='' as $$
declare group_title text;
begin
  select name into group_title from public.study_groups where id=new.group_id;
  insert into public.notifications(actor_id,title,body,destination)
  values(new.updated_by,'Расписание группы '||group_title||' изменено',
    (array['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'])[new.weekday]||' · '||new.lesson_number||' пара · '||
    case when new.status='free' then 'Нет пары' else new.title end||'. Повторяется каждую неделю.','schedule');
  return new;
end; $$;
create trigger notify_weekly_schedule after insert or update on public.weekly_schedule_cells for each row execute function public.notify_weekly_schedule();

alter table public.study_groups enable row level security;
alter table public.weekly_schedule_cells enable row level security;
revoke all on public.study_groups,public.weekly_schedule_cells from public,anon,authenticated;
grant select,insert,update,delete on public.study_groups,public.weekly_schedule_cells to service_role;
revoke all on function public.create_schedule_group(text,text,text,text,integer),public.save_schedule_cell(text,text,integer,integer,text,integer,jsonb),public.notify_weekly_schedule() from public,anon,authenticated;
grant execute on function public.create_schedule_group(text,text,text,text,integer),public.save_schedule_cell(text,text,integer,integer,text,integer,jsonb) to service_role;

create table public.education_profiles(
 user_id text primary key references public.profiles(id) on delete cascade,
 specialty text not null default '' check(char_length(specialty)<=200),course integer check(course between 1 and 6),
 group_id text references public.study_groups(id) on delete set null,enrolled_on date,birth_date date,
 revision integer not null default 0,updated_at timestamptz not null default now()
);
create function public.read_education_profile(p_actor text,p_user text) returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.profiles where id=p_actor) then raise exception using errcode='42501',message='Войдите в аккаунт.';end if;
 select jsonb_build_object('specialty',coalesce(e.specialty,''),'course',e.course,'groupId',g.id,'groupName',g.name,'enrolledOn',e.enrolled_on,
 'age',extract(year from age((now() at time zone 'Asia/Krasnoyarsk')::date,e.birth_date))::integer,'revision',coalesce(e.revision,0),
 'birthDate',case when p_actor=p_user or exists(select 1 from public.account_roles where user_id=p_actor and role='admin') then e.birth_date else null end)
 into result from public.profiles p left join public.education_profiles e on e.user_id=p.id left join public.study_groups g on g.id=e.group_id where p.id=p_user;
 if result is null then raise exception using errcode='P0002',message='Профиль не найден.';end if;return result;
end; $$;
create function public.save_education_profile(p_actor text,p_revision integer,p_specialty text,p_course integer,p_group text,p_enrolled date,p_birth date) returns jsonb language plpgsql set search_path='' as $$
declare current_revision integer;today date:=(now() at time zone 'Asia/Krasnoyarsk')::date;
begin
 perform 1 from public.profiles where id=p_actor for update;if not found then raise exception using errcode='42501',message='Войдите в аккаунт.';end if;
 if p_specialty is null or char_length(p_specialty)>200 or (p_course is not null and p_course not between 1 and 6) or
 (p_birth is not null and (p_birth>today or p_birth<today-interval '120 years')) or
 (p_enrolled is not null and (p_enrolled>'2100-12-31'::date or p_enrolled<'1900-01-01'::date)) or
 (p_birth is not null and p_enrolled is not null and p_enrolled<p_birth) then raise exception using errcode='22023',message='Проверьте курс и даты.';end if;
 if p_group is not null and not exists(select 1 from public.study_groups where id=p_group) then raise exception using errcode='P0002',message='Выберите существующую группу.';end if;
 select revision into current_revision from public.education_profiles where user_id=p_actor;
 if p_revision is distinct from coalesce(current_revision,0) then raise exception using errcode='PT409',message='Данные уже изменились. Откройте профиль заново.';end if;
 insert into public.education_profiles(user_id,specialty,course,group_id,enrolled_on,birth_date,revision) values(p_actor,btrim(p_specialty),p_course,p_group,p_enrolled,p_birth,1)
 on conflict(user_id) do update set specialty=excluded.specialty,course=excluded.course,group_id=excluded.group_id,enrolled_on=excluded.enrolled_on,birth_date=excluded.birth_date,revision=education_profiles.revision+1,updated_at=now();
 return public.read_education_profile(p_actor,p_actor);
end; $$;

create table public.group_lesson_times(
 group_id text not null references public.study_groups(id) on delete cascade,lesson_number integer not null check(lesson_number between 1 and 12),
 starts_at time not null,ends_at time not null check(ends_at>starts_at),primary key(group_id,lesson_number)
);
create view public.effective_weekly_schedule with(security_invoker=true) as
 select c.id,c.group_id,c.weekday,c.lesson_number,c.status,c.title,c.subject_id,c.teacher_id,c.teacher_label,c.room,c.note,
 case when c.status='lesson' then coalesce(c.starts_at,t.starts_at) end starts_at,case when c.status='lesson' then coalesce(c.ends_at,t.ends_at) end ends_at,
 c.revision,c.updated_by,c.updated_at,c.starts_at custom_starts_at,c.ends_at custom_ends_at from public.weekly_schedule_cells c left join public.group_lesson_times t using(group_id,lesson_number);
create function public.save_group_lesson_times(p_actor text,p_group text,p_revision integer,p_times jsonb) returns void language plpgsql set search_path='' as $$
declare g public.study_groups;entry jsonb;slot integer;s time;e time;prior_end time;
begin
 if not exists(select 1 from public.account_roles where user_id=p_actor and role='admin') then raise exception using errcode='42501',message='Время пар меняет администратор.';end if;
 select * into g from public.study_groups where id=p_group for update;if not found then raise exception using errcode='P0002',message='Группа не найдена.';end if;
 if p_revision is distinct from g.revision then raise exception using errcode='PT409',message='Расписание изменилось. Обновите его.';end if;
 if jsonb_typeof(p_times) is distinct from 'array' or jsonb_array_length(p_times)>12 then raise exception using errcode='22023',message='Проверьте время пар.';end if;
 delete from public.group_lesson_times where group_id=p_group;
 for entry in select value from jsonb_array_elements(p_times) order by (value->>'lessonNumber')::int loop
  slot:=(entry->>'lessonNumber')::int;
  if slot is null or slot not between 1 and g.lessons_per_day or coalesce(entry->>'startsAt','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(entry->>'endsAt','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception using errcode='22023',message='Заполните начало и окончание каждой указанной пары.';end if;
  s:=(entry->>'startsAt')::time;e:=(entry->>'endsAt')::time;
  if e<=s or (prior_end is not null and s<prior_end) then raise exception using errcode='22023',message='Время пар не должно пересекаться.';end if;
  insert into public.group_lesson_times values(p_group,slot,s,e);prior_end:=e;
 end loop;
 update public.study_groups set revision=revision+1 where id=p_group;
 insert into public.notifications(actor_id,recipient_id,category,title,body,destination,context)
 select p_actor,user_id,'schedule','Время пар группы '||g.name||' обновлено','Откройте расписание и проверьте часы начала занятий.','schedule',jsonb_build_object('groupId',p_group)
 from public.notification_subscriptions where scope='group' and group_id=p_group;
end; $$;
-- Existing public readers receive the same projection with the configured clocks.
do $$ declare d text;begin
 d:=pg_get_functiondef('public.guest_read(text,jsonb)'::regprocedure);execute replace(d,'public.weekly_schedule_cells','public.effective_weekly_schedule');
 d:=pg_get_functiondef('public.lite_public_snapshot(text,text,date,integer,text)'::regprocedure);execute replace(d,'public.weekly_schedule_cells','public.effective_weekly_schedule');
end; $$;
create function public.schedule_export_snapshot(p_group text default null,p_week date default null) returns jsonb language plpgsql stable set search_path='' as $$
declare week_start date:=coalesce(p_week,date_trunc('week',now() at time zone 'Asia/Krasnoyarsk')::date);
begin
 if extract(isodow from week_start)<>1 then raise exception using errcode='22023',message='Укажите понедельник недели.';end if;
 if p_group is not null and not exists(select 1 from public.study_groups where id=p_group) then raise exception using errcode='P0002',message='Группа не найдена.';end if;
 return jsonb_build_object('generatedAt',now(),'week',week_start,'groups',coalesce((select jsonb_agg(jsonb_build_object(
 'group',jsonb_build_object('id',g.id,'name',g.name,'course',g.course,'program',g.program,'lessons_per_day',g.lessons_per_day),
 'cells',coalesce((select jsonb_agg(jsonb_build_object('weekday',weekday,'lesson_number',lesson_number,'status',status,'title',title,'teacher_label',teacher_label,'room',room,'note',note,'starts_at',starts_at,'ends_at',ends_at) order by weekday,lesson_number) from public.effective_weekly_schedule where group_id=g.id),'[]'::jsonb),
 'dated',coalesce((select jsonb_agg(jsonb_build_object('lesson_date',lesson_date,'starts_at',starts_at,'ends_at',ends_at,'title',title,'room',room,'note',note) order by lesson_date,starts_at) from public.schedule_entries where group_name=g.name and lesson_date between week_start and week_start+6),'[]'::jsonb)) order by g.name,g.id) from public.study_groups g where p_group is null or g.id=p_group),'[]'::jsonb));
end; $$;

create or replace function public.save_news_post(p_actor text,p_id text,p_revision integer,p_channel text,p_kind text,p_title text,p_body text,p_notify boolean default false,p_important boolean default false) returns jsonb language plpgsql set search_path='' as $$
declare result public.news_posts;actor_role text;
begin
 select role into actor_role from public.account_roles where user_id=p_actor for update;
 if actor_role is null or actor_role not in ('admin','curator') then raise exception using errcode='42501',message='Публикации доступны администраторам и кураторам.';end if;
 if actor_role='curator' and (p_notify or p_important or p_kind<>'news') then raise exception using errcode='42501',message='Системные объявления и журнал обновлений публикует администратор.';end if;
 if p_id is not null and actor_role<>'admin' and not exists(select 1 from public.news_posts where id=p_id and author_id=p_actor and source_key is null) then raise exception using errcode='42501',message='Можно редактировать только свою публикацию.';end if;
 if p_channel is null or p_channel not in ('site','college') or p_kind is null or p_kind not in ('news','announcement','update') or p_title is null or char_length(btrim(p_title)) not between 1 and 200 or p_body is null or char_length(btrim(p_body)) not between 1 and 20000 or (p_notify and char_length(p_body)>2000) then raise exception using errcode='22023',message='Проверьте заголовок и текст. Для уведомления — до 2000 символов.';end if;
 if p_id is null then insert into public.news_posts(channel,kind,title,body,author_id) values(p_channel,p_kind,btrim(p_title),btrim(p_body),p_actor) returning * into result;
 else update public.news_posts set channel=p_channel,kind=p_kind,title=btrim(p_title),body=btrim(p_body),updated_at=now(),revision=revision+1 where id=p_id and revision=p_revision and source_key is null returning * into result;
 if not found then raise exception using errcode='PT409',message='Новость уже изменена. Откройте её заново.';end if;end if;
 if p_notify then insert into public.notifications(actor_id,category,title,body,destination,context,severity) values(p_actor,'announcement',result.title,result.body,'home',jsonb_build_object('newsPostId',result.id),case when p_important then 'danger' else 'info' end);end if;
 return to_jsonb(result);
end; $$;
create or replace function public.delete_news_post(p_actor text,p_id text,p_revision integer) returns void language plpgsql set search_path='' as $$
declare actor_role text;
begin
 select role into actor_role from public.account_roles where user_id=p_actor for update;
 if actor_role is null or actor_role not in ('admin','curator') then raise exception using errcode='42501',message='Удалять новости могут администратор и куратор.';end if;
 if actor_role<>'admin' and not exists(select 1 from public.news_posts where id=p_id and author_id=p_actor and source_key is null) then raise exception using errcode='42501',message='Можно удалить только свою публикацию.';end if;
 delete from public.news_posts where id=p_id and revision=p_revision and source_key is null;if not found then raise exception using errcode='PT409',message='Новость уже изменена или импортирована. Обновите список.';end if;
end; $$;
do $$ declare d text;begin
 d:=pg_get_functiondef('public.news_feed_v2(text,text,text,integer)'::regprocedure);
 execute replace(d,'n.source_key is not null imported,','n.source_key is not null imported, (n.source_key is null and exists(select 1 from public.account_roles ar where ar.user_id=p_user and (ar.role=''admin'' or (ar.role=''curator'' and n.author_id=p_user)))) can_edit,');
end; $$;
update public.news_posts set title='Версия 0.9.0: новости, гостевой доступ, чат кураторов и уведомления',body='Добавлены гостевой просмотр новостей и расписания, фильтры публикаций и лайки. Закрытый чат доступен кураторам-студентам и администрации. Браузерные уведомления включаются отдельно на каждом устройстве.',revision=revision+1 where commit_sha like 'a35e2b5%';
update public.news_posts set title='Проверены кабинеты, права кураторов и доставка уведомлений',body='На рабочем сайте проверены кабинеты, лайки, закрытый чат и настоящая доставка push-уведомлений. Временные проверочные данные удалены.',revision=revision+1 where commit_sha like 'b6b3677%';

alter table public.education_profiles enable row level security;alter table public.group_lesson_times enable row level security;
revoke all on public.education_profiles,public.group_lesson_times,public.effective_weekly_schedule from public,anon,authenticated;
grant select,insert,update,delete on public.education_profiles,public.group_lesson_times to service_role;grant select on public.effective_weekly_schedule to service_role;
revoke all on function public.read_education_profile(text,text),public.save_education_profile(text,integer,text,integer,text,date,date),public.save_group_lesson_times(text,text,integer,jsonb),public.schedule_export_snapshot(text,date) from public,anon,authenticated;
grant execute on function public.read_education_profile(text,text),public.save_education_profile(text,integer,text,integer,text,date,date),public.save_group_lesson_times(text,text,integer,jsonb),public.schedule_export_snapshot(text,date) to service_role;

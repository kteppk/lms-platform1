-- Keep old subscription records for history; only explicit group subscriptions
-- remain visible and receive new notifications. Never broaden an old opt-in.
create or replace function public.list_notification_subscriptions(p_user_id text) returns jsonb language sql set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'scope',s.scope,'group_id',s.group_id,'group_name',g.name,
   'subject_id',s.subject_id,'subject_title',s.subject_title,'created_at',s.created_at) order by g.name,s.id),'[]'::jsonb)
 from public.notification_subscriptions s join public.study_groups g on g.id=s.group_id
 where s.user_id=p_user_id and s.scope='group';
$$;
create or replace function public.add_notification_subscription(p_user_id text,p_scope text,p_group_id text,p_subject_id text,p_subject_title text)
returns jsonb language plpgsql set search_path='' as $$
declare result public.notification_subscriptions;
begin
 if p_scope is null or p_scope<>'group' then raise exception using errcode='22023',message='Доступна подписка только на расписание группы.'; end if;
 if not exists(select 1 from public.profiles where id=p_user_id) then raise exception using errcode='42501',message='Войдите в аккаунт.'; end if;
 if not exists(select 1 from public.study_groups where id=p_group_id) then raise exception using errcode='P0002',message='Группа не найдена.'; end if;
 insert into public.notification_subscriptions(user_id,scope,group_id) values(p_user_id,'group',p_group_id) on conflict do nothing;
 select * into result from public.notification_subscriptions where user_id=p_user_id and scope='group' and group_id=p_group_id;
 return to_jsonb(result);
end; $$;
create or replace function public.publish_schedule_change(p_group_id text,p_weekday integer,p_lesson integer,p_before jsonb,p_after jsonb,p_actor_id text,p_date date default null)
returns void language plpgsql set search_path='' as $$
declare group_name text; event_id text:=gen_random_uuid()::text; message text;
begin
 if p_group_id is null then return; end if;
 select name into group_name from public.study_groups where id=p_group_id;
 if not found then return; end if;
 message:=case when p_date is not null then p_date::text else (array['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'])[p_weekday] end
   ||case when p_lesson is not null then ' · '||p_lesson||' пара' else '' end
   ||case when p_before is not null then E'\nБыло: '||public.schedule_notice_description(p_before) else '' end
   ||E'\nСтало: '||public.schedule_notice_description(p_after);
 insert into public.notifications(actor_id,recipient_id,category,title,body,destination,context,dedupe_key)
 select p_actor_id,recipient.user_id,'schedule','Изменение расписания · группа '||group_name,message,'schedule',
   jsonb_build_object('groupId',p_group_id,'weekday',p_weekday,'lessonNumber',p_lesson),event_id||':'||recipient.user_id
 from (select distinct user_id from public.notification_subscriptions where scope='group' and group_id=p_group_id) recipient;
end; $$;

create or replace function public.news_feed(p_channel text,p_offset integer default 0) returns jsonb language plpgsql set search_path='' as $$
begin
 if p_channel is null or p_channel not in ('all','site','college') or p_offset<0 then raise exception using errcode='22023',message='Выберите категорию новостей.'; end if;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page) order by page.published_at desc,page.id) from (
   select n.id,n.channel,n.kind,n.title,n.body,n.commit_sha,n.published_at,n.revision,n.source_key is not null as imported
   from public.news_posts n where p_channel='all' or n.channel=p_channel order by n.published_at desc,n.id limit 20 offset p_offset) page),'[]'::jsonb),
   'hasMore',(select count(*)>p_offset+20 from public.news_posts where p_channel='all' or channel=p_channel));
end; $$;

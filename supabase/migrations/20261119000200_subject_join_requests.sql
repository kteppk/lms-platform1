-- Existing memberships, materials and results are retained.
create table public.subject_join_requests (
 id text primary key default gen_random_uuid()::text,
 subject_id text not null references public.subjects(id),
 teacher_id text not null references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(),
 decided_at timestamptz,
 decided_by text references public.profiles(id)
);
create unique index subject_join_requests_pending on public.subject_join_requests(subject_id,teacher_id) where status='pending';
create index subject_join_requests_teacher on public.subject_join_requests(teacher_id,created_at desc);
alter table public.subject_join_requests enable row level security;
revoke all on public.subject_join_requests from public,anon,authenticated;
grant select,insert,update on public.subject_join_requests to service_role;

create function public.request_subject_join(p_teacher text,p_subject text) returns jsonb language plpgsql set search_path='' as $$
declare req public.subject_join_requests; subject_title text;
begin
 if not exists(select 1 from public.teachers t join public.account_roles r on r.user_id=t.user_id where t.user_id=p_teacher and r.role in ('teacher','admin')) then
  raise exception using errcode='42501',message='Заявку может подать только преподаватель.';
 end if;
 select s.title into subject_title from public.subjects s where s.id=p_subject and s.archived_at is null for share;
 if not found then raise exception using errcode='P0002',message='Предмет недоступен.';end if;
 if exists(select 1 from public.subject_teachers where subject_id=p_subject and teacher_id=p_teacher) then return jsonb_build_object('status','approved');end if;
 insert into public.subject_join_requests(subject_id,teacher_id) values(p_subject,p_teacher)
 on conflict(subject_id,teacher_id) where status='pending' do nothing returning * into req;
 if req.id is null then select * into req from public.subject_join_requests where subject_id=p_subject and teacher_id=p_teacher and status='pending';
 else
  insert into public.notifications(recipient_id,actor_id,category,title,body,destination,dedupe_key)
  select r.user_id,p_teacher,'personal','Заявка на присоединение к предмету',p.name||' — '||subject_title,'accounts','subject-request:'||req.id||':'||r.user_id
  from public.account_roles r cross join public.profiles p where r.role='admin' and p.id=p_teacher;
 end if;
 return jsonb_build_object('id',req.id,'status',req.status);
end; $$;

create function public.list_subject_join_requests(p_actor text) returns jsonb language plpgsql set search_path='' as $$
declare is_admin boolean;
begin
 select coalesce((select role='admin' from public.account_roles where user_id=p_actor),false) into is_admin;
 if not is_admin and not exists(select 1 from public.teachers t join public.account_roles r on r.user_id=t.user_id where t.user_id=p_actor and r.role in ('teacher','admin')) then
  raise exception using errcode='42501',message='Заявки доступны преподавателям и администрации.';
 end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (
  select q.id,q.subject_id,q.teacher_id,q.status,q.created_at,q.decided_at,s.title as subject_title,p.name as teacher_name,s.archived_at is not null as archived
  from public.subject_join_requests q join public.subjects s on s.id=q.subject_id join public.profiles p on p.id=q.teacher_id
  where (is_admin and q.status='pending') or (not is_admin and q.teacher_id=p_actor)
  order by q.created_at desc,q.id limit 200
 ) x),'[]'::jsonb);
end; $$;

create function public.review_subject_join_request(p_admin text,p_request text,p_approve boolean) returns jsonb language plpgsql set search_path='' as $$
declare req public.subject_join_requests; subject_title text;
begin
 perform 1 from public.account_roles where user_id=p_admin and role='admin' for share;
 if not found then raise exception using errcode='42501',message='Заявки одобряет только администратор.';end if;
 if p_approve is null then raise exception using errcode='22023',message='Выберите решение.';end if;
 select * into req from public.subject_join_requests where id=p_request for update;
 if not found then raise exception using errcode='P0002',message='Заявка не найдена.';end if;
 if req.status<>'pending' then
  if req.status=(case when p_approve then 'approved' else 'rejected' end) then return jsonb_build_object('id',req.id,'status',req.status);end if;
  raise exception using errcode='PT409',message='Заявка уже рассмотрена. Обновите список.';
 end if;
 select title into subject_title from public.subjects where id=req.subject_id and archived_at is null for share;
 if p_approve then
  if not found then raise exception using errcode='P0002',message='Предмет уже удалён. Заявку можно отклонить.';end if;
  perform 1 from public.account_roles r join public.teachers t on t.user_id=r.user_id where r.user_id=req.teacher_id and r.role in ('teacher','admin') for share of r,t;
  if not found then raise exception using errcode='42501',message='Пользователь больше не является преподавателем. Заявку можно отклонить.';end if;
  insert into public.subject_teachers(subject_id,teacher_id) values(req.subject_id,req.teacher_id) on conflict do nothing;
 end if;
 update public.subject_join_requests set status=case when p_approve then 'approved' else 'rejected' end,decided_at=now(),decided_by=p_admin where id=req.id returning * into req;
 insert into public.notifications(recipient_id,actor_id,category,title,body,destination,severity,dedupe_key)
 values(req.teacher_id,p_admin,'personal',case when p_approve then 'Заявка на предмет одобрена' else 'Заявка на предмет отклонена' end,
  coalesce(subject_title,'Предмет из вашей заявки'), 'subjects',case when p_approve then 'success' else 'info' end,'subject-decision:'||req.id);
 return jsonb_build_object('id',req.id,'status',req.status);
end; $$;
revoke all on function public.request_subject_join(text,text),public.list_subject_join_requests(text),public.review_subject_join_request(text,text,boolean) from public,anon,authenticated;
grant execute on function public.request_subject_join(text,text),public.list_subject_join_requests(text),public.review_subject_join_request(text,text,boolean) to service_role;

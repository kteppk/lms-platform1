-- College bell intervals supplied by the project owner on 18 November 2026.
-- Each pair contains 45 minutes + a 5-minute break + 45 minutes.
insert into public.group_lesson_times(group_id,lesson_number,starts_at,ends_at)
select g.id,t.slot,t.start_time::time,t.end_time::time from public.study_groups g cross join
 (values(1,'08:00','09:35'),(2,'09:45','11:20'),(3,'11:50','13:25'),(4,'13:35','15:10'),(5,'15:20','16:55'),(6,'17:05','18:40')) t(slot,start_time,end_time)
where t.slot<=g.lessons_per_day on conflict do nothing;
update public.study_groups set revision=revision+1 where exists(select 1 from public.group_lesson_times t where t.group_id=study_groups.id);

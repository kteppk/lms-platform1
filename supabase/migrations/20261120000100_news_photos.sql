alter table public.news_posts add column hidden_at timestamptz;

create table public.news_post_photos (
  id uuid primary key default gen_random_uuid(),
  post_id text not null references public.news_posts(id) on delete cascade,
  position smallint not null check (position between 1 and 4),
  content bytea not null check (octet_length(content) between 4 and 143360)
);
create index news_post_photos_post on public.news_post_photos(post_id, position);
alter table public.news_post_photos enable row level security;
revoke all on public.news_post_photos from public, anon, authenticated;
grant select, insert, update, delete on public.news_post_photos to service_role;

create or replace function public.save_news_post(p_actor text,p_id text,p_revision integer,p_channel text,p_kind text,p_title text,p_body text,p_notify boolean default false,p_important boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare result public.news_posts; actor_role text;
begin
  select role into actor_role from public.account_roles where user_id=p_actor for update;
  if actor_role is null or actor_role not in ('admin','curator') then raise exception using errcode='42501',message='Публикации доступны администраторам и кураторам.'; end if;
  if actor_role='curator' and (p_notify or p_important or p_kind<>'news') then raise exception using errcode='42501',message='Системные объявления и журнал обновлений публикует администратор.'; end if;
  if p_id is not null and actor_role<>'admin' and not exists(select 1 from public.news_posts where id=p_id and author_id=p_actor and source_key is null and hidden_at is null) then raise exception using errcode='42501',message='Можно редактировать только свою публикацию.'; end if;
  if p_channel is null or p_channel not in ('site','college') or p_kind is null or p_kind not in ('news','announcement','update') or p_title is null or char_length(btrim(p_title)) not between 1 and 200 or p_body is null or char_length(btrim(p_body)) not between 1 and 20000 or (p_notify and char_length(p_body)>2000) then raise exception using errcode='22023',message='Проверьте заголовок и текст. Для уведомления — до 2000 символов.'; end if;
  if p_id is null then
    insert into public.news_posts(channel,kind,title,body,author_id) values(p_channel,p_kind,btrim(p_title),btrim(p_body),p_actor) returning * into result;
  else
    update public.news_posts set channel=p_channel,kind=p_kind,title=btrim(p_title),body=btrim(p_body),updated_at=now(),revision=revision+1
    where id=p_id and revision=p_revision and hidden_at is null returning * into result;
    if not found then raise exception using errcode='PT409',message='Новость уже изменена. Откройте её заново.'; end if;
  end if;
  if p_notify then insert into public.notifications(actor_id,category,title,body,destination,context,severity) values(p_actor,'announcement',result.title,result.body,'home',jsonb_build_object('newsPostId',result.id),case when p_important then 'danger' else 'info' end); end if;
  return to_jsonb(result);
end; $$;

create function public.save_news_post_with_photos(p_actor text,p_id text,p_revision integer,p_channel text,p_kind text,p_title text,p_body text,p_notify boolean,p_important boolean,p_photos jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; post text; photo jsonb; photo_id uuid; seen uuid[] := '{}'; image_data bytea; slot smallint := 0;
begin
  if jsonb_typeof(p_photos) is distinct from 'array' or jsonb_array_length(p_photos)>4 then raise exception using errcode='22023',message='Можно прикрепить до четырёх фотографий.'; end if;
  result:=public.save_news_post(p_actor,p_id,p_revision,p_channel,p_kind,p_title,p_body,p_notify,p_important);
  post:=result->>'id';
  for photo in select value from jsonb_array_elements(p_photos) loop
    slot:=slot+1;
    if jsonb_typeof(photo->'id')='string' and not(photo ? 'data') then
      if photo->>'id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise exception using errcode='22023',message='Некорректная фотография.'; end if;
      photo_id:=(photo->>'id')::uuid;
      if photo_id=any(seen) then raise exception using errcode='22023',message='Фотография указана дважды.'; end if;
      update public.news_post_photos set position=slot where id=photo_id and post_id=post;
      if not found then raise exception using errcode='22023',message='Фотография не относится к этой новости.'; end if;
    elsif jsonb_typeof(photo->'data')='string' and not(photo ? 'id') and length(photo->>'data')<=191148 then
      begin image_data:=decode(photo->>'data','base64'); exception when data_exception then raise exception using errcode='22023',message='Не удалось прочитать фотографию.'; end;
      if octet_length(image_data) not between 4 and 143360 or substring(image_data from 1 for 2)<>decode('ffd8','hex') or substring(image_data from octet_length(image_data)-1)<>decode('ffd9','hex') then
        raise exception using errcode='22023',message='Некорректная фотография JPEG.';
      end if;
      insert into public.news_post_photos(post_id,position,content) values(post,slot,image_data) returning id into photo_id;
    else raise exception using errcode='22023',message='Некорректная фотография.';
    end if;
    seen:=array_append(seen,photo_id);
  end loop;
  delete from public.news_post_photos where post_id=post and not(id=any(seen));
  return result;
end; $$;

create or replace function public.delete_news_post(p_actor text,p_id text,p_revision integer) returns void language plpgsql set search_path='' as $$
declare actor_role text; post public.news_posts;
begin
  select role into actor_role from public.account_roles where user_id=p_actor for update;
  if actor_role is null or actor_role not in ('admin','curator') then raise exception using errcode='42501',message='Удалять новости могут администратор и куратор.'; end if;
  select * into post from public.news_posts where id=p_id and hidden_at is null for update;
  if actor_role<>'admin' and (post.author_id is distinct from p_actor or post.source_key is not null) then raise exception using errcode='42501',message='Можно удалить только свою публикацию.'; end if;
  if post.id is null or post.revision is distinct from p_revision then raise exception using errcode='PT409',message='Новость уже изменена. Обновите список.'; end if;
  if post.source_key is null then
    delete from public.news_posts where id=p_id;
  else
    -- Keep the unique import key so synchronization cannot restore the item.
    update public.news_posts set hidden_at=now(),revision=revision+1 where id=p_id;
    delete from public.news_post_photos where post_id=p_id;
  end if;
end; $$;

do $$ declare definition text;
begin
  definition:=pg_get_functiondef('public.news_feed_v2(text,text,text,integer)'::regprocedure);
  definition:=replace(definition, 'n.source_key is null and exists', 'exists');
  definition:=replace(definition, '(ar.role=''curator'' and n.author_id=p_user)', '(ar.role=''curator'' and n.author_id=p_user and n.source_key is null)');
  definition:=replace(definition, 'can_edit,', 'can_edit, coalesce((select jsonb_agg(p.id order by p.position) from public.news_post_photos p where p.post_id=n.id),''[]''::jsonb) photos,');
  execute replace(definition, 'n.published_at<=now()', 'n.hidden_at is null and n.published_at<=now()');
  definition:=pg_get_functiondef('public.news_feed(text,integer)'::regprocedure);
  definition:=replace(definition, 'from public.news_posts n where p_channel=''all'' or n.channel=p_channel', 'from public.news_posts n where n.hidden_at is null and (p_channel=''all'' or n.channel=p_channel)');
  execute replace(definition, 'from public.news_posts where p_channel=''all'' or channel=p_channel', 'from public.news_posts where hidden_at is null and (p_channel=''all'' or channel=p_channel)');
  definition:=pg_get_functiondef('public.lite_public_snapshot(text,text,date,integer,text)'::regprocedure);
  execute replace(definition, 'published_at<=now()', 'hidden_at is null and published_at<=now()');
  definition:=pg_get_functiondef('public.set_news_like(text,text,boolean)'::regprocedure);
  execute replace(definition, 'published_at<=now()', 'hidden_at is null and published_at<=now()');
end; $$;

revoke all on function public.save_news_post_with_photos(text,text,integer,text,text,text,text,boolean,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.save_news_post_with_photos(text,text,integer,text,text,text,text,boolean,boolean,jsonb) to service_role;

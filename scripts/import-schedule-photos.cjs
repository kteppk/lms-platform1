// Append-only, repeatable import. Does not deploy application code or migrations.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const source=require('./schedule-photos-20261117.source.cjs');
const weekdays=['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
const canonical=name=>name.normalize('NFKC').toLocaleLowerCase('ru').replace(/^h(?=\s*9)/,'н').replace(/[\s‐‑‒–—−-]/gu,'');
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
// This matches canonical() for group names (including Latin H / Cyrillic Н).
const sqlKey=value=>`replace(regexp_replace(lower(${value}),'[[:space:]‐‑‒–—−-]','','g'),'h','н')`;
function compile(){
 const seen=new Set(),issues=[];
 const groups=source.groups.map(group=>{
  const key=canonical(group.name);assert.ok(!seen.has(key),'Repeated group '+group.name);seen.add(key);
  assert.equal(group.days.length,6);assert.ok(group.program.length<=200);
  if(group.courseQuestion)issues.push({group:group.name,field:'Курс',question:group.courseQuestion,photos:group.photos});
  const cells=[];
  group.days.forEach((day,d)=>{assert.equal(day.length,6);day.forEach((cell,i)=>{
   const context={group:group.name,weekday:d+1,lesson:i+1,photos:group.photos};
   if(cell?.unknown){issues.push({...context,field:'Вся ячейка',question:cell.unknown});cells.push({weekday:d+1,lesson:i+1,unknown:cell.unknown});return;}
   let payload={status:'free'};
   if(cell){
    assert.ok(cell.title.length>0&&cell.title.length<=200);
    const teacher=cell.teacher?source.teachers[cell.teacher]:null;
    assert.ok(!cell.teacher||teacher,'Unknown teacher key '+cell.teacher);
    const notes=[cell.note];
    if(teacher&&typeof teacher==='object'){
     issues.push({...context,field:'Преподаватель',question:teacher.question,guess:teacher.guess,key:cell.teacher,title:cell.title});
     notes.push('Фамилия преподавателя на фото требует уточнения.');
    }
    if(cell.note&&cell.note.startsWith('Уточнить'))issues.push({...context,field:'Поле занятия',question:cell.note,title:cell.title});
    payload={status:'lesson',title:cell.title,teacherLabel:typeof teacher==='string'?teacher:'',room:cell.room,note:notes.filter(Boolean).join(' ')};
    assert.ok(payload.note.length<=1000);
   }
   cells.push({weekday:d+1,lesson:i+1,payload});
  });});
  return {key,name:group.name,course:group.course,program:group.program,lessonsPerDay:6,photos:group.photos,cells};
 });
 assert.equal(groups.length,18);
 const stats={groups:groups.length,lessons:0,free:0,unknown:0};
 for(const g of groups)for(const c of g.cells)stats[c.unknown?'unknown':c.payload.status==='lesson'?'lessons':'free']++;
 assert.equal(stats.lessons+stats.free+stats.unknown,648);
 return {source:'Фотографии расписания, полученные 17.11.2026',recurrence:'weekly',duplicatePhotos:[[1,2]],stats,groups,issues};
}
function artifacts(data){
 const dir=path.join(__dirname,'../docs/schedule-import-2026-11-17');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'schedule.json'),JSON.stringify(data,null,2)+'\n');
 const csvField=v=>'"'+String(v??'').replaceAll('"','""')+'"';
 const csv=[['Группа','День','Пара','Состояние','Предмет','Преподаватель','Аудитория','Примечание','Фото']];
 for(const g of data.groups)for(const c of g.cells){const p=c.payload||{};csv.push([g.name,weekdays[c.weekday-1],c.lesson,c.unknown?'Не прочитано':p.status==='lesson'?'Занятие':'Нет пары',p.title,p.teacherLabel,p.room,c.unknown||p.note,g.photos.join(', ')]);}
 fs.writeFileSync(path.join(dir,'schedule.csv'),'\ufeff'+csv.map(r=>r.map(csvField).join(';')).join('\r\n')+'\r\n');
 const lines=['# Перенос расписания с фотографий · 17.11.2026','','Расписание повторяется каждую неделю. Фото 1 и 2 — один лист, импортируется один раз. Время звонков на фотографиях отсутствует и не добавлялось.','','Сомнительные фамилии не подставлены: поле преподавателя оставлено пустым, у занятия есть примечание. Нечитаемые целиком ячейки не импортируются и не отмечаются как «нет пары».','','## Группы','','| Группа | Курс с листа | Фото | Занятий | Нет пары | Не прочитано |','|---|---|---|---:|---:|---:|'];
 for(const g of data.groups)lines.push(`| ${g.name} | ${g.course||'Не указан'} | ${g.photos.join(', ')} | ${g.cells.filter(c=>c.payload?.status==='lesson').length} | ${g.cells.filter(c=>c.payload?.status==='free').length} | ${g.cells.filter(c=>c.unknown).length} |`);
 lines.push('',`Всего: **${data.stats.groups} групп, ${data.stats.lessons} занятий, ${data.stats.free} видимых пустых ячеек, ${data.stats.unknown} непрочитанных ячеек**. Последние не записываются в базу. Администратор сможет заполнить их в таблице. Начало/окончание пар не выдумывались.`,'','## Требуют уточнения: фамилии','','Предположения ниже предназначены только для сверки; в расписание они не внесены. Одного уточнения фамилии достаточно для всех перечисленных занятий.');
 for(const [key,t] of Object.entries(source.teachers).filter(([,t])=>typeof t==='object')){
  const matches=data.issues.filter(i=>i.key===key);if(!matches.length)continue;
  lines.push('',`### ${t.guess}`,t.question,'');
  for(const group of [...new Set(matches.map(i=>i.group))]){
   const locations=matches.filter(i=>i.group===group).map(i=>`${weekdays[i.weekday-1]}, ${i.lesson} пара (${i.title})`);
   lines.push(`- **${group}:** ${locations.join('; ')}.`);
  }
 }
 lines.push('','## Требуют уточнения: отдельные поля и ячейки','','| Группа | День | Пара | Фото | Что уточнить |','|---|---|---|---|---|');
 for(const i of data.issues.filter(i=>!i.key&&i.weekday))lines.push(`| ${i.group} | ${weekdays[i.weekday-1]} | ${i.lesson} | ${i.photos.join(', ')} | ${i.question} |`);
 lines.push('','## Требуют подтверждения: курсы','');
 for(const i of data.issues.filter(i=>i.field==='Курс'))lines.push('- '+i.question);
 lines.push('','## Полная расшифровка','','[Таблица CSV для Excel](schedule.csv) · [Данные импорта JSON](schedule.json)','','Импорт добавляет отсутствующие группы и ячейки; существующие записи не перезаписываются. Перед записью проверяется роль действующего администратора. Проверки сохранности прежних строк выполняются внутри одной транзакции.','');
 fs.writeFileSync(path.join(dir,'README.md'),lines.join('\n'));
 return dir;
}
function importSQL(data,actor){
 assert.match(actor,/^[A-Za-z0-9_-]{1,128}$/);
 return `begin;
 set local lock_timeout='10s';
 lock table public.study_groups,public.weekly_schedule_cells in share row exclusive mode;
 create temp table import_old_groups on commit drop as select * from public.study_groups;
 create temp table import_old_cells on commit drop as select * from public.weekly_schedule_cells;
 create temp table import_protected(table_name text primary key,fingerprint text) on commit drop;
 create temp table import_receipt(group_id text primary key,name text,created boolean,inserted integer,matched integer,conflicts integer,unknown integer) on commit drop;
 do $import$
 declare actor_id text:=${q(actor)}; input jsonb:=${q(JSON.stringify(data.groups))}::jsonb;
 g jsonb; c jsonb; gid text; n integer; inserted_n integer; matched_n integer; conflict_n integer; unknown_n integer; made boolean; p jsonb; existing public.weekly_schedule_cells; t record; fingerprint text;
 begin
  if not exists(select 1 from public.account_roles where user_id=actor_id and role='admin') then raise exception 'Existing administrator required';end if;
  -- Fingerprints stay inside the DB session: no account or assessment data is exported.
  for t in select tablename from pg_tables where schemaname='public' and tablename not in ('study_groups','weekly_schedule_cells') loop
   execute format('select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,''[]'')) from public.%I x',t.tablename) into fingerprint;
   insert into import_protected values(t.tablename,fingerprint);
  end loop;
  for g in select value from jsonb_array_elements(input) loop
   select count(*),min(s.id) into n,gid from public.study_groups s where ${sqlKey('s.name')}=g->>'key';
   if n>1 then raise exception 'Duplicate canonical group: %',g->>'name';end if;
   made:=n=0;
   if made then
    gid:=public.create_schedule_group(actor_id,g->>'name',g->>'course',g->>'program',6)->>'id';
   elsif (select lessons_per_day<6 from public.study_groups where id=gid) then raise exception 'Existing group has fewer than six slots: %',g->>'name';end if;
   inserted_n:=0;matched_n:=0;conflict_n:=0;unknown_n:=0;
   for c in select value from jsonb_array_elements(g->'cells') loop
    if c ? 'unknown' then unknown_n:=unknown_n+1;continue;end if;
    p:=c->'payload';
    select * into existing from public.weekly_schedule_cells where group_id=gid and weekday=(c->>'weekday')::int and lesson_number=(c->>'lesson')::int;
    if found then
     if (existing.status,existing.title,existing.teacher_label,existing.room,existing.note) is not distinct from
       (p->>'status',coalesce(p->>'title',''),coalesce(p->>'teacherLabel',''),coalesce(p->>'room',''),coalesce(p->>'note','')) then matched_n:=matched_n+1;
     else conflict_n:=conflict_n+1;end if;
     continue;
    end if;
    perform public.save_schedule_cell(actor_id,gid,(c->>'weekday')::int,(c->>'lesson')::int,null,0,p);
    inserted_n:=inserted_n+1;
   end loop;
   insert into import_receipt values(gid,g->>'name',made,inserted_n,matched_n,conflict_n,unknown_n);
  end loop;
  if exists(select 1 from import_old_groups old left join public.study_groups s using(id) where to_jsonb(old) is distinct from to_jsonb(s)) then raise exception 'Existing group changed';end if;
  if exists(select 1 from import_old_cells old left join public.weekly_schedule_cells s using(id) where to_jsonb(old) is distinct from to_jsonb(s)) then raise exception 'Existing cell changed';end if;
  for t in select * from import_protected loop
   execute format('select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,''[]'')) from public.%I x',t.table_name) into fingerprint;
   if fingerprint is distinct from t.fingerprint then raise exception 'Unexpected change outside schedule: %',t.table_name;end if;
  end loop;
 end; $import$;
 select jsonb_build_object('groups',count(*),'createdGroups',count(*) filter(where created),'insertedCells',sum(inserted),'matchedCells',sum(matched),'preservedConflicts',sum(conflicts),'unreadCells',sum(unknown),'existingGroupsUnchanged',true,'existingCellsUnchanged',true,'otherPublicTablesUnchanged',true,'details',jsonb_agg(to_jsonb(r) order by name)) as receipt from import_receipt r;
 commit;`;
}
function query(cli,sql,write=false){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lms-schedule-query-'));const file=path.join(dir,'query.sql');
 try{fs.writeFileSync(file,sql);const out=execFileSync(cli,['db','query','--file',file,'--remote=qqhkuuktgzcyrkfdnjjq',...(write?['--yes']:['--read-only']),'--output','json'],{encoding:'utf8',timeout:90000,windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024});return JSON.parse(out.slice(out.indexOf('{'),out.lastIndexOf('}')+1)).rows;}
 finally{fs.unlinkSync(file);fs.rmdirSync(dir);}
}
function remotePlan(cli,data){
 const names=data.groups.map(g=>g.key);
 return query(cli,`select s.id,s.name,s.course,s.program,s.lessons_per_day,(select count(*) from public.weekly_schedule_cells c where c.group_id=s.id) as cells from public.study_groups s where ${sqlKey('s.name')} in (${names.map(q).join(',')}) order by name;`);
}
module.exports={compile,importSQL,canonical,artifacts,query,remotePlan};
if(require.main===module){
 const [mode='--build',cli,actor]=process.argv.slice(2);const data=compile();const dir=artifacts(data);
 assert.ok(['--build','--plan','--apply'].includes(mode));
 console.log(JSON.stringify(data.stats));
 if(mode!=='--build'){
  assert.ok(cli,'CLI executable required');const existing=remotePlan(cli,data);
  console.log(JSON.stringify({matchingExistingGroups:existing}));
  if(mode==='--apply'){
   const receipt=query(cli,importSQL(data,actor),true);fs.writeFileSync(path.join(dir,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
  }
 }
}

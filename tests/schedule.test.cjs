const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
let db,group,other;
async function rpc(name,args){return (await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args.map(a=>a!==null&&typeof a==='object'?JSON.stringify(a):a))).rows[0].value;}
const save=(actor,day,number,cell,previous=null,g=group)=>rpc('save_schedule_cell',[actor,g.id,day,number,previous?.id??null,previous?.revision??0,cell]);
before(async()=>{
  db=new PGlite();
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
  const files=fs.readdirSync('supabase/migrations').sort();
  for(const file of files.filter(f=>f<'20261112000100'))await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  await db.exec("insert into profiles(id,name,email) values('admin','Анна Иванова Петровна','admin@test'),('teacher','Иван Иванов Иванович','teacher@test'),('student','Пётр Петров Петрович','student@test');insert into teachers values('teacher');update account_roles set role='admin' where user_id='admin';insert into schedule_entries(id,lesson_date,starts_at,ends_at,title,group_name,created_by) values('legacy','2026-11-12','09:00','10:30','Прежнее занятие','Старая группа','admin');");
  for(const file of files.filter(f=>f>='20261112000100'))await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  await db.exec('set role service_role');
  group=await rpc('create_schedule_group',['admin','9241','4','Информационные системы и программирование',6]);
  other=await rpc('create_schedule_group',['admin','92410','','',6]);
  await rpc('add_notification_subscription',['student','group',group.id,null,null]);
  await rpc('add_notification_subscription',['student','group',other.id,null,null]);
});
after(async()=>await db?.close());
test('migration retains dated lessons and groups; database access is service-only',async()=>{
  assert.equal((await db.query("select title from schedule_entries where id='legacy'")).rows[0].title,'Прежнее занятие');
  assert.equal((await db.query("select name from study_groups where name='Старая группа'")).rows.length,1);
  const p=(await db.query("select has_table_privilege('anon','weekly_schedule_cells','select') cells,has_table_privilege('authenticated','study_groups','insert') groups,has_function_privilege('anon','save_schedule_cell(text,text,integer,integer,text,integer,jsonb)','execute') rpc")).rows[0];
  assert.deepEqual(p,{cells:false,groups:false,rpc:false});
});
test('only admin can create groups or edit cells; normalized duplicate groups are rejected',async()=>{
  for(const actor of ['student','teacher']){
    await assert.rejects(rpc('create_schedule_group',[actor,'New','','',6]),{code:'42501'});
    await assert.rejects(save(actor,1,1,{status:'free'}),{code:'42501'});
  }
  await assert.rejects(rpc('create_schedule_group',['admin',' 9241 ','','',6]),{code:'22023'});
});
test('cells repeat by weekday; distinct groups never collide; free differs from unfilled',async()=>{
  assert.equal((await db.query('select * from weekly_schedule_cells where group_id=$1',[group.id])).rows.length,0);
  const lesson=await save('admin',1,4,{status:'lesson',title:'БЖД',teacherLabel:'Донгак А-К.А.',room:'13'});
  const free=await save('admin',1,1,{status:'free'});
  await save('admin',1,4,{status:'lesson',title:'Другой предмет'},null,other);
  assert.equal(lesson.starts_at,null,'no invented bell times');assert.equal(free.status,'free');
  const rows=(await db.query('select title from weekly_schedule_cells where group_id=$1 order by lesson_number',[group.id])).rows;
  assert.deepEqual(rows.map(c=>c.title),['','БЖД']);
  assert.equal((await db.query('select count(*)::int n from notifications where actor_id=$1 and destination=$2',['admin','schedule'])).rows[0].n,4);
  await save('admin',1,1,{status:'free'},free);
  assert.equal((await db.query('select count(*)::int n from notifications where actor_id=$1 and destination=$2',['admin','schedule'])).rows[0].n,4,'no-op does not spam notifications');
});
test('stale and concurrent edits cannot replace another admin change; No pair clears former fields',async()=>{
  const original=await save('admin',2,3,{status:'lesson',title:'Лекция',teacherId:'teacher',room:'20',startsAt:'09:00',endsAt:'10:30'});
  assert.equal(original.teacher_label,'Иван Иванов Иванович');
  const edit=await save('admin',2,3,{status:'lesson',title:'Практика'},original);
  await assert.rejects(save('admin',2,3,{status:'free'},original),{code:'PT409'});
  await assert.rejects(save('admin',2,3,{status:'free'}),{code:'PT409'});
  const cleared=await save('admin',2,3,{status:'free',title:'Ignored',teacherId:'teacher'},edit);
  assert.equal(cleared.title,'');assert.equal(cleared.teacher_id,null);assert.equal(cleared.starts_at,null);assert.equal(cleared.room,'');
  const settled=await Promise.allSettled([save('admin',3,1,{status:'lesson',title:'Первый'}),save('admin',3,1,{status:'lesson',title:'Второй'})]);
  assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);assert.equal(settled.find(r=>r.status==='rejected').reason.code,'PT409');
});
test('invalid slots, times, retired instructors and unavailable subjects are rejected',async()=>{
  for(const [day,num,cell] of [[0,1,{status:'free'}],[1,7,{status:'free'}],[1,2,{status:'lesson',title:''}],[1,2,{status:'lesson',title:'X',startsAt:'10:00'}],[1,2,{status:'lesson',title:'X',startsAt:'11:00',endsAt:'10:00'}],[1,2,{status:'lesson',title:'X',teacherId:'student'}],[1,2,{status:'lesson',title:'X',subjectId:'missing'}]])await assert.rejects(save('admin',day,num,cell),{code:'22023'});
});
test('photo import preserves existing admin edits and can be repeated without overwriting cells',async()=>{
  let sql;
  require('node:vm').runInNewContext(fs.readFileSync('scripts/import-weekly-schedule.cjs','utf8'),{
    require:name=>name==='node:child_process'?{execFileSync:(_cli,args)=>{sql=args[2];return '';}}:require(name),
    process:{argv:['node','import','supabase','admin','--apply']},console:{log(){}}
  });
  assert.ok(sql.startsWith('begin;'));
  await db.exec(sql);
  assert.equal((await db.query('select title from weekly_schedule_cells where group_id=$1 and weekday=1 and lesson_number=4',[group.id])).rows[0].title,'БЖД');
  const snapshot=async()=>(await db.query("select md5(string_agg(row_to_json(c)::text,',' order by id)) h from weekly_schedule_cells c")).rows[0].h;
  const before=await snapshot();await db.exec(sql);assert.equal(await snapshot(),before);
  assert.equal((await db.query("select count(*)::int n from weekly_schedule_cells where group_id=(select id from study_groups where name='9251')")).rows[0].n,30);
});

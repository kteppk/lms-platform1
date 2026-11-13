const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
let db,names,group,otherGroup;
async function rpc(name,args){return(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args.map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v))).rows[0].value;}
const subscribe=(uid,scope='group',g=group,title=null,subjectId=null)=>rpc('add_notification_subscription',[uid,scope,scope==='mine'?null:g.id,subjectId,title]);
const feed=async uid=>(await rpc('notification_feed',[uid,0])).rows;
const notices=async uid=>(await feed(uid)).filter(n=>n.category==='schedule');
const save=(day,n,cell,old=null,g=group)=>rpc('save_schedule_cell',['admin',g.id,day,n,old?.id??null,old?.revision??0,cell]);
before(async()=>{
  names=await import(pathToFileURL(path.resolve('supabase/functions/_shared/name-rules.mjs')));
  db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
  const files=fs.readdirSync('supabase/migrations').sort();
  for(const f of files.filter(f=>f<'20261113000200'))await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
  await db.exec("insert into profiles(id,name,email) values('admin','Админ Первый Иванович','admin@test'),('t','Учитель Первый Иванович','t@test'),('other','Учитель Второй Иванович','other@test'),('s','  Старое неоднозначное ФИО  ','s@test'),('math','Математика Студент Иванович','math@test'),('physics','Физика Студент Иванович','p@test'),('outside','Без Подписки Иванович','out@test');insert into teachers values('t'),('other');update account_roles set role='admin' where user_id='admin';insert into notifications(id,title,destination) values('old-global','Старая общая рассылка','subjects'),('announcement','Старое объявление','notifications');");
  for(const f of files.filter(f=>f>='20261113000200'))await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
  await db.exec('set role service_role');
  group=await rpc('create_schedule_group',['admin','9241','4','',6]);otherGroup=await rpc('create_schedule_group',['admin','92410','','',6]);
});
after(async()=>await db?.close());
test('Unicode name rules preserve original spelling, accept compound names and optional patronymics',()=>{
  for(const value of ['Анна-Мария',"О'Коннор",'О’Коннор','Салчак-оол','Салчак — оол','де ла Крус','Йван','йван','Ёлкин','Öztürk','李','محمد','क्‍ष','  Анна   Мария  ','Jose\u0301'])assert.equal(names.validatePart(value,'Имя'),value,value);
  for(const value of ['123','Иван7','Иван😀','Иван\nПетров','Иван\tПетров','Иван\u202e','Анна--Мария','-Иван',"О''Коннор",'\u200dИван',''])assert.throws(()=>names.validatePart(value,'Имя'),undefined,value);
  const raw={firstNameRaw:'  Анна—Мария ',lastNameRaw:'О’Коннор де ла Крус',patronymicRaw:''};
  const fields=names.validateFields(raw);assert.equal(fields.firstNameRaw,raw.firstNameRaw);assert.equal(fields.patronymicRaw,null);assert.equal(fields.patronymicStatus,'unknown');
  assert.equal(names.fullName(fields),"О'Коннор де ла Крус Анна-Мария");assert.equal(names.displayPart('йван'),'йван');assert.equal(names.displayPart('Ёлкин'),'Ёлкин');
  assert.equal(names.validateFields({...raw,patronymicStatus:'absent'}).patronymicStatus,'absent');
  assert.throws(()=>names.validateFields({...raw,patronymicRaw:'Петровна',patronymicStatus:'absent'}));
});
test('migration preserves legacy name; structured save is revision-safe and stores raw parts exactly',async()=>{
  const old=(await db.query("select * from profiles where id='s'")).rows[0];assert.equal(old.name,'  Старое неоднозначное ФИО  ');assert.equal(old.first_name_raw,null);assert.equal(old.name_confirmed_at,null);
  const fields=names.validateFields({firstNameRaw:'  Анна—Мария ',lastNameRaw:'Салчак-оол',patronymicRaw:'',patronymicStatus:'unknown'});
  const saved=await rpc('save_profile_name',['s',0,fields.firstNameRaw,fields.lastNameRaw,null,'unknown',names.fullName(fields)]);
  assert.equal(saved.name,'Салчак-оол Анна-Мария');assert.equal(saved.first_name_raw,'  Анна—Мария ');assert.equal(saved.name_revision,1);assert.ok(saved.name_confirmed_at);
  await assert.rejects(rpc('save_profile_name',['s',0,'Другое','Имя',null,'absent','Имя Другое']),{code:'PT409'});
  assert.equal((await db.query("select count(*)::int n from notifications where dedupe_key='name:s'")).rows[0].n,0);
});
test('legacy public spam is hidden, explicit announcements stay visible, welcomes and role changes stay private',async()=>{
  for(const uid of ['s','t','outside']){const rows=await feed(uid);assert.equal(rows.some(n=>n.id==='old-global'),false);assert.equal(rows.some(n=>n.id==='announcement'),true);}
  await db.query("insert into profiles(id,name,email) values('new','Новый Пользователь','new@test')");
  assert.equal((await feed('new')).filter(n=>n.title==='Добро пожаловать в КТЭиП ПК').length,1);
  assert.equal((await feed('outside')).some(n=>n.title==='Добро пожаловать в КТЭиП ПК'),false);
  await rpc('set_account_role',['admin','new','teacher','student']);
  assert.equal((await feed('new')).some(n=>n.title==='Ваш доступ обновлён'),true);
  assert.equal((await feed('outside')).some(n=>n.title==='Ваш доступ обновлён'),false);
  assert.equal((await rpc('role_change_log',['admin',0])).length,1);
  await assert.rejects(rpc('role_change_log',['t',0]),{code:'42501'});
  await rpc('read_notifications',['outside',['old-global',(await feed('new')).find(n=>n.title==='Ваш доступ обновлён').id]]);
  assert.equal((await db.query("select count(*)::int n from notification_reads where user_id='outside'")).rows[0].n,0);
});
test('no implicit subscription; exact group, subject and own-teacher scopes deduplicate recipients',async()=>{
  await save(1,1,{status:'lesson',title:'Математика',teacherId:'t',room:'20'});
  for(const uid of ['s','math','t','outside'])assert.equal((await notices(uid)).length,0);
  const a=await subscribe('s');assert.equal((await subscribe('s')).id,a.id);
  await subscribe('s','subject',group,'Математика');await subscribe('math','subject',group,'  Математика  ');
  await subscribe('physics','subject',group,'Физика');await subscribe('t','mine');await subscribe('t');
  await assert.rejects(subscribe('outside','mine'),{code:'42501'});
  await save(1,2,{status:'lesson',title:'Математика',teacherId:'t',room:'12'});
  assert.equal((await notices('s')).length,1);assert.equal((await notices('math')).length,1);assert.equal((await notices('t')).length,1);
  assert.equal((await notices('physics')).length,0);assert.equal((await notices('outside')).length,0);
  await save(1,2,{status:'lesson',title:'Математика',room:'13'},null,otherGroup);
  assert.equal((await notices('s')).length,1,'9241 does not subscribe to 92410');
  assert.equal((await rpc('list_notification_subscriptions',['outside'])).length,0);
});
test('replacement, cancellation and teacher reassignment notify old and new interested users; unsubscribe stops future delivery',async()=>{
  await subscribe('other','mine');
  const original=(await db.query('select * from weekly_schedule_cells where group_id=$1 and weekday=1 and lesson_number=2',[group.id])).rows[0];
  const changed=await save(1,2,{status:'lesson',title:'Физика',teacherId:'other',room:'26'},original);
  assert.equal((await notices('math')).length,2,'old subject gets replacement notice');assert.equal((await notices('physics')).length,1,'new subject gets replacement notice');
  assert.equal((await notices('t')).length,2,'old teacher gets replacement');assert.equal((await notices('other')).length,1);
  const cancelled=await save(1,2,{status:'free'},changed);assert.equal((await notices('physics')).length,2);assert.match((await notices('physics'))[0].body,/Нет пары/);
  await db.query("delete from notification_subscriptions where user_id='math'");
  await save(1,3,{status:'lesson',title:'Математика',teacherId:'other'});assert.equal((await notices('math')).length,2);
  assert.equal((await notices('outside')).length,0);assert.equal(cancelled.status,'free');
});
test('catalog/material edits create no global notifications; tables and RPCs are closed to direct clients',async()=>{
  const before=(await db.query('select count(*)::int n from notifications')).rows[0].n;
  await db.query("insert into materials(kind,teacher_id,teacher_name,title,body) values('lectures','other','Учитель','Новая лекция','Текст')");
  assert.equal((await db.query('select count(*)::int n from notifications')).rows[0].n,before);
  const p=(await db.query("select has_table_privilege('anon','notification_subscriptions','select') subscriptions,has_function_privilege('authenticated','add_notification_subscription(text,text,text,text,text)','execute') rpc,has_function_privilege('anon','save_profile_name(text,integer,text,text,text,text,text)','execute') names")).rows[0];
  assert.deepEqual(p,{subscriptions:false,rpc:false,names:false});
});
test('long structured teacher names remain usable in linked timetable cells',async()=>{
  const fields=names.validateFields({firstNameRaw:'А'.repeat(100),lastNameRaw:'Б'.repeat(100),patronymicRaw:'В'.repeat(100)});
  await rpc('save_profile_name',['t',0,fields.firstNameRaw,fields.lastNameRaw,fields.patronymicRaw,'provided',names.fullName(fields)]);
  const row=await save(5,6,{status:'lesson',title:'Практическая работа',teacherId:'t'});
  assert.equal(row.teacher_label,names.fullName(fields));assert.ok(row.teacher_label.length>120);
});

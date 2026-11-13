const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
let db;
const rpc=async(name,args)=>(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args)).rows[0].value;
const table=(uid,teacher,testId='quiz',mode='latest',search='',status='',student=null,sort='name',offset=0,exporting=false)=>rpc('test_results_table',[uid,teacher,testId,mode,search,status,student,sort,offset,exporting]);
before(async()=>{
  db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
  const files=fs.readdirSync('supabase/migrations').sort();
  for(const f of files.filter(f=>f<'20261113000100'))await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
  await db.exec("insert into profiles(id,name,email) values('t','Иван Иванов Иванович','t@test'),('other','Другой Учитель Иванович','o@test'),('s1','Яна Петрова Петровна','s1@test'),('s2','Анна Иванова Ивановна','s2@test');insert into teachers values('t'),('other');insert into tests(id,teacher_id,teacher_name,title,timer,questions) values('quiz','t','Иван Иванов Иванович','Архивный тест',0,'[{\"type\":\"choice\",\"text\":\"Q\",\"options\":[\"a\",\"b\",\"c\",\"d\"],\"correct\":1}]'),('empty','t','Иван Иванов Иванович','Пустой тест',0,'[{}]'),('foreign','other','Другой','Чужой тест',0,'[{}]');update tests set archived_at=now() where id='quiz';");
  for(const [id,testId,teacher,student,name,score,total,state,date] of [
    ['r1','quiz','t','s1','Яна Петрова Петровна',2,3,'graded','2026-11-10T10:00:00Z'],
    ['r2','quiz','t','s1','Яна Петрова Петровна',1,3,'pending_review','2026-11-11T10:00:00Z'],
    ['r3','quiz','t','s2','Анна Иванова Ивановна',85,100,'graded','2026-11-11T11:00:00Z'],
    ['r4','deleted','t','s1','Яна Петрова Петровна',0,1,'graded','2026-11-11T12:00:00Z'],
    ['r5','foreign','other','s1','Яна Петрова Петровна',1,1,'graded','2026-11-11T13:00:00Z']
  ])await db.query("insert into test_results(id,test_id,test_title,teacher_id,student_id,student_name,answers,score,total,percentage,status,submitted_at) values($1,$2,'Снимок названия',$3,$4,$5,'{}',$6,$7,$8,$9,$10)",[id,testId,teacher,student,name,score,total,state==='graded'?Math.round(score*100/total):null,state,date]);
  for(const f of files.filter(f=>f>='20261113000100'))await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
  await db.exec('set role service_role');
});
after(async()=>await db?.close());
test('catalog retains archived/deleted tests and empty owned tests without exposing foreign tests',async()=>{
  const teacher=await rpc('list_result_tests',['t',true]);assert.deepEqual(teacher.map(t=>t.id).sort(),['deleted','empty','quiz']);
  assert.equal(teacher.find(t=>t.id==='quiz').state,'archived');assert.equal(teacher.find(t=>t.id==='deleted').state,'retained');
  const student=await rpc('list_result_tests',['s2',false]);assert.deepEqual(student.map(t=>t.id),['quiz']);
  assert.equal((await db.query('select count(*)::int n from test_results')).rows[0].n,5);
});
test('latest is chosen per student before status filtering; attempt numbers cover complete history',async()=>{
  const last=await table('t',true);assert.deepEqual(last.rows.map(r=>r.id),['r3','r2']);assert.equal(last.rows[1].attempt_number,2);assert.equal(last.rows[1].attempt_count,2);
  assert.deepEqual((await table('t',true,'quiz','latest','','graded')).rows.map(r=>r.id),['r3']);
  const all=await table('t',true,'quiz','all','','','s1');assert.deepEqual(all.rows.map(r=>r.id),['r2','r1']);assert.equal(all.summary.students,1);
  const own=await table('s1',false,'quiz','all');assert.deepEqual(own.rows.map(r=>r.id),['r2','r1']);
  assert.equal((await table('s1',false,'quiz','all','','','s2')).rows.length,0);
  assert.equal((await table('t',true,'quiz','all','%')).rows.length,0,'search uses literal characters, not wildcard matching');
});
test('privacy and database permissions hold for table, exports and grading scales',async()=>{
  await assert.rejects(table('other',true),{code:'P0002'});await assert.rejects(table('s1',true),{code:'42501'});
  await assert.rejects(table('s1',false,'quiz','all','','',null,'date',0,true),{code:'42501'});
  await assert.rejects(rpc('save_test_grading_scale',['other','quiz',-1,50,70,85]),{code:'P0002'});
  await assert.rejects(rpc('save_test_grading_scale',['s1','quiz',-1,50,70,85]),{code:'42501'});
  assert.equal((await db.query("select has_table_privilege('anon','test_grading_scales','select') p")).rows[0].p,false);
});
test('scales are explicit, use unrounded scores, exclude pending reviews and reject stale writes',async()=>{
  assert.equal((await table('t',true)).rows[0].mark,null);
  await rpc('save_test_grading_scale',['t','quiz',-1,50,67,85]);
  const all=await table('t',true,'quiz','all');assert.equal(all.rows.find(r=>r.id==='r1').mark,3,'2/3 is below 67% despite old rounded percentage');
  assert.equal(all.rows.find(r=>r.id==='r2').mark,null);assert.equal(all.rows.find(r=>r.id==='r3').mark,5);
  await assert.rejects(rpc('save_test_grading_scale',['t','quiz',-1,50,70,85]),{code:'PT409'});
  await assert.rejects(rpc('save_test_grading_scale',['t','quiz',0,70,50,85]),{code:'22023'});
  const updated=await rpc('save_test_grading_scale',['t','quiz',0,50,70,90]);assert.equal(updated.revision,1);
  assert.equal((await table('s2',false)).rows[0].mark,4);
});
test('exports return all filtered rows in one snapshot and pagination never repeats a result',async()=>{
  await db.exec("insert into test_results(id,test_id,test_title,teacher_id,student_id,student_name,answers,score,total,percentage,status,submitted_at) select 'bulk-'||n,'empty','Пустой тест','t','s1','Студент '||n,'{}',1,1,100,'graded',now() from generate_series(1,73) n");
  const first=await table('t',true,'empty','all'),next=await table('t',true,'empty','all','','',null,'name',50);
  assert.equal(first.rows.length,50);assert.equal(first.hasMore,true);assert.equal(next.rows.length,23);assert.equal(next.hasMore,false);assert.equal(new Set([...first.rows,...next.rows].map(r=>r.id)).size,73);
  const exported=await table('t',true,'empty','all','','',null,'name',0,true);assert.equal(exported.rows.length,73);assert.equal(exported.summary.rows,73);assert.ok(exported.generatedAt);
  await db.exec("insert into test_results(id,test_id,test_title,teacher_id,student_id,student_name,answers,score,total,percentage,status) select 'limit-'||n,'empty','Пустой тест','t','s1','Студент','{}',1,1,100,'graded' from generate_series(1,5001) n");
  await assert.rejects(table('t',true,'empty','all','','',null,'name',0,true),{code:'22023'});
});

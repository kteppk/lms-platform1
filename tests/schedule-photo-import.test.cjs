const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {compile,importSQL,canonical}=require('../scripts/import-schedule-photos.cjs');
test('photo import is atomic, preserves edits, deduplicates spelling variants and can be repeated',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
  for(const file of fs.readdirSync('supabase/migrations').sort().filter(f=>f<'20261116000100'))await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  await db.exec("insert into profiles(id,name,email) values('admin','Администратор проверки','admin@example.test'),('student','Студент проверки','student@example.test');update account_roles set role='admin' where user_id='admin';");
  const data=compile();
  assert.deepEqual(data.stats,{groups:18,lessons:356,free:273,unknown:19});
  assert.equal(canonical('H 9–01'),canonical('Н 9-01'));
  assert.equal(new Set(data.groups.map(g=>g.key)).size,18);
  assert.equal(data.groups.find(g=>g.name==='3252').cells.find(c=>c.weekday===5&&c.lesson===3).payload.title,'Иностранный язык в профессиональной деятельности');
  await assert.rejects(db.exec(importSQL(data,'student')),/Existing administrator required/);await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int n from study_groups')).rows[0].n,0);
  const g=(await db.query("select create_schedule_group('admin','H 9–01','','',6) g")).rows[0].g;
  await db.query("select save_schedule_cell('admin',$1,1,1,null,0,'{\"status\":\"lesson\",\"title\":\"Правка администратора\"}')",[g.id]);
  const first=await db.exec(importSQL(data,'admin'));
  const receipt=first.find(r=>r.rows?.[0]?.receipt)?.rows[0].receipt;
  assert.equal(receipt.createdGroups,17);assert.equal(receipt.insertedCells,628);assert.equal(receipt.preservedConflicts,1);
  assert.equal((await db.query('select count(*)::int n from study_groups')).rows[0].n,18);
  assert.equal((await db.query('select title from weekly_schedule_cells where group_id=$1 and weekday=1 and lesson_number=1',[g.id])).rows[0].title,'Правка администратора');
  assert.equal((await db.query("select count(*)::int n from weekly_schedule_cells c join study_groups s on s.id=c.group_id where s.name='3242' and c.weekday=2 and c.lesson_number in (1,2,3)")).rows[0].n,0,'glare is unfilled, not a false no-lesson');
  const uncertain=(await db.query("select teacher_label,note from weekly_schedule_cells c join study_groups s on s.id=c.group_id where s.name='1251' and c.weekday=2 and lesson_number=2")).rows[0];
  assert.equal(uncertain.teacher_label,'');assert.match(uncertain.note,/требует уточнения/);
  const again=(await db.exec(importSQL(data,'admin'))).find(r=>r.rows?.[0]?.receipt)?.rows[0].receipt;
  assert.equal(again.createdGroups,0);assert.equal(again.insertedCells,0);assert.equal(again.matchedCells,628);assert.equal(again.preservedConflicts,1);
  await db.query("select create_schedule_group('admin','Н9-01','','',6)");
  await assert.rejects(db.exec(importSQL(data,'admin')),/Duplicate canonical group/);await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int n from weekly_schedule_cells')).rows[0].n,629);
 }finally{await db.close();}
});

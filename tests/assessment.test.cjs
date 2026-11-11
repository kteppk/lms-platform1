const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
let db;
const choice = { type: 'choice', text: 'Вопрос', options: ['а','б','в','г'], correct: 1 };
async function rpc(name, args) {
  const result = await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as value',
    args.map(a => a !== null && typeof a === 'object' ? JSON.stringify(a) : a));
  return result.rows[0].value;
}
async function createTest(id, questions = [choice], timer = 5) {
  await db.query('insert into tests(id,teacher_id,teacher_name,title,timer,questions) values($1,$2,$3,$4,$5,$6::jsonb)',
    [id,'teacher','Учитель',id,timer,JSON.stringify(questions)]);
}
before(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
  const migrations = fs.readdirSync('supabase/migrations').sort();
  for (const f of migrations.slice(0,2)) await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
  await db.exec("insert into profiles(id,name,email) values ('teacher','Учитель','t@test'),('other','Другой','o@test'),('student','Студент','s@test'),('student2','Студент 2','s2@test'); insert into teachers values ('teacher'),('other');");
  await createTest('legacy');
  await db.exec("insert into test_attempts(id,test_id,student_id) values ('legacy-attempt','legacy','student'); insert into materials(kind,teacher_id,teacher_name,title,body) values ('lectures','teacher','Учитель','Старая лекция','Текст');");
  for (const f of migrations.slice(2)) await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
  await db.exec('set role service_role');
});
after(async () => { await db?.close(); });

test('migration preserves existing material and supplies a snapshot to an old attempt', async () => {
  assert.equal((await db.query('select count(*)::int as n from materials')).rows[0].n,1);
  const a = await rpc('read_test_attempt',['legacy-attempt','student']);
  assert.equal(a.test_snapshot.questions[0].correct,1);
  const privileges = (await db.query("select has_table_privilege('anon','test_result_reviews','select') as reviews, has_function_privilege('authenticated','save_test_draft(text,text,jsonb,integer)','execute') as drafts")).rows[0];
  assert.deepEqual(privileges,{reviews:false,drafts:false});
});
test('opening twice resumes one attempt without extending the deadline; drafts survive reading', async () => {
  await createTest('resume');
  const a = await rpc('open_test_attempt',['resume','student']);
  const b = await rpc('open_test_attempt',['resume','student']);
  assert.equal(a.id,b.id); assert.equal(a.expires_at,b.expires_at);
  assert.deepEqual(await rpc('save_test_draft',[a.id,'student',{0:1},0]),{revision:1});
  assert.deepEqual(await rpc('save_test_draft',[a.id,'student',{0:1},0]),{revision:1});
  const restored = await rpc('read_test_attempt',[a.id,'student']);
  assert.deepEqual(restored.answers,{'0':1}); assert.equal(restored.revision,1);
  await assert.rejects(rpc('save_test_draft',[a.id,'student',{0:0},0]),{code:'PT409'});
  await assert.rejects(rpc('save_test_draft',[a.id,'student2',{0:0},1]),{code:'P0002'});
  await assert.rejects(rpc('save_test_draft',[a.id,'student',{9:0},1]),{code:'22023'});
});
test('archive blocks new students but preserves existing attempts and their immutable questions', async () => {
  await createTest('archive');
  const a = await rpc('open_test_attempt',['archive','student']);
  await db.query('update tests set archived_at=now(), questions=$1::jsonb where id=$2',[JSON.stringify([{...choice,correct:0}]),'archive']);
  await assert.rejects(rpc('open_test_attempt',['archive','student2']),{code:'P0002'});
  assert.equal((await rpc('open_test_attempt',['archive','student'])).id,a.id);
  const result=await rpc('finish_test_attempt',[a.id,'student',{0:1},0,new Date().toISOString()]);
  assert.equal(result.score,1); assert.equal(result.status,'graded');
  assert.deepEqual(await rpc('finish_test_attempt',[a.id,'student',{0:0},0,new Date().toISOString()]),result);
});
test('late finalization grades the saved draft instead of accepting late edits', async () => {
  await createTest('timeout');
  const a=await rpc('open_test_attempt',['timeout','student']);
  await rpc('save_test_draft',[a.id,'student',{0:1},0]);
  await db.query("update test_attempts set expires_at=now()-interval '30 seconds' where id=$1",[a.id]);
  await assert.rejects(rpc('save_test_draft',[a.id,'student',{0:0},1]),{code:'P0001'});
  const result=await rpc('finish_test_attempt',[a.id,'student',{0:0},1,new Date().toISOString()]);
  assert.equal(result.score,1);
  assert.equal((await rpc('read_test_attempt',[a.id,'student'])).state,'submitted');
});
test('text and photo answers await review; only the owning teacher can grade every manual question', async () => {
  await createTest('manual',[choice,{type:'text',text:'Объяснение'},{type:'photo',text:'Фото'}]);
  const a=await rpc('open_test_attempt',['manual','student']);
  const answers={0:1,1:'Текст',2:'student/'+a.id+'/photo'};
  const pending=await rpc('finish_test_attempt',[a.id,'student',answers,0,new Date().toISOString()]);
  assert.equal(pending.status,'pending_review'); assert.equal(pending.percentage,null); assert.equal(pending.score,1);
  await assert.rejects(rpc('review_test_result',[a.id,'other',{1:1,2:1},'',0]),{code:'P0002'});
  await assert.rejects(rpc('review_test_result',[a.id,'teacher',{0:1,1:1},'',0]),{code:'22023'});
  await assert.rejects(rpc('review_test_result',[a.id,'teacher',{1:0.5,2:1},'',0]),{code:'22023'});
  const graded=await rpc('review_test_result',[a.id,'teacher',{1:1,2:1},'Хорошо',0]);
  assert.equal(graded.status,'graded'); assert.equal(graded.score,3); assert.equal(graded.percentage,100);
  assert.equal(graded.feedback,'Хорошо');
  await assert.rejects(rpc('review_test_result',[a.id,'teacher',{1:0,2:0},'',0]),{code:'PT409'});
  const revised=await rpc('review_test_result',[a.id,'teacher',{1:1,2:0},'Уточнение',1]);
  assert.equal(revised.score,2); assert.equal(revised.percentage,67);
  assert.equal((await db.query('select count(*)::int as n from test_result_reviews where result_id=$1',[a.id])).rows[0].n,2);
});
test('photo drafts cannot reference another student or attempt', async () => {
  await createTest('photo',[{type:'photo',text:'Фото'}]);
  const a=await rpc('open_test_attempt',['photo','student']);
  await assert.rejects(rpc('save_test_draft',[a.id,'student',{0:'student2/'+a.id+'/photo'},0]),{code:'22023'});
  await assert.rejects(rpc('save_test_draft',[a.id,'student',{0:'student/wrong/photo'},0]),{code:'22023'});
});

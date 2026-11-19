const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');let db,subject;
const rpc=async(name,args)=>(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args)).rows[0].v;
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');for(const f of fs.readdirSync('supabase/migrations').sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec("insert into profiles(id,name,email) values('a','Админ','a@test'),('t','Создатель','t@test'),('other','Преподаватель','other@test'),('s','Студент','s@test');insert into teachers values('t'),('other');update account_roles set role='admin' where user_id='a';set role service_role");subject=await rpc('create_subject',['t','Предмет с заявкой','Описание']);});after(async()=>db?.close());
test('only an administrator can approve; repeated requests and approvals are idempotent',async()=>{
 await assert.rejects(rpc('request_subject_join',['s',subject]),{code:'42501'});
 const req=await rpc('request_subject_join',['other',subject]);assert.equal(req.status,'pending');assert.deepEqual(await rpc('request_subject_join',['other',subject]),req);
 assert.equal((await db.query('select count(*)::int n from subject_teachers where subject_id=$1 and teacher_id=$2',[subject,'other'])).rows[0].n,0);
 for(const actor of ['t','other','s','missing'])await assert.rejects(rpc('review_subject_join_request',[actor,req.id,true]),{code:'42501'});
 assert.equal((await rpc('list_subject_join_requests',['t'])).length,0);assert.equal((await rpc('list_subject_join_requests',['a'])).length,1);
 assert.equal((await rpc('review_subject_join_request',['a',req.id,true])).status,'approved');assert.equal((await rpc('review_subject_join_request',['a',req.id,true])).status,'approved');
 assert.equal((await db.query('select count(*)::int n from subject_teachers where subject_id=$1 and teacher_id=$2',[subject,'other'])).rows[0].n,1);
 assert.equal((await db.query("select count(*)::int n from notifications where dedupe_key=$1",['subject-decision:'+req.id])).rows[0].n,1);
 await assert.rejects(rpc('review_subject_join_request',['a',req.id,false]),{code:'PT409'});
});
test('rejection retains history and permits another request; archived subjects cannot be approved',async()=>{
 const fresh=await rpc('create_subject',['t','Другая дисциплина','']);const first=await rpc('request_subject_join',['other',fresh]);await rpc('review_subject_join_request',['a',first.id,false]);
 const second=await rpc('request_subject_join',['other',fresh]);assert.notEqual(second.id,first.id);assert.equal((await rpc('list_subject_join_requests',['other'])).filter(r=>r.subject_id===fresh).length,2);
 await db.query('update subjects set archived_at=now() where id=$1',[fresh]);await assert.rejects(rpc('review_subject_join_request',['a',second.id,true]),{code:'P0002'});
 assert.equal((await rpc('review_subject_join_request',['a',second.id,false])).status,'rejected');
});
test('revoked teachers cannot gain membership and private request data is not accessible to browser database roles',async()=>{
 const fresh=await rpc('create_subject',['t','Отзыв роли','']);const req=await rpc('request_subject_join',['other',fresh]);await rpc('set_account_role',['a','other','student','teacher']);
 await assert.rejects(rpc('review_subject_join_request',['a',req.id,true]),{code:'42501'});await rpc('review_subject_join_request',['a',req.id,false]);
 for(const role of ['anon','authenticated']){assert.equal((await db.query("select has_table_privilege($1,'subject_join_requests','select') yes",[role])).rows[0].yes,false);assert.equal((await db.query("select has_function_privilege($1,'review_subject_join_request(text,text,boolean)','execute') yes",[role])).rows[0].yes,false);}
});

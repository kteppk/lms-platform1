const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
let db,g;
const rpc=async(name,args=[])=>(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args)).rows[0].v;
before(async()=>{
 db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
 for(const f of fs.readdirSync('supabase/migrations').sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec("insert into profiles(id,name,email) values('admin','Админ','a@test'),('student','Студент','s@test'),('other','Другой','o@test'),('curator','Куратор','c@test');update account_roles set role='admin' where user_id='admin';set role service_role;");await rpc('set_account_role',['admin','curator','curator','student']);
 g=await rpc('create_schedule_group',['admin','Н 9-01','1','Право',6]);
});
after(async()=>db?.close());
test('academic data keeps raw private birthday, computes age, scopes owner edits and prevents stale writes',async()=>{
 const saved=await rpc('save_education_profile',['student',0,'Право',1,g.id,'2024-09-01','2000-01-01']);assert.equal(saved.revision,1);assert.equal(saved.birthDate,'2000-01-01');assert.equal(saved.groupName,'Н 9-01');assert.equal(saved.age,new Date().getUTCFullYear()-2000);
 assert.equal((await rpc('read_education_profile',['other','student'])).birthDate,null);assert.equal((await rpc('read_education_profile',['admin','student'])).birthDate,'2000-01-01');
 await assert.rejects(rpc('save_education_profile',['student',0,'Новое',2,g.id,null,null]),{code:'PT409'});
 await assert.rejects(rpc('save_education_profile',['missing',0,'Право',1,g.id,null,null]),{code:'42501'});
 await assert.rejects(rpc('save_education_profile',['student',1,'Право',1,g.id,'1900-01-01','2100-01-01']),{code:'22023'});
});
test('curators publish and edit only their own ordinary news, never broadcasts or imported entries',async()=>{
 const post=await rpc('save_news_post',['curator',null,0,'college','news','Новость','Текст',false,false]);
 const adminPost=await rpc('save_news_post',['admin',null,0,'college','news','От администрации','Текст',false,false]);
 await assert.rejects(rpc('save_news_post',['curator',adminPost.id,0,'college','news','Чужая','Текст',false,false]),{code:'42501'});
 await assert.rejects(rpc('delete_news_post',['curator',adminPost.id,0]),{code:'42501'});
 await assert.rejects(rpc('save_news_post',['curator',null,0,'site','announcement','Рассылка','Текст',true,true]),{code:'42501'});
 const feed=await rpc('news_feed_v2',['curator','all','newest',0]);assert.equal(feed.rows.find(p=>p.id===post.id).can_edit,true);assert.equal(feed.rows.find(p=>p.id===adminPost.id).can_edit,false);
 assert.equal((await rpc('news_feed_v2',[null,'all','newest',0])).rows.some(p=>p.can_edit),false);await rpc('delete_news_post',['curator',post.id,0]);
});
test('group clocks are atomic/admin-only/revision-safe; per-cell overrides win and free cells remain untimed',async()=>{
 const rev=(await db.query('select revision from study_groups where id=$1',[g.id])).rows[0].revision;
 await assert.rejects(rpc('save_group_lesson_times',['student',g.id,rev,[]]),{code:'42501'});
 await rpc('save_group_lesson_times',['admin',g.id,rev,[{lessonNumber:1,startsAt:'08:00',endsAt:'09:35'},{lessonNumber:2,startsAt:'09:45',endsAt:'11:20'}]]);
 await assert.rejects(rpc('save_group_lesson_times',['admin',g.id,rev,[]]),{code:'PT409'});
 const updated=(await db.query('select revision from study_groups where id=$1',[g.id])).rows[0].revision;
 await assert.rejects(rpc('save_group_lesson_times',['admin',g.id,updated,[{lessonNumber:1,startsAt:'08:00',endsAt:'09:35'},{lessonNumber:2,startsAt:'09:00',endsAt:'10:35'}]]),{code:'22023'});
 assert.equal((await db.query('select count(*)::int n from group_lesson_times where group_id=$1',[g.id])).rows[0].n,2);
 await rpc('save_schedule_cell',['admin',g.id,1,1,null,0,{status:'lesson',title:'Право'}]);await rpc('save_schedule_cell',['admin',g.id,1,2,null,0,{status:'free'}]);
 const cell=(await db.query('select * from effective_weekly_schedule where group_id=$1 order by lesson_number',[g.id])).rows;assert.equal(cell[0].starts_at,'08:00:00');assert.equal(cell[1].starts_at,null);
 const changed=await rpc('save_schedule_cell',['admin',g.id,1,1,cell[0].id,cell[0].revision,{status:'lesson',title:'Право',startsAt:'08:10',endsAt:'09:45'}]);assert.equal((await db.query('select starts_at from effective_weekly_schedule where id=$1',[changed.id])).rows[0].starts_at,'08:10:00');
});
test('schedule export is a scoped public snapshot without account or mutation fields and Excel text stays literal',async()=>{
 const data=await rpc('schedule_export_snapshot',[g.id,'2028-01-03']);assert.equal(data.groups.length,1);assert.equal(data.groups[0].group.id,g.id);
 for(const word of ['email','created_by','updated_by','teacher_id','revision'])assert.equal(JSON.stringify(data).includes(word),false,word);
 global.ResultsExport=require('../results-export.js');const output=require('../schedule-export.js');const book=output.workbook({...data,groups:[...data.groups,{group:{...g,name:'Н 9-01'},cells:[{weekday:1,lesson_number:1,status:'lesson',title:'=HYPERLINK("bad")',teacher_label:'<Имя>'}]}]});
 const zip=Buffer.from(await book.arrayBuffer());let offset=0,parts={};while(zip.readUInt32LE(offset)===0x04034b50){const size=zip.readUInt32LE(offset+18),nl=zip.readUInt16LE(offset+26),el=zip.readUInt16LE(offset+28),name=zip.subarray(offset+30,offset+30+nl).toString(),start=offset+30+nl+el;parts[name]=zip.subarray(start,start+size).toString();offset=start+size;}
 assert.ok(parts['xl/workbook.xml'].includes('Н 9-01 2'));assert.ok(parts['xl/worksheets/sheet2.xml'].includes('=HYPERLINK'));assert.equal(parts['xl/worksheets/sheet2.xml'].includes('<f>'),false);assert.ok(parts['[Content_Types].xml'].includes('http://schemas.openxmlformats.org/package/2006/content-types'));
 assert.equal(output.timeLabel('08:00:00','09:35:00'),'08:00–08:45 · перерыв 5 мин · 08:50–09:35');
 delete global.ResultsExport;
});
test('lesson reminders require acknowledgement/device opt-in, deduplicate, and discard cancelled or expired classes',async()=>{
 await assert.rejects(rpc('set_lesson_reminder',['student',g.id,true,false]),{code:'22023'});
 await assert.rejects(rpc('set_lesson_reminder',['student',g.id,true,true]),{code:'22023'});
 await rpc('save_push_device',['student','https://fcm.googleapis.com/fcm/send/test','key','auth',false,false,true]);await rpc('set_lesson_reminder',['student',g.id,true,true]);
 const c=(await db.query('select * from weekly_schedule_cells where group_id=$1 and lesson_number=1',[g.id])).rows[0];await rpc('save_schedule_cell',['admin',g.id,1,1,c.id,c.revision,{status:'lesson',title:'Право',startsAt:'08:00',endsAt:'09:35'}]);
 const before=(await db.query("select count(*)::int n from notifications where category='lesson'")).rows[0].n;assert.equal(await rpc('enqueue_lesson_reminders',['2028-01-03T00:55:00Z']),1);assert.equal(await rpc('enqueue_lesson_reminders',['2028-01-03T00:55:20Z']),0);
 assert.equal((await db.query("select count(*)::int n from notifications where category='lesson'")).rows[0].n,before+1);
 const rows=(await db.query("select recipient_id,context from notifications where category='lesson'")).rows;assert.equal(rows[0].recipient_id,'student');assert.ok(rows[0].context.expiresAt);
 const current=(await db.query('select * from weekly_schedule_cells where id=$1',[c.id])).rows[0];await rpc('save_schedule_cell',['admin',g.id,1,1,c.id,current.revision,{status:'free'}]);assert.equal((await rpc('claim_browser_push')).length,0);
 assert.equal((await db.query("select state from push_deliveries j join notifications n on n.id=j.notification_id where n.category='lesson'")).rows[0].state,'dead');
 await rpc('set_lesson_reminder',['student',g.id,false,false]);assert.equal(await rpc('enqueue_lesson_reminders',['2028-01-10T00:55:00Z']),0);
});

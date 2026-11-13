const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {PGlite}=require('@electric-sql/pglite');
let db;
const rpc=async(name,args=[])=>{const r=await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args);return r.rows[0].v;};
before(async()=>{
 db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
 for(const f of fs.readdirSync('supabase/migrations').sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec("insert into profiles(id,name,email) values('admin','Администратор','a@test'),('teacher','Преподаватель','t@test'),('student','Студент','s@test');insert into teachers values('teacher');update account_roles set role='admin' where user_id='admin';set role service_role;");
});
after(async()=>db?.close());
const save=(actor,title,channel='college',old=null,notify=false)=>rpc('save_news_post',[actor,old?.id??null,old?.revision??0,channel,'news',title,'Текст '+title,notify]);
test('only administrators publish/edit/delete; optimistic revisions preserve newer text',async()=>{
 await assert.rejects(save('student','Нет доступа'),/администратор/);
 await assert.rejects(save('teacher','Нет доступа'),/администратор/);
 const p=await save('admin','Событие');const next=await save('admin','Исправленное событие','college',p);
 await assert.rejects(save('admin','Устаревшее событие','college',p),/уже изменена/);
 await assert.rejects(rpc('delete_news_post',['student',next.id,next.revision]),/администратор/);
 await assert.rejects(rpc('delete_news_post',['admin',next.id,p.revision]),/уже изменена/);
 await rpc('delete_news_post',['admin',next.id,next.revision]);
});
test('two chronological feeds paginate without mixing channels; news creates no notifications by default',async()=>{
 const before=(await db.query('select count(*)::int n from notifications')).rows[0].n;
 for(let i=0;i<25;i++){const p=await save('admin','Событие '+i);await db.query('update news_posts set published_at=$1 where id=$2',[new Date(Date.UTC(2026,10,i+1)),p.id]);}
 const first=await rpc('news_feed',['college',0]),second=await rpc('news_feed',['college',20]);
 assert.equal(first.rows.length,20);assert.equal(first.hasMore,true);assert.equal(second.rows.length,5);assert.equal(second.hasMore,false);
 assert.equal(new Set([...first.rows,...second.rows].map(n=>n.id)).size,25);
 assert.equal(first.rows[0].title,'Событие 24');assert.ok((await rpc('news_feed',['site',0])).rows.every(n=>n.channel==='site'));
 assert.equal((await db.query('select count(*)::int n from notifications')).rows[0].n,before);
});
test('explicit notifications import once; legacy publisher remains compatible; imported commits cannot be edited',async()=>{
 const p=await save('admin','Общее объявление','site',null,true);
 assert.equal((await db.query('select count(*)::int n from news_posts where title=$1',[p.title])).rows[0].n,1);
 await db.query("insert into notifications(actor_id,category,title,body,destination) values('admin','announcement','Из прежнего API','Текст','notifications')");
 assert.equal((await db.query("select count(*)::int n from news_posts where title='Из прежнего API'")).rows[0].n,1);
 const imported=(await rpc('news_feed',['site',0])).rows.find(n=>n.imported);
 await assert.rejects(save('admin','Переписать импорт','site',imported),/уже изменена/);
});
test('registration totals count mutually exclusive current roles, include zero months and deny students',async()=>{
 const d=await rpc('registration_statistics',['admin']);assert.equal(d.total,3);assert.equal(d.students,1);assert.equal(d.teachers,1);assert.equal(d.admins,1);assert.equal(d.months.length,6);assert.equal(d.last7,3);
 assert.equal(d.months.reduce((n,m)=>n+m.students+m.teachers+m.admins,0),3);
 await assert.rejects(rpc('registration_statistics',['student']),/администрации/);
 assert.deepEqual((await db.query("select has_table_privilege('anon','news_posts','select') news,has_function_privilege('authenticated','registration_statistics(text)','execute') stats")).rows[0],{news:false,stats:false});
});
test('GitHub sync lease prevents per-user requests and releases expired failures',async()=>{
 const first=await rpc('claim_news_sync');assert.equal(first.id,'github');assert.equal(await rpc('claim_news_sync'),null);
 await db.exec("update news_sync set locked_until=now()-interval '1 minute'");assert.ok(await rpc('claim_news_sync'));
});
test('GitHub importer is idempotent, handles multiple commits and preserves the cursor on errors',async()=>{
 const {syncGitHubNews}=await import(pathToFileURL(path.resolve('supabase/functions/lms/news.ts')));
 const records=new Map(),updates=[];let cursor='264a2e1';
 const client={rpc:async()=>({data:{cursor_sha:cursor},error:null}),from:table=>({upsert:async rows=>{assert.equal(table,'news_posts');for(const row of rows)records.set(row.source_key,row);return {error:null};},update:values=>({eq:async()=>{updates.push(values);if(values.cursor_sha)cursor=values.cursor_sha;return {error:null};}})})};
 const commit=(sha,date)=>({sha,commit:{message:'Обновление '+sha.slice(0,3)+'\n\nПодробности',committer:{date}}});
 const list=[commit('b'.repeat(40),'2026-11-13T12:00:00Z'),commit('a'.repeat(40),'2026-11-12T12:00:00Z'),commit('264a2e1'+'0'.repeat(33),'2026-11-11T12:00:00Z')];
 const fetcher=async()=>new Response(JSON.stringify(list),{status:200});await syncGitHubNews(client,fetcher);assert.equal(records.size,2);assert.equal(cursor,'b'.repeat(40));
 await syncGitHubNews(client,fetcher);assert.equal(records.size,2);
 await syncGitHubNews(client,async()=>new Response('',{status:403}));assert.equal(cursor,'b'.repeat(40));assert.equal(updates.at(-1).locked_until,null);
});
test('version is shared by release manifest, generated client and package',()=>{
 const release=require('../release.json'),pkg=require('../package.json');assert.match(release.version,/^\d+\.\d+\.\d+$/);assert.equal(pkg.version,release.version);assert.ok(fs.readFileSync('release.js','utf8').includes(JSON.stringify(release)));
});

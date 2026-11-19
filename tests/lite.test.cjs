const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{PGlite}=require('@electric-sql/pglite');
let db,g,other,createPublicHandler,createMirrorHandler;
const rpc=async(name,args)=>(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args)).rows[0].value;
before(async()=>{
 db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
 for(const f of fs.readdirSync('supabase/migrations').sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec("insert into profiles(id,name,email) values('admin','Админ Первый','secret-admin@test'),('teacher','Учитель Первый','secret-teacher@test'),('student','Студент Первый','secret-student@test');insert into teachers values('teacher');update account_roles set role='admin' where user_id='admin';set role service_role;");
 g=await rpc('create_schedule_group',['admin','9241','4','Программа',6]);other=await rpc('create_schedule_group',['admin','92410','','',6]);
 for(const [group,title] of [[g,'Основная пара'],[other,'Чужая пара']])await rpc('save_schedule_cell',['admin',group.id,1,1,null,0,{status:'lesson',title,teacherLabel:'ФИО преподавателя',room:'20'}]);
 await db.query("insert into schedule_entries(id,lesson_date,starts_at,ends_at,title,group_name,created_by) values('dated','2026-11-16','12:00','13:30','Датированная пара','9241','admin')");
 await rpc('add_notification_subscription',['student','group',g.id,null,null]);await rpc('add_notification_subscription',['teacher','group',other.id,null,null]);
 await db.query("insert into notifications(recipient_id,category,title) values('student','personal','PRIVATE NOTICE')");
 for(let n=0;n<12;n++)await db.query("insert into news_posts(id,channel,title,body,author_id,published_at) values($1,$2,$3,$4,'admin',$5)",['post'+n,n%2?'site':'college','Новость '+n,'Б'.repeat(600),new Date(Date.UTC(2026,10,10,n))]);
 ({createPublicHandler}=await import(pathToFileURL(path.resolve('supabase/functions/lms-public/handler.ts'))));({createMirrorHandler}=await import(pathToFileURL(path.resolve('lite/mirror-runtime.mjs'))));
});
after(async()=>await db?.close());
test('public projection includes only news and one exact group, short previews, full text on demand and dated lessons',async()=>{
 const result=await rpc('lite_public_snapshot',['bootstrap',g.id,'2026-11-16',0,null]);assert.equal(result.groups.length,2);assert.equal(result.news.rows.length,10);assert.equal(result.news.hasMore,true);const fixture=result.news.rows.find(n=>n.id.startsWith('post'));assert.equal(fixture.excerpt.length,480);assert.equal(fixture.hasFullText,true);
 assert.equal(result.schedule.cells.length,1);assert.equal(result.schedule.cells[0].title,'Основная пара');assert.equal(result.schedule.dated.length,1);
 const json=JSON.stringify(result);for(const secret of ['secret-admin','secret-student','PRIVATE NOTICE','Чужая пара','teacher_id','author_id','created_by','revision'])assert.equal(json.includes(secret),false,secret);
 assert.equal((await rpc('lite_public_snapshot',['news',null,'2026-11-16',10,null])).news.rows.length,3);
 assert.equal((await rpc('lite_public_snapshot',['post',null,'2026-11-16',0,'post0'])).post.body.length,600);
 await assert.rejects(rpc('lite_public_snapshot',['post',null,'2026-11-16',0,'not-a-news-post']),{code:'P0002'});
});
test('group deletion is admin-only, revision-safe, scoped and notifies only its subscribers once',async()=>{
 const revision=(await db.query('select revision from study_groups where id=$1',[g.id])).rows[0].revision;
 for(const uid of ['student','teacher'])await assert.rejects(rpc('delete_schedule_group',[uid,g.id,revision,'9241']),{code:'42501'});
 await rpc('save_schedule_cell',['admin',g.id,1,2,null,0,{status:'free'}]);
 await assert.rejects(rpc('delete_schedule_group',['admin',g.id,revision,'9241']),{code:'PT409'});
 const current=(await db.query('select revision from study_groups where id=$1',[g.id])).rows[0].revision;
 await assert.rejects(rpc('delete_schedule_group',['admin',g.id,current,'Другая группа']),{code:'PT409'});
 const before=(await rpc('notification_feed',['teacher',0])).rows.length;
 const result=await rpc('delete_schedule_group',['admin',g.id,current,'9241']);assert.equal(result.cells,2);assert.equal(result.dated,1);
 assert.equal((await db.query('select count(*)::int n from weekly_schedule_cells where group_id=$1',[other.id])).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from profiles')).rows[0].n,3);assert.equal((await db.query('select count(*)::int n from news_posts')).rows[0].n,13);
 assert.equal((await rpc('notification_feed',['student',0])).rows.filter(n=>n.title.includes('удалена из расписания')).length,1);assert.equal((await rpc('notification_feed',['teacher',0])).rows.length,before);
 assert.equal((await db.query('select count(*)::int n from notification_subscriptions where group_id=$1',[g.id])).rows[0].n,0);
 await assert.rejects(rpc('delete_schedule_group',['admin',g.id,current,'9241']),{code:'P0002'});
 const rights=(await db.query("select has_function_privilege('anon','lite_public_snapshot(text,text,date,integer,text)','execute') public_rpc,has_function_privilege('authenticated','delete_schedule_group(text,text,integer,text)','execute') delete_rpc")).rows[0];assert.deepEqual(rights,{public_rpc:false,delete_rpc:false});
});
test('public HTTP handler allows anonymous reads only, coalesces reads, validates inputs and uses ETags',async()=>{
 let count=0,data={groups:[],news:{rows:[],hasMore:false,offset:0}};const db={rpc:async(name)=>{assert.equal(name,'lite_public_snapshot');count++;await new Promise(r=>setTimeout(r,5));return {data,error:null};}};
 const handler=createPublicHandler(db,{now:()=>new Date('2026-11-15T18:00:00Z')}),url='https://test/lms-public';
 const rows=await Promise.all([handler(new Request(url)),handler(new Request(url))]);assert.equal(count,1);assert.equal(rows[0].status,200);const etag=rows[0].headers.get('etag');assert.ok(etag);
 const unchanged=await handler(new Request(url,{headers:{'If-None-Match':etag}}));assert.equal(unchanged.status,304);assert.equal(await unchanged.text(),'');
 data={groups:[{id:'new'}],news:{rows:[],hasMore:false,offset:0}};const fresh=await handler(new Request(url+'?fresh=1'));assert.notEqual(fresh.headers.get('etag'),etag);assert.equal(count,2);
 for(const query of ['?view=deleteScheduleGroup','?group=../../private','?offset=1','?week=2026-11-17'])assert.equal((await handler(new Request(url+query))).status,400);
 assert.equal((await handler(new Request(url+'?action=listAccounts'))).status,403);
 assert.equal((await handler(new Request(url,{method:'POST',body:'{}'}))).status,405);assert.equal((await handler(new Request(url,{method:'OPTIONS'}))).status,204);assert.equal((await handler(new Request(url,{method:'HEAD'}))).status,200);assert.equal(count,2);
});
test('independent mirror caches public JSON, marks stale copies and forwards neither cookies nor authorization',async()=>{
 const entries=new Map(),cache={match:async k=>entries.get(k.url)?.clone(),put:async(k,v)=>{entries.set(k.url,v.clone());},delete:async k=>entries.delete(k.url)};
 let time=10000,calls=0,failed=false,queued=[];
 const mirror=createMirrorHandler({'/index.html':{body:'page',type:'text/html',etag:'"page"'}},{cache,now:()=>time,fetcher:async(url,init)=>{assert.equal(new URL(url).hostname,'vm756327.vps.masterhost.tech');assert.equal('Authorization' in init.headers,false);assert.equal('Cookie' in init.headers,false);calls++;if(failed)throw Error('offline');return new Response('{"groups":[]}',{headers:{ETag:'"one"'}});}});
 const request=()=>new Request('https://mirror.test/api',{headers:{Authorization:'Bearer private',Cookie:'session=private'}}),ctx={waitUntil:t=>queued.push(t)};
 let response=await mirror.fetch(request(),{},ctx);assert.equal(response.status,200);assert.equal(calls,1);response=await mirror.fetch(request(),{},ctx);assert.equal(calls,1);assert.equal(response.headers.get('X-Lite-Stale'),'0');
 time+=20000;failed=true;response=await mirror.fetch(request(),{},ctx);assert.equal(response.headers.get('X-Lite-Stale'),'1');assert.equal(await response.text(),'{"groups":[]}');await Promise.all(queued);
 assert.equal((await mirror.fetch(new Request('https://mirror.test/api',{method:'POST'}),{},ctx)).status,405);assert.equal((await mirror.fetch(new Request('https://mirror.test/private'),{},ctx)).status,404);assert.equal((await mirror.fetch(new Request('https://mirror.test/'),{},ctx)).status,200);
});
test('light shell stays below 30 KB with no Firebase SDK, external fonts or images',()=>{
 const files=['lite/index.html','lite/lite.css','lite/app.js'];assert.ok(files.reduce((n,f)=>n+fs.statSync(f).size,0)<30000);
 const html=fs.readFileSync(files[0],'utf8');assert.equal(html.includes('firebase'),false);assert.equal(/<img|fonts\.google|gstatic|auth-compat/.test(html),false);
});
test('an invalidated public cache cannot reuse or reinsert a pre-commit response',async()=>{
 let finish,calls=0;const fake={rpc:async()=>{calls++;if(calls===1)return await new Promise(resolve=>finish=()=>resolve({data:{version:1},error:null}));return {data:{version:2},error:null};}};
 const handler=createPublicHandler(fake,{now:()=>new Date('2026-11-19T00:00:00Z')}),request=()=>new Request('https://lms.test/?view=bootstrap');
 const old=handler(request());while(!finish)await new Promise(r=>setTimeout(r,0));handler.invalidate();assert.equal((await(await handler(request())).json()).version,2);finish();await old;
 assert.equal((await(await handler(request())).json()).version,2);assert.equal(calls,2);
});

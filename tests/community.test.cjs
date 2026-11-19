const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{PGlite}=require('@electric-sql/pglite');
const {hkdfSync,createDecipheriv}=require('node:crypto');let db,group;
const rpc=async(name,args=[])=>(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args)).rows[0].value;
before(async()=>{
 db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
 for(const f of fs.readdirSync('supabase/migrations').sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec("insert into profiles(id,name,email) values('admin','Админ','a@test'),('teacher','Учитель','t@test'),('student','Студент','s@test'),('curator','Куратор','c@test');insert into teachers values('teacher');update account_roles set role='admin' where user_id='admin';set role service_role;");
 await rpc('set_account_role',['admin','curator','curator','student']);
 group=await rpc('create_schedule_group',['admin','Тест','','',6]);
 await db.exec("insert into news_posts(id,channel,title,body,published_at) values('first','college','Первая','Текст',now()-interval '3 days'),('last','site','Последняя','Текст',now()-interval '1 day'),('future','site','Скрытая','Текст',now()+interval '1 day')");
});
after(async()=>db?.close());

test('chat counters are private, exclude own messages, and read positions never move backwards or into the future',async()=>{
 try{
 for(const user of ['student','teacher','missing']){
  await assert.rejects(rpc('curator_chat_summary',[user]),{code:'42501'});
  await assert.rejects(rpc('read_curator_chat',[user,'0']),{code:'42501'});
 }
 const own=await rpc('send_curator_message',['curator','Своё сообщение','unread-own']);assert.equal((await rpc('curator_chat_summary',['curator'])).unreadCount,0);
 const first=await rpc('send_curator_message',['admin','Не сохранять текст в сводке','unread-first']);
 let summary=await rpc('curator_chat_summary',['curator']);assert.equal(summary.unreadCount,1);assert.equal(summary.latestIncoming.id,first.id);assert.equal(summary.latestIncoming.authorName,'Админ');assert.equal(JSON.stringify(summary).includes('Не сохранять текст'),false);
 assert.equal((await rpc('read_curator_chat',['curator',own.id])).unreadCount,1);
 assert.equal((await rpc('read_curator_chat',['curator',first.id])).unreadCount,0);
 assert.equal((await rpc('read_curator_chat',['curator','0'])).lastReadId,first.id);
 assert.equal((await rpc('read_curator_chat',['curator','999999999999999999'])).lastReadId,first.id);
 await rpc('send_curator_message',['admin','Новое после прочтения','unread-later']);assert.equal((await rpc('curator_chat_summary',['curator'])).unreadCount,1);
 for(const f of ['curator_chat_summary(text)','read_curator_chat(text,bigint)'])assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') yes",[f])).rows[0].yes,false);
 assert.equal((await db.query("select has_table_privilege('authenticated','curator_chat_reads','select') yes")).rows[0].yes,false);
 }finally{await db.exec("delete from curator_messages where client_id in('unread-own','unread-first','unread-later');delete from curator_chat_reads where user_id in('admin','curator');");}
});
test('curator retains student permissions, appears in student list and can be assigned only by admin',async()=>{
 assert.ok((await db.query('select * from student_profiles')).rows.some(p=>p.id==='curator'));
 await rpc('check_result_reader',['curator',false]);
 await assert.rejects(rpc('set_account_role',['student','student','curator','student']),{code:'42501'});
 assert.equal((await rpc('registration_statistics',['admin'])).students,2);
});
test('news likes are idempotent desired states; pagination, tags and order agree and exclude future publications',async()=>{
 await assert.rejects(rpc('set_news_like',['missing','first',true]),{code:'42501'});
 await assert.rejects(rpc('set_news_like',['student','future',true]),{code:'P0002'});
 assert.equal((await rpc('set_news_like',['student','first',true])).like_count,1);
 assert.equal((await rpc('set_news_like',['student','first',true])).like_count,1);
 assert.equal((await rpc('set_news_like',['curator','first',true])).like_count,2);
 const desc=await rpc('news_feed_v2',['student','all','newest',0]),asc=await rpc('news_feed_v2',[null,'all','oldest',0]);
 assert.deepEqual(desc.rows.map(n=>n.id),asc.rows.map(n=>n.id).reverse());assert.equal(desc.rows.some(n=>n.id==='future'),false);
 assert.equal(desc.rows.find(n=>n.id==='first').liked,true);assert.equal(asc.rows.find(n=>n.id==='first').liked,false);
 assert.ok((await rpc('news_feed_v2',['student','college','newest',0])).rows.every(n=>n.channel==='college'));
 assert.equal((await rpc('set_news_like',['student','first',false])).like_count,1);
});
test('chat denies every ordinary role, retries once, sorts numeric IDs and immediately enforces revoked roles',async()=>{
 for(const u of ['student','teacher','missing']){
  await assert.rejects(rpc('curator_chat_feed',[u,null,null]),{code:'42501'});
  await assert.rejects(rpc('send_curator_message',[u,'Недоступно','nonce']),{code:'42501'});
 }
 const sent=await rpc('send_curator_message',['curator','Привет','same']);assert.deepEqual(await rpc('send_curator_message',['curator','Привет','same']),sent);
 for(let i=0;i<12;i++)await rpc('send_curator_message',['admin','Текст '+i,'msg-'+i]);
 const all=(await rpc('curator_chat_feed',['curator',null,null])).rows;assert.equal(all.length,13);assert.deepEqual(all.map(n=>+n.id),all.map(n=>+n.id).sort((a,b)=>a-b));
 assert.equal((await rpc('curator_chat_feed',['curator',null,all[8].id])).rows.length,4);
 assert.equal((await rpc('curator_chat_feed',['admin',all[8].id,null])).rows.length,8);
 await rpc('set_account_role',['admin','curator','student','curator']);await assert.rejects(rpc('curator_chat_feed',['curator',null,null]),{code:'42501'});
 await rpc('set_account_role',['admin','curator','curator','student']);
});
test('anonymous projection exposes one schedule and public news, never accounts, subscriptions, chat or mutations',async()=>{
 await rpc('save_schedule_cell',['admin',group.id,1,1,null,0,{status:'lesson',title:'Пара',teacherLabel:'Иванов И.И.',room:'12'}]);
 const publicSchedule=await rpc('guest_read',['getWeeklySchedule',{groupId:group.id}]);assert.equal(publicSchedule.cells[0].title,'Пара');
 const json=JSON.stringify(publicSchedule);for(const secret of ['created_by','teacher_id','revision','email'])assert.equal(json.includes(secret),false);
 for(const action of ['listAccounts','listCuratorMessages','setNewsLike','addNotificationSubscription','getPerson'])await assert.rejects(rpc('guest_read',[action,{}]),{code:'42501'});
 for(const f of ['curator_chat_feed(text,bigint,bigint)','guest_read(text,jsonb)','set_news_like(text,text,boolean)'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) yes',['anon',f,'execute'])).rows[0].yes,false);
 for(const table of ['curator_messages','news_likes','push_devices','push_deliveries'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) yes',['authenticated',table,'select'])).rows[0].yes,false);
});
test('push targets only opted-in announcements and subscribed schedules; personal role messages never enqueue',async()=>{
 await rpc('save_push_device',['student','https://fcm.googleapis.com/fcm/send/student','key','auth',true,false]);
 await rpc('save_push_device',['curator','https://fcm.googleapis.com/fcm/send/curator','key','auth',false,true]);
 await rpc('add_notification_subscription',['student','group',group.id,null,null]);
 await db.query("insert into notifications(id,recipient_id,category,title,context) values('schedule-notice','student','schedule','Пара изменена',$1)",[{groupId:group.id}]);
 await db.exec("insert into notifications(id,category,title) values('announcement-notice','announcement','Объявление');insert into notifications(id,recipient_id,category,title) values('role-notice','student','personal','Смена роли')");
 const jobs=await rpc('claim_browser_push');assert.equal(jobs.length,2);assert.equal((await rpc('claim_browser_push')).length,0);
 assert.equal(jobs.find(j=>j.payload.id==='schedule-notice').endpoint.endsWith('student'),true);assert.equal(jobs.find(j=>j.payload.id==='announcement-notice').endpoint.endsWith('curator'),true);
 const scheduled=jobs.find(j=>j.payload.id==='schedule-notice');await rpc('finish_browser_push',[scheduled.id,'incorrect-lease',201]);
 assert.equal((await db.query('select state from push_deliveries where id=$1',[scheduled.id])).rows[0].state,'pending');
 await rpc('finish_browser_push',[scheduled.id,scheduled.lease,201]);assert.equal((await db.query('select state from push_deliveries where id=$1',[scheduled.id])).rows[0].state,'sent');
 const expired=jobs.find(j=>j.payload.id==='announcement-notice');await rpc('finish_browser_push',[expired.id,expired.lease,410]);assert.equal((await db.query("select count(*)::int n from push_devices where user_id='curator'")).rows[0].n,0);
 await db.query("insert into notifications(id,recipient_id,category,title,context) values('unsubscribed','student','schedule','Изменение',$1)",[{groupId:group.id}]);
 await db.exec("delete from notification_subscriptions where user_id='student'");assert.equal((await rpc('claim_browser_push')).length,0);
 assert.equal((await db.query("select state from push_deliveries where notification_id='unsubscribed'")).rows[0].state,'dead');
});
test('endpoint validation denies untrusted URLs and encrypted payload independently decrypts with the browser private key',async()=>{
 const {validPushEndpoint}=await import(pathToFileURL(path.resolve('supabase/functions/lms/push.ts')));
 for(const v of ['http://fcm.googleapis.com/a','https://fcm.googleapis.com.evil.test/a','https://127.0.0.1/a','https://user@fcm.googleapis.com/a'])assert.equal(validPushEndpoint(v),false,v);
 const {encryptPush,vapid,base}=await import(pathToFileURL(path.resolve('supabase/functions/lms-push/web-push.ts')));
 const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),ua=Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)),auth=crypto.getRandomValues(new Uint8Array(16));
 const payload=JSON.stringify({title:'Расписание',body:'Изменилось'}),encrypted=Buffer.from(await encryptPush(base(ua),base(auth),payload));
 const salt=encrypted.subarray(0,16),server=encrypted.subarray(21,86);assert.equal(encrypted.readUInt32BE(16),4096);
 const serverKey=await crypto.subtle.importKey('raw',server,{name:'ECDH',namedCurve:'P-256'},false,[]),shared=Buffer.from(await crypto.subtle.deriveBits({name:'ECDH',public:serverKey},pair.privateKey,256));
 const ikm=hkdfSync('sha256',shared,auth,Buffer.concat([Buffer.from('WebPush: info\0'),ua,server]),32),key=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16),nonce=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12);
 const decrypt=createDecipheriv('aes-128-gcm',Buffer.from(key),Buffer.from(nonce));decrypt.setAuthTag(encrypted.subarray(-16));const plain=Buffer.concat([decrypt.update(encrypted.subarray(86,-16)),decrypt.final()]);assert.equal(plain.at(-1),2);assert.equal(plain.subarray(0,-1).toString(),payload);
 const signing=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',signing.privateKey),pub=base(new Uint8Array(await crypto.subtle.exportKey('raw',signing.publicKey)));
 const header=await vapid('https://fcm.googleapis.com/fcm/send/a',pub,jwk.d,'https://kteppk.github.io/lms-platform1/'),jwt=header.match(/t=([^,]+)/)[1],parts=jwt.split('.');
 assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},signing.publicKey,Buffer.from(parts[2],'base64url'),Buffer.from(parts.slice(0,2).join('.'))),true);assert.equal(JSON.parse(Buffer.from(parts[1],'base64url')).aud,'https://fcm.googleapis.com');
});

test('unread migration is repeatable and never marks newer incoming messages as read',async()=>{
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/20261119000100_curator_chat_unread.sql','utf8'));await db.exec('set role service_role');
 assert.equal((await rpc('curator_chat_summary',['curator'])).unreadCount,0);
 await rpc('send_curator_message',['admin','Новое сообщение после миграции','migration-new-message']);
 const before=await rpc('curator_chat_summary',['curator']);assert.equal(before.unreadCount,1);
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/20261119000100_curator_chat_unread.sql','utf8'));await db.exec('set role service_role');
 assert.deepEqual(await rpc('curator_chat_summary',['curator']),before);
 await rpc('set_account_role',['admin','curator','student','curator']);await assert.rejects(rpc('read_curator_chat',['curator',before.latestId]),{code:'42501'});await assert.rejects(rpc('curator_chat_summary',['curator']),{code:'42501'});await rpc('set_account_role',['admin','curator','curator','student']);
});

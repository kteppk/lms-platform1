import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createRequire,registerHooks} from 'node:module';import {pathToFileURL} from 'node:url';import {PGlite} from '@electric-sql/pglite';
import {createDatabase} from '../server/db.mjs';import {createStorage} from '../server/storage.mjs';import {createAuth} from '../server/auth.mjs';import {verifyPassword} from '../server/passwords.mjs';
const require=createRequire(new URL('../server/package.json',import.meta.url));registerHooks({resolve(s,c,next){if(s==='npm:jose@6.1.3')return {url:pathToFileURL(require.resolve('jose')).href,shortCircuit:true};return next(s,c);}});
let pg,pool,auth,db,api,files,temp,user,admin;const origin='https://lms.example.test';
const googleConfig={algorithm:'SCRYPT',signerKey:'jxspr8Ki0RYycVU8zykbdLGjFQ3McFUH0uiiTvC8pVMXAn210wjLNmdZJzxUECKbm0QsEmYUSDzZvpjeJ9WmXA==',saltSeparator:'Bw==',rounds:8,memoryCost:14};
const googlePassword={algorithm:'firebase-scrypt',hash:'lSrfV15cpx95/sZS2W9c9Kp6i/LVgQNDNC/qzrCnh1SAyZvqmZqAjTdn3aoItz+VHjoZilo78198JAdRuid5lQ==',salt:'42xEC+ixf3L2lw=='};
async function call(action,data={},session=null,requestOrigin=origin){const res=await auth.handle(new Request(origin+'/auth/'+action,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json',...(session?{Cookie:session.cookie}:{})},body:JSON.stringify(data)}),'127.0.0.1');const body=await res.json();return {status:res.status,body,cookie:res.headers.get('set-cookie')?.split(';')[0]??session?.cookie};}
async function rpc(session,action,data={}){const r=await api(new Request(origin+'/functions/v1/lms',{method:'POST',headers:{Authorization:'Bearer '+session.body.token,'Content-Type':'application/json'},body:JSON.stringify({action,data})}));return {status:r.status,body:await r.json()};}
before(async()=>{
 pg=new PGlite();await pg.exec('create role anon;create role authenticated;create role service_role bypassrls;create role lms_backend;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
 for(const f of (await fs.readdir('supabase/migrations')).sort())await pg.exec(await fs.readFile('supabase/migrations/'+f,'utf8'));await pg.exec(await fs.readFile('server/auth-schema.sql','utf8'));
 pool={query:(...a)=>pg.query(...a),connect:async()=>({query:(...a)=>pg.query(...a),release(){}})};temp=await fs.mkdtemp(path.join(os.tmpdir(),'lms-storage-test-'));files=createStorage({root:temp,secret:'test-storage-secret',publicURL:origin});db=createDatabase(pool,files.storage);auth=createAuth({pool,secret:Buffer.alloc(32,1).toString('base64'),publicURL:origin,firebaseHashConfig:googleConfig});
 const {createHandler}=await import('../supabase/functions/lms/api.ts');api=createHandler(db,auth.verify);
});
after(async()=>{await pg?.close();if(temp&&path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(temp).startsWith('lms-storage-test-'))await fs.rm(temp,{recursive:true,force:true});});
test('Firebase password verification matches Google reference and wrong passwords fail',async()=>{assert.equal(await verifyPassword('user1password',googlePassword,googleConfig),true);assert.equal(await verifyPassword('wrong',googlePassword,googleConfig),false);});
test('local registration, secure cookie, profile creation and SQL role scoping work together',async()=>{
 user=await call('signup',{email:'student@example.test',password:'StudentPassword123',persistent:true});assert.equal(user.status,200);assert.ok(user.cookie.startsWith('__Host-lms_session='));assert.equal((await auth.verify(user.body.token)).uid,user.body.user.uid);
 const p=await rpc(user,'profile',{nameFields:{firstNameRaw:'Иван',lastNameRaw:'Проверочный',patronymicRaw:'',patronymicStatus:'absent'}});assert.equal(p.status,200);assert.equal(p.body.data.role,'student');
 assert.equal((await rpc(user,'createScheduleGroup',{name:'Чужая группа',lessonsPerDay:6})).status,403);
 assert.equal((await call('login',{email:'student@example.test',password:'wrong'})).status,401);assert.equal((await call('login',{email:'student@example.test',password:'StudentPassword123'},null,'https://evil.test')).status,403);
});
test('imported Firebase credentials keep UID and password and transparently upgrade to local scrypt',async()=>{
 await pg.query('insert into app_auth.users(id,email,password) values($1,$2,$3)',['old-firebase-id','imported@example.test',JSON.stringify(googlePassword)]);
 const login=await call('login',{email:'imported@example.test',password:'user1password'});assert.equal(login.status,200);assert.equal(login.body.user.uid,'old-firebase-id');assert.equal((await pg.query("select password->>'algorithm' algorithm from app_auth.users where id='old-firebase-id'")).rows[0].algorithm,'scrypt');
});
test('SQL adapter preserves arrays, JSON, optimistic revisions and parameterized searches',async()=>{
 const bound=[];const native=createDatabase({query:async(sql,values)=>{bound.push(values);return {rows:[{value:null}]};}},null);await native.rpc('read_notifications',{p_user_id:'student',p_ids:['notice']});assert.equal(bound[0][1],'["notice"]','RPC arrays are JSONB, not native PostgreSQL arrays');
 const p=await db.from('profiles').select('id,name').eq('id',user.body.user.uid).single();assert.equal(p.data.name,'Проверочный Иван');
 await db.from('notifications').insert({id:'test-notice',recipient_id:user.body.user.uid,category:'personal',title:'Личное',context:{secret:'own'}});
 const marked=await db.rpc('read_notifications',{p_user_id:user.body.user.uid,p_ids:['test-notice']});assert.equal(marked.error,null);
 assert.equal((await db.from('profiles').select('id').eq('id',"' OR 1=1 --")).data.length,0);await assert.rejects(async()=>await db.from('profiles;drop table profiles').select('*'));
});
test('signed uploads, file checksum metadata, byte ranges and HTML download restrictions hold',async()=>{
 const key=user.body.user.uid+'/file';const grant=await files.storage.from('lms-lectures').createSignedUploadUrl(key),form=new FormData();form.append('',new Blob(['0123456789'],{type:'application/pdf'}),'document.pdf');const upload=await files.handle(new Request(grant.data.signedUrl,{method:'PUT',body:form}));assert.equal(upload.status,200);
 const link=(await files.storage.from('lms-lectures').createSignedUrls([key])).data[0].signedUrl;const range=await files.handle(new Request(link,{headers:{Range:'bytes=2-5'}}));assert.equal(range.status,206);assert.equal(await range.text(),'2345');assert.equal(range.headers.get('content-range'),'bytes 2-5/10');
 assert.equal((await files.handle(new Request(link.replace(/token=.*/, 'token=wrong')))).status,403);assert.equal((await files.storage.from('lms-lectures').info(key)).data.size,10);
 const htmlGrant=await files.storage.from('lms-lectures').createSignedUploadUrl(user.body.user.uid+'/html'),htmlForm=new FormData();htmlForm.append('',new Blob(['<script>bad</script>'],{type:'text/html'}),'test.html');await files.handle(new Request(htmlGrant.data.signedUrl,{method:'PUT',body:htmlForm}));const html=(await files.storage.from('lms-lectures').createSignedUrls([user.body.user.uid+'/html'])).data[0].signedUrl;assert.ok((await files.handle(new Request(html))).headers.get('content-disposition').startsWith('attachment'));
});
test('password changes revoke older access tokens and admin recovery is private and single-use',async()=>{
 const old=user.body.token;const reauth=await call('reauth',{email:'student@example.test',password:'StudentPassword123'},user);assert.equal(reauth.status,200);const changed=await call('password',{password:'ChangedPassword123'},user);assert.equal(changed.status,200);await assert.rejects(auth.verify(old));
 admin=await call('signup',{email:'admin@example.test',password:'AdminPassword123'});await rpc(admin,'profile',{name:'Администратор'});await pg.query("update account_roles set role='admin' where user_id=$1",[admin.body.user.uid]);
 assert.equal((await call('recover',{email:'student@example.test'})).status,200);await assert.rejects(auth.adminAction({uid:user.body.user.uid},'listRecoveryRequests',{}),e=>e.status===403);
 const list=await auth.adminAction({uid:admin.body.user.uid},'listRecoveryRequests',{});assert.equal(list.data.length,1);const issued=await auth.adminAction({uid:admin.body.user.uid},'createAccountRecovery',{userId:user.body.user.uid}),token=new URL(issued.data.url).searchParams.get('reset');
 assert.equal((await call('reset',{token,password:'RecoveredPassword123'})).status,200);assert.equal((await call('reset',{token,password:'DuplicatePassword123'})).status,400);assert.equal((await call('login',{email:'student@example.test',password:'RecoveredPassword123'})).status,200);
});

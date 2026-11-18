// Published-site QA. Uses disposable Firebase accounts; cleans only their exact IDs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto'),{chromium}=require('playwright-core');
const cli=process.env.SUPABASE_BIN;if(!cli)throw Error('Set SUPABASE_BIN.');
const base='https://kteppk.github.io/lms-platform1/',ref='qqhkuuktgzcyrkfdnjjq',run=Date.now()+'-'+randomUUID().slice(0,6),password='Check-'+randomUUID();
const output=path.resolve('.qa-output/community-live-'+run);fs.mkdirSync(output,{recursive:true});
const fixtures=[],errors=[],checks=[];let browser,before;
const quote=v=>{assert.match(v,/^[A-Za-z0-9_-]+$/);return "'"+v+"'";};
function sql(query,write=false){try{return JSON.parse(execFileSync(cli,['db','query',query,'--remote='+ref,write?'--yes':'--read-only','--output','json'],{encoding:'utf8',windowsHide:true,timeout:45000,stdio:['ignore','pipe','pipe']})).rows;}catch{throw Error('Supabase QA query failed (output suppressed).');}}
const fingerprint=()=>sql("select (select md5(coalesce(jsonb_agg(to_jsonb(c) order by id)::text,'[]')) from weekly_schedule_cells c) cells,(select md5(coalesce(jsonb_agg(to_jsonb(c) order by id)::text,'[]')) from study_groups c) groups,(select md5(coalesce(jsonb_agg(to_jsonb(c) order by id)::text,'[]')) from materials c) materials,(select md5(coalesce(jsonb_agg(to_jsonb(c) order by id)::text,'[]')) from tests c) tests")[0];
const rpc=(p,action,data={})=>p.evaluate(([action,data])=>callFunction(action,data,auth.currentUser,{fresh:true}),[action,data]);
async function section(page,tab){await page.locator('.tabs [data-tab="'+tab+'"]').evaluate(b=>b.click());}
async function newsReady(page){try{await page.locator('.news-article').first().waitFor({timeout:20000});}catch(e){const retry=page.locator('[data-news-action="retry"]');if(!await retry.count())throw e;await retry.click();await page.locator('.news-article').first().waitFor({timeout:25000});}}
async function register(role){
 const context=await browser.newContext({serviceWorkers:role==='student'?'allow':'block',viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage(),f={role,context,page,email:'lms-check-'+run+'-'+role+'@example.com'};fixtures.push(f);page.setDefaultTimeout(40000);page.on('pageerror',e=>errors.push(role+': '+e.message));
 await page.goto(base+'index.html?check='+run,{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Регистрация',exact:true}).click();await page.locator('#regFirstName').fill('Проверочный');await page.locator('#regLastName').fill('Аккаунт');await page.locator('#regEmail').fill(f.email);await page.locator('#regPassword').fill(password);await page.getByRole('button',{name:'Зарегистрироваться',exact:true}).click();
 try{await page.waitForURL('**/student.html');await page.locator('.news-article').first().waitFor();}catch(e){throw Error('Registration '+role+': '+await page.locator('#error').textContent().catch(()=>e.message));}
 f.id=await page.evaluate(()=>auth.currentUser.uid);assert.match(f.id,/^[A-Za-z0-9_-]+$/);fs.writeFileSync(path.join(output,'fixtures.json'),JSON.stringify(fixtures.map(({id,email,role})=>({id,email,role}))));
 if(role==='teacher')sql('insert into teachers(user_id) values('+quote(f.id)+')',true);
 if(role==='admin')sql("update account_roles set role='admin' where user_id="+quote(f.id),true);
 if(role==='curator')await rpc(fixtures.find(f=>f.role==='admin').page,'setAccountRole',{userId:f.id,role:'curator',expectedRole:'student'});
 if(role!=='student'){await page.goto(base+'index.html?check='+run);await page.waitForURL('**/'+(role==='curator'?'student':role)+'.html');await page.locator('.news-article').first().waitFor();}
 assert.equal((await rpc(page,'profile')).role,role);console.log('PASS real registration and cabinet: '+role);return f;
}
async function verifyGuest(){
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}}),page=await context.newPage();page.on('pageerror',e=>errors.push('guest: '+e.message));
 await page.goto(base+'guest.html?check='+run);await newsReady(page);await page.locator('#newsTag').selectOption('site');await newsReady(page);await page.locator('#newsOrder').selectOption('oldest');await newsReady(page);
 const news=await page.evaluate(()=>callFunction('listNews',{channel:'all',order:'newest'}));assert.ok(news.rows.length>0);assert.ok(news.rows.every(n=>n.liked===false));
 await section(page,'schedule');await page.locator('#scheduleGroupSelect').waitFor();const count=await page.locator('#scheduleGroupSelect option').count();assert.ok(count>=22);const group=await page.locator('#scheduleGroupSelect option').filter({hasText:'3242'}).first().getAttribute('value');await page.locator('#scheduleGroupSelect').selectOption(group);await page.locator('.schedule-week-grid').waitFor();assert.match(await page.locator('.schedule-subscriptions').textContent(),/Войдите/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,'guest-schedule.png'),fullPage:true});
 const denied=await page.request.get('https://'+ref+'.supabase.co/functions/v1/lms-public?action=listCuratorMessages');assert.equal(denied.status(),403);
 await page.goto(base+'lite/?check='+run);await page.locator('#group').waitFor();await page.screenshot({path:path.join(output,'lite.png'),fullPage:true});await context.close();checks.push('Anonymous news, filters, exact group, login requirement, light page');console.log('PASS guest and light pages');
}
async function cleanup(){
 let failed=false;
 for(const f of fixtures){try{const id=await f.page.evaluate(async email=>{const u=typeof auth==='undefined'?null:auth.currentUser;if(!u||u.email!==email)return null;const uid=u.uid;await u.delete();return uid;},f.email);if(id)f.id=id;else failed=true;}catch{failed=true;}}
 const ids=fixtures.filter(f=>f.id).map(f=>quote(f.id)).join(',');
 if(ids){try{sql(`begin;delete from curator_messages where author_id in (${ids});delete from role_changes where actor_id in (${ids}) or user_id in (${ids});delete from teachers where user_id in (${ids});delete from profiles where id in (${ids});delete from notifications where actor_id in (${ids});commit;`,true);assert.equal(sql(`select count(*)::int n from profiles where id in (${ids})`)[0].n,0);}catch{failed=true;}}
 if(failed)throw Error('Temporary-account cleanup needs attention: '+output);console.log('PASS disposable Firebase accounts and all related database rows removed');
}
(async()=>{
 before=fingerprint();browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  await verifyGuest();const student=await register('student'),teacher=await register('teacher'),admin=await register('admin'),curator=await register('curator');
  for(const f of [student,teacher]){
   assert.equal(await f.page.locator('.tabs [data-tab="curator-chat"]').count(),0);const denied=await f.page.evaluate(async()=>{try{await callFunction('listCuratorMessages');return null;}catch(e){return e.code;}});assert.equal(denied,'permission-denied');
   await section(f.page,'lectures');await f.page.locator('h2').first().waitFor();await rpc(f.page,'listMaterials',{kind:'lectures'});await rpc(f.page,'listMaterials',{kind:'books'});await section(f.page,'tests');await rpc(f.page,f.role==='student'?'listStudentTests':'listTeacherTests');
   await section(f.page,'schedule');await f.page.locator('#scheduleGroupSelect').waitFor();const group=(await rpc(f.page,'listScheduleGroups')).find(g=>g.name==='9241');await f.page.locator('#scheduleGroupSelect').selectOption(group.id);await f.page.locator('.schedule-week-grid').waitFor();await f.page.reload();await newsReady(f.page);await section(f.page,'schedule');await f.page.locator('.schedule-week-grid').waitFor();assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  checks.push('Student/teacher cabinets, existing materials/tests APIs, mobile timetable and retained selection');console.log('PASS old cabinet functions and chat access denied for student/teacher');
  await section(student.page,'home');await student.page.locator('.news-like').first().waitFor();const button=student.page.locator('.news-like').first();const post=await button.getAttribute('data-id');await button.click();await student.page.locator('.news-like[data-id="'+post+'"][aria-pressed="true"]').waitFor();await student.page.reload();await student.page.locator('.news-like[data-id="'+post+'"][aria-pressed="true"]').waitFor();await student.page.locator('.news-like[data-id="'+post+'"]').click();await student.page.locator('.news-like[data-id="'+post+'"][aria-pressed="false"]').waitFor();checks.push('Like/unlike persisted after reload');console.log('PASS real news reaction persistence');
  await section(curator.page,'curator-chat');await curator.page.locator('#chatBody').fill('Автоматическая проверка '+run);await curator.page.locator('[data-chat-form] button').click();await curator.page.getByText('Автоматическая проверка '+run,{exact:true}).waitFor();await section(admin.page,'curator-chat');await admin.page.getByText('Автоматическая проверка '+run,{exact:true}).waitFor();await curator.page.reload();await section(curator.page,'curator-chat');await curator.page.getByText('Автоматическая проверка '+run,{exact:true}).waitFor();
  await rpc(admin.page,'setAccountRole',{userId:curator.id,role:'student',expectedRole:'curator'});assert.equal(await curator.page.evaluate(async()=>{try{await callFunction('listCuratorMessages');return null;}catch(e){return e.code;}}),'permission-denied');checks.push('Private chat delivery/persistence and immediate access revocation');console.log('PASS real private chat and role revocation');
  await section(student.page,'notifications');await student.page.locator('.push-settings summary').click();await student.page.locator('[data-push-save]').waitFor();const push=await rpc(student.page,'getPushSettings',{endpoint:''});assert.match(push.publicKey,/^[A-Za-z0-9_-]{87}$/);assert.equal(await student.page.locator('[data-push-save]').isEnabled(),true);
  const deniedPush=await student.page.request.post('https://'+ref+'.supabase.co/functions/v1/lms-push',{data:{}});assert.equal(deniedPush.status(),403);checks.push('Deployed push configuration and dispatcher authentication');console.log('PASS browser notification settings and dispatcher auth');
  assert.deepEqual(errors,[]);for(const f of [student,teacher,admin])await f.page.screenshot({path:path.join(output,f.role+'.png'),fullPage:true});
 }finally{try{await cleanup();}finally{await browser?.close();}}
 assert.deepEqual(fingerprint(),before,'Existing groups, timetable cells, materials and tests must be unchanged');
 const report={url:base,version:require('../release.json').version,checkedAt:new Date().toISOString(),checks,temporaryDataRemoved:true,existingDataUnchanged:true};fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log('PASS published-site QA complete: '+output);
})().catch(e=>{console.error(e.message);console.error('QA artifacts: '+output);process.exitCode=1;});

// Production smoke check: isolated temporary accounts, read-only schedule checks.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {chromium}=require('playwright-core');
const {compile,query,canonical}=require('./import-schedule-photos.cjs');
const cli=process.argv[2];assert.ok(cli,'Supabase CLI executable required');
const base='https://kteppk.github.io/lms-platform1/';
const data=compile(),stamp=Date.now()+'-'+randomUUID().slice(0,6),password='Check-'+randomUUID();
const folder=path.join(os.tmpdir(),'lms-schedule-check-'+stamp);fs.mkdirSync(folder,{recursive:true});
const fixtures=[],errors=[],checks=[];
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const rpc=(page,action,data={})=>page.evaluate(([action,data])=>callFunction(action,data,auth.currentUser,{fresh:true}),[action,data]);
const fingerprint=()=>query(cli,"select (select count(*) from profiles)::int profiles,(select md5(coalesce(jsonb_agg(to_jsonb(s) order by id)::text,'[]')) from study_groups s) groups,(select md5(coalesce(jsonb_agg(to_jsonb(c) order by id)::text,'[]')) from weekly_schedule_cells c) cells,(select md5(coalesce(jsonb_agg(to_jsonb(x) order by user_id)::text,'[]')) from account_roles x) roles,(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'[]')) from tests x) tests,(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'[]')) from materials x) materials;")[0];
let browser,before;
async function register(role){
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();page.setDefaultTimeout(30000);
 const f={page,context,role,email:'lms-schedule-'+stamp+'-'+role+'@example.com'};fixtures.push(f);
 page.on('pageerror',e=>errors.push(role+': '+e.message));
 await page.goto(base+'?schedule-check='+stamp,{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Регистрация',exact:true}).click();
 await page.locator('#regFirstName').fill(role==='student'?'Студент':'Преподаватель');
 await page.locator('#regLastName').fill('Проверочный');
 await page.locator('#regEmail').fill(f.email);await page.locator('#regPassword').fill(password);
 await page.getByRole('button',{name:'Зарегистрироваться',exact:true}).click();
 await page.waitForURL('**/student.html');await page.getByRole('heading',{name:'Главная',exact:true}).waitFor();
 f.id=await page.evaluate(()=>auth.currentUser.uid);
 fs.writeFileSync(path.join(folder,'fixtures.json'),JSON.stringify(fixtures.map(({id,role,email})=>({id,role,email}))));
 if(role==='teacher'){
  query(cli,'insert into public.teachers(user_id) values('+quote(f.id)+');',true);
  await page.goto(base+'index.html?check='+stamp);await page.waitForURL('**/teacher.html');await page.getByRole('heading',{name:'Главная',exact:true}).waitFor();
 }
 return f;
}
async function verify(f){
 const {page,role}=f;const groups=await rpc(page,'listScheduleGroups');
 const actual=new Map();
 for(const g of groups){const key=canonical(g.name);assert.ok(!actual.has(key),'Duplicate group '+g.name);actual.set(key,g);}
 assert.equal((await rpc(page,'profile')).role,role);
 let lessons=0,free=0,unknown=0;
 for(const expected of data.groups){
  const g=actual.get(expected.key);assert.ok(g,'Missing '+expected.name);assert.equal(g.lessons_per_day,6);
  const schedule=await rpc(page,'getWeeklySchedule',{groupId:g.id});
  assert.equal(schedule.group.id,g.id);assert.equal(schedule.cells.length,expected.cells.filter(c=>c.payload).length);
  for(const c of expected.cells){
   const cell=schedule.cells.find(a=>a.weekday===c.weekday&&a.lesson_number===c.lesson);
   if(c.unknown){assert.equal(cell,undefined);unknown++;continue;}
   const p=c.payload;assert.ok(cell);assert.equal(cell.status,p.status);assert.equal(cell.title,p.title||'');assert.equal(cell.teacher_label,p.teacherLabel||'');assert.equal(cell.room,p.room||'');assert.equal(cell.note,p.note||'');
   assert.equal(cell.starts_at,null);assert.equal(cell.ends_at,null);p.status==='lesson'?lessons++:free++;
  }
 }
 assert.deepEqual({lessons,free,unknown},{lessons:data.stats.lessons,free:data.stats.free,unknown:data.stats.unknown});
 await page.locator('.tabs [data-tab="schedule"]').evaluate(el=>el.click());await page.locator('#scheduleGroupSelect').waitFor();
 for(const name of ['Н 9-01','1251','3242']){
  const g=actual.get(canonical(name));await page.locator('#scheduleGroupSelect').selectOption(g.id);
  await page.locator('.schedule-group-heading h3').filter({hasText:name}).waitFor();await page.locator('.schedule-week-grid').waitFor();
  const expect=data.groups.find(x=>x.name===name);
  const lesson=expect.cells.find(c=>c.payload?.status==='lesson');
  await page.locator('#schedule-day-'+lesson.weekday+' tbody tr').nth(lesson.lesson-1).getByText(lesson.payload.title,{exact:true}).waitFor();
  assert.equal(await page.locator('#scheduleGroupSelect option').count(),groups.length+1);
  assert.equal(await page.locator('[data-schedule="cell"]').count(),0,'Only admin can edit cells');
  for(const width of [320,390,1280]){
   await page.setViewportSize({width,height:844});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page-wide horizontal overflow at '+width);
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(folder,role+'-'+g.name.replace(/[^0-9А-Яа-я]/gu,'_')+'.png'),fullPage:true});
 }
 const selected=actual.get(canonical('3242'));
 await page.locator('#scheduleGroupSelect').selectOption(selected.id);await page.locator('.schedule-group-heading h3').filter({hasText:'3242'}).waitFor();
 await page.reload();await page.getByRole('heading',{name:'Главная',exact:true}).waitFor();
 await page.locator('.tabs [data-tab="schedule"]').evaluate(el=>el.click());await page.locator('.schedule-week-grid').waitFor();
 assert.equal(await page.locator('#scheduleGroupSelect').inputValue(),selected.id);
 assert.equal(await page.locator('#schedule-day-2 tbody tr').nth(0).getByText('Не заполнено',{exact:true}).count(),1);
 const denied=await page.evaluate(async groupId=>{try{await callFunction('saveScheduleCell',{groupId,weekday:2,lessonNumber:1,status:'free'});return null;}catch(e){return e.code;}},selected.id);
 assert.equal(denied,'permission-denied');
 checks.push({role,groups:data.groups.length,lessons,free,unknown,groupCount:groups.length,reload:true,mobileWidths:[320,390],writeDenied:true});
 console.log('PASS '+role+': 18 groups, exact cells, mobile rendering, reload, writes denied');
}
async function cleanup(){
 for(const f of fixtures){
  const uid=await f.page.evaluate(async expected=>{const a=typeof auth!=='undefined'?auth.currentUser:null;if(!a||a.email!==expected)return null;const uid=a.uid;await a.delete();return uid;},f.email);
  if(uid)f.id=uid;assert.ok(f.id,'Cannot identify temporary account');
 }
 const ids=fixtures.map(f=>{assert.match(f.id,/^[A-Za-z0-9_-]+$/);return quote(f.id);}).join(',');
 if(ids){
  query(cli,`begin;delete from public.role_changes where actor_id in (${ids}) or user_id in (${ids});delete from public.teachers where user_id in (${ids});delete from public.profiles where id in (${ids});delete from public.notifications where actor_id in (${ids});commit;`,true);
  assert.equal(query(cli,`select count(*)::int n from public.profiles where id in (${ids})`)[0].n,0);
 }
 console.log('PASS temporary Firebase and database accounts removed');
}
(async()=>{
 before=fingerprint();browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const role of ['student','teacher'])await verify(await register(role));assert.deepEqual(errors,[]);}
 finally{try{await cleanup();}finally{await browser?.close();}}
 assert.deepEqual(fingerprint(),before,'Existing accounts, schedule, roles, materials and tests unchanged by verification');
 const report={publishedURL:base,checkedAt:new Date().toISOString(),checks,temporaryAccountsRemoved:true,existingDataUnchanged:true};
 fs.writeFileSync(path.join(__dirname,'../docs/schedule-import-2026-11-17/verification.json'),JSON.stringify(report,null,2)+'\n');
 console.log('PASS published site verification complete');
})().catch(e=>{console.error(e.stderr?.toString()||e.message);console.error('Check artifacts: '+folder);process.exitCode=1;});

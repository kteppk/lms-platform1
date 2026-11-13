const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
module.exports=async({admin,teacher,student,stamp,outputDir,loginStudent})=>{
 const rpc=(p,action,data={})=>p.evaluate(([a,d])=>callFunction(a,d),[action,data]);
 const nav=(p,t)=>p.evaluate(t=>document.querySelector('.tabs [data-tab="'+t+'"]').click(),t);
 const group=await rpc(admin,'createScheduleGroup',{name:'Мобильная '+stamp,lessonsPerDay:6});
 await rpc(admin,'saveScheduleCell',{groupId:group.id,weekday:1,lessonNumber:1,status:'lesson',title:'Проверка связи '+stamp,teacherLabel:'Преподаватель',room:'12'});
 await student.evaluate(()=>navigator.serviceWorker.ready);await student.waitForFunction(()=>navigator.serviceWorker.controller!==null);
 assert.equal(await student.locator('#appUpdate').count(),0,'first install is not presented as an available update');
 await nav(student,'schedule');await student.locator('#scheduleGroupSelect').selectOption(group.id);await student.locator('.schedule-week-grid').waitFor();
 assert.equal(await student.locator('.cache-note').filter({hasText:'Обновлено:'}).count()>0,true);
 const network=await student.context().newCDPSession(student);await network.send('Network.enable');await network.send('Network.emulateNetworkConditions',{offline:false,latency:800,downloadThroughput:40000,uploadThroughput:20000,connectionType:'cellular3g'});
 await nav(student,'home');const started=Date.now();await nav(student,'schedule');await student.locator('.schedule-week-grid').waitFor();const warmMs=Date.now()-started;assert.ok(warmMs<2000,'cached timetable opens promptly on throttled 3G');
 await network.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await network.detach();console.log('PASS throttled 3G: cached timetable opened in '+warmMs+' ms');
 const title='Тест при потере связи '+stamp;
 const test=await rpc(teacher,'createTest',{title,timer:0,questions:[{type:'choice',text:'Выберите второй вариант',options:['Первый','Второй','Третий','Четвёртый'],correct:1}]});
 await nav(student,'tests');await student.locator('.item').filter({has:student.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'Пройти тест',exact:true}).click();await student.locator('#test-answers').waitFor();
 const attemptId=await student.evaluate(()=>attempt.attemptId),uid=await student.evaluate(()=>auth.currentUser.uid),email=await student.evaluate(()=>auth.currentUser.email);
 await student.context().setOffline(true);await student.getByRole('radio',{name:'Второй',exact:true}).check();await student.getByRole('button',{name:'Завершить тест',exact:true}).click();
 assert.equal(await student.getByRole('heading',{name:/Результат:/}).count(),0);assert.equal(await student.evaluate(id=>JSON.parse(AppConnection.draftStorage().getItem('lms-attempt-'+auth.currentUser.uid+'-'+id)).answers[0],attemptId),1);
 await student.reload({waitUntil:'domcontentloaded'});await student.locator('#connectionRecovery').waitFor();await student.getByRole('link',{name:'Сохранённое расписание',exact:true}).click();await student.locator('#offlineSchedule .schedule-week-grid').waitFor();
 assert.match(await student.locator('#offlineSchedule').textContent(),new RegExp('Проверка связи '+stamp));assert.match(await student.locator('#offlineSchedule .cache-note').textContent(),/Актуальность не подтверждена/);
 if(outputDir){fs.mkdirSync(outputDir,{recursive:true});await student.setViewportSize({width:390,height:844});assert.equal(await student.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await student.screenshot({path:path.join(outputDir,'offline-schedule-mobile.png'),fullPage:true});await student.setViewportSize({width:1280,height:900});}
 const cachedRequests=await student.evaluate(async()=>{const result=[];for(const name of await caches.keys())for(const req of await(await caches.open(name)).keys())result.push({url:req.url,method:req.method,authorization:req.headers.get('authorization')});return result;});
 assert.ok(cachedRequests.some(r=>r.url.includes('vendor/firebase/')));assert.ok(cachedRequests.every(r=>r.method==='GET'&&!r.authorization&&!r.url.includes('/functions/v1/')&&!r.url.includes('/storage/v1/')));
 await student.context().setOffline(false);await student.goto(new URL('index.html',student.url()).href);await student.waitForURL('**/student.html');await student.locator('#test-answers').waitFor();
 assert.equal(await student.evaluate(()=>attempt.attemptId),attemptId);assert.equal(await student.getByRole('radio',{name:'Второй',exact:true}).isChecked(),true);await student.getByRole('button',{name:'Завершить тест',exact:true}).click();await student.getByRole('heading',{name:'Результат: 1 из 1 (100%)',exact:true}).waitFor();
 const results=await rpc(student,'listResults');assert.ok(results.rows.some(r=>r.attemptId===attemptId||r.id===attemptId));
 // One reconnect must neither create a second attempt nor submit an offline queue.
 assert.equal((await rpc(student,'getTestResults',{testId:test.id,mode:'all'})).rows.length,1);
 console.log('PASS cached static shell/SDK and dated offline timetable; offline answers survive reload, reconnect resumes the same attempt and server grades exactly once; no API/token/file cache');
 if(loginStudent){
  await student.evaluate(()=>logout());await student.waitForURL('**/index.html');
  const keys=await student.evaluate(()=>[...Object.keys(localStorage),...Object.keys(sessionStorage)]);assert.ok(!keys.some(k=>k.startsWith('lms-reference-v1:')||k.startsWith('lms-attempt-'+uid)));
  await student.goto(new URL('offline.html',student.url()).href);await student.locator('#offlineSchedule .empty-state').waitFor();
  await student.goto(new URL('index.html',student.url()).href);
  if(new URL(student.url()).hostname==='127.0.0.1'){
    await student.getByRole('button',{name:'Забыли пароль?',exact:true}).click();await student.locator('#resetEmail').fill(email);await student.getByRole('button',{name:'Отправить ссылку',exact:true}).click();await student.locator('#resetStatus').filter({hasText:'Если аккаунт'}).waitFor();await student.getByRole('button',{name:'Закрыть',exact:true}).click();
  }
  await loginStudent(student,false);
  await nav(student,'schedule');await student.locator('#scheduleGroupSelect').selectOption(group.id);await student.locator('.schedule-week-grid').waitFor();
  assert.equal(await student.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('lms-reference-v1:'))),false);assert.equal(await student.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('lms-reference-v1:'))),true);
  console.log('PASS logout removes account cache/drafts; remembered login and shared-device session are explicit; password reset checked only against local Auth Emulator');
 }
};

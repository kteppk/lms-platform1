const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
module.exports=async({admin,teacher,student,other,stamp,outputDir})=>{
 const rpc=(p,action,data={})=>p.evaluate(([a,d])=>callFunction(a,d).then(data=>({data}),e=>({code:e.code})),[action,data]);
 const nav=(p,t)=>p.evaluate(t=>document.querySelector('.tabs [data-tab="'+t+'"]').click(),t);
 const first=(await rpc(admin,'createScheduleGroup',{name:'Колокольчик '+stamp,lessonsPerDay:6})).data,second=(await rpc(admin,'createScheduleGroup',{name:'Колокольчик '+stamp+'0',lessonsPerDay:6})).data;assert.ok(first?.id&&second?.id);
 async function open(p,group){await nav(p,'schedule');await p.locator('#scheduleGroupSelect').waitFor();await p.locator('[data-schedule="refresh"]').click();await p.locator('#scheduleGroupSelect option[value="'+group.id+'"]').waitFor({state:'attached'});await p.locator('#scheduleGroupSelect').selectOption(group.id);await p.locator('.schedule-week-grid').waitFor();await p.locator('.schedule-subscriptions .subscription-bell').waitFor();}
 await open(student,first);const bell=student.locator('.schedule-subscriptions .subscription-bell');
 assert.equal(await student.locator('.schedule-day-links').count(),0);assert.equal(await student.locator('.schedule-group-heading .badge').count(),0);assert.equal(await student.locator('.schedule-day-table').count(),6);
 assert.equal((await rpc(student,'listNotificationSubscriptions')).data.length,0);assert.equal(await bell.getAttribute('aria-pressed'),'false');assert.equal(await bell.getAttribute('title'),'Подписаться на расписание');
 await bell.click();await student.locator('.schedule-subscriptions .subscription-bell[aria-pressed="true"]').waitFor();
 assert.equal(await bell.locator('.subscription-bell-slash').count(),1);assert.match(await bell.getAttribute('class'),/is-subscribed/);assert.equal(await bell.getAttribute('title'),'Отписаться от расписания');await student.locator('#toastRegion').filter({hasText:'Вы подписались на расписание'}).waitFor();
 const color=await bell.evaluate(n=>getComputedStyle(n).color);assert.match(color,/rgb/);const rgb=color.match(/\d+/g).map(Number);assert.ok(rgb[0]>rgb[1]&&rgb[0]>rgb[2]);
 const target=await bell.boundingBox();assert.ok(target.width>=44&&target.height>=44);
 const sub=(await rpc(student,'listNotificationSubscriptions')).data[0];assert.equal(sub.scope,'group');await rpc(other,'removeNotificationSubscription',{id:sub.id});assert.equal((await rpc(student,'listNotificationSubscriptions')).data.length,1);
 assert.equal((await rpc(student,'addNotificationSubscription',{scope:'subject',groupId:first.id,subjectTitle:'Математика'})).code,'invalid-argument');assert.equal((await rpc(teacher,'addNotificationSubscription',{scope:'mine'})).code,'invalid-argument');
 await student.locator('.schedule-subscription-help summary').click();assert.match(await student.locator('.schedule-subscription-help').textContent(),/повторно/);assert.match(await student.locator('.schedule-subscription-help').textContent(),/сохранённой копии/);
 await open(teacher,second);await teacher.locator('.schedule-subscriptions .subscription-bell').click();await teacher.locator('.schedule-subscriptions .subscription-bell[aria-pressed="true"]').waitFor();
 const notices=async p=>(await rpc(p,'listNotifications')).data.rows.filter(n=>n.category==='schedule');const countS=(await notices(student)).length,countT=(await notices(teacher)).length;
 const cell=(await rpc(admin,'saveScheduleCell',{groupId:first.id,weekday:2,lessonNumber:2,status:'lesson',title:'Пара по подписке',room:'20'})).data;assert.ok(cell.id);
 assert.equal((await notices(student)).length,countS+1);assert.equal((await notices(teacher)).length,countT);
 await rpc(admin,'saveScheduleCell',{groupId:second.id,weekday:2,lessonNumber:2,status:'free'});assert.equal((await notices(student)).length,countS+1);assert.equal((await notices(teacher)).length,countT+1);
 if(outputDir){fs.mkdirSync(outputDir,{recursive:true});await student.setViewportSize({width:390,height:844});await student.locator('#toastRegion').evaluate(n=>n.replaceChildren());assert.equal(await student.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await student.screenshot({path:path.join(outputDir,'schedule-bell-mobile.png'),fullPage:true});await student.setViewportSize({width:1280,height:900});}
 await bell.click();await student.locator('.schedule-subscriptions .subscription-bell[aria-pressed="false"]').waitFor();assert.equal(await bell.locator('.subscription-bell-slash').count(),0);
 await rpc(admin,'saveScheduleCell',{groupId:first.id,weekday:2,lessonNumber:2,id:cell.id,revision:cell.revision,status:'free'});assert.equal((await notices(student)).length,countS+1);
 await teacher.evaluate(()=>Portal.openSubscriptions());await teacher.locator('.subscription-list').waitFor();assert.equal(await teacher.locator('#subScope,#subSubject,#subscriptionDialog').count(),0);assert.equal(await teacher.getByText('Моё расписание преподавателя',{exact:true}).count(),0);
 await teacher.locator('.subscription-list .subscription-bell').click();await teacher.locator('.subscription-list .empty-state').waitFor();assert.equal((await rpc(teacher,'listNotificationSubscriptions')).data.length,0);
 console.log('PASS group-only bell: compact target, red/slashed active state, toast, help, private exact-group delivery, unsubscribe in both cabinets and no weekly/day controls');
};

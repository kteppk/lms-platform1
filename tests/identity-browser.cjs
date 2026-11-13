const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
// Caller supplies isolated accounts and removes all fixture-owned rows/files.
module.exports=async({admin,teacher,student,other,stamp,outputDir})=>{
  const rpc=(page,action,data={})=>page.evaluate(([a,d])=>callFunction(a,d).then(data=>({data}),e=>({code:e.code,message:e.message})),[action,data]);
  const nav=async(page,tab)=>page.evaluate(tab=>document.querySelector('.tabs [data-tab="'+tab+'"]').click(),tab);
  const home=page=>page.getByRole('heading',{name:'Рабочие разделы',exact:true});
  await nav(student,'profile');await student.locator('#profileFirstName').waitFor();
  const initial=(await rpc(student,'profile')).data;assert.equal(initial.nameConfirmed,true);assert.equal(initial.needsNameReview,false);
  assert.equal(await student.locator('#profileFirstName').inputValue(),initial.firstNameRaw);
  await student.locator('#profileFirstName').fill('йоан');await student.locator('#profileLastName').fill('Салчак-оол');await student.locator('#profilePatronymic').fill('');
  await student.getByRole('button',{name:'Сохранить ФИО',exact:true}).click();
  await student.locator('#userName').filter({hasText:'Салчак-оол йоан'}).waitFor();
  await student.reload();await home(student).waitFor();await nav(student,'profile');await student.locator('#profileFirstName').waitFor();
  assert.equal(await student.locator('#profileFirstName').inputValue(),'йоан');assert.equal(await student.locator('#profilePatronymic').inputValue(),'');
  const saved=(await rpc(student,'profile')).data;assert.equal(saved.patronymicStatus,'unknown');assert.equal(saved.needsNameReview,false);
  await student.locator('#profileLastName').fill('123😀');await student.getByRole('button',{name:'Сохранить ФИО',exact:true}).click();
  await student.locator('[data-name-error="last"]').filter({hasText:'без цифр и эмодзи'}).waitFor();assert.equal((await rpc(student,'profile')).data.lastNameRaw,'Салчак-оол');
  await student.locator('#profileLastName').fill('Салчак-оол');await student.locator('#profileNoPatronymic').check();
  await student.locator('#toastRegion').evaluate(e=>e.replaceChildren());
  await student.getByRole('button',{name:'Сохранить ФИО',exact:true}).click();
  await student.waitForFunction(()=>document.querySelector('#toastRegion')?.textContent.includes('ФИО сохранено'));
  const absent=(await rpc(student,'profile')).data;assert.equal(absent.patronymicStatus,'absent');assert.equal(absent.patronymicRaw,null);
  await rpc(student,'updateMyProfile',{firstNameRaw:'Юрий',lastNameRaw:'Салчак-оол',patronymicRaw:null,patronymicStatus:'absent',nameRevision:absent.nameRevision});
  await student.locator('#profileFirstName').fill('Не сохранять');await student.getByRole('button',{name:'Сохранить ФИО',exact:true}).click();
  await student.locator('#status').filter({hasText:'уже изменены'}).waitFor();assert.equal(await student.locator('#profileFirstName').inputValue(),'Не сохранять');
  await nav(student,'home');await home(student).waitFor();await nav(student,'profile');await student.locator('#profileFirstName').waitFor();
  assert.equal(await student.locator('#profileFirstName').inputValue(),'Юрий');
  console.log('PASS structured names: raw spelling, initial й, optional/absent patronymic, reload persistence, invalid input and stale-write recovery');

  const otherProfile=(await rpc(other,'profile')).data,otherId=otherProfile.uid;
  await nav(admin,'accounts');await admin.getByLabel('Поиск по ФИО или email').fill(otherProfile.email);await admin.getByRole('button',{name:'Найти',exact:true}).click();
  await admin.getByRole('combobox',{name:'Роль '+otherProfile.email,exact:true}).selectOption('student');
  await admin.locator('[data-portal="role-save"][data-id="'+otherId+'"]').click();
  await admin.locator('[data-role-id="'+otherId+'"] option[value="student"][selected]').waitFor({state:'attached'});
  const roleNotices=(await rpc(other,'listNotifications')).data.rows.filter(n=>n.title==='Ваш доступ обновлён');assert.ok(roleNotices.length);assert.match(roleNotices[0].body,/кабинет студента/);
  for(const page of [student,teacher])assert.equal((await rpc(page,'listNotifications')).data.rows.some(n=>roleNotices.some(r=>r.id===n.id)),false);
  await admin.locator('.role-log summary').click();await admin.getByRole('button',{name:'Загрузить историю',exact:true}).click();
  await admin.locator('#roleChangeLog').filter({hasText:otherProfile.name}).waitFor();assert.equal((await rpc(student,'listRoleChanges')).code,'permission-denied');
  await rpc(admin,'setAccountRole',{userId:otherId,role:'teacher',expectedRole:'student'});
  await other.goto(new URL('index.html',other.url()).href);await other.waitForURL('**/teacher.html');await home(other).waitFor();
  console.log('PASS role changes: owner-only welcome, administrator-only audit and no messages to unrelated accounts');

  const first=(await rpc(admin,'createScheduleGroup',{name:'Подписки '+stamp,lessonsPerDay:6})).data;
  const second=(await rpc(admin,'createScheduleGroup',{name:'Подписки '+stamp+'0',lessonsPerDay:6})).data;
  assert.ok(first?.id&&second?.id);
  const teacherId=(await rpc(teacher,'profile')).data.uid;
  await nav(student,'schedule');await student.locator('#scheduleGroupSelect').selectOption(first.id);await student.locator('.schedule-week-grid').waitFor();
  assert.equal((await rpc(student,'listNotificationSubscriptions')).data.length,0,'reading a group does not subscribe');
  await student.getByRole('button',{name:'Выбрать предмет',exact:true}).click();await student.locator('#subDialogTitle').fill('Математика');
  await student.locator('#subscriptionDialog [type="submit"]').click();await student.locator('#subscriptionDialog').waitFor({state:'hidden'});
  const subjectSub=(await rpc(student,'listNotificationSubscriptions')).data[0];assert.equal(subjectSub.scope,'subject');
  assert.equal((await rpc(student,'addNotificationSubscription',{scope:'mine'})).code,'permission-denied');
  await rpc(other,'removeNotificationSubscription',{id:subjectSub.id});assert.equal((await rpc(student,'listNotificationSubscriptions')).data.length,1);
  await teacher.evaluate(()=>Portal.openSubscriptions());await teacher.getByRole('heading',{name:'Мои подписки',exact:true}).waitFor();
  await teacher.getByRole('button',{name:'Уведомлять о моих занятиях',exact:true}).click();await teacher.getByRole('button',{name:'Отключить мои занятия',exact:true}).waitFor();
  const changes=async page=>(await rpc(page,'listNotifications')).data.rows.filter(n=>n.category==='schedule');
  const save=async(group,cell,previous=null)=>(await rpc(admin,'saveScheduleCell',{groupId:group.id,weekday:2,lessonNumber:2,id:previous?.id??null,revision:previous?.revision??0,...cell})).data;
  await save(second,{status:'lesson',title:'Математика',teacherId,room:'20'});
  assert.equal((await changes(student)).length,0);assert.equal((await changes(teacher)).length,1);assert.equal((await changes(other)).length,0);
  const original=await save(first,{status:'lesson',title:'Математика',teacherId,room:'12'});assert.ok(original?.id);
  assert.equal((await changes(student)).length,1);assert.equal((await changes(teacher)).length,2);
  const replaced=await save(first,{status:'lesson',title:'Физика',teacherId:null,room:'26'},original);
  assert.equal((await changes(student)).length,2,'replacing the subscribed subject sends a cancellation/replacement');
  assert.equal((await changes(teacher)).length,3,'old instructor is notified of the change');
  const irrelevant=await save(first,{status:'lesson',title:'Физика',teacherId:null,room:'27'},replaced);
  assert.equal((await changes(student)).length,2);assert.equal((await changes(teacher)).length,3);
  await student.getByRole('button',{name:'Подписаться на группу',exact:true}).click();
  const before=(await changes(student)).length;
  const overlap=await save(first,{status:'lesson',title:'Математика',teacherId,room:'20'},irrelevant);
  assert.equal((await changes(student)).length,before+1,'overlapping group+subject subscriptions deliver once');
  const personalTeacherNotice=(await changes(teacher))[0];await rpc(student,'readNotifications',{ids:[personalTeacherNotice.id]});
  assert.equal((await changes(teacher)).find(n=>n.id===personalTeacherNotice.id).read,false);
  await student.evaluate(()=>Portal.openSubscriptions());await student.getByRole('heading',{name:'Мои подписки',exact:true}).waitFor();
  if(outputDir){fs.mkdirSync(outputDir,{recursive:true});await student.setViewportSize({width:390,height:844});await student.screenshot({path:path.join(outputDir,'subscriptions-mobile.png'),fullPage:true});await student.setViewportSize({width:1440,height:1000});}
  while(await student.getByRole('button',{name:'Отписаться',exact:true}).count()){
    const count=await student.getByRole('button',{name:'Отписаться',exact:true}).count();await student.getByRole('button',{name:'Отписаться',exact:true}).first().click();
    await student.waitForFunction(n=>document.querySelectorAll('[data-sub-action="remove"]').length<n,count);
  }
  const past=(await changes(student)).length;await save(first,{status:'free'},overlap);assert.equal((await changes(student)).length,past);
  const notice=(await changes(student))[0];await nav(student,'notifications');
  await student.locator('[data-portal="notice-open"][data-id="'+notice.id+'"]').click();await student.locator('.schedule-week-grid').waitFor();
  assert.equal(await student.locator('#scheduleGroupSelect').inputValue(),first.id);
  assert.equal((await changes(other)).length,0);
  console.log('PASS opt-in subscriptions: exact group, subject replacements, own lessons, overlap deduplication, owner-only settings, unsubscribe and correct deep link');
  if(outputDir){
    for(const [role,page] of [['admin',admin],['teacher',teacher],['student',student]]){
      await page.setViewportSize({width:1440,height:1000});await nav(page,'home');await home(page).waitFor();await page.locator('#toastRegion').evaluate(e=>e.replaceChildren());
      await page.screenshot({path:path.join(outputDir,role+'-home.png'),fullPage:true});
      await page.setViewportSize({width:390,height:844});await nav(page,'profile');await page.locator('#profileFirstName').waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(outputDir,role+'-profile-mobile.png'),fullPage:true});
    }
  }
};

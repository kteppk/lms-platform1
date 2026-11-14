const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
// Caller supplies isolated accounts and removes all fixture-owned rows/files.
module.exports=async({admin,teacher,student,other,stamp,outputDir})=>{
  const rpc=(page,action,data={})=>page.evaluate(([a,d])=>callFunction(a,d).then(data=>({data}),e=>({code:e.code,message:e.message})),[action,data]);
  const nav=async(page,tab)=>page.evaluate(tab=>document.querySelector('.tabs [data-tab="'+tab+'"]').click(),tab);
  const home=page=>page.getByRole('heading',{name:'Главная',exact:true});
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

  await require('./schedule-subscriptions-browser.cjs')({teacher,student,other,admin,stamp,outputDir});
  if(outputDir){
    for(const [role,page] of [['admin',admin],['teacher',teacher],['student',student]]){
      await page.setViewportSize({width:1440,height:1000});await nav(page,'home');await home(page).waitFor();await page.locator('#toastRegion').evaluate(e=>e.replaceChildren());
      await page.screenshot({path:path.join(outputDir,role+'-home.png'),fullPage:true});
      await page.setViewportSize({width:390,height:844});await nav(page,'profile');await page.locator('#profileFirstName').waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(outputDir,role+'-profile-mobile.png'),fullPage:true});
    }
  }
};

const assert=require('node:assert/strict');
const path=require('node:path');
module.exports=async({admin,teacher,student,stamp,screenshotDir})=>{
  const rpc=(page,action,data={})=>page.evaluate(([a,d])=>callFunction(a,d).then(data=>({data}),e=>({code:e.code,message:e.message})),[action,data]);
  const nav=async(page)=>{await page.evaluate(()=>document.querySelector('.tabs [data-tab="schedule"]').click());await page.locator('#scheduleGroupSelect').waitFor();};
  const select=async(page,id)=>{await page.locator('#scheduleGroupSelect').selectOption(id);await page.locator('.schedule-week-grid').waitFor();};
  const slot=page=>page.locator('[data-schedule="cell"][data-day="1"][data-number="4"]');
  const title='Занятие проверки '+stamp,foreign='Другая группа '+stamp;
  const teacherName=(await rpc(teacher,'profile')).data.name;
  await admin.setViewportSize({width:390,height:844});
  await nav(admin);await admin.getByRole('button',{name:'Действия с расписанием',exact:true}).click();await admin.getByRole('button',{name:'+ Добавить группу',exact:true}).click();
  await admin.getByLabel('Номер / название группы',{exact:true}).fill('Проверка '+stamp);
  await admin.getByLabel('Курс',{exact:true}).fill('4');
  await admin.getByLabel('Специальность',{exact:true}).fill('Информационные системы и программирование');
  await admin.locator('dialog button[type="submit"]').click();
  await admin.locator('dialog[open]').waitFor({state:'hidden'});
  await admin.locator('.schedule-group-heading h3').filter({hasText:'Проверка '+stamp}).waitFor();
  await admin.locator('.schedule-week-grid').waitFor();
  const groupId=await admin.locator('#scheduleGroupSelect').inputValue();
  const second=(await rpc(admin,'createScheduleGroup',{name:'Проверка '+stamp+'0',lessonsPerDay:6})).data;
  assert.ok(second?.id);
  await rpc(admin,'saveScheduleCell',{groupId:second.id,weekday:1,lessonNumber:4,status:'lesson',title:foreign});
  for(const page of [teacher,student]){
    assert.equal((await rpc(page,'createScheduleGroup',{name:'Запрет'})).code,'permission-denied');
    assert.equal((await rpc(page,'saveScheduleCell',{groupId,weekday:1,lessonNumber:1,status:'free'})).code,'permission-denied');
    assert.equal((await rpc(page,'getWeeklySchedule',{})).code,'invalid-argument');
  }
  await slot(admin).click();
  await admin.getByLabel('Предмет',{exact:true}).fill(title);
  await admin.getByLabel('Преподаватель',{exact:true}).fill(teacherName);
  await admin.getByLabel('Аудитория',{exact:true}).fill('13');
  await admin.locator('dialog button[type="submit"]').click();
  await slot(admin).filter({hasText:title}).waitFor();
  for(const page of [teacher,student]){
    await page.setViewportSize({width:390,height:844});await nav(page);await select(page,groupId);
    await page.locator('.schedule-week-grid strong').filter({hasText:title}).waitFor();
    assert.equal(await page.locator('.schedule-week-grid').getByText(foreign,{exact:true}).count(),0);
    assert.equal(await page.locator('[data-schedule="cell"]').count(),0);
    assert.equal(await page.locator('.schedule-week-grid .schedule-day-table').count(),6);
    assert.equal(await page.locator('.schedule-week-grid .schedule-cell').count(),36);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const response=(await rpc(page,'getWeeklySchedule',{groupId})).data;
    assert.equal(response.cells.length,1);assert.equal(response.cells[0].title,title);assert.equal(response.cells[0].teacher_label,teacherName);assert.equal(response.cells[0].starts_at,null);
    assert.equal((await rpc(page,'listSchedule',{from:'2026-11-09',to:'2026-11-15'})).data.requiresGroup,true);
  }
  await admin.reload();await admin.getByRole('heading',{name:'Главная',exact:true}).waitFor();await nav(admin);
  await slot(admin).filter({hasText:title}).waitFor();assert.equal(await admin.locator('#scheduleGroupSelect').inputValue(),groupId);
  await slot(admin).click();
  assert.equal(await admin.getByLabel('Аудитория',{exact:true}).inputValue(),'13');
  const previous=(await rpc(admin,'getWeeklySchedule',{groupId})).data.cells[0];
  const changed=await rpc(admin,'saveScheduleCell',{groupId,weekday:1,lessonNumber:4,status:'lesson',title,room:'20',id:previous.id,revision:previous.revision});assert.ok(changed.data);
  await admin.getByLabel('Аудитория',{exact:true}).fill('99');
  await admin.locator('dialog button[type="submit"]').click();
  await admin.locator('dialog .schedule-error:not([hidden])').waitFor();
  assert.equal(await admin.getByLabel('Аудитория',{exact:true}).inputValue(),'99','conflict retains unsaved editor values');
  await admin.getByRole('button',{name:'Закрыть и обновить расписание',exact:true}).click();
  await slot(admin).filter({hasText:'20'}).waitFor();
  await slot(admin).click();await admin.getByRole('radio',{name:'Нет пары',exact:true}).check();
  assert.equal(await admin.locator('#scheduleLessonFields').isVisible(),false);
  await admin.locator('dialog button[type="submit"]').click();
  await slot(admin).filter({hasText:'Нет пары'}).waitFor();
  for(const page of [teacher,student]){
    await page.reload();await page.getByRole('heading',{name:'Главная',exact:true}).waitFor();await nav(page);
    await page.locator('#schedule-day-1 tbody tr').nth(3).getByText('Нет пары',{exact:true}).waitFor();
    assert.equal(await page.locator('#scheduleGroupSelect').inputValue(),groupId);
    assert.equal(await page.locator('#schedule-day-1 tbody tr').nth(0).getByText('Не заполнено',{exact:true}).count(),1);
    const cell=(await rpc(page,'getWeeklySchedule',{groupId})).data.cells[0];assert.equal(cell.status,'free');assert.equal(cell.title,'');
    await select(page,second.id);await page.locator('.schedule-week-grid strong').filter({hasText:foreign}).waitFor();
    assert.equal(await page.locator('.schedule-week-grid').getByText(title,{exact:true}).count(),0);
    await select(page,groupId);
  }
  await slot(admin).click();await admin.getByRole('radio',{name:'Занятие',exact:true}).check();
  await admin.getByLabel('Предмет',{exact:true}).fill('Не сохранять');await admin.getByRole('button',{name:'Отмена',exact:true}).click();
  assert.equal((await rpc(admin,'getWeeklySchedule',{groupId})).data.cells[0].status,'free');
  if(screenshotDir){require('node:fs').mkdirSync(screenshotDir,{recursive:true});for(const [role,page] of [['student',student],['teacher',teacher],['admin',admin]])await page.screenshot({path:path.join(screenshotDir,role+'-weekly.png'),fullPage:true});}
  for(const page of [admin,teacher,student])await page.setViewportSize({width:1280,height:900});
  console.log('PASS recurring timetable: admin cell editor/No pair/cancel/conflict; exact group isolation; both cabinets; reload persistence; mobile layout');
  return {groupId,otherGroupId:second.id};
};

const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
module.exports=async({admin,teacher,student,other,outputDir})=>{
 const rpc=(p,action,data={})=>p.evaluate(([a,d])=>callFunction(a,d),[action,data]);
 const baseline=(await rpc(other,'listNotifications')).unreadCount;
 for(const [role,page] of [['student',student],['teacher',teacher],['admin',admin]]){
  await page.evaluate(()=>document.querySelector('.tabs [data-tab="home"]').click());await page.getByRole('heading',{name:'Новости',exact:true}).waitFor();
  assert.equal(await page.locator('[data-news-action="refresh-home"]').isVisible(),false);
  await page.getByRole('button',{name:'Действия с новостями',exact:true}).click();await page.getByRole('button',{name:'Обновить новости',exact:true}).waitFor();await page.keyboard.press('Escape');
  for(const width of [320,360,390,430,600,768,1024,1440]){
   await page.setViewportSize({width,height:900});await page.locator('#notificationButton').click();const dialog=page.locator('#notificationsDialog');await dialog.locator('.notice-card').first().waitFor();
   const close=dialog.locator('[data-portal="close-dialog"]'),toggle=dialog.locator('.dialog-heading [data-action-menu-toggle]');
   assert.equal((await close.textContent()).trim(),'');assert.equal(await close.getAttribute('aria-label'),'Закрыть уведомления');
   const size=await close.boundingBox();assert.ok(size.width>=44&&size.width<=48&&size.height>=44&&size.height<=48);
   const rgb=(await close.evaluate(n=>getComputedStyle(n).color)).match(/\d+/g).map(Number);assert.ok(rgb[0]>rgb[1]&&rgb[0]>rgb[2]);
   assert.equal(await dialog.locator('[data-portal="subscriptions"]').isVisible(),false);assert.equal(await dialog.locator('[data-portal="notice-open"]').first().isVisible(),true);
   await toggle.click();const panel=dialog.locator('.dialog-heading .action-menu-panel');await panel.waitFor();
   const bounds=await panel.boundingBox();assert.ok(bounds.x>=8&&bounds.x+bounds.width<=width-8);assert.ok(bounds.y>=0&&bounds.y+bounds.height<=900);
   await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});assert.equal(await dialog.evaluate(n=>n.open),true);assert.equal(await toggle.evaluate(n=>document.activeElement===n),true);
   await page.keyboard.press('Escape');assert.equal(await dialog.evaluate(n=>n.open),false);
  }
  await page.setViewportSize({width:390,height:844});await page.locator('#notificationButton').click();const dialog=page.locator('#notificationsDialog');await dialog.locator('.notice-card').first().waitFor();
  const ids=await dialog.locator('[data-portal="notice-open"]').evaluateAll(nodes=>nodes.map(n=>n.dataset.id));
  await dialog.locator('.dialog-heading [data-action-menu-toggle]').click();await dialog.getByRole('button',{name:'Прочитать эту страницу',exact:true}).click();
  await dialog.locator('.notice-card.unread').first().waitFor({state:'detached'});const feed=await rpc(page,'listNotifications');assert.ok(ids.every(id=>feed.rows.find(n=>n.id===id)?.read));
  await page.waitForFunction(()=>document.querySelector('#notificationsDialog [data-portal="notices-read-page"]').disabled);
  await dialog.locator('.dialog-heading [data-action-menu-toggle]').click();await dialog.getByRole('heading',{name:'Уведомления',exact:true}).click();assert.equal(await dialog.locator('.dialog-heading .action-menu-panel').isVisible(),false);
  if(outputDir){fs.mkdirSync(outputDir,{recursive:true});await page.locator('#toastRegion').evaluate(n=>n.replaceChildren());await page.screenshot({path:path.join(outputDir,role+'-notifications-compact.png')});await dialog.locator('.dialog-heading [data-action-menu-toggle]').click();await page.screenshot({path:path.join(outputDir,role+'-notifications-menu.png')});await page.keyboard.press('Escape');}
  await dialog.locator('[data-portal="close-dialog"]').click();assert.equal(await dialog.evaluate(n=>n.open),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#notificationButton').click();await dialog.locator('.dialog-heading [data-action-menu-toggle]').click();
  assert.equal(await dialog.getByRole('button',{name:'Прочитать эту страницу',exact:true}).isDisabled(),true);
  await dialog.getByRole('button',{name:'Мои подписки',exact:true}).click();await page.getByRole('heading',{name:'Мои подписки',exact:true}).waitFor();assert.equal(await dialog.evaluate(n=>n.open),false);
  await page.locator('#notificationButton').click();await dialog.locator('.dialog-heading [data-action-menu-toggle]').click();await dialog.getByRole('button',{name:'Вся история',exact:true}).click();
  await page.locator('#portalPage').getByRole('heading',{name:'Уведомления',exact:true}).waitFor();assert.equal(await dialog.evaluate(n=>n.open),false);
  await page.setViewportSize({width:1280,height:900});
 }
 assert.equal((await rpc(other,'listNotifications')).unreadCount,baseline);
 console.log('PASS compact notifications for three roles/eight widths: red icon close, hidden secondary actions, viewport-safe menu, Escape/focus/outside click, correct popup read scope and unchanged foreign read state');
};

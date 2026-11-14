const assert=require('node:assert/strict');
const version=require('../release.json').version;
const fs=require('node:fs');const path=require('node:path');
// Accounts and all created rows belong to the caller's isolated fixtures.
module.exports=async({admin,teacher,student,other,stamp,outputDir})=>{
 const rpc=(page,action,data={})=>page.evaluate(([a,d])=>callFunction(a,d).then(data=>({data}),e=>({code:e.code,message:e.message})),[action,data]);
 const nav=(page,tab)=>page.evaluate(t=>document.querySelector('.tabs [data-tab="'+t+'"]').click(),tab);
 const pages=[admin,teacher,student];
 for(const p of pages){
  await nav(p,'home');await p.getByRole('heading',{name:'Новости',exact:true}).waitFor();assert.equal(await p.locator('[data-news-feed]').count(),1);
  assert.equal(await p.locator('.tabs [data-tab="books"]').count(),0);assert.equal(await p.locator('.tabs [data-site-version]').textContent(),'Версия '+version);
 }
 const totals=(await rpc(admin,'registrationStatistics')).data;assert.equal(totals.total,totals.students+totals.teachers+totals.admins);assert.equal(totals.months.length,6);
 assert.equal((await rpc(student,'registrationStatistics')).code,'permission-denied');assert.equal((await rpc(teacher,'saveNewsPost',{channel:'site',kind:'news',title:'Нет доступа',body:'Запрещено'})).code,'permission-denied');
 const before=(await rpc(student,'listNotifications')).data.unreadCount;
 await nav(admin,'announcements');await admin.locator('#newsTitle').waitFor();
 const college='Событие техникума '+stamp,site='Объявление платформы '+stamp;
 const body='Текст с <script> и & символами. '+('Подробности события. '.repeat(40))+'Конец новости.';
 await admin.locator('#newsChannel').selectOption('college');await admin.locator('#newsTitle').fill(college);await admin.locator('#newsBody').fill(body);await admin.getByRole('button',{name:'Опубликовать',exact:true}).click();
 await admin.locator('.news-management .news-article').filter({has:admin.getByRole('heading',{name:college,exact:true})}).waitFor();
 await admin.locator('#newsChannel').selectOption('site');await admin.locator('#newsKind').selectOption('announcement');await admin.locator('#newsTitle').fill(site);await admin.locator('#newsBody').fill('Сообщение только на главной.');await admin.getByRole('button',{name:'Опубликовать',exact:true}).click();
 await admin.locator('.news-management .news-article').filter({has:admin.getByRole('heading',{name:site,exact:true})}).waitFor();
 assert.equal((await rpc(student,'listNotifications')).data.unreadCount,before,'posting news does not broadcast notifications');
 for(const p of [student,teacher]){
  await nav(p,'home');await p.getByRole('button',{name:'Действия с новостями',exact:true}).click();await p.getByRole('button',{name:'Обновить новости',exact:true}).click();await p.locator('[data-news-feed="all"]').getByRole('heading',{name:site,exact:true}).waitFor();
  const article=p.locator('[data-news-feed="all"] .news-article').filter({has:p.getByRole('heading',{name:college,exact:true})});await article.waitFor();await article.locator('summary').click();assert.equal(await article.locator('.news-full .news-body').textContent(),body);assert.equal(await article.locator('script').count(),0);assert.equal(await article.locator('.news-tag').textContent(),'Новости техникума');assert.equal(await p.locator('.news-article').filter({has:p.getByRole('heading',{name:site,exact:true})}).locator('.news-tag').textContent(),'Новости сайта');
 }
 const post=(await rpc(admin,'listNews',{channel:'site'})).data.rows.find(n=>n.title===site);
 await nav(admin,'announcements');await admin.locator('.news-article').filter({has:admin.getByRole('heading',{name:site,exact:true})}).locator('[data-action-menu-toggle]').click();await admin.locator('.news-article').filter({has:admin.getByRole('heading',{name:site,exact:true})}).getByRole('button',{name:'Редактировать',exact:true}).click();await admin.locator('#newsBody').fill('Исправленный текст.');await admin.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
 await admin.locator('.news-article').filter({has:admin.getByRole('heading',{name:site,exact:true})}).getByText('Исправленный текст.',{exact:true}).waitFor();
 assert.equal((await rpc(admin,'saveNewsPost',{id:post.id,revision:post.revision,channel:'site',kind:'announcement',title:site,body:'Из старой вкладки'})).code,'conflict');
 console.log('PASS one chronological home feed with channel tags, safe full text, administrator news CRUD, no implicit broadcasts, stale edits and private statistics');

 const description=('Полное описание предмета.\n'.repeat(28))+'Последняя строка описания.';
 const title='Ёмкая дисциплина '+stamp;
 const subject=(await rpc(teacher,'saveSubject',{title,description})).data;assert.ok(subject.id);
 for(const p of [teacher,student]){
  await nav(p,'subjects');await p.locator('#subjectSearch').waitFor();
  await p.locator('[data-subject-search]').filter({has:p.getByRole('heading',{name:title,exact:true})}).waitFor();
  await p.locator('#subjectSearch').fill('емкая ДИСЦИПЛИНА');
  const card=p.locator('[data-subject-search]:visible');assert.equal(await card.count(),1);assert.equal(await card.getByRole('heading',{name:title,exact:true}).count(),1);
  assert.equal(await card.locator('.subject-preview').evaluate(n=>n.scrollHeight>n.clientHeight&&getComputedStyle(n).maskImage!=='none'),true);
  await p.locator('#subjectSearch').fill('Предмета с таким названием нет');assert.equal(await p.locator('[data-subject-search]:visible').count(),0);await p.locator('#subjectSearchStatus').filter({hasText:'Ничего не найдено'}).waitFor();
  await p.locator('#subjectSearch').fill('');
 }
 const ownCard=teacher.locator('[data-subject-search]').filter({has:teacher.getByRole('heading',{name:title,exact:true})});
 assert.equal(await ownCard.getByRole('button',{name:'Редактировать',exact:true}).isVisible(),false);
 await ownCard.locator('[data-action-menu-toggle]').click();await ownCard.getByRole('button',{name:'Редактировать',exact:true}).click();
 assert.equal(await teacher.locator('#subjectTitle').inputValue(),title);assert.equal(await teacher.locator('#subjectTitle').evaluate(n=>document.activeElement===n),true);
 await teacher.locator('#subjectForm button[type="submit"]').click();await teacher.getByRole('heading',{name:'Добавить предмет',exact:true}).waitFor();
 await student.locator('[data-subject-search]').filter({has:student.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'Открыть предмет',exact:true}).click();await student.locator('.subject-full-description').waitFor();assert.equal(await student.locator('.subject-full-description').textContent(),description);
 await teacher.locator('[data-subject-search]').filter({has:teacher.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'Открыть предмет',exact:true}).click();await teacher.locator('.subject-full-description p').waitFor();assert.equal(await teacher.locator('.subject-full-description p').textContent(),description);
 // A legacy PDF record remains accessible after its navigation section is removed.
 const pdfTitle='Сохранённый PDF '+stamp;
 await teacher.evaluate(async({pdfTitle,subjectId})=>{
  const file=new Blob(['%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF'],{type:'application/pdf'});
  const grant=await callFunction('createUpload',{kind:'books',mime:'application/pdf',size:file.size});
  const form=new FormData();form.append('cacheControl','3600');form.append('',file,'old.pdf');const uploaded=await fetch(new URL(grant.url,lmsBaseUrl),{method:'PUT',headers:{'x-upsert':'false'},body:form});if(!uploaded.ok)throw Error('PDF upload failed');
  await callFunction('createMaterial',{kind:'books',title:pdfTitle,author:'Автор пособия',description:'Существующий учебный PDF',files:[grant.path],fileNames:['old.pdf']});
 },{pdfTitle,subjectId:subject.id});
 for(const p of [teacher,student]){await nav(p,'lectures');const card=p.locator('#content .item').filter({has:p.getByRole('heading',{name:pdfTitle,exact:true})});await card.waitFor();const url=await card.getByRole('link',{name:'Открыть PDF',exact:true}).getAttribute('href');assert.equal((await p.request.get(url)).status(),200);}
 await nav(admin,'accounts');await admin.locator('.registration-totals strong').first().waitFor();assert.equal(Number(await admin.locator('.registration-totals strong').first().textContent()),totals.total);await admin.locator('.registration-months summary').click();assert.equal(await admin.locator('.registration-months tbody tr').count(),6);
 if(outputDir){fs.mkdirSync(outputDir,{recursive:true});await admin.screenshot({path:path.join(outputDir,'registrations-desktop.png'),fullPage:true});}
 for(const [role,p] of [['admin',admin],['teacher',teacher],['student',student]]){
  await p.setViewportSize({width:1440,height:1000});await nav(p,'home');await p.locator('[data-news-feed="all"] .news-article').first().waitFor();if(outputDir)await p.screenshot({path:path.join(outputDir,role+'-news-desktop.png'),fullPage:true});
  await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(outputDir)await p.screenshot({path:path.join(outputDir,role+'-news-mobile.png'),fullPage:true});
  await p.locator('#mobileMore').click();await p.locator('#mobileMenu').waitFor();assert.equal(await p.locator('#mobileMenu [data-mobile-tab="books"]').count(),0);assert.equal(await p.locator('#mobileMenu [data-site-version]').textContent(),'Версия '+version);await p.keyboard.press('Escape');await p.setViewportSize({width:1280,height:900});
 }
 const current=(await rpc(admin,'listNews',{channel:'site'})).data.rows.find(n=>n.title===site);await rpc(admin,'deleteNewsPost',{id:current.id,revision:current.revision});
 assert.equal((await rpc(admin,'listNews',{channel:'site'})).data.rows.some(n=>n.id===current.id),false);
 console.log('PASS subject search, gradient previews, complete descriptions in both cabinets, retained PDF downloads, registration totals and desktop/mobile release version');
};

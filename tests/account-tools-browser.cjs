const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
// Every supplied account is a temporary fixture owned by the caller.
module.exports=async({teacher,student,other,admin,stamp,outputDir,password,allowSettings=false,allowPassword=false})=>{
 const rpc=(p,a,d={})=>p.evaluate(([a,d])=>callFunction(a,d).then(data=>({data}),error=>({code:error.code,message:error.message})),[a,d]);
 const nav=async(p,t)=>p.evaluate(t=>document.querySelector('.tabs [data-tab="'+t+'"]').click(),t);
 const profiles=await Promise.all([student,teacher,admin].map(async p=>(await rpc(p,'profile')).data));
 const target=profiles[1],uid=profiles[0].uid;
 for(const p of [student,teacher,admin]){
  await nav(p,'people');await p.locator('#peopleSearch').waitFor();await p.locator('#peopleSearch').fill(target.name);await p.locator('#peopleRole').selectOption('teacher');await p.getByRole('button',{name:'Найти',exact:true}).click();
  const card=p.locator('.person-card').filter({has:p.getByRole('heading',{name:target.name,exact:true})});await card.waitFor();assert.equal(await p.locator('.person-card').count(),1);await card.getByRole('button',{name:'Открыть профиль',exact:true}).click();await p.locator('.profile-heading h2').filter({hasText:target.name}).waitFor();
  assert.equal(await p.getByRole('button',{name:'Профиль преподавателя',exact:true}).count(),1);
  const result=(await rpc(p,'getPerson',{userId:uid})).data;assert.equal('email' in result,false);assert.equal('avatarRevision' in result,false);
  const rows=(await rpc(p,'searchPeople',{search:target.email})).data.rows;assert.equal(rows.length,0);
  await nav(p,'help');await p.locator('.help-answers').waitFor();await p.locator('#helpSearch').fill('несуществующийвопрос');assert.equal(await p.locator('#helpEmpty').isVisible(),true);await p.locator('#helpSearch').fill('пароль');assert.ok(await p.locator('.help-answer:visible').count()>=2);await p.locator('.help-answer:visible summary').first().click();assert.ok(await p.locator('.help-answer[open] p').isVisible());
 }
 assert.equal((await rpc(student,'savePortalSettings',{feedbackUrl:'https://forms.gle/temporary',revision:0})).code,'permission-denied');
 assert.equal((await rpc(admin,'savePortalSettings',{feedbackUrl:'https://example.com/',revision:0})).code,'invalid-argument');
 assert.equal((await rpc(student,'createAvatarUpload',{mime:'image/svg+xml',size:20})).code,'invalid-argument');assert.equal((await rpc(student,'createAvatarUpload',{mime:'image/png',size:6*1024*1024})).code,'invalid-argument');
 assert.equal((await rpc(student,'saveMyAvatar',{path:target.uid+'/foreign',revision:0})).code,'invalid-argument');
 const bytes=Buffer.from(await student.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=600;const ctx=c.getContext('2d');ctx.fillStyle='#914b37';ctx.fillRect(0,0,800,600);return c.toDataURL('image/png').split(',')[1];}),'base64');
 for(const [index,p] of [student,teacher,admin].entries()){
  await nav(p,'profile');await p.locator('#accountPhoto').waitFor();await p.setViewportSize({width:390,height:844});
  if(index===0)await p.locator('[data-photo-paste]').evaluate((node,bytes)=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array(bytes)],'pasted.png',{type:'image/png'}));node.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},Array.from(bytes));
  else await p.locator('#accountPhoto').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:bytes});
  await p.getByRole('button',{name:'Сохранить фотографию',exact:true}).click();await p.locator('[data-photo-status]').filter({hasText:'Фотография сохранена.'}).waitFor();
  const photo=(await rpc(p,'profile')).data;assert.ok(photo.avatarUrl);assert.equal(photo.avatarRevision,1);assert.equal(await p.locator('.profile-link').evaluate(async n=>{const img=n.querySelector('img');if(!img?.complete)await new Promise(r=>{img.onload=r;img.onerror=r});return img.naturalWidth>0;}),true);
  const viewed=(await rpc(other,'getPerson',{userId:photo.uid})).data;assert.ok(viewed.avatarUrl);assert.equal((await other.request.get(viewed.avatarUrl)).status(),200);
  if(index===1){const listed=(await rpc(student,'listTeachers')).data.find(t=>t.id===photo.uid);assert.ok(listed.avatarUrl);const professional=(await rpc(student,'getTeacherProfile',{teacherId:photo.uid})).data;assert.ok(professional.avatarUrl);
   const saved=await rpc(p,'saveTeacherProfile',{teacherId:photo.uid,position:'Преподаватель проверки',bio:'',education:'',qualification:'',experienceYears:null,revision:professional.revision});assert.ok(saved.data,saved.message);assert.ok((await rpc(student,'getTeacherProfile',{teacherId:photo.uid})).data.avatarUrl,'creating a professional profile preserves the common account photo');}
  assert.equal((await rpc(p,'saveMyAvatar',{path:null,revision:0})).code,'conflict');
  await p.reload();await p.locator('#content h2').first().waitFor();await nav(p,'profile');await p.getByRole('button',{name:'Убрать фотографию',exact:true}).waitFor();
  if(outputDir){fs.mkdirSync(outputDir,{recursive:true});await p.screenshot({path:path.join(outputDir,['student','teacher','admin'][index]+'-profile-mobile.png'),fullPage:true});}
  await p.getByRole('button',{name:'Убрать фотографию',exact:true}).click();await p.locator('[data-photo-status]').filter({hasText:'Фотография удалена.'}).waitFor();assert.equal((await rpc(p,'profile')).data.avatarUrl,null);assert.equal((await p.request.get(photo.avatarUrl)).ok(),false);
  await p.setViewportSize({width:1280,height:900});
 }
 if(allowSettings){
  await nav(admin,'help');await admin.locator('#feedbackUrl').waitFor({state:'attached'});await admin.locator('details').filter({has:admin.locator('#feedbackUrl')}).locator('summary').click();await admin.locator('#feedbackUrl').fill('https://forms.gle/temporary-'+stamp);await admin.getByRole('button',{name:'Сохранить ссылку',exact:true}).click();await admin.locator('[data-settings-status]').filter({hasText:'Ссылка сохранена.'}).waitFor();
  await nav(student,'help');await student.getByRole('link',{name:'Идеи, улучшения и ошибки ↗',exact:true}).waitFor();assert.equal(await student.getByRole('link',{name:'Идеи, улучшения и ошибки ↗',exact:true}).getAttribute('target'),'_blank');
  await admin.locator('#feedbackUrl').fill('');await admin.getByRole('button',{name:'Сохранить ссылку',exact:true}).click();await admin.waitForFunction(()=>document.querySelector('#feedbackLink button')?.disabled===true);
 }
 if(allowPassword){
  const next=password+'-changed';
  const fill=async(old,value)=>{await nav(student,'profile');await student.locator('.account-password summary').click();await student.locator('#oldPassword').fill(old);await student.locator('#newPassword').fill(value);await student.locator('#repeatPassword').fill(value);await student.getByRole('button',{name:'Изменить пароль',exact:true}).click();};
  await fill('incorrect-fixture-password',next);await student.locator('[data-password-status]').filter({hasText:'Старый пароль указан неверно.'}).waitFor();assert.equal(await student.locator('#oldPassword').inputValue(),'');
  await fill(password,next);await student.locator('[data-password-status]').filter({hasText:'Пароль изменён.'}).waitFor();assert.equal(await student.locator('#newPassword').inputValue(),'');
  const email=profiles[0].email;await student.evaluate(()=>logout());await student.waitForURL('**/index.html');
  await student.locator('#loginEmail').fill(email);await student.locator('#loginPassword').fill(password);await student.getByRole('button',{name:'Войти',exact:true}).click();await student.locator('#error').filter({hasText:'Проверьте email и пароль.'}).waitFor();
  await student.locator('#loginPassword').fill(next);await student.getByRole('button',{name:'Войти',exact:true}).click();await student.waitForURL('**/student.html');await student.getByRole('heading',{name:'Главная',exact:true}).waitFor();
  await fill(next,password);await student.locator('[data-password-status]').filter({hasText:'Пароль изменён.'}).waitFor();
 }
 for(const p of [student,teacher,admin]){
  await nav(p,'home');await p.locator('.news-article').first().waitFor();const news=p.locator('.news-article').first();assert.ok((await news.evaluate(n=>getComputedStyle(n).backgroundColor)).includes('41, 55, 63'));assert.equal(await news.locator('h3').evaluate(n=>getComputedStyle(n).color),'rgb(255, 248, 237)');
  await p.locator('#notificationButton').click();const dialog=p.locator('#notificationsDialog');await dialog.locator('.notice-card').first().waitFor();assert.notEqual(await dialog.locator('.notice-card').first().evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');if(outputDir){await p.setViewportSize({width:390,height:844});await p.screenshot({path:path.join(outputDir,(await rpc(p,'profile')).data.role+'-dark-notifications.png')});}await dialog.getByRole('button',{name:'Закрыть уведомления',exact:true}).click();
  await p.setViewportSize({width:390,height:844});await nav(p,'people');await p.locator('#peopleResults .person-card').first().waitFor();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(outputDir)await p.screenshot({path:path.join(outputDir,(await rpc(p,'profile')).data.role+'-people-mobile.png'),fullPage:true});await p.setViewportSize({width:1280,height:900});
 }
 console.log('PASS people search/privacy/roles, avatars for every role with reload/delete/legacy teacher sync, help search, dark cards'+(allowSettings?', administrator form configuration':'')+(allowPassword?', old-password verification, real password change and old/new login':''));
};

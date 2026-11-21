const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');const base='http://127.0.0.1:54321/',root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const u=new URL(req.url,base),file=path.resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css':/\.(?:js|mjs)$/.test(file)?'text/javascript':file.endsWith('.png')?'image/png':'text/html'}).end(fs.readFileSync(file));});
const picture=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8ioAAAAASUVORK5CYII=','base64');
const photoId='3e06f123-7b96-45bc-9f90-c8a043a64302';
function fixture(role){let liked=false,messages=[],title='Новость для проверки',photos=[],education={specialty:'Право',course:1,groupId:'g',groupName:'9241',enrolledOn:'2024-09-01',birthDate:'2008-04-05',age:18,revision:0};const person={uid:role,name:'Проверочный Иван',role,email:role+'@example.test',canTeach:role==='teacher',nameConfirmed:true,noPatronymic:true,firstNameRaw:'Иван',lastNameRaw:'Проверочный'};
 const notices=[];
 const addNotice=(id,title)=>notices.unshift({id,title,body:'Текст уведомления',destination:'home',category:'personal',severity:'info',created_at:new Date().toISOString(),read:false});
 const noticeFeed=(offset=0)=>({rows:notices.slice(offset,offset+50),unreadCount:notices.filter(n=>!n.read).length});
 addNotice('first','Первое уведомление');
 return (action,data={})=>{switch(action){
 case 'profile':return person;
 case 'listNews':return {rows:[{id:'post',title,photos,body:'Текст публикации',channel:data.channel==='college'?'college':'site',kind:'news',published_at:'2026-11-16T09:00:00Z',revision:1,liked,like_count:liked?1:0,can_edit:['admin','curator'].includes(role)}],hasMore:false};
 case 'saveNewsPost':title=data.title;photos=data.photos.map(photo=>{assert.ok(photo.id===photoId||photo.data?.startsWith('/9j/'));return photoId;});return {id:'post'};
 case 'deleteNewsPost':assert.equal(data.id,'post');title='Новость для проверки';photos=[];return null;
 case 'getPortalSettings':return {feedbackUrl:null,revision:0};
 case 'setNewsLike':liked=data.liked;return {id:'post',liked,like_count:liked?1:0};
 case 'listNotifications':return noticeFeed(data.offset);
 case 'readAllNotifications':notices.forEach(n=>n.read=true);return noticeFeed();
 case 'readNotifications':notices.forEach(n=>{if(data.ids.includes(n.id))n.read=true;});return null;
 case 'addTestNotice':addNotice('next','Новое уведомление');return null;
 case 'listAccounts':return [{id:role,name:person.name,email:person.email,role}];
 case 'registrationStatistics':return {total:10,students:6,teachers:2,admins:1,last7:3,last30:5,months:[]};
 case 'getOnlineStats':{
  const stats={accounts:2,roles:{student:1,teacher:0,curator:0,admin:1},guestConnections:3,available:true};if(!data.historyRange)return stats;
  const config={'60m':[60,1],'7h':[420,5],'24h':[1440,15],'3d':[4320,30],'7d':[10080,60]}[data.historyRange];
  const now=Date.now(),start=now-config[0]*60000,points=Array.from({length:Math.ceil(config[0]/config[1])},(_,i)=>({at:new Date(start+i*config[1]*60000).toISOString(),accounts:i<3||i===10?null:i%8,guestConnections:i<3||i===10?null:i%5,samples:i<3||i===10?0:1}));
  return {...stats,history:{range:data.historyRange,stepMinutes:config[1],from:new Date(start).toISOString(),to:new Date(now).toISOString(),collectionStartedAt:new Date(start).toISOString(),points}};
 }
 case 'listSubjectJoinRequests':return [];
 case 'listRecoveryRequests':return [];
 case 'getPushSettings':return {publicKey:'B'+'a'.repeat(86),device:null};
 case 'listScheduleGroups':return [{id:'g',name:'9241',course:'4',lessons_per_day:6,revision:1}];
 case 'getWeeklySchedule':return {group:{id:'g',name:'9241',course:'4',lessons_per_day:6,revision:1},cells:[{weekday:1,lesson_number:1,status:'lesson',title:'Математика',teacher_label:'Преподаватель И.И.',room:'20'}]};
 case 'listSchedule':return {rows:[],hasMore:false};
 case 'listNotificationSubscriptions':return [];
 case 'getLessonReminder':return {enabled:false,timedLessons:1,totalLessons:1};
 case 'getMyEducation':return {profile:education,groups:[{id:'g',name:'9241',course:'4',program:'Программирование'}]};
 case 'saveMyEducation':education={...education,...data,groupName:'9241',revision:education.revision+1};return education;
 case 'getGroupLessonTimes':return [{lesson_number:1,starts_at:'08:00:00',ends_at:'09:35:00'}];
 case 'exportSchedule':return {week:'2026-11-16',generatedAt:new Date().toISOString(),groups:[{group:{id:'g',name:'9241',course:'4',program:'Программирование',lessons_per_day:6},cells:[{weekday:1,lesson_number:1,status:'lesson',title:'Математика',teacher_label:'ФИО',room:'20',starts_at:'08:00:00',ends_at:'09:35:00'}]}]};
 case 'listActiveAttempts':return [];
 case 'listTeachers':return [{id:'instructor',name:'Проверочный Преподаватель',subjectIds:['math','law'],subjectTitles:['Математика','Право']}];
 case 'getTeacherProfile':return {id:'instructor',name:'Проверочный Преподаватель',documents:[],subjects:[{id:'math',title:'Математика',description:'Программа курса'},{id:'law',title:'Право'}]};
 case 'getSubjectContent':assert.equal(data.teacherId,'instructor');assert.equal(data.subjectId,'math');return {
  subject:{title:'Математика',description:'Программа курса'},teacher:{id:'instructor',name:'Проверочный Преподаватель'},lectures:[],books:[],tests:[]};
 case 'listCuratorMessages':return {rows:messages.filter(m=>!data.after||BigInt(m.id)>BigInt(data.after))};
 case 'getCuratorChatSummary':return {unreadCount:0,lastReadId:String(messages.length),latestId:String(messages.length),latestIncoming:null};
 case 'markCuratorChatRead':return {unreadCount:0,lastReadId:String(messages.length),latestId:String(messages.length),latestIncoming:null};
 case 'sendCuratorMessage':messages.push({id:String(messages.length+1),body:data.body,author_id:role,author_name:person.name,created_at:new Date().toISOString()});return {id:String(messages.length)};
 default:throw Error('Unexpected fixture action '+action);
 }};
}
async function goTab(page,tab){
 const toggle=page.locator('.desktop-nav-toggle');
 if(await toggle.isVisible()){
  if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
  await page.locator(`.tabs [data-tab="${tab}"]`).click();
 }else await page.evaluate(value=>Portal.navigate(value),tab);
}
async function checkChat(page,role,width){
 if(!['curator','admin'].includes(role))return;
 const open=async()=>{await page.locator('#mobileMore').click();await page.locator('.mobile-menu-grid [data-mobile-tab="curator-chat"]').click();await page.locator('.chat-composer').waitFor();};
 await open();await page.locator('#chatBody').fill('Черновик '+width);
 await page.locator('[data-chat-back]').click();assert.equal(await page.locator('body.chat-open').count(),0);
 await open();assert.equal(await page.locator('#chatBody').inputValue(),'Черновик '+width);
 await page.setViewportSize({width,height:460});
 await page.waitForFunction(()=>{const r=document.querySelector('.chat-composer')?.getBoundingClientRect();return r&&r.bottom<=innerHeight+1&&r.top>0;});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,role+' chat overflow '+width);
 assert.ok((await page.locator('#chatBody').boundingBox()).width>=width-90,role+' chat input has full mobile width');
 await page.locator('[data-chat-form] button').click();await page.getByText('Черновик '+width,{exact:true}).waitFor();
 await page.screenshot({path:path.join(root,'.qa-output/release100',role+'-chat-'+width+'.png'),fullPage:false});
 await page.locator('[data-chat-back]').click();await page.setViewportSize({width,height:844});
}
(async()=>{
 fs.mkdirSync(path.join(root,'.qa-output'),{recursive:true});await new Promise(r=>server.listen(54321,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const role of (process.env.LMS_TEST_ROLE?[process.env.LMS_TEST_ROLE]:['guest','student','teacher','curator','admin'])){
  const reduced=role==='curator';
  const context=await browser.newContext({serviceWorkers:'block',reducedMotion:reduced?'reduce':'no-preference',viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[],api=fixture(role);page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  if(role!=='guest'){
   await page.addInitScript(({role})=>{const user={uid:role,email:role+'@example.test',getIdToken:async()=>'fixture'};window.firebase={initializeApp(){},auth:()=>({currentUser:user,onAuthStateChanged:cb=>{queueMicrotask(()=>cb(user));return ()=>{};}})};},{role});
   await page.route('**/vendor/firebase/**/*.js*',r=>r.fulfill({contentType:'text/javascript',body:''}));
  }
  await page.route('**/functions/v1/lms*',async route=>{const r=route.request(),headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'};if(r.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});const u=new URL(r.url()),body=r.method()==='GET'?{action:u.searchParams.get('action'),data:JSON.parse(u.searchParams.get('data')||'{}')}:r.postDataJSON();try{
   if(body.action==='saveMyEducation')await new Promise(resolve=>setTimeout(resolve,250));
   await route.fulfill({headers,json:{data:api(body.action,body.data)}});
  }catch(e){errors.push(e.message);await route.fulfill({status:500,headers,json:{error:e.message}});}});
  await page.route('**/storage/v1/news-photo/*',route=>route.fulfill({contentType:'image/png',body:picture}));
  await page.goto(base+(role==='curator'?'student':role)+'.html');await page.locator('.news-article').waitFor();
  assert.equal(await page.getByRole('heading',{name:'Новости',exact:true}).count(),1);
  assert.equal(await page.locator('.tabs [data-tab="home"]').textContent(),'Новости');
  assert.equal(await page.locator('.tabs [data-tab="announcements"]').count(),0);
  assert.equal(await page.locator('.tabs [data-tab="students"]').count(),0);
  assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'),'favicon.ico');
  const actions=page.locator('.news-heading-actions');
  const menu=actions.getByRole('button',{name:'Действия с новостями'});
  const compose=actions.getByRole('button',{name:'Написать новость'});
  const canPublish=['admin','curator'].includes(role);
  assert.equal(await compose.count(),canPublish?1:0);
  for(const width of [1280,320]){
   await page.setViewportSize({width,height:900});
   const menuBox=await menu.boundingBox();
   assert.ok(menuBox.x+menuBox.width<=width,'news menu fits '+width);
   if(canPublish){const editorBox=await compose.boundingBox();assert.ok(Math.abs(editorBox.y-menuBox.y)<=4&&menuBox.x-editorBox.x-editorBox.width<=12,'actions side by side '+width);}
  }
  await page.setViewportSize({width:1280,height:900});
  await menu.click();await page.getByRole('button',{name:'Обновить новости',exact:true}).waitFor();await page.keyboard.press('Escape');
  if(['teacher','student'].includes(role)){
   await goTab(page,'teachers');await page.locator('.teacher-card').getByText('Предметов: 2 · Математика, Право',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Открыть профиль'}).click();
   if(role==='student'){
    await page.evaluate(()=>{
     Object.defineProperty(navigator,'share',{value:undefined});
     Object.defineProperty(navigator,'clipboard',{value:{writeText:async url=>window.sharedTeacher=url}});
    });
    await page.getByRole('button',{name:'Поделиться профилем'}).click();
    await page.waitForFunction(()=>window.sharedTeacher);
    const link=await page.evaluate(()=>window.sharedTeacher);
    assert.equal(link,base+'index.html?teacher=instructor');
    await page.goto(link);await page.waitForURL('**/student.html?teacher=instructor');
    await page.locator('.profile-heading').getByRole('heading',{name:'Проверочный Преподаватель'}).waitFor();
   }
   await page.locator('.profile-heading').getByRole('button',{name:'Посмотреть предметы'}).click();
   const subjects=page.locator('.subjects-grid .subject-card');
   await subjects.first().waitFor();assert.deepEqual(await subjects.locator('h3').allTextContents(),['Математика','Право']);
   await page.locator('#subjectSearch').fill('математика');await subjects.filter({visible:true}).first().getByRole('button',{name:'Открыть предмет'}).click();
   await page.getByText('Программа курса',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Математика',exact:true}).count(),1);
   await page.getByRole('button',{name:'К предметам преподавателя'}).click();
   await page.getByRole('heading',{name:'Предметы преподавателя'}).waitFor();
   await goTab(page,'home');await page.locator('.news-article').waitFor();
  }
  if(role!=='guest'){
   await page.setViewportSize({width:1280,height:580});await page.evaluate(()=>window.scrollTo(0,0));
   const toggle=page.locator('.desktop-nav-toggle'),panel=page.locator('#desktopNavigation');
   assert.equal(await toggle.getAttribute('aria-expanded'),'false');
   await toggle.hover();await panel.waitFor();
   assert.equal(await panel.evaluate(node=>getComputedStyle(node).animationName),reduced?'none':'panel-appear');
   await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
   await toggle.click();await panel.waitFor();
   const profileLink=panel.locator('[data-tab="profile"]'),profileBox=await profileLink.boundingBox();
   assert.ok(profileBox.y>=0&&profileBox.y+profileBox.height<=580,role+' profile stays on screen');
   await page.keyboard.press('Escape');await page.evaluate(()=>window.scrollTo(0,1300));
   const moved=await toggle.boundingBox();assert.ok(moved.y>=0&&moved.y+moved.height<=580,role+' sticky menu');
   await page.mouse.move(1000,200);await panel.waitFor({state:'hidden'});
   await page.setViewportSize({width:1280,height:900});
  }
  await page.locator('#newsTag').selectOption('college');await page.locator('.news-tag[data-news-channel="college"]').waitFor();await page.locator('#newsOrder').selectOption('oldest');
  if(role!=='guest'){
   await page.locator('.news-like').click();await page.locator('.news-like[aria-pressed="true"]').waitFor();
   assert.equal(await page.locator('.news-like svg').evaluate(node=>getComputedStyle(node).animationName),reduced?'none':'heart-pop');
   await page.locator('.news-like').click();await page.locator('.news-like[aria-pressed="false"]').waitFor();
   assert.equal(await page.locator('.news-like svg').evaluate(node=>getComputedStyle(node).animationName),'none');
  }
  assert.equal(await page.locator('.tabs [data-tab="curator-chat"]').count(),['admin','curator'].includes(role)?1:0);
  if(['admin','curator'].includes(role)){await goTab(page,'curator-chat');await page.locator('#chatBody').fill('<script>проверка</script>');await page.locator('[data-chat-form] button').click();await page.locator('.curator-message p').waitFor();assert.equal(await page.locator('.curator-message p').textContent(),'<script>проверка</script>');assert.equal(await page.locator('.curator-message script').count(),0);}
  if(role==='admin'){await goTab(page,'accounts');await page.locator('.online-stat-grid').waitFor();assert.equal(await page.locator('.online-total strong').textContent(),'2');await page.getByText('Новых заявок нет.',{exact:true}).waitFor();
   await page.locator('[data-history-plot] svg').waitFor();for(const range of ['7h','24h','3d','7d','60m']){await page.locator('[data-history-range]').selectOption(range);await page.locator('[data-history-plot] svg').waitFor();await page.locator('[data-history-status]').filter({hasText:'Обновлено'}).waitFor();}
   await page.locator('[data-history-plot] svg').focus();await page.keyboard.press('ArrowLeft');assert.match(await page.locator('[data-history-tooltip]').textContent(),/Аккаунты|нет измерений/);
   for(const width of [320,390]){await page.setViewportSize({width,height:844});await page.locator('[data-history-range]').selectOption('7d');await page.locator('[data-history-plot] svg').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'activity chart fits '+width);await page.locator('[data-history-plot]').screenshot({path:path.join(root,'.qa-output',`activity-${width}.png`)});}
   await page.setViewportSize({width:1280,height:900});
  }
  if(['admin','curator'].includes(role)){
   await goTab(page,'home');await page.locator('[data-news-action="compose"]').click();await page.locator('#newsTitle').fill('Новая публикация');await page.locator('#newsBody').fill('Текст новости');assert.equal(await page.locator('#newsNotify').count(),role==='admin'?1:0);
   const encoded=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;canvas.getContext('2d').fillRect(0,0,64,64);return canvas.toDataURL('image/png').split(',')[1];});
   await page.locator('#newsPhotos').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from(encoded,'base64')});
   await page.locator('.news-photo-editor img').waitFor().catch(async error=>{throw new Error(await page.locator('.news-photo-error').textContent()||error.message);});
   await page.locator('[data-news-form] [type="submit"]').click();await page.locator('.news-article').getByRole('heading',{name:'Новая публикация',exact:true}).waitFor({timeout:3500}).catch(async error=>{throw new Error(JSON.stringify({error:error.message,errors,toast:await page.locator('#toastRegion').textContent()}));});
   await page.locator('.news-photos img').waitFor().catch(async error=>{throw new Error(JSON.stringify({error:error.message,errors,post:await page.locator('.news-article').innerHTML(),toast:await page.locator('#toastRegion').textContent()}));});
   const newsMenu=()=>page.locator('.news-article [data-action-menu-toggle]').click();await newsMenu();await page.locator('[data-news-action="edit"]').click();await page.locator('[data-remove-photo]').click();await page.locator('#newsTitle').fill('Изменённая публикация');await page.locator('[data-news-form] [type="submit"]').click();await page.getByRole('heading',{name:'Изменённая публикация',exact:true}).waitFor();assert.equal(await page.locator('.news-photos').count(),0);
   await newsMenu();page.once('dialog',dialog=>dialog.accept());await page.locator('[data-news-action="delete"]').click();await page.getByRole('heading',{name:'Новость для проверки',exact:true}).waitFor();
  }
  if(['student','curator'].includes(role)){
   await goTab(page,'profile');await page.locator('#educationBirth').waitFor();await page.locator('#educationSpecialty').fill('Информационные системы');
   const save=page.getByRole('button',{name:'Сохранить учебные данные',exact:true}),before=await save.boundingBox();
   await save.click();await page.locator('[data-education-form] [data-save-feedback="pending"][aria-busy="true"]').waitFor();
   await page.locator('[data-education-form] [data-save-feedback="saved"]').waitFor();
   assert.ok(Math.abs((await save.boundingBox()).width-before.width)<1);
   await page.getByText('Учебные данные сохранены.',{exact:true}).waitFor();assert.match(await page.locator('[data-own-age]').textContent(),/18 лет/);
  }
  if(role!=='guest'){
   assert.equal(await page.locator('nav [data-tab="people"],nav [data-tab="notifications"],nav [data-mobile-tab="people"],nav [data-mobile-tab="notifications"]').count(),0);
   const profile=page.locator('header .profile-link'),url=page.url();await profile.click();assert.equal(page.url(),url);await page.locator('#profileMenu #userName').waitFor();
   assert.equal(await page.locator('#profileMenu').evaluate(node=>getComputedStyle(node).animationName),reduced?'none':'panel-appear');
   await page.locator('#profileMenu [data-tab="help"]').click();await page.locator('#helpSearch').waitFor();assert.equal(await page.locator('#profileMenu').isHidden(),true);
   const bell=page.locator('#notificationButton'),popover=page.locator('#noticePopover'),counter=bell.locator('#notificationCount');
   await counter.waitFor();await page.setViewportSize({width:320,height:844});
   await bell.click();await popover.getByRole('button',{name:/Первое уведомление/}).waitFor();await counter.waitFor({state:'hidden'});
   assert.equal(await popover.evaluate(node=>getComputedStyle(node).animationName),reduced?'none':'panel-appear');
   assert.equal(await bell.getAttribute('aria-expanded'),'true');assert.equal(page.url(),url);
   const bounds=await popover.boundingBox(),bellBounds=await bell.boundingBox();
   assert.ok(bounds.x>=0&&bounds.x+bounds.width<=320&&bounds.y>=bellBounds.y+bellBounds.height);
   assert.equal(api('listNotifications').unreadCount,0);
   api('addTestNotice');await page.evaluate(()=>document.dispatchEvent(new CustomEvent('lms-live-update',{detail:{topics:['notices']}})));
   await counter.waitFor();assert.equal(await counter.textContent(),'1');await popover.getByRole('button',{name:/Новое уведомление/}).waitFor();
   await bell.click();await popover.waitFor({state:'hidden'});
   await bell.click();await popover.getByRole('button',{name:/Новое уведомление/}).waitFor();await counter.waitFor({state:'hidden'});
   await page.mouse.click(4,Math.ceil(bounds.y+6));await popover.waitFor({state:'hidden'});
   await page.setViewportSize({width:1280,height:900});
   await bell.click();await popover.locator('[data-action-menu-toggle]').click();
   await page.keyboard.press('Escape');await popover.locator('.action-menu-panel').waitFor({state:'hidden'});assert.equal(await popover.isVisible(),true);
   await page.keyboard.press('Escape');await popover.waitFor({state:'hidden'});assert.equal(await bell.evaluate(n=>n===document.activeElement),true);
   await bell.click();await popover.locator('[data-action-menu-toggle]').click();await popover.getByRole('button',{name:'Вся история'}).click();
   const dialog=page.locator('#notificationsDialog');await dialog.locator('[data-notice-list]').waitFor();
   assert.equal(await dialog.locator('.notice-card.unread').count(),0);
   await dialog.locator('[data-portal="close-dialog"]').click();
   await bell.click();await popover.locator('[data-action-menu-toggle]').click();await popover.locator('[data-portal="notice-settings"]').click();
   await page.locator('.push-settings summary').click();await page.locator('[data-push-save]').waitFor();assert.equal(await page.locator('[data-push-schedule]').isChecked(),true);assert.equal(await page.locator('[data-push-announcements]').isChecked(),false);
   assert.equal(await page.locator('[data-push-chat]').count(),canPublish?1:0);
   if(canPublish)assert.equal(await page.locator('[data-push-chat]').isChecked(),false);
   await page.locator('[data-portal="close-dialog"]').click();
   await page.setViewportSize({width:320,height:844});await profile.click();const box=await page.locator('#profileMenu').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=320);await page.keyboard.press('Escape');assert.equal(await page.locator('#profileMenu').isHidden(),true);await page.setViewportSize({width:1280,height:900});
  }
  if(role==='guest'||role==='student'||role==='curator'){
   assert.equal((await (await page.request.get(base+'manifest.webmanifest')).json()).start_url,'./index.html');
   await page.addInitScript(()=>Object.defineProperty(navigator,'standalone',{value:true}));
   await page.goto(base+'guest.html');
   await page.waitForURL(role==='guest'?'**/index.html':'**/student.html');
   if(role==='guest'){
    await page.getByRole('link',{name:/Войти как гость/}).click();await page.waitForURL('**/guest.html?guest=1');
   }else{
    await page.goto(base+'guest.html');await page.waitForURL('**/student.html');
    await page.goto(base+'index.html?open=curator-chat');await page.waitForURL('**/student.html');
    if(role==='curator')await page.locator('.chat-composer').waitFor();
    else assert.equal(await page.locator('.chat-composer').count(),0);
   }
  }
  await goTab(page,'home');await page.locator('.news-article').waitFor();await page.screenshot({path:path.join(root,'.qa-output',role+'-desktop.png'),fullPage:true});
  if(role==='student'){
   await page.clock.setFixedTime(new Date('2026-11-19T10:00:00Z'));
   await page.setViewportSize({width:390,height:844});
   assert.equal(await page.locator('.desktop-nav-toggle').isVisible(),false);
   await page.locator('#mobileNavigation [data-mobile-tab="schedule"]').click();
   await page.locator('#scheduleGroupSelect').selectOption('g');
   const label=page.locator('.schedule-gallery-controls output');
   await label.filter({hasText:'Четверг'}).waitFor();
   assert.equal(await page.locator('.schedule-gallery').evaluate(n=>Math.round(n.scrollLeft/n.children[1].offsetLeft)),3);
   await page.getByRole('button',{name:'Предыдущий день'}).click();await label.filter({hasText:'Среда'}).waitFor();
   await page.getByRole('button',{name:'Следующий день'}).click();await label.filter({hasText:'Четверг'}).waitFor();
   const gallery=page.locator('.schedule-gallery');
   await gallery.evaluate(n=>n.scrollIntoView({block:'start'}));
   const box=await gallery.boundingBox(),y=Math.max(150,box.y+45);
   const touch=await context.newCDPSession(page);
   await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width-40,y}]});
   for(const offset of [75,120,175,230,275]){
    await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width-40-offset,y}]});
    await page.waitForTimeout(30);
   }
   await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await label.filter({hasText:'Пятница'}).waitFor();
   await page.evaluate(()=>document.dispatchEvent(new CustomEvent('lms-live-update',{detail:{topics:['schedule']}})));
   await label.filter({hasText:'Пятница'}).waitFor();
  }
  for(const width of [320,390]){await page.setViewportSize({width,height:844});await page.locator('#mobileNavigation [data-mobile-tab="schedule"]').click();await page.locator('#scheduleGroupSelect').selectOption('g');await page.locator('.schedule-week-grid').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,role+' schedule '+width);if(role!=='guest'){await page.locator('[data-reminder-toggle]').click();await page.locator('#lessonReminderDialog').waitFor();assert.equal(await page.locator('#lessonReminderDialog [type="submit"]').isDisabled(),true);await page.locator('[data-reminder-consent]').check();assert.equal(await page.locator('#lessonReminderDialog [type="submit"]').isEnabled(),true);await page.locator('[data-reminder-close]').click();}await page.locator('#mobileNavigation [data-mobile-tab="home"]').click();await page.locator('.news-article').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,role+' news '+width);await checkChat(page,role,width);}
  await page.screenshot({path:path.join(root,'.qa-output',role+'-mobile.png'),fullPage:true});assert.deepEqual(errors,[]);await context.close();console.log('PASS '+role+': news, filters, hearts, chat visibility, push settings, 320/390px');
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});

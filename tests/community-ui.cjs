const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');const base='http://127.0.0.1:54321/',root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const u=new URL(req.url,base),file=path.resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css':/\.(?:js|mjs)$/.test(file)?'text/javascript':file.endsWith('.png')?'image/png':'text/html'}).end(fs.readFileSync(file));});
function fixture(role){let liked=false,messages=[],title='Новость для проверки',education={specialty:'Право',course:1,groupId:'g',groupName:'9241',enrolledOn:'2024-09-01',birthDate:'2008-04-05',age:18,revision:0};const person={uid:role,name:'Проверочный Иван',role,email:role+'@example.test',canTeach:role==='teacher',nameConfirmed:true,noPatronymic:true,firstNameRaw:'Иван',lastNameRaw:'Проверочный'};
 return (action,data={})=>{switch(action){
 case 'profile':return person;
 case 'listNews':return {rows:[{id:'post',title,body:'Текст публикации',channel:data.channel==='college'?'college':'site',kind:'news',published_at:'2026-11-16T09:00:00Z',liked,like_count:liked?1:0,can_edit:['admin','curator'].includes(role)}],hasMore:false};
 case 'saveNewsPost':title=data.title;return {id:'post'};
 case 'setNewsLike':liked=data.liked;return {id:'post',liked,like_count:liked?1:0};
 case 'listNotifications':return {rows:[],unreadCount:0};
 case 'getPushSettings':return {publicKey:'B'+'a'.repeat(86),device:null};
 case 'listScheduleGroups':return [{id:'g',name:'9241',course:'4',lessons_per_day:6,revision:1}];
 case 'getWeeklySchedule':return {group:{id:'g',name:'9241',course:'4',lessons_per_day:6,revision:1},cells:[{weekday:1,lesson_number:1,status:'lesson',title:'Математика',teacher_label:'Преподаватель И.И.',room:'20'}]};
 case 'listSchedule':return {rows:[],hasMore:false};
 case 'listNotificationSubscriptions':return [];
 case 'getLessonReminder':return {enabled:false,timedLessons:1,totalLessons:1};
 case 'getMyEducation':return {profile:education,groups:[{id:'g',name:'9241',course:'4',program:'Программирование'}]};
 case 'saveMyEducation':education={...education,...data,groupName:'9241',revision:education.revision+1};return education;
 case 'searchPeople':return {rows:[{id:'teacher',name:'Преподаватель Проверочный',role:'teacher'}],hasMore:false};
 case 'getPerson':return {id:'teacher',name:'Преподаватель Проверочный',role:'teacher',education:{age:null},professional:{bio:'Описание преподавателя',education:'Высшее образование',qualification:'Первая категория',documents:[],position:'Преподаватель',experience_years:7}};
 case 'getGroupLessonTimes':return [{lesson_number:1,starts_at:'08:00:00',ends_at:'09:35:00'}];
 case 'exportSchedule':return {week:'2026-11-16',generatedAt:new Date().toISOString(),groups:[{group:{id:'g',name:'9241',course:'4',program:'Программирование',lessons_per_day:6},cells:[{weekday:1,lesson_number:1,status:'lesson',title:'Математика',teacher_label:'ФИО',room:'20',starts_at:'08:00:00',ends_at:'09:35:00'}]}]};
 case 'listActiveAttempts':return [];
 case 'listCuratorMessages':return {rows:messages.filter(m=>!data.after||BigInt(m.id)>BigInt(data.after))};
 case 'sendCuratorMessage':messages.push({id:String(messages.length+1),body:data.body,author_id:role,author_name:person.name,created_at:new Date().toISOString()});return {id:String(messages.length)};
 default:throw Error('Unexpected fixture action '+action);
 }};
}
(async()=>{
 fs.mkdirSync(path.join(root,'.qa-output'),{recursive:true});await new Promise(r=>server.listen(54321,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const role of ['guest','student','teacher','curator','admin']){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[],api=fixture(role);page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  if(role!=='guest'){
   await page.addInitScript(({role})=>{const user={uid:role,email:role+'@example.test',getIdToken:async()=>'fixture'};window.firebase={initializeApp(){},auth:()=>({currentUser:user,onAuthStateChanged:cb=>{queueMicrotask(()=>cb(user));return ()=>{};}})};},{role});
   await page.route('**/vendor/firebase/**/*.js*',r=>r.fulfill({contentType:'text/javascript',body:''}));
  }
  await page.route('**/functions/v1/lms*',async route=>{const r=route.request(),headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'};if(r.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});const u=new URL(r.url()),body=r.method()==='GET'?{action:u.searchParams.get('action'),data:JSON.parse(u.searchParams.get('data')||'{}')}:r.postDataJSON();try{await route.fulfill({headers,json:{data:api(body.action,body.data)}});}catch(e){errors.push(e.message);await route.fulfill({status:500,headers,json:{error:e.message}});}});
  await page.goto(base+(role==='curator'?'student':role)+'.html');await page.locator('.news-article').waitFor();
  assert.equal(await page.locator('.tabs [data-tab="home"]').textContent(),'Новости');
  assert.equal(await page.locator('.tabs [data-tab="announcements"]').count(),0);
  if(role!=='guest'){
   await page.setViewportSize({width:1280,height:580});await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(100);const profile=await page.locator('.tabs [data-tab="profile"]').boundingBox();assert.ok(profile.y>=0&&profile.y+profile.height<=580,role+' profile stays on screen');await page.evaluate(()=>window.scrollTo(0,1300));await page.waitForTimeout(100);const moved=await page.locator('.tabs [data-tab="profile"]').boundingBox();assert.ok(moved.y>=0&&moved.y+moved.height<=580,role+' sticky profile');await page.setViewportSize({width:1280,height:900});
  }
  await page.locator('#newsTag').selectOption('college');await page.locator('.news-tag[data-news-channel="college"]').waitFor();await page.locator('#newsOrder').selectOption('oldest');
  if(role!=='guest'){await page.locator('.news-like').click();await page.locator('.news-like[aria-pressed="true"]').waitFor();await page.locator('.news-like').click();await page.locator('.news-like[aria-pressed="false"]').waitFor();}
  assert.equal(await page.locator('.tabs [data-tab="curator-chat"]').count(),['admin','curator'].includes(role)?1:0);
  if(['admin','curator'].includes(role)){await page.locator('.tabs [data-tab="curator-chat"]').click();await page.locator('#chatBody').fill('<script>проверка</script>');await page.locator('[data-chat-form] button').click();await page.locator('.curator-message p').waitFor();assert.equal(await page.locator('.curator-message p').textContent(),'<script>проверка</script>');assert.equal(await page.locator('.curator-message script').count(),0);}
  if(['admin','curator'].includes(role)){await page.locator('.tabs [data-tab="home"]').click();await page.locator('[data-news-action="compose"]').click();await page.locator('#newsTitle').fill('Новая публикация');await page.locator('#newsBody').fill('Текст новости');assert.equal(await page.locator('#newsNotify').count(),role==='admin'?1:0);await page.locator('[data-news-form] [type="submit"]').click();await page.getByRole('heading',{name:'Новая публикация',exact:true}).waitFor();}
  if(['student','curator'].includes(role)){await page.locator('.tabs [data-tab="profile"]').click();await page.locator('#educationBirth').waitFor();await page.locator('#educationSpecialty').fill('Информационные системы');await page.getByRole('button',{name:'Сохранить учебные данные',exact:true}).click();await page.getByText('Учебные данные сохранены.',{exact:true}).waitFor();assert.match(await page.locator('[data-own-age]').textContent(),/18 лет/);}
  if(role!=='guest'){await page.locator('.tabs [data-tab="people"]').click();await page.getByRole('button',{name:'Открыть профиль',exact:true}).click();await page.getByText('Высшее образование',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Профиль преподавателя',exact:true}).count(),0);}
  if(role!=='guest'){await page.locator('.tabs [data-tab="notifications"]').click();await page.locator('.push-settings summary').click();await page.locator('[data-push-save]').waitFor();assert.equal(await page.locator('[data-push-schedule]').isChecked(),true);assert.equal(await page.locator('[data-push-announcements]').isChecked(),false);}
  await page.locator('.tabs [data-tab="home"]').click();await page.locator('.news-article').waitFor();await page.screenshot({path:path.join(root,'.qa-output',role+'-desktop.png'),fullPage:true});
  for(const width of [320,390]){await page.setViewportSize({width,height:844});await page.locator('#mobileNavigation [data-mobile-tab="schedule"]').click();await page.locator('#scheduleGroupSelect').selectOption('g');await page.locator('.schedule-week-grid').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,role+' schedule '+width);if(role!=='guest'){await page.locator('[data-reminder-toggle]').click();await page.locator('#lessonReminderDialog').waitFor();assert.equal(await page.locator('#lessonReminderDialog [type="submit"]').isDisabled(),true);await page.locator('[data-reminder-consent]').check();assert.equal(await page.locator('#lessonReminderDialog [type="submit"]').isEnabled(),true);await page.locator('[data-reminder-close]').click();}await page.locator('#mobileNavigation [data-mobile-tab="home"]').click();await page.locator('.news-article').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,role+' news '+width);}
  await page.screenshot({path:path.join(root,'.qa-output',role+'-mobile.png'),fullPage:true});assert.deepEqual(errors,[]);await context.close();console.log('PASS '+role+': news, filters, hearts, chat visibility, push settings, 320/390px');
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});

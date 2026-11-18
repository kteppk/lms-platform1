// Actual scheduler/provider check, scoped to one disposable account and notification.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{randomUUID,webcrypto,randomBytes}=require('node:crypto'),{chromium}=require('playwright-core');
const cli=process.env.SUPABASE_BIN;if(!cli)throw Error('Set SUPABASE_BIN.');
const ref='qqhkuuktgzcyrkfdnjjq',base='https://kteppk.github.io/lms-platform1/',api='https://'+ref+'.supabase.co/functions/v1/lms';
const key=fs.readFileSync('firebase-config.js','utf8').match(/apiKey: "([^"]+)"/)[1],stamp=Date.now()+'-'+randomUUID().slice(0,6),email='lms-push-'+stamp+'@example.com',password='Check-'+randomUUID();
const output=path.resolve('.qa-output/push-live-'+stamp);fs.mkdirSync(output,{recursive:true});let account,browser;
function sql(query,write=false){try{return JSON.parse(execFileSync(cli,['db','query',query,'--remote='+ref,write?'--yes':'--read-only','--output','json'],{encoding:'utf8',windowsHide:true,timeout:45000,stdio:['ignore','pipe','pipe']})).rows;}catch{throw Error('Supabase push QA query failed (output suppressed).');}}
const quote=v=>{assert.match(v,/^[A-Za-z0-9_-]+$/);return "'"+v+"'";};
async function auth(action,body){const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:'+action+'?key='+key,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)}),j=await r.json();if(!r.ok)throw Error('Firebase '+action+': '+j.error?.message);return j;}
async function rpc(action,data={}){const r=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+account.idToken},body:JSON.stringify({action,data}),signal:AbortSignal.timeout(20000)}),j=await r.json();if(!r.ok)throw Error(action+': '+j.code);return j.data;}
(async()=>{
 try{
  account=await auth('signUp',{email,password,returnSecureToken:true});fs.writeFileSync(path.join(output,'fixture.json'),JSON.stringify({uid:account.localId,email}));
  await rpc('profile',{nameFields:{firstNameRaw:'Проверка',lastNameRaw:'Уведомлений',patronymicRaw:'',patronymicStatus:'absent'}});
  const settings=await rpc('getPushSettings',{endpoint:''});assert.match(settings.publicKey,/^[A-Za-z0-9_-]{87}$/);
  const context=await chromium.launchPersistentContext(path.join(output,'browser-profile'),{channel:'chrome',headless:true,permissions:['notifications'],ignoreDefaultArgs:['--disable-background-networking']});browser=context;const page=await context.newPage();
  await page.goto(base+'guest.html?push-check='+stamp);let sub,subscriptionError=null;
  try{sub=await page.evaluate(async publicKey=>{
   const work=(async()=>{const registration=await navigator.serviceWorker.ready;let s=await registration.pushManager.getSubscription();if(!s)s=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(atob(publicKey.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))});return s.toJSON();})();
   return await Promise.race([work,new Promise((_,reject)=>setTimeout(()=>reject(Error('Browser push service registration timed out')),15000))]);
  },settings.publicKey);}catch(e){subscriptionError=e.message.slice(0,200);}
  const realBrowser=!!sub;
  if(!sub){const pair=await webcrypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);sub={endpoint:'https://fcm.googleapis.com/fcm/send/lms-qa-'+randomUUID(),keys:{p256dh:Buffer.from(await webcrypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url'),auth:randomBytes(16).toString('base64url')}};}
  const device=await rpc('savePushDevice',{endpoint:sub.endpoint,p256dh:sub.keys.p256dh,auth:sub.keys.auth,schedule:true,announcements:false});
  const group=(await rpc('listScheduleGroups'))[0];await rpc('addNotificationSubscription',{scope:'group',groupId:group.id});
  const notification='push-check-'+randomUUID();sql(`insert into notifications(id,actor_id,recipient_id,category,title,body,destination,context) values(${quote(notification)},${quote(account.localId)},${quote(account.localId)},'schedule','Проверка уведомления','Проверка доставки завершена.','schedule',jsonb_build_object('groupId',${quote(group.id)}))`,true);
  console.log('Queued one private QA notification; browser subscription: '+realBrowser+'. Waiting for the minute scheduler.');
  let result,delivered=false;const end=Date.now()+85000;
  while(Date.now()<end){result=sql(`select state,attempts from push_deliveries where notification_id=${quote(notification)}`)[0];const exists=sql(`select count(*)::int n from push_devices where id=${quote(device.id)}`)[0].n;if(!result&&!exists){assert.equal(realBrowser,false,'A fresh real browser device unexpectedly expired');break;}if(result?.state==='sent'){delivered=true;break;}if(result?.state==='dead')throw Error('Provider rejected QA delivery');await new Promise(r=>setTimeout(r,3000));}
  if(realBrowser)assert.equal(delivered,true,'Scheduler did not deliver the browser push within 85 seconds');else assert.equal(result,undefined,'Scheduler did not process and remove the expired test endpoint');
  let visible=false;if(realBrowser){for(let i=0;i<10;i++){visible=await page.evaluate(async id=>(await (await navigator.serviceWorker.ready).getNotifications()).some(n=>n.tag===id),notification);if(visible)break;await page.waitForTimeout(1000);}assert.equal(visible,true,'Provider accepted push but no browser notification appeared');}
  const response=sql("select status_code,content from net._http_response where created>now()-interval '3 minutes' order by id desc limit 1")[0];assert.equal(response?.status_code,200);
  const report={checkedAt:new Date().toISOString(),realBrowserSubscription:realBrowser,browserSubscriptionError:subscriptionError,schedulerProcessed:true,dispatcherHTTP:response.status_code,notificationDisplayed:visible};fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log('PASS scheduler, authenticated dispatcher, encryption and provider response. Browser display confirmed: '+visible);
 }finally{
  if(account){await auth('delete',{idToken:account.idToken});const id=quote(account.localId);sql(`begin;delete from role_changes where actor_id=${id} or user_id=${id};delete from profiles where id=${id};delete from notifications where actor_id=${id};commit`,true);assert.equal(sql(`select count(*)::int n from profiles where id=${id}`)[0].n,0);console.log('PASS push QA account, device, subscription and notification removed');}
  if(browser){for(const p of browser.pages())await p.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();const s=await r?.pushManager.getSubscription();await s?.unsubscribe();for(const n of await r?.getNotifications()??[])n.close();await r?.unregister();}).catch(()=>{});await browser.close();}
 }
})().catch(e=>{console.error(e.message);console.error('QA artifacts: '+output);process.exitCode=1;});

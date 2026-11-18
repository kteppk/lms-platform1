import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import {createRequire,registerHooks} from 'node:module';import {pathToFileURL} from 'node:url';import {Readable} from 'node:stream';import pg from 'pg';
import {createDatabase} from './db.mjs';import {createStorage} from './storage.mjs';import {createAuth} from './auth.mjs';
const require=createRequire(import.meta.url);registerHooks({resolve(specifier,context,next){if(specifier==='npm:jose@6.1.3')return {url:pathToFileURL(require.resolve('jose')).href,shortCircuit:true};return next(specifier,context);}});
globalThis.Deno={env:{get:key=>process.env[key]}};globalThis.EdgeRuntime={waitUntil:task=>task.catch(()=>{})};
pg.types.setTypeParser(1082,value=>value);pg.types.setTypeParser(1700,Number);
const env=process.env,publicURL=env.PUBLIC_URL,port=Number(env.PORT||8080);if(!publicURL?.startsWith('https://')||!env.DATABASE_URL||!env.TOKEN_SECRET||!env.STORAGE_SECRET)throw Error('Server configuration is incomplete');
const pool=new pg.Pool({connectionString:env.DATABASE_URL,max:8,idleTimeoutMillis:30000,connectionTimeoutMillis:10000,statement_timeout:20000});pool.on('error',()=>console.error('Database connection error'));
const files=createStorage({root:env.STORAGE_ROOT||'/var/lib/lms/storage',secret:env.STORAGE_SECRET,publicURL}),db=createDatabase(pool,files.storage);
const hashConfig=JSON.parse(await fs.readFile(env.FIREBASE_HASH_CONFIG||'/etc/lms/firebase-hash-config.json','utf8'));
const auth=createAuth({pool,secret:env.TOKEN_SECRET,publicURL,firebaseHashConfig:hashConfig});
const {createHandler}=await import('./runtime/lms/api.mjs'),{createPublicHandler}=await import('./runtime/lms-public/handler.mjs');
const {ApiError}=await import('./runtime/lms/shared.mjs');
const verifyLocal=async token=>{try{return await auth.verify(token);}catch(e){throw new ApiError(e.status||401,e.code||'unauthenticated',e.message);}};
const api=createHandler(db,verifyLocal),publicAPI=createPublicHandler(db,{background:task=>task.catch(()=>{})});
const server=http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,publicURL);if(u.pathname==='/healthz'){await pool.query('select 1');res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"ok":true}');return;}
  const max=u.pathname.startsWith('/storage/v1/')?55*1024*1024:1024*1024;if(Number(req.headers['content-length']||0)>max){res.writeHead(413);res.end();return;}
  const headers=new Headers();for(const [k,v]of Object.entries(req.headers))if(v!=null)headers.set(k,Array.isArray(v)?v.join(','):v);
  const request=new Request(publicURL+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});let response;
  if(u.pathname.startsWith('/auth/'))response=await auth.handle(request,req.headers['x-real-ip']||req.socket.remoteAddress);
  else if(u.pathname.startsWith('/storage/v1/'))response=await files.handle(request);
  else if(u.pathname==='/functions/v1/lms-public')response=await publicAPI(request);
  else if(u.pathname==='/functions/v1/lms'){
   const copy=request.clone();let body=null;try{body=await copy.json();}catch{}
   if(['listRecoveryRequests','createAccountRecovery'].includes(body?.action)){
    try{const identity=await auth.verify(request.headers.get('Authorization')?.replace(/^Bearer /,''));response=Response.json(await auth.adminAction(identity,body.action,body.data??{}),{headers:{'Cache-Control':'no-store'}});}catch(e){response=Response.json({code:e.code||'internal',error:e.status?e.message:'Не удалось выполнить запрос.'},{status:e.status||500});}
   }else response=await api(request);
  }else response=new Response(null,{status:404});
  res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
 }catch{res.writeHead(500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"code":"internal","error":"Сервер не смог выполнить запрос."}');}
});
server.requestTimeout=120000;server.headersTimeout=15000;server.listen(port,'127.0.0.1',()=>console.log('LMS server listening on 127.0.0.1:'+port));
let workerBusy=false;const {encryptPush,vapid}=await import('./runtime/lms-push/web-push.mjs'),{validPushEndpoint}=await import('./runtime/lms/push.mjs');
async function tick(){if(workerBusy)return;workerBusy=true;try{
 await pool.query('select public.enqueue_lesson_reminders()');await pool.query("delete from app_auth.sessions where expires_at<now(); delete from app_auth.reset_tokens where expires_at<now()-interval '7 days'");
 const {rows}=await pool.query('select public.claim_browser_push() jobs');const queue=[...(rows[0].jobs??[])];
 async function worker(){while(queue.length){const job=queue.shift();let status=503;try{
  if(!validPushEndpoint(job.endpoint))status=410;else if(job.payload.category==='lesson'&&Date.parse(job.payload.expiresAt)<=Date.now())status=400;
  else{const body=await encryptPush(job.p256dh,job.auth,JSON.stringify(job.payload));const ttl=job.payload.category==='lesson'?String(Math.max(1,Math.min(60,Math.floor((Date.parse(job.payload.expiresAt)-Date.now())/1000)))):'3600';
   const response=await fetch(job.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:await vapid(job.endpoint,env.WEB_PUSH_PUBLIC_KEY,env.WEB_PUSH_PRIVATE_KEY,publicURL),'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream',TTL:ttl,Urgency:'normal'},body});status=response.status;await response.body?.cancel();}
 }catch{status=503;}await pool.query('select public.finish_browser_push($1,$2,$3)',[job.id,job.lease,status]);}}
 await Promise.all([worker(),worker(),worker()]);
 }catch{console.error('Scheduled task failed; will retry next minute');}finally{workerBusy=false;}}
let timer;function schedule(){timer=setTimeout(async()=>{await tick();schedule();},60000-Date.now()%60000);}if(env.WORKER_ENABLED!=='0')schedule();
process.on('SIGTERM',()=>{clearTimeout(timer);server.close(()=>pool.end().then(()=>process.exit(0)));});

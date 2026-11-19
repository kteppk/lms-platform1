// PostgreSQL NOTIFY -> scoped SSE invalidations. Data still comes from the API.
const kinds=new Set(['news','chat','chat-unread','groups','schedule','notices','subscriptions','results','content','settings','accounts','people','profile','permissions','session','resync','presence']);
export function permittedTopics(event,client){
 const k=event.kind,uid=client.uid,role=client.role;
 if(k==='news'||k==='groups')return [k];
 if(k==='schedule')return event.groupId&&event.groupId===client.groupId?['schedule']:[];
 if(!uid)return [];
 if(k==='presence')return role==='admin'?['presence']:[];
 if(k==='chat'||k==='chat-unread')return ['curator','admin'].includes(role)&&(!event.userId||event.userId===uid)?[k]:[];
 if(k==='notices')return !event.userId||event.userId===uid?['notices']:[];
 if(['subscriptions','profile'].includes(k))return event.userId===uid?[k]:[];
 if(k==='results')return event.userId===uid||event.teacherId===uid&&['teacher','admin'].includes(role)?['results']:[];
 if(k==='accounts')return role==='admin'?['accounts']:[];
 if(['content','settings','people'].includes(k))return [k];
 return [];
}

export function createRealtime({pool,authenticate,createListener,publicURL,onChange=()=>{},heartbeatMs=15000,batchMs=80}){
 const clients=new Set();let listener=null,stopped=false,available=false,retryTimer,flushTimer,retry=1000,pending=[],flushing=false;
 const frame=(client,event,data)=>{
  if(client.res.destroyed)return false;
  if(client.res.writableLength>16384){client.res.destroy();return false;}
  client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);return true;
 };
 function close(client){if(clients.delete(client))publish({kind:'presence'});client.res.end();}
 async function validate(){
  const hashes=[...new Set([...clients].filter(c=>c.uid).map(c=>c.sessionHash))];if(!hashes.length)return;
  const {rows}=await pool.query(`select s.token_hash,u.id,coalesce(r.role,'student') role from app_auth.sessions s join app_auth.users u on u.id=s.user_id
   left join public.account_roles r on r.user_id=u.id where s.token_hash=any($1::text[]) and s.expires_at>now() and not u.disabled`,[hashes]);
  const active=new Map(rows.map(r=>[r.token_hash,r]));
  for(const c of [...clients])if(c.uid){const account=active.get(c.sessionHash);
   if(!account||account.id!==c.uid){frame(c,'session',{});close(c);}
   else if(c.role!==account.role){frame(c,'permissions',{});close(c);}
  }
 }
 async function flush(){
  flushTimer=null;if(flushing)return;flushing=true;const events=pending;pending=[];
  try{
   await validate();
   for(const c of [...clients]){
    const topics=new Set();let resync=false;
    for(const e of events){if(e.kind==='resync')resync=true;else for(const t of permittedTopics(e,c))topics.add(t);}
    if(resync)frame(c,'refresh',{topics:['resync']});else if(topics.size)frame(c,'refresh',{topics:[...topics]});
   }
  }catch{for(const c of clients)c.res.destroy();clients.clear();}
  finally{flushing=false;if(pending.length&&!flushTimer)flushTimer=setTimeout(flush,batchMs);}
 }
 function publish(event){
  if(stopped||!event||!kinds.has(event.kind))return;
  onChange(event);
  if(pending.length<512)pending.push(event);else pending=[{kind:'resync'}];
  if(!flushTimer)flushTimer=setTimeout(flush,batchMs);
 }
 async function connect(){
  if(stopped)return;const db=createListener();listener=db;
  let lost=false;const disconnected=()=>{if(lost||stopped||listener!==db)return;lost=true;available=false;db.end().catch(()=>{});
   for(const c of clients)c.res.destroy();clients.clear();
   retryTimer=setTimeout(connect,retry+Math.random()*500);retry=Math.min(30000,retry*2);
  };
  db.on('error',disconnected);db.on('end',disconnected);
  db.on('notification',message=>{if(message.channel!=='lms_changes')return;try{publish(JSON.parse(message.payload));}catch{}});
  try{await db.connect();if(stopped){await db.end();return;}await db.query('LISTEN lms_changes');available=true;retry=1000;publish({kind:'resync'});}catch{disconnected();}
 }
 const ping=setInterval(async()=>{if(stopped)return;try{await validate();for(const c of clients){if(c.res.writableLength>16384)c.res.destroy();else c.res.write(': keepalive\n\n');}}catch{for(const c of clients)c.res.destroy();clients.clear();}},heartbeatMs);ping.unref?.();
 async function handle(request,req,res){
  const url=new URL(request.url);const fail=status=>{res.writeHead(status,{'Cache-Control':'no-store'});res.end();};
  if(request.method!=='GET')return fail(405);
  if(request.headers.get('origin')&&request.headers.get('origin')!==publicURL||request.headers.get('sec-fetch-site')==='cross-site')return fail(403);
  if([...url.searchParams.keys()].some(k=>!['group','public'].includes(k))||url.searchParams.has('public')&&url.searchParams.get('public')!=='1')return fail(400);
  const groupId=url.searchParams.get('group');if(groupId!==null&&!/^[A-Za-z0-9_-]{1,128}$/.test(groupId))return fail(400);
  if(!available||stopped)return fail(503);
  const identity=url.searchParams.get('public')==='1'?null:await authenticate(request);
  if(!identity&&url.searchParams.get('public')!=='1')return fail(401);
  const ip=req.headers['x-real-ip']||req.socket?.remoteAddress;
  if(clients.size>=512||[...clients].filter(c=>identity?c.uid===identity.uid:!c.uid&&c.ip===ip).length>=(identity?12:64))return fail(429);
  const client={res,uid:identity?.uid??null,sessionHash:identity?.sessionHash,role:'guest',groupId,ip};
  if(identity){const {rows}=await pool.query('select role from public.account_roles where user_id=$1',[identity.uid]);client.role=rows[0]?.role??'student';}
  if(res.destroyed)return;res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});res.setTimeout?.(0);
  clients.add(client);res.on('close',()=>{if(clients.delete(client))publish({kind:'presence'});});res.write('retry: 3000\n\n');frame(client,'ready',{});publish({kind:'presence'});
 }
 function presence(){const accounts=new Map(),roles={student:0,teacher:0,curator:0,admin:0};let guestConnections=0;
  for(const c of clients)if(!c.res.destroyed){if(c.uid)accounts.set(c.uid,c.role);else guestConnections++;}
  for(const role of accounts.values())if(role in roles)roles[role]++;
  return {accounts:accounts.size,roles,guestConnections,updatedAt:new Date().toISOString(),available};
 }
 return {handle,publish,presence,start:connect,async close(){stopped=true;available=false;clearTimeout(retryTimer);clearTimeout(flushTimer);clearInterval(ping);for(const c of clients)close(c);await listener?.end().catch(()=>{});}};
}

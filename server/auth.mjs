import {randomBytes,randomUUID,createHash} from 'node:crypto';import {SignJWT,jwtVerify} from 'jose';import {hashPassword,verifyPassword} from './passwords.mjs';
const digest=v=>createHash('sha256').update(v).digest('hex');const cookieName='__Host-lms_session';
const publicUser=u=>({uid:u.id,email:u.email,displayName:u.display_name,emailVerified:u.email_verified});
export function createAuth({pool,secret,publicURL,firebaseHashConfig}){
 const signingKey=Buffer.from(secret,'base64'),buckets=new Map();let checks=0;
 function error(code,message,status=400){return Object.assign(new Error(message),{code,status});}
 function email(value){if(typeof value!=='string'||value.length>254||!/^\S+@\S+\.\S+$/.test(value.trim()))throw error('auth/invalid-email','Проверьте email.');return value.trim().toLowerCase();}
 function password(value){if(typeof value!=='string'||value.length<8||value.length>128)throw error('auth/weak-password','Пароль должен содержать от 8 до 128 символов.');return value;}
 function rate(key,limit,window=600000){const now=Date.now(),old=buckets.get(key);if(!old||old.until<now){buckets.set(key,{until:now+window,n:1});}else{if(old.n>=limit)throw error('auth/too-many-requests','Слишком много попыток. Попробуйте позже.',429);old.n++;}if(buckets.size>10000)for(const [k,v]of buckets)if(v.until<now)buckets.delete(k);}
 async function checked(pass,record){if(checks>=3)throw error('auth/too-many-requests','Сервер входа занят. Повторите немного позже.',429);checks++;try{return await verifyPassword(pass,record,firebaseHashConfig);}finally{checks--;}}
 async function jwt(user,authTime){return await new SignJWT({email:user.email,name:user.display_name,ver:user.token_version,auth_time:Math.floor(new Date(authTime).getTime()/1000)}).setProtectedHeader({alg:'HS256'}).setIssuer(publicURL).setAudience('lms-platform').setSubject(user.id).setIssuedAt().setExpirationTime('15m').sign(signingKey);}
 async function verify(token){try{const {payload}=await jwtVerify(token,signingKey,{issuer:publicURL,audience:'lms-platform',algorithms:['HS256'],requiredClaims:['sub','iat','exp','email','ver']});const u=(await pool.query('select id,email,display_name,disabled,token_version from app_auth.users where id=$1',[payload.sub])).rows[0];if(!u||u.disabled||u.token_version!==payload.ver)throw Error();return {uid:u.id,email:u.email,name:u.display_name};}catch{throw error('unauthenticated','Войдите в кабинет.',401);}}
 const cookie=(token,persistent,remove=false)=>cookieName+'='+token+'; Path=/; Secure; HttpOnly; SameSite=Lax'+(remove?'; Max-Age=0':persistent?'; Max-Age=2592000':'');
 async function session(request){const cookies=request.headers.get('cookie')||'',sid=cookies.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);if(!sid)return null;return (await pool.query('select u.*,s.token_hash,s.last_auth_at,s.persistent from app_auth.sessions s join app_auth.users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now() and not u.disabled',[digest(sid)])).rows[0]??null;}
 async function result(user,authTime,headers={}){return Response.json({user:publicUser(user),token:await jwt(user,authTime),expiresAt:Date.now()+14*60000},{headers:{'Cache-Control':'no-store',...headers}});}
 async function start(user,persistent){const sid=randomBytes(32).toString('base64url'),at=new Date();await pool.query("insert into app_auth.sessions(token_hash,user_id,expires_at,persistent,last_auth_at) values($1,$2,now()+interval '30 days',$3,$4)",[digest(sid),user.id,persistent,at]);await pool.query('update app_auth.users set last_login_at=now() where id=$1',[user.id]);return result(user,at,{'Set-Cookie':cookie(sid,persistent)});}
 async function handle(request,ip){
  const action=new URL(request.url).pathname.slice('/auth/'.length);
  try{
   if(request.method==='GET'&&action==='session'){const u=await session(request);return u?await result(u,u.last_auth_at):Response.json({user:null},{headers:{'Cache-Control':'no-store'}});}
   if(request.method!=='POST')return new Response(null,{status:405});
   if(request.headers.get('origin')!==publicURL||!request.headers.get('content-type')?.startsWith('application/json'))throw error('auth/forbidden','Запрос отклонён.',403);
   const raw=await request.text();if(raw.length>4096)throw error('auth/invalid-argument','Слишком большой запрос.');const body=JSON.parse(raw);
   if(action==='login'){
    const address=email(body.email);rate('login-ip:'+ip,120);rate('login-mail:'+address,30);if(typeof body.password!=='string'||body.password.length>128)throw error('auth/invalid-credential','Проверьте email и пароль.',401);
    const u=(await pool.query('select * from app_auth.users where lower(email)=$1',[address])).rows[0];
    const valid=u?await checked(body.password,u.password):await checked(body.password,{algorithm:'scrypt',salt:Buffer.alloc(24).toString('base64'),hash:Buffer.alloc(32).toString('base64')});
    if(!valid||!u||u.disabled)throw error('auth/invalid-credential','Проверьте email и пароль.',401);
    if(u.password.algorithm==='firebase-scrypt')await pool.query('update app_auth.users set password=$1 where id=$2',[await hashPassword(body.password),u.id]);return await start(u,body.persistent!==false);
   }
   if(action==='signup'){
    rate('signup:'+ip,100,3600000);const address=email(body.email),pass=password(body.password),u={id:randomUUID(),email:address,display_name:'',email_verified:false,token_version:0};
    try{await pool.query('insert into app_auth.users(id,email,password) values($1,$2,$3)',[u.id,address,await hashPassword(pass)]);}catch(e){if(e.code==='23505')throw error('auth/email-already-in-use','Этот аккаунт уже существует.');throw e;}return await start(u,body.persistent!==false);
   }
   if(action==='recover'){
    rate('recover-ip:'+ip,10,3600000);const address=email(body.email),u=(await pool.query('select id from app_auth.users where lower(email)=$1',[address])).rows[0];
    if(u)await pool.query('insert into app_auth.recovery_requests(email,user_id) values($1,$2) on conflict do nothing',[address,u.id]);return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
   }
   if(action==='reset'){
    rate('reset:'+ip,30);const pass=password(body.password),token=typeof body.token==='string'?body.token:'';if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw error('auth/invalid-action-code','Ссылка недействительна.');
    const client=await pool.connect();try{await client.query('begin');const row=(await client.query('select * from app_auth.reset_tokens where token_hash=$1 and used_at is null and expires_at>now() for update',[digest(token)])).rows[0];if(!row)throw error('auth/invalid-action-code','Ссылка недействительна или устарела. Обратитесь к администратору.');await client.query('update app_auth.users set password=$1,token_version=token_version+1 where id=$2',[await hashPassword(pass),row.user_id]);await client.query('delete from app_auth.sessions where user_id=$1',[row.user_id]);await client.query('update app_auth.reset_tokens set used_at=now() where token_hash=$1',[digest(token)]);if(row.request_id)await client.query("update app_auth.recovery_requests set state='used' where id=$1",[row.request_id]);await client.query('commit');return Response.json({ok:true});}catch(e){await client.query('rollback');throw e;}finally{client.release();}
   }
   const u=await session(request);if(!u)throw error('auth/requires-recent-login','Войдите заново.',401);
   if(action==='logout'){await pool.query('delete from app_auth.sessions where token_hash=$1',[u.token_hash]);return Response.json({ok:true},{headers:{'Set-Cookie':cookie('',false,true)}});}
   if(action==='profile'){const name=typeof body.displayName==='string'?body.displayName.trim().slice(0,800):'';await pool.query('update app_auth.users set display_name=$1 where id=$2',[name,u.id]);u.display_name=name;return await result(u,u.last_auth_at);}
   if(action==='reauth'){
    rate('reauth:'+u.id,20);if(email(body.email)!==u.email.toLowerCase()||!await checked(body.password,u.password))throw error('auth/wrong-password','Неверный старый пароль.',401);const at=new Date();await pool.query('update app_auth.sessions set last_auth_at=$1 where token_hash=$2',[at,u.token_hash]);return await result(u,at);
   }
   if(action==='password'){
    if(Date.now()-new Date(u.last_auth_at).getTime()>300000)throw error('auth/requires-recent-login','Повторите проверку старого пароля.',401);
    const client=await pool.connect();try{await client.query('begin');await client.query('update app_auth.users set password=$1,token_version=token_version+1 where id=$2',[await hashPassword(password(body.password)),u.id]);await client.query('delete from app_auth.sessions where user_id=$1 and token_hash<>$2',[u.id,u.token_hash]);await client.query('commit');u.token_version++;return await result(u,u.last_auth_at);}catch(e){await client.query('rollback');throw e;}finally{client.release();}
   }
   if(action==='delete'){if(Date.now()-new Date(u.last_auth_at).getTime()>300000)throw error('auth/requires-recent-login','Войдите заново.',401);const admin=(await pool.query("select role from public.account_roles where user_id=$1",[u.id])).rows[0];if(admin?.role==='admin')throw error('auth/operation-not-allowed','Удаление аккаунта администратора выполняется через обслуживание платформы.',403);await pool.query('delete from app_auth.users where id=$1',[u.id]);return Response.json({ok:true},{headers:{'Set-Cookie':cookie('',false,true)}});}
   return new Response(null,{status:404});
  }catch(e){return Response.json({error:e.status?e.message:'Не удалось выполнить операцию входа.',code:e.code||'auth/internal-error'},{status:e.status??400,headers:{'Cache-Control':'no-store'}});}
 }
 async function adminAction(identity,action,input){
  if(!['listRecoveryRequests','createAccountRecovery'].includes(action))return null;
  if((await pool.query('select role from public.account_roles where user_id=$1',[identity.uid])).rows[0]?.role!=='admin')throw error('permission-denied','Только для администрации.',403);
  if(action==='listRecoveryRequests')return {data:(await pool.query("select r.id,r.email,r.state,r.created_at,p.name from app_auth.recovery_requests r left join public.profiles p on p.id=r.user_id where r.state='open' order by r.created_at limit 100")).rows};
  if(typeof input.userId!=='string')throw error('invalid-argument','Выберите аккаунт.');
  const u=(await pool.query('select id from app_auth.users where id=$1',[input.userId])).rows[0];if(!u)throw error('not-found','Аккаунт не найден.',404);
  const token=randomBytes(32).toString('base64url'),request=(await pool.query("select id from app_auth.recovery_requests where user_id=$1 and state='open' order by created_at limit 1",[u.id])).rows[0];
  await pool.query('insert into app_auth.reset_tokens(token_hash,user_id,created_by,request_id,expires_at) values($1,$2,$3,$4,now()+interval \'30 minutes\')',[digest(token),u.id,identity.uid,request?.id??null]);
  if(request)await pool.query("update app_auth.recovery_requests set state='issued' where id=$1",[request.id]);return {data:{url:publicURL+'/index.html?reset='+token,expiresInMinutes:30}};
 }
 const streamIdentity=async request=>{const u=await session(request);return u?{uid:u.id,sessionHash:u.token_hash}:null;};
 return {handle,verify,adminAction,streamIdentity};
}

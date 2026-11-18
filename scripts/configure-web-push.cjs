// One-time installation. Credentials exist only in a temporary directory removed in finally.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{webcrypto,randomBytes}=require('node:crypto');
const cli=process.env.SUPABASE_BIN;if(!cli)throw Error('Set SUPABASE_BIN to the native Supabase executable.');
const ref='qqhkuuktgzcyrkfdnjjq';
function run(args){try{return execFileSync(cli,args,{encoding:'utf8',windowsHide:true,timeout:90000,stdio:['ignore','pipe','pipe']});}catch(e){if(args[1]==='list')console.error(e.stderr?.toString().slice(-1800));throw Error('Supabase '+args.slice(0,2).join(' ')+' failed; credential-bearing output has been suppressed.');}}
const sql=s=>JSON.parse(run(['db','query',s,'--remote='+ref,'--read-only','--output','json'])).rows;
(async()=>{
 const listed=JSON.parse(run(['secrets','list','--remote='+ref,'--output','json']));
 const names=(Array.isArray(listed)?listed:listed.secrets).map(s=>s.name);
 const required=['WEB_PUSH_PUBLIC_KEY','WEB_PUSH_PRIVATE_KEY','WEB_PUSH_DISPATCH_SECRET'];
 if(required.every(n=>names.includes(n))){
  const rows=sql("select count(*)::int n from cron.job where jobname='lms-web-push'");if(rows[0].n!==1)throw Error('Push keys exist but the scheduler needs repair.');console.log('Push keys and scheduler are already configured.');return;
 }
 if(required.some(n=>names.includes(n)))throw Error('Partial existing push configuration; refusing to rotate device keys.');
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const jwk=await webcrypto.subtle.exportKey('jwk',pair.privateKey),publicKey=Buffer.from(await webcrypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url'),dispatch=randomBytes(32).toString('hex');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lms-push-setup-'));
 try{
  const env=path.join(dir,'push.env'),query=path.join(dir,'install.sql');
  fs.writeFileSync(env,`WEB_PUSH_PUBLIC_KEY=${publicKey}\nWEB_PUSH_PRIVATE_KEY=${jwk.d}\nWEB_PUSH_DISPATCH_SECRET=${dispatch}\nWEB_PUSH_SUBJECT=https://kteppk.github.io/lms-platform1/\n`,{mode:0o600});
  fs.writeFileSync(query,`begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$ begin
 if exists(select 1 from vault.secrets where name='lms_push_dispatch_secret') then
  perform vault.update_secret((select id from vault.secrets where name='lms_push_dispatch_secret'),'${dispatch}');
 else perform vault.create_secret('${dispatch}','lms_push_dispatch_secret'); end if;
end; $$;
select cron.schedule('lms-web-push','* * * * *',$job$
 select public.enqueue_lesson_reminders();
 select net.http_post(url:='https://${ref}.supabase.co/functions/v1/lms-push',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='lms_push_dispatch_secret')),
 body:='{}'::jsonb,timeout_milliseconds:=55000)
 where exists(select 1 from public.push_deliveries where state='pending' and next_at<=now() and (locked_until is null or locked_until<now()));
$job$);
commit;`,{mode:0o600});
  run(['db','query','--file',query,'--remote='+ref,'--yes','--output','json']);
  run(['secrets','set','--remote='+ref,'--env-file',env,'--yes']);
  console.log('Push keys installed. The minute scheduler invokes delivery only when work is queued.');
 }finally{for(const name of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,name));fs.rmdirSync(dir);}
})().catch(e=>{console.error(e.message);process.exitCode=1;});

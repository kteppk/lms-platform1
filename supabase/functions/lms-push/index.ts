import {createClient} from 'npm:@supabase/supabase-js@2.89.0';
import {encryptPush,vapid} from './web-push.ts';import {validPushEndpoint} from '../lms/push.ts';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
Deno.serve(async request=>{
 const expected=Deno.env.get('WEB_PUSH_DISPATCH_SECRET'),provided=request.headers.get('Authorization');
 if(request.method!=='POST'||!expected||provided!=='Bearer '+expected)return new Response(null,{status:403});
 const publicKey=Deno.env.get('WEB_PUSH_PUBLIC_KEY'),privateKey=Deno.env.get('WEB_PUSH_PRIVATE_KEY');if(!publicKey||!privateKey)return new Response(null,{status:503});
 const {data:jobs,error}=await db.rpc('claim_browser_push');if(error)return new Response(null,{status:503});
 let sent=0;const queue=[...(jobs??[])];
 async function worker(){while(queue.length){const job=queue.shift();let status=503;try{
  if(!validPushEndpoint(job.endpoint))status=410;
  else {const body=await encryptPush(job.p256dh,job.auth,JSON.stringify(job.payload));const response=await fetch(job.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:await vapid(job.endpoint,publicKey!,privateKey!,Deno.env.get('WEB_PUSH_SUBJECT')||'https://kteppk.github.io/lms-platform1/'),'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream',TTL:'3600',Urgency:'normal'},body});status=response.status;await response.body?.cancel();}
 }catch{status=503;}if(status>=200&&status<300)sent++;await db.rpc('finish_browser_push',{p_id:job.id,p_lease:job.lease,p_status:status});}}
 await Promise.all([worker(),worker(),worker()]);return Response.json({processed:jobs?.length??0,sent});
});

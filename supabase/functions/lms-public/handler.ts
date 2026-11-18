import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.89.0';
import {syncGitHubNews} from '../lms/news.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'if-none-match','Access-Control-Max-Age':'600','Access-Control-Expose-Headers':'ETag, Date','X-Content-Type-Options':'nosniff'};
type Entry={body:string;etag:string;saved:number};
function monday(now:Date){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Krasnoyarsk',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));const d=new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);}
export function createPublicHandler(db:SupabaseClient,options:{now?:()=>Date;background?:(task:Promise<unknown>)=>void;sync?:()=>Promise<unknown>}={}){
 const cache=new Map<string,Entry>(),pending=new Map<string,Promise<Entry>>();let syncAt=0;
 const now=options.now??(()=>new Date());
 return async(request:Request)=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const error=(message:string,status:number)=>Response.json({error:message},{status,headers:{...cors,'Cache-Control':'no-store'}});
  if(!['GET','HEAD'].includes(request.method))return error('Доступно только чтение.',405);
  const url=new URL(request.url),view=url.searchParams.get('view')||'bootstrap',group=url.searchParams.get('group'),post=url.searchParams.get('post'),week=url.searchParams.get('week')||monday(now()),offset=Number(url.searchParams.get('offset')||0);
  if(url.searchParams.has('action')){
   const action=url.searchParams.get('action');if(!['listNews','listScheduleGroups','getWeeklySchedule','listSchedule','exportSchedule'].includes(action??''))return error('Гостю доступны только новости и расписание.',403);
   let input:Record<string,unknown>;try{const raw=url.searchParams.get('data')||'{}';if(raw.length>3000)throw Error();input=JSON.parse(raw);if(!input||typeof input!=='object'||Array.isArray(input))throw Error();}catch{return error('Некорректный запрос.',400);}
   const {data,error:failure}=action==='exportSchedule'?await db.rpc('schedule_export_snapshot',{p_group:input.groupId??null,p_week:input.week??null}):await db.rpc('guest_read',{p_action:action,p_input:input});if(failure)return error('Не удалось загрузить данные.',failure.code==='P0002'?404:['22023','22P02','22007','22008'].includes(failure.code)?400:503);
   if(options.background&&action==='listNews'&&now().getTime()-syncAt>120000){syncAt=now().getTime();options.background((options.sync??(()=>syncGitHubNews(db)))().catch(()=>{}));}
   return new Response(request.method==='HEAD'?null:JSON.stringify({data}),{headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=10, stale-if-error=300'}});
  }
  if([...url.searchParams.keys()].some(k=>!['view','group','post','week','offset','fresh'].includes(k))||(url.searchParams.has('fresh')&&url.searchParams.get('fresh')!=='1')||!['bootstrap','schedule','news','post'].includes(view)||!Number.isSafeInteger(offset)||offset<0||offset>10000||offset%10||
   [group,post].some(v=>v!==null&&!/^[A-Za-z0-9_-]{1,128}$/.test(v))||!/^\d{4}-\d{2}-\d{2}$/.test(week)||!Number.isFinite(Date.parse(week))||new Date(week).toISOString().slice(0,10)!==week||new Date(week).getUTCDay()!==1||
   (view==='post'&&!post)||(view==='schedule'&&!group))return error('Некорректный запрос.',400);
  const key=JSON.stringify([view,group,week,offset,post]),time=now().getTime();
  try{
   let entry=cache.get(key);
   if(!entry||time-entry.saved>=5000||url.searchParams.get('fresh')==='1'){
    let task=pending.get(key);
    if(!task){if(pending.size>=64)return error('Сервер занят. Повторите позже.',503);task=(async()=>{const {data,error}=await db.rpc('lite_public_snapshot',{p_view:view,p_group_id:group,p_week:week,p_offset:offset,p_post_id:post});if(error)throw error;
     const body=JSON.stringify(data),bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body))),etag='"'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')+'"';
     const result={body,etag,saved:time};cache.set(key,result);while(cache.size>64)cache.delete(cache.keys().next().value!);return result;})();pending.set(key,task);task.finally(()=>pending.delete(key)).catch(()=>{});}
    entry=await task;
   }
   if(options.background&&(view==='news'||view==='bootstrap')&&time-syncAt>120000){syncAt=time;options.background((options.sync??(()=>syncGitHubNews(db)))().catch(()=>{}));}
   const headers={...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=10, stale-if-error=300','ETag':entry.etag};
   if(request.headers.get('If-None-Match')===entry.etag)return new Response(null,{status:304,headers});
   return new Response(request.method==='HEAD'?null:entry.body,{headers});
  }catch(e){const code=(e as {code?:string})?.code;if(code==='P0002')return error(view==='post'?'Новость не найдена.':'Группа не найдена.',404);if(code==='22023')return error('Некорректный запрос.',400);return error('Не удалось обновить данные. Попробуйте позже.',503);}
 };
}

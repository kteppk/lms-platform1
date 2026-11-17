import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.89.0';
import {dataOf,text,invalid} from './shared.ts';import type {Actor,Input} from './shared.ts';
export function validPushEndpoint(value:string){try{const u=new URL(value);return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&!u.hash&&(['fcm.googleapis.com','android.googleapis.com','web.push.apple.com'].includes(u.hostname)||u.hostname.endsWith('.push.services.mozilla.com')||u.hostname.endsWith('.notify.windows.com'));}catch{return false;}}
export async function pushAction(db:SupabaseClient,actor:Actor,action:unknown,input:Input){
 if(!['getPushSettings','savePushDevice','removePushDevice'].includes(String(action)))return null;
 const endpoint=text(input.endpoint??'',2500,'Адрес устройства',true);
 if(action==='getPushSettings')return {data:{publicKey:Deno.env.get('WEB_PUSH_PUBLIC_KEY')??null,device:endpoint?await dataOf(db.from('push_devices').select('id,schedule,announcements').eq('user_id',actor.uid).eq('endpoint',endpoint).maybeSingle()):null}};
 if(!validPushEndpoint(endpoint))invalid('Браузер вернул неподдерживаемый адрес уведомлений.');
 if(action==='removePushDevice')return {data:await dataOf(db.from('push_devices').delete().eq('user_id',actor.uid).eq('endpoint',endpoint).select('id'))};
 const key=text(input.p256dh,100,'Ключ'),auth=text(input.auth,40,'Ключ');
 if(!/^[A-Za-z0-9_-]{87}$/.test(key)||!/^B/.test(key)||!/^[A-Za-z0-9_-]{22}$/.test(auth)||typeof input.schedule!=='boolean'||typeof input.announcements!=='boolean')invalid('Некорректная подписка браузера.');
 return {data:await dataOf(db.rpc('save_push_device',{p_user:actor.uid,p_endpoint:endpoint,p_key:key,p_auth:auth,p_schedule:input.schedule,p_announcements:input.announcements}))};
}

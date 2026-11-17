import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.89.0';
import {ApiError,dataOf,id,text,invalid} from './shared.ts';
import type {Actor,Input} from './shared.ts';
export async function chatAction(db:SupabaseClient,actor:Actor,action:unknown,input:Input){
 if(!['listCuratorMessages','sendCuratorMessage'].includes(String(action)))return null;
 if(!['admin','curator'].includes(actor.role))throw new ApiError(403,'permission-denied','Чат доступен только кураторам и администрации.');
 const cursor=(v:unknown)=>{if(v==null)return null;if(typeof v!=='string'||!/^\d{1,18}$/.test(v))invalid('Некорректная страница.');return v;};
 return {data:await dataOf(action==='listCuratorMessages'?db.rpc('curator_chat_feed',{p_user:actor.uid,p_before:cursor(input.before),p_after:cursor(input.after)}):db.rpc('send_curator_message',{p_user:actor.uid,p_body:text(input.body,4000,'Сообщение'),p_client_id:id(input.clientId)}))};
}

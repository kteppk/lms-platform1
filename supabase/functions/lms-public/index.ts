import {createClient} from 'npm:@supabase/supabase-js@2.89.0';
import {createPublicHandler} from './handler.ts';
const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if(!url||!key)throw new Error('Supabase credentials missing');
const runtime=globalThis as unknown as {EdgeRuntime?:{waitUntil(task:Promise<unknown>):void}};
Deno.serve(createPublicHandler(createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),
 {background:task=>{if(runtime.EdgeRuntime)runtime.EdgeRuntime.waitUntil(task);else task.catch(()=>{});}}));

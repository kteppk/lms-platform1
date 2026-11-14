import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.89.0';
import { dataOf, id, invalid, missing, requireAdmin, text } from './shared.ts';
import type { Actor, Input } from './shared.ts';
const bucket='lms-profiles',imageTypes=['image/jpeg','image/png','image/webp'];
function revision(v:unknown){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)invalid('Обновите профиль перед сохранением.');return v;}
function owned(actor:Actor,path:unknown):string{if(typeof path!=='string'||!path.startsWith(actor.uid+'/')||!/^[A-Za-z0-9_-]+$/.test(path.slice(actor.uid.length+1)))invalid('Можно использовать только свой файл фотографии.');return path;}
async function signed(db:SupabaseClient,paths:string[]){
  const rows=paths.length?await dataOf(db.storage.from(bucket).createSignedUrls([...new Set(paths)],3600)):[];
  return new Map((rows??[]).filter(r=>r.path&&!r.error).map(r=>[r.path,r.signedUrl]));
}
export async function ownAvatar(db:SupabaseClient,uid:string){
  const row=await dataOf(db.from('account_avatars').select('path,revision').eq('user_id',uid).maybeSingle());
  const links=await signed(db,row?.path?[row.path]:[]);
  return {avatarUrl:links.get(row?.path)??null,avatarRevision:row?.revision??0};
}
export async function removeUnusedPhoto(db:SupabaseClient,path:string){
  const [avatar,document]=await Promise.all([
    dataOf(db.from('account_avatars').select('user_id').eq('path',path).maybeSingle()),
    dataOf(db.from('teacher_documents').select('id').eq('path',path).maybeSingle())]);
  if(avatar||document)return false;
  await dataOf(db.storage.from(bucket).remove([path]));return true;
}
export async function peopleAction(db:SupabaseClient,actor:Actor,action:unknown,input:Input):Promise<{data:unknown}|null>{
  let data:unknown;
  switch(action){
    case 'searchPeople':{
      const offset=input.offset??0;
      if(typeof offset!=='number'||!Number.isSafeInteger(offset)||offset<0||offset>100000)invalid('Некорректная страница.');
      const role=text(input.role??'',20,'Роль',true);if(!['','student','teacher','admin'].includes(role))invalid('Выберите роль.');
      const result=await dataOf(db.rpc('people_directory',{p_search:text(input.search??'',200,'Поиск',true),p_role:role,p_offset:offset}));
      const rows=result.rows.slice(0,30),links=await signed(db,rows.flatMap((p:Input)=>p.avatar_path?[String(p.avatar_path)]:[]));
      data={hasMore:result.hasMore,rows:rows.map((p:Input)=>({...p,avatarUrl:links.get(String(p.avatar_path))??null,avatar_path:undefined}))};break;
    }
    case 'getPerson':{
      const uid=id(input.userId),p=await dataOf(db.from('profiles').select('id,name').eq('id',uid).maybeSingle());
      if(!p)missing('Пользователь не найден.');
      const [role,teacher,photo]=await Promise.all([
        dataOf(db.from('account_roles').select('role').eq('user_id',uid).maybeSingle()),
        dataOf(db.from('teacher_directory').select('id').eq('id',uid).maybeSingle()),ownAvatar(db,uid)]);
      data={...p,role:role?.role??'student',avatarUrl:photo.avatarUrl,hasTeacherProfile:!!teacher};break;
    }
    case 'createAvatarUpload':{
      if(!imageTypes.includes(String(input.mime)))invalid('Выберите JPG, PNG или WebP.');
      if(typeof input.size!=='number'||!Number.isSafeInteger(input.size)||input.size<1||input.size>5*1024*1024)invalid('Фото должно быть не больше 5 МБ.');
      const path=actor.uid+'/'+crypto.randomUUID(),grant=await dataOf(db.storage.from(bucket).createSignedUploadUrl(path));
      if(!grant)throw new Error('Не удалось подготовить загрузку.');
      data={path,url:grant.signedUrl};break;
    }
    case 'saveMyAvatar':{
      const path=input.path===null?null:owned(actor,input.path);
      if(path){const info=await dataOf(db.storage.from(bucket).info(path));if(!info||!imageTypes.includes(info.contentType??'')||typeof info.size!=='number'||!Number.isFinite(info.size)||info.size<1||info.size>5*1024*1024)invalid('Фотография не загружена, слишком большая или имеет неверный формат.');}
      const previous=await dataOf(db.from('account_avatars').select('path').eq('user_id',actor.uid).maybeSingle());
      await dataOf(db.rpc('save_account_avatar',{p_user_id:actor.uid,p_path:path,p_revision:revision(input.revision)}));
      // Cleanup failure must not turn an already committed save into an error.
      if(previous?.path&&previous.path!==path)await removeUnusedPhoto(db,previous.path).catch(()=>{});
      data=await ownAvatar(db,actor.uid);break;
    }
    case 'removeAvatarUpload':data=await removeUnusedPhoto(db,owned(actor,input.path));break;
    case 'getPortalSettings':{
      const r=await dataOf(db.from('portal_settings').select('feedback_url,revision').eq('singleton',true).single());
      if(!r)throw new Error('Настройки платформы не найдены.');
      data={feedbackUrl:r.feedback_url,revision:r.revision};break;
    }
    case 'savePortalSettings':{
      requireAdmin(actor);let url:string|null=text(input.feedbackUrl??'',2000,'Ссылка формы',true)||null;
      if(url){let parsed:URL;try{parsed=new URL(url);}catch{invalid('Укажите HTTPS-ссылку Google Формы.');}
        if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||!((parsed.hostname==='forms.gle'&&parsed.pathname.length>1)||(parsed.hostname==='docs.google.com'&&parsed.pathname.startsWith('/forms/'))))invalid('Укажите ссылку forms.gle или docs.google.com/forms.');url=parsed.href;}
      data=await dataOf(db.rpc('save_portal_settings',{p_actor_id:actor.uid,p_feedback_url:url,p_revision:revision(input.revision)}));break;
    }
    default:return null;
  }
  return {data};
}

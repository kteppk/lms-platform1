import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.89.0';
import { ApiError, dataOf, id, invalid, missing, requireAdmin, text } from './shared.ts';
import type { Actor, Input } from './shared.ts';

const profileBucket='lms-profiles';
const imageTypes=['image/jpeg','image/png','image/webp'];
function pageOffset(value:unknown) {
  if(value===undefined)return 0;
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>100000)invalid('Некорректная страница.');
  return value;
}
function revision(value:unknown) {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)invalid('Обновите страницу перед сохранением.');
  return value;
}
function date(value:unknown) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)invalid('Некорректная дата.');
  return value;
}
async function canEditTeacher(db:SupabaseClient,actor:Actor,value:unknown) {
  const uid=value==null?actor.uid:id(value);
  if(actor.role!=='admin' && (!actor.teacher||actor.uid!==uid)) throw new ApiError(403,'permission-denied','Можно менять только свой профиль преподавателя.');
  const role=await dataOf(db.from('account_roles').select('role').eq('user_id',uid).maybeSingle());
  if(!role || (role.role!=='teacher'&&actor.role!=='admin'))missing('Преподаватель не найден.');
  return uid;
}
async function teacherCatalog(db:SupabaseClient) {
  const [people,instructors]=await Promise.all([
    dataOf(db.from('teacher_directory').select('id,name,position,avatar_path').order('name')),
    dataOf(db.from('subject_instructors').select('subject_id,teacher_id')),
  ]);
  const avatars=(people??[]).flatMap(p=>p.avatar_path?[p.avatar_path]:[]);
  const signed=avatars.length?await dataOf(db.storage.from(profileBucket).createSignedUrls(avatars,3600)):[];
  const links=new Map((signed??[]).filter(f=>f.path&&!f.error).map(f=>[f.path,f.signedUrl]));
  return (people??[]).map(p=>{
    return {id:p.id,name:p.name,position:p.position??'',avatarUrl:links.get(p.avatar_path)??null,
      subjectIds:(instructors??[]).filter(i=>i.teacher_id===p.id).map(i=>i.subject_id)};
  });
}
async function teacherProfile(db:SupabaseClient,actor:Actor,input:Input) {
  const uid=id(input.teacherId??actor.uid);
  const role=await dataOf(db.from('account_roles').select('role').eq('user_id',uid).maybeSingle());
  const instructor=await dataOf(db.from('teachers').select('user_id').eq('user_id',uid).maybeSingle());
  if(!role || (actor.role!=='admin'&&(!instructor||!['teacher','admin'].includes(role.role))))missing('Преподаватель не найден.');
  const [person,profile,documents,subjects]=await Promise.all([
    dataOf(db.from('profiles').select('id,name').eq('id',uid).single()),
    dataOf(db.from('teacher_profiles').select('position,bio,education,qualification,experience_years,avatar_path,revision,updated_at').eq('user_id',uid).maybeSingle()),
    dataOf(db.from('teacher_documents').select('id,title,category,issued_year,path,file_name,mime').eq('teacher_id',uid).order('created_at',{ascending:false})),
    dataOf(db.from('subject_instructors').select('subject_id').eq('teacher_id',uid)),
  ]);
  const paths=[...(documents??[]).map(d=>d.path),...(profile?.avatar_path?[profile.avatar_path]:[])];
  const signed=paths.length?await dataOf(db.storage.from(profileBucket).createSignedUrls(paths,3600)):[];
  const links=new Map((signed??[]).filter(f=>f.path&&!f.error).map(f=>[f.path,f.signedUrl]));
  return {...person,...profile,revision:profile?.revision??0,avatarUrl:links.get(profile?.avatar_path)??null,
    canEdit:actor.role==='admin'||(actor.role==='teacher'&&actor.uid===uid),subjectIds:(subjects??[]).map(s=>s.subject_id),
    documents:(documents??[]).map(d=>({...d,url:links.get(d.path)??null})),avatar_path:undefined};
}
async function profileUpload(db:SupabaseClient,actor:Actor,input:Input) {
  const uid=await canEditTeacher(db,actor,input.teacherId);
  const types=input.purpose==='avatar'?imageTypes:['application/pdf',...imageTypes];
  if(typeof input.mime!=='string'||!types.includes(input.mime))invalid('Загрузите PDF, JPG, PNG или WebP. Для фотографии нужен файл изображения.');
  const limit=input.purpose==='avatar'?5*1024*1024:10*1024*1024;
  if(typeof input.size!=='number'||!Number.isSafeInteger(input.size)||input.size<1||input.size>limit)invalid('Файл слишком большой: фото — до 5 МБ, документ — до 10 МБ.');
  const path=uid+'/'+crypto.randomUUID();
  const grant=await dataOf(db.storage.from(profileBucket).createSignedUploadUrl(path));
  if(!grant)throw new Error('Не удалось подготовить загрузку.');
  return {path,url:grant.signedUrl};
}
async function checkFile(db:SupabaseClient,uid:string,value:unknown,avatar=false) {
  if(typeof value!=='string'||!value.startsWith(uid+'/')||!/^[A-Za-z0-9_-]+$/.test(value.slice(uid.length+1)))invalid('Некорректный файл профиля.');
  const info=await dataOf(db.storage.from(profileBucket).info(value));
  if(!info || !(avatar?imageTypes:['application/pdf',...imageTypes]).includes(info.contentType??''))invalid('Файл ещё не загружен или имеет неверный формат.');
  return {path:value,mime:info.contentType??''};
}
async function saveTeacherProfile(db:SupabaseClient,actor:Actor,input:Input) {
  const uid=await canEditTeacher(db,actor,input.teacherId);
  const previous=await dataOf(db.from('teacher_profiles').select('avatar_path').eq('user_id',uid).maybeSingle());
  const years=input.experienceYears;
  if(years!==null&&(typeof years!=='number'||!Number.isInteger(years)||years<0||years>80))invalid('Укажите стаж от 0 до 80 лет или оставьте поле пустым.');
  const fields:Input={position:text(input.position??'',200,'Должность',true),bio:text(input.bio??'',5000,'Описание',true),
    education:text(input.education??'',5000,'Образование',true),qualification:text(input.qualification??'',3000,'Квалификация',true),
    experience_years:years,revision:revision(input.revision)+1,updated_at:new Date().toISOString()};
  if(input.avatarPath!==undefined)fields.avatar_path=input.avatarPath===null?null:(await checkFile(db,uid,input.avatarPath,true)).path;
  await dataOf(db.from('teacher_profiles').upsert({user_id:uid},{onConflict:'user_id',ignoreDuplicates:true}));
  const saved=await dataOf(db.from('teacher_profiles').update(fields).eq('user_id',uid).eq('revision',input.revision).select('revision').maybeSingle());
  if(!saved)throw new ApiError(409,'conflict','Профиль уже изменён. Откройте его заново.');
  if(previous?.avatar_path && fields.avatar_path!==undefined && previous.avatar_path!==fields.avatar_path){
    const used=await dataOf(db.from('teacher_documents').select('id').eq('path',previous.avatar_path).maybeSingle());
    if(!used)await db.storage.from(profileBucket).remove([previous.avatar_path]);
  }
  return saved;
}
async function saveDocument(db:SupabaseClient,actor:Actor,input:Input) {
  const uid=await canEditTeacher(db,actor,input.teacherId);
  if(!['diploma','award','certificate','other'].includes(String(input.category)))invalid('Выберите вид документа.');
  if(input.year!==null&&(typeof input.year!=='number'||!Number.isInteger(input.year)||input.year<1950||input.year>2200))invalid('Некорректный год.');
  const file=await checkFile(db,uid,input.path);
  return await dataOf(db.from('teacher_documents').insert({teacher_id:uid,title:text(input.title,200,'Название документа'),
    category:input.category,issued_year:input.year,...file,file_name:text(input.fileName,255,'Имя файла')}).select('id').single());
}
async function deleteDocument(db:SupabaseClient,actor:Actor,input:Input) {
  const uid=await canEditTeacher(db,actor,input.teacherId);
  const row=await dataOf(db.from('teacher_documents').delete().eq('teacher_id',uid).eq('id',id(input.id)).select('path').maybeSingle());
  if(!row)missing('Документ не найден.');
  const avatar=await dataOf(db.from('teacher_profiles').select('user_id').eq('avatar_path',row.path).maybeSingle());
  if(!avatar)await dataOf(db.storage.from(profileBucket).remove([row.path]));
  return null;
}
async function updateMyProfile(db:SupabaseClient,actor:Actor,input:Input) {
  const name=text(input.name,120,'ФИО').replace(/\s+/gu,' ');
  if(typeof input.noPatronymic!=='boolean')invalid('Укажите, есть ли отчество.');
  const valid=await dataOf(db.rpc('valid_full_name',{p_name:name,p_no_patronymic:input.noPatronymic}));
  if(!valid)invalid('Укажите имя, фамилию и отчество без цифр и никнеймов. Если отчества нет, отметьте это ниже.');
  await dataOf(db.from('profiles').update({name,no_patronymic:input.noPatronymic}).eq('id',actor.uid));
  return {name,noPatronymic:input.noPatronymic};
}
async function listSchedule(db:SupabaseClient,input:Input) {
  const from=date(input.from),to=date(input.to);
  if(to<from||Date.parse(to)-Date.parse(from)>31*86400000)invalid('Выберите период не более 31 дня.');
  const rows=(await dataOf(db.from('schedule_entries').select('id,lesson_date,starts_at,ends_at,subject_id,title,teacher_id,group_name,room,note,revision')
    .gte('lesson_date',from).lte('lesson_date',to).order('lesson_date').order('starts_at').order('id').range(0,500)))??[];
  return {rows:rows.slice(0,500).map(row=>({...row,lesson_date:new Date(row.lesson_date).toISOString().slice(0,10)})),hasMore:rows.length>500};
}
async function saveSchedule(db:SupabaseClient,actor:Actor,input:Input) {
  requireAdmin(actor);
  if(typeof input.startsAt!=='string'||typeof input.endsAt!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startsAt)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.endsAt)||input.endsAt<=input.startsAt)invalid('Укажите время начала и окончания занятия.');
  const teacherId=input.teacherId?id(input.teacherId):null;
  if(teacherId){const staff=await dataOf(db.from('teacher_directory').select('id').eq('id',teacherId).maybeSingle());if(!staff)invalid('Выберите действующего преподавателя.');}
  const subjectId=input.subjectId?id(input.subjectId):null;
  if(subjectId){const subject=await dataOf(db.from('subjects').select('id').eq('id',subjectId).is('archived_at',null).maybeSingle());if(!subject)invalid('Предмет недоступен.');}
  const row={lesson_date:date(input.date),starts_at:input.startsAt,ends_at:input.endsAt,subject_id:subjectId,
    title:text(input.title,200,'Название занятия'),teacher_id:teacherId,group_name:text(input.group??'',100,'Группа',true),
    room:text(input.room??'',100,'Аудитория',true),note:text(input.note??'',1000,'Примечание',true),created_by:actor.uid,updated_at:new Date().toISOString()};
  if(!input.id)return await dataOf(db.from('schedule_entries').insert(row).select('id,revision').single());
  const saved=await dataOf(db.from('schedule_entries').update({...row,revision:revision(input.revision)+1}).eq('id',id(input.id)).eq('revision',input.revision).select('id,revision').maybeSingle());
  if(!saved)throw new ApiError(409,'conflict','Занятие уже изменено. Обновите расписание.');
  return saved;
}
export async function communityAction(db:SupabaseClient,actor:Actor,action:unknown,input:Input):Promise<{data:unknown}|null> {
  let data:unknown;
  switch(action){
    case 'updateMyProfile': data=await updateMyProfile(db,actor,input);break;
    case 'listTeachers': data=await teacherCatalog(db);break;
    case 'getTeacherProfile':data=await teacherProfile(db,actor,input);break;
    case 'createProfileUpload':data=await profileUpload(db,actor,input);break;
    case 'saveTeacherProfile':data=await saveTeacherProfile(db,actor,input);break;
    case 'addTeacherDocument':data=await saveDocument(db,actor,input);break;
    case 'deleteTeacherDocument':data=await deleteDocument(db,actor,input);break;
    case 'removeProfileUpload':{
      const uid=await canEditTeacher(db,actor,input.teacherId);
      const path=text(input.path,300,'Файл');
      if(!path.startsWith(uid+'/')||!/^[A-Za-z0-9_-]+$/.test(path.slice(uid.length+1)))invalid('Некорректный файл.');
      const [document,profile]=await Promise.all([
        dataOf(db.from('teacher_documents').select('id').eq('path',path).maybeSingle()),
        dataOf(db.from('teacher_profiles').select('user_id').eq('avatar_path',path).maybeSingle()),
      ]);
      if(document||profile){data=false;break;}
      await dataOf(db.storage.from(profileBucket).remove([path]));data=true;break;
    }
    case 'listSchedule':data=await listSchedule(db,input);break;
    case 'saveSchedule':data=await saveSchedule(db,actor,input);break;
    case 'deleteSchedule':{
      requireAdmin(actor);
      const row=await dataOf(db.from('schedule_entries').delete().eq('id',id(input.id)).eq('revision',revision(input.revision)).select('id').maybeSingle());
      if(!row)throw new ApiError(409,'conflict','Занятие уже изменено. Обновите расписание.');data=null;break;
    }
    case 'listAccounts': requireAdmin(actor);data=await dataOf(db.rpc('list_accounts',{p_actor_id:actor.uid,p_search:text(input.search??'',120,'Поиск',true),p_offset:pageOffset(input.offset)}));break;
    case 'setAccountRole':
      requireAdmin(actor);
      if(!['student','teacher','admin'].includes(String(input.role))||!['student','teacher','admin'].includes(String(input.expectedRole)))invalid('Выберите роль и обновите список аккаунтов.');
      data=await dataOf(db.rpc('set_account_role',{p_actor_id:actor.uid,p_user_id:id(input.userId),p_role:input.role,p_expected_role:input.expectedRole}));break;
    case 'listNotifications':data=await dataOf(db.rpc('notification_feed',{p_user_id:actor.uid,p_offset:pageOffset(input.offset)}));break;
    case 'readNotifications':{
      if(!Array.isArray(input.ids)||input.ids.length>100)invalid('Некорректный список уведомлений.');
      data=await dataOf(db.rpc('read_notifications',{p_user_id:actor.uid,p_ids:input.ids.map(id)}));break;
    }
    case 'publishAnnouncement':{
      requireAdmin(actor);
      data=await dataOf(db.from('notifications').insert({actor_id:actor.uid,title:text(input.title,200,'Заголовок'),body:text(input.body,2000,'Текст'),destination:'notifications',severity:input.important===true?'danger':'info'}).select('id').single());break;
    }
    default:return null;
  }
  return {data};
}

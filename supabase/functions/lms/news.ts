import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.89.0';
import {ApiError,dataOf,id,invalid,record,requireAdmin,text} from './shared.ts';
import type {Actor,Input} from './shared.ts';
import release from '../../../release.json' with {type:'json'};

// One shared lease/cache avoids a GitHub request per visitor. Already imported
// commits remain readable during network failures and rate limiting.
export async function syncGitHubNews(db:SupabaseClient,fetcher:typeof fetch=fetch){
  const claim=await dataOf(db.rpc('claim_news_sync',{}));if(!claim)return;
  try{
    const signal=AbortSignal.timeout(10000),rows:Record<string,unknown>[]=[],stop=String(claim.cursor_sha||release.githubBaseCommit);
    let found=false,latest='';
    for(let page=1;page<=10&&!found;page++){
      const response=await fetcher(`https://api.github.com/repos/kteppk/lms-platform1/commits?sha=main&per_page=100&page=${page}`,
        {headers:{Accept:'application/vnd.github+json','User-Agent':'kteppk-lms-news'},signal});
      if(!response.ok)throw new Error('GitHub unavailable');
      const commits=await response.json();if(!Array.isArray(commits))throw new Error('Invalid GitHub feed');
      if(!commits.length)break;
      for(const c of commits){
        if(typeof c.sha!=='string'||! /^[a-f0-9]{40}$/.test(c.sha))throw new Error('Invalid commit');
        latest||=c.sha;
        if(c.sha.startsWith(stop)||c.sha.startsWith(release.githubBaseCommit)){found=true;break;}
        // Explicitly requested quiet maintenance still advances the sync cursor.
        if(/\[skip-news\]/i.test(String(c.commit?.message??'')))continue;
        const translated:Record<string,string>={a35e2b5:'Версия 0.9.0: новости, гостевой доступ, чат кураторов и уведомления\n\nДобавлены гостевой просмотр новостей и расписания, фильтры публикаций и лайки. Закрытый чат доступен кураторам-студентам и администрации. Браузерные уведомления включаются отдельно на каждом устройстве.',b6b3677:'Проверены кабинеты, права кураторов и доставка уведомлений\n\nНа рабочем сайте проверены кабинеты, лайки, закрытый чат и настоящая доставка push-уведомлений. Временные проверочные данные удалены.'};
        const message=translated[c.sha.slice(0,7)]??String(c.commit?.message??'Обновление сайта'),date=c.commit?.committer?.date;
        if(!date||!Number.isFinite(Date.parse(date)))throw new Error('Invalid commit date');
        rows.push({channel:'site',kind:'update',title:message.split('\n')[0].slice(0,200)||'Обновление сайта',
          body:message.slice(0,20000)||'Изменения опубликованы в репозитории.',source_key:'github:'+c.sha,commit_sha:c.sha,published_at:date});
      }
      if(commits.length<100)break;
    }
    if(!found)throw new Error('History cursor not reached');
    if(rows.length)await dataOf(db.from('news_posts').upsert(rows,{onConflict:'source_key',ignoreDuplicates:true}));
    await dataOf(db.from('news_sync').update({cursor_sha:latest||stop,checked_at:new Date().toISOString(),locked_until:null}).eq('id','github'));
  }catch{
    await dataOf(db.from('news_sync').update({checked_at:new Date().toISOString(),locked_until:null}).eq('id','github'));
  }
}
export async function newsAction(db:SupabaseClient,actor:Actor,action:unknown,input:Input):Promise<{data:unknown}|null>{
  let data:unknown;
  switch(action){
    case 'listNews':{
      if(!['all','site','college'].includes(String(input.channel)))invalid('Выберите категорию новостей.');
      const offset=input.offset??0;if(!Number.isInteger(offset)||Number(offset)<0||Number(offset)>100000)invalid('Некорректная страница.');
      if(input.channel==='site'||input.channel==='all'){
        const task=syncGitHubNews(db),runtime=globalThis as unknown as {EdgeRuntime?:{waitUntil(task:Promise<unknown>):void}};
        if(runtime.EdgeRuntime)runtime.EdgeRuntime.waitUntil(task.catch(()=>{}));else await task;
      }
      if(!['newest','oldest'].includes(String(input.order??'newest')))invalid('Выберите порядок новостей.');
      data=await dataOf(db.rpc('news_feed_v2',{p_user:actor.uid,p_channel:input.channel,p_order:input.order??'newest',p_offset:offset}));break;
    }
    case 'setNewsLike':{
      if(typeof input.liked!=='boolean')invalid('Укажите состояние лайка.');
      data=await dataOf(db.rpc('set_news_like',{p_user:actor.uid,p_post:id(input.id),p_liked:input.liked}));break;
    }
    case 'saveNewsPost':{
      if(!['admin','curator'].includes(actor.role))throw new ApiError(403,'permission-denied','Публикации доступны администраторам и кураторам.');
      if(!['site','college'].includes(String(input.channel))||!['news','announcement','update'].includes(String(input.kind)))invalid('Выберите ленту и тип публикации.');
      if(input.id&&(!Number.isInteger(input.revision)||Number(input.revision)<0))invalid('Обновите новость.');
      const args={p_actor:actor.uid,p_id:input.id?id(input.id):null,p_revision:input.id?input.revision:0,
        p_channel:input.channel,p_kind:input.kind,p_title:text(input.title,200,'Заголовок'),p_body:text(input.body,20000,'Текст'),p_notify:input.notify===true,p_important:input.important===true};
      if(input.photos===undefined){data=await dataOf(db.rpc('save_news_post',args));break;}
      if(!Array.isArray(input.photos)||input.photos.length>4)invalid('Можно прикрепить до четырёх фотографий.');
      const photos=input.photos.map(value=>{
        const photo=record(value);
        if(typeof photo.id==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(photo.id)&&photo.data===undefined)return {id:photo.id};
        if(typeof photo.data==='string'&&photo.data.length<=191148&&/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(photo.data)&&photo.id===undefined)return {data:photo.data};
        return invalid('Не удалось прочитать фотографию.');
      });
      data=await dataOf(db.rpc('save_news_post_with_photos',{...args,p_photos:photos}));break;
    }
    case 'deleteNewsPost':
      if(!Number.isInteger(input.revision)||Number(input.revision)<0)invalid('Обновите новость.');
      data=await dataOf(db.rpc('delete_news_post',{p_actor:actor.uid,p_id:id(input.id),p_revision:input.revision}));break;
    case 'registrationStatistics':requireAdmin(actor);data=await dataOf(db.rpc('registration_statistics',{p_actor:actor.uid}));break;
    default:return null;
  }
  return {data};
}

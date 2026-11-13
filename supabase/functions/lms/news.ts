import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.89.0';
import {dataOf,id,invalid,requireAdmin,text} from './shared.ts';
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
        const message=String(c.commit?.message??'Обновление сайта'),date=c.commit?.committer?.date;
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
      if(!['site','college'].includes(String(input.channel)))invalid('Выберите ленту новостей.');
      const offset=input.offset??0;if(!Number.isInteger(offset)||Number(offset)<0||Number(offset)>100000)invalid('Некорректная страница.');
      if(input.channel==='site')await syncGitHubNews(db);
      data=await dataOf(db.rpc('news_feed',{p_channel:input.channel,p_offset:offset}));break;
    }
    case 'saveNewsPost':
      requireAdmin(actor);
      if(!['site','college'].includes(String(input.channel))||!['news','announcement','update'].includes(String(input.kind)))invalid('Выберите ленту и тип публикации.');
      if(input.id&&(!Number.isInteger(input.revision)||Number(input.revision)<0))invalid('Обновите новость.');
      data=await dataOf(db.rpc('save_news_post',{p_actor:actor.uid,p_id:input.id?id(input.id):null,p_revision:input.id?input.revision:0,
        p_channel:input.channel,p_kind:input.kind,p_title:text(input.title,200,'Заголовок'),p_body:text(input.body,20000,'Текст'),p_notify:input.notify===true,p_important:input.important===true}));break;
    case 'deleteNewsPost':
      requireAdmin(actor);if(!Number.isInteger(input.revision)||Number(input.revision)<0)invalid('Обновите новость.');
      data=await dataOf(db.rpc('delete_news_post',{p_actor:actor.uid,p_id:id(input.id),p_revision:input.revision}));break;
    case 'registrationStatistics':requireAdmin(actor);data=await dataOf(db.rpc('registration_statistics',{p_actor:actor.uid}));break;
    default:return null;
  }
  return {data};
}

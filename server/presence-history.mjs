const minute=60000;
export const historyRanges=Object.freeze({'60m':{minutes:60,step:1},'7h':{minutes:420,step:5},'24h':{minutes:1440,step:15},'3d':{minutes:4320,step:30},'7d':{minutes:10080,step:60}});
export function historyWindow(range,now=Date.now()){
 if(typeof range!=='string'||!Object.hasOwn(historyRanges,range))throw Object.assign(Error('Выберите период: 60 минут, 7 часов, 24 часа, 3 дня или 7 дней.'),{status:400,code:'invalid-argument'});const config=historyRanges[range];
 const end=Math.floor(now/minute)*minute,from=end-(config.minutes-1)*minute,start=Math.floor(from/(config.step*minute))*config.step*minute;
 return {...config,from,start,end};
}
export function mergeSample(previous,sample){
 if(!previous)return sample;
 return {...(sample.accounts>=previous.accounts?sample:previous),guest_connections:Math.max(previous.guest_connections,sample.guest_connections),observed_at:sample.observed_at>previous.observed_at?sample.observed_at:previous.observed_at};
}
const writeSQL=`insert into app_metrics.online_samples as current(bucket,observed_at,accounts,students,teachers,curators,admins,guest_connections)
 select bucket,observed_at,accounts,students,teachers,curators,admins,guest_connections from jsonb_to_recordset($1::jsonb)
 as s(bucket timestamptz,observed_at timestamptz,accounts integer,students integer,teachers integer,curators integer,admins integer,guest_connections integer)
 on conflict(bucket) do update set
 observed_at=greatest(current.observed_at,excluded.observed_at),accounts=greatest(current.accounts,excluded.accounts),
 students=case when excluded.accounts>=current.accounts then excluded.students else current.students end,
 teachers=case when excluded.accounts>=current.accounts then excluded.teachers else current.teachers end,
 curators=case when excluded.accounts>=current.accounts then excluded.curators else current.curators end,
 admins=case when excluded.accounts>=current.accounts then excluded.admins else current.admins end,
 guest_connections=greatest(current.guest_connections,excluded.guest_connections)
 where excluded.accounts>current.accounts or excluded.guest_connections>current.guest_connections
 or (excluded.accounts=current.accounts and (excluded.students,excluded.teachers,excluded.curators,excluded.admins) is distinct from (current.students,current.teachers,current.curators,current.admins))
 returning bucket`;
export function createPresenceHistory({pool,getPresence,now=()=>Date.now(),onSample=()=>{},onError=()=>{},sampleMs=30000,flushMs=1000}){
 let stopped=false,timer=null,flushTimer=null,inFlight=null,lastCleanup=0;const pending=new Map();
 function capture(){
  if(stopped)return;const p=getPresence();if(!p.available)return;
  const at=now(),bucket=new Date(Math.floor(at/minute)*minute).toISOString();
  const sample={bucket,observed_at:new Date(at).toISOString(),accounts:p.accounts,students:p.roles.student,teachers:p.roles.teacher,curators:p.roles.curator,admins:p.roles.admin,guest_connections:p.guestConnections};
  pending.set(bucket,mergeSample(pending.get(bucket),sample));
  if(!flushTimer)flushTimer=setTimeout(()=>{flushTimer=null;flush().catch(()=>{});},flushMs);
 }
 async function flush(){
  if(inFlight){await inFlight;if(pending.size)return flush();return;}
  if(!pending.size)return;const batch=[...pending.values()];pending.clear();
  inFlight=(async()=>{try{
   const saved=await pool.query(writeSQL,[JSON.stringify(batch)]);
   if(now()-lastCleanup>3600000){await pool.query("delete from app_metrics.online_samples where bucket<now()-interval '8 days'");lastCleanup=now();}
   if(saved.rows.length)onSample();
  }catch(error){for(const row of batch)pending.set(row.bucket,mergeSample(pending.get(row.bucket),row));onError(error);throw error;}finally{inFlight=null;}})();
  return inFlight;
 }
 async function read(range){
  const window=historyWindow(range,now());capture();await flush();
  const [data,meta]=await Promise.all([
   pool.query(`select date_bin($1::int*interval '1 minute',bucket,'1970-01-01 00:00:00+00'::timestamptz) bucket,
    max(accounts)::integer accounts,max(guest_connections)::integer guest_connections,count(*)::integer samples
    from app_metrics.online_samples where bucket>=$2::timestamptz and bucket<=$3::timestamptz group by 1 order by 1`,[window.step,new Date(window.from).toISOString(),new Date(window.end).toISOString()]),
   pool.query("select started_at from app_metrics.collection_state where id='online'")]);
  const found=new Map(data.rows.map(r=>[new Date(r.bucket).getTime(),r]));const points=[];
  for(let t=window.start;t<=window.end;t+=window.step*minute){const row=found.get(t);points.push({at:new Date(t).toISOString(),accounts:row?Number(row.accounts):null,guestConnections:row?Number(row.guest_connections):null,samples:row?Number(row.samples):0});}
  return {range,stepMinutes:window.step,from:new Date(window.from).toISOString(),to:new Date(now()).toISOString(),collectionStartedAt:meta.rows[0]?.started_at??null,points};
 }
 function start(){if(timer||stopped)return;capture();timer=setInterval(capture,sampleMs);timer.unref?.();}
 async function close(){stopped=true;clearInterval(timer);clearTimeout(flushTimer);flushTimer=null;await flush().catch(()=>{});}
 return {start,capture,flush,read,close};
}

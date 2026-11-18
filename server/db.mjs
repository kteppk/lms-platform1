// Only server-owned identifiers enter SQL. All data values are bound parameters.
const identifier=v=>{if(typeof v!=='string'||!/^[a-z_][a-z0-9_]*$/.test(v))throw Error('Invalid SQL identifier');return '"'+v+'"';};
export function createDatabase(pool,storage){
 function from(table){
  const target='public.'+identifier(table);let operation='select',columns='*',valuesToWrite,filters=[],orders=[],first,last,one=false,required=false,conflict=null,ignore=false;
  const q={select(c='*'){columns=c;return q;},eq(k,v){filters.push([k,'=',v]);return q;},is(k,v){if(v!==null)throw Error('Only IS NULL is supported');filters.push([k,'is null',null]);return q;},gte(k,v){filters.push([k,'>=',v]);return q;},lte(k,v){filters.push([k,'<=',v]);return q;},lt(k,v){filters.push([k,'<',v]);return q;},ilike(k,v){filters.push([k,'ilike',v]);return q;},overlaps(k,v){filters.push([k,'&&',v]);return q;},order(k,o={}){orders.push(identifier(k)+(o.ascending===false?' desc':' asc'));return q;},range(a,b){if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<a)throw Error('Invalid range');first=a;last=b;return q;},insert(v){operation='insert';valuesToWrite=v;return q;},upsert(v,o={}){operation='insert';valuesToWrite=v;conflict=(o.onConflict||'id').split(',');ignore=o.ignoreDuplicates===true;return q;},update(v){operation='update';valuesToWrite=v;return q;},delete(){operation='delete';return q;},single(){one=true;required=true;return q;},maybeSingle(){one=true;return q;},then(resolve,reject){return execute().then(resolve,reject);}};
  async function execute(){try{
   const parameters=[],bind=v=>{parameters.push(v);return '$'+parameters.length;};
   const encoded=(k,v)=>['questions','attachment_details','context','answers','test_snapshot','question_scores','grades'].includes(k)&&v!==null?JSON.stringify(v):v;
   const fields=columns==='*'?'*':columns.split(/,(?![^()]*\))/).map(field=>{
    if(table==='subjects'&&field==='subject_teachers(teacher_id)')return `(select coalesce(jsonb_agg(jsonb_build_object('teacher_id',st.teacher_id)),'[]'::jsonb) from public.subject_teachers st where st.subject_id=subjects.id) as subject_teachers`;
    return identifier(field);
   }).join(',');
   const where=()=>filters.length?' where '+filters.map(([k,op,v])=>identifier(k)+' '+op+(op==='is null'?'':' '+bind(v))).join(' and '):'';
   let sql;
   if(operation==='select')sql='select '+fields+' from '+target+where()+(orders.length?' order by '+orders.join(','):'')+(first!==undefined?' limit '+(last-first+1)+' offset '+first:'');
   else if(operation==='delete')sql='delete from '+target+where()+' returning '+fields;
   else if(operation==='update'){const pairs=Object.entries(valuesToWrite);sql='update '+target+' set '+pairs.map(([k,v])=>identifier(k)+'='+bind(encoded(k,v))).join(',')+where()+' returning '+fields;}
   else{
    const rows=Array.isArray(valuesToWrite)?valuesToWrite:[valuesToWrite];if(!rows.length)return {data:[],error:null};const keys=Object.keys(rows[0]);
    if(rows.some(r=>Object.keys(r).length!==keys.length||keys.some(k=>!(k in r))))throw Error('Inconsistent insert columns');
    sql='insert into '+target+' ('+keys.map(identifier).join(',')+') values '+rows.map(r=>'('+keys.map(k=>bind(encoded(k,r[k]))).join(',')+')').join(',');
    if(conflict)sql+=' on conflict ('+conflict.map(identifier).join(',')+') '+(ignore?'do nothing':'do update set '+keys.filter(k=>!conflict.includes(k)).map(k=>identifier(k)+'=excluded.'+identifier(k)).join(','));
    sql+=' returning '+fields;
   }
   const {rows}=await pool.query(sql,parameters);if(one&&rows.length>1)return {data:null,error:{code:'PGRST116',message:'Expected one row'}};if(required&&!rows.length)return {data:null,error:{code:'PGRST116',message:'Запись не найдена.'}};
   return {data:one?rows[0]??null:rows,error:null};
  }catch(error){return {data:null,error:{code:error.code,message:error.message}};}}
  return q;
 }
 return {from,storage,rpc:async(name,args={})=>{try{const entries=Object.entries(args),sql='select public.'+identifier(name)+'('+entries.map(([k],i)=>identifier(k)+'=> $'+(i+1)).join(',')+') value';const values=entries.map(([,v])=>v!==null&&typeof v==='object'?JSON.stringify(v):v);const {rows}=await pool.query(sql,values);return {data:rows[0]?.value??null,error:null};}catch(error){return {data:null,error:{code:error.code,message:error.message}};}}};
}

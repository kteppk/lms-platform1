// Initial import only: never overwrites an existing cell or changes an account role.
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const source=JSON.parse(fs.readFileSync('supabase/seed-weekly-schedule.json','utf8'));
const [cli,actor,mode]=process.argv.slice(2);
assert.ok(cli&&actor,'Usage: node scripts/import-weekly-schedule.cjs <supabase-cli> <existing-admin-uid> [--apply]');
assert.match(actor,/^[A-Za-z0-9_-]{1,128}$/);
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
let sql='begin; do $import$ declare v_group_id text; actor_id text:='+quote(actor)+'; begin\n';
sql+="if not exists(select 1 from public.account_roles where user_id=actor_id and role='admin') then raise exception 'Existing administrator required';end if;\n";
for(const group of source.groups){
  assert.equal(group.days.length,5);
  sql+='insert into public.study_groups(name,course,program,created_by) values('+[group.name,group.course,source.program,actor].map(quote).join(',')+') on conflict do nothing;\n';
  sql+='select id into strict v_group_id from public.study_groups where lower(regexp_replace(btrim(name),\'\\s+\',\' \',\'g\'))=lower('+quote(group.name)+');\n';
  group.days.forEach((cells,day)=>{
    assert.equal(cells.length,6);
    cells.forEach((cell,i)=>{
      const payload=cell?{status:'lesson',title:cell[0],teacherLabel:cell[1],room:cell[2],note:cell[3]||''}:{status:'free'};
      sql+='if not exists(select 1 from public.weekly_schedule_cells where group_id=group_id_placeholder and weekday='+(day+1)+' and lesson_number='+(i+1)+') then\n';
      sql+='perform public.save_schedule_cell(actor_id,v_group_id,'+(day+1)+','+(i+1)+',null,0,'+quote(JSON.stringify(payload))+'::jsonb);end if;\n';
    });
  });
}
// Qualify the table alias to avoid PL/pgSQL variable/column ambiguity.
sql=sql.replaceAll('from public.weekly_schedule_cells where group_id=group_id_placeholder','from public.weekly_schedule_cells c where c.group_id=v_group_id');
sql+='end; $import$; commit;';
if(mode!=='--apply'){console.log('Dry run: 2 groups, 60 visible cells; existing cells will be preserved. Pass --apply to import.');process.exit(0);}
execFileSync(cli,['db','query',sql,'--remote=qqhkuuktgzcyrkfdnjjq','--yes','--output','json'],{encoding:'utf8',timeout:60000,windowsHide:true,stdio:['ignore','pipe','pipe']});
console.log('Imported the readable Monday–Friday cells; existing cells preserved.');

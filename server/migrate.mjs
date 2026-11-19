// Run as the local postgres administrator before allowing writes on the new site.
import fs from 'node:fs/promises';import path from 'node:path';import pg from 'pg';
const folder=process.argv[2];if(!folder)throw Error('Provide the protected backup folder');
const pool=new pg.Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{user:'postgres',database:'lms',host:'/var/run/postgresql'}),client=await pool.connect();
const quote=s=>{if(!/^[a-z_]+$/.test(s))throw Error('Invalid table');return '"'+s+'"';};
try{
 const backup=JSON.parse(await fs.readFile(path.join(folder,'database.json'),'utf8'));
 const installed=(await client.query("select to_regclass('public.profiles') installed")).rows[0].installed;
 if(!installed){await client.query('create schema if not exists storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[])');for(const file of (await fs.readdir(new URL('../supabase/migrations/',import.meta.url))).sort())await client.query(await fs.readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));}
 await client.query('begin');await client.query("set local session_replication_role='replica'");
 const names=Object.keys(backup.tables);await client.query('truncate '+names.map(t=>'public.'+quote(t)).join(',')+' restart identity cascade');
 for(const [table,rows]of Object.entries(backup.tables)){if(rows.length)await client.query('insert into public.'+quote(table)+' overriding system value select * from jsonb_populate_recordset(null::public.'+quote(table)+',$1::jsonb)',['['+rows.join(',')+']']);}
 // Identity counters must continue after the imported chat and delivery IDs.
 for(const [table,column]of [['curator_messages','id'],['push_deliveries','id']])await client.query(`select setval(pg_get_serial_sequence('public.${table}','${column}'),greatest(coalesce((select max(${column}) from public.${table}),0)+1,1),false)`);
 await client.query("set local session_replication_role='origin'");
 for(const [table,rows]of Object.entries(backup.tables)){
  const count=Number((await client.query('select count(*) n from public.'+quote(table))).rows[0].n);if(count!==rows.length)throw Error('Row count mismatch: '+table);
  const mismatch=await client.query('with expected as(select value from jsonb_array_elements($1::jsonb)),actual as(select to_jsonb(t) value from public.'+quote(table)+' t) select count(*) n from ((select value from expected except all select value from actual) union all (select value from actual except all select value from expected)) differences',['['+rows.join(',')+']']);
  if(Number(mismatch.rows[0].n))throw Error('Record content mismatch: '+table);
 }
 const foreignKeys=(await client.query("select conrelid::regclass::text table_name,confrelid::regclass::text target,conkey,confkey from pg_constraint where contype='f' and connamespace='public'::regnamespace")).rows;
 for(const fk of foreignKeys){const columns=async(table,keys)=>(await client.query('select attname from pg_attribute where attrelid=$1::regclass and attnum=any($2::smallint[]) order by array_position($2::smallint[],attnum)',[table,keys])).rows.map(r=>quote(r.attname));const source=await columns(fk.table_name,fk.conkey),target=await columns(fk.target,fk.confkey);const count=(await client.query('select count(*) n from '+fk.table_name+' a where '+source.map(c=>'a.'+c+' is not null').join(' and ')+' and not exists(select 1 from '+fk.target+' b where '+source.map((c,i)=>'a.'+c+'=b.'+target[i]).join(' and ')+')')).rows[0].n;if(Number(count))throw Error('Foreign key mismatch: '+fk.table_name);}
 await client.query('commit');await client.query(await fs.readFile(new URL('./auth-schema.sql',import.meta.url),'utf8'));
 const users=JSON.parse(await fs.readFile(path.join(folder,'firebase-users.json'),'utf8')).users;
 await client.query('begin');await client.query('truncate app_auth.reset_tokens,app_auth.recovery_requests,app_auth.sessions,app_auth.users');
 for(const u of users){if(!u.passwordHash||!u.salt)throw Error('Missing password hash for an imported account');await client.query('insert into app_auth.users(id,email,display_name,email_verified,password,disabled,created_at,last_login_at) values($1,$2,$3,$4,$5,$6,$7,$8)',[u.localId,u.email,u.displayName||'',!!u.emailVerified,{algorithm:'firebase-scrypt',hash:u.passwordHash,salt:u.salt},!!u.disabled,new Date(Number(u.createdAt)||Date.now()),u.lastLoginAt?new Date(Number(u.lastLoginAt)):null]);}await client.query('commit');
 await client.query(await fs.readFile(new URL('./realtime-schema.sql',import.meta.url),'utf8'));
 console.log('Restored and verified '+names.length+' public tables and '+users.length+' login accounts.');
}catch(e){await client.query('rollback').catch(()=>{});console.error('Restore failed: '+e.message);process.exitCode=1;}finally{client.release();await pool.end();}

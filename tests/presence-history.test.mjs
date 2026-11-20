import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
import {createPresenceHistory,historyWindow,mergeSample} from '../server/presence-history.mjs';
let db,pool,time,view,history,changes=0;const initial=Date.parse('2026-11-20T03:10:00Z');
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;create role lms_backend;');await db.exec(await fs.readFile('server/presence-schema.sql','utf8'));pool={query:(...a)=>db.query(...a)};time=initial;view={available:true,accounts:2,roles:{student:1,teacher:0,curator:0,admin:1},guestConnections:1};history=createPresenceHistory({pool,getPresence:()=>view,now:()=>time,onSample:()=>changes++,flushMs:3600000});});
after(async()=>{await history?.close();await db?.close();});
test('fixed windows bound data volume and reject arbitrary periods',()=>{
 for(const [range,step]of [['60m',1],['7h',5],['24h',15],['3d',30],['7d',60]]){const w=historyWindow(range,initial);assert.equal(w.step,step);assert.ok((w.end-w.start)/60000/step<170);}
 for(const range of ['year','__proto__',null,[],['60m'],{minutes:1}])assert.throws(()=>historyWindow(range,initial),e=>e.status===400);
});
test('minute peaks are durable and role counts belong to an actual peak; unchanged reads do not create an event loop',async()=>{
 history.capture();view={...view,accounts:1,roles:{student:0,teacher:0,curator:0,admin:1},guestConnections:3};time+=10000;history.capture();await history.flush();
 let row=(await db.query('select * from app_metrics.online_samples')).rows[0];assert.equal(row.accounts,2);assert.equal(row.students,1);assert.equal(row.admins,1);assert.equal(row.guest_connections,3);assert.equal(changes,1);
 const data=await history.read('60m');assert.equal(data.points.at(-1).accounts,2);assert.equal(data.points.at(-1).guestConnections,3);assert.equal(changes,1);
 assert.equal(data.points[0].accounts,null);assert.equal(data.points[0].samples,0);
 const other=createPresenceHistory({pool,getPresence:()=>({...view,available:false}),now:()=>time});assert.equal((await other.read('60m')).points.at(-1).accounts,2);await other.close();
});
test('gaps stay unknown, measured zero stays zero, and unavailable realtime does not fabricate observations',async()=>{
 view={available:false};time=initial+60000;history.capture();await history.flush();
 view={available:true,accounts:0,roles:{student:0,teacher:0,curator:0,admin:0},guestConnections:0};time=initial+120000;history.capture();await history.flush();
 const data=await history.read('60m');assert.equal(data.points.at(-1).accounts,0);assert.equal(data.points.at(-2).accounts,null);assert.equal(data.points.at(-3).accounts,2);
});
test('seven-day view aggregates existing minute peaks and database access is private',async()=>{
 const data=await history.read('7d');assert.equal(data.stepMinutes,60);assert.ok(data.points.length<=169);assert.ok(data.points.some(p=>p.accounts===2));
 for(const role of ['anon','authenticated','service_role']){assert.equal((await db.query("select has_schema_privilege($1,'app_metrics','usage') allowed",[role])).rows[0].allowed,false);}
 assert.equal((await db.query("select has_table_privilege('lms_backend','app_metrics.online_samples','insert') allowed")).rows[0].allowed,true);
});
